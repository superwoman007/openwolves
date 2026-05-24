import type { GameEvent, GamePhase, HumanAction, Role } from "../../../shared/game.js"

export type AgentScope = "moderator" | "player"

export type AgentVisibility = "public" | "private" | "wolf"

export type AgentResponsibility =
  | "phase_orchestration"
  | "announcement"
  | "speech_ordering"
  | "role_decision"
  | "day_speech"
  | "day_vote"
  | "night_action"

export const MODERATOR_RESPONSIBILITIES: AgentResponsibility[] = [
  "phase_orchestration",
  "announcement",
  "speech_ordering",
]

export const PLAYER_AGENT_RESPONSIBILITIES: AgentResponsibility[] = [
  "role_decision",
  "day_speech",
  "day_vote",
  "night_action",
]

export type AgentDecision = {
  action: HumanAction
  reasoning?: string
  confidence?: number
}

export type AgentContextGameSnapshot = {
  phase: GamePhase
  day: number
  aliveSeats: number[]
  eliminatedSeats: number[]
}

export type AgentContextSelfSnapshot = {
  seat: number
  role: Role
  alive: boolean
}

export type AgentSpeechContext = {
  visibility: AgentVisibility
  phase: GamePhase
  day: number
  speakerSeat?: number
  audienceSeat?: number
  text: string
  ts: number
  rawEvent: GameEvent
}

export type AgentEventContext = {
  visibility: AgentVisibility
  phase: GamePhase
  day: number
  type: GameEvent["t"]
  actorSeat?: number
  summary: string
  ts: number
  rawEvent: GameEvent
}

export type AgentPrivateState = {
  wolfVictimSeat?: number | null
  witchAntidoteUsed?: boolean
  witchPoisonUsed?: boolean
  lastGuardTarget?: number | null
}

export type AgentTimelineContext = {
  speeches: AgentSpeechContext[]
  events: AgentEventContext[]
  keyEvents: AgentEventContext[]
}

export type AgentMemoryContext = {
  summary: string
  role: Record<string, unknown>
}

export type AgentKnowledgeContext = {
  wolfTeammates?: number[]
}

export type AgentContext = {
  self: AgentContextSelfSnapshot
  game: AgentContextGameSnapshot
  timeline: AgentTimelineContext
  memory: AgentMemoryContext
  knowledge: AgentKnowledgeContext
  privateState: AgentPrivateState
}

export type ModeratorAnnouncementContext = {
  phase: GamePhase
  day: number
  nightStage?: "collect" | "witch"
  pendingSeats?: number[]
  pkCandidates?: number[]
  timeline: AgentTimelineContext
}

export type ModeratorSpeechOrderContext = {
  aliveSeats: number[]
  pkCandidates?: number[]
}

export type ModeratorFlowContext = {
  phase: GamePhase
  day: number
  aliveSeats: number[]
  pendingSeats: number[]
  nightStage?: "collect" | "witch"
  pkCandidates?: number[]
  hunterDyingSeats?: number[]
}

export type ModeratorFlowDirective = {
  shouldAdvance: boolean
  pendingSeats: number[]
  hint?: string
}

export interface BaseGameAgent {
  readonly scope: AgentScope
  readonly responsibilities: AgentResponsibility[]
}

export interface RoleAgent extends BaseGameAgent {
  readonly scope: "player"
  readonly seat: number
  readonly role: Role
  isValidActionForRole(action: HumanAction): boolean
  decide(ctx: AgentContext): Promise<AgentDecision | null>
}

export interface ModeratorAgent extends BaseGameAgent {
  readonly scope: "moderator"
  readonly role: "moderator"
  announcePhase(ctx: ModeratorAnnouncementContext): Promise<string>
  getSpeechOrder(ctx: ModeratorSpeechOrderContext): number[]
  orchestrate(ctx: ModeratorFlowContext): ModeratorFlowDirective
}
