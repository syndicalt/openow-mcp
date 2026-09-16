import { z } from "zod";

export const DiscoverArgsSchema = z.object({
  q: z.string().default(""),
  limit: z.number().int().min(1).max(25).optional(),
});

export const DescribeArgsSchema = z.object({
  skillId: z.string().min(1),
});

export const DispatchArgsSchema = z.object({
  skillId: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).default({}),
  requestId: z.string().optional(),
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
  /** raw operation fields (skillId "raw:table") */
  table: z.string().optional(),
  query: z.string().optional(),
  fields: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  groupBy: z.string().optional(),
  orderBy: z.string().optional(),
  aggregate: z.enum(["count", "min", "max", "avg", "sum"]).optional(),
});

export const DispatchReadonlyArgsSchema = DispatchArgsSchema;

export interface KernelToolSpec {
  name: "discover" | "describe" | "dispatch_readonly" | "dispatch";
  description: string;
  schema: z.ZodType;
}

/**
 * The four stable platform kernel tools (spec §3.3). Descriptions are the
 * client contract — keep them stable; operation surface grows inside, not here.
 */
export const KERNEL_TOOL_SPECS: KernelToolSpec[] = [
  {
    name: "discover",
    description:
      "Semantic search over the operation and skill index. Query is a restatement of user intent. Returns ranked skill IDs and raw operations with score and a one-line why.",
    schema: DiscoverArgsSchema,
  },
  {
    name: "describe",
    description:
      "Return the technical contract for a skill: inputs, encoded-query hints, required roles, side-effect class, confirmation policy, related skills. Required before dispatch of write-class skills.",
    schema: DescribeArgsSchema,
  },
  {
    name: "dispatch_readonly",
    description:
      "GET-equivalent only. Queries, aggregates, schema, relationship walks, KB search. Never mutates; prefer this whenever the skill is read-shaped.",
    schema: DispatchReadonlyArgsSchema,
  },
  {
    name: "dispatch",
    description:
      "Invoke the skill (confirmation policy enforced: write-class returns a pending diff unless confirm:true with the same requestId). Raw operations use skillId raw:<table>.",
    schema: DispatchArgsSchema,
  },
];
