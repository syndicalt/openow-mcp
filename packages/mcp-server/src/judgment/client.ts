import type { SystemOneRequest, SystemOneResult } from "@open-now/contracts";
import { evaluateLocal } from "./engine.js";
import { JevClient } from "./jev.js";

export type JudgmentMode = "off" | "local" | "jev";

export interface JudgmentClient {
  evaluate(req: SystemOneRequest): Promise<SystemOneResult>;
}

export interface CreateJudgmentClientOptions {
  mode?: JudgmentMode;
  apiKey?: string;
  baseUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export class LocalJudgmentClient implements JudgmentClient {
  async evaluate(req: SystemOneRequest): Promise<SystemOneResult> {
    return evaluateLocal(req);
  }
}

/**
 * Factory. `off` returns undefined (kernel skips ranking). `jev` without a
 * key degrades to local so the kernel never fails closed on missing creds.
 */
export function createJudgmentClient(
  opts: CreateJudgmentClientOptions = {},
): JudgmentClient | undefined {
  const mode = opts.mode ?? "off";
  if (mode === "off") return undefined;
  if (mode === "jev" && opts.apiKey) {
    return new JevClient({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      fetch: opts.fetch,
    });
  }
  return new LocalJudgmentClient();
}
