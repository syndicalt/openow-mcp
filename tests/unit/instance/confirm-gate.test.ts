import { beforeAll, describe, expect, test } from "bun:test";
import { installShim } from "../helpers/glide-shim.js";
import { loadScriptInclude } from "./load-script-includes.js";

let ConfirmGate: new () => {
  shouldConfirm: (
    confirmation: string,
    req: { confirm?: boolean },
    owned?: boolean,
    policy?: Record<string, unknown>,
  ) => boolean;
  buildDiff: (record: { getValue: (f: string) => unknown }, proposed: Record<string, unknown>) => Array<Record<string, unknown>>;
  buildDraft: (summary: string, fields: Record<string, unknown>) => Record<string, unknown>;
  replay: (storedRun: Record<string, unknown> | null) => Record<string, unknown> | null;
};

beforeAll(() => {
  installShim();
  ConfirmGate = loadScriptInclude("ConfirmGate") as typeof ConfirmGate;
});

describe("ConfirmGate confirmation policy (spec §4.4)", () => {
  const gate = () => new ConfirmGate();

  test("read never confirms; every write class does", () => {
    expect(gate().shouldConfirm("read", {})).toBe(false);
    for (const cls of ["update_shared", "create", "approve", "execute", "deploy", "restricted"]) {
      expect(gate().shouldConfirm(cls, {}), cls).toBe(true);
    }
  });

  test("update_owned auto-applies only when policy allows and the caller owns the record", () => {
    expect(gate().shouldConfirm("update_owned", {}, false, { autoApply: true })).toBe(true);
    expect(gate().shouldConfirm("update_owned", {}, true, {})).toBe(true);
    expect(gate().shouldConfirm("update_owned", {}, true, { autoApply: true })).toBe(false);
  });

  test("buildDiff compares current vs proposed and skips no-op fields", () => {
    const diff = gate().buildDiff(
      { getValue: (f: string) => (f === "priority" ? "3" : "old") },
      { priority: "3", state: "new" },
    );
    expect(diff.length).toBe(1);
    expect(diff[0]?.field).toBe("state");
    expect(diff[0]?.before).toBe("old");
    expect(diff[0]?.after).toBe("new");
  });

  test("buildDraft yields a summary + fields", () => {
    const draft = gate().buildDraft("Create incident", { short_description: "x" });
    expect(draft.summary).toBe("Create incident");
    expect(draft.fields).toEqual({ short_description: "x" });
  });

  test("replay echoes a settled run only", () => {
    const run = gate().replay({
      outcome: "applied",
      sysId: "audit_1",
      resultSummary: JSON.stringify({ number: "INC0010001" }),
    });
    expect(run?.replayed).toBe(true);
    expect(run?.outcome).toBe("applied");
    expect(run?.focusedPayload).toEqual({ number: "INC0010001" });
    expect(gate().replay(null)).toBeNull();
  });
});
