import type { GameEvent, Role } from "../../shared/game.js"
import type { GameRuntime } from "./model.js"

/** Helper to extract text from a result event (type-safe after narrowing) */
const resultText = (e: GameEvent): string => (e as { text: string }).text

/** Helper to extract payload.targetSeat from an action event */
const actionTargetSeat = (e: GameEvent): number | undefined => {
  const payload = (e as { payload: unknown }).payload
  if (payload && typeof payload === "object" && "targetSeat" in payload) {
    return (payload as { targetSeat: number }).targetSeat
  }
  return undefined
}

/**
 * 每过一轮，AI 将早期事件总结成角色视角的记忆摘要。
 * 后续轮次 prompt 只带摘要 + 最近两轮事件，避免 token 爆炸。
 */

export const summarizeMemory = (g: GameRuntime, seat: number, role: Role): string => {
  const s = g.seats.find((x) => x.seat === seat)
  if (!s) return ""

  const oldSummary = s.memorySummary
  const lines: string[] = oldSummary ? [oldSummary] : []

  // 收集本轮新发生的关键信息
  const newLines = summarizeRound(g, seat, role)
  if (newLines.length > 0) {
    lines.push(newLines.join("；"))
  }

  // 如果太长，保留最近两次总结
  const combined = lines.join("；")
  if (combined.length > 300) {
    // 截断到最近 300 字符，保留后半部分（越新越重要）
    return "..." + combined.slice(-300)
  }
  return combined
}

const summarizeRound = (g: GameRuntime, seat: number, role: Role): string[] => {
  const lines: string[] = []
  const selfSeat = seat

  if (role === "seer") {
    // 验人结果
    for (const e of g.events) {
      if (e.t === "action" && e.action === "seer_check" && e.seat === selfSeat) {
        const target = actionTargetSeat(e)
        const targetRole = g.seats.find((x) => x.seat === target)?.role
        lines.push(`你验了${target}号，结果是${targetRole === "werewolf" ? "狼人" : "好人"}`)
      }
    }
    // 死亡信息
    const deaths = g.events
      .filter((e) => e.t === "result" && resultText(e).includes("夜晚死亡"))
      .map((e) => resultText(e))
    if (deaths.length > 0) lines.push(deaths[deaths.length - 1]!)
  }

  if (role === "werewolf") {
    // 队友刀型
    const wolfChats = g.events
      .filter((e): e is Extract<GameEvent, { t: "chat_wolf" }> => e.t === "chat_wolf")
      .map((e) => `${e.seat}号说：${e.text}`)
    if (wolfChats.length > 0) lines.push(`狼队密谋：${wolfChats.join(", ")}`)

    // 好人发言特征（找最活跃的发言者）
    const speechCount = new Map<number, number>()
    for (const e of g.events) {
      if (e.t === "chat_public") {
        speechCount.set(e.seat, (speechCount.get(e.seat) ?? 0) + 1)
      }
    }
    const topSpeaker = Array.from(speechCount.entries()).sort((a, b) => b[1] - a[1])[0]
    if (topSpeaker) {
      lines.push(`${topSpeaker[0]}号发言最活跃（${topSpeaker[1]}次），可能带节奏`)
    }

    // 死亡信息
    const deaths = g.events
      .filter((e) => e.t === "result" && resultText(e).includes("夜晚死亡"))
      .map((e) => resultText(e))
    if (deaths.length > 0) lines.push(deaths[deaths.length - 1]!)
  }

  if (role === "witch") {
    const s = g.seats.find((x) => x.seat === selfSeat)
    lines.push(
      `解药${s?.hand.witchAntidoteUsed ? "已用" : "未用"}，毒药${s?.hand.witchPoisonUsed ? "已用" : "未用"}`,
    )
    const deaths = g.events
      .filter((e) => e.t === "result" && (resultText(e).includes("夜晚死亡") || resultText(e).includes("平安夜")))
      .map((e) => resultText(e))
    if (deaths.length > 0) lines.push(deaths[deaths.length - 1]!)
  }

  if (role === "guard") {
    const s = g.seats.find((x) => x.seat === selfSeat)
    const last = s?.hand.lastGuardTarget
    if (last) lines.push(`你上晚守护了${last}号`)

    const deaths = g.events
      .filter((e) => e.t === "result" && (resultText(e).includes("夜晚死亡") || resultText(e).includes("平安夜")))
      .map((e) => resultText(e))
    if (deaths.length > 0) lines.push(deaths[deaths.length - 1]!)
  }

  if (role === "hunter") {
    const deaths = g.events
      .filter((e) => e.t === "result" && resultText(e).includes("投票放逐"))
      .map((e) => resultText(e))
    if (deaths.length > 0) lines.push(`白天放逐：${deaths[deaths.length - 1]!}`)
  }

  if (role === "villager") {
    // 记录发言最矛盾的人（发言次数多但没人信）
    const speechCount = new Map<number, number>()
    for (const e of g.events) {
      if (e.t === "chat_public") {
        speechCount.set(e.seat, (speechCount.get(e.seat) ?? 0) + 1)
      }
    }
    const topSpeaker = Array.from(speechCount.entries()).sort((a, b) => b[1] - a[1])[0]
    if (topSpeaker) {
      lines.push(`${topSpeaker[0]}号发言活跃（${topSpeaker[1]}次），需重点观察`)
    }

    const deaths = g.events
      .filter((e) => e.t === "result" && (resultText(e).includes("夜晚死亡") || resultText(e).includes("投票放逐")))
      .map((e) => resultText(e))
    if (deaths.length > 0) lines.push(deaths[deaths.length - 1]!)
  }

  return lines
}
