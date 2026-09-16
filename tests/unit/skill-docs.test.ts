import { describe, expect, test } from "bun:test";
import { allSkillDocs, skillDocsById } from "@open-now/skill-docs";
import { isWriteClass, type ConfirmationClass } from "@open-now/contracts";

const P1_IDS = [
  "sn.itsm.shift.briefing",
  "sn.itsm.incident.triage",
  "sn.itsm.incident.similar",
  "sn.itsm.incident.update",
  "sn.itsm.incident.major",
  "sn.itsm.problem.open",
  "sn.itsm.change.draft",
  "sn.itsm.change.assess_risk",
  "sn.itsm.change.cab_prep",
  "sn.itsm.change.implement",
  "sn.itsm.request.submit",
  "sn.itsm.request.fulfill",
  "sn.itsm.sla.at_risk",
  "sn.itom.alert.triage",
  "sn.itom.alert.correlate",
  "sn.cmdb.ci.find",
  "sn.cmdb.ci.blast_radius",
  "sn.cmdb.service.health",
  "sn.spm.portfolio.status",
  "sn.kb.answer",
  "sn.me.work",
  "sn.ops.report.aggregate",
];

const P2_IDS = [
  "sn.spm.project.prep",
  "sn.csm.case.briefing",
  "sn.csm.case.update",
  "sn.hrsd.case.handle",
  "sn.secops.sir.triage",
  "sn.secops.vuln.prioritize",
  "sn.platform.schema.describe",
  "sn.platform.update_set.review",
  "sn.platform.flow.run",
  "sn.platform.script.impact",
];

const DOMAIN_EXEC: Record<string, string> = {
  itsm: "ITSM",
  itom: "ITOM",
  cmdb: "CMDB",
  spm: "SPM",
  csm: "CSM",
  hrsd: "HRSD",
  secops: "SecOps",
  platform: "Platform",
  kb: "KB",
  me: "Me",
  ops: "Report",
};

describe("skill catalog integrity", () => {
  test("contains exactly the §6.1 catalog (22 P1 + 10 P2)", () => {
    expect(allSkillDocs.length).toBe(32);
    expect(allSkillDocs.map((d) => d.id).sort()).toEqual([...P1_IDS, ...P2_IDS].sort());
  });

  test("every doc id is unique and resolvable", () => {
    const ids = allSkillDocs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(skillDocsById[id]).toBeDefined();
  });

  test("priority matches the §6.1 index (P1 list)", () => {
    for (const id of P1_IDS) expect(skillDocsById[id]?.priority).toBe(1);
    for (const id of P2_IDS) expect(skillDocsById[id]?.priority).toBe(2);
  });

  test("write-class skills require describe and have an apply executable", () => {
    for (const doc of allSkillDocs) {
      if (!isWriteClass(doc.confirmation)) continue;
      expect(doc.policy?.requireDescribe, `${doc.id} must require describe`).toBe(true);
      expect(doc.executable.apply, `${doc.id} needs an apply method`).toBeTruthy();
    }
  });

  test("executable ref/plan follow the domain naming contract", () => {
    for (const doc of allSkillDocs) {
      const [, domain, ...rest] = doc.id.split(".");
      const exec = DOMAIN_EXEC[domain!];
      expect(exec, `no exec mapping for domain ${doc.id}`).toBeDefined();
      expect(doc.executable.ref, `${doc.id} ref`).toBe(`Exec${exec}`);
      const slug = rest.join("_");
      expect(doc.executable.plan, `${doc.id} plan`).toBe(`plan_${slug}`);
      if (isWriteClass(doc.confirmation)) {
        expect(doc.executable.apply, `${doc.id} apply`).toBe(`apply_${slug}`);
      }
    }
  });

  test("structured inputs only on HR/SecOps restricted skills", () => {
    const structured = allSkillDocs.filter((d) => d.structuredInputs).map((d) => d.id);
    expect(structured.sort()).toEqual(
      ["sn.hrsd.case.handle", "sn.secops.sir.triage", "sn.secops.vuln.prioritize"].sort(),
    );
  });

  test("autoApply only on allowed update_owned skills", () => {
    const auto = allSkillDocs.filter((d) => d.policy?.autoApply).map((d) => d.id);
    expect(auto.sort()).toEqual(["sn.csm.case.update", "sn.itsm.incident.update"].sort());
  });

  test("confirmation classes match the §6.1 catalog", () => {
    const expected: Record<string, ConfirmationClass> = {
      "sn.itsm.incident.update": "update_owned",
      "sn.itsm.incident.triage": "update_shared",
      "sn.itsm.incident.major": "update_shared",
      "sn.itsm.change.implement": "update_shared",
      "sn.itom.alert.correlate": "update_shared",
      "sn.itsm.problem.open": "create",
      "sn.itsm.change.draft": "create",
      "sn.itsm.request.submit": "create",
      "sn.itsm.request.fulfill": "approve",
      "sn.hrsd.case.handle": "restricted",
      "sn.secops.sir.triage": "restricted",
      "sn.secops.vuln.prioritize": "restricted",
      "sn.platform.flow.run": "execute",
    };
    for (const [id, cls] of Object.entries(expected)) {
      expect(skillDocsById[id]?.confirmation, id).toBe(cls);
    }
  });

  test("related skills point at existing catalog entries", () => {
    for (const doc of allSkillDocs) {
      for (const rel of doc.relatedSkills) {
        expect(skillDocsById[rel] ?? null, `${doc.id} -> ${rel}`).toBeTruthy();
      }
    }
  });

  test("every doc ships eval prompts", () => {
    for (const doc of allSkillDocs) {
      expect(doc.eval?.prompts?.length ?? 0, `${doc.id} needs eval prompts`).toBeGreaterThan(0);
    }
  });

  test("restricted skills are gated on the declared roles", () => {
    for (const doc of allSkillDocs.filter((d) => d.confirmation === "restricted")) {
      expect(doc.rolesAnyOf.length, doc.id).toBeGreaterThan(0);
    }
  });
});
