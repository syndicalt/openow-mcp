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
  ToolkitRequest,
  ToolkitResponse,
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
  /** toolkit fixtures */
  tables?: Array<{ name: string; label: string; extends?: string }>;
  schema?: Record<string, Array<Record<string, unknown>>>;
  rows?: Record<string, Array<Record<string, unknown>>>;
  aggregates?: Array<Record<string, unknown>>;
}

function str(args: Record<string, unknown>): string {
  return String(args.sys_id ?? args.number ?? args.record ?? "");
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
  private readonly tableFixture: Array<{ name: string; label: string; extends?: string }>;
  private readonly schemaFixture: Record<string, Array<Record<string, unknown>>>;
  private readonly rowsFixture: Record<string, Array<Record<string, unknown>>>;
  private readonly aggregatesFixture: Array<Record<string, unknown>>;
  private readonly restrictedTables = ["hr_case", "sn_si_incident", "sn_vuln_vulnerable_item"];
  private readonly restrictedRoles = ["sn_hr_core.case_writer", "sn_si.analyst", "sn_vuln"];

  constructor(opts: MockGatewayOptions = {}) {
    this.skills = opts.skills ?? {};
    this.focused = opts.focused ?? {};
    this.discoverItems = opts.discover ?? [];
    this.rawFixture = opts.raw ?? DEFAULT_FOCUSED;
    this.tableFixture = opts.tables ?? [];
    this.schemaFixture = opts.schema ?? {};
    this.rowsFixture = opts.rows ?? {};
    this.aggregatesFixture = opts.aggregates ?? [];
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
    const fixtureRows = (this.rawFixture.rows as Array<Record<string, unknown>> | undefined) ?? [];
    const rows = (this.rowsFixture[req.table] ?? fixtureRows).slice(0, req.limit);
    return {
      ...this.rawFixture,
      rows,
      count: rows.length,
      table: req.table,
      limit: req.limit,
    };
  }

  async toolkit(req: ToolkitRequest): Promise<ToolkitResponse> {
    const key = req.requestId ?? `${req.op}:${JSON.stringify(req.args)}:${req.confirm}`;
    const stored = this.applied.get(key);
    // A stored pending must NOT block a confirm attempt (mirrors instance Audit
    // semantics: settled outcomes replay, pending never short-circuits a write).
    if (stored && (stored.outcome !== "pending" || !req.confirm)) return stored;
    const res = await this.toolkitOnce(req);
    this.applied.set(key, res);
    return res;
  }

  private async toolkitOnce(req: ToolkitRequest): Promise<ToolkitResponse> {
    this.invokeCount++;
    const { op, args } = req;
    const auditId = `audit-mock-tk-${this.invokeCount}`;
    const table = String(args.table ?? "");
    if (this.restrictedTables.includes(table)) {
      const okRole = this.user.roles.some((r) => this.restrictedRoles.includes(r));
      if (!okRole) {
        this.deniedCount++;
        return {
          outcome: "denied",
          confirmation: "read",
          auditId,
          message: `Requires role for raw access to ${table}`,
        };
      }
    }

    switch (op) {
      case "table_list":
        return {
          outcome: "ok",
          confirmation: "read",
          auditId,
          focusedPayload: { count: this.tableFixture.length, tables: this.tableFixture },
        };
      case "table_schema":
        return {
          outcome: "ok",
          confirmation: "read",
          auditId,
          focusedPayload: { table, fields: this.schemaFixture[table] ?? [] },
        };
      case "record_get": {
        const record = this.findRow(table, args);
        if (!record) {
          return { outcome: "error", confirmation: "read", auditId, message: `${table} ${str(args)} not found or not readable` };
        }
        return { outcome: "ok", confirmation: "read", auditId, focusedPayload: { table, record } };
      }
      case "aggregate_report":
        return {
          outcome: "ok",
          confirmation: "read",
          auditId,
          focusedPayload: { aggregates: this.aggregatesFixture },
        };
      case "run_script":
        return {
          outcome: "ok",
          confirmation: "read",
          auditId,
          focusedPayload: { result: `mock: ${String(args.script ?? "").slice(0, 80)}` },
        };
      case "attachment_list":
        return {
          outcome: "ok",
          confirmation: "read",
          auditId,
          focusedPayload: { table, attachments: [] },
        };
      case "record_create":
      case "attachment_add":
        if (!req.confirm) {
          return {
            outcome: "pending",
            confirmation: "create",
            auditId,
            draft: { summary: `Create ${table}`, fields: (args.values ?? args) as Record<string, unknown> },
          };
        }
        this.applyCount++;
        return {
          outcome: "applied",
          confirmation: "create",
          auditId,
          focusedPayload: {
            table,
            record: String(args.file_name ?? (args.values as Record<string, unknown>)?.number ?? "GEN0001001"),
          },
        };
      case "record_update":
        if (!req.confirm) {
          const values = (args.values ?? {}) as Record<string, unknown>;
          const row = this.findRow(table, args);
          return {
            outcome: "pending",
            confirmation: "update_shared",
            auditId,
            diff: Object.entries(values).map(([field, after]) => ({
              field,
              before: row && field in row ? (row[field] as unknown) : null,
              after,
            })),
            focusedPayload: { table, record: String(args.number ?? args.sys_id ?? "") },
          };
        }
        this.applyCount++;
        return {
          outcome: "applied",
          confirmation: "update_shared",
          auditId,
          focusedPayload: { table, record: String(args.number ?? args.sys_id ?? "") },
        };
      case "record_delete":
        if (!req.confirm) {
          return {
            outcome: "pending",
            confirmation: "restricted",
            auditId,
            draft: { summary: `Delete ${table} ${str(args)}`, fields: {} },
          };
        }
        this.applyCount++;
        return {
          outcome: "applied",
          confirmation: "restricted",
          auditId,
          focusedPayload: { table, record: str(args), deleted: true },
        };
      default:
        return {
          outcome: "unsupported",
          confirmation: "read",
          auditId,
          message: `unknown toolkit op ${op}`,
        };
    }
  }

  private findRow(table: string, args: Record<string, unknown>): Record<string, unknown> | undefined {
    const rows = this.rowsFixture[table] ?? [];
    const key = String(args.sys_id ?? args.number ?? args.record ?? "");
    if (!key) return rows[0];
    return rows.find((r) => String(r.sys_id ?? "") === key || String(r.number ?? r.sys_id ?? "") === key);
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
