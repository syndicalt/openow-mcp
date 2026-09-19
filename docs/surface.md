# Surface plane — title-aware canvases

NowOS does not clone ServiceNow workspaces. A **surface** is an intent canvas
compiled for *this* operator: their `sys_user.title`, the skills they can
actually see, the work already on their plate. Jev classifies. Jev judges
components. The kernel still has four tools. Judgment still never writes.

## Session start

1. `dispatch_readonly` `sn.me.work` — instance returns queues **and** identity
   (`name`, `title`, `department`, `roles`) as the invoking user.
2. Kernel (when `OPEN_NOW_JUDGMENT` is `local` or `jev`) compiles a
   `SurfaceSpec` and attaches it to the result. Off (default) → no surface,
   eval goldens unchanged.
3. Later `discover` in the same session reuses that title. Components whose
   `skillId` is not in the discover candidate set are dropped. Discover still
   never invents a skill.

There is no `generate_ui` MCP tool.

## Jev, twice

| Pass | Type | Pack / question | Output |
|---|---|---|---|
| Classify | Choice | `open-now.surface.classify` | archetype (`incident_desk`, `change_cab`, `cmdb_ops`, `hr_agent`, `csm_agent`, `secops`, `spm`, `builder`, `executive`, `employee`) |
| Density | Score | sparse / working desk / command center | cap on how many cards the canvas may hold |
| Judge | Noul per candidate component | catalog `when` / `unless` | keep if `noul ≥ 0.42`, or if the instance already returned rows for that queue |

Classification reads **title first**, then department and roles. An admin token
does not get every chrome — HR and SecOps cards still require the named role
on the identity. Hidden fields stay hidden. Denied skills stay denied.

## What a `SurfaceSpec` is

A layout the renderer (Limina, a 2D canvas, a custom client) paints. Not HTML
from ServiceNow. Not UI Builder.

```
{
  archetype: "incident_desk",
  confidence: 0.81,
  density: 1.2,
  identity: { userId, name, title, department, roles },
  components: [
    { id: "header.identity", kind: "identity", region: "header", noul: 1, ... },
    { id: "queue.assigned", kind: "queue", region: "main", skillId: "sn.me.work", props: { rows } },
    { id: "card.incident_triage", kind: "card", region: "main", skillId: "sn.itsm.incident.triage", ... }
  ],
  skills: ["sn.me.work", "sn.itsm.incident.triage"]
}
```

`skills` is the dispatch allow-list for this canvas: a subset of what the
instance already offered.

## ACL-honest chrome

- No component for a skill the operator cannot discover.
- No HR / SIR card without the corresponding role on the identity.
- Queues only force-keep when `sn.me.work` actually returned rows.
- ConfirmGate remains an overlay card (`card.confirm_gate`) — never a 40-field
  modal — and `auto_ok` still does not apply.

## Renderer

This repo compiles the spec. It does not paint pixels. A surface runtime
(sibling) binds each `kind` to a component: queue, card, graph, briefing,
identity. Binding a component that is not in `skills` is a bug.
