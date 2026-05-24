import type { GameEvent } from "../../shared/game.js"
import type { GameRuntime } from "./model.js"

/**
 * 构建 AI 可见的游戏上下文
 * - 只保留最近 2-3 轮（约 1 个昼夜周期）的事件作为短期记忆
 * - 早期事件由每个 AI seat 的 memorySummary（长期记忆）替代
 * - 对敏感信息做脱敏处理
 */
export const buildAiContext = (g: GameRuntime, seat: number) => {
  const s = g.seats.find((x) => x.seat === seat)
  const role = s?.role

  // 找出最近 3 个 phase 切换点，只保留最近 1.5 个昼夜周期的事件
  const phaseIndices: number[] = []
  for (let i = g.events.length - 1; i >= 0; i--) {
    if (g.events[i]!.t === "phase") {
      phaseIndices.push(i)
      if (phaseIndices.length >= 3) break
    }
  }
  phaseIndices.reverse()

  const startIdx = phaseIndices.length >= 3 ? phaseIndices[0] : 0
  const recentEvents = g.events.slice(startIdx)

  const visibleEvents: GameEvent[] = recentEvents.map((e) => {
    if (e.t === "action") {
      if (e.action === "vote") return e
      return { t: "system", ts: e.ts, text: "【夜间行动】" } as GameEvent
    }
    if (e.t === "chat_private") {
      return { t: "system", ts: e.ts, text: "【私聊】" } as GameEvent
    }
    if (e.t === "chat_wolf") {
      if (role === "werewolf") return e
      return { t: "system", ts: e.ts, text: "【狼人密谋】" } as GameEvent
    }
    return e
  })

  // 角色专属实时记忆（不依赖事件历史，直接读 runtime 状态）
  const memory: Record<string, unknown> = {}

  if (role === "seer") {
    const checks: Array<{ target: number; isWolf: boolean }> = []
    for (const e of g.events) {
      if (e.t === "action" && e.action === "seer_check" && e.seat === seat) {
        const payload = e.payload as Record<string, unknown> | undefined
        const target = payload?.targetSeat
        if (typeof target === "number") {
          const targetRole = g.seats.find((x) => x.seat === target)?.role
          checks.push({ target, isWolf: targetRole === "werewolf" })
        }
      }
    }
    memory.seerChecks = checks
  }

  if (role === "werewolf") {
    const teammates = g.seats
      .filter((x) => x.alive && x.role === "werewolf" && x.seat !== seat)
      .map((x) => x.seat)
    memory.wolfTeammates = teammates
  }

  if (role === "witch") {
    memory.antidoteUsed = s?.hand.witchAntidoteUsed ?? false
    memory.poisonUsed = s?.hand.witchPoisonUsed ?? false
  }

  if (role === "guard") {
    memory.lastGuardTarget = s?.hand.lastGuardTarget ?? null
  }

  return {
    selfSeat: seat,
    role,
    day: g.day,
    phase: g.phase,
    aliveSeats: g.seats.filter((x) => x.alive).map((x) => x.seat),
    events: visibleEvents,
    memorySummary: s?.memorySummary ?? "",
    memory,
  }
}
