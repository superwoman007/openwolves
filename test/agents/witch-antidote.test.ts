import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { WitchAgent } from "../../api/game/agents/role-agents.js"

function makeWitchAntidoteCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 5, role: "witch", alive: true },
    game: {
      phase: "night",
      day: 1,
      aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      eliminatedSeats: [],
    },
    timeline: {
      speeches: [],
      events: [],
      keyEvents: [],
    },
    memory: { summary: "", role: {} },
    knowledge: {},
    privateState: {
      witchAntidoteUsed: false,
      witchPoisonUsed: false,
      wolfVictimSeat: 3,
    },
    ...overrides,
  }
}

describe("Witch antidote decision optimization", () => {
  it("always saves on first night (首夜必救)", async () => {
    const agent = new WitchAgent(5, "witch")
    const ctx = makeWitchAntidoteCtx()

    const decision = await agent.decide(ctx)
    expect(decision!.action.t).toBe("witch_antidote")
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBe(3)
  })

  it("always saves self regardless of day", async () => {
    const agent = new WitchAgent(5, "witch")
    const ctx = makeWitchAntidoteCtx({
      game: {
        phase: "night",
        day: 3,
        aliveSeats: [1, 2, 3, 4, 5, 6],
        eliminatedSeats: [7, 8, 9, 10, 11, 12],
      },
      privateState: {
        witchAntidoteUsed: false,
        witchPoisonUsed: false,
        wolfVictimSeat: 5, // self is victim
      },
    })

    const decision = await agent.decide(ctx)
    expect(decision!.action.t).toBe("witch_antidote")
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBe(5)
  })

  it("does NOT save a highly suspected player in mid-game", async () => {
    const agent = new WitchAgent(5, "witch")
    const ctx = makeWitchAntidoteCtx({
      game: {
        phase: "night",
        day: 3,
        aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8],
        eliminatedSeats: [9, 10, 11, 12],
      },
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 1,
            text: "3号是狼，3号很可疑，出3号",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 1, text: "3号是狼，3号很可疑，出3号" },
          },
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 2,
            text: "同意，3号问题很大，投3号",
            ts: 101,
            rawEvent: { t: "chat_public", ts: 101, seat: 2, text: "同意，3号问题很大，投3号" },
          },
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 4,
            text: "3号可疑，3号带节奏",
            ts: 102,
            rawEvent: { t: "chat_public", ts: 102, seat: 4, text: "3号可疑，3号带节奏" },
          },
        ],
        events: [],
        keyEvents: [],
      },
      privateState: {
        witchAntidoteUsed: false,
        witchPoisonUsed: false,
        wolfVictimSeat: 3, // highly suspected player
      },
    })

    const decision = await agent.decide(ctx)
    expect(decision!.action.t).toBe("witch_antidote")
    // Should NOT save a highly suspected player (might be wolf)
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBeNull()
  })

  it("saves in late game (<=4 alive) regardless of suspicion", async () => {
    const agent = new WitchAgent(5, "witch")
    const ctx = makeWitchAntidoteCtx({
      game: {
        phase: "night",
        day: 4,
        aliveSeats: [2, 3, 5, 6],
        eliminatedSeats: [1, 4, 7, 8, 9, 10, 11, 12],
      },
      privateState: {
        witchAntidoteUsed: false,
        witchPoisonUsed: true,
        wolfVictimSeat: 3,
      },
    })

    const decision = await agent.decide(ctx)
    expect(decision!.action.t).toBe("witch_antidote")
    // In late game, every life matters
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBe(3)
  })
})
