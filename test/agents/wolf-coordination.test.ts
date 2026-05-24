import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AgentContext, AgentSpeechContext } from "../../api/game/agents/types.js"
import { LLMRoleAgent } from "../../api/game/agents/llm-role-agent.js"

vi.mock("../../api/llm/openaiCompatible.js", () => ({
  openaiCompatChat: vi.fn(),
}))

import { openaiCompatChat } from "../../api/llm/openaiCompatible.js"
const mockLLM = vi.mocked(openaiCompatChat)

function makeNightCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 1, role: "werewolf", alive: true },
    game: {
      phase: "night",
      day: 1,
      aliveSeats: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      eliminatedSeats: [],
    },
    timeline: { speeches: [], events: [], keyEvents: [] },
    memory: { summary: "", role: {} },
    knowledge: { wolfTeammates: [4] },
    privateState: {},
    ...overrides,
  }
}

describe("Wolf Coordination", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("first wolf generates chat_wolf strategy suggestion", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "5号像预言家，建议刀他",
      action: "chat_wolf",
      speech: "我建议刀5号，他发言像预言家",
    }))

    const agent = new LLMRoleAgent(1, "werewolf", { provider: "gpt" }, "seed-1")
    const ctx = makeNightCtx()
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("chat_wolf")
    expect((decision!.action as { text: string }).text).toContain("5号")
  })

  it("wolf sees previous wolf chat in context", async () => {
    // Second wolf should see the first wolf's chat
    const wolfChats: AgentSpeechContext[] = [{
      visibility: "wolf",
      phase: "night",
      day: 1,
      speakerSeat: 1,
      text: "我建议刀5号，他发言像预言家",
      ts: 50,
      rawEvent: { t: "chat_wolf", ts: 50, seat: 1, text: "我建议刀5号，他发言像预言家" },
    }]

    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "同意队友，刀5号",
      action: "chat_wolf",
      speech: "同意，5号确实像神职",
    }))

    const agent = new LLMRoleAgent(4, "werewolf", { provider: "gpt" }, "seed-1")
    const ctx = makeNightCtx({
      self: { seat: 4, role: "werewolf", alive: true },
      knowledge: { wolfTeammates: [1] },
      timeline: { speeches: wolfChats, events: [], keyEvents: [] },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    // The LLM was called with context that includes the wolf chat
    const callArgs = mockLLM.mock.calls[0]
    const userPrompt = callArgs[1].find(m => m.role === "user")?.content ?? ""
    expect(userPrompt).toContain("5号")
  })

  it("alpha wolf makes kill decision after discussion", async () => {
    // Both wolves have chatted, now alpha wolf decides kill target
    const wolfChats: AgentSpeechContext[] = [
      {
        visibility: "wolf",
        phase: "night",
        day: 1,
        speakerSeat: 1,
        text: "我建议刀5号",
        ts: 50,
        rawEvent: { t: "chat_wolf", ts: 50, seat: 1, text: "我建议刀5号" },
      },
      {
        visibility: "wolf",
        phase: "night",
        day: 1,
        speakerSeat: 4,
        text: "同意刀5号",
        ts: 51,
        rawEvent: { t: "chat_wolf", ts: 51, seat: 4, text: "同意刀5号" },
      },
    ]

    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "队友都同意刀5号",
      action: "wolf_kill",
      target: 5,
    }))

    const agent = new LLMRoleAgent(1, "werewolf", { provider: "gpt" }, "seed-1")
    const ctx = makeNightCtx({
      timeline: { speeches: wolfChats, events: [], keyEvents: [] },
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    expect(decision!.action.t).toBe("wolf_kill")
    expect((decision!.action as { targetSeat: number }).targetSeat).toBe(5)
  })

  it("single wolf skips chat and goes straight to kill", async () => {
    mockLLM.mockResolvedValue(JSON.stringify({
      thinking: "只有我一个狼，直接刀",
      action: "wolf_kill",
      target: 3,
    }))

    const agent = new LLMRoleAgent(1, "werewolf", { provider: "gpt" }, "seed-1")
    const ctx = makeNightCtx({
      knowledge: { wolfTeammates: [] }, // No teammates
    })
    const decision = await agent.decide(ctx)

    expect(decision).not.toBeNull()
    // Single wolf should get wolf_kill directly (LLM decides)
    expect(decision!.action.t).toBe("wolf_kill")
  })

  it("falls back to heuristic getWolfSuggestedTarget on LLM failure", async () => {
    mockLLM.mockRejectedValue(new Error("API error"))

    const wolfChats: AgentSpeechContext[] = [
      {
        visibility: "wolf",
        phase: "night",
        day: 1,
        speakerSeat: 4,
        text: "我建议刀5号",
        ts: 50,
        rawEvent: { t: "chat_wolf", ts: 50, seat: 4, text: "我建议刀5号" },
      },
    ]

    const agent = new LLMRoleAgent(1, "werewolf", { provider: "gpt" }, "seed-1")
    const ctx = makeNightCtx({
      timeline: { speeches: wolfChats, events: [], keyEvents: [] },
    })
    const decision = await agent.decide(ctx)

    // Heuristic fallback should still produce a decision
    expect(decision).not.toBeNull()
    // Should be either chat_wolf or wolf_kill from heuristic
    expect(["chat_wolf", "wolf_kill"]).toContain(decision!.action.t)
  })
})
