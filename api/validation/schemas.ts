import { z } from "zod"

const AIProviderConfigSchema = z.object({
  provider: z.enum(["mock", "deepseek", "doubao", "glm", "mimo", "kimi", "gpt", "custom"]),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
})

const SeatConfigSchema = z.object({
  seat: z.number().int().min(0).max(11),
  name: z.string().min(1).max(20),
  kind: z.enum(["human", "ai"]),
  ai: AIProviderConfigSchema.optional(),
})

const ModeratorConfigSchema = z.object({
  ai: AIProviderConfigSchema.optional(),
})

export const GameConfigSchema = z.object({
  seats: z.array(SeatConfigSchema).min(6).max(12),
  moderator: ModeratorConfigSchema.optional(),
  rolePool: z.array(z.enum(["villager", "werewolf", "seer", "witch", "hunter", "guard"])).min(6).max(12),
  rngSeed: z.string().optional(),
  phaseTimers: z.object({
    speechSeconds: z.number().int().min(10).max(300).optional(),
    voteSeconds: z.number().int().min(10).max(120).optional(),
  }).optional(),
  password: z.string().max(32).optional(),
})

export const SubmitActionSchema = z.object({
  seat: z.number().int().min(0).max(11),
  action: z.object({
    t: z.string(),
  }).passthrough(),
})

export const JoinGameSchema = z.object({
  seat: z.number().int().min(0).max(11),
  password: z.string().max(32).optional(),
})
