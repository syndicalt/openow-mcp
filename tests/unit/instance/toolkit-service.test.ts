import { beforeAll, describe, expect, test } from "bun:test";
import { installShim, type ShimState } from "../helpers/glide-shim.js";
import { installAllScriptIncludes } from "./load-script-includes.js";

let state: ShimState;
let Toolkit: new () => { invoke: (req: Record<string, unknown>) => Record<string, unknown> };

beforeAll(() => {
  state = installShim({
    user: { sys_id: "u_me", name: "Ada", roles: ["itil"] },
    records: {
      incident: [
        { sys_id: "inc_1", number: "INC0010001", state: "1", short_description: "printer on fire" },
      ],
      hr_case: [{ sys_id: "hr_1", number: "HRC0010001", state: "new", topic: "benefits" }],
      sys_db_object: [
        { sys_id: "dbo_1", name: "incident", label: "Incident" },
        { sys_id: "dbo_2", name: "hr_case", label: "HR Case" },
      ],
      sys_dictionary: [
        { sys_id: "d1", name: "incident", element: "state", label: "State", type: "choice", active: true },
        { sys_id: "d2", name: "incident", element: "short_description", label: "Short Description", type: "string", active: true },
        { sys_id: "d3", name: "incident", element: "number", label: "Number", type: "string", active: true },
      ],
      sys_attachment: [],
      sn_headless_run: [],
    },
  });
  installAllScriptIncludes();
  Toolkit = (globalThis as Record<string, unknown>).ToolkitService as typeof Toolkit;
});

function call(req: Record<string, unknown>) {
  return new Toolkit().invoke(req);
}

describe("ToolkitService (instance runtime via shim)", () => {
  test("table_list and table_schema read metadata", () => {
    const list = call({ op: "table_list", args: {}, clientApp: "test" });
    expect(list.outcome).toBe("ok");
    expect(JSON.stringify(list.focusedPayload)).toContain("incident");

    const schema = call({ op: "table_schema", args: { table: "incident" }, clientApp: "test" });
    expect(schema.outcome).toBe("ok");
    const fields = (schema.focusedPayload as { fields: Array<{ name: string }> }).fields;
    expect(fields.some((f) => f.name === "state")).toBe(true);
  });

  test("record_get returns the record with its fields", () => {
    const res = call({ op: "record_get", args: { table: "incident", number: "INC0010001" }, clientApp: "test" });
    expect(res.outcome).toBe("ok");
    const record = (res.focusedPayload as { record: Record<string, unknown> }).record;
    expect(record.number).toBe("INC0010001");
  });

  test("record_update diffs first, applies exactly once, replays", () => {
    const pending = call({
      op: "record_update",
      args: { table: "incident", number: "INC0010001", values: { state: "2" } },
      clientApp: "test",
      requestId: "tk-upd-1",
    });
    expect(pending.outcome).toBe("pending");
    expect((pending.diff as Array<{ field: string }>)[0]?.field).toBe("state");
    expect(state.updateLog.length).toBe(0);

    const applied = call({
      op: "record_update",
      args: { table: "incident", number: "INC0010001", values: { state: "2" } },
      clientApp: "test",
      requestId: "tk-upd-1",
      confirm: true,
    });
    expect(applied.outcome).toBe("applied");
    expect((applied.focusedPayload as { record: string }).record).toBe("INC0010001");

    const replay = call({
      op: "record_update",
      args: { table: "incident", number: "INC0010001", values: { state: "2" } },
      clientApp: "test",
      requestId: "tk-upd-1",
      confirm: true,
    });
    expect(replay.outcome).toBe("applied");
    expect(state.updateLog.filter((u) => u.table === "incident").length).toBe(1);
  });

  test("record_delete is restricted: pending until confirmed, then deleted", () => {
    const pending = call({ op: "record_delete", args: { table: "incident", number: "INC0010001" }, clientApp: "test" });
    expect(pending.outcome).toBe("pending");
    expect(pending.confirmation).toBe("restricted");

    const applied = call({ op: "record_delete", args: { table: "incident", number: "INC0010001" }, clientApp: "test", confirm: true });
    expect(applied.outcome).toBe("applied");
    expect((applied.focusedPayload as { deleted: boolean }).deleted).toBe(true);
  });

  test("record_create inserts via the platform (draft -> applied)", () => {
    const pending = call({ op: "record_create", args: { table: "incident", values: { state: "1" } }, clientApp: "test" });
    expect(pending.outcome).toBe("pending");
    expect((pending.draft as { summary: string }).summary).toContain("Create incident");
    expect(state.insertLog.filter((l) => l.table === "incident").length).toBe(0);

    const applied = call({ op: "record_create", args: { table: "incident", values: { state: "1" } }, clientApp: "test", confirm: true });
    expect(applied.outcome).toBe("applied");
    expect(state.insertLog.filter((l) => l.table === "incident").length).toBe(1);
  });

  test("run_script evals in the scoped runtime", () => {
    const res = call({ op: "run_script", args: { script: "1 + 1" }, clientApp: "test" });
    expect(res.outcome).toBe("ok");
    expect((res.focusedPayload as { result: string }).result).toBe("2");
  });

  test("restricted tables deny without role", () => {
    const res = call({ op: "record_get", args: { table: "hr_case", number: "HRC0010001" }, clientApp: "test" });
    expect(res.outcome).toBe("denied");
    expect(String(res.message)).toContain("hr_case");
  });

  test("unknown op is unsupported", () => {
    const res = call({ op: "nope", args: {}, clientApp: "test" });
    expect(res.outcome).toBe("unsupported");
  });
});
