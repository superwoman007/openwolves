import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { LLMRoleAgent } from "../../api/game/agents/llm-role-agent.js"
import { createRoleAgent } from "../../api/game/agents/role-agents.js"
import { PERSONALITIES, assignPersonality } from "../../api/game/agents/personality.js"
import { buildCompactContext, buildSystemPromptWithPersonality } from "../../api/game/agents/prompt-builder.js"
import { updateMemoryRule } from "../../api/game/agents/memory.js"

vi.mock("../../api/llm/openaiCompatible.js", () => ({
  openaiCompatChat: vi.fn(),
}))

import { openaiCompatChat } from "../../api/llm/openaiCompatible.js"
const mockLLM = vi.mocked(openaiCompatChat)

function makeFullGameCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 1, role: "villager", alive: true },
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
          speakerSeat: 3,
          text: "我是预言家，昨晚查了5号是狼",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 3, text: "我是预言家，昨晚查了5号是狼" },
        },
        {
          visibility: "public",
          phase: "day_speech",
          day: 2,
          speakerSeat: 5,
          text: "3号在诬陷我，我才是真预言家",
          ts: 101,
          rawEvent: { t: "chat_public", ts: 101, seat: 5, text: "3号在诬陷我，我才是真预言家" },
        },
        {
          visibility: "public",
          phase: "day_speech",
          day: 2,
          speakerSeat: 7,
          text: "我觉得5号逻辑有问题，支持先出5号",
          ts: 102,
          rawEvent: { t: "chat_public", ts: 102, seat: 7, text: "我觉得5号逻辑有问题，支持先出5号" },
        },
      ],
      events: [
        {
          visibility: "public",
          phase: "day_vote",
          day: 1,
          type: "result",
          summary: "10号被投票出局",
          ts: 50,
          rawEvent: { t: "result", ts: 50, text: "10号被投票出局" },
        },
      ],
      keyEvents: [],
    },
    memory: { summary: "第1天：10号被投出，11号夜里被刀", role: {} },
    knowledge: {},
    privateState: {},
    ...overrides,
  }
}

describe("Integration: Full game flow with mock LLM", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("complete day cycle: speech → vote with LLM decisions", async () => {
    // Speech phase
    mockLLM.mockResolvedValueOnce(JSON.stringify({
      thinking: "3号和5号对跳预言家，我倾向相信3号",
      action: "chat_public",
      speech: "我支持3号的查验结果，5号确实可疑",
    }))

    const agent = new LLMRoleAgent(1, "villager", { provider: "gpt" }, "game-1")
    const speechCtx = makeFullGameCtx({
      game: { phase: "day_speech", day: 2, aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9], eliminatedSeats: [10, 11, 12] },
    })
    const speechDecision = await agent.decide(speechCtx)

    expect(speechDecision).not.toBeNull()
    expect(speechDecision!.action.t).toBe("chat_public")
    expect((speechDecision!.action as { text: string }).text).toContain("5号")

    // Vote phase
    mockLLM.mockResolvedValueOnce(JSON.stringify({
      thinking: "多数人怀疑5号，投5号",
      action: "vote",
      target: 5,
    }))

    const voteCtx = makeFullGameCtx()
    const voteDecision = await agent.decide(voteCtx)

    expect(voteDecision).not.toBeNull()
    expect(voteDecision!.action.t).toBe("vote")
    expect((voteDecision!.action as { targetSeat: number }).targetSeat).toBe(5)
  })

  it("LLM failure across all seats falls back to heuristic gracefully", async () => {
    mockLLM.mockRejectedValue(new Error("Service unavailable"))

    const roles = ["villager", "werewolf", "seer", "witch", "guard", "hunter"] as const
    const ctx = makeFullGameCtx()

    for (const role of roles) {
      const agent = new LLMRoleAgent(1, role, { provider: "gpt" }, "game-1")
      const roleCtx: AgentContext = {
        ...ctx,
        self: { seat: 1, role, alive: true },
        game: {
          phase: role === "hunter" ? "resolve" : (["werewolf", "seer", "witch", "guard"].includes(role) ? "night" : "day_vote"),
          day: 1,
          aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9],
          eliminatedSeats: [],
        },
        knowledge: role === "werewolf" ? { wolfTeammates: [4] } : {},
        privateState: role === "witch" ? { wolfVictimSeat: 5, witchAntidoteUsed: false, witchPoisonUsed: false } : {},
      }

      const decision = await agent.decide(roleCtx)
      // Every role should produce a decision via heuristic fallback
      expect(decision).not.toBeNull()
    }
  })

  it("mixed mode: some seats LLM, some heuristic", () => {
    const llmAgent = createRoleAgent(1, "villager", { provider: "gpt" })
    const heuristicAgent = createRoleAgent(2, "villager", { provider: "mock" })
    const noConfigAgent = createRoleAgent(3, "villager")

    expect(llmAgent).toBeInstanceOf(LLMRoleAgent)
    expect(heuristicAgent).not.toBeInstanceOf(LLMRoleAgent)
    expect(noConfigAgent).not.toBeInstanceOf(LLMRoleAgent)
  })

  it("personality produces different prompts for same role", () => {
    const p1 = buildSystemPromptWithPersonality("villager", PERSONALITIES[0]) // aggressive
    const p2 = buildSystemPromptWithPersonality("villager", PERSONALITIES[1]) // cautious
    const p3 = buildSystemPromptWithPersonality("villager", PERSONALITIES[2]) // analytical

    // All should be different
    expect(p1).not.toBe(p2)
    expect(p2).not.toBe(p3)
    expect(p1).not.toBe(p3)

    // All should contain JSON instruction
    expect(p1).toContain("JSON")
    expect(p2).toContain("JSON")
    expect(p3).toContain("JSON")
  })

  it("personality assignment is deterministic with same seed", () => {
    const p1 = assignPersonality(3, "game-abc")
    const p2 = assignPersonality(3, "game-abc")
    const p3 = assignPersonality(3, "game-xyz")

    expect(p1.id).toBe(p2.id)
    // Different seed may produce different personality
    // (not guaranteed but statistically likely for different seeds)
  })

  it("compact context stays within token budget", () => {
    const ctx = makeFullGameCtx()
    const context = buildCompactContext(ctx)

    // Should be well under 2400 chars (~600 tokens for Chinese)
    expect(context.length).toBeLessThan(2400)
    // Should contain key info
    expect(context).toContain("第2天")
    expect(context).toContain("10号被投出")
  })

  it("memory system integrates with timeline", () => {
    const ctx = makeFullGameCtx()
    const newMemory = updateMemoryRule(
      ctx.memory.summary,
      ctx.timeline,
      ctx.game.day,
    )

    // Should preserve old memory
    expect(newMemory).toContain("10号被投出")
    // Should extract role claim from speech
    expect(newMemory).toContain("预言家")
    // Should stay under limit
    expect(newMemory.length).toBeLessThanOrEqual(150)
  })

  it("circuit breaker prevents repeated LLM calls after failures", async () => {
    mockLLM.mockRejectedValue(new Error("timeout"))

    const agent = new LLMRoleAgent(1, "villager", { provider: "gpt" }, "game-1")
    const ctx = makeFullGameCtx()

    // First 3 calls hit LLM (and fail)
    await agent.decide(ctx)
    await agent.decide(ctx)
    await agent.decide(ctx)

    expect(mockLLM).toHaveBeenCalledTimes(3)

    // 4th call should skip LLM (circuit breaker open)
    await agent.decide(ctx)
    expect(mockLLM).toHaveBeenCalledTimes(3) // Still 3, not 4
  })
})
