import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, readdirSync, renameSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { GameConfig, GameEvent } from "../../shared/game.js"

export class GameStore {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
    mkdirSync(join(baseDir, "games"), { recursive: true })
    mkdirSync(join(baseDir, "events"), { recursive: true })
  }

  createGame(gameId: string, config: GameConfig) {
    const path = join(this.baseDir, "games", `${gameId}.json`)
    writeFileSync(path, JSON.stringify({ gameId, config, createdAt: Date.now() }))
    return { gameId }
  }

  createGameWithId(config: GameConfig) {
    const gameId = crypto.randomUUID()
    return this.createGame(gameId, config)
  }

  getConfig(gameId: string): GameConfig | null {
    const path = join(this.baseDir, "games", `${gameId}.json`)
    if (!existsSync(path)) return null
    const data = JSON.parse(readFileSync(path, "utf-8"))
    return data.config as GameConfig
  }

  appendEvents(gameId: string, events: GameEvent[]) {
    const path = join(this.baseDir, "events", `${gameId}.jsonl`)
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
    appendFileSync(path, lines)
  }

  getEvents(gameId: string): GameEvent[] {
    const path = join(this.baseDir, "events", `${gameId}.jsonl`)
    if (!existsSync(path)) return []
    const content = readFileSync(path, "utf-8")
    if (!content.trim()) return []
    return content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
  }

  overwriteEvents(gameId: string, events: GameEvent[]) {
    const path = join(this.baseDir, "events", `${gameId}.jsonl`)
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
    writeFileSync(path, lines)
  }

  listGameIds(): string[] {
    const dir = join(this.baseDir, "games")
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
  }
}
