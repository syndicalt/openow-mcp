import type { OpenNowConfig } from "../config.js";
import type { KernelOptions } from "../kernel/kernel.js";
import { createJudgmentClient } from "./client.js";
import { createJournal } from "./journal.js";

export function kernelOptsFromConfig(config: OpenNowConfig, clientApp: string): KernelOptions {
  return {
    clientApp,
    requireDescribe: config.requireDescribe,
    judgment: createJudgmentClient({
      mode: config.judgment ?? "off",
      apiKey: process.env.TYPESAFE_API_KEY,
      baseUrl: process.env.TYPESAFE_BASE_URL,
    }),
    journal: createJournal(config.journalPath),
  };
}
