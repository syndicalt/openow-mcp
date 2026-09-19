import { describe, expect, test } from "bun:test";
import { adviseConfirm, judgePending, LocalJudgmentClient } from "@open-now/mcp-server";

describe("confirm advice", () => {
  test("restricted class never auto_ok", () => {
    const j = adviseConfirm("restricted", {
      model: "open-now-local",
      answers: {
        matches_intent: { type: "noul", noul: 0.99 },
        blast_radius: { type: "score", score: 0, probabilities: { "0": 1 }, confidence: 1 },
        missing_substance: { type: "noul", noul: 0.01 },
      },
    });
    expect(j.advice).toBe("confirm");
  });

  test("low intent refuses", () => {
    const j = adviseConfirm("update_shared", {
      model: "open-now-local",
      answers: {
        matches_intent: { type: "noul", noul: 0.1 },
        blast_radius: { type: "score", score: 0, probabilities: { "0": 1 }, confidence: 1 },
        missing_substance: { type: "noul", noul: 0.1 },
      },
    });
    expect(j.advice).toBe("refuse");
  });

  test("owned + high intent + low blast is auto_ok", () => {
    const j = adviseConfirm("update_owned", {
      model: "open-now-local",
      answers: {
        matches_intent: { type: "noul", noul: 0.95 },
        blast_radius: { type: "score", score: 0.2, probabilities: { "0": 1 }, confidence: 1 },
        missing_substance: { type: "noul", noul: 0.05 },
      },
    });
    expect(j.advice).toBe("auto_ok");
  });

  test("judgePending does not throw on a pending diff", async () => {
    const j = await judgePending({
      judgment: new LocalJudgmentClient(),
      confirmation: "update_owned",
      skillId: "sn.itsm.incident.update",
      inputs: { mode: "work_note", body: "rebooted the smtp edge node" },
      diff: [{ field: "work_notes", before: "", after: "rebooted the smtp edge node" }],
    });
    expect(["refuse", "confirm", "auto_ok"]).toContain(j.advice);
  });
});
