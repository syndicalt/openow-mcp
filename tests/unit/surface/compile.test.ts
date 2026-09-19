import { describe, expect, test } from "bun:test";
import { LocalJudgmentClient } from "@open-now/mcp-server";
import {
  classifyOperator,
  compileSurface,
  identityFrom,
} from "@open-now/mcp-server";
import type { OperatorIdentity } from "@open-now/contracts";

const judgment = new LocalJudgmentClient();

function ident(partial: Partial<OperatorIdentity>): OperatorIdentity {
  return {
    userId: "u_me",
    name: "Ada",
    title: "",
    roles: [],
    ...partial,
  };
}

describe("identityFrom", () => {
  test("reads instance snake_case identity", () => {
    const id = identityFrom({
      identity: { user_id: "abc", name: "Ada", title: "Service Desk Analyst", roles: ["itil"] },
      assigned: [],
    });
    expect(id).toEqual({
      userId: "abc",
      name: "Ada",
      title: "Service Desk Analyst",
      department: undefined,
      roles: ["itil"],
    });
  });

  test("returns undefined when there is no identity", () => {
    expect(identityFrom({ assigned: [] })).toBeUndefined();
  });
});

describe("classifyOperator (local engine)", () => {
  test("Service Desk Analyst → incident_desk", async () => {
    const c = await classifyOperator(judgment, ident({ title: "Service Desk Analyst", roles: ["itil"] }));
    expect(c.archetype).toBe("incident_desk");
    expect(c.confidence).toBeGreaterThan(0.3);
  });

  test("Change Manager → change_cab", async () => {
    const c = await classifyOperator(judgment, ident({ title: "Change Manager" }));
    expect(c.archetype).toBe("change_cab");
  });

  test("VP of Infrastructure → executive", async () => {
    const c = await classifyOperator(judgment, ident({ title: "VP of Infrastructure" }));
    expect(c.archetype).toBe("executive");
  });

  test("HR Business Partner → hr_agent", async () => {
    const c = await classifyOperator(judgment, ident({ title: "HR Business Partner" }));
    expect(c.archetype).toBe("hr_agent");
  });
});

describe("compileSurface", () => {
  test("incident desk canvas keeps identity + assigned queue, never HR chrome", async () => {
    const surface = await compileSurface(judgment, {
      identity: ident({ title: "Service Desk Analyst", roles: ["itil"] }),
      work: { assigned: [{ number: "INC0010001" }], approvals: [] },
    });
    expect(surface.archetype).toBe("incident_desk");
    const ids = surface.components.map((c) => c.id);
    expect(ids).toContain("header.identity");
    expect(ids).toContain("queue.assigned");
    expect(ids).not.toContain("card.hr_case");
    expect(ids).not.toContain("briefing.cab");
    const assigned = surface.components.find((c) => c.id === "queue.assigned");
    expect(assigned?.props).toEqual({ rows: [{ number: "INC0010001" }] });
  });

  test("executive canvas is sparse and skips the ticket mill", async () => {
    const surface = await compileSurface(judgment, {
      identity: ident({ title: "VP of Infrastructure" }),
    });
    expect(surface.archetype).toBe("executive");
    const ids = surface.components.map((c) => c.id);
    expect(ids).toContain("header.identity");
    expect(ids).not.toContain("card.incident_triage");
    expect(ids).not.toContain("card.incident_update");
    expect(surface.components.length).toBeLessThanOrEqual(6);
  });

  test("HR case chrome requires the HR role — title alone is not enough", async () => {
    const titled = await compileSurface(judgment, {
      identity: ident({ title: "HR Business Partner", roles: [] }),
    });
    expect(titled.components.map((c) => c.id)).not.toContain("card.hr_case");

    const gated = await compileSurface(judgment, {
      identity: ident({ title: "HR Business Partner", roles: ["sn_hr_core.case_writer"] }),
    });
    expect(gated.archetype).toBe("hr_agent");
    expect(gated.components.map((c) => c.id)).toContain("card.hr_case");
  });

  test("availableSkills is an ACL fence — never invent a skill", async () => {
    const surface = await compileSurface(judgment, {
      identity: ident({ title: "Service Desk Analyst", roles: ["itil"] }),
      availableSkills: ["sn.me.work"],
    });
    expect(surface.skills.every((s) => s === "sn.me.work")).toBe(true);
    expect(surface.components.some((c) => c.skillId === "sn.itsm.incident.triage")).toBe(false);
  });
});
