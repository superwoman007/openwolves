import { describe, it, expect, vi, beforeEach } from "vitest"
import { openaiCompatChat } from "../../api/llm/openaiCompatible.js"
import {
  parseLLMDecision,
  type LLMDecisionResponse,
} from "../../api/game/agents/llm-decision.js"
import {
  CircuitBreaker,
} from "../../api/game/agents/llm-decision.js"
import {
  assignPersonality,
  PERSONALITIES,
  type Personality,
} from "../../api/game/agents/personality.js"

// --- openaiCompatChat extensions ---

describe("openaiCompatChat", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("sends responseFormat in request body when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"thinking":"ok","action":"vote","target":3}' } }],
      }),
    })
    vi.stubGlobal("fetch", mockFetch)

    await openaiCompatChat(
      { apiKey: "test-key", responseFormat: { type: "json_object" } },
      [{ role: "user", content: "test" }],
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.response_format).toEqual({ type: "json_object" })
  })

  it("sends max_tokens in request body when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "hello" } }],
      }),
    })
    vi.stubGlobal("fetch", mockFetch)

    await openaiCompatChat(
      { apiKey: "test-key", maxTokens: 300 },
      [{ role: "user", content: "test" }],
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(300)
  })

  it("does not include responseFormat or max_tokens when not provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "hello" } }],
      }),
    })
    vi.stubGlobal("fetch", mockFetch)

    await openaiCompatChat(
      { apiKey: "test-key" },
      [{ role: "user", content: "test" }],
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.response_format).toBeUndefined()
    expect(body.max_tokens).toBeUndefined()
  })
})

// --- parseLLMDecision ---

describe("parseLLMDecision", () => {
  const aliveSeats = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const selfSeat = 1

  it("parses valid vote decision", () => {
    const raw: LLMDecisionResponse = {
      thinking: "3号发言有问题",
      action: "vote",
      target: 3,
      speech: null,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "villager", aliveSeats, selfSeat)
    expect(result).not.toBeNull()
    expect(result!.action.t).toBe("vote")
    expect((result!.action as { targetSeat: number }).targetSeat).toBe(3)
    expect(result!.reasoning).toBe("3号发言有问题")
  })

  it("parses valid chat_public decision", () => {
    const raw: LLMDecisionResponse = {
      thinking: "需要表态",
      action: "chat_public",
      target: null,
      speech: "我觉得3号有问题",
    }
    const result = parseLLMDecision(JSON.stringify(raw), "villager", aliveSeats, selfSeat)
    expect(result).not.toBeNull()
    expect(result!.action.t).toBe("chat_public")
    expect((result!.action as { text: string }).text).toBe("我觉得3号有问题")
  })

  it("parses valid wolf_kill decision", () => {
    const raw: LLMDecisionResponse = {
      thinking: "5号像预言家",
      action: "wolf_kill",
      target: 5,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "werewolf", aliveSeats, selfSeat)
    expect(result).not.toBeNull()
    expect(result!.action.t).toBe("wolf_kill")
    expect((result!.action as { targetSeat: number }).targetSeat).toBe(5)
  })

  it("parses witch_antidote with null target (skip)", () => {
    const raw: LLMDecisionResponse = {
      thinking: "不值得救",
      action: "witch_antidote",
      target: -1,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "witch", aliveSeats, selfSeat)
    expect(result).not.toBeNull()
    expect(result!.action.t).toBe("witch_antidote")
    expect((result!.action as { targetSeat: number | null }).targetSeat).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    const result = parseLLMDecision("not json at all", "villager", aliveSeats, selfSeat)
    expect(result).toBeNull()
  })

  it("returns null for JSON missing required fields", () => {
    const result = parseLLMDecision('{"thinking":"ok"}', "villager", aliveSeats, selfSeat)
    expect(result).toBeNull()
  })

  it("returns null when action is not valid for role", () => {
    const raw: LLMDecisionResponse = {
      thinking: "我要杀人",
      action: "wolf_kill",
      target: 3,
    }
    // villager cannot wolf_kill
    const result = parseLLMDecision(JSON.stringify(raw), "villager", aliveSeats, selfSeat)
    expect(result).toBeNull()
  })

  it("returns null when target is not in alive seats", () => {
    const raw: LLMDecisionResponse = {
      thinking: "投99号",
      action: "vote",
      target: 99,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "villager", aliveSeats, selfSeat)
    expect(result).toBeNull()
  })

  it("allows target to be self seat for guard_protect", () => {
    const raw: LLMDecisionResponse = {
      thinking: "守自己",
      action: "guard_protect",
      target: 1,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "guard", aliveSeats, 1)
    expect(result).not.toBeNull()
    expect(result!.action.t).toBe("guard_protect")
  })

  it("parses chat_wolf decision", () => {
    const raw: LLMDecisionResponse = {
      thinking: "建议刀5号",
      action: "chat_wolf",
      speech: "我建议刀5号，像预言家",
    }
    const result = parseLLMDecision(JSON.stringify(raw), "werewolf", aliveSeats, selfSeat)
    expect(result).not.toBeNull()
    expect(result!.action.t).toBe("chat_wolf")
    expect((result!.action as { text: string }).text).toBe("我建议刀5号，像预言家")
  })

  // Phase-based validation
  it("rejects wolf_kill during day_speech phase", () => {
    const raw: LLMDecisionResponse = {
      thinking: "刀5号",
      action: "wolf_kill",
      target: 5,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "werewolf", aliveSeats, selfSeat, "day_speech")
    expect(result).toBeNull()
  })

  it("rejects seer_check during day_vote phase", () => {
    const raw: LLMDecisionResponse = {
      thinking: "查3号",
      action: "seer_check",
      target: 3,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "seer", aliveSeats, selfSeat, "day_vote")
    expect(result).toBeNull()
  })

  it("rejects vote during night phase", () => {
    const raw: LLMDecisionResponse = {
      thinking: "投3号",
      action: "vote",
      target: 3,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "villager", aliveSeats, selfSeat, "night")
    expect(result).toBeNull()
  })

  it("allows wolf_kill during night phase", () => {
    const raw: LLMDecisionResponse = {
      thinking: "刀5号",
      action: "wolf_kill",
      target: 5,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "werewolf", aliveSeats, selfSeat, "night")
    expect(result).not.toBeNull()
  })

  it("allows vote during day_vote phase", () => {
    const raw: LLMDecisionResponse = {
      thinking: "投3号",
      action: "vote",
      target: 3,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "villager", aliveSeats, selfSeat, "day_vote")
    expect(result).not.toBeNull()
  })

  it("skips phase validation when phase not provided (backward compat)", () => {
    const raw: LLMDecisionResponse = {
      thinking: "刀5号",
      action: "wolf_kill",
      target: 5,
    }
    const result = parseLLMDecision(JSON.stringify(raw), "werewolf", aliveSeats, selfSeat)
    expect(result).not.toBeNull()
  })
})

