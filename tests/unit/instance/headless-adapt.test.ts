import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adaptHeadlessScript, flattenIifeScriptInclude, rhinoSafeScript } from "../../../scripts/headless-adapt";

describe("adaptHeadlessScript", () => {
  test("rewrites headless tables and fields", () => {
    const src = `
      var gr = new GlideRecordSecure('sn_headless_skill');
      gr.addQuery('id', id);
      gr.addQuery('active', true);
      response.setBody(JSON.stringify({ results: results.results }));
    `;
    const out = adaptHeadlessScript(src, { rewriteFields: true });
    expect(out).toContain("GlideRecordSecure('u_sn_headless_skill')");
    expect(out).toContain("addQuery('u_id'");
    expect(out).toContain("addQuery('u_active'");
    expect(out).toContain("response.setBody({ results: results.results })");
    expect(out).not.toContain("JSON.stringify");
  });

  test("leaves incident accessors alone in exec scripts", () => {
    const src = `
      var inc = new GlideRecordSecure('incident');
      inc.addQuery('active', true);
      inc.setValue('state', '6');
    `;
    const out = adaptHeadlessScript(src);
    expect(out).toContain("inc.addQuery('active', true)");
    expect(out).toContain("inc.setValue('state', '6')");
  });
});

describe("rhinoSafeScript", () => {
  test("rewrites reserved-word accessors and keys", () => {
    const src = `
      if (s.default !== undefined) { values[name] = s.default; }
      if (spec.enum && spec.enum.indexOf(v) < 0) { return spec.enum.join(','); }
      var node = { sys_id: id, class: rec.class };
    `;
    const out = rhinoSafeScript(src);
    expect(out).toContain("s['default']");
    expect(out).toContain("spec['enum']");
    expect(out).toContain("'class': rec['class']");
    expect(out).not.toMatch(/\.default\b/);
    expect(out).not.toMatch(/\.enum\b/);
    expect(out).not.toMatch(/\.class\b/);
  });

  test("adapted SkillRuntime has no Rhino-illegal accessors", () => {
    const src = readFileSync(
      join(import.meta.dir, "../../../instance/sn_headless/script-includes/SkillRuntime.js"),
      "utf8",
    );
    const out = flattenIifeScriptInclude("SkillRuntime", adaptHeadlessScript(src, { rewriteFields: true }));
    expect(out).not.toMatch(/\.default\b/);
    expect(out).not.toMatch(/\.enum\b/);
    expect(out).toContain("var SkillRuntime = function () {};");
  });
});

describe("flattenIifeScriptInclude", () => {
  test("exposes the constructor as var X = function () {}", () => {
    const src = `var SkillRuntime = (function () {
  function SkillRuntime() {}
  SkillRuntime.prototype.discover = function () { return { results: [] }; };
  if (typeof module !== 'undefined' && module.exports) { module.exports = SkillRuntime; }
  return SkillRuntime;
})();
`;
    const out = flattenIifeScriptInclude("SkillRuntime", src);
    expect(out).toContain("var SkillRuntime = function () {};");
    expect(out).not.toContain("return SkillRuntime;");
    expect(out).toContain("SkillRuntime.prototype.discover");
  });
});
