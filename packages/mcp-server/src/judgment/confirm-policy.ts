import type { Answer, ConfirmAdvice, ConfirmationClass, SystemOneResult } from "@open-now/contracts";
import { DISPATCH_CONFIRM_PACK } from "./packs.js";
import type { JudgmentClient } from "./client.js";

export interface ConfirmJudgment {
  advice: ConfirmAdvice;
  intent: number;
  blast: number;
  missingSubstance: number;
  answers: Record<string, Answer>;
  elapsedMs?: number;
}

/**
 * Semantic half of ConfirmGate. Does not apply writes. Instance ConfirmGate
 * still owns authorization, ACLs, and the applier.
 */
export async function judgePending(opts: {
  judgment: JudgmentClient;
  confirmation: ConfirmationClass;
  skillId: string;
  inputs: Record<string, unknown>;
  diff?: Array<{ field: string; before: unknown; after: unknown }>;
  draft?: { summary: string; fields: Record<string, unknown> };
}): Promise<ConfirmJudgment> {
  const result: SystemOneResult = await opts.judgment.evaluate({
    model: "jev-latest",
    state: {
      skillId: opts.skillId,
      confirmation: opts.confirmation,
      inputs: opts.inputs,
      diff: opts.diff ?? [],
      draft: opts.draft ?? null,
    },
    questions: DISPATCH_CONFIRM_PACK.questions,
  });
  return adviseConfirm(opts.confirmation, result);
}

export function adviseConfirm(
  confirmation: ConfirmationClass,
  result: SystemOneResult,
): ConfirmJudgment {
  const intent = noulOf(result.answers["matches_intent"]);
  const blast = scoreOf(result.answers["blast_radius"]);
  const missingSubstance = noulOf(result.answers["missing_substance"]);
  const advice = policy(confirmation, intent, blast, missingSubstance);
  return {
    advice,
    intent,
    blast,
    missingSubstance,
    answers: result.answers,
    elapsedMs: result.elapsedMs,
  };
}

function policy(
  confirmation: ConfirmationClass,
  intent: number,
  blast: number,
  missingSubstance: number,
): ConfirmAdvice {
  if (
    confirmation === "approve" ||
    confirmation === "execute" ||
    confirmation === "deploy" ||
    confirmation === "restricted"
  ) {
    return "confirm";
  }
  if (missingSubstance >= 0.6) return "refuse";
  if (intent < 0.35) return "refuse";
  if (confirmation === "update_owned" && intent >= 0.9 && blast < 0.85) return "auto_ok";
  return "confirm";
}

function noulOf(a: Answer | undefined): number {
  return a?.type === "noul" ? a.noul : 0;
}

function scoreOf(a: Answer | undefined): number {
  return a?.type === "score" ? a.score : 0;
}
