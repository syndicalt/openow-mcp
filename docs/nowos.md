# NowOS

**NowOS is the operating system for work that ServiceNow already governs — without the ServiceNow UI.**

Open Now is not the product. Open Now is the **action kernel** of NowOS: four MCP tools, a skill catalog, and `sn_headless` as the invoking user. Everything a human or agent *sees* and *decides* lives outside the platform. Everything that *changes a record* still goes through ServiceNow ACLs, Business Rules, Data Policies, Flows, and ConfirmGate.

The platform experience is the thing we refuse to clone.

---

## Thesis

ServiceNow is a system of record, a system of action, and a security fabric. It is not a good system of *attention*. Forms, workspaces, and Now Assist keep the operator inside a UI that was designed for ITIL clerks, not for composable work.

NowOS inverts that:

| Role | Owner |
|---|---|
| Attention, composition, spatial layout | Surfaces (outside SN) |
| Typed, calibrated decisions | Judgment (Jev / local System One) |
| Governed mutation | Action (Open Now kernel → `sn_headless` → GlideRecordSecure) |
| Durable, cited memory | Memory (Eventloom / Zaxy) |

The operator never "logs into ServiceNow to do work." They inhabit a canvas that *already knows* what they can see and what they are allowed to change — because every projection and every write is the user's token, not a service account.

```
┌─────────────────────────────────────────────────────────────┐
│  SURFACES                                                    │
│  intent canvases · ACL-honest chrome · no SN forms           │
└───────────────┬───────────────────────────────┬─────────────┘
                │ discover / describe / dispatch│
                ▼                               ▼
┌───────────────────────────┐     ┌───────────────────────────┐
│  JUDGMENT                 │     │  MEMORY                   │
│  Jev Choice / Score / Noul│     │  Eventloom log            │
│  packs, never writes      │     │  Zaxy cited checkout      │
└─────────────┬─────────────┘     └─────────────┬─────────────┘
              │ advice                          │ recall
              ▼                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  ACTION  — Open Now (this repo)                              │
│  4 tools · skill catalog · ConfirmGate · OAuth PKCE          │
│  sn_headless as the invoking user                            │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
                    ServiceNow instance
              ACLs · BRs · Data Policies · Flows
```

---

## Invariants (non-negotiable)

These survive every surface, every model, every "just this once":

1. **No fifth MCP tool.** Judgment is internal. Memory is internal. The model-facing kernel stays `discover` / `describe` / `dispatch_readonly` / `dispatch`.
2. **No service account on the interactive path.** Per-user OAuth. GlideRecordSecure. If the user cannot see it in SN, the canvas cannot render it.
3. **Judgment never writes.** Jev may say `auto_ok`. The kernel still does not apply. ConfirmGate / the instance applier owns mutation.
4. **Discover never invents a skill.** Candidate set comes from the instance index. Judgment may only rerank.
5. **ACL-honest chrome.** Hidden fields stay hidden. Denied skills come back `denied`, not empty. Surfaces that fake completeness are bugs.
6. **Replay is the audit.** Same `requestId` twice → settled outcome. The applier never runs twice. Memory cites the run, it does not replace it.

---

## Planes

### Surface — composable UIs outside the system

Not a ServiceNow skin. Not UI Builder. Not a portal.

A surface is an **intent canvas**: a layout that compiles a `discover` result + `describe` contracts into the smallest honest UI for this user, this moment, this blast radius. Probabilistic form compilation — Jev scores which fields matter; the canvas hides the rest *only if the contract says they are optional and the ACL already hid them*.

First surfaces (build order, not vapor):

1. **Work canvas** — `sn.me.work` as a spatial queue, not a list view.
2. **Incident desk** — triage → update → resolve, ConfirmGate as a semantic card (`intent` noul + blast Score), never a modal of 40 fields.
3. **CMDB finder** — `sn.cmdb.ci.find` as a graph slice, not a reference qualifier.

Limina is the spatial runtime when a surface needs an actual world. Most work canvases are 2D and should stay 2D.

### Judgment — this stack, already in flight

See [`judgment.md`](judgment.md). Jev (TypeSafe System One) answers Choice / Score / Noul in tens to hundreds of milliseconds. The local engine is the CI-stable fallback. Packs are versioned data, same idea as skill docs.

NowOS uses judgment to:

- gate `discover` (`auto` / `pick` / `ask`)
- annotate pending diffs (`refuse` / `confirm` / `auto_ok`)
- compile surfaces (which contract fields to show)

It does not talk to the Table API. It does not hold a token.

### Action — Open Now (this repository)

The kernel, the 32-skill catalog, `sn_headless`, QueryGuard, RecordResolver, ConfirmGate. The only mutation path.

NowOS **must not** grow a parallel write channel. If a surface wants a new verb, it is a skill document + executable, or it is `raw:` behind QueryGuard.

### Memory — sibling, not in this repo

[Eventloom](https://github.com/syndicalt/eventloom) is the append-only log. [Zaxy](https://github.com/syndicalt/zaxy) is cited Memory Checkout over a temporal graph. NowOS journals `jev.answered`, `skill.discovered`, `dispatch.pending`, `dispatch.applied` into that log. The instance `sn_headless_run` table remains the legal audit; memory is for recall, not for compliance theater.

Pathlight traces the agent. Rava is agent auth when the caller is not a human OAuth session. Neither replaces SN ACLs.

---

## What NowOS is not

- Not Now Assist (that is an in-platform copilot; we leave the platform)
- Not a ServiceNow UI clone with nicer CSS
- Not an integration layer that syncs tables into a second database and writes back
- Not a chatbot with tools
- Not a fifth MCP server that "does AI"

If a design requires a service account, a shadow copy of `incident`, or a generated form that shows fields the user cannot write — it is not NowOS.

---

## Build sequence

| Beat | Where | Status |
|---|---|---|
| 0. Headless action kernel | this repo | v0.2 on `main` |
| 1. Judgment plane (Jev-shaped, default off) | PRs #2–#5 | in review |
| 2. Live proof on a PDI + Jev account | PR #6 | gated tests; needs instance + key |
| 3. NowOS thesis (this document) | this file | now |
| 4. First surface: work canvas over `sn.me.work` | sibling / later package | not started |
| 5. Wire Eventloom journal as the memory plane | zaxy + kernel journal | journal exists, not wired |
| 6. Incident desk as the first *hated-form* replacement | surface | not started |

PDI + Jev is the next *execution* beat. The thesis does not ship without a real instance proving: discover still returns only what the user can see, pending still does not apply, Jev still does not write.

---

## Naming

| Name | Meaning |
|---|---|
| **NowOS** | The operating system: surfaces + judgment + action + memory |
| **Open Now** | The action kernel (this repo). Stays named Open Now. |
| **sn_headless** | The in-instance runtime. Never a UI. |
| **Jev** | TypeSafe System One model. Judgment plane, not a product surface. |

Open Now remains the public MCP name so clients do not churn. NowOS is the product we are building toward.
