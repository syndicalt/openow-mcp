/**
 * Adapt sn_headless scripts for a global-scope PDI install.
 *
 * ServiceNow rewrites customer table names in global to u_* and custom
 * columns to u_*. Scoped `sn_headless_*` cannot be created via REST as a
 * web-service user. The kernel path `/api/now/sn_headless` is unchanged.
 *
 * Rhino (Nashorn-era ES5) rejects reserved-word property access (`.default`,
 * `.enum`, `.class`) with `SyntaxError: missing name after . operator`, which
 * silently prevents the Script Include from registering.
 */

export const PHYSICAL_TABLES = {
  sn_headless_skill: "u_sn_headless_skill",
  sn_headless_run: "u_sn_headless_run",
  sn_headless_index: "u_sn_headless_index",
} as const;

/** Custom columns on the three headless tables (not sys_* / incident fields). */
export const HEADLESS_FIELDS = [
  "structured_inputs",
  "executable_ref",
  "related_skills",
  "result_summary",
  "record_numbers",
  "tables_touched",
  "tables_written",
  "skill_version",
  "returns_json",
  "roles_any_of",
  "roles_all_of",
  "tables_read",
  "inputs_json",
  "inputs_hash",
  "request_id",
  "entity_type",
  "entity_id",
  "side_effects",
  "confirmation",
  "client_app",
  "query_hash",
  "doc_version",
  "doc_json",
  "executable",
  "latency_ms",
  "token_app",
  "procedure",
  "skill_id",
  "persona",
  "confirmed",
  "intent",
  "status",
  "weight",
  "active",
  "outcome",
  "version",
  "error",
  "name",
  "term",
  "user",
  "id",
] as const;

const ACCESSORS = ["setValue", "getValue", "addQuery", "addNotNullQuery", "orderBy", "orderByDesc"];

/** ES3 / Java reserved words Rhino will not accept after `.` or as unquoted keys. */
export const RHINO_RESERVED = [
  "default",
  "enum",
  "class",
  "export",
  "import",
  "package",
  "private",
  "public",
  "protected",
  "static",
  "extends",
  "super",
  "throw",
  "catch",
  "finally",
  "delete",
  "function",
  "void",
  "debugger",
  "with",
  "implements",
  "interface",
] as const;

/** Rewrite reserved-word accessors/keys so Rhino will parse the include. */
export function rhinoSafeScript(src: string): string {
  let out = src;
  for (const word of RHINO_RESERVED) {
    out = out.replace(new RegExp(`\\.\\b${word}\\b`, "g"), `['${word}']`);
    out = out.replace(new RegExp(`([,{]\\s*)${word}(\\s*:)`, "g"), `$1'${word}'$2`);
  }
  return out;
}

export function adaptHeadlessScript(
  src: string,
  opts: { rewriteFields?: boolean; qualifyGlobal?: string[] } = {},
): string {
  let out = src;
  for (const [logical, physical] of Object.entries(PHYSICAL_TABLES)) {
    out = out.replaceAll(`'${logical}'`, `'${physical}'`);
    out = out.replaceAll(`"${logical}"`, `"${physical}"`);
  }

  if (opts.rewriteFields) {
    const fields = [...HEADLESS_FIELDS].sort((a, b) => b.length - a.length);
    for (const field of fields) {
      const uField = `u_${field}`;
      for (const acc of ACCESSORS) {
        out = out.replaceAll(`${acc}('${field}'`, `${acc}('${uField}'`);
        out = out.replaceAll(`${acc}("${field}"`, `${acc}("${uField}"`);
      }
    }
  }

  out = out.replace(/\.setBody\(JSON\.stringify\(([\s\S]*?)\)\)/g, ".setBody($1)");

  if (opts.qualifyGlobal) {
    for (const name of opts.qualifyGlobal) {
      out = out.replaceAll(`new ${name}(`, `new global.${name}(`);
    }
  }
  return rhinoSafeScript(out);
}

/** Turn `var X = (function(){ function X(){} ... return X; })();` into a Rhino-safe include. */
export function flattenIifeScriptInclude(name: string, src: string): string {
  if (!src.includes(`var ${name} = (function () {`) && !src.includes(`var ${name} = (function() {`)) {
    return src.replace(
      /\n\s*if \(typeof module !== 'undefined' && module\.exports\) \{ module\.exports = \w+; \}\s*/g,
      "\n",
    );
  }
  let out = src
    .replace(`var ${name} = (function () {`, `var ${name} = function () {};\n(function () {`)
    .replace(`var ${name} = (function() {`, `var ${name} = function () {};\n(function () {`)
    .replace(`function ${name}() {}`, "")
    .replace(`function ${name} () {}`, "")
    .replace(/\n\s*if \(typeof module !== 'undefined' && module\.exports\) \{ module\.exports = \w+; \}\s*/g, "\n");
  out = out.replace(`  return ${name};\n})();`, "})();");
  out = out.replace(`return ${name};\n})();`, "})();");
  return out;
}
