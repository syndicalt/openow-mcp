import type {
  AuditRun,
  DescribePayload,
  DiscoverItem,
  DiscoverResult,
  FocusedPayload,
  InvokeRequest,
  InvokeResponse,
  RawRequest,
  SkillDoc,
} from "@open-now/contracts";
import { isWriteClass } from "@open-now/contracts";
import { type SnowGateway } from "./gateway.js";

export interface MockGatewayUser {
  sys_id: string;
  name: string;
  roles: string[];
}

export interface MockGatewayOptions {
  /** Partial skill docs; missing pieces fall back to read-class defaults. */
  skills?: Record<string, Partial<SkillDoc>>;
  user?: MockGatewayUser;
  focused?: Record<string, FocusedPayload>;
  discover?: DiscoverItem[];
  raw?: FocusedPayload;
}

const DEFAULT_FOCUSED: FocusedPayload = { rows: [], count: 0 };

/**
 * In-memory SnowGateway for tests and the mock eval path. Implements the full
 * confirmation protocol: write-class invokes go pending until confirm:true with
 * the same requestId, then apply exactly once (idempotent repeats).
 */
export class MockGateway implements SnowGateway {
  readonly user: MockGatewayUser;
  readonly applied = new Map<string, InvokeResponse>();
  applyCount = 0;
  invokeCount = 0;
  deniedCount = 0;

  private readonly skills: Record<string, Partial<SkillDoc>>;
  private readonly focused: Record<string, FocusedPayload>;
  private readonly discoverItems: DiscoverItem[];
  private readonly rawFixture: FocusedPayload;

  constructor(opts: MockGatewayOptions = {}) {
    this.skills = opts.skills ?? {};
    this.focused = opts.focused ?? {};
    this.discoverItems = opts.discover ?? [];
    this.rawFixture = opts.raw ?? DEFAULT_FOCUSED;
    this.user = opts.user ?? { sys_id: "u_me", name: "Ada", roles: ["itil"] };
  }

  async discover(q: string): Promise<DiscoverResult> {
    const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    if (tokens.length === 0) {
      return { results: this.discoverItems.slice(0, 25) };
    }
    const scored = this.discoverItems
      .map((item) => {
        const hay = `${item.id} ${item.why}`.toLowerCase();
        const hits = tokens.filter((t) => hay.includes(t)).length;
        return { item, hits };
      })
      .filter((s) => s.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .map((s) => s.item);
    // Spec §8.3: raw operations are always candidates (builder fallback path).
    for (const item of this.discoverItems) {
      if (item.kind === "raw_operation" && !scored.some((s) => s.id === item.id)) {
        scored.push({ ...item, score: 0.1 });
      }
    }
    return { results: scored.slice(0, 25) };
  }

  async describe(skillId: string): Promise<DescribePayload> {
    const doc = this.skills[skillId];
    if (!doc) {
      return { doc: null, available: false, reason: `unknown skill ${skillId}` };
    }
    const allowed = this.rolesPass(doc.rolesAnyOf ?? [], doc.rolesAllOf ?? []);
    return {
      doc: this.fullDoc(skillId, doc),
      available: allowed,
      reason: allowed ? undefined : `requires role(s): ${[...(doc.rolesAnyOf ?? []), ...(doc.rolesAllOf ?? [])].join(", ")}`,
    };
  }

  async invoke(req: InvokeRequest): Promise<InvokeResponse> {
    this.invokeCount++;
    const doc = this.fullDoc(req.skillId, this.skills[req.skillId] ?? {});
    const key =
      req.requestId ?? `${req.skillId}:${JSON.stringify(req.inputs)}:${req.dryRun}:${req.confirm}`;

    const stored = this.applied.get(key);
    // Idempotency: a stored ok/applied run is final. A stored pending is not —
    // a confirm:true re-invoke with the same requestId must run the applier.
    if (stored && stored.outcome !== "pending") return stored;

    if (!this.rolesPass(doc.rolesAnyOf, doc.rolesAllOf)) {
      this.deniedCount++;
      return {
        outcome: "denied",
        confirmation: doc.confirmation,
        auditId: `audit-mock-${this.invokeCount}`,
        message: `Requires role(s): ${[...doc.rolesAnyOf, ...doc.rolesAllOf].join(", ")}`,
      };
    }

    if (!isWriteClass(doc.confirmation)) {
      const res: InvokeResponse = {
        outcome: "ok",
        confirmation: doc.confirmation,
        focusedPayload: this.focused[req.skillId] ?? DEFAULT_FOCUSED,
        auditId: `audit-mock-${this.invokeCount}`,
        next: doc.relatedSkills,
      };
      this.applied.set(key, res);
      return res;
    }

    if (!req.confirm) {
      const res: InvokeResponse = {
        outcome: "pending",
        confirmation: doc.confirmation,
        auditId: `audit-mock-${this.invokeCount}`,
        ...(doc.confirmation === "create" || doc.confirmation === "restricted"
          ? {
              draft: {
                summary: `Create ${req.skillId}`,
                fields: req.inputs,
              },
            }
          : {
              diff: Object.entries(req.inputs).map(([field, after]) => ({
                field,
                before: null,
                after,
              })),
            }),
      };
      this.applied.set(key, res);
      return res;
    }

    this.applyCount++;
    const res: InvokeResponse = {
      outcome: "applied",
      confirmation: doc.confirmation,
      focusedPayload: { number: "INC0010001", record_numbers: ["INC0010001"] },
      auditId: `audit-mock-${this.invokeCount}`,
      next: doc.relatedSkills,
    };
    this.applied.set(key, res);
    return res;
  }

  async raw(req: RawRequest): Promise<FocusedPayload> {
    return {
      ...this.rawFixture,
      table: req.table,
      limit: req.limit,
    };
  }

  async getRun(requestId: string): Promise<AuditRun> {
    return {
      requestId,
      skillId: "mock",
      skillVersion: "1.0.0",
      user: this.user.sys_id,
      clientApp: "mock",
      inputsHash: "00000000",
      tablesTouched: [],
      recordNumbers: [],
      outcome: "ok",
      latencyMs: 0,
      createdAt: new Date().toISOString(),
    };
  }

  private rolesPass(anyOf: string[], allOf: string[]): boolean {
    if (anyOf.length > 0 && !anyOf.some((r) => this.user.roles.includes(r))) return false;
    if (allOf.length > 0 && !allOf.every((r) => this.user.roles.includes(r))) return false;
    return true;
  }

  private fullDoc(id: string, partial: Partial<SkillDoc>): SkillDoc {
    const defaults: SkillDoc = {
      id,
      name: id,
      version: "1.0.0",
      status: "ga",
      persona: "any",
      intent: "Mock skill.",
      inputs: {},
      tablesRead: [],
      tablesWritten: [],
      rolesAnyOf: [],
      rolesAllOf: [],
      confirmation: "read",
      procedure: [],
      sideEffects: [],
      returns: [],
      relatedSkills: [],
      executable: { type: "script_include" },
      structuredInputs: false,
    };
    return Object.assign(defaults, partial, { id }) as SkillDoc;
  }
}
