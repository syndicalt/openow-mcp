import { z } from "zod";
import { DiscoverGateSchema } from "./judgment.js";

export const DiscoverItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["skill", "raw_operation", "table"]),
  score: z.number().nonnegative(),
  /** One-line reason the item matched. */
  why: z.string(),
  /** Present when the kernel judgment plane reranked this result. */
  confidence: z.number().min(0).max(1).optional(),
  gate: DiscoverGateSchema.optional(),
});
export type DiscoverItem = z.infer<typeof DiscoverItemSchema>;

export const DiscoverResultSchema = z.object({
  results: z.array(DiscoverItemSchema).max(25),
});
export type DiscoverResult = z.infer<typeof DiscoverResultSchema>;

/**
 * Raw operation fallback (spec §3.3 discover, §10.2): builder path behind
 * QueryGuard. Never raw if a skill exists.
 */
export const RawRequestSchema = z.object({
  table: z.string(),
  query: z.string().optional(),
  fields: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  /** Aggregate mode for sn.ops.report.aggregate-friendly calls. */
  aggregate: z.enum(["count", "min", "max", "avg", "sum"]).optional(),
  groupBy: z.string().optional(),
  orderBy: z.string().optional(),
});
export type RawRequest = z.infer<typeof RawRequestSchema>;
