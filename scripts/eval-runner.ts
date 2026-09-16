import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createKernel, InstanceGateway, MockGateway } from "@open-now/mcp-server";
import type { Kernel, KernelToolName, MockGatewayOptions } from "@open-now/mcp-server";
import type { SkillDoc } from "@open-now/contracts";

/**
 * Golden-path evaluation runner (spec §8.4). Replays tests/fixtures/golden/*.json
 * through the kernel against either the in-memory MockGateway or a real
 * ServiceNow instance, and exits non-zero on any failed assertion.
 *
 * Usage:
 *   bun run eval                                  # mock gateway
 *   bun run eval -- --gateway instance            # real instance (SNOW_INSTANCE set)
 *   bun run eval -- --filter incident             # only fixtures matching substring
 *   bun run eval -- --json                        # machine-readable output
 */

interface GoldenStep {
  tool: string;
  args: Record<string, unknown>;
  expectOk?: boolean;
  expectOutcome?: string;
  expectNoWrite?: boolean;
}

interface GoldenFixture {
  name: string;
  description?: string;
  steps: GoldenStep[];
}

interface StepResult {
  fixture: string;
  step: number;
  tool: string;
  ok: boolean;
  outcome: string | undefined;
  pass: boolean;
  note?: string;
}

interface EvalOptions {
  gateway: "mock" | "instance";
  filter?: string;
  json: boolean;
}

