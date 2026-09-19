import { createKernel, InstanceGateway, instanceAuthFromEnv, MockGateway } from "@open-now/mcp-server";
import type { KernelToolName } from "@open-now/mcp-server";
import { buildMockFixtureConfig } from "./eval-runner";

/**
 * Latency + token-cost benchmark for the kernel dispatch surface (spec §3.3
 * comparison anchor). Measures dispatch_readonly per skill and estimates
 * tokens = ceil(text.length / 4) as a rough 4-char-per-token proxy.
 *
 * Usage:
 *   bun run bench                                      # mock gateway, default skills
 *   bun run bench -- --skills sn.me.work,sn.cmdb.ci.find
 *   bun run bench -- --gateway instance                 # SNOW_INSTANCE required
 */

const DEFAULT_SKILLS = "sn.me.work,sn.cmdb.ci.find,sn.itsm.change.assess_risk";

interface BenchOptions {
  skills: string[];
  gateway: "mock" | "instance";
}

function parseArgs(argv: string[]): BenchOptions {
  let gateway: "mock" | "instance" = "mock";
  let skillsArg = DEFAULT_SKILLS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--gateway") {
      const value = argv[i + 1];
      if (value !== "mock" && value !== "instance") {
        throw new Error("--gateway must be mock|instance");
      }
      gateway = value;
      i++;
    } else if (arg === "--skills") {
      const value = argv[i + 1];
      if (!value) throw new Error("--skills requires a comma-separated list");
      skillsArg = value;
      i++;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return {
    skills: skillsArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    gateway,
  };
}

async function main(): Promise<void> {
  const { skills, gateway: mode } = parseArgs(process.argv.slice(2));

  const instance = process.env.SNOW_INSTANCE;

  const gateway =
    mode === "instance"
      ? (() => {
          if (!instance) {
            console.error(
              "--gateway instance requires SNOW_INSTANCE (and SNOW_USER+SNOW_PASSWORD or SNOW_ACCESS_TOKEN)",
            );
            process.exit(1);
          }
          return new InstanceGateway({
            baseUrl: instance,
            ...instanceAuthFromEnv(),
          });
        })()
      : new MockGateway(buildMockFixtureConfig());

  const kernel = createKernel(gateway);
  console.log("skill,latency_ms,tokens");
  for (const skillId of skills) {
    const t0 = Date.now();
    const res = await kernel.dispatchTool(
      "dispatch_readonly" as KernelToolName,
      { skillId, inputs: {} },
      { sessionId: "bench" },
    );
    const latencyMs = Date.now() - t0;
    const tokens = Math.ceil(res.text.length / 4);
    console.log(`${skillId},${latencyMs},${tokens}`);
  }
}

if (import.meta.main) {
  await main();
}
