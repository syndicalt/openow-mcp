import type { SurfaceArchetype, UiComponentKind, UiRegion } from "@open-now/contracts";

/**
 * Component catalog for NowOS canvases. Each entry is a named region of
 * attention — not a ServiceNow widget. `archetypes` is the allow-list after
 * Jev classifies the operator's title. `rolesAnyOf` is ACL-honest chrome:
 * we never render a component the operator's roles cannot back.
 */
export interface UiComponentDef {
  id: string;
  kind: UiComponentKind;
  region: UiRegion;
  title: string;
  skillId?: string;
  archetypes: SurfaceArchetype[];
  rolesAnyOf?: string[];
  always?: boolean;
  when: string;
  unless: string;
}

const ALL: SurfaceArchetype[] = [
  "incident_desk",
  "change_cab",
  "cmdb_ops",
  "hr_agent",
  "csm_agent",
  "secops",
  "spm",
  "builder",
  "executive",
  "employee",
];

export const UI_COMPONENT_CATALOG: UiComponentDef[] = [
  {
    id: "header.identity",
    kind: "identity",
    region: "header",
    title: "Operator",
    archetypes: ALL,
    always: true,
    when: "always show the operator name and title",
    unless: "never hide identity chrome",
  },
  {
    id: "queue.assigned",
    kind: "queue",
    region: "main",
    title: "Assigned to me",
    skillId: "sn.me.work",
    archetypes: ["incident_desk", "cmdb_ops", "secops", "csm_agent", "builder", "employee"],
    when: "open work assigned to this operator, service desk queue, incidents on my plate",
    unless: "executive briefing only, no personal ticket queue, empty assignment",
  },
  {
    id: "queue.approvals",
    kind: "queue",
    region: "main",
    title: "Waiting on me",
    skillId: "sn.me.work",
    archetypes: ["employee", "executive", "change_cab", "spm", "builder"],
    when: "pending approvals, CAB vote, catalog request waiting, manager sign-off",
    unless: "no approval authority, pure fulfiller with nothing to sign",
  },
  {
    id: "queue.sla_at_risk",
    kind: "queue",
    region: "rail",
    title: "SLA at risk",
    skillId: "sn.itsm.sla.at_risk",
    archetypes: ["incident_desk", "executive", "csm_agent"],
    when: "breaching SLA, at-risk tickets, time left, service desk shift",
    unless: "no SLA ownership, requester employee, builder working update sets",
  },
  {
    id: "briefing.shift",
    kind: "briefing",
    region: "header",
    title: "Shift briefing",
    skillId: "sn.itsm.shift.briefing",
    archetypes: ["incident_desk", "cmdb_ops"],
    when: "start of shift, overnight aged, unassigned in my groups, majors open, changes today",
    unless: "not a fulfiller, executive portfolio, HR case work",
  },
  {
    id: "briefing.cab",
    kind: "briefing",
    region: "main",
    title: "CAB prep",
    skillId: "sn.itsm.change.cab_prep",
    archetypes: ["change_cab"],
    when: "change advisory board, risk, collision, schedule, approve changes",
    unless: "incident queue, HR, requester",
  },
  {
    id: "briefing.portfolio",
    kind: "briefing",
    region: "main",
    title: "Portfolio",
    skillId: "sn.spm.portfolio.status",
    archetypes: ["executive", "spm"],
    when: "portfolio status, program health, executive summary, no ticket forms",
    unless: "hands-on incident desk, service desk analyst",
  },
  {
    id: "card.incident_triage",
    kind: "card",
    region: "main",
    title: "Triage",
    skillId: "sn.itsm.incident.triage",
    archetypes: ["incident_desk"],
    when: "new unclassified incident, categorize prioritize assign, service desk",
    unless: "executive, HR, change CAB only",
  },
  {
    id: "card.incident_update",
    kind: "card",
    region: "rail",
    title: "Update an incident",
    skillId: "sn.itsm.incident.update",
    archetypes: ["incident_desk"],
    when: "work note, comment, resolve an owned incident",
    unless: "no ITIL fulfiller work, requester only",
  },
  {
    id: "card.confirm_gate",
    kind: "confirm",
    region: "overlay",
    title: "ConfirmGate",
    archetypes: ["incident_desk", "change_cab", "cmdb_ops", "hr_agent", "csm_agent", "secops", "builder"],
    when: "a write is pending, blast radius, intent noul, never a 40-field modal",
    unless: "read-only executive briefing, no writes in this moment",
  },
  {
    id: "graph.blast_radius",
    kind: "graph",
    region: "main",
    title: "What breaks",
    skillId: "sn.cmdb.ci.blast_radius",
    archetypes: ["cmdb_ops", "change_cab", "incident_desk"],
    when: "CI change impact, related services, blast radius walk, what breaks if this CI changes",
    unless: "HR case, catalog request, no CMDB access",
  },
  {
    id: "card.ci_find",
    kind: "card",
    region: "rail",
    title: "Find a CI",
    skillId: "sn.cmdb.ci.find",
    archetypes: ["cmdb_ops", "builder", "incident_desk", "change_cab"],
    when: "look up configuration item by name hostname serial",
    unless: "HR, employee requester",
  },
  {
    id: "card.hr_case",
    kind: "card",
    region: "main",
    title: "HR case",
    skillId: "sn.hrsd.case.handle",
    archetypes: ["hr_agent"],
    rolesAnyOf: ["sn_hr_core.case_writer"],
    when: "HR case, people operations, restricted structured inputs, no raw HR table",
    unless: "ITIL incident desk, executive, no HR role",
  },
  {
    id: "card.sir_triage",
    kind: "card",
    region: "main",
    title: "Security incident",
    skillId: "sn.secops.sir.triage",
    archetypes: ["secops"],
    rolesAnyOf: ["sn_si.analyst", "sn_si.admin"],
    when: "security incident SIR threat SOC",
    unless: "service desk ITIL only, HR, employee",
  },
  {
    id: "card.request_submit",
    kind: "action",
    region: "rail",
    title: "Request something",
    skillId: "sn.itsm.request.submit",
    archetypes: ["employee"],
    when: "catalog request, order something, how do I get a laptop",
    unless: "fulfiller incident desk, CAB manager, already a ticket agent",
  },
  {
    id: "card.kb_answer",
    kind: "card",
    region: "rail",
    title: "Knowledge",
    skillId: "sn.kb.answer",
    archetypes: ["employee", "incident_desk", "csm_agent"],
    when: "how-to, knowledge article, answer from KB before opening a ticket",
    unless: "major incident command, CAB risk assessment",
  },
];
