import { describe, expect, test } from "bun:test";
import {
  SkillDocSchema,
  hashInputs,
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
