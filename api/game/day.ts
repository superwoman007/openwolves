import type { HumanAction } from "../../shared/game.js"
import {
  aliveSeatNumbers,
  createNightState,
  isAliveSeat,
  mustSeat,
  type GameRuntime,
  type SeatRuntime,
} from "./model.js"
import { computeWinner, endGame } from "./winner.js"
import { summarizeMemory } from "./ai-memory.js"

export const applyDaySpeechAction = (g: GameRuntime, s: SeatRuntime, action: HumanAction) => {
  if (action.t !== "chat_public") {
    throw new Error("invalid action for current phase")
  }
  g.dayState = g.dayState ?? { votes: new Map(), spoken: new Set() }

  if (g.phase === "day_vote_pk" && g.dayState.pkCandidates) {
    if (!g.dayState.pkCandidates.includes(s.seat)) {
      throw new Error("only PK candidates can speak")
    }
  }

  g.dayState.spoken.add(s.seat)
  g.events.push({ t: "chat_public", ts: Date.now(), seat: s.seat, text: action.text })
}

export const advanceToVote = (g: GameRuntime) => {
  g.phase = "day_vote"
  g.dayState = g.dayState ?? { votes: new Map(), spoken: new Set() }
  g.events.push({ t: "phase", ts: Date.now(), phase: g.phase, day: g.day })
}

export const applyVoteAction = (g: GameRuntime, s: SeatRuntime, action: HumanAction) => {
  if (action.t !== "vote") {
    throw new Error("invalid action for current phase")
  }
  g.dayState = g.dayState ?? { votes: new Map(), spoken: new Set() }
  if (action.targetSeat !== null && !isAliveSeat(g, action.targetSeat)) {
    throw new Error("target seat not alive")
  }

  if (g.dayState.pkCandidates && action.targetSeat !== null) {
    if (!g.dayState.pkCandidates.includes(action.targetSeat)) {
      throw new Error("must vote for a PK candidate")
    }
  }

  g.dayState.votes.set(s.seat, action.targetSeat)
  g.events.push({
    t: "action",
    ts: Date.now(),
    seat: s.seat,
    action: "vote",
    payload: { targetSeat: action.targetSeat },
  })
}

export const maybeResolveVote = (g: GameRuntime) => {
  if (!g.dayState) return
  const alive = aliveSeatNumbers(g)
  const allVoted = alive.every((s) => g.dayState!.votes.has(s))
  if (!allVoted) return
  resolveVote(g)
}

export const forceResolveVote = (g: GameRuntime) => {
  resolveVote(g)
}

const resolveVote = (g: GameRuntime) => {
  g.dayState = g.dayState ?? { votes: new Map(), spoken: new Set() }
  const tally = new Map<number, number>()
  for (const seat of aliveSeatNumbers(g)) {
    const v = g.dayState.votes.get(seat) ?? null
    if (v === null) continue
    tally.set(v, (tally.get(v) ?? 0) + 1)
  }

  const max = Math.max(0, ...Array.from(tally.values()))
  const topTargets = Array.from(tally.entries())
    .filter(([, c]) => c === max && c > 0)
    .map(([t]) => t)

  const isPkRound = g.phase === "day_vote_pk"

  if (topTargets.length > 1) {
    if (isPkRound) {
      // PK 投票再次平票 → 真正无人出局
      g.events.push({ t: "result", ts: Date.now(), text: "PK投票仍平票，无人出局" })
      proceedToNight(g)
      return
    }
    // 首次平票 → 进入 PK
    g.dayState.pkCandidates = topTargets
    g.dayState.votes.clear()
    g.dayState.spoken.clear()
    g.phase = "day_vote_pk"
    g.events.push({
      t: "result",
      ts: Date.now(),
      text: `投票平票：${topTargets.join("、")}号进入 PK`,
      data: { pkCandidates: topTargets },
    })
    g.events.push({ t: "phase", ts: Date.now(), phase: g.phase, day: g.day })
    return
  }

  const eliminated = topTargets.length === 0 ? null : g.rng.pick(topTargets)

  if (eliminated === null) {
    g.events.push({ t: "result", ts: Date.now(), text: "投票无人出局" })
  } else {
    mustSeat(g, eliminated).alive = false
    g.events.push({
      t: "result",
      ts: Date.now(),
      text: `投票放逐：${eliminated}号`,
      data: { seat: eliminated },
    })

    const s = mustSeat(g, eliminated)
    if (s.role === "hunter") {
      g.hunterState = {
        source: "day_vote",
        dyingSeats: [eliminated],
        shots: new Map(),
      }
      g.phase = "resolve"
      g.events.push({
        t: "system",
        ts: Date.now(),
        text: `猎人 ${eliminated} 号被放逐，请决定是否开枪`,
      })
      return
    }
  }

  const winner = computeWinner(g)
  if (winner) {
    endGame(g, winner)
    return
  }

  proceedToNight(g)
}

const proceedToNight = (g: GameRuntime) => {
  // 进入新夜晚前，所有 AI 总结本轮记忆
  for (const s of g.seats) {
    if (s.alive && s.role) {
      s.memorySummary = summarizeMemory(g, s.seat, s.role)
    }
  }

  g.day += 1
  g.phase = "night"
  g.night = createNightState()
  g.dayState = null
  g.events.push({ t: "phase", ts: Date.now(), phase: g.phase, day: g.day })
}
