import { describe, expect, test } from "bun:test";
import { JevClient, createJudgmentClient } from "@open-now/mcp-server";

const sampleReq = {
  model: "jev-latest",
  state: "cannot send email",
  questions: {
    skill: {
      type: "choice" as const,
      instructions: "skill",
      criteria: { triage: "email outage", catalog: "new laptop" },
    },
  },
};

describe("JevClient", () => {
  test("parses a Jev-shaped response", async () => {
    const client = new JevClient({
      apiKey: "sk-test",
      onError: "throw",
      fetch: async () =>
        new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: {
              skill: {
                type: "choice",
                choice: "triage",
                probabilities: { triage: 0.8, catalog: 0.2 },
                confidence: 0.7,
              },
            },
          }),
          { status: 200 },
        ),
    });
    const res = await client.evaluate(sampleReq);
    expect(res.model).toBe("jev-1.13.0");
    expect(res.answers["skill"]?.type).toBe("choice");
  });

  test("falls back to local on HTTP error", async () => {
    const client = new JevClient({
      apiKey: "sk-test",
      onError: "local",
      fetch: async () => new Response("nope", { status: 503 }),
    });
    const res = await client.evaluate(sampleReq);
    expect(res.model).toBe("open-now-local");
    expect(res.answers["skill"]?.type).toBe("choice");
  });
});

describe("createJudgmentClient", () => {
  test("off returns undefined", () => {
    expect(createJudgmentClient({ mode: "off" })).toBeUndefined();
  });

  test("jev without a key degrades to local", async () => {
    const c = createJudgmentClient({ mode: "jev" });
    expect(c).toBeDefined();
    const res = await c!.evaluate(sampleReq);
    expect(res.model).toBe("open-now-local");
  });
});
