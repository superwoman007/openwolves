import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { WitchAgent } from "../../api/game/agents/role-agents.js"

function makeWitchCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 3, role: "witch", alive: true },
    game: {
      phase: "night",
      day: 3,
      aliveSeats: [1, 2, 3, 4, 5],
      eliminatedSeats: [6, 7, 8, 9, 10, 11, 12],
    },
    timeline: {
      speeches: [
        {
          visibility: "public",
          phase: "day_speech",
          day: 2,
          speakerSeat: 1,
          text: "4号很可疑，我觉得4号是狼",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 1, text: "4号很可疑，我觉得4号是狼" },
        },
        {
          visibility: "public",
          phase: "day_speech",
          day: 2,
          speakerSeat: 2,
          text: "同意，4号问题很大",
          ts: 101,
          rawEvent: { t: "chat_public", ts: 101, seat: 2, text: "同意，4号问题很大" },
        },
      ],
      events: [],
      keyEvents: [],
    },
    memory: { summary: "", role: {} },
    knowledge: {},
    privateState: {
      witchAntidoteUsed: true,
      witchPoisonUsed: false,
      wolfVictimSeat: undefined,
    },
    ...overrides,
  }
}

describe("WitchAgent poison logic", () => {
  it("uses poison in late game (<=5 alive) with moderate suspicion", async () => {
    const agent = new WitchAgent(3, "witch")
    const ctx = makeWitchCtx()
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("witch_poison")
    // Should pick target 4 (most suspected)
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBe(4)
  })

  it("does not use poison in early game with same suspicion level", async () => {
    const agent = new WitchAgent(3, "witch")
    const ctx = makeWitchCtx({
      game: {
        phase: "night",
        day: 1,
        aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        eliminatedSeats: [],
      },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("witch_poison")
    // With 12 alive, threshold should be high — moderate suspicion not enough
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBeNull()
  })

  it("always skips poison when no candidates have any suspicion", async () => {
    const agent = new WitchAgent(3, "witch")
    const ctx = makeWitchCtx({
      timeline: { speeches: [], events: [], keyEvents: [] },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("witch_poison")
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBeNull()
  })
})
