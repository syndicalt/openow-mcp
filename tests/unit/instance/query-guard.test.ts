import { beforeAll, describe, expect, test } from "bun:test";
import { installShim } from "../helpers/glide-shim.js";
import { loadScriptInclude } from "./load-script-includes.js";

let QueryGuard: new () => { parse: (raw: string, opts?: Record<string, unknown>) => Record<string, unknown> };

beforeAll(() => {
  installShim();
  QueryGuard = loadScriptInclude("QueryGuard") as typeof QueryGuard;
});

describe("QueryGuard encoded-query hygiene (spec §4.3)", () => {
  const qg = () => new QueryGuard();

  test("allowlisted operators pass through normalized", () => {
    const r = qg().parse("state=open^priority=1", {});
    expect(r.rejected).toBeNull();
    expect(r.query).toContain("state");
    expect((r as Record<string, unknown>).hash).toMatch(/^[0-9a-f]{8}$/);
  });

  test("rejects JS: expressions", () => {
    const r = qg().parse("JS:gs.getProperty('x')", {});
    expect(r.rejected).toContain("JS:");
  });

  test("rejects GOTO", () => {
    expect(qg().parse("GOTO", {}).rejected).toContain("GOTO");
  });

  test("rejects unbalanced parentheses", () => {
    expect(qg().parse("((state=open", {}).rejected).toContain("parenthes");
  });

  test("rejects unknown operators (fallback equality only)", () => {
    const r = qg().parse("state MATCHES open", {});
    expect(r.rejected).toContain("unparseable");
  });

  test("enforces field allowlists", () => {
    const r = qg().parse("priority=1", { fieldAllowlist: ["state"] });
    expect(r.rejected).toContain("priority");
  });

  test("caps result windows (25 default, 100 hard max)", () => {
    expect(qg().parse("state=open", {}).limit).toBe(25);
    expect(qg().parse("state=open", { limit: 500 }).limit).toBe(100);
    expect(qg().parse("state=open", { limit: 0 }).limit).toBe(1);
  });

  test("hash is deterministic per normalized query", () => {
    expect(qg().parse("state=open", {}).hash).toBe(qg().parse("state=open", {}).hash);
    expect(qg().parse("state=open", {}).hash).not.toBe(qg().parse("state=closed", {}).hash);
  });

  test("empty query is valid and capped", () => {
    const r = qg().parse("", {});
    expect(r.rejected).toBeNull();
    expect(r.query).toBe("");
  });
});
