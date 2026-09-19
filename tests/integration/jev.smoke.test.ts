import { describe, expect, test } from "bun:test";
import { JevClient } from "@open-now/mcp-server";

/**
 * Live Jev (TypeSafe System One). Skipped unless TYPESAFE_API_KEY is set.
 * Throws on HTTP/parse failure — we want to know if the envelope drifted.
 */
const key = process.env.TYPESAFE_API_KEY;
const run = Boolean(key);

describe.skipIf(!run)("Jev live System One", () => {
  const client = new JevClient({
    apiKey: key!,
    baseUrl: process.env.TYPESAFE_BASE_URL,
    onError: "throw",
  });

  test("noul, choice, and score round-trip against jev-latest", async () => {
    const res = await client.evaluate({
      model: "jev-latest",
      state:
        "Outbound SMTP is rejecting mail after last night's filter change. Finance cannot send invoices. P1.",
      questions: {
        urgent: {
          type: "noul",
          instructions: "Does this convey operational urgency?",
        },
        skill: {
          type: "choice",
          instructions: "Which skill should handle this?",
          criteria: {
            "sn.itsm.incident.triage": "Outage, email down, SMTP bounce, many users, related change",
            "sn.itsm.catalog.request": "Access request, new laptop, catalog item, how do I",
            "sn.cmdb.ci.find": "Look up a configuration item by name",
          },
        },
        blast: {
          type: "score",
          instructions: "Operational blast radius",
          criteria: [
            "Local, owned record, reversible",
            "Shared record; other fulfillers will see it",
            "High impact: outage, many users, or many records",
          ],
        },
      },
    });
    expect(res.model).toMatch(/^jev/);
    const urgent = res.answers["urgent"];
    const skill = res.answers["skill"];
    const blast = res.answers["blast"];
    expect(urgent?.type).toBe("noul");
    if (urgent?.type === "noul") expect(urgent.noul).toBeGreaterThan(0.5);
    expect(skill?.type).toBe("choice");
    if (skill?.type === "choice") {
      expect(skill.choice).toBe("sn.itsm.incident.triage");
      expect(skill.confidence).toBeGreaterThan(0);
    }
    expect(blast?.type).toBe("score");
    if (blast?.type === "score") expect(blast.score).toBeGreaterThanOrEqual(1);
  }, 20_000);
});

test("jev live is skipped without TYPESAFE_API_KEY (sanity)", () => {
  if (!run) expect(key).toBeFalsy();
});
