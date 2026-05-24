import { describe, it, expect } from "vitest"
import type { AgentContext, AgentEventContext } from "../../api/game/agents/types.js"
import { VillagerAgent, SeerAgent } from "../../api/game/agents/role-agents.js"

function makeVoteCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 6, role: "villager", alive: true },
    game: {
      phase: "day_vote",
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
          speakerSeat: 1,
          text: "今天出3号，3号是狼",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 1, text: "今天出3号，3号是狼" },
        },
        {
          visibility: "public" as const,
          phase: "day_speech" as const,
          day: 2,
          speakerSeat: 2,
          text: "同意出3号，3号问题很大",
          ts: 101,
          rawEvent: { t: "chat_public", ts: 101, seat: 2, text: "同意出3号，3号问题很大" },
        },
        {
          visibility: "public" as const,
          phase: "day_speech" as const,
          day: 2,
          speakerSeat: 5,
          text: "我也觉得3号可疑，投3号",
          ts: 102,
          rawEvent: { t: "chat_public", ts: 102, seat: 5, text: "我也觉得3号可疑，投3号" },
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

describe("Vote follow/bandwagon logic", () => {
  it("villager follows majority vote when multiple players target same seat", async () => {
    const agent = new VillagerAgent(6, "villager")
    const ctx = makeVoteCtx()

    const decision = await agent.decide(ctx)
    const target = (decision!.action as { targetSeat: number | null }).targetSeat

    // With 3 players all pointing at seat 3, villager should follow
    expect(target).toBe(3)
  })

  it("considers existing vote actions in timeline for bandwagon", async () => {
    const agent = new VillagerAgent(6, "villager")
    // Scenario: speeches point to 3, but actual votes already cast for 7
    const voteEvents: AgentEventContext[] = [
      {
        visibility: "public" as const,
        phase: "day_vote" as const,
        day: 2,
        type: "action",
        actorSeat: 1,
        summary: "1号投票7号",
        ts: 200,
        rawEvent: { t: "action", ts: 200, seat: 1, action: "vote", payload: { targetSeat: 7 } },
      },
      {
        visibility: "public" as const,
        phase: "day_vote" as const,
        day: 2,
        type: "action",
        actorSeat: 2,
        summary: "2号投票7号",
        ts: 201,
        rawEvent: { t: "action", ts: 201, seat: 2, action: "vote", payload: { targetSeat: 7 } },
      },
      {
        visibility: "public" as const,
        phase: "day_vote" as const,
        day: 2,
        type: "action",
        actorSeat: 5,
        summary: "5号投票7号",
        ts: 202,
        rawEvent: { t: "action", ts: 202, seat: 5, action: "vote", payload: { targetSeat: 7 } },
      },
    ]

    const ctx = makeVoteCtx({
      timeline: {
        speeches: [
          {
            visibility: "public" as const,
            phase: "day_speech" as const,
            day: 2,
            speakerSeat: 1,
            text: "今天出7号",
            ts: 100,
            rawEvent: { t: "chat_public", ts: 100, seat: 1, text: "今天出7号" },
          },
        ],
        events: voteEvents,
        keyEvents: [],
      },
    })

    const decision = await agent.decide(ctx)
    const target = (decision!.action as { targetSeat: number | null }).targetSeat

    // Should follow the actual vote trend (7号 has 3 votes)
    expect(target).toBe(7)
  })

  it("seer votes confirmed wolf over bandwagon target", async () => {
    const agent = new SeerAgent(6, "seer")
    // Bandwagon is on 3, but seer knows 8 is wolf
    const ctx = makeVoteCtx({
      self: { seat: 6, role: "seer", alive: true },
      memory: {
        summary: "",
        role: {
          seerChecks: [{ target: 8, isWolf: true }],
        },
      },
    })

    const decision = await agent.decide(ctx)
    const target = (decision!.action as { targetSeat: number | null }).targetSeat

    // Seer should vote confirmed wolf regardless of bandwagon
    expect(target).toBe(8)
  })
})
