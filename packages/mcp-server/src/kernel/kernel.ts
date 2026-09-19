import { randomUUID } from "node:crypto";
import type {
  DescribePayload,
  FocusedPayload,
  InvokeRequest,
  InvokeResponse,
  RawRequest,
} from "@open-now/contracts";
import type { SnowGateway } from "../gateway/gateway.js";
import type { JudgmentClient } from "../judgment/client.js";
import type { Journal } from "../judgment/journal.js";
import { rerankDiscover } from "../judgment/rank-discover.js";
import { judgePending } from "../judgment/confirm-policy.js";

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
  /** Internal System One client. Undefined = ranking/confirm advice off (eval/goldens). */
  judgment?: JudgmentClient;
  journal?: Journal;
}

const RAW_PREFIX = "raw:";

/**
 * The four-tool platform kernel (spec §3.3 Surface A). Stateless except for a
 * per-session "described" set used to enforce the describe-before-write rule.
 * All capability work is delegated to the gateway (in production the instance
 * runtime); this class owns protocol only.
 *
 * Judgment (Jev / local System One) is not a fifth tool. It reranks discover
 * and annotates pending diffs. It never writes.
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
    let result = await this.gateway.discover(q, limit);
    if (this.opts.judgment && result.results.length > 0 && q) {
      result = await rerankDiscover(this.opts.judgment, q, result);
      this.opts.journal?.append({
        type: "skill.discovered",
        query: q,
        ids: result.results.map((r) => r.id),
      });
    }
    if (result.results.length === 0) {
      return {
        ok: true,
        text: "No operations match. Try describe on a table or a broader intent.",
        data: result,
      };
    }
    const lines = result.results.map((r) => {
      const gate = r.gate ? ` gate=${r.gate}` : "";
      const conf = r.confidence != null ? ` conf=${r.confidence.toFixed(2)}` : "";
      return `- ${r.id} [${r.kind}] score=${Number(r.score).toFixed(2)}${conf}${gate} — ${r.why}`;
    });
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
    return this.formatPreview(skillId, res, inputs);
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
    if (res.outcome === "pending") return this.formatPreview(skillId, res, inputs, requestId);
    if (res.outcome === "applied") {
      this.opts.journal?.append({
        type: "dispatch.applied",
        skillId,
        requestId,
        auditId: res.auditId,
      });
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

  private async formatPreview(
    skillId: string,
    res: InvokeResponse,
    inputs: Record<string, unknown> = {},
    requestId?: string,
  ): Promise<KernelResult> {
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

    let judgment: Awaited<ReturnType<typeof judgePending>> | undefined;
    if (this.opts.judgment) {
      judgment = await judgePending({
        judgment: this.opts.judgment,
        confirmation: res.confirmation,
        skillId,
        inputs,
        diff: res.diff,
        draft: res.draft,
      });
      parts.push(
        `Judgment: advice=${judgment.advice} intent=${judgment.intent.toFixed(2)} blast=${judgment.blast.toFixed(2)} missing=${judgment.missingSubstance.toFixed(2)}`,
      );
      if (judgment.advice === "refuse") {
        parts.push("Refuse: do not confirm — intent or substance is below floor. Instance did not write.");
      } else if (judgment.advice === "auto_ok") {
        parts.push("auto_ok: owned + high intent + low blast. Kernel still waits for confirm:true (ConfirmGate owns apply).");
      }
      this.opts.journal?.append({
        type: "dispatch.pending",
        skillId,
        requestId,
        advice: judgment.advice,
      });
      this.opts.journal?.append({
        type: "jev.answered",
        pack: "open-now.dispatch.confirm",
        model: "judgment",
        elapsedMs: judgment.elapsedMs,
        answers: judgment.answers,
      });
    }

    parts.push(`Call dispatch with confirm:true and the same requestId to apply.`);
    return { ok: true, text: parts.join("\n"), data: { ...res, judgment } };
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
