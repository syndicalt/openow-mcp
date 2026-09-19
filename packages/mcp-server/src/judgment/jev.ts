import { SystemOneResultSchema, type SystemOneRequest, type SystemOneResult } from "@open-now/contracts";
import type { JudgmentClient } from "./client.js";
import { evaluateLocal } from "./engine.js";

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** On HTTP/parse failure, fall back to the local engine (default) or throw. */
  onError?: "local" | "throw";
}

/**
 * TypeSafe Jev HTTP client. POST /v1/systemone — typed questions, typed
 * answers, no generated text. Kernel-internal; never a mutation path.
 */
export class JevClient implements JudgmentClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly onError: "local" | "throw";

  constructor(opts: JevClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.typesafe.ai").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.onError = opts.onError ?? "local";
  }

  async evaluate(req: SystemOneRequest): Promise<SystemOneResult> {
    const started = performance.now();
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: req.model ?? "jev-latest",
          state: req.state,
          questions: req.questions,
        }),
      });
      if (!res.ok) {
        throw new Error(`Jev HTTP ${res.status}`);
      }
      const body: unknown = await res.json();
      const parsed = SystemOneResultSchema.parse(body);
      return {
        ...parsed,
        elapsedMs: parsed.elapsedMs ?? Math.max(0, performance.now() - started),
      };
    } catch (err) {
      if (this.onError === "throw") throw err;
      return evaluateLocal(req);
    }
  }
}
