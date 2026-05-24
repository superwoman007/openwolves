import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { WerewolfAgent } from "../../api/game/agents/role-agents.js"

function makeWolfNightCtx(seat: number, overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat, role: "werewolf", alive: true },
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
    knowledge: { wolfTeammates: [seat === 1 ? 4 : 1] },
    privateState: {},
    ...overrides,
  }
}

describe("Wolf night discussion templates", () => {
  it("first wolf to speak suggests a kill target with strategy reasoning", async () => {
    const agent = new WerewolfAgent(1, "werewolf")
    const ctx = makeWolfNightCtx(1, {
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 1,
            speakerSeat: 3,
            text: "我是3号预言家，查验7号是好人",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 3, text: "我是3号预言家，查验7号是好人" },
          },
        ],
        events: [],
        keyEvents: [],
      },
    })

    const decision = await agent.decide(ctx)
    expect(decision!.action.t).toBe("chat_wolf")
    const text = (decision!.action as { text: string }).text

    // Should mention a target and give reasoning
    expect(text).toMatch(/\d+号/)
    // Should include strategic content (not just "刀X号")
    expect(text.length).toBeGreaterThan(10)
  })

  it("second wolf responds to first wolf's suggestion", async () => {
    const agent = new WerewolfAgent(4, "werewolf")
    const ctx = makeWolfNightCtx(4, {
      knowledge: { wolfTeammates: [1] },
      timeline: {
        speeches: [
          {
            visibility: "wolf" as const,
            phase: "night" as const,
            day: 2,
            speakerSeat: 1,
            text: "我建议优先刀3号，这个位置更像关键神职或带队位。",
            ts: 200,
            rawEvent: { t: "chat_wolf", ts: 200, seat: 1, text: "我建议优先刀3号，这个位置更像关键神职或带队位。" },
          },
        ],
        events: [],
        keyEvents: [],
      },
    })

    const decision = await agent.decide(ctx)

    // Second wolf should either agree or suggest alternative — not repeat same message
    if (decision!.action.t === "chat_wolf") {
      const text = (decision!.action as { text: string }).text
      // Should reference the discussion or provide additional input
      expect(text.length).toBeGreaterThan(5)
      // Should not be identical to first wolf's message
      expect(text).not.toBe("我建议优先刀3号，这个位置更像关键神职或带队位。")
    } else {
      // Or directly submit kill (if already discussed enough)
      expect(decision!.action.t).toBe("wolf_kill")
    }
  })

  it("wolf chat includes day-strategy suggestion (not just kill target)", async () => {
    const agent = new WerewolfAgent(1, "werewolf")
    const ctx = makeWolfNightCtx(1, {
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
    })

    const decision = await agent.decide(ctx)
    expect(decision!.action.t).toBe("chat_wolf")
    const text = (decision!.action as { text: string }).text

    // Wolf chat should include strategic content beyond just "刀X号"
    // e.g., mentioning who to frame, who to protect, day strategy
    expect(text.length).toBeGreaterThan(15)
  })
})
