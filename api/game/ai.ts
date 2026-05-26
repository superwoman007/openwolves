import type { HumanAction, Role } from "../../shared/game.js"
import { submitAction, advance } from "./engine.js"
import { aliveSeatNumbers, type GameRuntime } from "./model.js"
import { openaiCompatChat } from "../llm/openaiCompatible.js"
import { buildAiContext } from "./ai-context.js"
import { createScheduler } from "./agent-scheduler.js"
import {
  getRolePromptConfig,
  getSharedPromptConfig,
  getPromptConfig,
  renderPromptTemplate,
} from "./prompt-config/loader.js"

export const runAuto = async (g: GameRuntime, onStep?: () => void): Promise<boolean> => {
  const scheduler = createScheduler(g)
  return scheduler.runAuto(onStep)
}

// Keep legacy helpers for compatibility and potential direct use
export const pickRandomAlive = (g: GameRuntime) => {
  const alive = aliveSeatNumbers(g)
  return g.rng.pick(alive)
}

export const pickRandomAliveOther = (g: GameRuntime, selfSeat: number) => {
  const alive = aliveSeatNumbers(g).filter((s) => s !== selfSeat)
  return g.rng.pick(alive)
}

export const pickWolfKillTarget = (g: GameRuntime) => {
  const alive = g.seats.filter((s) => s.alive && s.role)
  const wolves = new Set(alive.filter((s) => s.role === "werewolf").map((s) => s.seat))
  const targets = alive.map((s) => s.seat).filter((seat) => !wolves.has(seat))
  if (targets.length === 0) return null

  // 优先刀明神职（简单策略：优先刀预言家、女巫、守卫）
  const priorityRoles = ["seer", "witch", "guard"]
  for (const role of priorityRoles) {
    const roleTargets = targets.filter((seat) => {
      const s = g.seats.find((x) => x.seat === seat)
      return s?.role === role
    })
    if (roleTargets.length > 0) return g.rng.pick(roleTargets)
  }

  return g.rng.pick(targets)
}

export const decideAntidote = (g: GameRuntime) => {
  if (!g.night || g.night.wolfVictim === null) return null
  const r = g.rng.next()
  return r < 0.55 ? g.night.wolfVictim : null
}

export const decidePoison = (g: GameRuntime, selfSeat: number) => {
  const r = g.rng.next()
  if (r > 0.3) return null
  const alive = aliveSeatNumbers(g).filter((s) => s !== selfSeat)
  if (alive.length === 0) return null
  return g.rng.pick(alive)
}

export const decideVote = (g: GameRuntime, selfSeat: number) => {
  const alive = aliveSeatNumbers(g).filter((s) => s !== selfSeat)
  if (alive.length === 0) return null

  // PK 阶段只能从候选人中投
  if (g.dayState?.pkCandidates) {
    const candidates = g.dayState.pkCandidates.filter((s) => s !== selfSeat && alive.includes(s))
    if (candidates.length === 0) return null
    return g.rng.pick(candidates)
  }

  // 预言家优先投验出的狼人
  const self = g.seats.find((s) => s.seat === selfSeat)
  if (self?.role === "seer") {
    for (const e of g.events) {
      if (e.t === "action" && e.action === "seer_check" && e.seat === selfSeat) {
        const target = (e.payload as Record<string, unknown> | undefined)?.targetSeat as number | undefined
        if (typeof target !== "number") continue
        const targetRole = g.seats.find((x) => x.seat === target)?.role
        if (targetRole === "werewolf" && alive.includes(target)) {
          return target
        }
      }
    }
  }

  // 狼人避免投队友
  if (self?.role === "werewolf") {
    const wolves = new Set(g.seats.filter((s) => s.alive && s.role === "werewolf").map((s) => s.seat))
    const nonWolves = alive.filter((s) => !wolves.has(s))
    if (nonWolves.length > 0) return g.rng.pick(nonWolves)
  }

  return g.rng.pick(alive)
}

/**
 * 为指定座位生成公开发言，优先调用真实模型，失败时退回配置化兜底发言。
 * @param g 当前对局运行时。
 * @param seat 需要发言的座位号。
 * @param role 当前座位的角色。
 * @returns 返回最终公开发言文本。
 */
