import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import app from "../app.js"
import type { GameConfig } from "../../shared/game.js"

const makeAllAiConfig = (): GameConfig => ({
  seats: [
    { seat: 1, name: "1号", kind: "ai", ai: { provider: "mock" } },
    { seat: 2, name: "2号", kind: "ai", ai: { provider: "mock" } },
    { seat: 3, name: "3号", kind: "ai", ai: { provider: "mock" } },
    { seat: 4, name: "4号", kind: "ai", ai: { provider: "mock" } },
    { seat: 5, name: "5号", kind: "ai", ai: { provider: "mock" } },
    { seat: 6, name: "6号", kind: "ai", ai: { provider: "mock" } },
  ],
  rolePool: ["werewolf", "werewolf", "seer", "witch", "villager", "villager"],
  rngSeed: "games-route-all-ai",
})

const makeHumanConfig = (): GameConfig => ({
  seats: [
    { seat: 1, name: "1号", kind: "human" },
    { seat: 2, name: "2号", kind: "ai", ai: { provider: "mock" } },
    { seat: 3, name: "3号", kind: "ai", ai: { provider: "mock" } },
    { seat: 4, name: "4号", kind: "ai", ai: { provider: "mock" } },
    { seat: 5, name: "5号", kind: "ai", ai: { provider: "mock" } },
    { seat: 6, name: "6号", kind: "ai", ai: { provider: "mock" } },
  ],
  rolePool: ["werewolf", "werewolf", "seer", "witch", "villager", "villager"],
  rngSeed: "games-route-human",
})

const startServer = async (): Promise<{ server: Server; baseUrl: string }> =>
  new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      })
    })
  })

describe("games routes", () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    ;({ server, baseUrl } = await startServer())
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })

  it("allows anonymous start and spectator reads for all-ai games", async () => {
    const createRes = await fetch(`${baseUrl}/api/games`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeAllAiConfig()),
    })
    const createData = await createRes.json() as { success: boolean; gameId?: string }

    expect(createRes.status).toBe(200)
    expect(createData.success).toBe(true)
    expect(createData.gameId).toBeTruthy()

    const gameId = createData.gameId as string

    const startRes = await fetch(`${baseUrl}/api/games/${gameId}/start`, {
      method: "POST",
    })
    const startData = await startRes.json() as { success: boolean }
    expect(startRes.status).toBe(200)
    expect(startData.success).toBe(true)

    const replayRes = await fetch(`${baseUrl}/api/games/${gameId}/replay`)
    const replayData = await replayRes.json() as { success: boolean; replay?: { gameId: string } }
    expect(replayRes.status).toBe(200)
    expect(replayData.success).toBe(true)
    expect(replayData.replay?.gameId).toBe(gameId)

    const eventsRes = await fetch(`${baseUrl}/api/games/${gameId}/events`)
    expect(eventsRes.status).toBe(200)
    expect(eventsRes.headers.get("content-type")).toContain("text/event-stream")
    await eventsRes.body?.cancel()
  })

  it("requires auth to start when a human seat exists", async () => {
    const createRes = await fetch(`${baseUrl}/api/games`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeHumanConfig()),
    })
    const createData = await createRes.json() as { success: boolean; gameId?: string }
    expect(createRes.status).toBe(200)
    expect(createData.success).toBe(true)

    const gameId = createData.gameId as string
    const startRes = await fetch(`${baseUrl}/api/games/${gameId}/start`, {
      method: "POST",
    })
    const startData = await startRes.json() as { success: boolean; error?: string }

    expect(startRes.status).toBe(401)
    expect(startData.success).toBe(false)
    expect(startData.error).toBe("Authentication required")
  })
})
