import { describe, expect, test } from "bun:test";
import { createKernel } from "@open-now/mcp-server";
import { standardMockGateway } from "../../fixtures/gateway/fixtures.js";

const gateway = standardMockGateway();
const kernel = createKernel(gateway, { clientApp: "kernel-tests" });
const session = { sessionId: "test-session" };

describe("kernel dispatch protocol", () => {
  test("write-class dispatch without describe is rejected (policy.requireDescribe)", async () => {
    const res = await kernel.dispatchTool(
      "dispatch",
      { skillId: "sn.itsm.incident.update", inputs: { mode: "resolve", resolution_code: "x", resolution_notes: "y" } },
      session,
    );
    expect(res.ok).toBe(false);
    expect(res.text).toContain("describe sn.itsm.incident.update first");
  });

  test("describe marks the session; dispatch then returns pending", async () => {
    const described = await kernel.dispatchTool("describe", { skillId: "sn.itsm.incident.update" }, session);
    expect(described.ok).toBe(true);

    const res = await kernel.dispatchTool(
      "dispatch",
      {
        skillId: "sn.itsm.incident.update",
        inputs: { mode: "resolve", resolution_code: "x", resolution_notes: "y" },
        requestId: "req-1",
      },
      session,
    );
    expect(res.ok).toBe(true);
    expect((res.data as { outcome: string }).outcome).toBe("pending");
    expect(res.text).toContain("resolution_code");
    expect(res.text).toContain("confirm:true");
  });

  test("confirm with the same requestId applies exactly once", async () => {
    const first = await kernel.dispatchTool(
      "dispatch",
      {
        skillId: "sn.itsm.incident.update",
        inputs: { mode: "work_note", body: "rebooted" },
        requestId: "req-apply",
        confirm: true,
      },
      session,
    );
    expect((first.data as { outcome: string }).outcome).toBe("applied");

    const again = await kernel.dispatchTool(
      "dispatch",
      {
        skillId: "sn.itsm.incident.update",
        inputs: { mode: "work_note", body: "rebooted" },
        requestId: "req-apply",
        confirm: true,
      },
      session,
    );
    expect((again.data as { outcome: string }).outcome).toBe("applied");
    expect(gateway.applyCount).toBe(1);
  });

  test("read-class dispatch never needs confirm and never writes", async () => {
    const res = await kernel.dispatchTool(
      "dispatch",
      { skillId: "sn.me.work", inputs: {} },
      { sessionId: "other-session" },
    );
    expect(res.ok).toBe(true);
    expect((res.data as { outcome: string }).outcome).toBe("ok");
    expect(gateway.applyCount).toBe(1);
  });

  test("dispatch_readonly is dry-run only, even for write-class skills", async () => {
    const res = await kernel.dispatchTool(
      "dispatch_readonly",
      { skillId: "sn.itsm.incident.update", inputs: { mode: "work_note", body: "preview" } },
      { sessionId: "ro-session" },
    );
    expect((res.data as { outcome: string }).outcome).toBe("pending");
    expect(res.text).toContain("Pending confirmation");
    expect(gateway.applyCount).toBe(1);
  });

  test("raw operations bypass describe and return rows", async () => {
    const res = await kernel.dispatchTool(
      "dispatch",
      { skillId: "raw:incident", table: "incident", query: "state=1" },
      { sessionId: "raw-session" },
    );
    expect(res.ok).toBe(true);
    expect(res.text).toContain("INC0010001");
  });

  test("describe of a raw: prefix returns the raw contract", async () => {
    const res = await kernel.dispatchTool("describe", { skillId: "raw:incident" }, session);
    expect(res.ok).toBe(true);
    expect((res.data as { doc: { table: string } }).doc.table).toBe("incident");
  });

  test("discover returns ranked candidates including raw fallback", async () => {
    const res = await kernel.dispatchTool("discover", { q: "what should I work first" }, session);
    expect(res.ok).toBe(true);
    expect(res.text).toContain("sn.me.work");
    expect(res.text).toContain("raw:incident");
  });

  test("role-gated skill denies gracefully without retry", async () => {
    const res = await kernel.dispatchTool(
      "dispatch_readonly",
      { skillId: "sn.hrsd.case.handle", inputs: { case_number: "HRC0010001" } },
      session,
    );
    expect(res.ok).toBe(true);
    expect((res.data as { outcome: string }).outcome).toBe("denied");
    expect(res.text).toContain("Denied");
    expect(res.text).toContain("sn_hr_core.case_writer");
  });

  test("requireDescribe option applies to read-class too", async () => {
    const strict = createKernel(standardMockGateway(), { requireDescribe: true });
    const res = await strict.dispatchTool("dispatch", { skillId: "sn.me.work", inputs: {} }, { sessionId: "s1" });
    expect(res.ok).toBe(false);
    expect(res.text).toContain("describe sn.me.work first");
  });

  test("described state is per session — other sessions still enforce", async () => {
    const okInSession = await kernel.dispatchTool(
      "dispatch",
      { skillId: "sn.itsm.incident.update", inputs: {}, requestId: "req-2" },
      session,
    );
    expect((okInSession.data as { outcome: string }).outcome).toBe("pending");
    const elsewhere = await kernel.dispatchTool(
      "dispatch",
      { skillId: "sn.itsm.incident.update", inputs: {}, requestId: "req-3" },
      { sessionId: "another-session" },
    );
    expect(elsewhere.ok).toBe(false);
  });
});
