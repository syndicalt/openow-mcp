import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SI_DIR = join(import.meta.dir, "..", "..", "..", "instance", "sn_headless", "script-includes");

export const SCRIPT_INCLUDE_FILES = readdirSync(SI_DIR)
  .filter((f) => f.endsWith(".js"))
  .sort();

/**
 * Loads a scoped-app Script Include as CommonJS. The source uses free
 * ServiceNow globals (gs, GlideRecordSecure, ...); we inject deterministic
 * shim values as function parameters so SIs work under Bun without touching
 * real globals (tests may also installShim() for the global path).
 */
export function loadScriptInclude(
  name: string,
  env?: Record<string, unknown>,
): unknown {
  const file = join(SI_DIR, `${name}.js`);
  const code = readFileSync(file, "utf8");
  const module = { exports: {} as Record<string, unknown> };
  const params = [
    "module",
    "exports",
    "require",
    "gs",
    "GlideRecordSecure",
    "GlideRecord",
    "GlideAggregate",
    "GlideDateTime",
    "GlideSysId",
  ];
  const g = globalThis as Record<string, unknown>;
  const args: unknown[] = [
    module,
    module.exports,
    require,
    env?.gs ?? g.gs,
    env?.GlideRecordSecure ?? g.GlideRecordSecure,
    env?.GlideRecordSecure ?? g.GlideRecordSecure,
    env?.GlideAggregate ?? g.GlideAggregate,
    env?.GlideDateTime ?? g.GlideDateTime,
    env?.GlideSysId ?? g.GlideSysId,
  ];
  const fn = new Function(...params, `"use strict";\n${code}`);
  fn(...args);
  return module.exports;
}

/** Loads every SI and registers classes on globalThis (SkillRuntime looks them up there). */
export function installAllScriptIncludes(
  env: Record<string, unknown> = {},
): Record<string, unknown> {
  const registry: Record<string, unknown> = {};
  for (const file of SCRIPT_INCLUDE_FILES) {
    const name = file.slice(0, -3);
    const cls = loadScriptInclude(name, env);
    registry[name] = cls;
    (globalThis as Record<string, unknown>)[name] = cls;
  }
  return registry;
}
