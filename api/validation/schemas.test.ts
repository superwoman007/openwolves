import { describe, test, expect } from "vitest"
import { GameConfigSchema, SubmitActionSchema, JoinGameSchema } from "./schemas.js"

describe("GameConfigSchema", () => {
  const validConfig = {
    seats: Array.from({ length: 6 }, (_, i) => ({
      seat: i,
      name: `Player ${i}`,
      kind: "ai" as const,
      ai: { provider: "mock" as const },
    })),
    rolePool: ["werewolf", "werewolf", "seer", "witch", "villager", "villager"],
  }

  test("accepts valid config", () => {
    const result = GameConfigSchema.safeParse(validConfig)
    expect(result.success).toBe(true)
  })

  test("rejects config with too few seats", () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      seats: validConfig.seats.slice(0, 3),
      rolePool: validConfig.rolePool.slice(0, 3),
    })
    expect(result.success).toBe(false)
  })

  test("rejects config with invalid role", () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      rolePool: ["werewolf", "werewolf", "seer", "witch", "villager", "dragon"],
    })
    expect(result.success).toBe(false)
  })

  test("rejects seat with empty name", () => {
    const seats = validConfig.seats.map((s, i) => (i === 0 ? { ...s, name: "" } : s))
    const result = GameConfigSchema.safeParse({ ...validConfig, seats })
    expect(result.success).toBe(false)
  })

  test("rejects seat number out of range", () => {
    const seats = validConfig.seats.map((s, i) => (i === 0 ? { ...s, seat: 99 } : s))
    const result = GameConfigSchema.safeParse({ ...validConfig, seats })
    expect(result.success).toBe(false)
  })

  test("accepts optional password", () => {
    const result = GameConfigSchema.safeParse({ ...validConfig, password: "secret" })
    expect(result.success).toBe(true)
  })

  test("rejects password over 32 chars", () => {
    const result = GameConfigSchema.safeParse({ ...validConfig, password: "a".repeat(33) })
    expect(result.success).toBe(false)
  })

  test("accepts optional phaseTimers", () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      phaseTimers: { speechSeconds: 60, voteSeconds: 30 },
    })
    expect(result.success).toBe(true)
  })

  test("rejects phaseTimers with out-of-range values", () => {
    const result = GameConfigSchema.safeParse({
      ...validConfig,
      phaseTimers: { speechSeconds: 5 }, // min is 10
    })
    expect(result.success).toBe(false)
  })
})

describe("SubmitActionSchema", () => {
  test("accepts valid action", () => {
    const result = SubmitActionSchema.safeParse({
      seat: 1,
      action: { t: "vote", targetSeat: 3 },
    })
    expect(result.success).toBe(true)
  })

  test("rejects seat out of range", () => {
    const result = SubmitActionSchema.safeParse({
      seat: 99,
      action: { t: "vote", targetSeat: 3 },
    })
    expect(result.success).toBe(false)
  })

  test("rejects missing action type", () => {
    const result = SubmitActionSchema.safeParse({
      seat: 1,
      action: { targetSeat: 3 },
    })
    expect(result.success).toBe(false)
  })
})

describe("JoinGameSchema", () => {
  test("accepts valid join request", () => {
    const result = JoinGameSchema.safeParse({ seat: 2, password: "abc" })
    expect(result.success).toBe(true)
  })

  test("accepts join without password", () => {
    const result = JoinGameSchema.safeParse({ seat: 0 })
    expect(result.success).toBe(true)
  })

  test("rejects seat out of range", () => {
    const result = JoinGameSchema.safeParse({ seat: 99 })
    expect(result.success).toBe(false)
  })

  test("rejects non-integer seat", () => {
    const result = JoinGameSchema.safeParse({ seat: 1.5 })
    expect(result.success).toBe(false)
  })
})
