import { beforeAll, describe, expect, test } from "bun:test";
import { isWriteClass } from "@open-now/contracts";
import { allSkillDocs } from "@open-now/skill-docs";
import { installShim } from "../helpers/glide-shim.js";
import { installAllScriptIncludes } from "./load-script-includes.js";

/**
 * Contract check between the catalog (docs) and the instance executables:
 * every skill's plan (and apply for write-class) must exist on the matching
 * Exec class. This is the registry/runtime binding — missing methods surface
 * as `unsupported` at dispatch time.
 */
let registry: Record<string, unknown>;

beforeAll(() => {
  installShim();
  registry = installAllScriptIncludes();
});

describe("catalog <-> executable binding", () => {
  test("every Exec class referenced by the catalog is installed", () => {
    for (const doc of allSkillDocs) {
      const ref = doc.executable.ref!;
      expect(registry[ref], `${doc.id} -> ${ref}`).toBeDefined();
    }
  });

  test("plan methods exist for all 32 skills", () => {
    for (const doc of allSkillDocs) {
      const cls = registry[doc.executable.ref!] as { prototype?: Record<string, unknown> };
      expect(typeof cls?.prototype?.[doc.executable.plan!], `${doc.id}.${doc.executable.plan}`).toBe("function");
    }
  });

  test("apply methods exist for every write-class skill", () => {
    for (const doc of allSkillDocs) {
      if (!isWriteClass(doc.confirmation)) continue;
      const cls = registry[doc.executable.ref!] as { prototype?: Record<string, unknown> };
      expect(typeof cls?.prototype?.[doc.executable.apply!], `${doc.id}.${doc.executable.apply}`).toBe("function");
    }
  });
});
