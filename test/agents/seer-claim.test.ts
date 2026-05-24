import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { SeerAgent } from "../../api/game/agents/role-agents.js"

function makeSeerSpeechCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 3, role: "seer", alive: true },
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
    knowledge: {},
    privateState: {},
    ...overrides,
  }
}

describe("Seer identity claim logic", () => {
  it("claims identity and reports wolf check result when has a confirmed wolf", async () => {
    const agent = new SeerAgent(3, "seer")
    const ctx = makeSeerSpeechCtx({
      memory: {
        summary: "",
        role: {
          seerChecks: [
            { target: 5, isWolf: true },
            { target: 7, isWolf: false },
          ],
        },
      },
    })

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // Should explicitly claim seer identity
    expect(text).toMatch(/预言家|查杀|查验/)
    // Should mention the wolf target
    expect(text).toMatch(/5号/)
  })

  it("does NOT claim identity on day 1 with only good-person checks", async () => {
    const agent = new SeerAgent(3, "seer")
    const ctx = makeSeerSpeechCtx({
      game: {
        phase: "day_speech",
        day: 1,
        aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        eliminatedSeats: [],
      },
      memory: {
        summary: "",
        role: {
          seerChecks: [{ target: 7, isWolf: false }],
        },
      },
    })

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // Should NOT explicitly say "我是预言家" when only has good-person checks on day 1
    // (潜水保护自己)
    expect(text).not.toMatch(/我是预言家/)
  })

  it("claims identity in late game (<=5 alive) even with only good-person checks", async () => {
    const agent = new SeerAgent(3, "seer")
    const ctx = makeSeerSpeechCtx({
      game: {
        phase: "day_speech",
        day: 3,
        aliveSeats: [1, 2, 3, 4, 5],
        eliminatedSeats: [6, 7, 8, 9, 10, 11, 12],
      },
      memory: {
        summary: "",
        role: {
          seerChecks: [
            { target: 7, isWolf: false },
            { target: 9, isWolf: false },
          ],
        },
      },
    })

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // In late game, seer should claim to provide info before dying
    expect(text).toMatch(/预言家|验/)
  })

  it("claims identity when being pushed (high suspicion on self)", async () => {
    const agent = new SeerAgent(3, "seer")
    const ctx = makeSeerSpeechCtx({
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 1,
            text: "3号很可疑，我觉得3号是狼",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 1, text: "3号很可疑，我觉得3号是狼" },
          },
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 5,
            text: "同意出3号，3号问题很大",
            ts: 101,
            rawEvent: { t: "chat_public", ts: 101, seat: 5, text: "同意出3号，3号问题很大" },
          },
        ],
        events: [],
        keyEvents: [],
      },
      memory: {
        summary: "",
        role: {
          seerChecks: [{ target: 7, isWolf: false }],
        },
      },
    })

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // When being pushed, seer should claim identity to defend
    expect(text).toMatch(/预言家|查验|金水/)
  })
})
