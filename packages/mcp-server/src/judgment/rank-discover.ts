import type { DiscoverGate, DiscoverItem, DiscoverResult } from "@open-now/contracts";
import type { JudgmentClient } from "./client.js";

/**
 * Confidence-gated rerank of discover results. Gateway ranking stays the
 * candidate set (instance index + QueryGuard). Judgment never invents a skill
 * that was not a candidate, and raw:* is never promoted to the default path.
 */
export async function rerankDiscover(
  judgment: JudgmentClient,
  query: string,
  incoming: DiscoverResult,
): Promise<DiscoverResult> {
  const skills = incoming.results.filter((r) => r.kind === "skill");
  const rest = incoming.results.filter((r) => r.kind !== "skill");
  if (skills.length === 0) return incoming;

  const criteria: Record<string, string> = {};
  for (const s of skills) {
    criteria[s.id] = s.why;
  }

  const evaluated = await judgment.evaluate({
    model: "jev-latest",
    state: { query, candidates: skills.map((s) => ({ id: s.id, why: s.why })) },
    questions: {
      skill: {
        type: "choice",
        instructions: "Which candidate skill best matches the operator intent?",
        criteria,
      },
    },
  });

  const ans = evaluated.answers["skill"];
  const probs = ans?.type === "choice" ? ans.probabilities : {};
  const confidence = ans?.type === "choice" ? ans.confidence : 0;
  const choice = ans?.type === "choice" ? ans.choice : undefined;

  const blended: DiscoverItem[] = skills.map((s) => {
    const p = probs[s.id] ?? 0;
    const score = 0.4 * s.score + 0.6 * p;
    return {
      ...s,
      score,
      confidence,
      gate: gateFor(s.id, choice, confidence, p),
      why: p > 0 ? `${s.why} · p=${p.toFixed(2)}` : s.why,
    };
  });
  blended.sort((a, b) => b.score - a.score);

  const rankedRest = rest.map((r) => ({ ...r, gate: "ask" as DiscoverGate }));
  return { results: [...blended, ...rankedRest].slice(0, 25) };
}

export function gateFor(
  id: string,
  choice: string | undefined,
  confidence: number,
  p: number,
): DiscoverGate {
  if (id.startsWith("raw:")) return "ask";
  if (choice === id && confidence >= 0.75 && p >= 0.55) return "auto";
  if (confidence >= 0.45) return "pick";
  return "ask";
}