export const generateSpeech = async (g: GameRuntime, seat: number, role: Role) => {
  const day = g.day
  const seatCfg = g.seats.find((s) => s.seat === seat)

  // 为每个角色构建专属记忆
  const memory = buildRoleMemory(g, seat, role)

  const ai = seatCfg?.ai
  const isRealProvider = ai && ai.provider !== "mock"
  if (isRealProvider && (ai.apiKey || process.env.OPENAI_API_KEY)) {
    g.thinkingSeats.add(seat)
    g.onThinkingChange?.()
    try {
      const ctx = buildAiContext(g, seat)
      const ctxJson = JSON.stringify(ctx, (_k, v) => {
        if (v instanceof Map) return Object.fromEntries(v)
        if (v instanceof Set) return Array.from(v)
        return v
      })
      const systemPrompt = getPromptConfig(role).systemPrompt
      const userPrompt = renderPromptTemplate(getSharedPromptConfig().publicSpeechUserPromptTemplate, {
        contextJson: ctxJson,
        memorySummary: ctx.memorySummary || "无",
        roleMemory: memory,
        day,
        seat,
        role,
      })

      const content = await openaiCompatChat(
        {
          provider: ai.provider,
          baseUrl: ai.baseUrl,
          apiKey: ai.apiKey,
          model: ai.model,
          temperature: ai.temperature,
        },
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      )
      return content.slice(0, 120)
    } catch {
      return generateMockSpeech(g, seat, role)
    } finally {
      g.thinkingSeats.delete(seat)
      g.onThinkingChange?.()
    }
  }
  return generateMockSpeech(g, seat, role)
}

export const buildRoleMemory = (g: GameRuntime, seat: number, role: Role): string => {
  if (role === "seer") {
    const checks: string[] = []
    for (const e of g.events) {
      if (e.t === "action" && e.action === "seer_check" && e.seat === seat) {
        const target = (e.payload as Record<string, unknown> | undefined)?.targetSeat as number | undefined
        if (typeof target !== "number") continue
        const targetRole = g.seats.find((x) => x.seat === target)?.role
        checks.push(`${target}号${targetRole === "werewolf" ? "是狼人" : "是好人"}`)
      }
    }
    return checks.length > 0 ? `你验过的人：${checks.join("；")}` : "你还没有验过人"
  }

  if (role === "werewolf") {
    const teammates = g.seats
      .filter((s) => s.alive && s.role === "werewolf" && s.seat !== seat)
      .map((s) => `${s.seat}号`)
    return teammates.length > 0 ? `你的狼队友：${teammates.join("、")}` : "你是最后一匹狼"
  }

  if (role === "witch") {
    const s = g.seats.find((x) => x.seat === seat)
    const antidoteUsed = s?.hand.witchAntidoteUsed ?? false
    const poisonUsed = s?.hand.witchPoisonUsed ?? false
    return `解药${antidoteUsed ? "已用" : "未用"}，毒药${poisonUsed ? "已用" : "未用"}`
  }

  if (role === "guard") {
    const s = g.seats.find((x) => x.seat === seat)
    const lastTarget = s?.hand.lastGuardTarget
    return lastTarget ? `你上一晚守护了${lastTarget}号` : "你还没有守护过任何人"
  }

  if (role === "hunter") {
    return "你尚未开枪，濒死后可以选择开枪或放弃"
  }

  return "你是普通村民，没有特殊信息"
}

/**
 * 基于统一提示词配置生成兜底公开发言。
 * @param g 当前对局运行时。
 * @param seat 需要发言的座位号。
 * @param role 当前座位的角色。
 * @returns 返回由配置模板拼装出的中文发言文本。
 */
export const generateMockSpeech = (g: GameRuntime, seat: number, role: Role): string => {
  const day = g.day
  const sharedConfig = getSharedPromptConfig()
  const roleConfig = getRolePromptConfig(role)
  const openerTemplate = g.rng.pick(sharedConfig.mockSpeechOpeners)
  const opener = renderPromptTemplate(openerTemplate, { day, seat, role })
  const stance = g.rng.pick(roleConfig.mockSpeechStances)
  return `${opener}${stance}`
}
