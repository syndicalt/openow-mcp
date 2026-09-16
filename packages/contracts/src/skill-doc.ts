import { z } from "zod";

/**
 * Confirmation classes from spec §4.4. Mirrors the instance-side choices.
 */
export const ConfirmationClassSchema = z.enum([
  "read",
  "update_owned",
  "update_shared",
  "create",
  "approve",
  "execute",
  "deploy",
  "restricted",
]);

export type ConfirmationClass = z.infer<typeof ConfirmationClassSchema>;

export const SkillStatusSchema = z.enum(["draft", "ga", "deprecated"]);
export type SkillStatus = z.infer<typeof SkillStatusSchema>;

export const InputTypeSchema = z.enum([
  "string",
  "int",
  "number",
  "boolean",
  "record_number",
  "sys_id",
  "enum",
  "array",
  "object",
]);
export type InputType = z.infer<typeof InputTypeSchema>;

/**
 * Input contract for one named input (spec §5.1 `inputs`).
 * Clients should prefer record numbers over sys_ids at the edge.
 */
export const InputSpecSchema = z.object({
  type: InputTypeSchema,
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  enum: z.array(z.string()).optional(),
  maxLength: z.number().int().positive().optional(),
  maxItems: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});
export type InputSpec = z.infer<typeof InputSpecSchema>;

/**
 * Which server-side artifact actually executes the skill (spec §5).
 * `plan`/`apply` are the methods of `ref` (a Script Include) that implement
 * the planner/applier split (implementation plan D6).
 */
export const ExecutableSchema = z.object({
  type: z.enum(["script_include", "flow_action", "now_assist", "raw"]),
  ref: z.string().optional(),
  plan: z.string().optional(),
  apply: z.string().optional(),
});
export type Executable = z.infer<typeof ExecutableSchema>;

export const SkillPolicySchema = z.object({
  /** update_owned only: apply silently when this is true and the record is owned. */
  autoApply: z.boolean().optional(),
  /** Reject dispatch for write-class skills if describe was not called (spec §3.3, configurable). */
  requireDescribe: z.boolean().optional(),
  /** approve class: double confirmation before applying. */
  dualConfirm: z.boolean().optional(),
});
export type SkillPolicy = z.infer<typeof SkillPolicySchema>;

/**
 * Skill document v1 (spec §5.1). Every field is the source of truth for
 * `describe` responses; clients must not cache field lists across versions.
 */
export const SkillDocSchema = z.object({
  $schema: z.literal("open-now/skill-doc/v1").optional(),
  id: z.string().regex(/^sn\.[a-z0-9]+(\.[a-z0-9]+)+$/, "dotted skill id, e.g. sn.itsm.incident.triage"),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver"),
  status: SkillStatusSchema,
  persona: z.string().min(1),
  intent: z.string().min(20),
  inputs: z.record(z.string(), InputSpecSchema),
  tablesRead: z.array(z.string()).min(1),
  tablesWritten: z.array(z.string()).default([]),
  rolesAnyOf: z.array(z.string()).default([]),
  rolesAllOf: z.array(z.string()).default([]),
  confirmation: ConfirmationClassSchema,
  procedure: z.array(z.string()).min(1),
  sideEffects: z.array(z.string()).default([]),
  returns: z.array(z.string()).min(1),
  relatedSkills: z.array(z.string()).default([]),
  executable: ExecutableSchema,
  /** HR/SecOps: inputs are structured only; no freeform encoded queries (spec §4.3). */
  structuredInputs: z.boolean().default(false),
  /** Modules/tables whose absence degrades this skill gracefully. */
  featureDeps: z.array(z.string()).optional(),
  policy: SkillPolicySchema.optional(),
  /** Priority from spec §6 catalog. */
  priority: z.number().int().min(1).max(2).optional(),
  eval: z
    .object({
      prompts: z.array(z.string()).default([]),
    })
    .optional(),
});

export type SkillDoc = z.infer<typeof SkillDocSchema>;

/**
 * Slot for a not-yet-implemented skill, so upstream tooling can fail loudly.
 */
export type RawOperationDoc = {
  id: string;
  kind: "raw_operation";
  score: number;
  why: string;
};

export function parseSkillDoc(input: unknown): SkillDoc {
  return SkillDocSchema.parse(input);
}

export function isWriteClass(confirmation: ConfirmationClass): boolean {
  return confirmation !== "read";
}
