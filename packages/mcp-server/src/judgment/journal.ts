import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type JournalEvent =
  | {
      type: "jev.answered";
      at: string;
      pack?: string;
      model: string;
      elapsedMs?: number;
      answers: unknown;
    }
  | {
      type: "skill.discovered";
      at: string;
      query: string;
      ids: string[];
    }
  | {
      type: "dispatch.pending";
      at: string;
      skillId: string;
      requestId?: string;
      advice?: string;
    }
  | {
      type: "dispatch.applied";
      at: string;
      skillId: string;
      requestId?: string;
      auditId?: string;
    };

export interface Journal {
  append(event: { type: JournalEvent["type"] } & Record<string, unknown>): void;
}

export function createJournal(path?: string): Journal | undefined {
  if (!path) return undefined;
  return {
    append(event) {
      const row = { at: event.at ?? new Date().toISOString(), ...event };
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
    },
  };
}
