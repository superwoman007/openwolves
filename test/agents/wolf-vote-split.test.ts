import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { WerewolfAgent } from "../../api/game/agents/role-agents.js"

function makeWolfVoteCtx(seat: number, teammates: number[]): AgentContext {
  return {
    self: { seat, role: "werewolf", alive: true },
    game: {
      phase: "day_vote",
      day: 2,
      aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      eliminatedSeats: [10, 11, 12],
    },
    timeline: {
      speeches: [
        {
          visibility: "public",
          phase: "day_speech",
          day: 2,
          speakerSeat: 5,
          text: "3号很可疑，我觉得3号是狼",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 5, text: "3号很可疑，我觉得3号是狼" },
        },
        {
          visibility: "public",
          phase: "day_speech",
          day: 2,
          speakerSeat: 6,
          text: "同意出3号，3号问题很大",
          ts: 101,
          rawEvent: { t: "chat_public", ts: 101, seat: 6, text: "同意出3号，3号问题很大" },
        },
      ],
      events: [],
      keyEvents: [],
    },
    memory: { summary: "", role: {} },
    knowledge: { wolfTeammates: teammates },
    privateState: {},
  }
}

describe("Wolf vote-splitting strategy", () => {
  it("wolves with different seats vote different targets when multiple wolves alive", async () => {
    const wolf1 = new WerewolfAgent(1, "werewolf")
    const wolf2 = new WerewolfAgent(2, "werewolf")

    const ctx1 = makeWolfVoteCtx(1, [2])
    const ctx2 = makeWolfVoteCtx(2, [1])

    const d1 = await wolf1.decide(ctx1)
    const d2 = await wolf2.decide(ctx2)

    const target1 = (d1!.action as { targetSeat: number | null }).targetSeat
    const target2 = (d2!.action as { targetSeat: number | null }).targetSeat

    // At least one wolf should vote differently to avoid pattern detection
    expect(target1).not.toBe(target2)
  })

  it("lone wolf votes normally (highest suspicion)", async () => {
    const wolf = new WerewolfAgent(1, "werewolf")
    const ctx = makeWolfVoteCtx(1, [])

    const decision = await wolf.decide(ctx)
    const target = (decision!.action as { targetSeat: number | null }).targetSeat

    // Should vote 3 (most suspected)
    expect(target).toBe(3)
  })

  it("wolves never vote for each other", async () => {
    const wolf1 = new WerewolfAgent(1, "werewolf")
    const wolf2 = new WerewolfAgent(2, "werewolf")

    const ctx1 = makeWolfVoteCtx(1, [2])
    const ctx2 = makeWolfVoteCtx(2, [1])

    const d1 = await wolf1.decide(ctx1)
    const d2 = await wolf2.decide(ctx2)

    const target1 = (d1!.action as { targetSeat: number | null }).targetSeat
    const target2 = (d2!.action as { targetSeat: number | null }).targetSeat

    expect(target1).not.toBe(2) // wolf1 doesn't vote wolf2
    expect(target2).not.toBe(1) // wolf2 doesn't vote wolf1
  })
})
