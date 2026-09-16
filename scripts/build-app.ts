import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds the sn_headless scoped-app update set (single XML) from the
 * declarative manifest (app.json), the Script Includes under script-includes/,
 * the REST handlers under rest/, and the validated skill documents under
 * packages/skill-docs/src (seed data).
 *
 * The XML follows the standard sys_update_set export shape so it can be loaded
 * via System Update Sets -> Load XML on any instance.
 */

interface FieldDef {
  name: string;
  label: string;
  type: string;
  max_length?: number;
  choice_values?: string[];
  reference_table?: string;
}
interface AclDef {
  operation: string;
  grant: string; // "true" | "admin" | "script:<code>"
}
interface TableDef {
  name: string;
  label: string;
  extends?: string;
  fields: FieldDef[];
  acls: AclDef[];
}
interface ResourceDef {
  name: string;
  httpMethod: string;
  path: string;
  scriptFile: string;
}
interface AppManifest {
  name: string;
  scope: string;
  version: string;
  description: string;
  tables: TableDef[];
  resources: ResourceDef[];
}

const SCRIPT_INCLUDE_DIRS = ["script-includes", "rest"];

export function loadManifest(): AppManifest {
  const path = join(repoRoot(), "instance", "sn_headless", "app.json");
  return JSON.parse(readFileSync(path, "utf8")) as AppManifest;
}

export function buildUpdateSet(): string {
  const manifest = loadManifest();
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="utf-8"?>');
  out.push("<unload>");
  out.push(`<sys_update_set action="INSERT_OR_UPDATE">`);
  out.push(`<name>sn_headless-${manifest.version}</name>`);
  out.push(`<version>${manifest.version}</version>`);
  out.push(`<description>${xmlEscape(manifest.description)}</description>`);
  out.push(`<release_date>${new Date().toISOString().slice(0, 10)}</release_date>`);
  out.push(`<released_on>${new Date().toISOString().slice(0, 10)}</released_on>`);

  // package scope
  out.push(
    rec(
      "sys_scope",
      sysId("sys_scope", manifest.scope),
      [
        f("name", manifest.scope),
        f("scope", manifest.scope),
        f("is_private", "false"),
        f("active", "true"),
      ],
    ),
  );

  // tables
  for (const table of manifest.tables) {
    out.push(
      rec(
        "sys_db_object",
        sysId("sys_db_object", table.name),
        [
          f("name", table.name),
          f("super_class", table.extends ?? "sys_metadata"),
          f("label", table.label),
          f("active", "true"),
        ],
      ),
    );
    for (const field of table.fields) {
      const attrs: Array<[string, string]> = [
        ["name", table.name],
        ["column", field.name],
        ["label", field.label],
        ["type", field.type],
        ["active", "true"],
      ];
      if (field.max_length) attrs.push(["max_length", String(field.max_length)]);
      if (field.reference_table) attrs.push(["reference", field.reference_table]);
      if (field.type === "choice") attrs.push(["choice", "1"]);
      out.push(rec("sys_dictionary", sysId("sys_dictionary", `${table.name}.${field.name}`), attrs));
      out.push(
        rec(
          "sys_documentation",
          sysId("sys_documentation", `${table.name}.${field.name}`),
          [
            ["name", table.name],
            ["label", field.label],
            ["plural", field.label],
          ],
        ),
      );
    }
    for (const field of table.fields) {
      if (!field.choice_values?.length) continue;
      for (const value of field.choice_values) {
        out.push(
          rec(
            "sys_choice",
            sysId("sys_choice", `${table.name}.${field.name}.${value}`),
            [
              ["name", table.name],
              ["element", field.name],
              ["choice", value],
              ["label", value],
              ["inactive", "false"],
            ],
          ),
        );
      }
    }
    for (const acl of table.acls) {
      out.push(aclRecord(table.name, acl));
    }
  }

  // script includes (runtime classes)
  const siDir = join(repoRoot(), "instance", "sn_headless", "script-includes");
  for (const file of readdirSync(siDir).filter((f) => f.endsWith(".js")).sort()) {
    const className = file.slice(0, -3);
    out.push(
      rec(
        "sys_script_include",
        sysId("sys_script_include", className),
        [
          ["name", className],
          ["script", readFileSync(join(siDir, file), "utf8")],
          ["client_callable", "false"],
          ["access", "package_private"],
          ["active", "true"],
          ["api_name", `sn_headless.${className}`],
        ],
      ),
    );
  }

  // scripted REST API root + operations
  const apiId = sysId("sys_script", manifest.scope);
  const apiScript =
    `(function process(request, response) {\n` +
    `  var api = {};\n` +
    manifest.resources
      .map((r) => `  api.${r.name} = function(request, response) { return {}; };`)
      .join("\n") +
    `\n  return api;\n})(request, response);`;
  out.push(
    rec("sys_script", apiId, [
      ["name", manifest.scope],
      ["script", apiScript],
      ["category", "api"],
      ["active", "true"],
    ]),
  );
  for (const resource of manifest.resources) {
    const file = readFileSync(
      join(repoRoot(), "instance", "sn_headless", resource.scriptFile),
      "utf8",
    );
    out.push(
      rec(
        "sys_ws_operation",
        sysId("sys_ws_operation", `${resource.name}.${resource.httpMethod}`),
        [
          ["name", `${resource.name}_${resource.httpMethod.toLowerCase()}`],
          ["script", file],
          ["http_method", resource.httpMethod],
          ["relative_path", resource.path],
          ["active", "true"],
          ["api_id", apiId],
          ["description", `Open Now ${resource.name} operation`],
        ],
      ),
    );
  }

  // seed: skill registry rows + discover index terms from the catalog
  const docsDir = join(repoRoot(), "packages", "skill-docs", "src");
  if (exists(docsDir)) {
    for (const file of readdirSync(docsDir).filter((f) => f.endsWith(".json")).sort()) {
      const doc = JSON.parse(readFileSync(join(docsDir, file), "utf8"));
      const id = doc.id as string;
      out.push(
        rec(
          "sn_headless_skill",
          sysId("sn_headless_skill", id),
          [
            ["id", id],
            ["name", doc.name ?? id],
            ["version", doc.version ?? "1.0.0"],
            ["status", doc.status ?? "ga"],
            ["persona", doc.persona ?? ""],
            ["intent", doc.intent ?? ""],
            ["inputs_json", JSON.stringify(doc.inputs ?? {})],
            ["tables_read", (doc.tablesRead ?? []).join(",")],
            ["tables_written", (doc.tablesWritten ?? []).join(",")],
            ["roles_any_of", (doc.rolesAnyOf ?? []).join(",")],
            ["roles_all_of", (doc.rolesAllOf ?? []).join(",")],
            ["confirmation", doc.confirmation ?? "read"],
            ["procedure", (doc.procedure ?? []).join("\n")],
            ["side_effects", (doc.sideEffects ?? []).join("\n")],
            ["returns_json", JSON.stringify(doc.returns ?? [])],
            ["related_skills", (doc.relatedSkills ?? []).join(",")],
            ["executable", doc.executable?.type ?? "script_include"],
            ["executable_ref", doc.executable?.ref ?? ""],
            ["doc_json", JSON.stringify(doc)],
            ["active", "true"],
            ["doc_version", doc.version ?? "1.0.0"],
          ],
        ),
      );
    }
  }

  out.push("</sys_update_set>");
  out.push("</unload>");
  return out.join("\n");
}

