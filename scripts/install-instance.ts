#!/usr/bin/env bun
/**
 * REST installer for sn_headless on a PDI / subprod.
 *
 * Web-service-only admins cannot use xmlimport.do (UI). This talks Table API
 * with HTTP Basic (SNOW_USER + SNOW_PASSWORD) or a bearer token.
 *
 * Global-scope constraint: ServiceNow rewrites sn_* table names to u_sn_*
 * and custom columns to u_*. Scripts are adapted (see headless-adapt.ts).
 * The Scripted REST API is registered at /api/now/sn_headless so the kernel
 * path does not change.
 *
 * Usage:
 *   SNOW_INSTANCE=https://devXXXXXX.service-now.com \
 *   SNOW_USER=... SNOW_PASSWORD=... \
 *   bun run install:instance
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allSkillDocs } from "@open-now/skill-docs";
import { loadManifest } from "./build-app";
import { adaptHeadlessScript, flattenIifeScriptInclude, PHYSICAL_TABLES } from "./headless-adapt";

const repoRoot = join(import.meta.dir, "..");

interface SnError {
  error?: { message?: string; detail?: string };
  result?: Record<string, unknown>;
}

class Snow {
  constructor(
    readonly base: string,
    private readonly auth: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: this.auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  async get<T = Record<string, unknown>>(table: string, query: string, fields?: string): Promise<T[]> {
    const params = new URLSearchParams({ sysparm_query: query, sysparm_limit: "50" });
    if (fields) params.set("sysparm_fields", fields);
    const res = await fetch(`${this.base}/api/now/table/${table}?${params}`, { headers: this.headers() });
    const body = (await res.json()) as { result?: T[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${body.error?.message ?? ""}`);
    return body.result ?? [];
  }

  async post(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}/api/now/table/${table}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    const body = (await res.json()) as SnError;
    if (!res.ok) {
      throw new Error(`POST ${table}: ${res.status} ${body.error?.message ?? ""} ${body.error?.detail ?? ""}`);
    }
    return (body.result ?? {}) as Record<string, unknown>;
  }

  async patch(table: string, sysId: string, data: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.base}/api/now/table/${table}/${sysId}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json()) as SnError;
      throw new Error(`PATCH ${table}/${sysId}: ${res.status} ${body.error?.message ?? ""}`);
    }
  }

  async del(table: string, sysId: string): Promise<void> {
    await fetch(`${this.base}/api/now/table/${table}/${sysId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
  }
}

function authHeader(): string {
  const user = process.env.SNOW_USER;
  const password = process.env.SNOW_PASSWORD;
  if (user && password) {
    return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }
  const token = process.env.SNOW_ACCESS_TOKEN ?? process.env.OPEN_NOW_ACCESS_TOKEN;
  if (!token) {
    throw new Error("SNOW_USER+SNOW_PASSWORD or SNOW_ACCESS_TOKEN is required");
  }
  return `Bearer ${token}`;
}

function internalType(type: string): { internal_type: string; max_length?: string; reference?: string } {
  switch (type) {
    case "integer":
      return { internal_type: "integer" };
    case "boolean":
      return { internal_type: "boolean" };
    case "reference":
      return { internal_type: "reference" };
    case "json":
    case "text":
      return { internal_type: "string", max_length: "8000" };
    default:
      return { internal_type: "string" };
  }
}

async function ensureTable(sn: Snow, logical: keyof typeof PHYSICAL_TABLES, label: string): Promise<string> {
  const physical = PHYSICAL_TABLES[logical];
  const existing = await sn.get("sys_db_object", `name=${physical}`, "sys_id,name");
  if (existing[0]?.sys_id) {
    console.log(`  table ${physical} exists`);
    return String(existing[0].sys_id);
  }
  const created = await sn.post("sys_db_object", {
    name: logical,
    label,
    access: "public",
    create_access_controls: "true",
  });
  const name = String(created.name ?? physical);
  console.log(`  table ${logical} -> ${name}`);
  if (name !== physical) {
    console.warn(`  warning: expected ${physical}, got ${name}`);
  }
  return String(created.sys_id);
}

async function ensureColumn(
  sn: Snow,
  table: string,
  element: string,
  label: string,
  type: string,
  extra?: { max_length?: number; reference_table?: string },
): Promise<void> {
  const physical = `u_${element}`;
  const existing = await sn.get("sys_dictionary", `name=${table}^element=${physical}`, "sys_id,element");
  if (existing[0]) return;
  const t = internalType(type);
  const body: Record<string, unknown> = {
    name: table,
    element,
    column_label: label,
    internal_type: t.internal_type,
    active: "true",
  };
  if (extra?.max_length) body.max_length = String(extra.max_length);
  else if (t.max_length) body.max_length = t.max_length;
  if (extra?.reference_table) body.reference = extra.reference_table;
  const created = await sn.post("sys_dictionary", body);
  console.log(`    column ${table}.${String(created.element ?? physical)}`);
}

async function ensureChoice(sn: Snow, table: string, element: string, value: string): Promise<void> {
  const physical = `u_${element}`;
  const existing = await sn.get("sys_choice", `name=${table}^element=${physical}^value=${value}`, "sys_id");
  if (existing[0]) return;
  await sn.post("sys_choice", {
    name: table,
    element: physical,
    value,
    label: value,
    inactive: "false",
    language: "en",
  });
}

async function ensureScriptInclude(sn: Snow, className: string, script: string): Promise<void> {
  const existing = await sn.get("sys_script_include", `name=${className}^sys_scope=global`, "sys_id");
  const body = {
    name: className,
    script,
    access: "public",
    client_callable: "false",
    active: "true",
    api_name: `global.${className}`,
  };
  if (existing[0]?.sys_id) {
    await sn.patch("sys_script_include", String(existing[0].sys_id), { script, active: "true", access: "public" });
    console.log(`  script include ${className} updated`);
    return;
  }
  await sn.post("sys_script_include", body);
  console.log(`  script include ${className} created`);
}

async function ensureRestApi(sn: Snow): Promise<string> {
  const existing = await sn.get("sys_ws_definition", "service_id=sn_headless", "sys_id,base_uri");
  if (existing[0]?.sys_id) {
    console.log(`  REST API exists ${existing[0].base_uri ?? ""}`);
    return String(existing[0].sys_id);
  }
  const created = await sn.post("sys_ws_definition", {
    name: "Open Now Headless",
    service_id: "sn_headless",
    namespace: "now",
    active: "true",
    is_versioned: "false",
    consumes: "application/json",
    produces: "application/json",
    short_description: "Open Now skill runtime — discover / describe / dispatch as the invoking user",
  });
  console.log(`  REST API ${created.base_uri ?? created.sys_id}`);
  return String(created.sys_id);
}

async function ensureOperation(
  sn: Snow,
  apiId: string,
  name: string,
  method: string,
  path: string,
  script: string,
): Promise<void> {
  const relative = path.startsWith("/") ? path : `/${path}`;
  const existing = await sn.get(
    "sys_ws_operation",
    `web_service_definition=${apiId}^http_method=${method}^relative_path=${relative}`,
    "sys_id",
  );
  const body = {
    name,
    http_method: method,
    relative_path: relative,
    operation_script: script,
    active: "true",
    web_service_definition: apiId,
    requires_acl_authorization: "false",
  };
  if (existing[0]?.sys_id) {
    await sn.patch("sys_ws_operation", String(existing[0].sys_id), {
      operation_script: script,
      active: "true",
      requires_acl_authorization: "false",
    });
    console.log(`  op ${method} ${relative} updated`);
    return;
  }
  await sn.post("sys_ws_operation", body);
  console.log(`  op ${method} ${relative} created`);
}

async function seedSkills(sn: Snow): Promise<void> {
  const table = PHYSICAL_TABLES.sn_headless_skill;
  const existingSkills = await sn.get(table, "u_active=true", "sys_id,u_id");
  if (existingSkills.length >= 30 && !process.env.OPEN_NOW_RESEED) {
    console.log(`  catalog already has ${existingSkills.length} skills (set OPEN_NOW_RESEED=1 to replace)`);
    return;
  }
  const index = PHYSICAL_TABLES.sn_headless_index;
  let upserts = 0;
  for (const doc of allSkillDocs) {
    const row: Record<string, unknown> = {
      u_id: doc.id,
      u_name: doc.name ?? doc.id,
      u_version: doc.version ?? "1.0.0",
      u_status: doc.status ?? "ga",
      u_persona: doc.persona ?? "",
      u_intent: doc.intent ?? "",
      u_inputs_json: JSON.stringify(doc.inputs ?? {}),
      u_tables_read: (doc.tablesRead ?? []).join(","),
      u_tables_written: (doc.tablesWritten ?? []).join(","),
      u_roles_any_of: (doc.rolesAnyOf ?? []).join(","),
      u_roles_all_of: (doc.rolesAllOf ?? []).join(","),
      u_confirmation: doc.confirmation ?? "read",
      u_procedure: (doc.procedure ?? []).join("\n"),
      u_side_effects: (doc.sideEffects ?? []).join("\n"),
      u_returns_json: JSON.stringify(doc.returns ?? []),
      u_related_skills: (doc.relatedSkills ?? []).join(","),
      u_executable: doc.executable?.type ?? "script_include",
      u_executable_ref: doc.executable?.ref ?? "",
      u_doc_json: JSON.stringify(doc),
      u_active: true,
      u_doc_version: doc.version ?? "1.0.0",
    };
    const found = await sn.get(table, `u_id=${doc.id}`, "sys_id");
    if (found[0]?.sys_id) await sn.patch(table, String(found[0].sys_id), row);
    else await sn.post(table, row);
    upserts++;

    const terms = Array.from(
      new Set(
        [doc.id, doc.name, doc.intent, ...(doc.procedure ?? [])]
          .join(" ")
          .toLowerCase()
          .split(/[^a-z0-9.]+/)
          .filter((t) => t.length > 2)
          .slice(0, 8),
      ),
    );
    for (const term of terms) {
      const idx = await sn.get(index, `u_entity_id=${doc.id}^u_term=${term}`, "sys_id");
      if (idx[0]) continue;
      await sn.post(index, {
        u_entity_type: "skill",
        u_entity_id: doc.id,
        u_term: term,
        u_weight: 1,
      });
    }
  }
  console.log(`  seeded ${upserts} skills`);
}

async function cleanupProbes(sn: Snow): Promise<void> {
  for (const name of ["u_open_now_probe", "u_skill"]) {
    const rows = await sn.get("sys_db_object", `name=${name}`, "sys_id");
    for (const r of rows) {
      if (r.sys_id) await sn.del("sys_db_object", String(r.sys_id));
    }
  }
  for (const name of ["OpenNowRuntime", "OpenNowDispatch"]) {
    const rows = await sn.get("sys_script_include", `name=${name}^sys_scope=global`, "sys_id");
    for (const r of rows) {
      if (r.sys_id) {
        await sn.del("sys_script_include", String(r.sys_id));
        console.log(`  removed debug include ${name}`);
      }
    }
  }
}

async function smokeDiscover(sn: Snow): Promise<void> {
  const url = `${sn.base}/api/now/sn_headless/discover?q=${encodeURIComponent("cannot send email")}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  const text = await res.text();
  console.log(`  GET discover -> ${res.status} ${text.slice(0, 240).replace(/\s+/g, " ")}`);
  if (!res.ok) throw new Error(`discover smoke failed: ${res.status}`);
  let body: { result?: { results?: Array<{ id?: string }>; error?: string }; results?: Array<{ id?: string }>; error?: string };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error(`discover smoke: not JSON: ${text.slice(0, 200)}`);
  }
  const payload = body.result ?? body;
  if (payload.error) throw new Error(`discover smoke error: ${payload.error}`);
  const results = payload.results ?? [];
  if (results.length === 0) {
    throw new Error("discover smoke returned no results");
  }
  console.log(`  discover ${results.length} hits, top=${results[0]?.id ?? "?"}`);
}

async function main(): Promise<void> {
  const instance = (process.env.SNOW_INSTANCE ?? process.env.OPEN_NOW_INSTANCE_URL ?? "").replace(/\/$/, "");
  if (!instance) throw new Error("SNOW_INSTANCE is required");
  const sn = new Snow(instance, authHeader());
  const manifest = loadManifest();

  console.log(`installing sn_headless on ${instance}`);
  await cleanupProbes(sn);

  console.log("tables");
  for (const table of manifest.tables) {
    const logical = table.name as keyof typeof PHYSICAL_TABLES;
    if (!PHYSICAL_TABLES[logical]) throw new Error(`unknown table ${table.name}`);
    const physical = PHYSICAL_TABLES[logical];
    await ensureTable(sn, logical, table.label);
    for (const field of table.fields) {
      await ensureColumn(sn, physical, field.name, field.label, field.type, {
        max_length: field.max_length,
        reference_table: field.reference_table,
      });
      for (const value of field.choice_values ?? []) {
        await ensureChoice(sn, physical, field.name, value);
      }
    }
  }

  console.log("script includes");
  const siDir = join(repoRoot, "instance/sn_headless/script-includes");
  for (const file of readdirSync(siDir).filter((f) => f.endsWith(".js")).sort()) {
    const className = file.slice(0, -3);
    const script = flattenIifeScriptInclude(
      className,
      adaptHeadlessScript(readFileSync(join(siDir, file), "utf8"), {
        rewriteFields: className === "Audit" || className === "SkillRuntime",
      }),
    );
    await ensureScriptInclude(sn, className, script);
  }

  console.log("scripted REST");
  const apiId = await ensureRestApi(sn);
  for (const resource of manifest.resources) {
    const script = adaptHeadlessScript(
      readFileSync(join(repoRoot, "instance/sn_headless", resource.scriptFile), "utf8"),
      { rewriteFields: true },
    );
    await ensureOperation(sn, apiId, resource.name, resource.httpMethod, resource.path, script);
  }

  console.log("catalog");
  await seedSkills(sn);

  console.log("smoke");
  await smokeDiscover(sn);
  console.log("done");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
