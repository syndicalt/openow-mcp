# Wire contract — Open Now

This document is the authoritative client-side view of the Open Now wire
contract. The machine-checked source of truth lives in
`packages/contracts/src/` (Zod schemas); the JSON shapes below are copied from
those schemas and from `instance/sn_headless/app.json`. Wire format is JSON with
**camelCase keys exactly as defined in `@open-now/contracts`** — the instance
Scripted REST resources accept and return these shapes (the older
snake_case sketch in `docs/implementation-plan.md` is superseded by the
contracts package).

## 1. Instance endpoints

Scoped app `sn_headless` exposes six Scripted REST resources. Paths are
relative to the instance base URL, e.g.
`https://dev123456.service-now.com`. All responses are JSON; authentication is
an OAuth bearer token (`Authorization: Bearer <token>`).

| # | Method | Path | Purpose | Request shape | Response shape |
|---|--------|------|---------|---------------|----------------|
| 1 | GET | `/api/now/sn_headless/discover` | Semantic/keyword search over the skill + operation index | Query params `q` (string), `limit` (int, 1–25, default 10) | `DiscoverResult` — `{ results: [{ id, kind: "skill"\|"raw_operation"\|"table", score: number, why: string }] }`, max 25 items |
| 2 | GET | `/api/now/sn_headless/skills/{skillId}` | Technical contract for one skill | Path param `skillId` | `DescribePayload` — `{ doc: SkillDoc, available: boolean, reason?: string }` |
| 3 | POST | `/api/now/sn_headless/skills/{skillId}/invoke` | Execute a skill (planner and/or applier) | `InvokeRequest` — see §1.1 | `InvokeResponse` — see §1.2 |
| 4 | POST | `/api/now/sn_headless/raw` | Raw operation fallback (QueryGuard path) | `RawRequest` — see §1.3 | `FocusedPayload` — `Record<string, unknown>` (e.g. `{ rows, count, table, limit }`) |
| 5 | GET | `/api/now/sn_headless/runs/{requestId}` | Audit line + idempotency lookup | Path param `requestId` | `AuditRun` — see §4 |
| 6 | POST | `/api/now/sn_headless/import` | Admin-only seed/upsert of skill docs | `{ skills: SkillDoc[] }` | `200 OK`; JSON summary of upserted docs (counts, implementation-defined) |

### 1.1 InvokeRequest

```
{ skillId: string, inputs: Record<string, unknown>, clientApp: string,
  requestId?: string, dryRun?: boolean (default false), confirm?: boolean (default false) }
```

- `requestId` — idempotency key. Re-invoking the same `requestId` returns the
  stored outcome and never double-applies. Confirming a pending request
  requires the **same** `requestId`.
- `dryRun` — compute the planner (diff/draft) without applying.
- `confirm` — confirm a previously returned `pending` request (requires the
  same `requestId`); the server runs the applier.

### 1.2 InvokeResponse

```
{ outcome: "ok"|"pending"|"applied"|"denied"|"unsupported"|"error",
  confirmation: ConfirmationClass, focusedPayload?: Record<string, unknown>,
  diff?: [{ field, before, after }], draft?: { summary, fields },
  auditId: string, next?: string[], error?: string, message?: string,
  missingFields?: string[] }
```

### 1.3 RawRequest

```
{ table: string, query?: string, fields?: string[], limit?: int (1–100, default 25),
  aggregate?: "count"|"min"|"max"|"avg"|"sum", groupBy?: string, orderBy?: string }
```

Raw operations never exceed `limit` (hard max 100), are field-allowlisted per
table, and are the only path that may touch the Table API — the kernel never
calls it directly.

## 2. Kernel MCP tools (Surface A — now/headless)

The kernel exports exactly four stable tools. `KernelResult` for each is
`{ ok: boolean, text: string, data?: <parsed payload> }`; `ok` means the tool
call itself succeeded (an in-band `denied` outcome is still `ok: true`).

