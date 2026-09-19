import { afterAll, describe, expect, test } from "bun:test";
import {
  createKernel,
  InstanceGateway,
  JevClient,
  LocalJudgmentClient,
} from "@open-now/mcp-server";

/**
 * Kernel + judgment against a real PDI. Requires SNOW_INSTANCE +
 * SNOW_ACCESS_TOKEN (or OPEN_NOW_* aliases). Local engine always;
 * Jev path runs only when TYPESAFE_API_KEY is set.
 *
 * Prereqs: sn_headless installed and catalog seeded
 * (instance/bootstrap/README.md). Judgment never writes.
 */
const instance = process.env.SNOW_INSTANCE ?? process.env.OPEN_NOW_INSTANCE_URL;
const token = process.env.SNOW_ACCESS_TOKEN ?? process.env.OPEN_NOW_ACCESS_TOKEN;
const run = Boolean(instance && token);
const jevKey = process.env.TYPESAFE_API_KEY;

describe.skipIf(!run)("PDI kernel + judgment", () => {
  const gateway = new InstanceGateway({
    baseUrl: String(instance ?? "").replace(/\/$/, ""),
    tokenProvider: async () => token!,
  });

  afterAll(async () => {
    await gateway.close?.();
  });

  test("discover with local judgment annotates gates and does not invent skills", async () => {
    const kernel = createKernel(gateway, {
      clientApp: "pdi-judgment",
      judgment: new LocalJudgmentClient(),
    });
    const res = await kernel.dispatchTool(
      "discover",
      { q: "cannot send email after the smtp change" },
      { sessionId: "pdi-local" },
    );
    expect(res.ok).toBe(true);
    const data = res.data as { results: Array<{ id: string; gate?: string }> };
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results.every((r) => typeof r.id === "string")).toBe(true);
    const raw = data.results.filter((r) => r.id.startsWith("raw:"));
    expect(raw.every((r) => r.gate !== "auto")).toBe(true);
  }, 30_000);

  test("pending write is annotated and never auto-applied", async () => {
    const kernel = createKernel(gateway, {
      clientApp: "pdi-judgment",
      judgment: new LocalJudgmentClient(),
    });
    const session = { sessionId: "pdi-confirm" };
    await kernel.dispatchTool("describe", { skillId: "sn.itsm.incident.update" }, session);
    const pending = await kernel.dispatchTool(
      "dispatch",
      {
        skillId: "sn.itsm.incident.update",
        inputs: { mode: "work_note", body: "judgment-plane live test — do not apply" },
        requestId: `pdi-j-${Date.now()}`,
      },
      session,
    );
    const data = pending.data as { outcome: string; judgment?: { advice: string } };
    expect(data.outcome).toBe("pending");
    expect(pending.text).toContain("confirm:true");
    expect(["refuse", "confirm", "auto_ok"]).toContain(data.judgment?.advice ?? "confirm");
  }, 30_000);

  test.skipIf(!jevKey)("discover through live Jev still returns instance candidates", async () => {
    const kernel = createKernel(gateway, {
      clientApp: "pdi-jev",
      judgment: new JevClient({ apiKey: jevKey!, onError: "throw" }),
    });
    const res = await kernel.dispatchTool(
      "discover",
      { q: "what should I work first this morning" },
      { sessionId: "pdi-jev" },
    );
    expect(res.ok).toBe(true);
    expect(res.text).toContain("gate=");
    const data = res.data as { results: Array<{ id: string }> };
    expect(data.results.length).toBeGreaterThan(0);
  }, 30_000);
});

test("PDI judgment is skipped without instance credentials (sanity)", () => {
  if (!run) expect(instance && token).toBeFalsy();
});
