import type { HumanAction, Role } from "../../shared/game.js"
import {
  type GameRuntime,
  type SeatRuntime,
  createNightState,
  hasAliveRole,
  isAliveSeat,
  mustSeat,
} from "./model.js"
import { computeWinner, endGame } from "./winner.js"

export const applyNightAction = (g: GameRuntime, s: SeatRuntime, action: HumanAction) => {
  g.night = g.night ?? createNightState()

  if (g.night.stage === "collect") {
    if (action.t === "wolf_kill") {
      assertRole(s, "werewolf")
      assertAliveTarget(g, action.targetSeat)
      g.night.wolfVotes.set(s.seat, action.targetSeat)
      g.events.push({
        t: "action",
        ts: Date.now(),
        seat: s.seat,
        action: "wolf_kill",
        payload: { targetSeat: action.targetSeat },
      })
      return
    }

    if (action.t === "seer_check") {
      assertRole(s, "seer")
      assertAliveTarget(g, action.targetSeat)
      g.night.seerChecks.set(s.seat, action.targetSeat)
      g.events.push({
        t: "action",
        ts: Date.now(),
        seat: s.seat,
        action: "seer_check",
        payload: { targetSeat: action.targetSeat },
      })
      return
    }

    if (action.t === "guard_protect") {
      assertRole(s, "guard")
      assertAliveTarget(g, action.targetSeat)
      if (action.targetSeat !== null && s.hand.lastGuardTarget === action.targetSeat) {
        throw new Error("cannot guard same seat consecutively")
      }
      g.night.guardProtects.set(s.seat, action.targetSeat)
      g.events.push({
        t: "action",
        ts: Date.now(),
        seat: s.seat,
        action: "guard_protect",
        payload: { targetSeat: action.targetSeat },
      })
      return
    }

    if (action.t === "chat_wolf") {
      if (s.role !== "werewolf") {
        throw new Error("only werewolf can wolf chat")
      }
      g.night.wolfChat.push({ seat: s.seat, text: action.text })
      g.events.push({
        t: "chat_wolf",
        ts: Date.now(),
        seat: s.seat,
        text: action.text,
      })
      return
    }

    throw new Error("invalid night action")
  }

  if (g.night.stage === "witch") {
    assertRole(s, "witch")
    g.night.witch =
      g.night.witch ??
      ({
        antidoteDecided: s.hand.witchAntidoteUsed,
        poisonDecided: s.hand.witchPoisonUsed,
        antidoteTarget: null,
        poisonTarget: null,
      } as const)

    if (action.t === "witch_antidote") {
      if (g.night.witch.antidoteDecided) throw new Error("antidote already decided")
      if (action.targetSeat !== null && action.targetSeat !== g.night.wolfVictim) {
        throw new Error("antidote target must be the wolf victim or null")
      }
      g.night.witch = {
        ...g.night.witch,
        antidoteDecided: true,
        antidoteTarget: action.targetSeat,
      }
      if (action.targetSeat !== null) s.hand.witchAntidoteUsed = true
      g.events.push({
        t: "action",
        ts: Date.now(),
        seat: s.seat,
        action: "witch_antidote",
        payload: { targetSeat: action.targetSeat },
      })
      return
    }

    if (action.t === "witch_poison") {
      if (g.night.witch.poisonDecided) throw new Error("poison already decided")
      assertAliveTarget(g, action.targetSeat)
      g.night.witch = {
        ...g.night.witch,
        poisonDecided: true,
        poisonTarget: action.targetSeat,
      }
      if (action.targetSeat !== null) s.hand.witchPoisonUsed = true
      g.events.push({
        t: "action",
        ts: Date.now(),
        seat: s.seat,
        action: "witch_poison",
        payload: { targetSeat: action.targetSeat },
      })
      return
    }

    throw new Error("invalid witch action")
  }
}

export const maybeAdvanceNight = (g: GameRuntime) => {
  if (!g.night) return
  if (g.night.stage === "collect") {
    if (!nightCollectComplete(g)) return
    g.night.wolfVictim = computeWolfVictim(g)
    if (hasAliveRole(g, "witch")) {
      const witchSeat = g.seats.find((s) => s.alive && s.role === "witch")
      if (witchSeat && (!witchSeat.hand.witchAntidoteUsed || !witchSeat.hand.witchPoisonUsed)) {
        g.night.stage = "witch"
        g.night.witch = null
        return
      }
    }
    resolveNight(g)
    return
  }

  if (g.night.stage === "witch") {
    if (!g.night.witch) return
    if (!g.night.witch.antidoteDecided || !g.night.witch.poisonDecided) return
    resolveNight(g)
  }
}