| Tool | Args | Description |
|------|------|-------------|
| `discover` | `{ q: string, limit?: int (1–25, default 10) }` | Semantic search over the operation + skill index. Query is the agent's restatement of user intent. Returns ranked skill IDs and raw operations with score and a one-line `why`. |
| `describe` | `{ skillId: string }` | Return the technical contract for a skill: inputs, encoded-query hints, required roles, side-effect class (read/update/create/approve/execute/deploy), confirmation policy, related skills. **Required before `dispatch` of write-class skills** (enforced when `requireDescribe` is on). |
| `dispatch_readonly` | `{ skillId: string, inputs?: Record<string, unknown>, requestId?: string }` | GET-equivalent only. Queries, aggregates, schema, relationship walks, KB search. Never mutates. Prefer this whenever the skill is read-shaped. |
| `dispatch` | `{ skillId: string, inputs?: Record<string, unknown>, requestId?: string, dryRun?: boolean, confirm?: boolean }` or, for raw ops, `skillId: "raw:<table>"` plus `{ table?, query?, fields?, limit?, aggregate?, groupBy?, orderBy? }` | Invoke the skill or operation; enforces the confirmation policy. Write-class skills return `pending` + diff unless `confirm: true` with the same `requestId`. Raw operations use `skillId: "raw:<table>"` with the RawRequest fields at the top level. |

The raw dispatch of `raw:<table>` resolves to a read-style `ok` payload (see
the delete-refusal golden path); raw writes are the `update_shared`
confirmation class — always show a diff, never delete silently.

## 3. Confirmation flow

```
sequenceDiagram
  participant C as Client (MCP host)
  participant K as Kernel (open-now mcp-server)
  participant G as InstanceGateway
  participant R as sn_headless runtime

  C->>K: describe(skillId)
  K->>G: GET /api/now/sn_headless/skills/{skillId}
  G->>R: load doc + role check
  R-->>G: DescribePayload { doc, available }
  G-->>K: payload
  K-->>C: technical contract

  C->>K: dispatch({ skillId, inputs, requestId })
  K->>G: POST /api/now/sn_headless/skills/{skillId}/invoke
  G->>R: planner only (dryRun/confirm semantics)
  R-->>G: outcome=pending + diff/draft
  G-->>K: InvokeResponse
  K-->>C: pending diff (nothing written)
  Note over R: audit row written on every invoke

  C->>K: dispatch({ skillId, inputs, requestId, confirm: true })
  K->>G: POST .../invoke (same requestId, confirm:true)
  G->>R: applier runs (GlideRecordSecure)
  R-->>G: outcome=applied + recordNumbers + focusedPayload
  G-->>K: InvokeResponse
  K-->>C: applied (with record numbers, next skills)
  Note over R: sn_headless_run audit row (outcome=applied)
```

Write-class + no `confirm` → planner only → `pending` + diff (or `draft` for
create-class). `confirm: true` with the same `requestId` → applier → `applied`.
Read-class and refused writes never mutate.

## 4. Audit fields (`sn_headless_run`)

From `packages/contracts/src/audit.ts` (one row per invoke, mandatory):

| Field | Type | Notes |
|-------|------|-------|
| `requestId` | string | idempotency key |
| `skillId` | string | dotted skill id or `raw:<table>` |
| `skillVersion` | string | semver of the executed doc |
| `user` | string | sys_id of the acting user |
| `clientApp` | string | registered client identification |
| `inputsHash` | string | canonical FNV-1a hash of the inputs |
| `tablesTouched` | string[] | default `[]` |
| `recordNumbers` | string[] | default `[]` |
| `queryHash` | string? | normalized query hash (raw/query skills) |
| `outcome` | ok/pending/applied/denied/unsupported/error | |
| `error` | string? | only for `error` outcome |
| `latencyMs` | number | server-side latency |
| `tokenApp` | string? | Assist/token attribution |
| `resultSummary` | string? | focused human summary |
| `createdAt` | string | ISO timestamp |

## 5. Error semantics

Outcomes returned over HTTP 200 shape the agent's behavior; transport-level
failures throw `GatewayError` (kernel returns `ok: false` + text).

