import { describe, expect, test } from "bun:test";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { buildUpdateSet, buildUpdateSetToFile, loadManifest } from "../../../scripts/build-app.js";

const manifest = loadManifest();

function count(xml: string): number {
  return (xml.match(/<record table="/g) ?? []).length;
}

describe("update-set builder", () => {
  test("emits all tables, resources, and script includes from the manifest", () => {
    const xml = buildUpdateSet();
    for (const table of manifest.tables) {
      expect(xml).toContain(`<record table="sys_db_object"`);
      expect(xml).toContain(`<![CDATA[${table.name}]]>`);
    }
    for (const resource of manifest.resources) {
      expect(xml).toContain(`<relative_path><![CDATA[${resource.path}]]></relative_path>`);
    }
    // every SI + REST file present in the build (Exec* appear once they exist)
    expect(xml).toContain("<record table=\"sys_script_include\"");
    for (const name of ["SkillRuntime", "QueryGuard", "RecordResolver", "ConfirmGate"]) {
      expect(xml).toContain(name);
    }
    expect(xml).toContain('<record table="sys_script"');
    expect(xml).toContain("sn_headless");
  });

  test("every open record has a matching close (structural balance)", () => {
    const xml = buildUpdateSet();
    expect(count(xml)).toBe((xml.match(/<\/record>/g) ?? []).length);
    expect(count(xml)).toBeGreaterThan(0);
  });

  test("seeds one sn_headless_skill row per catalog doc (32 valid docs)", () => {
    const xml = buildUpdateSet();
    const seeds = (xml.match(/<record table="sn_headless_skill"/g) ?? []).length;
    expect(seeds).toBe(32);
  });

  test("escapes XML text (no bare ampersands outside CDATA)", () => {
    const xml = buildUpdateSet();
    const nonCdata = xml.replace(/<!\[CDATA\[.*?\]\]>/gs, "");
    const bad = nonCdata.match(/&(?!amp;|lt;|gt;|quot;|#\d+;|apos;)/g);
    expect(bad).toBeNull();
  });

  test("writes the update set to disk and reports a readable size", () => {
    const target = join(tmpdir(), "open-now-build-test", "update-set.xml");
    mkdirSync(dirname(target), { recursive: true });
    const written = buildUpdateSetToFile(target);
    expect(written).toBe(target);
    expect(readFileSync(target, "utf8").startsWith("<?xml")).toBe(true);
  });
});
