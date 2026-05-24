import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { HunterAgent } from "../../api/game/agents/role-agents.js"

function makeHunterCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 3, role: "hunter", alive: false },
    game: {
      phase: "resolve",
      day: 2,
      aliveSeats: [1, 2, 4, 5, 6],
      eliminatedSeats: [3],
    },
    timeline: {
      speeches: [],
      events: [],
      keyEvents: [],
    },
    memory: { summary: "", role: {} },
    knowledge: {},
    privateState: {},
    ...overrides,
  }
}

describe("HunterAgent shoot logic", () => {
  it("always shoots when dying even with no suspicion info", async () => {
    const agent = new HunterAgent(3, "hunter")
    const ctx = makeHunterCtx()
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("hunter_shoot")
    // Should pick a target, not null
    expect((decision!.action as { targetSeat: number | null }).targetSeat).not.toBeNull()
  })

  it("prefers high-suspicion target when info available", async () => {
    const agent = new HunterAgent(3, "hunter")
    const ctx = makeHunterCtx({
      timeline: {
        speeches: [
          {
            visibility: "public",
            phase: "day_speech",
            day: 2,
            speakerSeat: 1,
            text: "5号很可疑，我觉得5号是狼",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 1, text: "5号很可疑，我觉得5号是狼" },
          },
          {
            visibility: "public",
            phase: "day_speech",
            day: 2,
            speakerSeat: 2,
            text: "同意，5号问题很大，出5号",
            ts: 101,
            rawEvent: { t: "chat_public", ts: 101, seat: 2, text: "同意，5号问题很大，出5号" },
          },
        ],
        events: [],
        keyEvents: [],
      },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect((decision!.action as { targetSeat: number }).targetSeat).toBe(5)
  })

  it("does not shoot self", async () => {
    const agent = new HunterAgent(3, "hunter")
    const ctx = makeHunterCtx({
      game: { phase: "resolve", day: 1, aliveSeats: [1, 2, 3, 4], eliminatedSeats: [] },
      self: { seat: 3, role: "hunter", alive: false },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    const target = (decision!.action as { targetSeat: number | null }).targetSeat
    expect(target).not.toBe(3)
  })

  it("returns null target only when no alive candidates", async () => {
    const agent = new HunterAgent(3, "hunter")
    const ctx = makeHunterCtx({
      game: { phase: "resolve", day: 1, aliveSeats: [3], eliminatedSeats: [1, 2, 4, 5, 6] },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBeNull()
  })
})
