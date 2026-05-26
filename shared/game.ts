export type Role =
  | "villager"
  | "werewolf"
  | "seer"
  | "witch"
  | "hunter"
  | "guard"

export type PlayerKind = "human" | "ai"

export type AIProvider =
  | "mock"
  | "deepseek"
  | "doubao"
  | "glm"
  | "mimo"
  | "kimi"
  | "gpt"
  | "custom"

export type AIProviderConfig = {
  provider: AIProvider
  baseUrl?: string
  apiKey?: string
  model?: string
  temperature?: number
}

export type SeatConfig = {
  seat: number
  name: string
  kind: PlayerKind
  ai?: AIProviderConfig
}

export type ModeratorConfig = {
  ai?: AIProviderConfig
}

export type GameConfig = {
  seats: SeatConfig[]
  moderator?: ModeratorConfig
  rolePool: Role[]
  rngSeed?: string
  password?: string
  phaseTimers?: {
    speechSeconds?: number
    voteSeconds?: number
  }
}

export type GamePhase =
  | "lobby"
  | "night"
  | "day_speech"
  | "day_vote"
  | "day_vote_pk"
  | "day_last_words"
  | "resolve"
  | "ended"

export type GameEvent =
  | { t: "system"; ts: number; text: string; data?: unknown }
  | { t: "phase"; ts: number; phase: GamePhase; day: number }
  | { t: "chat_public"; ts: number; seat: number; text: string }
  | {
      t: "chat_private"
      ts: number
      fromSeat: number
      toSeat: number
      text: string
    }
  | { t: "chat_wolf"; ts: number; seat: number; text: string }
  | { t: "action"; ts: number; seat: number; action: string; payload: unknown }
  | { t: "result"; ts: number; text: string; data?: unknown }

export type GamePublicState = {
  gameId: string
  phase: GamePhase
  day: number
  aliveSeats: number[]
  eliminatedSeats: number[]
  lastEvents: GameEvent[]
  thinkingSeats: number[]
}

export type GamePrivateState = {
  selfSeat: number
  role: Role
  nightHint?: {
    wolfVictimSeat?: number | null
  }
  hand?: {
    witchAntidoteUsed?: boolean
    witchPoisonUsed?: boolean
  }
}

export type HumanAction =
  | { t: "chat_public"; text: string }
  | { t: "vote"; targetSeat: number | null }
  | { t: "wolf_kill"; targetSeat: number | null }
  | { t: "seer_check"; targetSeat: number }
  | { t: "guard_protect"; targetSeat: number }
  | { t: "witch_antidote"; targetSeat: number | null }
  | { t: "witch_poison"; targetSeat: number | null }
  | { t: "chat_wolf"; text: string }
  | { t: "hunter_shoot"; targetSeat: number | null }

export type SubmitActionRequest = {
  seat: number
  action: HumanAction
}

export type ReplayPayload = {
  gameId: string
  config: GameConfig
  events: GameEvent[]
}
