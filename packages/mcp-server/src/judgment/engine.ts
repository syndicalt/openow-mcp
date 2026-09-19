import type {
  Answer,
  ChoiceAnswer,
  NoulAnswer,
  Question,
  ScoreAnswer,
  SystemOneRequest,
  SystemOneResult,
} from "@open-now/contracts";

/**
 * Offline System One engine with the Jev request/response shape.
 * Used in CI and when TYPESAFE_API_KEY is unset. Not a text model —
 * keyword/structured evidence → softmax/sigmoid. Deterministic.
 */

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "are",
  "was",
  "were",
  "have",
  "has",
  "not",
  "but",
  "you",
  "your",
  "our",
  "any",
  "all",
  "into",
  "onto",
  "over",
  "under",
  "than",
  "then",
  "them",
  "they",
  "their",
  "about",
  "after",
  "before",
  "because",
]);

export function evaluateLocal(req: SystemOneRequest): SystemOneResult {
  const started = performance.now();
  const hay = flatten(req.state);
  const answers: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(req.questions)) {
    answers[id] = answerOne(q, hay);
  }
  return {
    model: "open-now-local",
    answers,
    elapsedMs: Math.max(0, performance.now() - started),
  };
}

function answerOne(q: Question, hay: string): Answer {
  if (q.type === "choice") return answerChoice(q.criteria, q.instructions, hay);
  if (q.type === "score") return answerScore(q.criteria, q.instructions, hay);
  return answerNoul(q, hay);
}

function answerChoice(
  criteria: Record<string, string>,
  instructions: string,
  hay: string,
): ChoiceAnswer {
  const keys = Object.keys(criteria);
  const logits = keys.map((k) => {
    const c = criteria[k] ?? "";
    return evidence(hay, `${instructions} ${k.replace(/[._]/g, " ")} ${c}`);
  });
  const probabilities = softmax(logits, keys);
  const choice = argmax(probabilities);
  return {
    type: "choice",
    choice,
    probabilities,
    confidence: confidenceFrom(Object.values(probabilities)),
  };
}

function answerScore(criteria: string[], instructions: string, hay: string): ScoreAnswer {
  const keys = criteria.map((_, i) => String(i));
  const logits = criteria.map((c) => evidence(hay, `${instructions} ${c}`));
  const probabilities = softmax(logits, keys);
  let score = 0;
  for (const [k, p] of Object.entries(probabilities)) {
    score += Number(k) * p;
  }
  const legend: Record<string, string> = {};
  criteria.forEach((c, i) => {
    legend[String(i)] = c;
  });
  return {
    type: "score",
    score,
    probabilities,
    confidence: confidenceFrom(Object.values(probabilities)),
    legend,
  };
}

function answerNoul(q: Extract<Question, { type: "noul" }>, hay: string): NoulAnswer {
  const t = evidence(hay, `${q.instructions} ${q.criteria?.true ?? "yes true"}`);
  const f = evidence(hay, q.criteria?.false ?? "no false unrelated none");
  const noul = sigmoid(t - f);
  return { type: "noul", noul };
}

export function flatten(state: unknown): string {
  if (state == null) return "";
  if (typeof state === "string") return state;
  try {
    return JSON.stringify(state);
  } catch {
    return String(state);
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function evidence(hay: string, needle: string): number {
  const h = hay.toLowerCase();
  const tokens = tokenize(needle);
  if (tokens.length === 0) return 0.1;
  const hset = new Set(tokenize(hay));
  let s = 0.15;
  for (const t of tokens) {
    if (hset.has(t)) s += 1;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const phrase = `${tokens[i]} ${tokens[i + 1]}`;
    if (h.includes(phrase)) s += 1.6;
  }
  return s;
}

function softmax(logits: number[], keys: string[]): Record<string, number> {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp((x - max) / 0.85));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    out[k] = (exps[i] ?? 0) / sum;
  });
  return out;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function argmax(probs: Record<string, number>): string {
  let best = Object.keys(probs)[0] ?? "";
  let v = -1;
  for (const [k, p] of Object.entries(probs)) {
    if (p > v) {
      best = k;
      v = p;
    }
  }
  return best;
}

function confidenceFrom(probs: number[]): number {
  if (probs.length === 0) return 0;
  const sorted = [...probs].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const margin = top - second;
  const entropy = -probs.reduce((s, p) => s + (p > 1e-12 ? p * Math.log(p) : 0), 0);
  const maxEnt = Math.log(Math.max(probs.length, 2));
  const peaked = 1 - entropy / maxEnt;
  return clamp01(0.4 * peaked + 0.6 * (margin + 0.35));
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
