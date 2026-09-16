import { z } from "zod";
import { OutcomeSchema } from "./invoke.js";

/**
 * Audit line written server-side for every dispatch (spec §8.2 sn_headless_run).
 * Fields follow spec §2 "Observability is a feature": actor, skill, tables,
 * sys_ids, encoded query hash, token app, result.
 */
export const AuditRunSchema = z.object({
  requestId: z.string(),
  skillId: z.string(),
  skillVersion: z.string(),
  user: z.string(),
  clientApp: z.string(),
  inputsHash: z.string(),
  tablesTouched: z.array(z.string()).default([]),
  recordNumbers: z.array(z.string()).default([]),
  queryHash: z.string().optional(),
  outcome: OutcomeSchema,
  error: z.string().optional(),
  latencyMs: z.number().nonnegative(),
  tokenApp: z.string().optional(),
  resultSummary: z.string().optional(),
  createdAt: z.string(),
});
export type AuditRun = z.infer<typeof AuditRunSchema>;

export function hashInputs(inputs: Record<string, unknown>): string {
  const canon = JSON.stringify(sortKeys(inputs));
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}
