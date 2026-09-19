import { describe, expect, test } from "bun:test";
import { createKernel, LocalJudgmentClient } from "@open-now/mcp-server";
import { standardMockGateway } from "../../fixtures/gateway/fixtures.js";
import type { SurfaceSpec } from "@open-now/contracts";

describe("kernel title-aware surface", () => {
  test("without judgment, me.work has no surface (goldens stay deterministic)", async () => {
    const kernel = createKernel(standardMockGateway(), { clientApp: "surface-off" });
    const res = await kernel.dispatchTool(
      "dispatch_readonly",
      { skillId: "sn.me.work", inputs: {} },
      { sessionId: "s-off" },
    );
    expect(res.ok).toBe(true);
    expect((res.data as { surface?: SurfaceSpec }).surface).toBeUndefined();
  });

  test("with judgment, me.work compiles a canvas from sys_user.title", async () => {
    const kernel = createKernel(standardMockGateway(), {
      clientApp: "surface-on",
      judgment: new LocalJudgmentClient(),
    });
    const res = await kernel.dispatchTool(
      "dispatch_readonly",
      { skillId: "sn.me.work", inputs: {} },
      { sessionId: "s-ada" },
    );
    const surface = (res.data as { surface?: SurfaceSpec }).surface;
    expect(surface).toBeDefined();
    expect(surface!.identity.title).toBe("Service Desk Analyst");
    expect(surface!.archetype).toBe("incident_desk");
    expect(surface!.components.some((c) => c.id === "header.identity")).toBe(true);
    expect(surface!.components.some((c) => c.id === "queue.assigned")).toBe(true);
  });

  test("later discover reuses the session title and does not invent skills", async () => {
    const kernel = createKernel(standardMockGateway(), {
      clientApp: "surface-on",
      judgment: new LocalJudgmentClient(),
    });
    const session = { sessionId: "s-follow" };
    await kernel.dispatchTool("dispatch_readonly", { skillId: "sn.me.work", inputs: {} }, session);
    const res = await kernel.dispatchTool("discover", { q: "what should I work first" }, session);
    const data = res.data as { results: Array<{ id: string }>; surface?: SurfaceSpec };
    expect(data.surface?.archetype).toBe("incident_desk");
    const offered = new Set(data.results.filter((r) => !r.id.startsWith("raw:")).map((r) => r.id));
    expect(data.surface!.skills.every((s) => offered.has(s) || s === "sn.me.work")).toBe(true);
  });
});
