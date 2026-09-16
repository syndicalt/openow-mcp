import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkillDoc, type SkillDoc } from "@open-now/contracts";

/**
 * Loads every skill document JSON from ./src and validates it against the
 * contracts schema at module load. A malformed doc fails fast (CI gate).
 */
const docsDir = join(import.meta.dir, "src");

export const allSkillDocs: SkillDoc[] = readdirSync(docsDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => parseSkillDoc(JSON.parse(readFileSync(join(docsDir, f), "utf8"))));

export const skillDocsById: Record<string, SkillDoc> = Object.fromEntries(
  allSkillDocs.map((d) => [d.id, d]),
);

export const skillDocsByPriority = (priority: 1 | 2): SkillDoc[] =>
  allSkillDocs.filter((d) => d.priority === priority);
