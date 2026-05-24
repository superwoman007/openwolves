import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { VillagerAgent, WerewolfAgent } from "../../api/game/agents/role-agents.js"

function makeSpeechCtx(seat: number, day: number, role: string = "villager"): AgentContext {
  return {
    self: { seat, role: role as any, alive: true },
    game: {
      phase: "day_speech",
      day,
      aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      eliminatedSeats: [10, 11, 12],
    },
    timeline: {
      speeches: [
        {
          visibility: "public",
          phase: "day_speech",
          day,
          speakerSeat: 5,
          text: "3号很可疑",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 5, text: "3号很可疑" },
        },
      ],
      events: [],
      keyEvents: [],
    },
    memory: { summary: "", role: {} },
    knowledge: {},
    privateState: {},
  }
}

describe("Heuristic speech diversity", () => {
  it("different seats produce different speeches for same role", async () => {
    const agent1 = new VillagerAgent(1, "villager")
    const agent2 = new VillagerAgent(2, "villager")

    const ctx1 = makeSpeechCtx(1, 2)
    const ctx2 = makeSpeechCtx(2, 2)

    const d1 = await agent1.decide(ctx1)
    const d2 = await agent2.decide(ctx2)

    const text1 = (d1!.action as { text: string }).text
    const text2 = (d2!.action as { text: string }).text

    // Speeches should differ beyond just the seat number prefix
    const stripped1 = text1.replace(/我是\d+号[^，]*，/, "")
    const stripped2 = text2.replace(/我是\d+号[^，]*，/, "")
    expect(stripped1).not.toBe(stripped2)
  })

  it("same seat produces different speeches on different days", async () => {
    const agent = new VillagerAgent(1, "villager")

    const ctx1 = makeSpeechCtx(1, 1)
    const ctx2 = makeSpeechCtx(1, 3)

    const d1 = await agent.decide(ctx1)
    const d2 = await agent.decide(ctx2)

    const text1 = (d1!.action as { text: string }).text
    const text2 = (d2!.action as { text: string }).text

    const stripped1 = text1.replace(/我是\d+号[^，]*，/, "")
    const stripped2 = text2.replace(/我是\d+号[^，]*，/, "")
    expect(stripped1).not.toBe(stripped2)
  })

  it("werewolf speeches vary across seats", async () => {
    const agent1 = new WerewolfAgent(1, "werewolf")
    const agent2 = new WerewolfAgent(2, "werewolf")

    const ctx1 = makeSpeechCtx(1, 2, "werewolf")
    const ctx2 = makeSpeechCtx(2, 2, "werewolf")

    const d1 = await agent1.decide(ctx1)
    const d2 = await agent2.decide(ctx2)

    const text1 = (d1!.action as { text: string }).text
    const text2 = (d2!.action as { text: string }).text

    const stripped1 = text1.replace(/我是\d+号，/, "")
    const stripped2 = text2.replace(/我是\d+号，/, "")
    expect(stripped1).not.toBe(stripped2)
  })
})