function aclRecord(table: string, acl: AclDef): string {
  const code =
    acl.grant === "true"
      ? "true"
      : acl.grant === "admin"
        ? "gs.hasRole('admin')"
        : acl.grant.startsWith("script:")
          ? acl.grant.slice("script:".length)
          : acl.grant;
  return rec(
    "sys_security_acl",
    sysId("sys_security_acl", `${table}.${acl.operation}`),
    [
      ["name", `${table}_${acl.operation}`],
      ["type", "record"],
      ["operation", acl.operation],
      ["script", code],
      ["active", "true"],
      ["sys_class_name", table],
    ],
  );
}

function f(name: string, value: string): [string, string] {
  return [name, value];
}

function rec(table: string, id: string, fields: Array<[string, string]>): string {
  const body = [`<sys_id>${id}</sys_id>`]
    .concat(fields.map(([k, v]) => `<${k}><![CDATA[${escapeCdata(v)}]]></${k}>`))
    .join("");
  return `<record table="${table}" action="INSERT_OR_UPDATE">${body}</record>`;
}

function sysId(kind: string, name: string): string {
  return createHash("md5").update(`${kind}:${name}`).digest("hex");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCdata(s: string): string {
  return s.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function exists(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

export function buildUpdateSetToFile(outPath?: string): string {
  const xml = buildUpdateSet();
  const target =
    outPath ?? join(repoRoot(), "dist", "sn_headless", "update-set.xml");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, xml);
  return target;
}

if (import.meta.main) {
  const target = buildUpdateSetToFile();
  const kb = Math.round(Buffer.byteLength(readFileSync(target)) / 1024);
  console.log(`wrote ${target} (${kb} KiB)`);
  console.log(
    `records: ${(readFileSync(target, "utf8").match(/<record table="/g) ?? []).length}`,
  );
}
