import { afterAll, describe, expect, test } from "bun:test";
import {
  createKernel,
  InstanceGateway,
  instanceAuthFromEnv,
  JevClient,
  LocalJudgmentClient,
} from "@open-now/mcp-server";

/**
 * Kernel + judgment against a real PDI. Requires SNOW_INSTANCE and either
 * SNOW_USER+SNOW_PASSWORD or SNOW_ACCESS_TOKEN. Local engine always;
 * Jev path runs only when TYPESAFE_API_KEY is set.
 *
 * Prereqs: sn_headless installed and catalog seeded
 * (instance/bootstrap/README.md). Judgment never writes.
 */
const instance = process.env.SNOW_INSTANCE ?? process.env.OPEN_NOW_INSTANCE_URL;
const hasBasic = Boolean(process.env.SNOW_USER && process.env.SNOW_PASSWORD);
const hasToken = Boolean(process.env.SNOW_ACCESS_TOKEN ?? process.env.OPEN_NOW_ACCESS_TOKEN);
const run = Boolean(instance && (hasBasic || hasToken));
const jevKey = process.env.TYPESAFE_API_KEY;

async function firstIncidentNumber(): Promise<string | undefined> {
  const base = String(instance ?? "").replace(/\/$/, "");
  const user = process.env.SNOW_USER;
  const password = process.env.SNOW_PASSWORD;
  if (!base || !user || !password) return undefined;
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  const res = await fetch(
    `${base}/api/now/table/incident?sysparm_limit=1&sysparm_query=active=true&sysparm_fields=number`,
    { headers: { Authorization: auth, Accept: "application/json" } },
  );
  if (!res.ok) return undefined;
  const json = (await res.json()) as { result?: Array<{ number?: string }> };
  return json.result?.[0]?.number;
}

describe.skipIf(!run)("PDI kernel + judgment", () => {
  const gateway = new InstanceGateway({
    baseUrl: String(instance ?? "").replace(/\/$/, ""),
    ...instanceAuthFromEnv(),
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
    const number = await firstIncidentNumber();
    expect(number).toBeTruthy();
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
        inputs: {
          incident_number: number,
          mode: "work_note",
          body: "judgment-plane live test — do not apply",
        },
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
  if (!run) expect(hasBasic || hasToken).toBe(false);
});
