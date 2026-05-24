import type { Role } from "../../../shared/game.js"
import type { AgentContext } from "./types.js"
import type { Personality } from "./personality.js"
import { getPromptCatalog } from "../prompt-config/loader.js"

const JSON_INSTRUCTION = `\n\n你必须以JSON格式回复，格式为：{"thinking":"你的推理过程","action":"动作类型","target":目标座位号或null,"speech":"发言内容或null"}`

const MAX_TIMELINE_CHARS = 2000
const MAX_SPEECHES = 12

/**
 * 构建包含性格修饰的完整 system prompt。
 */
export function buildSystemPromptWithPersonality(role: Role, personality: Personality): string {
  const config = getPromptCatalog()
  const roleConfig = config.roles[role] ?? config.fallback
  return `${roleConfig.systemPrompt}\n\n${personality.promptModifier}${JSON_INSTRUCTION}`
}

/**
 * 构建紧凑的时间线文本，只保留最近 1.5 轮的发言。
 * 根据角色过滤 visibility。
 */
export function buildCompactTimeline(ctx: AgentContext, currentDay: number): string {
  const { self } = ctx
  const isWolf = self.role === "werewolf"

  // Only include speeches from current day (1.5 rounds = current day + previous night)
  // Previous night has same day number as current day in most game engines,
  // but speeches from day-1's day_speech phase are too old
  const relevantSpeeches = ctx.timeline.speeches.filter((s) => {
    // Exclude speeches from previous day's daytime phases
    if (s.day < currentDay && (s.phase === "day_speech" || s.phase === "day_vote" || s.phase === "day_vote_pk")) {
      return false
    }
    // Exclude anything older than previous day
    if (s.day < currentDay - 1) return false

    // Filter by visibility
    if (s.visibility === "wolf" && !isWolf) return false
    if (s.visibility === "private") return false

    return true
  })

  // Take last N speeches and truncate each
  const limited = relevantSpeeches.slice(-MAX_SPEECHES)

  const lines: string[] = []
  let totalChars = 0

  for (const s of limited) {
    const prefix = s.visibility === "wolf" ? "[狼]" : ""
    const text = s.text.length > 60 ? s.text.slice(0, 57) + "..." : s.text
    const line = `${prefix}${s.speakerSeat}号：${text}`

    if (totalChars + line.length > MAX_TIMELINE_CHARS) break
    lines.push(line)
    totalChars += line.length
  }

  return lines.join("\n")
}

/**
 * 构建紧凑的游戏上下文文本，包含状态、记忆、知识。
 */
/**
 * 从时间线事件中提取当天的投票信息。
 */
function buildVoteTally(ctx: AgentContext): string | null {
  const voteEvents = ctx.timeline.events.filter(
    (e) => e.type === "action" && e.rawEvent.t === "action" &&
      (e.rawEvent as { action: string }).action === "vote" && e.day === ctx.game.day
  )
  if (voteEvents.length === 0) return null

  const votes: string[] = []
  for (const e of voteEvents) {
    const payload = (e.rawEvent as { payload?: { targetSeat?: number | null } }).payload
    const target = payload?.targetSeat
    if (e.actorSeat != null && target != null) {
      votes.push(`${e.actorSeat}→${target}`)
    }
  }
  if (votes.length === 0) return null
  return `票型：${votes.join("，")}`
}

export function buildCompactContext(ctx: AgentContext): string {
  const { self, game, memory, knowledge, privateState } = ctx
  const parts: string[] = []

  // Game state
  parts.push(`第${game.day}天 阶段=${game.phase} 你=${self.seat}号(${self.role})`)
  parts.push(`存活：${game.aliveSeats.join(",")}号`)

  if (game.eliminatedSeats.length > 0) {
    parts.push(`已出局：${game.eliminatedSeats.join(",")}号`)
  }

  // Knowledge
  if (knowledge.wolfTeammates && knowledge.wolfTeammates.length > 0) {
    parts.push(`狼队友：${knowledge.wolfTeammates.join(",")}号`)
  }

  // Private state
  if (privateState.wolfVictimSeat != null) {
    parts.push(`今晚被刀：${privateState.wolfVictimSeat}号`)
  }
  if (privateState.lastGuardTarget != null) {
    parts.push(`昨晚守护：${privateState.lastGuardTarget}号(不可连守)`)
  }
  if (privateState.witchAntidoteUsed) parts.push("解药已用")
  if (privateState.witchPoisonUsed) parts.push("毒药已用")

  // Memory
  if (memory.summary) {
    parts.push(`记忆：${memory.summary}`)
  }

  // Role-specific memory
  if (memory.role.seerChecks && Array.isArray(memory.role.seerChecks)) {
    const checks = memory.role.seerChecks as Array<{ target: number; isWolf: boolean }>
    if (checks.length > 0) {
      const checkStr = checks.map((c) => `${c.target}号=${c.isWolf ? "狼" : "好人"}`).join("，")
      parts.push(`查验：${checkStr}`)
    }
  }

  // Vote tally from current day
  const voteTally = buildVoteTally(ctx)
  if (voteTally) {
    parts.push(voteTally)
  }

  // Timeline
  const timeline = buildCompactTimeline(ctx, game.day)
  if (timeline) {
    parts.push(`发言：\n${timeline}`)
  }

  return parts.join("\n")
}
