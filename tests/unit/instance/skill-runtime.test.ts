import { beforeAll, describe, expect, test } from "bun:test";
import { installShim, type ShimState } from "../helpers/glide-shim.js";
import { installAllScriptIncludes } from "./load-script-includes.js";

let state: ShimState;
let Runtime: new () => { invoke: (req: Record<string, unknown>) => Record<string, unknown>; loadDoc: (id: string) => unknown };

function skillRow(id: string, confirmation: string, executable: Record<string, string>, extra: Record<string, unknown> = {}) {
  return {
    sys_id: `skill_${id}`,
    id,
    name: id,
    version: "1.0.0",
    status: "ga",
    confirmation,
    executable: executable.type,
    executable_ref: executable.ref,
    roles_any_of: ((extra.rolesAnyOf as string[]) ?? []).join(","),
    roles_all_of: "",
    active: true,
    doc_json: JSON.stringify({
      id,
      confirmation,
      executable,
      inputs: (extra.inputs as Record<string, unknown>) ?? {},
      policy: (extra.policy as Record<string, unknown>) ?? {},
      relatedSkills: (extra.relatedSkills as string[]) ?? [],
      tablesRead: (extra.tablesRead as string[]) ?? [],
      structuredInputs: (extra.structuredInputs as boolean) ?? false,
    }),
  };
}

beforeAll(() => {
  state = installShim({
    user: { sys_id: "u_me", name: "Ada", roles: ["itil"], title: "Service Desk Analyst", department: "IT" },
    records: {
      incident: [
        {
          sys_id: "inc_1",
          number: "INC0010001",
          short_description: "printer on fire",
          state: "1",
          active: true,
          assigned_to: "u_me",
          work_notes: "",
          comments: "",
          priority: "3",
        },
      ],
      sys_user_grmember: [{ sys_id: "gm_1", user: "u_me", group: "g_svc" }],
      sys_user_group: [{ sys_id: "g_svc", name: "Service Desk" }],
      task_sla: [
        { sys_id: "sla_1", task: "inc_1", has_breached: false, business_percentage: 90, planned_end_time: "2026-09-17 10:00:00" },
      ],
      sysapproval_approver: [
        { sys_id: "ap_1", approver: "u_me", state: "pending", document_id: "inc_1", sysapproval: true },
      ],
      sn_headless_skill: [
        skillRow("sn.me.work", "read", { type: "script_include", ref: "ExecMe", plan: "plan_work" }, {
          inputs: {},
          relatedSkills: ["sn.itsm.incident.triage"],
          tablesRead: ["incident", "sysapproval_approver"],
        }),
        skillRow("sn.itsm.incident.update", "update_owned", { type: "script_include", ref: "ExecITSM", plan: "plan_incident_update", apply: "apply_incident_update" }, {
          inputs: {
            incident_number: { type: "record_number", required: true },
            mode: { type: "enum", required: true, enum: ["comment", "work_note", "resolve"] },
            body: { type: "string", required: false },
            resolution_code: { type: "string", required: false },
            resolution_notes: { type: "string", required: false },
          },
          policy: { requireDescribe: true },
          tablesRead: ["incident"],
          tablesWritten: ["incident"],
        }),
        skillRow("sn.hrsd.case.handle", "restricted", { type: "script_include", ref: "ExecHRSD", plan: "plan_case_handle" }, {
          inputs: { case_number: { type: "record_number", required: true } },
          rolesAnyOf: ["sn_hr_core.case_writer"],
          structuredInputs: true,
          tablesRead: ["hr_case"],
        }),
      ],
      sn_headless_run: [],
    },
  });
  installAllScriptIncludes();
  Runtime = (globalThis as Record<string, unknown>).SkillRuntime as typeof Runtime;
});

function invoke(req: Record<string, unknown>) {
  return new Runtime().invoke(req);
}

describe("SkillRuntime end-to-end (shim)", () => {
  test("me.work (read) returns a focused payload and never mutates", () => {
    const res = invoke({ skillId: "sn.me.work", inputs: {}, clientApp: "test" });
    expect(res.outcome).toBe("ok");
    const payload = res.focusedPayload as Record<string, unknown>;
    expect(JSON.stringify(payload)).toContain("INC0010001");
    const identity = payload.identity as { title?: string; name?: string };
    expect(identity.title).toBe("Service Desk Analyst");
    expect(identity.name).toBe("Ada");
    expect(state.updateLog.length).toBe(0);
    expect((res.auditId as string).length).toBeGreaterThan(0);
  });

  test("incident.update: pending diff, then confirm applies exactly once, then replays", () => {
    const inputs = { incident_number: "INC0010001", mode: "work_note", body: "rebooted the server" };
    const pending = invoke({
      skillId: "sn.itsm.incident.update",
      inputs,
      clientApp: "test",
      requestId: "req-e2e-1",
    });
    expect(pending.outcome).toBe("pending");
    expect((pending.diff as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
    expect(state.updateLog.length).toBe(0);

    const applied = invoke({
      skillId: "sn.itsm.incident.update",
      inputs,
      clientApp: "test",
      requestId: "req-e2e-1",
      confirm: true,
    });
    expect(applied.outcome).toBe("applied");
    expect(
      (applied.focusedPayload as { record_numbers?: string[] })?.record_numbers,
    ).toContain("INC0010001");

    const replay = invoke({
      skillId: "sn.itsm.incident.update",
      inputs,
      clientApp: "test",
      requestId: "req-e2e-1",
      confirm: true,
    });
    expect(replay.outcome).toBe("applied");
    const updates = state.updateLog.filter((u) => u.table === "incident");
    expect(updates.length).toBe(1);
  });

  test("resolve requires resolution_code + resolution_notes", () => {
    const res = invoke({
      skillId: "sn.itsm.incident.update",
      inputs: { incident_number: "INC0010001", mode: "resolve", body: "fixed" },
      clientApp: "test",
      requestId: "req-e2e-2",
    });
    expect(res.outcome).toBe("error");
    expect((res.missingFields as string[]).sort()).toEqual(["resolution_code", "resolution_notes"]);
  });

  test("restricted HR skill denies an itil user before any table access", () => {
    const res = invoke({
      skillId: "sn.hrsd.case.handle",
      inputs: { case_number: "HRC0010001" },
      clientApp: "test",
    });
    expect(res.outcome).toBe("denied");
    expect(String(res.message)).toContain("sn_hr_core.case_writer");
  });

  test("unknown skill is unsupported, not an error", () => {
    const res = invoke({ skillId: "sn.nope.thing", inputs: {}, clientApp: "test" });
    expect(res.outcome).toBe("unsupported");
  });
});
