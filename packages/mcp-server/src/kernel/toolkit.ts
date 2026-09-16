import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  RawRequest,
  ToolkitOp,
  ToolkitRequest,
  ToolkitResponse,
} from "@open-now/contracts";
import type { SnowGateway } from "../gateway/gateway.js";
import type { KernelResult } from "./kernel.js";

/**
 * The generated wide surface at the kernel level. Everything still executes
 * through the instance runtime (QueryGuard/ConfirmGate/audit): these tools are
 * protocol-only wrappers over `SnowGateway.toolkit` / `SnowGateway.raw`, with
 * the same pending -> confirm -> applied discipline as skill dispatch.
 */

export interface ToolkitMcpTool {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (args: Record<string, unknown>, sessionId: string) => Promise<KernelResult>;
}

const WRITE_OPS = new Set<ToolkitOp>([
  "record_create",
  "record_update",
  "record_delete",
  "attachment_add",
]);

const KeyArgs = {
  sys_id: z.string().optional(),
  number: z.string().optional(),
  record: z.string().optional(),
};

const KEY_DESC = "Sys id, record number (e.g. INC0010001), or record identifier.";

export const TOOLKIT_GENERIC_SPECS: Array<{ op: ToolkitOp; name: string; description: string; schema: z.ZodType }> = [
  {
    op: "table_list",
    name: "table_list",
    description: "List tables available to the caller (metadata). Optional pattern filter.",
    schema: z.object({ pattern: z.string().optional(), limit: z.number().int().min(1).max(500).optional() }),
  },
  {
    op: "table_schema",
    name: "table_schema",
    description: "Return the field schema (sys_dictionary) for a table: name, label, type, reference, read-only.",
    schema: z.object({ table: z.string().min(1) }),
  },
  {
    op: "record_get",
    name: "record_get",
    description: "Fetch one record by number or sys_id (GlideRecordSecure semantics; restricted tables gated by role).",
    schema: z.object({ table: z.string().min(1), ...KeyArgs }),
  },
  {
    op: "record_create",
    name: "record_create",
    description: "Create a record. Returns a draft; confirm before it is written (create class).",
    schema: z.object({
      table: z.string().min(1),
      values: z.record(z.string(), z.unknown()),
      requestId: z.string().optional(),
      confirm: z.boolean().optional(),
    }),
  },
  {
    op: "record_update",
    name: "record_update",
    description: "Update a record. Returns a field diff first (update_shared); confirm to apply.",
    schema: z.object({
      table: z.string().min(1),
      values: z.record(z.string(), z.unknown()),
      requestId: z.string().optional(),
      confirm: z.boolean().optional(),
      ...KeyArgs,
    }),
  },
  {
    op: "record_delete",
    name: "record_delete",
    description: "Delete a record. Restricted class: always shows the delete for confirmation — never silent.",
    schema: z.object({
      table: z.string().min(1),
      requestId: z.string().optional(),
      confirm: z.boolean().optional(),
      ...KeyArgs,
    }),
  },
  {
    op: "aggregate_report",
    name: "aggregate_report",
    description: "Server-side aggregate (COUNT/AVG/MIN/MAX/SUM, optional groupBy) — no row dumps into context.",
    schema: z.object({
      table: z.string().min(1),
      aggregate: z.enum(["count", "min", "max", "avg", "sum"]),
      field: z.string().optional(),
      groupBy: z.string().optional(),
      query: z.string().optional(),
    }),
  },
  {
    op: "run_script",
    name: "run_script",
    description: "Execute a short server-side Glide script in the instance (eval in the scoped runtime); returns the result string.",
    schema: z.object({ script: z.string().min(1) }),
  },
  {
    op: "attachment_list",
    name: "attachment_list",
    description: "List attachments for a record.",
    schema: z.object({ table: z.string().min(1), ...KeyArgs }),
  },
  {
    op: "attachment_add",
    name: "attachment_add",
    description: "Attach a file (base64 content) to a record. Draft first; confirm applies (create class).",
    schema: z.object({
      table: z.string().min(1),
      file_name: z.string().min(1),
      content_type: z.string().optional(),
      content: z.string().optional(),
      requestId: z.string().optional(),
      confirm: z.boolean().optional(),
      ...KeyArgs,
    }),
  },
];

export function createToolkitTools(
  gateway: SnowGateway,
  ops: ToolkitOp[] = TOOLKIT_GENERIC_SPECS.map((s) => s.op),
): ToolkitMcpTool[] {
  const allowed = new Set(ops);
  return TOOLKIT_GENERIC_SPECS.filter((s) => allowed.has(s.op)).map((spec) => ({
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    handler: async (args, sessionId) => {
      const confirm = args.confirm === true;
      const requestId = typeof args.requestId === "string" && args.requestId ? args.requestId : randomUUID();
      const cleanArgs = { ...args, requestId: undefined, confirm: undefined };
      return runToolkitOp(gateway, spec.op, cleanArgs, {
        requestId,
        confirm,
        sessionId,
      });
    },
  }));
}

/**
 * NowAIKit-style per-table surface: query/get/create/update/delete generated
 * per table from an allowlist (metadata, not hand-written). Every tool routes
 * to the same instance runtime. Name: `tbl_<table>_query` etc.
 */
