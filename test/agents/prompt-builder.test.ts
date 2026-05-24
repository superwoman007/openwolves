import { describe, it, expect } from "vitest"
import {
  buildCompactContext,
  buildCompactTimeline,
  buildSystemPromptWithPersonality,
} from "../../api/game/agents/prompt-builder.js"
import type { AgentContext } from "../../api/game/agents/types.js"
import { PERSONALITIES } from "../../api/game/agents/personality.js"

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
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
          speakerSeat: 2,
          text: "我觉得5号有问题，发言前后不一致",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 2, text: "" },
        },
        {
          visibility: "public",
          phase: "day_speech",
          day: 2,
          speakerSeat: 3,
          text: "我同意2号的判断，5号确实可疑",
          ts: 101,
          rawEvent: { t: "chat_public", ts: 101, seat: 3, text: "" },
        },
        {
          visibility: "wolf",
          phase: "night",
          day: 2,
          speakerSeat: 5,
          text: "我建议刀3号",
          ts: 50,
          rawEvent: { t: "chat_wolf", ts: 50, seat: 5, text: "" },
        },
        {
          visibility: "public",
          phase: "day_speech",
          day: 1,
          speakerSeat: 4,
          text: "第一天我先听大家发言",
          ts: 10,
          rawEvent: { t: "chat_public", ts: 10, seat: 4, text: "" },
        },
      ],
      events: [
        {
          visibility: "public",
          phase: "day_vote",
          day: 1,
          type: "action",
          actorSeat: 2,
          summary: "2号投票给10号",
          ts: 20,
          rawEvent: { t: "action", ts: 20, seat: 2, action: "vote", payload: { targetSeat: 10 } },
        },
      ],
      keyEvents: [],
    },
    memory: { summary: "第1天：10号被投出，11号夜里被刀", role: { seerChecks: [{ target: 5, isWolf: true }] } },
    knowledge: { wolfTeammates: [6] },
    privateState: {},
    ...overrides,
  }
}

describe("buildCompactTimeline", () => {
  it("only includes speeches from the last 1.5 rounds", () => {
    const ctx = makeCtx()
    const timeline = buildCompactTimeline(ctx, 2)

    // Day 2 speeches should be included, day 1 speech should be excluded (>1.5 rounds ago)
    expect(timeline).toContain("2号")
    expect(timeline).toContain("3号")
    // Day 1 speech from seat 4 should be excluded
    expect(timeline).not.toContain("第一天我先听大家发言")
  })

  it("filters by visibility for non-wolf role", () => {
    const ctx = makeCtx({ self: { seat: 1, role: "villager", alive: true } })
    const timeline = buildCompactTimeline(ctx, 2)

    // Wolf chat should not be visible to villager
    expect(timeline).not.toContain("我建议刀3号")
  })

  it("includes wolf chat for werewolf role", () => {
    const ctx = makeCtx({ self: { seat: 5, role: "werewolf", alive: true } })
    const timeline = buildCompactTimeline(ctx, 2)

    // Wolf chat should be visible to werewolf
    expect(timeline).toContain("我建议刀3号")
  })

  it("limits output to reasonable token count", () => {
    // Create a context with many speeches
    const speeches = Array.from({ length: 30 }, (_, i) => ({
      visibility: "public" as const,
      phase: "day_speech" as const,
      day: 2,
      speakerSeat: (i % 9) + 1,
      text: `这是第${i}条发言，内容比较长，用来测试token限制是否生效，确保不会超出预算`,
      ts: 100 + i,
      rawEvent: { t: "chat_public" as const, ts: 100 + i, seat: (i % 9) + 1, text: "" },
    }))

    const ctx = makeCtx({
      timeline: { speeches, events: [], keyEvents: [] },
    })
    const timeline = buildCompactTimeline(ctx, 2)

    // Should be under ~600 tokens (~2400 chars for Chinese)
    expect(timeline.length).toBeLessThan(2400)
  })
})

describe("buildCompactContext", () => {
  it("includes game state info", () => {
    const ctx = makeCtx()
    const context = buildCompactContext(ctx)

    expect(context).toContain("第2天")
    expect(context).toContain("day_vote")
    expect(context).toContain("1号")
  })

  it("includes memory summary", () => {
    const ctx = makeCtx()
    const context = buildCompactContext(ctx)

    expect(context).toContain("10号被投出")
  })

  it("includes role-specific memory for seer", () => {
    const ctx = makeCtx({ self: { seat: 1, role: "seer", alive: true } })
    const context = buildCompactContext(ctx)

    expect(context).toContain("5号")
    expect(context).toContain("狼")
  })

  it("includes wolf teammates for werewolf", () => {
    const ctx = makeCtx({ self: { seat: 5, role: "werewolf", alive: true } })
    const context = buildCompactContext(ctx)

    expect(context).toContain("6")
  })

  it("total output stays under 600 tokens (~2400 chars)", () => {
    const ctx = makeCtx()
    const context = buildCompactContext(ctx)

    expect(context.length).toBeLessThan(2400)
  })
})

describe("buildSystemPromptWithPersonality", () => {
  it("includes role system prompt", () => {
    const personality = PERSONALITIES[0] // aggressive
    const prompt = buildSystemPromptWithPersonality("werewolf", personality)

    expect(prompt).toContain("狼人")
  })

  it("appends personality modifier", () => {
    const personality = PERSONALITIES[0] // aggressive
    const prompt = buildSystemPromptWithPersonality("villager", personality)

    expect(prompt).toContain(personality.promptModifier)
  })

  it("includes JSON format instruction", () => {
    const personality = PERSONALITIES[2] // analytical
    const prompt = buildSystemPromptWithPersonality("seer", personality)

    expect(prompt).toContain("JSON")
    expect(prompt).toContain("thinking")
    expect(prompt).toContain("action")
  })

  it("different personalities produce different prompts", () => {
    const p1 = buildSystemPromptWithPersonality("villager", PERSONALITIES[0])
    const p2 = buildSystemPromptWithPersonality("villager", PERSONALITIES[1])

    expect(p1).not.toBe(p2)
  })
})