const nightCollectComplete = (g: GameRuntime) => {
  if (!g.night) return false
  const wolves = g.seats.filter((s) => s.alive && s.role === "werewolf").map((s) => s.seat)
  const seers = g.seats.filter((s) => s.alive && s.role === "seer").map((s) => s.seat)
  const guards = g.seats.filter((s) => s.alive && s.role === "guard").map((s) => s.seat)
  return (
    wolves.every((s) => g.night!.wolfVotes.has(s)) &&
    seers.every((s) => g.night!.seerChecks.has(s)) &&
    guards.every((s) => g.night!.guardProtects.has(s))
  )
}

const computeWolfVictim = (g: GameRuntime) => {
  if (!g.night) return null
  const tally = new Map<number, number>()
  for (const seat of g.seats) {
    if (!seat.alive || seat.role !== "werewolf") continue
    const target = g.night.wolfVotes.get(seat.seat) ?? null
    if (target === null) continue
    tally.set(target, (tally.get(target) ?? 0) + 1)
  }
  const max = Math.max(0, ...Array.from(tally.values()))
  const topTargets = Array.from(tally.entries())
    .filter(([, c]) => c === max && c > 0)
    .map(([t]) => t)
  return topTargets.length === 0 ? null : g.rng.pick(topTargets)
}

const resolveNight = (g: GameRuntime) => {
  if (!g.night) return
  const guardTargets = Array.from(g.night.guardProtects.values())
  const wolfVictim = g.night.wolfVictim
  const antidoteTarget = g.night.witch?.antidoteTarget ?? null
  const poisonTarget = g.night.witch?.poisonTarget ?? null

  const deaths = new Set<number>()
  if (
    wolfVictim !== null &&
    isAliveSeat(g, wolfVictim) &&
    !guardTargets.includes(wolfVictim) &&
    antidoteTarget !== wolfVictim
  ) {
    deaths.add(wolfVictim)
  }
  if (poisonTarget !== null && isAliveSeat(g, poisonTarget)) {
    deaths.add(poisonTarget)
  }

  const deathList = Array.from(deaths.values())
  for (const seat of deathList) {
    mustSeat(g, seat).alive = false
  }

  if (deathList.length === 0) {
    g.events.push({ t: "result", ts: Date.now(), text: "平安夜" })
  } else {
    g.events.push({
      t: "result",
      ts: Date.now(),
      text: `夜晚死亡：${deathList.join("、")}号`,
      data: { seats: deathList },
    })
  }

  // 记录守卫的守护目标（必须在 winner 检查之前，确保每夜都记录）
  for (const [seat, target] of g.night.guardProtects) {
    const s = g.seats.find((x) => x.seat === seat)
    if (s) s.hand.lastGuardTarget = target
  }

  // 检查濒死猎人（被毒死不能开枪）
  const hunterDying = deathList.filter((seat) => {
    const s = mustSeat(g, seat)
    if (s.role !== "hunter") return false
    if (seat === poisonTarget) return false
    return true
  })

  if (hunterDying.length > 0) {
    g.hunterState = {
      source: "night",
      dyingSeats: hunterDying,
      shots: new Map(),
    }
    g.phase = "resolve"
    g.events.push({
      t: "system",
      ts: Date.now(),
      text: `猎人 ${hunterDying.join("、")} 号濒死，请决定是否开枪`,
    })
    return
  }

  const winner = computeWinner(g)
  if (winner) {
    endGame(g, winner)
    return
  }

  g.phase = "day_speech"
  g.night = null
  g.dayState = { votes: new Map(), spoken: new Set() }
  g.events.push({ t: "phase", ts: Date.now(), phase: g.phase, day: g.day })
}

const assertRole = (s: SeatRuntime, role: Role) => {
  if (s.role !== role) {
    throw new Error(`only ${role} can do this`)
  }
}

const assertAliveTarget = (g: GameRuntime, targetSeat: number | null) => {
  if (targetSeat === null) return
  if (!isAliveSeat(g, targetSeat)) {
    throw new Error("target seat not alive")
  }
}
