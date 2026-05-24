import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { buildCompactContext } from "../../api/game/agents/prompt-builder.js"

function makeCtxWithVotes(): AgentContext {
  return {
    self: { seat: 3, role: "seer", alive: true },
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
          text: "今天出7号",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 1, text: "今天出7号" },
        },
      ],
      events: [
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
          actorSeat: 5,
          summary: "5号投票7号",
          ts: 201,
          rawEvent: { t: "action", ts: 201, seat: 5, action: "vote", payload: { targetSeat: 7 } },
        },
        {
          visibility: "public" as const,
          phase: "day_vote" as const,
          day: 2,
          type: "action",
          actorSeat: 6,
          summary: "6号投票2号",
          ts: 202,
          rawEvent: { t: "action", ts: 202, seat: 6, action: "vote", payload: { targetSeat: 2 } },
        },
      ],
      keyEvents: [],
    },
    memory: { summary: "第1天4号被投出", role: { seerChecks: [{ target: 7, isWolf: true }] } },
    knowledge: {},
    privateState: {},
  }
}

describe("LLM prompt includes vote history", () => {
  it("buildCompactContext includes current vote tally", () => {
    const ctx = makeCtxWithVotes()
    const context = buildCompactContext(ctx)

    // Should include vote information
    expect(context).toMatch(/票型|投票/)
    // Should show who voted whom
    expect(context).toMatch(/7号/)
  })

  it("buildCompactContext shows vote counts or individual votes", () => {
    const ctx = makeCtxWithVotes()
    const context = buildCompactContext(ctx)

    // Should indicate that 7号 has multiple votes
    expect(context).toMatch(/1号|5号/)
  })
})