export function createGeneratedTableTools(
  gateway: SnowGateway,
  tables: string[],
): ToolkitMcpTool[] {
  const tools: ToolkitMcpTool[] = [];
  for (const table of tables) {
    const id = table.replace(/[^a-zA-Z0-9_]/g, "_");
    const key = { ...KeyArgs, requestId: z.string().optional(), confirm: z.boolean().optional() };
    tools.push(
      {
        name: `tbl_${id}_query`,
        description: `Query ${table}: QueryGuard-validated encoded query, capped limit, allowlisted fields.`,
        schema: z.object({
          query: z.string().optional(),
          fields: z.array(z.string()).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          orderBy: z.string().optional(),
        }),
        handler: async (args) => {
          const raw: RawRequest = {
            table,
            query: typeof args.query === "string" ? args.query : undefined,
            fields: Array.isArray(args.fields) ? args.fields.map(String) : undefined,
            limit: typeof args.limit === "number" ? args.limit : 25,
            orderBy: typeof args.orderBy === "string" ? args.orderBy : undefined,
          };
          const payload = await gateway.raw(raw);
          const rows = payload.rows as Array<Record<string, unknown>> | undefined;
          return {
            ok: true,
            text: rows
              ? `Raw ${table}: ${rows.length} row(s)\n${rows.map((r) => JSON.stringify(r)).join("\n")}`
              : `Raw ${table}: ${JSON.stringify(payload)}`,
            data: payload,
          };
        },
      },
      {
        name: `tbl_${id}_get`,
        description: `Get one ${table} record by number or sys_id.`,
        schema: z.object({ ...KeyArgs }),
        handler: (args) => runToolkitOp(gateway, "record_get", { table, ...args }, {}),
      },
      {
        name: `tbl_${id}_create`,
        description: `Create a ${table} record (draft first; confirm to apply).`,
        schema: z.object({ values: z.record(z.string(), z.unknown()), requestId: z.string().optional(), confirm: z.boolean().optional() }),
        handler: (args) =>
          runToolkitOp(gateway, "record_create", { table, values: args.values ?? {} }, {
            requestId: typeof args.requestId === "string" ? args.requestId : undefined,
            confirm: args.confirm === true,
          }),
      },
      {
        name: `tbl_${id}_update`,
        description: `Update a ${table} record (diff first; confirm to apply).`,
        schema: z.object({ values: z.record(z.string(), z.unknown()), ...key }),
        handler: (args) =>
          runToolkitOp(gateway, "record_update", { table, values: args.values ?? {}, ...keyOf(args) }, {
            requestId: typeof args.requestId === "string" ? args.requestId : undefined,
            confirm: args.confirm === true,
          }),
      },
      {
        name: `tbl_${id}_delete`,
        description: `Delete a ${table} record (restricted class: always confirm).`,
        schema: z.object({ ...key }),
        handler: (args) =>
          runToolkitOp(gateway, "record_delete", { table, ...keyOf(args) }, {
            requestId: typeof args.requestId === "string" ? args.requestId : undefined,
            confirm: args.confirm === true,
          }),
      },
    );
  }
  return tools;
}

function keyOf(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["sys_id", "number", "record"]) {
    if (typeof args[k] === "string" && args[k]) out[k] = args[k] as string;
  }
  return out;
}

export async function runToolkitOp(
  gateway: SnowGateway,
  op: ToolkitOp,
  args: Record<string, unknown>,
  opts: { requestId?: string; confirm?: boolean; sessionId?: string },
): Promise<KernelResult> {
  const isWrite = WRITE_OPS.has(op);
  const requestId = opts.requestId ?? randomUUID();
  const confirm = opts.confirm === true;
  const req: ToolkitRequest = {
    op,
    args,
    clientApp: "open-now-toolkit",
    requestId,
    dryRun: isWrite && !confirm,
    confirm,
  };
  if (!gateway.toolkit) {
    return { ok: false, text: `toolkit op ${op} is not supported by this gateway` };
  }
  let res: ToolkitResponse;
  try {
    res = await gateway.toolkit(req);
  } catch (err) {
    return { ok: false, text: `${op} failed: ${(err as Error).message}` };
  }
  return formatToolkitResult(op, res, requestId);
}

export function formatToolkitResult(
  op: ToolkitOp,
  res: ToolkitResponse,
  requestId: string,
): KernelResult {
  switch (res.outcome) {
    case "ok": {
      const payload = res.focusedPayload;
      const text = payload
        ? `${op}: ${JSON.stringify(payload, null, 0).slice(0, 1200)}`
        : `${op}: done`;
      return { ok: true, text, data: res };
    }
    case "pending": {
      const parts: string[] = [`Pending confirmation — ${op}`];
      if (res.diff?.length) {
        for (const d of res.diff) parts.push(`- ${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`);
      }
      if (res.draft) {
        parts.push(`Draft: ${res.draft.summary}`);
        for (const [k, v] of Object.entries(res.draft.fields)) parts.push(`- ${k}: ${JSON.stringify(v)}`);
      }
      if (op === "record_delete") {
        parts.push("Deletes require confirmation (restricted class): nothing is removed until you confirm.");
      }
      parts.push(`Call the tool again with confirm:true and requestId "${requestId}" to apply.`);
      return { ok: true, text: parts.join("\n"), data: res };
    }
    case "applied": {
      const n = (res.focusedPayload?.record as string | undefined) ?? (res.focusedPayload?.record_numbers as unknown);
      return {
        ok: true,
        text: `Applied ${op}${n ? ` — ${String(n)}` : ""}`,
        data: res,
      };
    }
    case "denied":
      return { ok: true, text: `Denied: ${res.message ?? `role check failed for ${op}`}`, data: res };
    default:
      return { ok: false, text: res.message ?? `${op}: ${res.outcome}`, data: res };
  }
}
