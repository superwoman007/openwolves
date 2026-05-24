import type {
  GameConfig,
  GameEvent,
  GamePhase,
  Role,
  SeatConfig,
} from "../../shared/game.js"
import type { Rng } from "./rng.js"
import type { AgentRegistry } from "./agents/registry.js"

export type SeatRuntime = SeatConfig & {
  role?: Role
  alive: boolean
  hand: {
    witchAntidoteUsed: boolean
    witchPoisonUsed: boolean
    lastGuardTarget: number | null
  }
  memorySummary: string
}

export type NightState = {
  stage: "collect" | "witch"
  wolfVotes: Map<number, number | null>
  guardProtects: Map<number, number>
  seerChecks: Map<number, number>
  wolfVictim: number | null
  witch: {
    antidoteDecided: boolean
    poisonDecided: boolean
    antidoteTarget: number | null
    poisonTarget: number | null
  } | null
  wolfChat: Array<{ seat: number; text: string }>
}

export type DayState = {
  votes: Map<number, number | null>
  spoken: Set<number>
  pkCandidates?: number[]
  eliminatedSeat?: number
}

export type HunterState = {
  source: "night" | "day_vote"
  dyingSeats: number[]
  shots: Map<number, number | null>
}

export type AgentRuntimeState = {
  registry: AgentRegistry | null
  lastModeratorAnnouncementKey: string | null
  lastModeratorHintKey: string | null
  circuitBreaker: Map<number, number>
}

export type GameRuntime = {
  gameId: string
  config: GameConfig
  seats: SeatRuntime[]
  phase: GamePhase
  day: number
  events: GameEvent[]
  rng: Rng
  night: NightState | null
  dayState: DayState | null
  hunterState: HunterState | null
  agentState: AgentRuntimeState
  thinkingSeats: Set<number>
  onThinkingChange?: () => void
}

export const createNightState = (): NightState => ({
  stage: "collect",
  wolfVotes: new Map(),
  guardProtects: new Map(),
  seerChecks: new Map(),
  wolfVictim: null,
  witch: null,
  wolfChat: [],
})

/**
 * 创建单局对局的 Agent 运行时状态。
 * @returns 返回包含注册表引用与裁判调度缓存键的初始状态。
 */
export const createAgentRuntimeState = (): AgentRuntimeState => ({
  registry: null,
  lastModeratorAnnouncementKey: null,
  lastModeratorHintKey: null,
  circuitBreaker: new Map(),
})

export const aliveSeatNumbers = (g: GameRuntime) =>
  g.seats.filter((s) => s.alive).map((s) => s.seat)

export const isAliveSeat = (g: GameRuntime, seat: number) => {
  const s = g.seats.find((x) => x.seat === seat)
  return !!s?.alive
}

export const mustSeat = (g: GameRuntime, seat: number) => {
  const s = g.seats.find((x) => x.seat === seat)
  if (!s) throw new Error("seat not found")
  return s
}

export const hasAliveRole = (g: GameRuntime, role: Role) =>
  g.seats.some((s) => s.alive && s.role === role)
