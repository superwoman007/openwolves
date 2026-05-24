import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { LLMRoleAgent } from "../../api/game/agents/llm-role-agent.js"
import { createRoleAgent } from "../../api/game/agents/role-agents.js"

// Helper to build a minimal AgentContext for testing
function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 1, role: "villager", alive: true },
    game: {
      phase: "day_vote",
      day: 1,
      aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      eliminatedSeats: [],
    },
    timeline: { speeches: [], events: [], keyEvents: [] },
    memory: { summary: "", role: {} },
    knowledge: {},
    privateState: {},
    ...overrides,
  }
}

// Mock the LLM client
vi.mock("../../api/llm/openaiCompatible.js", () => ({
  openaiCompatChat: vi.fn(),
}))

import { openaiCompatChat } from "../../api/llm/openaiCompatible.js"
const mockLLM = vi.mocked(openaiCompatChat)

describe("LLMRoleAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns LLM decision on success", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "3号发言有问题",
      action: "vote",
      target: 3,
    }))

    const agent = new LLMRoleAgent(1, "villager", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx()
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("vote")
    expect((decision!.action as { targetSeat: number }).targetSeat).toBe(3)
    expect(decision!.reasoning).toBe("3号发言有问题")
  })

  it("falls back to heuristic when LLM fails", async () => {
    mockLLM.mockRejectedValue(new Error("API timeout"))

    const agent = new LLMRoleAgent(1, "villager", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx({
      self: { seat: 1, role: "villager", alive: true },
      timeline: {
        speeches: [{
          visibility: "public",
          phase: "day_speech",
          day: 1,
          speakerSeat: 3,
          text: "3号发言，我觉得5号很可疑，像狼",
          ts: 1,
          rawEvent: { t: "chat_public", ts: 1, seat: 3, text: "" },
        }],
        events: [],
        keyEvents: [],
      },
    })
    const decision = await agent.decide(ctx)

    // Should still return a decision via heuristic fallback
    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("vote")
  })

  it("falls back when LLM returns invalid JSON", async () => {
    mockLLM.mockResolvedValue("I'm not JSON at all, sorry!")

    const agent = new LLMRoleAgent(1, "villager", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx()
    const decision = await agent.decide(ctx)

    // Heuristic fallback should still produce a vote
    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("vote")
  })

  it("generates day speech via LLM", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "需要表态",
      action: "chat_public",
      speech: "我觉得3号逻辑有问题，建议先出他",
    }))

    const agent = new LLMRoleAgent(1, "villager", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx({
      game: { phase: "day_speech", day: 1, aliveSeats: [1, 2, 3, 4, 5], eliminatedSeats: [] },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("chat_public")
    expect((decision!.action as { text: string }).text).toBe("我觉得3号逻辑有问题，建议先出他")
  })

  it("werewolf generates wolf_kill at night", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "5号像预言家",
      action: "wolf_kill",
      target: 5,
    }))

    const agent = new LLMRoleAgent(1, "werewolf", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx({
      self: { seat: 1, role: "werewolf", alive: true },
      game: { phase: "night", day: 1, aliveSeats: [1, 2, 3, 4, 5], eliminatedSeats: [] },
      knowledge: { wolfTeammates: [2] },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("wolf_kill")
    expect((decision!.action as { targetSeat: number }).targetSeat).toBe(5)
  })

  it("seer generates seer_check at night", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "4号发言最可疑",
      action: "seer_check",
      target: 4,
    }))

    const agent = new LLMRoleAgent(3, "seer", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx({
      self: { seat: 3, role: "seer", alive: true },
      game: { phase: "night", day: 1, aliveSeats: [1, 2, 3, 4, 5], eliminatedSeats: [] },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("seer_check")
    expect((decision!.action as { targetSeat: number }).targetSeat).toBe(4)
  })

  it("witch handles antidote decision", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "5号是关键位，救",
      action: "witch_antidote",
      target: 5,
    }))

    const agent = new LLMRoleAgent(4, "witch", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx({
      self: { seat: 4, role: "witch", alive: true },
      game: { phase: "night", day: 1, aliveSeats: [1, 2, 3, 4, 5], eliminatedSeats: [] },
      privateState: { wolfVictimSeat: 5, witchAntidoteUsed: false, witchPoisonUsed: false },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("witch_antidote")
    expect((decision!.action as { targetSeat: number }).targetSeat).toBe(5)
  })

  it("guard generates guard_protect at night", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "守5号",
      action: "guard_protect",
      target: 5,
    }))

    const agent = new LLMRoleAgent(2, "guard", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx({
      self: { seat: 2, role: "guard", alive: true },
      game: { phase: "night", day: 2, aliveSeats: [1, 2, 3, 4, 5], eliminatedSeats: [] },
      privateState: { lastGuardTarget: 3 },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("guard_protect")
    expect((decision!.action as { targetSeat: number }).targetSeat).toBe(5)
  })

  it("hunter generates hunter_shoot in resolve phase", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "带走最可疑的",
      action: "hunter_shoot",
      target: 7,
    }))

    const agent = new LLMRoleAgent(6, "hunter", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx({
      self: { seat: 6, role: "hunter", alive: true },
      game: { phase: "resolve", day: 1, aliveSeats: [1, 2, 3, 6, 7, 8], eliminatedSeats: [] },
    })
    const decision = await agent.decide(ctx)

    expect(mockLLM).toHaveBeenCalled()
    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("hunter_shoot")
    expect((decision!.action as { targetSeat: number | null }).targetSeat).toBe(7)
  })

  it("werewolf generates chat_wolf before kill", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "先和队友讨论",
      action: "chat_wolf",
      speech: "我建议刀5号，像预言家",
    }))

    const agent = new LLMRoleAgent(1, "werewolf", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx({
      self: { seat: 1, role: "werewolf", alive: true },
      game: { phase: "night", day: 1, aliveSeats: [1, 2, 3, 4, 5], eliminatedSeats: [] },
      knowledge: { wolfTeammates: [2] },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("chat_wolf")
    expect((decision!.action as { text: string }).text).toBe("我建议刀5号，像预言家")
  })

  it("falls back to heuristic when LLM times out", async () => {
    // Simulate a timeout by making the mock never resolve within the timeout
    mockLLM.mockImplementation(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), 50)
    }))

    const agent = new LLMRoleAgent(1, "villager", { provider: "gpt" }, "seed-1")
    const ctx = makeCtx()
    const decision = await agent.decide(ctx)

    // Should still return a decision via heuristic fallback
    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("vote")
  })

  it("clamps temperature to valid range [0, 2]", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "ok",
      action: "vote",
      target: 3,
    }))

    // Use a very low base temperature that with offset would go negative
    const agent = new LLMRoleAgent(1, "villager", { provider: "gpt", temperature: 0.1 }, "seed-1")
    const ctx = makeCtx()
    await agent.decide(ctx)

    // Check that the temperature passed to LLM is >= 0
    const callArgs = mockLLM.mock.calls[0]![0] as { temperature: number }
    expect(callArgs.temperature).toBeGreaterThanOrEqual(0)
    expect(callArgs.temperature).toBeLessThanOrEqual(2)
  })
})

describe("createRoleAgent factory", () => {
  it("returns LLMRoleAgent for non-mock provider", () => {
    const agent = createRoleAgent(1, "villager", { provider: "gpt" })
    expect(agent).toBeInstanceOf(LLMRoleAgent)
  })

  it("returns heuristic agent for mock provider", () => {
    const agent = createRoleAgent(1, "villager", { provider: "mock" })
    expect(agent).not.toBeInstanceOf(LLMRoleAgent)
  })

  it("returns heuristic agent when no AI config", () => {
    const agent = createRoleAgent(1, "villager")
    expect(agent).not.toBeInstanceOf(LLMRoleAgent)
  })
})
