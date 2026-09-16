import { z } from "zod";
import { ConfirmationClassSchema } from "./skill-doc.js";

/** One proposed field change returned to the client for confirmation. */
export const DiffSchema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type Diff = z.infer<typeof DiffSchema>;

/** Draft summary for create-class skills (no record exists yet). */
export const DraftSchema = z.object({
  summary: z.string(),
  fields: z.record(z.string(), z.unknown()),
});
export type Draft = z.infer<typeof DraftSchema>;

/**
 * Focused payload: numbers, sys_ids, display values, next skill.
 * Never a raw table dump (spec §3.2 step 7).
 */
export const FocusedPayloadSchema = z.record(z.string(), z.unknown());
export type FocusedPayload = z.infer<typeof FocusedPayloadSchema>;

export const InvokeRequestSchema = z.object({
  skillId: z.string(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  clientApp: z.string(),
  /** Idempotency key: re-invoking the same request_id must not double-apply. */
  requestId: z.string().optional(),
  /** Compute the planner (diff/draft) without applying. */
  dryRun: z.boolean().default(false),
  /** Confirm a previously returned pending request. Requires the same request_id. */
  confirm: z.boolean().default(false),
});
export type InvokeRequest = z.infer<typeof InvokeRequestSchema>;

export const OutcomeSchema = z.enum([
  "ok",
  "pending",
  "applied",
  "denied",
  "unsupported",
  "error",
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const InvokeResponseSchema = z.object({
  outcome: OutcomeSchema,
  confirmation: ConfirmationClassSchema,
  focusedPayload: FocusedPayloadSchema.optional(),
  diff: z.array(DiffSchema).optional(),
  draft: DraftSchema.optional(),
  auditId: z.string(),
  next: z.array(z.string()).optional(),
  error: z.string().optional(),
  /** denied/aborted reason; also used for 403 explanations (spec §7.1). */
  message: z.string().optional(),
  missingFields: z.array(z.string()).optional(),
});
export type InvokeResponse = z.infer<typeof InvokeResponseSchema>;

export const DescribePayloadSchema = z.object({
  doc: z.unknown(),
  available: z.boolean(),
  reason: z.string().optional(),
});
export type DescribePayload = z.infer<typeof DescribePayloadSchema>;
