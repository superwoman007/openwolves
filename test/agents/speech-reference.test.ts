import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { VillagerAgent, WerewolfAgent } from "../../api/game/agents/role-agents.js"

function makeSpeechWithContextCtx(seat: number, role: string, overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat, role: role as any, alive: true },
    game: {
      phase: "day_speech",
      day: 2,
      aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      eliminatedSeats: [10, 11, 12],
    },
    timeline: {
      speeches: [
        {
          visibility: "public" as const,
          phase: "day_speech" as const,
          day: 2,
          speakerSeat: 3,
          text: "我觉得7号昨天的发言前后矛盾，先说保5号后来又投了5号",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 3, text: "我觉得7号昨天的发言前后矛盾，先说保5号后来又投了5号" },
        },
        {
          visibility: "public" as const,
          phase: "day_speech" as const,
          day: 2,
          speakerSeat: 5,
          text: "同意3号的观点，7号确实可疑，我也投7号",
          ts: 101,
          rawEvent: { t: "chat_public", ts: 101, seat: 5, text: "同意3号的观点，7号确实可疑，我也投7号" },
        },
      ],
      events: [],
      keyEvents: [],
    },
    memory: { summary: "", role: {} },
    knowledge: {},
    privateState: {},
    ...overrides,
  }
}

describe("Speech references other players' statements", () => {
  it("villager speech references specific content from timeline", async () => {
    const agent = new VillagerAgent(6, "villager")
    const ctx = makeSpeechWithContextCtx(6, "villager")

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // Speech should reference what others said (mention seat numbers from speeches)
    // At minimum it should mention the target being discussed (7号)
    expect(text).toMatch(/7号/)
  })

  it("werewolf speech can reference others' statements to blend in", async () => {
    const agent = new WerewolfAgent(2, "werewolf")
    const ctx = makeSpeechWithContextCtx(2, "werewolf", {
      knowledge: { wolfTeammates: [7] }, // 7 is teammate being accused!
    })

    const decision = await agent.decide(ctx)
    const text = (decision!.action as { text: string }).text

    // Wolf should NOT vote teammate — should deflect to another target
    expect(text).not.toMatch(/7号是狼|出7号|投7号/)
  })
})
