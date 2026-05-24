import type { GameRuntime, SeatRuntime } from "../model.js"
import type { AgentSpeechContext, AgentEventContext, AgentTimelineContext, AgentVisibility } from "./types.js"
import { updateMemoryRule } from "./memory.js"
import type { GameEvent, Role } from "../../../shared/game.js"

/**
 * 为所有 AI 座位更新记忆摘要。
 * 在阶段转换时由 Scheduler 调用。
 */
export function updateMemoryForAllSeats(g: GameRuntime): void {
  for (const s of g.seats) {
    if (s.kind !== "ai" || !s.role) continue

    const isWolf = s.role === "werewolf"
    const timeline = buildSeatTimeline(g, s.seat, isWolf)
    const baseMemory = updateMemoryRule(s.memorySummary, timeline, g.day)
    const roleMemory = buildRoleSpecificMemory(g, s)
    s.memorySummary = mergeMemory(baseMemory, roleMemory)
  }
}

/**
 * 构建角色特有的记忆片段。
 */
function buildRoleSpecificMemory(g: GameRuntime, s: SeatRuntime): string {
  const parts: string[] = []

  switch (s.role) {
    case "seer": {
      for (const e of g.events) {
        if (e.t === "action" && e.action === "seer_check" && e.seat === s.seat) {
          const target = (e.payload as { targetSeat?: number })?.targetSeat
          if (target != null) {
            const targetRole = g.seats.find(x => x.seat === target)?.role
            parts.push(`验${target}号=${targetRole === "werewolf" ? "狼" : "好人"}`)
          }
        }
      }
      break
    }
    case "werewolf": {
      const wolfChats = g.events
        .filter(e => e.t === "chat_wolf")
        .map(e => (e as { text: string }).text)
      if (wolfChats.length > 0) {
        parts.push(`狼聊：${wolfChats.join(";")}`)
      }
      break
    }
    case "witch": {
      const antidote = s.hand.witchAntidoteUsed ? "解药已用" : "解药未用"
      const poison = s.hand.witchPoisonUsed ? "毒药已用" : "毒药未用"
      parts.push(`${antidote}，${poison}`)
      break
    }
    case "guard": {
      const last = s.hand.lastGuardTarget
      if (last != null) {
        parts.push(`上次守护${last}号`)
      }
      break
    }
  }

  return parts.join("；")
}

/**
 * 合并基础记忆和角色记忆，保持在 150 字符以内。
 */
function mergeMemory(baseMemory: string, roleMemory: string): string {
  if (!roleMemory) return baseMemory
  if (!baseMemory) return roleMemory.slice(0, 150)

  const combined = `${roleMemory}｜${baseMemory}`
  if (combined.length <= 150) return combined
  return combined.slice(0, 150)
}

/**
 * 为指定座位构建可见的时间线上下文。
 * 过滤掉该座位不可见的事件（如非狼人看不到 wolf chat）。
 */
function buildSeatTimeline(g: GameRuntime, seat: number, isWolf: boolean): AgentTimelineContext {
  const speeches: AgentSpeechContext[] = []
  const events: AgentEventContext[] = []

  for (const event of g.events) {
    const visibility = inferVisibility(event)

    // Filter by visibility
    if (visibility === "wolf" && !isWolf) continue
    if (visibility === "private") continue

    // Build event context
    const actorSeat = getActorSeat(event)
    events.push({
      visibility,
      phase: g.phase,
      day: g.day,
      type: event.t,
      actorSeat,
      summary: summarizeEvent(event),
      ts: event.ts,
      rawEvent: event,
    })

    // Build speech context
    if (event.t === "chat_public" || event.t === "chat_wolf") {
      speeches.push({
        visibility,
        phase: g.phase,
        day: g.day,
        speakerSeat: event.seat,
        text: event.text,
        ts: event.ts,
        rawEvent: event,
      })
    }
  }

  return { speeches, events, keyEvents: [] }
}

function inferVisibility(event: GameEvent): AgentVisibility {
  if (event.t === "chat_private") return "private"
  if (event.t === "chat_wolf") return "wolf"
  return "public"
}

function getActorSeat(event: GameEvent): number | undefined {
  if ("seat" in event) return (event as { seat: number }).seat
  if ("fromSeat" in event) return (event as { fromSeat: number }).fromSeat
  return undefined
}

function summarizeEvent(event: GameEvent): string {
  switch (event.t) {
    case "system": return event.text
    case "result": return event.text
    case "phase": return `阶段切换到${event.phase}（第${event.day}天）`
    case "chat_public": return `${event.seat}号：${event.text}`
    case "chat_wolf": return `[狼]${event.seat}号：${event.text}`
    case "action": return `${event.seat}号执行${event.action}`
    default: return ""
  }
}
