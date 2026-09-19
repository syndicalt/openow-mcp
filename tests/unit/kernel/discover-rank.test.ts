import { describe, expect, test } from "bun:test";
import { createKernel, LocalJudgmentClient } from "@open-now/mcp-server";
import { standardMockGateway } from "../../fixtures/gateway/fixtures.js";

describe("kernel discover + judgment", () => {
  test("without judgment, discover text matches the gateway ranking", async () => {
    const kernel = createKernel(standardMockGateway(), { clientApp: "rank-tests" });
    const res = await kernel.dispatchTool("discover", { q: "what should I work first" }, { sessionId: "s" });
    expect(res.ok).toBe(true);
    expect(res.text).toContain("sn.me.work");
    expect(res.text).not.toContain("gate=");
  });

  test("with local judgment, discover annotates gate and still returns candidates", async () => {
    const kernel = createKernel(standardMockGateway(), {
      clientApp: "rank-tests",
      judgment: new LocalJudgmentClient(),
    });
    const res = await kernel.dispatchTool(
      "discover",
      { q: "what should I work first this morning" },
      { sessionId: "s" },
    );
    expect(res.ok).toBe(true);
    expect(res.text).toContain("gate=");
    const data = res.data as { results: Array<{ id: string; gate?: string }> };
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results.some((r) => r.id.startsWith("raw:"))).toBe(true);
  });

  test("pending dispatch is annotated but never auto-applied", async () => {
    const kernel = createKernel(standardMockGateway(), {
      clientApp: "rank-tests",
      judgment: new LocalJudgmentClient(),
    });
    const session = { sessionId: "confirm-s" };
    await kernel.dispatchTool("describe", { skillId: "sn.itsm.incident.update" }, session);
    const res = await kernel.dispatchTool(
      "dispatch",
      {
        skillId: "sn.itsm.incident.update",
        inputs: { mode: "work_note", body: "rebooted" },
        requestId: "j1",
      },
      session,
    );
    expect((res.data as { outcome: string }).outcome).toBe("pending");
    expect(res.text).toContain("Judgment:");
    expect(res.text).toContain("confirm:true");
  });
});
