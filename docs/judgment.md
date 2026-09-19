# Judgment plane (System One)

The kernel is protocol. ServiceNow is the system of action. This document is
the **judgment plane** of [NowOS](nowos.md): typed, calibrated decisions that software can branch
on, without adding a fifth MCP tool and without a service account.

**Invariant:** Jev (or the local engine) never writes. The only mutation path
is `dispatch` / toolkit writes through `sn_headless` as the invoking user.

## Why this exists

`discover` already ranks skills. ConfirmGate already holds writes. Both are
either lexical (mock) or instance-side. Neither answers:

- *Is this the skill the operator meant, and how sure are we?*
- *Does this pending diff match the stated intent, and what is the blast radius?*

Those are System One questions: Choice, Score, Noul — the [Jev / TypeSafe](https://docs.typesafe.ai/introduction)
shape. Code composes the answers. The MCP surface stays four tools.

## Modes

| `OPEN_NOW_JUDGMENT` | Behavior |
|---|---|
| `off` (default) | Kernel behavior identical to v0.2. Eval goldens stay deterministic. |
| `local` | Offline engine in `packages/mcp-server/src/judgment/engine.ts`. Same request/response contract. CI-safe. |
| `jev` | POST `https://api.typesafe.ai/v1/systemone` with `TYPESAFE_API_KEY`. On HTTP/parse failure, falls back to `local` so the kernel does not fail closed. |

Optional journal: `OPEN_NOW_JOURNAL_PATH` — JSONL events `jev.answered`,
`skill.discovered`, `dispatch.pending`, `dispatch.applied`.

## Discover

Gateway `discover` remains the **candidate set**. Judgment may only rerank
those ids. It cannot invent a skill. `raw:*` stays a candidate and is never
`gate=auto`.

Gates:

- `auto` — high confidence winner; a client *may* `describe` + `dispatch_readonly` without a picker
- `pick` — show the top few
- `ask` — do not invent a tool; ask the operator

Blend: `0.4 * gateway_score + 0.6 * P(skill)`.

## Confirm

On `outcome: pending`, the kernel asks the `open-now.dispatch.confirm` pack
and annotates the preview:

- `refuse` — tell the client not to confirm (empty resolve notes, unrelated diff)
- `confirm` — default; human or client must send `confirm: true`
- `auto_ok` — owned + high intent + low blast. **The kernel still does not apply.** ConfirmGate / the instance applier owns the write. `auto_ok` is advice for surfaces that already honor `update_owned` + `autoApply`.

Restricted / approve / execute / deploy classes are never `auto_ok`.

## Packs

Versioned in `packages/mcp-server/src/judgment/packs.ts`, same idea as skill
docs: data, not prompt soup.

- `open-now.dispatch.confirm`
- `open-now.itsm.incident.triage`

## What this is not

- Not a chat model in the kernel
- Not Now Assist
- Not a bypass of ACLs, QueryGuard, or ConfirmGate
- Not a fifth MCP tool (`judge` / `jev.evaluate` is internal)
