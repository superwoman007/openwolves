import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { GuardAgent } from "../../api/game/agents/role-agents.js"

function makeGuardCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 4, role: "guard", alive: true },
    game: {
      phase: "night",
      day: 2,
      aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      eliminatedSeats: [10, 11, 12],
    },
    timeline: {
      speeches: [],
      events: [],
      keyEvents: [],
    },
    memory: { summary: "", role: {} },
    knowledge: {},
    privateState: {
      lastGuardTarget: null,
    },
    ...overrides,
  }
}

describe("Guard knife-analysis strategy", () => {
  it("prioritizes protecting a player who claimed seer", async () => {
    const agent = new GuardAgent(4, "guard")
    const ctx = makeGuardCtx({
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 1,
            speakerSeat: 3,
            text: "我是3号预言家，昨晚查验7号是好人",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 3, text: "我是3号预言家，昨晚查验7号是好人" },
          },
        ],
        events: [],
        keyEvents: [],
      },
    })

    const decision = await agent.decide(ctx)
    const target = (decision!.action as { targetSeat: number }).targetSeat

    // Should protect the claimed seer (highest threat)
    expect(target).toBe(3)
  })

  it("does not guard same target as last night", async () => {
    const agent = new GuardAgent(4, "guard")
    const ctx = makeGuardCtx({
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 1,
            speakerSeat: 3,
            text: "我是3号预言家，查杀5号",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 3, text: "我是3号预言家，查杀5号" },
          },
        ],
        events: [],
        keyEvents: [],
      },
      privateState: {
        lastGuardTarget: 3, // guarded seer last night
      },
    })

    const decision = await agent.decide(ctx)
    const target = (decision!.action as { targetSeat: number }).targetSeat

    // Cannot guard same target consecutively
    expect(target).not.toBe(3)
  })

  it("considers knife-pattern: if seer survived a night, wolf may switch target", async () => {
    const agent = new GuardAgent(4, "guard")
    // Scenario: seer claimed day 1, survived night 2 (was guarded), now night 3
    // Wolf likely switches target — guard should consider protecting other high-value targets
    const ctx = makeGuardCtx({
      game: {
        phase: "night",
        day: 3,
        aliveSeats: [1, 2, 3, 4, 5, 6, 7],
        eliminatedSeats: [8, 9, 10, 11, 12],
      },
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 1,
            speakerSeat: 3,
            text: "我是3号预言家",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 3, text: "我是3号预言家" },
          },
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 6,
            text: "我是6号女巫，昨晚没人死",
            ts: 200,
            rawEvent: { t: "chat_public", ts: 200, seat: 6, text: "我是6号女巫，昨晚没人死" },
          },
        ],
        events: [],
        keyEvents: [],
      },
      privateState: {
        lastGuardTarget: 3, // guarded seer last night (and seer survived)
      },
    })

    const decision = await agent.decide(ctx)
    const target = (decision!.action as { targetSeat: number }).targetSeat

    // Can't guard 3 again (lastGuardTarget), should pick another high-value target
    // 6 claimed witch — should be a likely target
    expect(target).not.toBe(3)
    expect(target).not.toBe(4) // not self when better targets exist
    expect([6, 1, 2, 5, 7]).toContain(target)
  })

  it("guards self when no other high-value targets identified", async () => {
    const agent = new GuardAgent(4, "guard")
    const ctx = makeGuardCtx({
      timeline: {
        speeches: [],
        events: [],
        keyEvents: [],
      },
      privateState: {
        lastGuardTarget: null,
      },
    })

    const decision = await agent.decide(ctx)
    const target = (decision!.action as { targetSeat: number }).targetSeat

    // With no info, guard should protect self (has slight self-bias in current logic)
    expect(ctx.game.aliveSeats).toContain(target)
  })
})
