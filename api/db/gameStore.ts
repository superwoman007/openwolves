import { mkdir, writeFile, appendFile, readFile, readdir, access } from "node:fs/promises"
import { join } from "node:path"
import type { GameConfig, GameEvent } from "../../shared/game.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validateGameId(gameId: string): void {
  if (!UUID_RE.test(gameId)) {
    throw new Error("invalid game id format")
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export class GameStore {
  private baseDir: string
  private ready: Promise<void>

  constructor(baseDir: string) {
    this.baseDir = baseDir
    this.ready = this.init()
  }

  private async init() {
    await mkdir(join(this.baseDir, "games"), { recursive: true })
    await mkdir(join(this.baseDir, "events"), { recursive: true })
  }

  async createGame(gameId: string, config: GameConfig) {
    await this.ready
    validateGameId(gameId)
    const path = join(this.baseDir, "games", `${gameId}.json`)
    await writeFile(path, JSON.stringify({ gameId, config, createdAt: Date.now() }))
    return { gameId }
  }

  async getConfig(gameId: string): Promise<GameConfig | null> {
    await this.ready
    validateGameId(gameId)
    const path = join(this.baseDir, "games", `${gameId}.json`)
    if (!(await exists(path))) return null
    try {
      const data = JSON.parse(await readFile(path, "utf-8"))
      return data.config as GameConfig
    } catch {
      return null
    }
  }

  async appendEvents(gameId: string, events: GameEvent[]) {
    await this.ready
    validateGameId(gameId)
    const path = join(this.baseDir, "events", `${gameId}.jsonl`)
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
    await appendFile(path, lines)
  }

  async getEvents(gameId: string): Promise<GameEvent[]> {
    await this.ready
    validateGameId(gameId)
    const path = join(this.baseDir, "events", `${gameId}.jsonl`)
    if (!(await exists(path))) return []
    const content = await readFile(path, "utf-8")
    if (!content.trim()) return []
    const events: GameEvent[] = []
    for (const line of content.trim().split("\n")) {
      try {
        events.push(JSON.parse(line))
      } catch {
        // Skip malformed lines
      }
    }
    return events
  }

  async overwriteEvents(gameId: string, events: GameEvent[]) {
    await this.ready
    validateGameId(gameId)
    const path = join(this.baseDir, "events", `${gameId}.jsonl`)
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
    await writeFile(path, lines)
  }

  async listGameIds(): Promise<string[]> {
    await this.ready
    const dir = join(this.baseDir, "games")
    if (!(await exists(dir))) return []
    const files = await readdir(dir)
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
  }
}