// --- CircuitBreaker ---

describe("CircuitBreaker", () => {
  it("allows calls initially", () => {
    const cb = new CircuitBreaker(3)
    expect(cb.isOpen(1)).toBe(false)
  })

  it("opens after threshold consecutive failures", () => {
    const cb = new CircuitBreaker(3)
    cb.recordFailure(1)
    cb.recordFailure(1)
    expect(cb.isOpen(1)).toBe(false)
    cb.recordFailure(1)
    expect(cb.isOpen(1)).toBe(true)
  })

  it("resets on success", () => {
    const cb = new CircuitBreaker(3)
    cb.recordFailure(1)
    cb.recordFailure(1)
    cb.recordSuccess(1)
    cb.recordFailure(1)
    expect(cb.isOpen(1)).toBe(false)
  })

  it("resets all seats on phase change", () => {
    const cb = new CircuitBreaker(3)
    cb.recordFailure(1)
    cb.recordFailure(1)
    cb.recordFailure(1)
    expect(cb.isOpen(1)).toBe(true)
    cb.resetAll()
    expect(cb.isOpen(1)).toBe(false)
  })

  it("resets per-seat on new day via resetAll", () => {
    const cb = new CircuitBreaker(3)
    cb.recordFailure(1)
    cb.recordFailure(1)
    cb.recordFailure(1)
    expect(cb.isOpen(1)).toBe(true)
    cb.resetAll()
    expect(cb.isOpen(1)).toBe(false)
  })

  it("resetAll resets all seats", () => {
    const cb = new CircuitBreaker(3)
    cb.recordFailure(1)
    cb.recordFailure(1)
    cb.recordFailure(1)
    cb.recordFailure(2)
    cb.recordFailure(2)
    cb.recordFailure(2)
    expect(cb.isOpen(1)).toBe(true)
    expect(cb.isOpen(2)).toBe(true)
    cb.resetAll()
    expect(cb.isOpen(1)).toBe(false)
    expect(cb.isOpen(2)).toBe(false)
  })

  it("tracks seats independently", () => {
    const cb = new CircuitBreaker(3)
    cb.recordFailure(1)
    cb.recordFailure(1)
    cb.recordFailure(1)
    expect(cb.isOpen(1)).toBe(true)
    expect(cb.isOpen(2)).toBe(false)
  })
})

// --- Personality assignment ---

describe("assignPersonality", () => {
  it("returns a valid personality", () => {
    const p = assignPersonality(1, "seed-123")
    expect(PERSONALITIES.some((pp) => pp.id === p.id)).toBe(true)
  })

  it("is deterministic for same seed and seat", () => {
    const p1 = assignPersonality(3, "game-abc")
    const p2 = assignPersonality(3, "game-abc")
    expect(p1.id).toBe(p2.id)
  })

  it("varies across different seats with same seed", () => {
    const results = new Set<string>()
    for (let seat = 1; seat <= 9; seat++) {
      results.add(assignPersonality(seat, "game-xyz").id)
    }
    // With 9 seats and 6 personalities, we should get at least 3 different ones
    expect(results.size).toBeGreaterThanOrEqual(3)
  })

  it("varies across different seeds with same seat", () => {
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) {
      results.add(assignPersonality(1, `seed-${i}`).id)
    }
    // With 20 different seeds, should get multiple personalities
    expect(results.size).toBeGreaterThanOrEqual(2)
  })
})
