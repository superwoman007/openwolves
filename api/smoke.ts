import assert from "node:assert"
import app from "./app.js"

const server = app.listen(0)
const address = server.address()
assert(address && typeof address === "object")
const base = `http://127.0.0.1:${address.port}`

const postJson = async <T,>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return (await r.json()) as T
}

const post = async <T,>(path: string): Promise<T> => {
  const r = await fetch(`${base}${path}`, { method: "POST" })
  return (await r.json()) as T
}

const get = async <T,>(path: string): Promise<T> => {
  const r = await fetch(`${base}${path}`)
  return (await r.json()) as T
}

const main = async () => {
  const config = {
    seats: Array.from({ length: 6 }).map((_, i) => ({
      seat: i + 1,
      name: `${i + 1}号`,
      kind: "ai",
      ai: { provider: "mock" },
    })),
    rolePool: ["werewolf", "werewolf", "seer", "witch", "villager", "villager"],
    rngSeed: "smoke",
  }

  const created = await postJson<{ success: boolean; gameId?: string; error?: string }>(
    "/api/games",
    config,
  )
  assert(created.success && created.gameId)

  const started = await post<{ success: boolean; state?: unknown; error?: string }>(
    `/api/games/${created.gameId}/start`,
  )
  assert(started.success)

  const state = await get<{ success: boolean; state?: { gameId: string }; error?: string }>(
    `/api/games/${created.gameId}/state`,
  )
  assert(state.success && state.state?.gameId === created.gameId)

  const replay = await get<{ success: boolean; replay?: { gameId: string; events: unknown[] } }>(
    `/api/games/${created.gameId}/replay`,
  )
  assert(replay.success && replay.replay?.gameId === created.gameId)
  assert(Array.isArray(replay.replay?.events) && replay.replay!.events.length > 0)
}

main()
  .then(() => {
    server.close()
  })
  .catch((e) => {
    server.close()
    throw e
  })

