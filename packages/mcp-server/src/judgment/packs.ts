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

export const SURFACE_CLASSIFY_PACK: QuestionPack = {
  id: "open-now.surface.classify",
  version: "1.0.0",
  questions: {
    archetype: {
      type: "choice",
      instructions:
        "Which NowOS work surface matches this operator given their ServiceNow title, department, and roles? Pick the one they would inhabit — not a ServiceNow workspace name.",
      criteria: {
        incident_desk:
          "service desk incident analyst fulfiller itil helpdesk help desk technician support agent it support",
        change_cab:
          "change manager cab change advisory board release manager change analyst change coordinator",
        cmdb_ops:
          "cmdb sre site reliability service owner itom operations monitoring event management configuration manager",
        hr_agent: "hr human resources people operations hr agent hrbp hr business partner",
        csm_agent: "customer service csm account manager case agent customer success",
        secops: "security soc vulnerability sir threat analyst infosec security operations",
        spm: "project manager portfolio pmo program manager project coordinator",
        builder:
          "developer admin platform engineer servicenow system administrator app engine sn admin",
        executive: "vp vice president director cio cto chief head of svp",
        employee: "employee requester end user staff anyone knowledge worker no ITIL title",
      },
    },
  },
};

export const SURFACE_DENSITY_QUESTION: Question = {
  type: "score",
  instructions: "How dense should this operator's NowOS canvas be given their title?",
  criteria: [
    "Sparse: 2–3 cards, executive or requester, no ticket mill",
    "Working desk: one queue plus a handful of next actions",
    "Command center: several queues, graphs, and live briefing strips",
  ],
};

export const PACKS_BY_ID: Record<string, QuestionPack> = {
  [DISPATCH_CONFIRM_PACK.id]: DISPATCH_CONFIRM_PACK,
  [INCIDENT_TRIAGE_PACK.id]: INCIDENT_TRIAGE_PACK,
  [SURFACE_CLASSIFY_PACK.id]: SURFACE_CLASSIFY_PACK,
};
