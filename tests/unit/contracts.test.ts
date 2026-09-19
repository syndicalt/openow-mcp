import { describe, expect, test } from "bun:test";
import {
  SkillDocSchema,
  ToolkitRequestSchema,
  ToolkitResponseSchema,
  SystemOneRequestSchema,
  SurfaceSpecSchema,
  hashInputs,
  isToolkitWrite,
  isWriteClass,
  type SkillDoc,
} from "@open-now/contracts";

const validDoc: SkillDoc = {
  id: "sn.itsm.incident.similar",
  name: "Find similar incidents",
  version: "1.0.0",
  status: "ga",
  persona: "fulfiller",
  intent: "Return the smallest set of prior records that would change what a fulfiller does next.",
  inputs: {
    incident_number: { type: "record_number", required: true },
    ci: { type: "string", required: false },
  },
  tablesRead: ["incident", "problem", "kb_knowledge", "cmdb_ci"],
  tablesWritten: [],
  rolesAnyOf: ["itil"],
  rolesAllOf: [],
  confirmation: "read",
  procedure: ["Load the incident by number.", "Search CI first, then keywords, then group."],
  sideEffects: [],
  returns: ["incidents", "problems", "articles"],
  relatedSkills: ["sn.itsm.incident.triage"],
  executable: { type: "script_include", ref: "ExecITSM", plan: "plan_incident_similar" },
  structuredInputs: false,
  priority: 1,
  eval: { prompts: ["Any similar incidents for this outage?"] },
};

describe("skill doc schema", () => {
  test("accepts a valid document", () => {
    expect(() => SkillDocSchema.parse(validDoc)).not.toThrow();
  });

  test("rejects an id that is not dotted", () => {
    expect(() => SkillDocSchema.parse({ ...validDoc, id: "incident" })).toThrow();
  });

  test("rejects a missing intent", () => {
    const { intent: _drop, ...rest } = validDoc;
    expect(() => SkillDocSchema.parse({ ...rest, intent: "too short" })).toThrow();
  });

  test("rejects an unknown confirmation class", () => {
    expect(() =>
      SkillDocSchema.parse({ ...validDoc, confirmation: "maybe" }),
    ).toThrow();
  });

  test("rejects absent tablesRead", () => {
    const { tablesRead: _drop, ...rest } = validDoc;
    expect(() => SkillDocSchema.parse(rest)).toThrow();
  });

  test("enforces required input defaults and enum values", () => {
    const parsed = SkillDocSchema.parse(validDoc);
    expect(parsed.tablesWritten).toEqual([]);
    expect(parsed.rolesAnyOf).toEqual(["itil"]);
  });
});

describe("confirmation classes", () => {
  test("read is not a write class, everything else is", () => {
    for (const cls of ["update_owned", "update_shared", "create", "approve", "execute", "deploy", "restricted"] as const) {
      expect(isWriteClass(cls)).toBe(true);
    }
    expect(isWriteClass("read")).toBe(false);
  });
});

describe("audit input hashing", () => {
  test("is order-independent", () => {
    expect(hashInputs({ a: 1, b: [2, 3] })).toBe(hashInputs({ b: [2, 3], a: 1 }));
  });

  test("differs on value changes", () => {
    expect(hashInputs({ a: 1 })).not.toBe(hashInputs({ a: 2 }));
  });

  test("is stable across runs", () => {
    expect(hashInputs({ incident_number: "INC0010001" })).toBe(
      hashInputs({ incident_number: "INC0010001" }),
    );
  });
});

describe("toolkit contract", () => {
  test("parses a toolkit request with defaults", () => {
    const req = ToolkitRequestSchema.parse({ op: "record_get", args: { table: "incident" } });
    expect(req.dryRun).toBe(false);
    expect(req.confirm).toBe(false);
    expect(req.clientApp).toBe("open-now");
  });

  test("rejects unknown ops", () => {
    expect(() => ToolkitRequestSchema.parse({ op: "nope" })).toThrow();
  });

  test("write class mapping per op", () => {
    expect(isToolkitWrite("record_get")).toBe(false);
    expect(isToolkitWrite("table_list")).toBe(false);
    expect(isToolkitWrite("run_script")).toBe(false);
    expect(isToolkitWrite("record_create")).toBe(true);
    expect(isToolkitWrite("record_update")).toBe(true);
    expect(isToolkitWrite("record_delete")).toBe(true);
    expect(isToolkitWrite("attachment_add")).toBe(true);
  });

  test("pending response envelope matches invoke contract", () => {
    const res = ToolkitResponseSchema.parse({
      outcome: "pending",
      confirmation: "update_shared",
      auditId: "audit-1",
      diff: [{ field: "state", before: "1", after: "2" }],
    });
    expect(res.outcome).toBe("pending");
    expect(res.diff?.[0]?.field).toBe("state");
  });
});

describe("judgment contract", () => {
  test("parses a mixed System One request", () => {
    const req = SystemOneRequestSchema.parse({
      state: { q: "smtp down" },
      questions: {
        skill: {
          type: "choice",
          instructions: "pick",
          criteria: { a: "one", b: "two" },
        },
        urgent: { type: "noul", instructions: "Is this urgent?" },
        severity: {
          type: "score",
          instructions: "severity",
          criteria: ["low", "high"],
        },
      },
    });
    expect(req.model).toBe("jev-latest");
    expect(req.questions["skill"]?.type).toBe("choice");
  });
});

describe("surface contract", () => {
  test("parses a compiled canvas", () => {
    const spec = SurfaceSpecSchema.parse({
      archetype: "incident_desk",
      confidence: 0.8,
      density: 1.1,
      identity: { userId: "u", name: "Ada", title: "Service Desk Analyst", roles: ["itil"] },
      components: [
        {
          id: "header.identity",
          kind: "identity",
          region: "header",
          title: "Operator",
          noul: 1,
          why: "identity chrome",
        },
      ],
      skills: ["sn.me.work"],
    });
    expect(spec.archetype).toBe("incident_desk");
    expect(spec.components[0]?.kind).toBe("identity");
  });
});
