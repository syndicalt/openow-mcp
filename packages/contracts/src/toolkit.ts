import { z } from "zod";
import { InvokeResponseSchema } from "./invoke.js";

/**
 * Toolkit operations — the generated wide surface behind the stable kernel
 * tools (spec §3.3 Surface B / §8.3 raw fallback). Everything still executes
 * in the instance through QueryGuard + RecordResolver + ConfirmGate + audit;
 * no hand-written per-table tools, no Table API in the kernel.
 */
export const ToolkitOpSchema = z.enum([
  "table_list",
  "table_schema",
  "record_get",
  "record_create",
  "record_update",
  "record_delete",
  "aggregate_report",
  "run_script",
  "attachment_list",
  "attachment_add",
]);
export type ToolkitOp = z.infer<typeof ToolkitOpSchema>;

export const ToolkitRequestSchema = z.object({
  op: ToolkitOpSchema,
  args: z.record(z.string(), z.unknown()).default({}),
  clientApp: z.string().default("open-now"),
  requestId: z.string().optional(),
  dryRun: z.boolean().default(false),
  confirm: z.boolean().default(false),
});
export type ToolkitRequest = z.infer<typeof ToolkitRequestSchema>;

/**
 * Same envelope as skill invokes: outcome ok|pending|applied|denied|error|
 * unsupported, diff/draft for writes, mandatory auditId. Write classes are
 * fixed per op (create -> create, update -> update_shared, delete -> restricted
 * i.e. always confirm, attachment_add -> create).
 */
export const ToolkitResponseSchema = InvokeResponseSchema;
export type ToolkitResponse = z.infer<typeof ToolkitResponseSchema>;

export const TABLE_TOOLKIT_READ_TABLES = [
  "incident",
  "problem",
  "change_request",
  "change_task",
  "sc_request",
  "sc_req_item",
  "sc_cat_item",
  "task_sla",
  "cmdb_ci",
  "cmdb_rel_ci",
  "cmdb_ci_service_ci",
  "kb_knowledge",
  "em_alert",
  "sn_si_incident",
  "hr_case",
  "sys_user",
  "sys_user_group",
  "sysapproval_approver",
  "pm_project",
  "pm_project_task",
  "spm_goal",
  "sn_customerservice_case",
  "sn_vuln_vulnerable_item",
  "sys_dictionary",
  "sys_db_object",
] as const;

export function isToolkitWrite(op: ToolkitOp): boolean {
  return op !== "table_list" && op !== "table_schema" && op !== "record_get" && op !== "aggregate_report" && op !== "attachment_list" && op !== "run_script";
}
