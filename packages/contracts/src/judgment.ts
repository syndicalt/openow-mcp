import { z } from "zod";

/**
 * System One judgment contract (Jev-shaped). The kernel uses this as an
 * internal primitive — it is not a fifth MCP tool. Typed questions in,
 * typed answers + probabilities out. No generated text.
 */

export const ChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z.record(z.string(), z.string()),
});
export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;

export const ScoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: z.string().min(1),
  /** Ordered rubric levels, index 0 = lowest. */
  criteria: z.array(z.string()).min(2).max(16),
});
export type ScoreQuestion = z.infer<typeof ScoreQuestionSchema>;

export const NoulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
  criteria: z
    .object({
      true: z.string().optional(),
      false: z.string().optional(),
    })
    .optional(),
});
export type NoulQuestion = z.infer<typeof NoulQuestionSchema>;

export const QuestionSchema = z.discriminatedUnion("type", [
  ChoiceQuestionSchema,
  ScoreQuestionSchema,
  NoulQuestionSchema,
]);
export type Question = z.infer<typeof QuestionSchema>;

export const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;

export const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
  legend: z.record(z.string(), z.string()).optional(),
});
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;

export const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;

export const AnswerSchema = z.discriminatedUnion("type", [
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
  NoulAnswerSchema,
]);
export type Answer = z.infer<typeof AnswerSchema>;

export const SystemOneRequestSchema = z.object({
  model: z.string().default("jev-latest"),
  state: z.unknown(),
  questions: z.record(z.string(), QuestionSchema),
});
export type SystemOneRequest = z.infer<typeof SystemOneRequestSchema>;

export const SystemOneResultSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), AnswerSchema),
  elapsedMs: z.number().nonnegative().optional(),
});
export type SystemOneResult = z.infer<typeof SystemOneResultSchema>;

export const DiscoverGateSchema = z.enum(["auto", "pick", "ask"]);
export type DiscoverGate = z.infer<typeof DiscoverGateSchema>;

export const ConfirmAdviceSchema = z.enum(["refuse", "confirm", "auto_ok"]);
export type ConfirmAdvice = z.infer<typeof ConfirmAdviceSchema>;
