import { z } from "zod";

/**
 * NowOS surface compilation contract. A surface is an intent canvas compiled
 * from the operator's ServiceNow title + what they can actually see — never a
 * generated ServiceNow form. Judgment (Jev Choice / Score / Noul) ranks
 * components; it never writes and never invents a skill.
 */

export const SurfaceArchetypeSchema = z.enum([
  "incident_desk",
  "change_cab",
  "cmdb_ops",
  "hr_agent",
  "csm_agent",
  "secops",
  "spm",
  "builder",
  "executive",
  "employee",
]);
export type SurfaceArchetype = z.infer<typeof SurfaceArchetypeSchema>;

export const OperatorIdentitySchema = z.object({
  userId: z.string(),
  name: z.string(),
  /** sys_user.title — the primary signal for canvas compilation. */
  title: z.string(),
  department: z.string().optional(),
  roles: z.array(z.string()).default([]),
});
export type OperatorIdentity = z.infer<typeof OperatorIdentitySchema>;

export const UiComponentKindSchema = z.enum([
  "identity",
  "queue",
  "card",
  "graph",
  "briefing",
  "confirm",
  "action",
]);
export type UiComponentKind = z.infer<typeof UiComponentKindSchema>;

export const UiRegionSchema = z.enum(["header", "main", "rail", "overlay"]);
export type UiRegion = z.infer<typeof UiRegionSchema>;

export const UiComponentSchema = z.object({
  id: z.string(),
  kind: UiComponentKindSchema,
  region: UiRegionSchema,
  title: z.string(),
  skillId: z.string().optional(),
  /** Noul that this component belongs on this operator's canvas now. */
  noul: z.number().min(0).max(1),
  why: z.string(),
  props: z.record(z.string(), z.unknown()).optional(),
});
export type UiComponent = z.infer<typeof UiComponentSchema>;

export const SurfaceSpecSchema = z.object({
  archetype: SurfaceArchetypeSchema,
  confidence: z.number().min(0).max(1),
  /** Score-question expected value: 0 sparse … ~2 command-center. */
  density: z.number(),
  identity: OperatorIdentitySchema,
  components: z.array(UiComponentSchema),
  /** Skills the canvas may dispatch. Subset of what the instance already offered. */
  skills: z.array(z.string()),
});
export type SurfaceSpec = z.infer<typeof SurfaceSpecSchema>;
