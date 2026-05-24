import type {
  GameConfig,
  GamePrivateState,
  GamePublicState,
  HumanAction,
  ReplayPayload,
} from "../../shared/game.js"
import { createRng } from "./rng.js"
import {
  aliveSeatNumbers,
  createAgentRuntimeState,
  createNightState,
  mustSeat,
  type GameRuntime,
  type SeatRuntime,
} from "./model.js"
import { applyNightAction, maybeAdvanceNight } from "./night.js"
import {
  advanceToVote,
  applyDaySpeechAction,
  applyVoteAction,
  forceResolveVote,
  maybeResolveVote,
  resolveLastWords,
  skipLastWords,
} from "./day.js"
import { applyHunterAction, maybeAdvanceHunter } from "./hunter.js"
import { ensureAgentRegistry, syncAgentRegistrySeats } from "./agents/registry.js"

export const validateConfig = (config: GameConfig) => {
  if (!Array.isArray(config.seats) || config.seats.length < 4) {
    throw new Error("invalid seats")
  }
  if (!Array.isArray(config.rolePool) || config.rolePool.length !== config.seats.length) {
    throw new Error("rolePool length must match seats length")
  }
  const seatNums = new Set<number>()
  for (const s of config.seats) {
    if (seatNums.has(s.seat)) {
      throw new Error("duplicate seat number")
    }
    seatNums.add(s.seat)
    if (!s.name) throw new Error("seat name required")
    if (s.kind === "ai" && !s.ai) {
      throw new Error("ai seat must have ai config")
    }
  }
}

export const createRuntime = (gameId: string, config: GameConfig): GameRuntime => {
  validateConfig(config)
  const rng = createRng(config.rngSeed ?? gameId)
  const seats: SeatRuntime[] = config.seats.map((s) => ({
    ...s,
    alive: true,
    hand: {
      witchAntidoteUsed: false,
      witchPoisonUsed: false,
      lastGuardTarget: null,
    },
    memorySummary: "",
  }))

  return {
    gameId,
    config,
    seats,
    phase: "lobby",
    day: 0,
    events: [{ t: "system", ts: Date.now(), text: "房间已创建" }],
    rng,
    night: null,
    dayState: null,
    hunterState: null,
    agentState: createAgentRuntimeState(),
    thinkingSeats: new Set(),
  }
}

export const startGame = (g: GameRuntime) => {
  if (g.phase !== "lobby") {
    throw new Error("game already started")
  }
  ensureAgentRegistry(g)
  const roles = [...g.config.rolePool]
  g.rng.shuffleInPlace(roles)
  g.seats.forEach((s, idx) => {
    s.role = roles[idx]
  })
  syncAgentRegistrySeats(g)
  g.events.push({ t: "system", ts: Date.now(), text: "身份已分配" })

  g.day = 1
  g.phase = "night"
  g.night = createNightState()
  g.dayState = null
  g.events.push({ t: "phase", ts: Date.now(), phase: g.phase, day: g.day })
  g.events.push({ t: "system", ts: Date.now(), text: "对局开始" })
}

export const getPublicState = (g: GameRuntime): GamePublicState => {
  const aliveSeats = aliveSeatNumbers(g)
  const eliminatedSeats = g.seats.filter((s) => !s.alive).map((s) => s.seat)
  const lastEvents = g.events.slice(Math.max(0, g.events.length - 200))

  return {
    gameId: g.gameId,
    phase: g.phase,
    day: g.day,
    aliveSeats,
    eliminatedSeats,
    lastEvents,
    thinkingSeats: Array.from(g.thinkingSeats),
  }
}

export const getPrivateState = (g: GameRuntime, seat: number): GamePrivateState => {
  const s = g.seats.find((x) => x.seat === seat)
  if (!s?.role) {
    throw new Error("seat not found or role not assigned")
  }

  const state: GamePrivateState = {
    selfSeat: seat,
    role: s.role,
    hand:
      s.role === "witch"
        ? {
            witchAntidoteUsed: s.hand.witchAntidoteUsed,
            witchPoisonUsed: s.hand.witchPoisonUsed,
          }
        : undefined,
  }

  if (s.role === "witch" && g.phase === "night" && g.night?.stage === "witch") {
    state.nightHint = { wolfVictimSeat: g.night.wolfVictim }
  }

  return state
}

export const submitAction = (g: GameRuntime, seat: number, action: HumanAction) => {
  const s = mustSeat(g, seat)

  // 遗言阶段允许已死亡玩家发言
  if (g.phase === "day_last_words") {
    if (action.t !== "chat_public") throw new Error("invalid action for last words")
    if (g.dayState?.eliminatedSeat !== seat) throw new Error("only eliminated player can speak last words")
    resolveLastWords(g, seat, action.text)
    return
  }

  if (!s.alive) throw new Error("seat is not alive")
  if (!s.role) throw new Error("game not started")

  if (g.phase === "night") {
    applyNightAction(g, s, action)
    maybeAdvanceNight(g)
    return
  }

  if (g.phase === "day_speech") {
    applyDaySpeechAction(g, s, action)
    return
  }

  if (g.phase === "day_vote" || g.phase === "day_vote_pk") {
    applyVoteAction(g, s, action)
    maybeResolveVote(g)
    return
  }

  if (g.phase === "resolve") {
    applyHunterAction(g, s, action)
    maybeAdvanceHunter(g)
    return
  }

  throw new Error("game is not accepting actions")
}

export const advance = (g: GameRuntime) => {
  if (g.phase === "day_speech") {
    advanceToVote(g)
    return
  }
  if (g.phase === "day_vote" || g.phase === "day_vote_pk") {
    forceResolveVote(g)
    return
  }
  if (g.phase === "day_last_words") {
    skipLastWords(g)
    return
  }
  throw new Error("cannot advance in current phase")
}

export const getReplay = (g: GameRuntime): ReplayPayload => ({
  gameId: g.gameId,
  config: g.config,
  events: g.events,
})
