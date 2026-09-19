/**
 * Minimal ServiceNow server-side runtime shim for loading scoped-app Script
 * Includes under Bun. Implements just enough GlideRecordSecure / gs behavior
 * to unit-test the planners, guards, and the runtime — real ACL/BR semantics
 * are verified on a PDI (tests/integration).
 */

export interface ShimUser {
  sys_id: string;
  name: string;
  roles: string[];
}

export interface ShimOptions {
  records?: Record<string, Array<Record<string, unknown>>>;
  user?: ShimUser;
}

export interface ShimState {
  user: ShimUser;
  insertLog: Array<{ table: string; record: Record<string, unknown> }>;
  updateLog: Array<{ table: string; sys_id: string }>;
  deleteLog: Array<{ table: string; sys_id: string }>;
  queryLog: string[];
}

interface FakeRecord {
  _sys_id: string;
  [key: string]: unknown;
}

interface Condition {
  field: string;
  op: string;
  value: unknown;
}

const CONDITION_OPS = ["NOT IN", "STARTSWITH", "ENDSWITH", "CONTAINS", "BETWEEN", "IN", "LIKE", "<=", ">=", "!=", "<", ">", "="];

export function installShim(opts: ShimOptions = {}): ShimState {
  const tables = new Map<string, FakeRecord[]>();
  for (const [table, rows] of Object.entries(opts.records ?? {})) {
    tables.set(
      table,
      rows.map((r, i) => ({ _sys_id: String(r.sys_id ?? `rec_${table}_${i}`), ...r })),
    );
  }
  let counter = 1;
  const user: ShimUser = opts.user ?? { sys_id: "u_me", name: "Ada", roles: ["itil"] };

  const state: ShimState = {
    user,
    insertLog: [],
    updateLog: [],
    deleteLog: [],
    queryLog: [],
  };

  class FakeGR {
    private readonly conds: Condition[] = [];
    private rows: FakeRecord[] = [];
    private idx = -1;
    private limit?: number;
    private orderField?: string;
    private orderDesc = false;
    private buffer: Record<string, unknown> | null = null;
    private readonly tableName: string;

    constructor(table: string) {
      this.tableName = table;
    }

    addQuery(field: string, op?: unknown, value?: unknown): FakeGR {
      if (value === undefined) {
        this.conds.push({ field, op: "=", value: op });
      } else {
        this.conds.push({ field, op: String(op), value });
      }
      return this;
    }

    addEncodedQuery(q: string): FakeGR {
      const parts = String(q).split("^").filter(Boolean);
      for (const part of parts) {
        for (const op of CONDITION_OPS) {
          const idx = part.indexOf(op);
          if (idx > 0) {
            const field = part.slice(0, idx).trim();
            const value = part.slice(idx + op.length).trim();
            this.conds.push({ field, op, value: this.coerce(value) });
            break;
          }
        }
      }
      return this;
    }

    private coerce(v: string): string | number {
      const n = Number(v);
      return v.trim() !== "" && !Number.isNaN(n) && /^\d+(\.\d+)?$/.test(v.trim()) ? n : v;
    }

    setLimit(n: number): FakeGR {
      this.limit = n;
      return this;
    }

    orderBy(field: string): FakeGR {
      this.orderField = field;
      this.orderDesc = false;
      return this;
    }

    orderByDesc(field: string): FakeGR {
      this.orderField = field;
      this.orderDesc = true;
      return this;
    }

    initialize(): void {
      this.buffer = {};
    }

    get(sysId: string): boolean {
      const row = (tables.get(this.tableName) ?? []).find((r) => r._sys_id === sysId);
      this.rows = row ? [row] : [];
      this.idx = this.rows.length > 0 ? 0 : -1;
      state.queryLog.push(`${this.tableName}.get(${sysId})`);
      return this.rows.length > 0;
    }

    query(): void {
      state.queryLog.push(`${this.tableName}?${this.conds.map((c) => `${c.field} ${c.op} ${c.value}`).join("^")}`);
      let rows = (tables.get(this.tableName) ?? []).filter((r) => this.matches(r));
      if (this.orderField) {
        rows = [...rows].sort((a, b) => {
          const av = String(a[this.orderField!] ?? "");
          const bv = String(b[this.orderField!] ?? "");
          if (this.orderDesc) return bv.localeCompare(av);
          return av.localeCompare(bv);
        });
      }
      if (this.limit) rows = rows.slice(0, this.limit);
      this.rows = rows;
      this.idx = -1;
    }

    private matches(r: FakeRecord): boolean {
      for (const c of this.conds) {
        const actual = r[c.field];
        const exp = c.value;
        switch (c.op) {
          case "=":
            if (String(actual ?? "") !== String(exp ?? "")) return false;
            break;
          case "!=":
            if (String(actual ?? "") === String(exp ?? "")) return false;
            break;
          case "IN": {
            const list = String(exp).split(",");
            if (list.indexOf(String(actual ?? "")) < 0) return false;
            break;
          }
          case "NOT IN": {
            const listNot = String(exp).split(",");
            if (listNot.indexOf(String(actual ?? "")) >= 0) return false;
            break;
          }
          case "CONTAINS":
          case "STARTSWITH": {
            const as = String(actual ?? "");
            const es = String(exp ?? "");
            if (c.op === "STARTSWITH" ? !as.startsWith(es) : as.indexOf(es) < 0) return false;
            break;
          }
          default: {
            if (String(actual ?? "") !== String(exp ?? "")) return false;
          }
        }
      }
      return true;
    }

    next(): boolean {
      this.idx++;
      return this.idx >= 0 && this.idx < this.rows.length;
    }

    getValue(field: string): unknown {
      const row = this.buffer ?? this.rows[this.idx];
      return row ? row[field] ?? null : null;
    }

    getDisplayValue(field: string): string {
      const row = this.buffer ?? this.rows[this.idx];
      if (!row) return "";
      return String(row[`${field}_display`] ?? row[field] ?? "");
    }

    setValue(field: string, value: unknown): FakeGR {
      if (this.buffer) {
        this.buffer[field] = value;
      } else {
        const row = this.rows[this.idx];
        if (row) row[field] = value;
        else this.buffer = { [field]: value };
      }
      return this;
    }

    insert(): string {
      const buf = this.buffer ?? {};
      const sysId = `si_${counter++}`;
      const record: FakeRecord = { _sys_id: sysId, sys_created_on: new Date().toISOString(), ...buf };
      const rows = tables.get(this.tableName) ?? [];
      rows.push(record);
      tables.set(this.tableName, rows);
      state.insertLog.push({ table: this.tableName, record: record });
      this.buffer = null;
      return sysId;
    }

    update(): boolean {
      const row = this.buffer ?? this.rows[this.idx];
      if (!row) return false;
      state.updateLog.push({ table: this.tableName, sys_id: String(row._sys_id) });
      return true;
    }

    deleteMultiple(): void {
      tables.set(this.tableName, []);
    }

    deleteRecord(): boolean {
      const row = this.buffer ?? this.rows[this.idx];
      if (!row) return false;
      const rows = tables.get(this.tableName) ?? [];
      const idx = rows.findIndex((r) => r._sys_id === row._sys_id);
      if (idx >= 0) rows.splice(idx, 1);
      state.deleteLog.push({ table: this.tableName, sys_id: String(row._sys_id) });
      return true;
    }

    getUniqueValue(): string {
      const row = this.buffer ?? this.rows[this.idx];
      return row ? String(row._sys_id) : "";
    }

    getRowCount(): number {
      return this.rows.length;
    }

    isValidRecord(): boolean {
      return this.idx >= 0 && this.idx < this.rows.length;
    }
  }

  type AggregateRow = Record<string, unknown>;
  class FakeAggregate {
    private readonly tableName: string;
    private readonly conds: Condition[] = [];
    private groupField?: string;
    private agg = "COUNT";
    private aggField?: string;
    private rows: AggregateRow[] = [];
    private idx = -1;

    constructor(table: string) {
      this.tableName = table;
    }

    addQuery(field: string, op?: unknown, value?: unknown): FakeAggregate {
      const cond: Condition = value === undefined
        ? { field, op: "=", value: op }
        : { field, op: String(op), value };
      this.conds.push(cond);
      return this;
    }

    addEncodedQuery(q: string): FakeAggregate {
      for (const part of String(q).split("^").filter(Boolean)) {
        for (const op of CONDITION_OPS) {
          const idx = part.indexOf(op);
          if (idx > 0) {
            this.conds.push({
              field: part.slice(0, idx).trim(),
              op,
              value: part.slice(idx + op.length).trim(),
            });
            break;
          }
        }
      }
      return this;
    }

    addAggregate(agg: string, field?: string): FakeAggregate {
      this.agg = String(agg).toUpperCase();
      this.aggField = field;
      return this;
    }

    groupBy(field: string): FakeAggregate {
      this.groupField = field;
      return this;
    }

    query(): void {
      const all = (tables.get(this.tableName) ?? []).filter((r) =>
        this.conds.every((c) => String(r[c.field] ?? "") === String(c.value ?? "") || (c.op === "IN" && String(c.value).split(",").includes(String(r[c.field] ?? "")))),
      );
      if (this.groupField) {
        const groups = new Map<string, AggregateRow[]>();
        for (const r of all) {
          const key = String(r[this.groupField] ?? "");
          const list = groups.get(key) ?? [];
          list.push(r);
          groups.set(key, list);
        }
        this.rows = Array.from(groups.entries()).map(([g, list]) => {
          const row: AggregateRow = { group: g };
          row.value = this.compute(list);
          return row;
        });
      } else {
        this.rows = [{ value: this.compute(all) }];
      }
      this.idx = -1;
    }

    private compute(list: Array<{ [k: string]: unknown }>): number | string {
      if (this.agg === "COUNT") return list.length;
      const values = list.map((r) => Number(r[this.aggField!] ?? 0));
      if (this.agg === "SUM") return values.reduce((a, b) => a + b, 0);
      if (this.agg === "AVG") return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      if (this.agg === "MIN") return values.length ? Math.min(...values) : 0;
      if (this.agg === "MAX") return values.length ? Math.max(...values) : 0;
      return 0;
    }

    next(): boolean {
      this.idx++;
      return this.idx >= 0 && this.idx < this.rows.length;
    }

    getAggregate(_agg: string): unknown {
      return this.rows[this.idx]?.value ?? null;
    }

    getValue(field: string): unknown {
      return this.rows[this.idx]?.[field] ?? null;
    }
  }

  class FakeGlideDateTime {
    private d = new Date();
    addDaysLocalTime(n: number): void {
      this.d.setDate(this.d.getDate() + n);
    }
    getValue(): string {
      return this.d.toISOString();
    }
  }

  class FakeGlideSysId {
    getSysId(): string {
      return `req_${counter++}`;
    }
  }

  const gs = {
    getUser: () => ({
      getID: () => user.sys_id,
      getName: () => user.name,
      getRoles: () => [...user.roles],
      hasRole: (r: string) => user.roles.includes(r),
    }),
    getUserID: () => user.sys_id,
    generateGUID: () => `guid_${counter++}`,
    getDateTimeStr: () => new Date().toISOString(),
    hasRole: (r: string) => user.roles.includes(r),
    getProperty: (_k: string, d?: string) => d,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };

  Object.assign(globalThis, {
    gs,
    GlideRecordSecure: FakeGR,
    GlideRecord: FakeGR,
    GlideAggregate: FakeAggregate,
    GlideDateTime: FakeGlideDateTime,
    GlideSysId: FakeGlideSysId,
  });

  return state;
}
