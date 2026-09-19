import { describe, expect, test } from "bun:test";
import { evaluateLocal } from "@open-now/mcp-server";

describe("local System One engine", () => {
  test("choice picks the option whose criteria overlap the state", () => {
    const res = evaluateLocal({
      model: "jev-latest",
      state: "Outbound SMTP is rejecting mail after last night's filter change. Finance cannot send invoices.",
      questions: {
        skill: {
          type: "choice",
          instructions: "Which skill should handle this?",
          criteria: {
            "sn.itsm.incident.triage": "Outage, email down, SMTP bounce, many users, related change",
            "sn.itsm.catalog.request": "Access request, new laptop, catalog item, how do I",
            "sn.cmdb.ci.find": "Look up a configuration item by name",
          },
        },
      },
    });
    const ans = res.answers["skill"];
    expect(ans?.type).toBe("choice");
    if (ans?.type !== "choice") throw new Error("expected choice");
    expect(ans.choice).toBe("sn.itsm.incident.triage");
    expect(ans.confidence).toBeGreaterThan(0.4);
    expect(ans.probabilities["sn.itsm.incident.triage"] ?? 0).toBeGreaterThan(
      ans.probabilities["sn.itsm.catalog.request"] ?? 0,
    );
  });

  test("noul is high when evidence for true is present", () => {
    const res = evaluateLocal({
      model: "jev-latest",
      state: { short_description: "Email gateway down", priority: 1, duplicates: 2, related_change: "CHG003891" },
      questions: {
        mi: {
          type: "noul",
          instructions: "This looks like a major incident",
          criteria: {
            true: "outage down email P1 major duplicate change",
            false: "printer jam how-to single user",
          },
        },
      },
    });
    const ans = res.answers["mi"];
    expect(ans?.type).toBe("noul");
    if (ans?.type !== "noul") throw new Error("expected noul");
    expect(ans.noul).toBeGreaterThan(0.5);
  });

  test("score returns an expected value on the rubric", () => {
    const res = evaluateLocal({
      model: "jev-latest",
      state: "If people don't get paid Friday I will escalate to the CEO.",
      questions: {
        frustration: {
          type: "score",
          instructions: "How frustrated the reporter appears",
          criteria: ["Calm, matter-of-fact", "Frustrated but civil", "Escalatory threatening CEO escalate"],
        },
      },
    });
    const ans = res.answers["frustration"];
    expect(ans?.type).toBe("score");
    if (ans?.type !== "score") throw new Error("expected score");
    expect(ans.score).toBeGreaterThanOrEqual(1);
    expect(ans.legend?.["2"]).toContain("Escalatory");
  });

  test("evaluates many questions in one pass", () => {
    const res = evaluateLocal({
      model: "jev-latest",
      state: "printer jam 4th floor",
      questions: {
        a: { type: "noul", instructions: "This is an outage" },
        b: {
          type: "choice",
          instructions: "queue",
          criteria: { incident: "break fix", request: "catalog" },
        },
        c: {
          type: "score",
          instructions: "urgency",
          criteria: ["low", "medium", "high"],
        },
      },
    });
    expect(Object.keys(res.answers)).toHaveLength(3);
    expect(res.model).toBe("open-now-local");
  });
});
