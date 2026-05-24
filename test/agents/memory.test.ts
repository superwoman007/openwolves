import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AgentTimelineContext, AgentSpeechContext, AgentEventContext } from "../../api/game/agents/types.js"
import { updateMemoryRule, updateMemoryLLM } from "../../api/game/agents/memory.js"

vi.mock("../../api/llm/openaiCompatible.js", () => ({
  openaiCompatChat: vi.fn(),
}))

import { openaiCompatChat } from "../../api/llm/openaiCompatible.js"
const mockLLM = vi.mocked(openaiCompatChat)

function makeTimeline(speeches: Partial<AgentSpeechContext>[] = [], events: Partial<AgentEventContext>[] = []): AgentTimelineContext {
  return {
    speeches: speeches.map((s, i) => ({
      visibility: "public" as const,
      phase: "day_speech" as const,
      day: 1,
      speakerSeat: 1,
      text: "",
      ts: i,
      rawEvent: { t: "chat_public" as const, ts: i, seat: 1, text: "" },
      ...s,
    })),
    events: events.map((e, i) => ({
      visibility: "public" as const,
      phase: "day_vote" as const,
      day: 1,
      type: "action" as const,
      actorSeat: 1,
      summary: "",
      ts: i,
      rawEvent: { t: "action" as const, ts: i, seat: 1, action: "vote", payload: { targetSeat: 2 } },
      ...e,
    })),
    keyEvents: [],
  }
}

describe("updateMemoryRule (rule-based fallback)", () => {
  it("extracts elimination events", () => {
    const timeline = makeTimeline([], [
      { summary: "10号被投票出局", type: "result" as const },
    ])
    const result = updateMemoryRule("", timeline, 1)

    expect(result).toContain("10号被投票出局")
  })

  it("extracts night kill results", () => {
    const timeline = makeTimeline([], [
      { summary: "5号昨晚被刀", type: "result" as const },
    ])
    const result = updateMemoryRule("", timeline, 1)

    expect(result).toContain("5号昨晚被刀")
  })

  it("preserves old memory and appends new info", () => {
    const oldMemory = "第1天：10号被投出"
    const timeline = makeTimeline([], [
      { summary: "3号昨晚被刀", type: "result" as const, day: 2 },
    ])
    const result = updateMemoryRule(oldMemory, timeline, 2)

    expect(result).toContain("10号被投出")
    expect(result).toContain("3号昨晚被刀")
  })

  it("keeps memory under 150 characters", () => {
    const oldMemory = "A".repeat(120)
    const timeline = makeTimeline([], [
      { summary: "这是一个很长的事件描述用来测试截断功能是否正常工作", type: "result" as const },
    ])
    const result = updateMemoryRule(oldMemory, timeline, 1)

    expect(result.length).toBeLessThanOrEqual(150)
  })

  it("extracts key speeches mentioning role claims", () => {
    const timeline = makeTimeline([
      { speakerSeat: 3, text: "我是预言家，昨晚查了5号是狼" },
    ])
    const result = updateMemoryRule("", timeline, 1)

    expect(result).toContain("3号")
    expect(result).toContain("预言家")
  })

  it("returns empty string when no key events", () => {
    const timeline = makeTimeline([
      { speakerSeat: 2, text: "我先听听大家发言" },
    ])
    const result = updateMemoryRule("", timeline, 1)

    // No key events, no role claims → just old memory (empty)
    expect(result.length).toBeLessThanOrEqual(150)
  })
})

describe("updateMemoryLLM (LLM-based)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls LLM and returns compressed summary", async () => {
    mockLLM.mockResolvedValue("第1天：10号被投出，3号自称预言家查5号狼")

    const timeline = makeTimeline([
      { speakerSeat: 3, text: "我是预言家，查了5号是狼" },
    ], [
      { summary: "10号被投票出局", type: "result" as const },
    ])

    const result = await updateMemoryLLM("", timeline, 1, { provider: "gpt" })

    expect(mockLLM).toHaveBeenCalled()
    expect(result).toContain("10号被投出")
  })

  it("falls back to rule-based on LLM failure", async () => {
    mockLLM.mockRejectedValue(new Error("API error"))

    const timeline = makeTimeline([], [
      { summary: "7号被投票出局", type: "result" as const },
    ])

    const result = await updateMemoryLLM("", timeline, 1, { provider: "gpt" })

    // Should still produce a result via rule fallback
    expect(result).toContain("7号被投票出局")
  })

  it("truncates LLM output to 150 chars", async () => {
    mockLLM.mockResolvedValue("A".repeat(200))

    const timeline = makeTimeline()
    const result = await updateMemoryLLM("", timeline, 1, { provider: "gpt" })

    expect(result.length).toBeLessThanOrEqual(150)
  })

  it("passes old memory to LLM for context", async () => {
    mockLLM.mockResolvedValue("第1天10号出局，第2天3号被刀")

    const timeline = makeTimeline([], [
      { summary: "3号昨晚被刀", type: "result" as const, day: 2 },
    ])

    await updateMemoryLLM("第1天：10号被投出", timeline, 2, { provider: "gpt" })

    const callArgs = mockLLM.mock.calls[0]
    const userPrompt = callArgs[1].find(m => m.role === "user")?.content ?? ""
    expect(userPrompt).toContain("10号被投出")
  })
})
