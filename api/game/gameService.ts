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
    this.store?.createGame(gameId, config)
    this.store?.overwriteEvents(gameId, g.events)
    this.publish(gameId)
    return { gameId }
  }

  async startGame(gameId: string): Promise<GamePublicState> {
    const g = this.mustGet(gameId)
    startGame(g)
    const state = getPublicState(g)
    this.persistEvents(gameId, g)
    this.publish(gameId, state)
    this.startAutoRun(gameId)
    return state
  }

  getPublicState(gameId: string): GamePublicState {
    return getPublicState(this.mustGet(gameId))
  }

  getPrivateState(gameId: string, seat: number): GamePrivateState {
    return getPrivateState(this.mustGet(gameId), seat)
  }

  async submitAction(gameId: string, seat: number, action: HumanAction): Promise<GamePublicState> {
    const g = this.mustGet(gameId)
    submitAction(g, seat, action)
    await this.safeRunAuto(gameId)
    const state = getPublicState(g)
    this.persistEvents(gameId, g)
    this.publish(gameId, state)
    return state
  }

  async advance(gameId: string): Promise<GamePublicState> {
    const g = this.mustGet(gameId)
    advance(g)
    await this.safeRunAuto(gameId)
    const state = getPublicState(g)
    this.persistEvents(gameId, g)
    this.publish(gameId, state)
    return state
  }

  getReplay(gameId: string): ReplayPayload {
    // 优先从 store 读取（支持跨实例恢复）
    const config = this.store?.getConfig(gameId)
    const events = this.store?.getEvents(gameId)
    if (config && events && events.length > 0) {
      return { gameId, config, events }
    }
    return getReplay(this.mustGet(gameId))
  }

  subscribe(gameId: string, cb: (state: GamePublicState) => void) {
    this.mustGet(gameId)
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
    this.store?.overwriteEvents(gameId, g.events)
  }

  private async safeRunAuto(gameId: string): Promise<boolean> {
    if (this.runningAuto.has(gameId)) return false
    this.runningAuto.add(gameId)
    try {
      const g = this.games.get(gameId)
      if (!g || g.phase === "ended") return false
      const progressed = await runAuto(g)
      if (progressed) {
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
      const g = this.games.get(gameId)
      if (!g || g.phase === "ended") {
        this.stopAutoRun(gameId)
        return
      }
      const progressed = await this.safeRunAuto(gameId)
      if (!progressed) {
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
  }

  private mustGet(gameId: string) {
    const g = this.games.get(gameId)
    if (!g) {
      // 尝试从 store 恢复（用于重启后的回放查询）
      const config = this.store?.getConfig(gameId)
      const events = this.store?.getEvents(gameId)
      if (config && events && events.length > 0) {
        const restored = createRuntime(gameId, config)
        // 将事件附加到恢复的运行时（仅用于回放，不用于继续游戏）
        restored.events = events
        // 尝试推断当前阶段
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
      throw new Error("game not found")
    }
    return g
  }

  private publish(gameId: string, state?: GamePublicState) {
    const subs = this.subscribers.get(gameId)
    if (!subs || subs.size === 0) return
    const s = state ?? this.getPublicState(gameId)
    for (const cb of subs) {
      cb(s)
    }
  }
}
