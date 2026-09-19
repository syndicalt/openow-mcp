import type { Question } from "@open-now/contracts";

/** Versioned question packs. Skills declare which pack they need; the kernel loads them like skill docs. */
export interface QuestionPack {
  id: string;
  version: string;
  questions: Record<string, Question>;
}

export const DISPATCH_CONFIRM_PACK: QuestionPack = {
  id: "open-now.dispatch.confirm",
  version: "1.0.0",
  questions: {
    matches_intent: {
      type: "noul",
      instructions: "The proposed field diff matches the operator's stated intent and is a reasonable next action on this record.",
      criteria: {
        true: "The change is what the user asked for, notes explain the action, resolve has a real resolution",
        false: "The diff is unrelated, empty, speculative, or a resolve without an explanation",
      },
    },
    blast_radius: {
      type: "score",
      instructions: "Operational blast radius if this write is applied",
      criteria: [
        "Local, owned record, reversible comment or work note",
        "Shared record or assignment change; other fulfillers will see it",
        "High impact: resolve, major-incident, approve, execute, delete, or many records",
      ],
    },
    missing_substance: {
      type: "noul",
      instructions: "The write is missing substance the confirmation class requires (empty resolve notes, no reason, placeholder text).",
      criteria: {
        true: "resolution notes missing, TBD, asdf, empty comment, no explanation",
        false: "notes explain what was done and why",
      },
    },
  },
};

export const INCIDENT_TRIAGE_PACK: QuestionPack = {
  id: "open-now.itsm.incident.triage",
  version: "1.0.0",
  questions: {
    major_incident_shape: {
      type: "noul",
      instructions: "This work looks like a major incident: outage, many users, related change in window, duplicates opening.",
      criteria: {
        true: "outage down cannot send email smtp bounce multiple users P1 major change window duplicate",
        false: "single user printer access request how-to low priority",
      },
    },
    frustration: {
      type: "score",
      instructions: "How frustrated the reporter appears",
      criteria: ["Calm, matter-of-fact", "Frustrated but civil", "Escalatory or threatening"],
    },
  },
};

export const PACKS_BY_ID: Record<string, QuestionPack> = {
  [DISPATCH_CONFIRM_PACK.id]: DISPATCH_CONFIRM_PACK,
  [INCIDENT_TRIAGE_PACK.id]: INCIDENT_TRIAGE_PACK,
};
