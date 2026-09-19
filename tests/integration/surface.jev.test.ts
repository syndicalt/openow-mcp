import { describe, expect, test } from "bun:test";
import { JevClient, classifyOperator, compileSurface } from "@open-now/mcp-server";
import type { OperatorIdentity } from "@open-now/contracts";

/**
 * Live Jev classification of ServiceNow titles → NowOS canvases.
 * Skipped unless TYPESAFE_API_KEY is set. Judgment never writes.
 */
const key = process.env.TYPESAFE_API_KEY;
const run = Boolean(key);

function ident(title: string, roles: string[] = []): OperatorIdentity {
  return { userId: "u_live", name: "Live", title, roles };
}

describe.skipIf(!run)("Jev title → surface", () => {
  const jev = new JevClient({
    apiKey: key!,
    baseUrl: process.env.TYPESAFE_BASE_URL,
    onError: "throw",
  });

  test("classifies Service Desk vs CAB vs executive titles", async () => {
    const desk = await classifyOperator(jev, ident("Service Desk Analyst", ["itil"]));
    const cab = await classifyOperator(jev, ident("Change Manager"));
    const exec = await classifyOperator(jev, ident("VP of Infrastructure"));
    expect(desk.archetype).toBe("incident_desk");
    expect(cab.archetype).toBe("change_cab");
    expect(exec.archetype).toBe("executive");
  }, 30_000);

  test("judges components: desk gets triage, executive does not", async () => {
    const desk = await compileSurface(jev, {
      identity: ident("Service Desk Analyst", ["itil"]),
      work: { assigned: [{ number: "INC0010001" }] },
    });
    const exec = await compileSurface(jev, {
      identity: ident("Chief Information Officer"),
    });
    expect(desk.archetype).toBe("incident_desk");
    expect(desk.components.some((c) => c.id === "queue.assigned")).toBe(true);
    expect(exec.archetype).toBe("executive");
    expect(exec.components.some((c) => c.id === "card.incident_update")).toBe(false);
    expect(exec.components[0]?.id).toBe("header.identity");
  }, 30_000);
});

test("Jev surface tests skip without TYPESAFE_API_KEY (sanity)", () => {
  if (!run) expect(key).toBeFalsy();
});
