import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournal } from "@open-now/mcp-server";

describe("journal", () => {
  test("undefined path is a no-op client", () => {
    expect(createJournal()).toBeUndefined();
  });

  test("appends JSONL", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-now-journal-"));
    const path = join(dir, "events.jsonl");
    const j = createJournal(path);
    j?.append({ type: "skill.discovered", query: "smtp down", ids: ["sn.itsm.incident.triage"] });
    j?.append({ type: "dispatch.applied", skillId: "sn.itsm.incident.update", requestId: "r1" });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}").type).toBe("skill.discovered");
  });
});