function parseArgs(argv: string[]): EvalOptions {
  const opts: EvalOptions = { gateway: "mock", json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--gateway") {
      const value = argv[i + 1];
      if (value !== "mock" && value !== "instance") {
        throw new Error("--gateway must be mock|instance");
      }
      opts.gateway = value;
      i++;
    } else if (arg === "--filter") {
      const value = argv[i + 1];
      if (!value) throw new Error("--filter requires a substring");
      opts.filter = value;
      i++;
    } else if (arg === "--json") {
      opts.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

/**
 * Inline mock fixtures (spec §8.4 shapes). Deliberately independent of
 * tests/fixtures/gateway/fixtures.ts so the eval path never imports test code.
 * NOTE: no `policy.requireDescribe` on sn.itsm.incident.update — golden
 * incident-resolve dispatches without a describe step.
 */
export function buildMockFixtureConfig(): MockGatewayOptions {
  const skills: Record<string, Partial<SkillDoc>> = {
    "sn.me.work": {
      name: "My Work",
      confirmation: "read",
      tablesRead: ["incident"],
      relatedSkills: ["sn.itsm.incident.triage"],
    },
    "sn.itsm.shift.briefing": {
      name: "Shift Briefing",
      confirmation: "read",
      tablesRead: ["incident", "change_request", "problem"],
    },
    "sn.itsm.change.cab_prep": {
      name: "CAB Prep",
      confirmation: "read",
      tablesRead: ["change_request"],
    },
    "sn.cmdb.ci.find": {
      name: "Find CI",
      confirmation: "read",
      tablesRead: ["cmdb_ci"],
    },
    "sn.itsm.incident.update": {
      name: "Update Incident",
      confirmation: "update_owned",
      tablesWritten: ["incident"],
      inputs: {
        mode: { type: "enum", enum: ["resolve", "comment", "work_note"], required: false },
        resolution_code: { type: "string", required: false },
        resolution_notes: { type: "string", required: false },
      },
    },
    "sn.hrsd.case.handle": {
      name: "Handle HR Case",
      confirmation: "restricted",
      rolesAnyOf: ["sn_hr_core.case_writer"],
      tablesRead: ["hr_case"],
    },
    "sn.itsm.change.assess_risk": {
      name: "Assess Change Risk",
      confirmation: "read",
      tablesRead: ["change_request"],
    },
  };

  const focused: Record<string, Record<string, unknown>> = {
    "sn.me.work": {
      assigned: [{ number: "INC0010001", short_description: "printer on fire" }],
      approvals: [],
      watches: [],
      requested_for: [],
    },
    "sn.itsm.shift.briefing": {
      at_risk: [],
      unassigned: [],
      mine: [{ number: "INC0010001" }],
      majors: [],
      changes_today: [],
      first_actions: ["triage INC0010001"],
    },
    "sn.cmdb.ci.find": {
      match: { sys_id: "ci_web_001", name: "web-prod-01" },
      candidates: [
        { sys_id: "ci_web_001", name: "web-prod-01", class: "cmdb_ci_server" },
        { sys_id: "ci_web_002", name: "web-prod-02", class: "cmdb_ci_server" },
      ],
      ambiguous: true,
    },
  };

  return {
    user: { sys_id: "u_me", name: "Ada", roles: ["itil"] },
    skills,
    focused,
    discover: [
      { id: "sn.me.work", kind: "skill", score: 0.96, why: "my work, approvals, watches" },
      { id: "sn.itsm.shift.briefing", kind: "skill", score: 0.9, why: "shift start queue briefing" },
      { id: "raw:incident", kind: "raw_operation", score: 0.4, why: "raw table access fallback" },
    ],
    raw: {
      table: "incident",
      rows: [{ number: "INC0010001", short_description: "printer on fire", state: "1" }],
      count: 1,
    },
  };
}

async function runStep(
  kernel: Kernel,
  step: GoldenStep,
  stepNo: number,
  fixtureName: string,
): Promise<StepResult> {
  const res = await kernel.dispatchTool(step.tool as KernelToolName, step.args, {
    sessionId: fixtureName,
  });
  const data = res.data as { outcome?: string } | undefined;
  const outcome = data?.outcome;
  const expectOk = step.expectOk ?? true;

  let pass = res.ok === expectOk;
  let note: string | undefined;
  if (!pass) {
    note = `res.ok=${res.ok}, expected ${expectOk}`;
  }
  if (step.expectOutcome !== undefined) {
    const matches = outcome === step.expectOutcome;
    if (!matches) {
      pass = false;
      note = `${note ?? `outcome=${String(outcome)}, expected ${step.expectOutcome}`}`;
    }
  }
  if (step.expectNoWrite === true) {
    // No change happened: a read or a refusal. pending/applied would mean a write.
    const noWrite = outcome !== "applied" && outcome !== "pending";
    if (!noWrite) {
      pass = false;
      note = `${note ?? `expected no write but outcome=${String(outcome)}`}`;
    }
  }

  return {
    fixture: fixtureName,
    step: stepNo,
    tool: step.tool,
    ok: res.ok,
    outcome,
    pass,
    note,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const goldenDir = join(import.meta.dir, "..", "tests", "fixtures", "golden");
  let files: string[] = [];
  try {
    files = readdirSync(goldenDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    console.error(`golden fixtures not found: ${goldenDir}`);
    process.exit(1);
  }

  const fixtures: GoldenFixture[] = files.map((f) =>
    JSON.parse(readFileSync(join(goldenDir, f), "utf8")) as GoldenFixture,
  );

  const instance = process.env.SNOW_INSTANCE;
  const token = process.env.SNOW_ACCESS_TOKEN ?? process.env.OPEN_NOW_ACCESS_TOKEN;
  if (opts.gateway === "instance" && !instance) {
    console.error(
      "--gateway instance requires SNOW_INSTANCE (and SNOW_ACCESS_TOKEN or OPEN_NOW_ACCESS_TOKEN)",
    );
    process.exit(1);
  }

  const results: StepResult[] = [];
  for (const fixture of fixtures) {
    if (opts.filter && !fixture.name.includes(opts.filter)) continue;

    const gateway =
      opts.gateway === "mock"
        ? new MockGateway(buildMockFixtureConfig())
        : new InstanceGateway({
            baseUrl: instance!,
            tokenProvider: async () => token ?? null,
          });
    const kernel = createKernel(gateway);

    for (const [i, step] of fixture.steps.entries()) {
      const result = await runStep(kernel, step, i + 1, fixture.name);
      results.push(result);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(results));
  } else {
    for (const r of results) {
      const outcome = r.outcome ?? "n/a";
      console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.fixture} / step ${r.step} (${r.tool}) outcome=${outcome}`);
      if (!r.pass && r.note) console.log(`    ${r.note}`);
    }
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`${failed.length} of ${results.length} golden step(s) failed`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