| Outcome | Meaning | Client behavior |
|---------|---------|-----------------|
| `denied` | Role check failed (also surfaced for instance ACL 403s by the runtime) with a `message` explaining which roles are required | Stop; explain to the user; do NOT retry the same skill, do NOT fall back to raw reads |
| `unsupported` | Skill/operation exists but depends on a module/table that is absent (`featureDeps`) | Degrade or report; never treat as a bug |
| `error` | Runtime failure; `error` carries details | Report; a retry with the same `requestId` is safe (idempotent) |
| `ok` | Read completed | Render the focused payload |
| `pending` | Write-class; planner computed diff/draft, nothing applied | Confirm or abort; re-dispatch with `confirm: true` + same `requestId` |
| `applied` | Applier ran (after confirm or auto-apply) | Render `recordNumbers` + focused payload; audit row exists |

Rule of thumb inherited from spec §4.5: if the instance returns a 403, explain
the denial in-band and stop — never impersonate another user or bypass ACLs.

## 6. Confirmation policy classes (spec §4.4)

| Class | Examples | Client behavior |
|-------|----------|-----------------|
| `read` | Get incident, walk CI relations, KB search | No confirm. Return focused payload. |
| `update_owned` | Work note on assigned incident, close after resolution notes | Optional silent apply if policy allows; otherwise show diff. |
| `update_shared` | Reassign group, change priority, add CAB date | Always show proposed field diff. Wait for user yes. |
| `create` | Open incident, submit catalog request, draft change | Show draft record. Wait for yes. Return number. |
| `approve` | Approve change, request, HR case | Show record + policy. Dual-confirm. Never batch-approve silently. |
| `execute` | Run a Flow, execute a scripted action, kick Discovery | Describe side effects. Wait for yes. |
| `deploy` | Commit update set, publish Flow, modify ACL | Sandbox-first. Production requires a second person or change request link. |
| `restricted` | HR, SecOps, Legal, any delete | Skill available only if role present. Always confirm. Default deny on delete. |

## 7. Toolkit surface (generated wide surface, instance §3.4/§8.3)

### 7.1 Endpoint

| Method | Path | Purpose | Body | Response |
|---|---|---|---|---|
| POST | `/api/now/sn_headless/toolkit` | Metadata-driven table/record/script/attachment operations | `ToolkitRequest` — `{ op, args?, clientApp?, requestId?, dryRun?, confirm? }` | `InvokeResponse` envelope — same as skill invokes: `{ outcome: ok\|pending\|applied\|denied\|error\|unsupported, confirmation, diff?, draft?, focusedPayload, auditId, message? }` |

### 7.2 Operations

| Op | Args | Confirmation | Behavior |
|---|---|---|---|
| `table_list` | `{ pattern?, limit? }` | read | Metadata list from `sys_db_object` |
| `table_schema` | `{ table }` | read | Fields from `sys_dictionary` (name/label/type/reference/read-only) |
| `record_get` | `{ table, sys_id\|number\|record }` | read | One record; role-gated on HR/SecOps tables |
| `record_create` | `{ table, values }` | create | Draft first; insert on confirm |
| `record_update` | `{ table, sys_id\|number\|record, values }` | update_shared | Field diff first; update on confirm |
| `record_delete` | `{ table, sys_id\|number\|record }` | restricted | Always confirm — default deny on delete |
| `aggregate_report` | `{ table, aggregate, field?, groupBy?, query? }` | read | Server-side COUNT/AVG/MIN/MAX/SUM via GlideAggregate |
| `run_script` | `{ script }` | read | eval in the scoped runtime; result string (capped 4000 chars) |
| `attachment_list` | `{ table, sys_id\|number\|record }` | read | `sys_attachment` rows for the record |
| `attachment_add` | `{ table, sys_id\|number\|record, file_name, content_type?, content? }` | create | Draft then attach (base64 content) |

### 7.3 Kernel exposure

- Generic mode (default): 10 tools named after the ops (`table_list`, `record_get`, `record_create`, `record_update`, `record_delete`, `aggregate_report`, `run_script`, `attachment_list`, `attachment_add`, `table_schema`). Writes return `pending` unless `confirm: true` with the same `requestId`; applied once, then replayed idempotently.
- Table mode (`OPEN_NOW_TOOLKIT=table`): generated `tbl_<table>_{query,get,create,update,delete}` per allowlisted table; `tbl_<table>_query` routes through `raw` (QueryGuard), the rest through the corresponding toolkit ops with `table` fixed.
- All toolkit tools are protocol-only: every op executes in the instance with QueryGuard/ConfirmGate/audit; a `denied` (restricted table without role) is fail-closed.
