import type { HumanAction } from "../../shared/game.js"
import { createNightState, isAliveSeat, mustSeat, type GameRuntime, type SeatRuntime } from "./model.js"
import { computeWinner, endGame } from "./winner.js"

export const applyHunterAction = (g: GameRuntime, s: SeatRuntime, action: HumanAction) => {
  if (action.t !== "hunter_shoot") {
    throw new Error("invalid action")
  }
  if (!g.hunterState) {
    throw new Error("no hunter state")
  }
  if (!g.hunterState.dyingSeats.includes(s.seat)) {
    throw new Error("not a dying hunter")
  }
  if (g.hunterState.shots.has(s.seat)) {
    throw new Error("already decided")
  }
  if (action.targetSeat !== null && !isAliveSeat(g, action.targetSeat)) {
    throw new Error("target not alive")
  }

  g.hunterState.shots.set(s.seat, action.targetSeat)
  g.events.push({
    t: "action",
    ts: Date.now(),
    seat: s.seat,
    action: "hunter_shoot",
    payload: { targetSeat: action.targetSeat },
  })
}

export const maybeAdvanceHunter = (g: GameRuntime) => {
  if (!g.hunterState) return
  const allDecided = g.hunterState.dyingSeats.every((seat) => g.hunterState!.shots.has(seat))
  if (!allDecided) return

  for (const [seat, targetSeat] of g.hunterState.shots) {
    if (targetSeat !== null && isAliveSeat(g, targetSeat)) {
      mustSeat(g, targetSeat).alive = false
      g.events.push({
        t: "result",
        ts: Date.now(),
        text: `猎人 ${seat} 号开枪带走了 ${targetSeat} 号`,
        data: { shooter: seat, target: targetSeat },
      })
    } else if (targetSeat === null) {
      g.events.push({
        t: "result",
        ts: Date.now(),
        text: `猎人 ${seat} 号选择不开枪`,
      })
    }
  }

  const source = g.hunterState.source
  g.hunterState = null

  const winner = computeWinner(g)
  if (winner) {
    endGame(g, winner)
    return
  }

  if (source === "night") {
    g.phase = "day_speech"
    g.dayState = { votes: new Map(), spoken: new Set() }
    g.events.push({ t: "phase", ts: Date.now(), phase: g.phase, day: g.day })
  } else {
    g.day += 1
    g.phase = "night"
    g.night = createNightState()
    g.dayState = null
    g.events.push({ t: "phase", ts: Date.now(), phase: g.phase, day: g.day })
  }
}
