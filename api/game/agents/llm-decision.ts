import type { GamePhase, HumanAction, Role } from "../../../shared/game.js"
import type { AgentDecision } from "./types.js"

/**
 * LLM 返回的统一 JSON 结构。
 */
export type LLMDecisionResponse = {
  thinking: string
  action: string
  target?: number | null
  speech?: string | null
}

/**
 * 解析 LLM 返回的 JSON 字符串为 AgentDecision。
 * 验证 action 对角色的合法性以及 target 在存活座位中。
 * @returns AgentDecision 或 null（解析/验证失败时）
 */
export function parseLLMDecision(
  raw: string,
  role: Role,
  aliveSeats: number[],
  selfSeat: number,
  phase?: GamePhase,
): AgentDecision | null {
  let parsed: LLMDecisionResponse
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed.action !== "string") {
    return null
  }

  const { action, target, speech, thinking } = parsed

  // Validate action is legal for role
  if (!isActionValidForRole(action, role)) {
    return null
  }

  // Validate action is legal for current phase
  if (phase && !isActionValidForPhase(action, phase)) {
    return null
  }

  // Build HumanAction
  const humanAction = buildHumanAction(action, target, speech, aliveSeats, selfSeat)
  if (!humanAction) return null

  return {
    action: humanAction,
    reasoning: thinking || undefined,
  }
}

/**
 * 检查 action 类型是否对该角色合法。
 */
function isActionValidForRole(action: string, role: Role): boolean {
  // Universal actions
  if (action === "chat_public" || action === "vote") return true

  switch (role) {
    case "werewolf":
      return action === "wolf_kill" || action === "chat_wolf"
    case "seer":
      return action === "seer_check"
    case "witch":
      return action === "witch_antidote" || action === "witch_poison"
    case "guard":
      return action === "guard_protect"
    case "hunter":
      return action === "hunter_shoot"
    case "villager":
      return false
    default:
      return false
  }
}

/**
 * 检查 action 类型是否在当前阶段合法。
 */
function isActionValidForPhase(action: string, phase: GamePhase): boolean {
  const nightActions = ["wolf_kill", "seer_check", "guard_protect", "witch_antidote", "witch_poison", "chat_wolf"]
  const dayVoteActions = ["vote"]
  const daySpeechActions = ["chat_public"]
  const resolveActions = ["hunter_shoot"]

  if (phase === "night") {
    return nightActions.includes(action) || action === "chat_public"
  }
  if (phase === "day_speech") {
    return daySpeechActions.includes(action)
  }
  if (phase === "day_vote" || phase === "day_vote_pk") {
    return dayVoteActions.includes(action)
  }
  if (phase === "resolve") {
    return resolveActions.includes(action)
  }
  return true
}

/**
 * 将 LLM 输出的 action/target/speech 转换为 HumanAction。
 */
function buildHumanAction(
  action: string,
  target: number | null | undefined,
  speech: string | null | undefined,
  aliveSeats: number[],
  _selfSeat: number,
): HumanAction | null {
  // Speech actions
  if (action === "chat_public") {
    if (!speech || typeof speech !== "string") return null
    return { t: "chat_public", text: speech }
  }
  if (action === "chat_wolf") {
    if (!speech || typeof speech !== "string") return null
    return { t: "chat_wolf", text: speech }
  }

  // Target-based actions
  const resolvedTarget = target === -1 ? null : (target ?? null)

  // Actions that allow null target (skip)
  if (action === "vote" || action === "witch_antidote" || action === "witch_poison" || action === "hunter_shoot") {
    if (resolvedTarget !== null && !aliveSeats.includes(resolvedTarget)) {
      return null
    }
    return { t: action, targetSeat: resolvedTarget } as HumanAction
  }

  // Actions that require a valid target
  if (action === "wolf_kill" || action === "seer_check" || action === "guard_protect") {
    if (resolvedTarget === null || !aliveSeats.includes(resolvedTarget)) {
      return null
    }
    return { t: action, targetSeat: resolvedTarget } as HumanAction
  }

  return null
}

/**
 * 熔断器：跟踪每个座位的连续 LLM 失败次数。
 * 超过阈值后该座位在当前周期内跳过 LLM。
 */
export class CircuitBreaker {
  constructor(
    private readonly threshold: number = 3,
    private failures: Map<number, number> = new Map(),
  ) {}

  isOpen(seat: number): boolean {
    return (this.failures.get(seat) ?? 0) >= this.threshold
  }

  recordFailure(seat: number): void {
    this.failures.set(seat, (this.failures.get(seat) ?? 0) + 1)
  }

  recordSuccess(seat: number): void {
    this.failures.set(seat, 0)
  }

  resetAll(): void {
    this.failures.clear()
  }
}
