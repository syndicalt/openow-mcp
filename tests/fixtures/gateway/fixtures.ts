import type { SkillDoc } from "@open-now/contracts";
import { MockGateway, type MockGatewayOptions } from "@open-now/mcp-server";

const READ_SKILLS: Record<string, Partial<SkillDoc>> = {
  "sn.me.work": {
    confirmation: "read",
    relatedSkills: ["sn.itsm.incident.triage"],
  },
  "sn.itsm.shift.briefing": { confirmation: "read" },
  "sn.itsm.change.cab_prep": { confirmation: "read" },
  "sn.cmdb.ci.find": { confirmation: "read" },
};

/** The mock gateway configuration shared by kernel tests and the eval runner. */
export function standardMockGateway(): MockGateway {
  const opts: MockGatewayOptions = {
    user: { sys_id: "u_me", name: "Ada", roles: ["itil"] },
    skills: {
      ...READ_SKILLS,
      "sn.itsm.incident.update": {
        confirmation: "update_owned",
        rolesAnyOf: ["itil"],
        relatedSkills: ["sn.itsm.incident.similar"],
        policy: { requireDescribe: true, autoApply: true },
      },
      "sn.hrsd.case.handle": {
        confirmation: "restricted",
        structuredInputs: true,
        rolesAnyOf: ["sn_hr_core.case_writer"],
      },
    },
    focused: {
      "sn.me.work": {
        identity: {
          user_id: "u_me",
          name: "Ada",
          title: "Service Desk Analyst",
          department: "IT",
          roles: ["itil"],
        },
        assigned: [{ number: "INC0010001", short_description: "printer on fire" }],
        approvals: [],
        watches: [],
        requested_for: [],
      },
      "sn.itsm.shift.briefing": {
        at_risk: [],
        unassigned: [],
        mine: [{ number: "INC0010001" }],
        majors: [],
        changes_today: [],
        first_actions: ["triage INC0010001"],
      },
      "sn.cmdb.ci.find": {
        match: { sys_id: "ci_web_001", name: "web-prod-01" },
        candidates: [
          { sys_id: "ci_web_001", name: "web-prod-01", class: "cmdb_ci_server" },
          { sys_id: "ci_web_002", name: "web-prod-02", class: "cmdb_ci_server" },
        ],
        ambiguous: true,
      },
    },
    discover: [
      { id: "sn.me.work", kind: "skill", score: 0.96, why: "my work, approvals, watches" },
      { id: "sn.itsm.shift.briefing", kind: "skill", score: 0.9, why: "shift start queue briefing" },
      { id: "raw:incident", kind: "raw_operation", score: 0.4, why: "raw table access fallback" },
    ],
    raw: {
      table: "incident",
      rows: [
        { number: "INC0010001", short_description: "printer on fire", state: "1" },
      ],
      count: 1,
    },
  };
  return new MockGateway(opts);
}

export { READ_SKILLS };
