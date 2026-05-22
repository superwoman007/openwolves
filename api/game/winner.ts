import type { GameRuntime } from "./model.js"

export const computeWinner = (g: GameRuntime) => {
  const alive = g.seats.filter((s) => s.alive)
  const wolves = alive.filter((s) => s.role === "werewolf")
  const others = alive.length - wolves.length
  if (wolves.length === 0) return "villagers" as const
  if (wolves.length >= others) return "werewolves" as const
  return null
}

export const endGame = (g: GameRuntime, winner: "villagers" | "werewolves") => {
  g.phase = "ended"
  const roles = Object.fromEntries(g.seats.map((s) => [s.seat, s.role]))
  g.events.push({
    t: "result",
    ts: Date.now(),
    text: winner === "villagers" ? "村民阵营获胜" : "狼人阵营获胜",
    data: { winner, roles },
  })
  g.events.push({ t: "phase", ts: Date.now(), phase: g.phase, day: g.day })
}

