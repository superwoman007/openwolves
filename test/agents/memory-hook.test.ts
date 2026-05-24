import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AgentContext, AgentTimelineContext } from "../../api/game/agents/types.js"
import { updateMemoryForAllSeats } from "../../api/game/agents/memory-hook.js"
import type { GameRuntime, SeatRuntime } from "../../api/game/model.js"

function makeMockGameRuntime(overrides: Partial<GameRuntime> = {}): GameRuntime {
  const seats: SeatRuntime[] = [
    { seat: 1, name: "AI-1", kind: "ai", alive: true, role: "werewolf", hand: { witchAntidoteUsed: false, witchPoisonUsed: false, lastGuardTarget: null }, memorySummary: "" },
    { seat: 2, name: "AI-2", kind: "ai", alive: true, role: "seer", hand: { witchAntidoteUsed: false, witchPoisonUsed: false, lastGuardTarget: null }, memorySummary: "" },
    { seat: 3, name: "AI-3", kind: "ai", alive: true, role: "villager", hand: { witchAntidoteUsed: false, witchPoisonUsed: false, lastGuardTarget: null }, memorySummary: "" },
    { seat: 4, name: "Human", kind: "human", alive: true, role: "villager", hand: { witchAntidoteUsed: false, witchPoisonUsed: false, lastGuardTarget: null }, memorySummary: "" },
    { seat: 5, name: "AI-5", kind: "ai", alive: true, role: "witch", hand: { witchAntidoteUsed: true, witchPoisonUsed: false, lastGuardTarget: null }, memorySummary: "" },
    { seat: 6, name: "AI-6", kind: "ai", alive: true, role: "guard", hand: { witchAntidoteUsed: false, witchPoisonUsed: false, lastGuardTarget: 3 }, memorySummary: "" },
  ] as SeatRuntime[]

  return {
    gameId: "test-game",
    config: { seats: [], rolePool: [], rngSeed: "test" } as any,
    seats,
    phase: "day_speech",
    day: 2,
    events: [
      { t: "phase", ts: 1, phase: "night", day: 1 },
      { t: "chat_wolf", ts: 2, seat: 1, text: "刀3号" },
      { t: "action", ts: 3, seat: 2, action: "seer_check", payload: { targetSeat: 1 } },
      { t: "result", ts: 4, text: "3号昨晚被刀" },
      { t: "phase", ts: 5, phase: "day_speech", day: 2 },
      { t: "chat_public", ts: 6, seat: 2, text: "我是预言家，昨晚查了1号是狼" },
    ],
    rng: { shuffleInPlace: () => {}, nextInt: () => 0 } as any,
    night: null,
    dayState: null,
    hunterState: null,
    agentState: { registry: null, lastModeratorAnnouncementKey: null, lastModeratorHintKey: null },
    thinkingSeats: new Set(),
    ...overrides,
  } as GameRuntime
}

describe("updateMemoryForAllSeats", () => {
  it("updates memorySummary for all AI seats", () => {
    const g = makeMockGameRuntime()
    updateMemoryForAllSeats(g)

    expect(g.seats[0]!.memorySummary).not.toBe("")
    expect(g.seats[1]!.memorySummary).not.toBe("")
    expect(g.seats[2]!.memorySummary).not.toBe("")
  })

  it("does not update human seats", () => {
    const g = makeMockGameRuntime()
    updateMemoryForAllSeats(g)

    expect(g.seats[3]!.memorySummary).toBe("")
  })

  it("preserves old memory and appends new info", () => {
    const g = makeMockGameRuntime()
    g.seats[0]!.memorySummary = "第1天：无事发生"
    updateMemoryForAllSeats(g)

    expect(g.seats[0]!.memorySummary).toContain("无事发生")
  })

  it("extracts role claims from speeches", () => {
    const g = makeMockGameRuntime()
    updateMemoryForAllSeats(g)

    const villagerMemory = g.seats[2]!.memorySummary
    expect(villagerMemory).toContain("预言家")
  })

  it("extracts result events", () => {
    const g = makeMockGameRuntime()
    updateMemoryForAllSeats(g)

    expect(g.seats[1]!.memorySummary).toContain("3号")
  })

  it("keeps memory under 150 characters", () => {
    const g = makeMockGameRuntime()
    g.seats[0]!.memorySummary = "A".repeat(120)
    updateMemoryForAllSeats(g)

    expect(g.seats[0]!.memorySummary.length).toBeLessThanOrEqual(150)
  })

  it("wolf chat is only visible to wolves in memory", () => {
    const g = makeMockGameRuntime()
    updateMemoryForAllSeats(g)

    const villagerMemory = g.seats[2]!.memorySummary
    expect(villagerMemory).not.toContain("刀3号")
  })

  // Role-specific memory tests
  it("seer memory includes check results", () => {
    const g = makeMockGameRuntime()
    // Seat 2 is seer and checked seat 1
    updateMemoryForAllSeats(g)

    const seerMemory = g.seats[1]!.memorySummary
    expect(seerMemory).toContain("验")
    expect(seerMemory).toContain("1号")
  })

  it("werewolf memory includes wolf chat summary", () => {
    const g = makeMockGameRuntime()
    updateMemoryForAllSeats(g)

    const wolfMemory = g.seats[0]!.memorySummary
    expect(wolfMemory).toContain("刀3号")
  })

  it("witch memory includes potion status", () => {
    const g = makeMockGameRuntime()
    updateMemoryForAllSeats(g)

    const witchMemory = g.seats[4]!.memorySummary
    expect(witchMemory).toContain("解药已用")
  })

  it("guard memory includes last protect target", () => {
    const g = makeMockGameRuntime()
    updateMemoryForAllSeats(g)

    const guardMemory = g.seats[5]!.memorySummary
    expect(guardMemory).toContain("守护")
    expect(guardMemory).toContain("3号")
  })
})
