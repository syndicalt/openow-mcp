import { describe, expect, test } from "bun:test";
import { createGeneratedTableTools, createToolkitTools } from "@open-now/mcp-server";
import { MockGateway } from "@open-now/mcp-server";

function gateway() {
  return new MockGateway({
    user: { sys_id: "u_me", name: "Ada", roles: ["itil"] },
    tables: [{ name: "incident", label: "Incident", extends: "task" }],
    schema: { incident: [{ name: "state", label: "State", type: "choice" }] },
    rows: {
      incident: [{ sys_id: "inc_1", number: "INC0010001", state: "1", short_description: "printer on fire" }],
    },
    aggregates: [{ group: "open", value: 3 }],
  });
}

function tool(tools: ReturnType<typeof createToolkitTools>, name: string) {
  const hit = tools.find((t) => t.name === name);
  expect(hit, `tool ${name} exists`).toBeDefined();
  return hit!;
}

describe("generic toolkit tools", () => {
  const gw = gateway();
  const tools = createToolkitTools(gw);
  const sess = { sessionId: "tk-session" };

  test("exposes the full generic surface (10 tools)", () => {
    expect(tools.length).toBe(10);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "aggregate_report",
      "attachment_add",
      "attachment_list",
      "record_create",
      "record_delete",
      "record_get",
      "record_update",
      "run_script",
      "table_list",
      "table_schema",
    ]);
  });

  test("table_list and record_get are read-only and return data", async () => {
    const list = await tool(tools, "table_list").handler({}, sess.sessionId);
    expect(list.ok).toBe(true);
    expect(list.text).toContain("incident");

    const get = await tool(tools, "record_get").handler(
      { table: "incident", number: "INC0010001" },
      sess.sessionId,
    );
    expect(get.ok).toBe(true);
    expect(get.text).toContain("INC0010001");
    expect(get.text).toContain("state");
  });

  test("record_create drafts first, then applies once per requestId", async () => {
    const requestId = "tk-create-1";
    const pending = await tool(tools, "record_create").handler(
      { table: "incident", values: { state: "1" }, requestId },
      sess.sessionId,
    );
    expect(pending.text).toContain("Pending confirmation");
    expect(pending.text).toContain("Draft");
    expect(gw.applyCount).toBe(0);

    const applied = await tool(tools, "record_create").handler(
      { table: "incident", values: { state: "1" }, requestId, confirm: true },
      sess.sessionId,
    );
    expect(applied.text).toContain("Applied");
    expect(gw.applyCount).toBe(1);

    const again = await tool(tools, "record_create").handler(
      { table: "incident", values: { state: "1" }, requestId, confirm: true },
      sess.sessionId,
    );
    expect(again.ok).toBe(true);
    expect(gw.applyCount).toBe(1);
  });

  test("record_delete is restricted: pending until confirmed, never silent", async () => {
    const before = gw.applyCount;
    const pending = await tool(tools, "record_delete").handler(
      { table: "incident", number: "INC0010001", requestId: "tk-del-1" },
      sess.sessionId,
    );
    expect(pending.text).toContain("Deletes require confirmation");
    expect(gw.applyCount).toBe(before);

    const applied = await tool(tools, "record_delete").handler(
      { table: "incident", number: "INC0010001", requestId: "tk-del-1", confirm: true },
      sess.sessionId,
    );
    expect(applied.text).toContain("Applied");
    expect(gw.applyCount).toBe(before + 1);
  });

  test("run_script returns the evaluated result", async () => {
    const res = await tool(tools, "run_script").handler({ script: "1+1" }, sess.sessionId);
    expect(res.ok).toBe(true);
    expect(res.text).toContain("mock:");
  });

  test("restricted tables deny without role before reading", async () => {
    const gw2 = gateway();
    const res = await createToolkitTools(gw2)
      .find((t) => t.name === "record_get")!
      .handler({ table: "hr_case", number: "HRC0010001" }, sess.sessionId);
    expect(res.ok).toBe(true);
    expect(res.text).toContain("Denied");
  });

  test("generated per-table surface has 5 tools per table and routes correctly", async () => {
    const gen = createGeneratedTableTools(gw, ["incident"]);
    expect(gen.map((t) => t.name).sort()).toEqual([
      "tbl_incident_create",
      "tbl_incident_delete",
      "tbl_incident_get",
      "tbl_incident_query",
      "tbl_incident_update",
    ]);

    const q = await gen.find((t) => t.name === "tbl_incident_query")!.handler(
      { query: "state=1", limit: 25 },
      sess.sessionId,
    );
    expect(q.ok).toBe(true);
    expect(q.text).toContain("INC0010001");

    const get = await gen.find((t) => t.name === "tbl_incident_get")!.handler(
      { number: "INC0010001" },
      sess.sessionId,
    );
    expect(get.ok).toBe(true);
    expect(get.text).toContain("INC0010001");
  });
});
