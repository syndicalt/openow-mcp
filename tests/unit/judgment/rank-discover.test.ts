import { describe, expect, test } from "bun:test";
import { LocalJudgmentClient, rerankDiscover } from "@open-now/mcp-server";
import type { DiscoverResult } from "@open-now/contracts";

describe("rerankDiscover", () => {
  test("never invents a skill that was not a candidate", async () => {
    const incoming: DiscoverResult = {
      results: [
        { id: "sn.itsm.incident.triage", kind: "skill", score: 0.4, why: "email outage smtp bounce" },
        { id: "sn.me.work", kind: "skill", score: 0.9, why: "my work queue" },
        { id: "raw:incident", kind: "raw_operation", score: 0.2, why: "raw fallback" },
      ],
    };
    const ranked = await rerankDiscover(
      new LocalJudgmentClient(),
      "cannot send email after the smtp change",
      incoming,
    );
    const ids = ranked.results.map((r) => r.id);
    expect(ids).toContain("sn.itsm.incident.triage");
    expect(ids).toContain("raw:incident");
    expect(ids.every((id) => incoming.results.some((r) => r.id === id))).toBe(true);
  });

  test("keeps raw operations out of auto gate", async () => {
    const ranked = await rerankDiscover(
      new LocalJudgmentClient(),
      "anything",
      {
        results: [
          { id: "sn.me.work", kind: "skill", score: 0.5, why: "my work" },
          { id: "raw:incident", kind: "raw_operation", score: 0.9, why: "raw" },
        ],
      },
    );
    const raw = ranked.results.find((r) => r.id === "raw:incident");
    expect(raw?.gate).toBe("ask");
  });
});
