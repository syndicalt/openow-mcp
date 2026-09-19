import { afterAll, describe, expect, test } from "bun:test";
import { allSkillDocs } from "@open-now/skill-docs";
import { InstanceGateway, instanceAuthFromEnv } from "@open-now/mcp-server";

/**
 * End-to-end smoke against a real ServiceNow instance (PDI/subprod).
 * Runs when SNOW_INSTANCE is set with either SNOW_USER+SNOW_PASSWORD
 * (HTTP Basic, PDI web-service user) or SNOW_ACCESS_TOKEN.
 *
 * Prereqs: sn_headless app installed (see instance/bootstrap/README.md),
 * skill seed imported (bun run seed).
 */
const instance = process.env.SNOW_INSTANCE;
const hasBasic = Boolean(process.env.SNOW_USER && process.env.SNOW_PASSWORD);
const hasToken = Boolean(process.env.SNOW_ACCESS_TOKEN ?? process.env.OPEN_NOW_ACCESS_TOKEN);
const run = Boolean(instance && (hasBasic || hasToken));

describe.skipIf(!run)("instance integration smoke", () => {
  const gateway = new InstanceGateway({
    baseUrl: String(instance ?? "").replace(/\/$/, ""),
    ...instanceAuthFromEnv(),
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

  test("invoke on a role-gated HR skill never silently writes", async () => {
    const res = await gateway.invoke({
      skillId: "sn.hrsd.case.handle",
      inputs: { case_number: "HRC0010001" },
      clientApp: "integration-test",
      dryRun: false,
      confirm: false,
    });
    // itil without sn_hr_core.case_writer → denied.
    // admin (typical PDI web-service user) passes the role gate; a missing
    // case is error/unsupported. Restricted never applies without confirm.
    expect(res.outcome).not.toBe("applied");
    expect(["ok", "denied", "unsupported", "error", "pending"]).toContain(res.outcome);
  });

  afterAll(async () => {
    await gateway.close?.();
  });
});

test("catalog loads (sanity when integration skipped)", () => {
  expect(allSkillDocs.length).toBe(32);
});
