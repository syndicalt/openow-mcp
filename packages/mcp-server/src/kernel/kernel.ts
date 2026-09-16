import { randomUUID } from "node:crypto";
import type {
  DescribePayload,
  FocusedPayload,
  InvokeRequest,
  InvokeResponse,
  RawRequest,
} from "@open-now/contracts";
import type { SnowGateway } from "../gateway/gateway.js";

export type KernelToolName =
  | "discover"
  | "describe"
  | "dispatch_readonly"
  | "dispatch";

export interface KernelContext {
  sessionId: string;
}

export interface KernelResult {
  ok: boolean;
  text: string;
  data?: unknown;
}

export interface KernelOptions {
  requireDescribe?: boolean;
  clientApp?: string;
}

const RAW_PREFIX = "raw:";

/**
 * The four-tool platform kernel (spec §3.3 Surface A). Stateless except for a
 * per-session "described" set used to enforce the describe-before-write rule.
 * All capability work is delegated to the gateway (in production the instance
 * runtime); this class owns protocol only.
 */
export class Kernel {
  private readonly described = new Map<string, Set<string>>();

  constructor(
    private readonly gateway: SnowGateway,
    private readonly opts: KernelOptions = {},
  ) {}

  /** True when `opts.requireDescribe` or the skill document demands describe-first. */
  async requiresDescribe(skillId: string, sessionId: string): Promise<boolean> {
    if (this.opts.requireDescribe) return true;
    if (skillId.startsWith(RAW_PREFIX)) return false;
    try {
      const payload = await this.gateway.describe(skillId);
      if (!payload.available) return false;
      const doc = payload.doc as { policy?: { requireDescribe?: boolean } } | null;
      return doc?.policy?.requireDescribe === true;
    } catch {
      return this.opts.requireDescribe ?? false;
    }
  }

  async dispatchTool(
    tool: KernelToolName,
    args: Record<string, unknown>,
    ctx: KernelContext,
  ): Promise<KernelResult> {
    try {
      switch (tool) {
        case "discover":
          return await this.discover(args);
        case "describe":
          return await this.describe(args, ctx.sessionId);
        case "dispatch_readonly":
          return await this.dispatchReadonly(args, ctx.sessionId);
        case "dispatch":
          return await this.dispatch(args, ctx.sessionId);
      }
    } catch (err) {
      return { ok: false, text: `${tool} failed: ${(err as Error).message}` };
    }
  }

  private async discover(args: Record<string, unknown>): Promise<KernelResult> {
    const q = str(args.q) || str(args.query);
    const limit = clampInt(args.limit, 10, 1, 25);
    const result = await this.gateway.discover(q, limit);
    if (result.results.length === 0) {
      return {
        ok: true,
        text: "No operations match. Try describe on a table or a broader intent.",
        data: result,
      };
    }
    const lines = result.results.map(
      (r) => `- ${r.id} [${r.kind}] score=${r.score} — ${r.why}`,
    );
    return {
      ok: true,
      text: `Matching operations (${result.results.length}):\n${lines.join("\n")}`,
      data: result,
    };
  }

  private async describe(
    args: Record<string, unknown>,
    sessionId: string,
  ): Promise<KernelResult> {
    const skillId = str(args.skillId);
    if (skillId.startsWith(RAW_PREFIX)) {
      return this.describeRaw(skillId);
    }
    const payload = await this.gateway.describe(skillId);
    if (payload.available) {
      this.markDescribed(sessionId, skillId);
    }
    const text = payload.available
      ? JSON.stringify(payload.doc, null, 2)
      : `Skill not available: ${payload.reason ?? `no contract for ${skillId}`}`;
    return { ok: payload.available, text, data: payload };
  }

  private describeRaw(skillId: string): KernelResult {
    const table = skillId.slice(RAW_PREFIX.length);
    const payload: DescribePayload = {
      doc: {
        id: skillId,
        kind: "raw_operation",
        table,
        confirmation: "update_shared",
        inputs: {
          query: { type: "string", required: false },
          fields: { type: "array", required: false },
          limit: { type: "int", required: false, default: 25, max: 100 },
        },
      },
      available: true,
    };
    return {
      ok: true,
      text: `Raw operation on table ${table}. Builder fallback: confirm-before-write applies (stricter class).`,
      data: payload,
    };
  }

  private async dispatchReadonly(
    args: Record<string, unknown>,
    sessionId: string,
  ): Promise<KernelResult> {
    const skillId = str(args.skillId);
    const inputs = obj(args.inputs);
    const requestId = str(args.requestId) || randomUUID();
    const res = await this.gateway.invoke({
      skillId,
      inputs,
      clientApp: this.opts.clientApp ?? "open-now",
      requestId,
      dryRun: true,
      confirm: false,
    });
    if (res.outcome === "denied") {
      this.markDescribed(sessionId, skillId);
      return {
        ok: true,
        text: `Denied: ${res.message ?? `role check failed for ${skillId}`}`,
        data: res,
      };
    }
    if (res.outcome === "ok") {
      this.markDescribed(sessionId, skillId);
      return {
        ok: true,
        text: describePayload(res, `${skillId} (read)`),
        data: res,
      };
    }
    return this.formatPreview(skillId, res);
  }

