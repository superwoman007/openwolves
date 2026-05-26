import type { AIProviderConfig } from "../../../shared/game.js"
import type { AgentTimelineContext } from "./types.js"
import { openaiCompatChat } from "../../llm/openaiCompatible.js"

const MAX_MEMORY_LENGTH = 150

/** Role claim keywords to detect in speeches */
const ROLE_CLAIM_PATTERNS = [
  /预言家/,
  /女巫/,
  /守卫/,
  /猎人/,
  /狼人/,
  /查.*[是为].*狼/,
  /我是.*[好人|神职]/,
]

/**
 * Rule-based memory update (zero-cost fallback).
 * Extracts key events and role claims, appends to old memory.
 */
export function updateMemoryRule(
  oldMemory: string,
  timeline: AgentTimelineContext,
  currentDay: number,
): string {
  const parts: string[] = []

  // Extract result events (eliminations, kills)
  const resultEvents = timeline.events.filter(
    (e) => e.type === "result" || e.type === "phase",
  )
  for (const e of resultEvents) {
    if (e.type === "result" && e.summary) {
      parts.push(e.summary)
    }
  }

  // Extract role claims from speeches
  for (const s of timeline.speeches) {
    for (const pattern of ROLE_CLAIM_PATTERNS) {
      if (pattern.test(s.text)) {
        const shortText = s.text.length > 30 ? s.text.slice(0, 27) + "..." : s.text
        parts.push(`${s.speakerSeat}号：${shortText}`)
        break
      }
    }
  }

  // Combine old memory with new info
  const newInfo = parts.join("；")
  if (!oldMemory && !newInfo) return ""

  let combined: string
  if (oldMemory && newInfo) {
    combined = `${oldMemory}；${newInfo}`
  } else {
    combined = oldMemory || newInfo
  }

  // Truncate to max length
  if (combined.length > MAX_MEMORY_LENGTH) {
    combined = combined.slice(0, MAX_MEMORY_LENGTH - 3) + "..."
  }

  return combined
}

/**
 * LLM-based memory update. Compresses timeline + old memory into ≤150 char summary.
 * Falls back to rule-based on failure.
 */
export async function updateMemoryLLM(
  oldMemory: string,
  timeline: AgentTimelineContext,
  currentDay: number,
  aiConfig: AIProviderConfig,
): Promise<string> {
  try {
    const timelineText = buildTimelineText(timeline)
    const userPrompt = buildMemoryPrompt(oldMemory, timelineText, currentDay)

    const response = await openaiCompatChat(
      {
        provider: aiConfig.provider,
        baseUrl: aiConfig.baseUrl,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        temperature: 0.3,
        maxTokens: 100,
      },
      [
        { role: "system", content: "你是狼人杀游戏记忆压缩器。将游戏事件压缩为≤150字的关键信息摘要。只保留：谁出局、谁跳身份、关键投票结果。" },
        { role: "user", content: userPrompt },
      ],
    )

    // Truncate if LLM exceeds limit
    if (response.length > MAX_MEMORY_LENGTH) {
      return response.slice(0, MAX_MEMORY_LENGTH)
    }
    return response
  } catch {
    // Fallback to rule-based
    return updateMemoryRule(oldMemory, timeline, currentDay)
  }
}

function buildTimelineText(timeline: AgentTimelineContext): string {
  const parts: string[] = []

  for (const e of timeline.events) {
    if (e.type === "result") {
      parts.push(e.summary)
    }
  }

  for (const s of timeline.speeches.slice(-8)) {
    const text = s.text.length > 40 ? s.text.slice(0, 37) + "..." : s.text
    parts.push(`${s.speakerSeat}号：${text}`)
  }

  return parts.join("\n")
}

function buildMemoryPrompt(oldMemory: string, timelineText: string, currentDay: number): string {
  const parts: string[] = []

  if (oldMemory) {
    parts.push(`旧记忆：${oldMemory}`)
  }
  parts.push(`第${currentDay}天发生的事：`)
  if (timelineText) {
    parts.push(timelineText)
  } else {
    parts.push("（无新事件）")
  }
  parts.push("\n请压缩为≤150字的关键信息摘要：")

  return parts.join("\n")
}
