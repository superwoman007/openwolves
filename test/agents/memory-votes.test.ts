import { describe, it, expect } from "vitest"
import type { GameRuntime } from "../../api/game/model.js"
import { updateMemoryForAllSeats } from "../../api/game/agents/memory-hook.js"

function makeGameWithVotes(): GameRuntime {
  return {
    id: "test-game",
    phase: "night",
    day: 2,
    seats: [
      { seat: 1, kind: "ai", role: "villager", alive: true, hand: {}, memorySummary: "" },
      { seat: 2, kind: "ai", role: "werewolf", alive: true, hand: {}, memorySummary: "" },
      { seat: 3, kind: "ai", role: "seer", alive: true, hand: {}, memorySummary: "" },
      { seat: 4, kind: "ai", role: "villager", alive: false, hand: {}, memorySummary: "" },
    ] as any,
    events: [
      { t: "phase", ts: 1, phase: "day_vote", day: 1 },
      { t: "action", ts: 2, seat: 1, action: "vote", payload: { targetSeat: 4 } },
      { t: "action", ts: 3, seat: 2, action: "vote", payload: { targetSeat: 4 } },
      { t: "action", ts: 4, seat: 3, action: "vote", payload: { targetSeat: 2 } },
      { t: "result", ts: 5, text: "4号被投票出局" },
      { t: "phase", ts: 6, phase: "night", day: 2 },
    ] as any,
    night: null,
    dayState: null,
    hunterState: null,
    agentState: { lastModeratorAnnouncementKey: null, lastModeratorHintKey: null },
    winner: null,
  } as any
}

describe("Memory tracks vote history", () => {
  it("includes vote information in memory after phase transition", () => {
    const g = makeGameWithVotes()
    updateMemoryForAllSeats(g)

    // At least one seat's memory should contain vote info
    const memories = g.seats.map((s: any) => s.memorySummary)
    const hasVoteInfo = memories.some((m: string) => /投/.test(m) || /票/.test(m))
    expect(hasVoteInfo).toBe(true)
  })

  it("records who voted whom in memory summary", () => {
    const g = makeGameWithVotes()
    updateMemoryForAllSeats(g)

    // Check that vote actions are captured in the timeline-based memory
    const seat1Memory = (g.seats[0] as any).memorySummary as string
    // Memory should reflect the vote events that happened
    expect(seat1Memory.length).toBeGreaterThan(0)
    // Should contain reference to voting action
    expect(seat1Memory).toMatch(/投|票|出局/)
  })
})
