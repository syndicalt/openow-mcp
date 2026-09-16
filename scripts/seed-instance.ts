import { allSkillDocs } from "@open-now/skill-docs";

/**
 * Seed (upsert) the sn_headless skill registry on a ServiceNow instance.
 *
 * Usage:
 *   SNOW_INSTANCE=https://dev123456.service-now.com \
 *   SNOW_ACCESS_TOKEN=<oauth access token> \
 *   bun run seed
 *
 * Options:
 *   --dry-run          print how many skills would be imported and their ids
 *   --skill <id>       import only the given skill id (repeatable)
 */

interface SeedOptions {
  dryRun: boolean;
  skills: string[];
}

function parseArgs(argv: string[]): SeedOptions {
  const opts: SeedOptions = { dryRun: false, skills: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--skill") {
      const id = argv[i + 1];
      if (!id) throw new Error("--skill requires a skill id (e.g. sn.me.work)");
      opts.skills.push(id);
      i++;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function usage(): string {
  return [
    "usage: bun run seed [--dry-run] [--skill <id> ...]",
    "",
    "environment:",
    "  SNOW_INSTANCE           instance base URL, e.g. https://dev123456.service-now.com",
    "  SNOW_ACCESS_TOKEN       OAuth bearer token (fallback: OPEN_NOW_ACCESS_TOKEN)",
    "",
    "flags:",
    "  --dry-run               print count + skill ids without calling the instance",
    "  --skill <id>            seed only the listed skill id(s)",
  ].join("\n");
}

async function main(): Promise<void> {
  const { dryRun, skills } = parseArgs(process.argv.slice(2));
  const docs = skills.length
    ? allSkillDocs.filter((doc) => skills.includes(doc.id))
    : allSkillDocs;

  const instance = process.env.SNOW_INSTANCE;
  const token = process.env.SNOW_ACCESS_TOKEN ?? process.env.OPEN_NOW_ACCESS_TOKEN;

  if (!instance) {
    if (dryRun) {
      console.log(`${docs.length} skill(s) would be imported`);
      for (const doc of docs) console.log(doc.id);
      return;
    }
    console.error(usage());
    process.exit(1);
  }

  // Strip undefined keys (e.g. $schema) so JSON.stringify omits them.
  const body = { skills: docs.map((doc) => ({ ...doc, $schema: undefined })) };

  const res = await fetch(`${instance.replace(/\/$/, "")}/api/now/sn_headless/import`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    console.error(`import failed: HTTP ${res.status}`);
    if (bodyText) console.error(bodyText);
    process.exit(1);
  }

  const summary = await res.json().catch(() => null);
  console.log(`seeded ${docs.length} skill(s) at ${instance}`);
  if (summary) console.log(JSON.stringify(summary));
}

if (import.meta.main) {
  await main();
}
