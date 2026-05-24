import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { WerewolfAgent } from "../../api/game/agents/role-agents.js"

function makeWolfSpeechCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 2, role: "werewolf", alive: true },
    game: {
      phase: "day_speech",
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
    knowledge: { wolfTeammates: [4] },
    privateState: {},
    ...overrides,
  }
}

describe("Werewolf fake-claim (悍跳) logic", () => {
  it("fake-claims seer when real seer has claimed and accused a wolf teammate", async () => {
    const agent = new WerewolfAgent(2, "werewolf")
    const ctx = makeWolfSpeechCtx({
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 3,
            text: "我是3号预言家，昨晚查杀4号。请大家今天归票出他。",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 3, text: "我是3号预言家，昨晚查杀4号。请大家今天归票出他。" },
          },
        ],
        events: [],
        keyEvents: [],
      },
      knowledge: { wolfTeammates: [4] },
    })

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // Wolf should counter-claim seer to protect teammate
    expect(text).toMatch(/预言家|查验|查杀|金水/)
    // Should NOT admit being wolf
    expect(text).not.toMatch(/我是狼/)
  })

  it("does NOT fake-claim when no seer has claimed", async () => {
    const agent = new WerewolfAgent(2, "werewolf")
    const ctx = makeWolfSpeechCtx({
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 5,
            text: "我觉得4号很可疑",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 5, text: "我觉得4号很可疑" },
          },
        ],
        events: [],
        keyEvents: [],
      },
    })

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // Should NOT claim seer when no one else has
    expect(text).not.toMatch(/我是.*预言家/)
  })

  it("fake-claims seer when wolf self is being pushed hard", async () => {
    const agent = new WerewolfAgent(2, "werewolf")
    const ctx = makeWolfSpeechCtx({
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 3,
            text: "我是预言家，2号是查杀",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 3, text: "我是预言家，2号是查杀" },
          },
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 5,
            text: "同意出2号，2号问题很大",
            ts: 101,
            rawEvent: { t: "chat_public", ts: 101, seat: 5, text: "同意出2号，2号问题很大" },
          },
        ],
        events: [],
        keyEvents: [],
      },
    })

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // Wolf should counter-claim to defend self
    expect(text).toMatch(/预言家|查验|查杀/)
  })
})
