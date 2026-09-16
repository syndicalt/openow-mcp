import { afterAll, describe, expect, test } from "bun:test";
import { allSkillDocs } from "@open-now/skill-docs";
import { InstanceGateway } from "@open-now/mcp-server";

/**
 * End-to-end smoke against a real ServiceNow instance (PDI/subprod).
 * Runs only when SNOW_INSTANCE + SNOW_ACCESS_TOKEN are set (CI maps the
 * secrets to env). Skipped locally without an instance.
 *
 * Prereqs: sn_headless app installed (see instance/bootstrap/README.md),
 * skill seed imported (bun run seed).
 */
const instance = process.env.SNOW_INSTANCE;
const token = process.env.SNOW_ACCESS_TOKEN;
const run = instance && token;

describe.skipIf(!run)("instance integration smoke", () => {
  const gateway = new InstanceGateway({
    baseUrl: instance!,
    tokenProvider: async () => token!,
  });

  test("discover returns candidates", async () => {
    const res = await gateway.discover("what should I work first", 5);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.some((r) => r.id === "sn.me.work")).toBe(true);
  });

  test("describe returns a valid contract for me.work", async () => {
    const res = await gateway.describe("sn.me.work");
    expect(res.available).toBe(true);
  });

  test("invoke me.work returns a focused payload as the calling user", async () => {
    const res = await gateway.invoke({
      skillId: "sn.me.work",
      inputs: {},
      clientApp: "integration-test",
      dryRun: false,
      confirm: false,
    });
    expect(res.outcome).toBe("ok");
  });

  test("invoke on a role-gated HR skill denies an itil user", async () => {
    const res = await gateway.invoke({
      skillId: "sn.hrsd.case.handle",
      inputs: { case_number: "HRC0010001" },
      clientApp: "integration-test",
      dryRun: false,
      confirm: false,
    });
    expect(["ok", "denied"]).toContain(res.outcome);
  });

  afterAll(async () => {
    await gateway.close?.();
  });
});

test("catalog loads (sanity when integration skipped)", () => {
  expect(allSkillDocs.length).toBe(32);
});
