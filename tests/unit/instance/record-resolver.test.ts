import { beforeAll, describe, expect, test } from "bun:test";
import { installShim } from "../helpers/glide-shim.js";
import { loadScriptInclude } from "./load-script-includes.js";

let RecordResolver: new () => {
  resolveRecord: (table: string, value: string) => Record<string, unknown> | null;
  findCi: (input: string, classFilter?: string) => Record<string, unknown>;
};

beforeAll(() => {
  installShim({
    records: {
      incident: [
        { sys_id: "inc_1", number: "INC0010001", short_description: "printer on fire" },
        { sys_id: "inc_2", number: "INC0010002", short_description: "disk full" },
      ],
      cmdb_ci: [
        {
          sys_id: "ci_web_01",
          name: "web-prod-01",
          sys_class_name: "cmdb_ci_server",
          serial_number: "SN-WEB-01",
        },
        {
          sys_id: "ci_web_02",
          name: "web-prod-02",
          sys_class_name: "cmdb_ci_server",
          serial_number: "SN-WEB-02",
        },
        {
          sys_id: "ci_app_01",
          name: "app_sap_prod",
          sys_class_name: "cmdb_ci_appl",
        },
      ],
    },
  });
  RecordResolver = loadScriptInclude("RecordResolver") as typeof RecordResolver;
});

describe("RecordResolver", () => {
  test("resolves a record number to its sys_id via GlideRecordSecure", () => {
    const r = new RecordResolver().resolveRecord("incident", "INC0010001");
    expect(r?.sys_id).toBe("inc_1");
    expect(r?.number).toBe("INC0010001");
  });

  test("resolves a sys_id directly", () => {
    expect(new RecordResolver().resolveRecord("incident", "inc_2")?.number).toBe("INC0010002");
  });

  test("returns null for unknown numbers (no guess)", () => {
    expect(new RecordResolver().resolveRecord("incident", "INC9999999")).toBeNull();
  });

  test("findCi exact name returns a single match", () => {
    const r = new RecordResolver().findCi("web-prod-01");
    expect(r.match?.sys_id).toBe("ci_web_01");
    expect(r.ambiguous).toBe(false);
  });

  test("findCi substring returns candidates, never guesses", () => {
    const r = new RecordResolver().findCi("web-prod");
    expect(r.match).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.candidates.length).toBe(2);
  });

  test("findCi honors class filters", () => {
    const r = new RecordResolver().findCi("prod", "cmdb_ci_server");
    expect(r.ambiguous).toBe(true);
    for (const c of r.candidates as Array<Record<string, unknown>>) {
      expect(c.class).toBe("cmdb_ci_server");
    }
  });

  test("serial number lookup fallback", () => {
    const r = new RecordResolver().findCi("SN-WEB-02");
    expect(r.match?.name).toBe("web-prod-02");
  });
});