  private async dispatch(
    args: Record<string, unknown>,
    sessionId: string,
  ): Promise<KernelResult> {
    const rawSkillId = str(args.skillId);
    const skillId = rawSkillId.startsWith(RAW_PREFIX) ? rawSkillId : rawSkillId;
    if (skillId.startsWith(RAW_PREFIX)) {
      return this.dispatchRaw(args, sessionId);
    }
    const inputs = obj(args.inputs);
    const confirm = args.confirm === true;
    const dryRun = args.dryRun !== undefined ? args.dryRun === true : !confirm;
    const requestId = str(args.requestId) || randomUUID();

    if (await this.requiresDescribe(skillId, sessionId)) {
      this.assertDescribed(sessionId, skillId);
    }

    const req: InvokeRequest = {
      skillId,
      inputs,
      clientApp: this.opts.clientApp ?? "open-now",
      requestId,
      dryRun,
      confirm,
    };
    const res = await this.gateway.invoke(req);
    this.markDescribed(sessionId, skillId);

    if (res.outcome === "denied") {
      return {
        ok: true,
        text: `Denied: ${res.message ?? `role check failed for ${skillId}`} — no data was written.`,
        data: res,
      };
    }
    if (res.outcome === "pending") return this.formatPreview(skillId, res);
    if (res.outcome === "applied") {
      const numbers = res.focusedPayload?.number ?? res.focusedPayload?.record_numbers;
      return {
        ok: true,
        text: `Applied ${skillId}${numbers ? ` — ${JSON.stringify(numbers)}` : ""}.${res.next?.length ? ` Next: ${res.next.join(", ")}` : ""}`,
        data: res,
      };
    }
    return {
      ok: true,
      text: `${res.message ?? skillId} — outcome ${res.outcome}`,
      data: res,
    };
  }

  private async dispatchRaw(
    args: Record<string, unknown>,
    sessionId: string,
  ): Promise<KernelResult> {
    const skillId = str(args.skillId);
    const table = str(args.table, skillId.slice(RAW_PREFIX.length));
    const raw: RawRequest = {
      table,
      query: str(args.query, undefined),
      fields: arr(args.fields),
      limit: clampInt(args.limit, 25, 1, 100),
      aggregate: args.aggregate as RawRequest["aggregate"],
      groupBy: str(args.groupBy, undefined),
      orderBy: str(args.orderBy, undefined),
    };
    const payload = await this.gateway.raw(raw);
    this.markDescribed(sessionId, skillId);
    const rows = payload.rows as Array<Record<string, unknown>> | undefined;
    // Protocol sugar: raw reads are read-class operations, so surface them as
    // an InvokeResponse with outcome "ok" (same shape as every other dispatch).
    const res: InvokeResponse = {
      outcome: "ok",
      confirmation: "update_shared",
      auditId: randomUUID(),
      focusedPayload: payload,
    };
    return {
      ok: true,
      text: rows
        ? `Raw ${table}: ${rows.length} row(s)\n${rows.map((r) => JSON.stringify(r)).join("\n")}`
        : `Raw ${table}: ${JSON.stringify(payload)}`,
      data: res,
    };
  }

  private formatPreview(skillId: string, res: InvokeResponse): KernelResult {
    const parts: string[] = [`Pending confirmation — ${skillId}`];
    if (res.diff?.length) {
      for (const d of res.diff) {
        parts.push(`- ${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`);
      }
    }
    if (res.draft) {
      parts.push(`Draft: ${res.draft.summary}`);
      for (const [k, v] of Object.entries(res.draft.fields)) {
        parts.push(`- ${k}: ${JSON.stringify(v)}`);
      }
    }
    if (res.missingFields?.length) {
      parts.push(`Missing inputs required: ${res.missingFields.join(", ")}`);
    }
    parts.push(
      `Call dispatch with confirm:true and the same requestId to apply.`,
    );
    return { ok: true, text: parts.join("\n"), data: res };
  }

  private markDescribed(sessionId: string, skillId: string): void {
    let set = this.described.get(sessionId);
    if (!set) {
      set = new Set();
      this.described.set(sessionId, set);
    }
    set.add(skillId);
  }

  private assertDescribed(sessionId: string, skillId: string): void {
    const set = this.described.get(sessionId);
    if (set?.has(skillId)) return;
    throw new Error(
      `describe ${skillId} first (dispatch requires the technical contract before writes)`,
    );
  }
}

export function createKernel(gateway: SnowGateway, opts?: KernelOptions): Kernel {
  return new Kernel(gateway, opts);
}

function describePayload(res: InvokeResponse, label: string): string {
  const payload = res.focusedPayload;
  if (!payload) return `${label}: ${JSON.stringify(res)}`;
  const entries = Object.entries(payload);
  if (entries.length === 0) return `${label}: empty result.`;
  const lines = entries.map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `- ${k}: ${s.length > 200 ? `${s.slice(0, 200)}…` : s}`;
  });
  return `${label} — ${lines.join("\n")}${res.next?.length ? `\nNext: ${res.next.join(", ")}` : ""}`;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function arr(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(String) : undefined;
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
