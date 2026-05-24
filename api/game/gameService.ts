import crypto from "node:crypto"
import type {
  GameConfig,
  GamePrivateState,
  GamePublicState,
  HumanAction,
  ReplayPayload,
} from "../../shared/game.js"
import type { GameRuntime } from "./model.js"
import { runAuto } from "./ai.js"
import {
  advance,
  createRuntime,
  getPrivateState,
  getPublicState,
  getReplay,
  startGame,
  submitAction,
} from "./engine.js"
import { GameStore } from "../db/gameStore.js"
import { revokeGameTokens } from "../middleware/auth.js"
import { logger } from "../lib/logger.js"

/** Maximum in-memory events before trimming older entries */
const MAX_EVENTS = 2000

export class GameService {
  private games = new Map<string, GameRuntime>()
  private subscribers = new Map<string, Set<(state: GamePublicState) => void>>()
  private store: GameStore | null
  private autoTimers = new Map<string, ReturnType<typeof setInterval>>()
  private runningAuto = new Set<string>()

  constructor(store?: GameStore) {
    this.store = store ?? null
  }

  createGame(config: GameConfig) {
    const gameId = crypto.randomUUID()
    const g = createRuntime(gameId, config)
    g.onThinkingChange = () => this.publish(gameId)
    this.games.set(gameId, g)
    // Fire-and-forget persistence (async)
    this.store?.createGame(gameId, config).catch(() => {})
    this.store?.overwriteEvents(gameId, g.events).catch(() => {})
    this.publish(gameId)
    return { gameId }
  }

  async startGame(gameId: string): Promise<GamePublicState> {
    const g = await this.mustGet(gameId)
    startGame(g)
    const state = getPublicState(g)
    this.persistEvents(gameId, g)
    this.publish(gameId, state)
    this.startAutoRun(gameId)
    return state
  }

  getPublicState(gameId: string): GamePublicState {
    return getPublicState(this.mustGetSync(gameId))
  }

  getPrivateState(gameId: string, seat: number): GamePrivateState {
    return getPrivateState(this.mustGetSync(gameId), seat)
  }

  async submitAction(gameId: string, seat: number, action: HumanAction): Promise<GamePublicState> {
    const g = await this.mustGet(gameId)
    submitAction(g, seat, action)
    await this.safeRunAuto(gameId)
    const state = getPublicState(g)
    this.persistEvents(gameId, g)
    this.publish(gameId, state)
    return state
  }

  async advance(gameId: string): Promise<GamePublicState> {
    const g = await this.mustGet(gameId)
    advance(g)
    await this.safeRunAuto(gameId)
    const state = getPublicState(g)
    this.persistEvents(gameId, g)
    this.publish(gameId, state)
    return state
  }

  async getReplay(gameId: string): Promise<ReplayPayload> {
    // 优先从 store 读取（支持跨实例恢复）
    if (this.store) {
      const config = await this.store.getConfig(gameId)
      const events = await this.store.getEvents(gameId)
      if (config && events && events.length > 0) {
        return { gameId, config, events }
      }
    }
    return getReplay(await this.mustGet(gameId))
  }

  subscribe(gameId: string, cb: (state: GamePublicState) => void) {
    this.mustGetSync(gameId)
    const set = this.subscribers.get(gameId) ?? new Set<(state: GamePublicState) => void>()
    set.add(cb)
    this.subscribers.set(gameId, set)
    return () => {
      const current = this.subscribers.get(gameId)
      if (!current) return
      current.delete(cb)
      if (current.size === 0) {
        this.subscribers.delete(gameId)
      }
    }
  }

  private persistEvents(gameId: string, g: GameRuntime) {
    // Fire-and-forget async write
    this.store?.overwriteEvents(gameId, g.events).catch(() => {})
  }

  private async safeRunAuto(gameId: string): Promise<boolean | "busy"> {
    if (this.runningAuto.has(gameId)) return "busy"
    this.runningAuto.add(gameId)
    try {
      const g = this.games.get(gameId)
      if (!g || g.phase === "ended") return false
      const progressed = await runAuto(g)
      if (progressed) {
        // Trim events if they exceed the cap (keep the most recent)
        if (g.events.length > MAX_EVENTS) {
          g.events = g.events.slice(-MAX_EVENTS)
        }
        this.persistEvents(gameId, g)
        this.publish(gameId)
      }
      return progressed
    } finally {
      this.runningAuto.delete(gameId)
    }
  }

  private startAutoRun(gameId: string) {
    if (this.autoTimers.has(gameId)) return
    const timer = setInterval(async () => {
      try {
        const g = this.games.get(gameId)
        if (!g || g.phase === "ended") {
          this.stopAutoRun(gameId)
          return
        }
        const result = await this.safeRunAuto(gameId)
        // Only stop if genuinely no progress (not just busy from concurrent run)
        if (result === false) {
          this.stopAutoRun(gameId)
        }
      } catch (e) {
        logger.error(`[autoRun] game=${gameId} error`, { error: String(e) })
        this.stopAutoRun(gameId)
      }
    }, 800)
    this.autoTimers.set(gameId, timer)
  }

  private stopAutoRun(gameId: string) {
    const timer = this.autoTimers.get(gameId)
    if (timer) {
      clearInterval(timer)
      this.autoTimers.delete(gameId)
    }
    // Schedule cleanup for ended games (free memory after 5 minutes)
    const g = this.games.get(gameId)
    if (g && g.phase === "ended") {
      revokeGameTokens(gameId)
      setTimeout(() => {
        // Only clean up if no subscribers remain
        const subs = this.subscribers.get(gameId)
        if (!subs || subs.size === 0) {
          this.games.delete(gameId)
          this.subscribers.delete(gameId)
        }
      }, 5 * 60 * 1000)
    }
  }

  private mustGetSync(gameId: string): GameRuntime {
    const g = this.games.get(gameId)
    if (!g) throw new Error("game not found")
    return g
  }

  private async mustGet(gameId: string): Promise<GameRuntime> {
    const g = this.games.get(gameId)
    if (!g) {
      // 尝试从 store 恢复（用于重启后的回放查询）
      if (this.store) {
        const config = await this.store.getConfig(gameId)
        const events = await this.store.getEvents(gameId)
        if (config && events && events.length > 0) {
          const restored = createRuntime(gameId, config)
          restored.events = events
          const phaseEvents = events.filter((e) => e.t === "phase")
          const lastPhase = phaseEvents[phaseEvents.length - 1]
          if (lastPhase && lastPhase.t === "phase") {
            restored.phase = lastPhase.phase
            restored.day = lastPhase.day
          }
          restored.onThinkingChange = () => this.publish(gameId)
          this.games.set(gameId, restored)
          return restored
        }
      }
      throw new Error("game not found")
    }
    return g
  }

  private publish(gameId: string, state?: GamePublicState) {
    const subs = this.subscribers.get(gameId)
    if (!subs || subs.size === 0) return
    const s = state ?? this.getPublicState(gameId)
    for (const cb of subs) {
      try {
        cb(s)
      } catch {
        // Subscriber threw — remove it to prevent repeated failures
        subs.delete(cb)
      }
    }
  }
}
