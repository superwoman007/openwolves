import { describe, it, expect, vi } from "vitest"
import { createRuntime, startGame, submitAction, getReplay } from "../engine.js"
import { createScheduler } from "../agent-scheduler.js"
import type { Role } from "../../../shared/game.js"

const makeConfig = (overrides?: any) => ({
  seats: [
    { seat: 1, name: "1号", kind: "ai" as const, ai: { provider: "mock" as const } },
    { seat: 2, name: "2号", kind: "ai" as const, ai: { provider: "mock" as const } },
    { seat: 3, name: "3号", kind: "ai" as const, ai: { provider: "mock" as const } },
    { seat: 4, name: "4号", kind: "ai" as const, ai: { provider: "mock" as const } },
    { seat: 5, name: "5号", kind: "ai" as const, ai: { provider: "mock" as const } },
    { seat: 6, name: "6号", kind: "ai" as const, ai: { provider: "mock" as const } },
  ],
  rolePool: ["werewolf", "werewolf", "seer", "witch", "guard", "villager"] as Role[],
  rngSeed: "integration-test",
  ...overrides,
})

describe("Agent Integration - Full Game", () => {
  it("moderator emits phase announcement and orchestration hints", async () => {
    const g = createRuntime("int-moderator", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    await scheduler.runOnce()
    await scheduler.runOnce()
    const systemMessages = g.events.filter((event) => event.t === "system").map((event) => event.text)
    expect(systemMessages.some((text) => text.includes("夜晚"))).toBe(true)
    expect(systemMessages.some((text) => text.includes("待行动座位"))).toBe(true)
  })

  it("werewolf chat is produced before night kill resolution", async () => {
    const g = createRuntime("int-wolf-chat", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    for (let i = 0; i < 6; i += 1) {
      await scheduler.runOnce()
      if (g.events.some((event) => event.t === "chat_wolf")) break
    }
    expect(g.events.some((event) => event.t === "chat_wolf")).toBe(true)
  })

  it("completes a full AI-only game via scheduler", async () => {
    const g = createRuntime("int-1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    await scheduler.runAuto()
    expect(g.phase).toBe("ended")
    expect(g.events.length).toBeGreaterThan(10)
  }, 10000)

  it("produces replay-compatible events", async () => {
    const g = createRuntime("int-2", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    await scheduler.runAuto()
    const replay = getReplay(g)
    expect(replay.gameId).toBe("int-2")
    expect(replay.config).toBeDefined()
    expect(replay.events.length).toBeGreaterThan(0)
    // Verify key event types exist
    const phaseEvents = replay.events.filter((e) => e.t === "phase")
    expect(phaseEvents.length).toBeGreaterThan(0)
    const actionEvents = replay.events.filter((e) => e.t === "action")
    expect(actionEvents.length).toBeGreaterThan(0)
    const resultEvents = replay.events.filter((e) => e.t === "result")
    expect(resultEvents.length).toBeGreaterThan(0)
  }, 10000)

  it("rejects illegal action from agent via engine", async () => {
    const g = createRuntime("int-3", makeConfig())
    startGame(g)
    // Find a non-werewolf seat to test
    const nonWolfSeat = g.seats.find((s) => s.role !== "werewolf")!.seat
    expect(() => {
      submitAction(g, nonWolfSeat, { t: "wolf_kill", targetSeat: 2 })
    }).toThrow()
    // State should remain unchanged
    expect(g.seats.every((s) => s.alive)).toBe(true)
  })

  it("rejects seer_check from non-seer", async () => {
    const g = createRuntime("int-4", makeConfig())
    startGame(g)
    const villagerSeat = g.seats.find((s) => s.role === "villager")!.seat
    expect(() => {
      submitAction(g, villagerSeat, { t: "seer_check", targetSeat: 1 })
    }).toThrow()
  })

  it("rejects witch action during collect stage", async () => {
    const g = createRuntime("int-5", makeConfig())
    startGame(g)
    const witchSeat = g.seats.find((s) => s.role === "witch")!.seat
    expect(() => {
      submitAction(g, witchSeat, { t: "witch_antidote", targetSeat: 1 })
    }).toThrow()
  })

  it("does not allow agent to directly mutate game state", async () => {
    const g = createRuntime("int-6", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    // Agents should only return decisions, not mutate state directly
    const beforeAlive = g.seats.filter((s) => s.alive).length
    await scheduler.runOnce()
    // After one step, state may or may not change, but it should only change via submitAction
    // This is more of an architectural guarantee; we verify no direct mutation by checking
    // that events are properly recorded for any state change
    const actionEvents = g.events.filter((e) => e.t === "action")
    const resultEvents = g.events.filter((e) => e.t === "result")
    const totalChangeEvents = actionEvents.length + resultEvents.length
    // Any seat death should be preceded by a result event
    const deadSeats = g.seats.filter((s) => !s.alive)
    for (const s of deadSeats) {
      const hasDeathEvent = g.events.some(
        (e) =>
          e.t === "result" &&
          (e.text.includes(`${s.seat}号`) || (e.data && JSON.stringify(e.data).includes(String(s.seat)))),
      )
      expect(hasDeathEvent).toBe(true)
    }
  })

  it("scheduler rejects illegal agent decision and preserves authoritative state", async () => {
    const g = createRuntime("int-7", makeConfig())
    startGame(g)
    g.phase = "day_vote"
    g.night = null
    g.dayState = { votes: new Map(), spoken: new Set() }
    const scheduler = createScheduler(g)
    const nonWolfSeat = g.seats.find((s) => s.role !== "werewolf")!
    const agent = scheduler.registry.getRoleAgent(nonWolfSeat.seat)!
    vi.spyOn(agent, "decide").mockResolvedValue({
      action: { t: "wolf_kill", targetSeat: 1 },
    })
    for (const s of g.seats) {
      if (s.seat === nonWolfSeat.seat) continue
      const seatAgent = scheduler.registry.getRoleAgent(s.seat)
      if (!seatAgent) continue
      vi.spyOn(seatAgent, "decide").mockResolvedValue(null)
    }

    for (let i = 0; i < 4; i += 1) {
      await scheduler.runOnce()
      if (g.events.some(
        (event) => event.t === "system" && event.text.includes("非法动作建议：wolf_kill"),
      )) {
        break
      }
    }

    expect(g.events.some(
      (event) => event.t === "system" && event.text.includes("非法动作建议：wolf_kill"),
    )).toBe(true)
    expect(g.events.some(
      (event) => event.t === "action" && event.action === "wolf_kill" && event.seat === nonWolfSeat.seat,
    )).toBe(false)
  })
})

describe("Agent Integration - Context Propagation", () => {
  it("all agents receive public speech in context", async () => {
    const g = createRuntime("ctx-1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)

    // Inject a public speech manually
    g.events.push({ t: "chat_public", ts: Date.now(), seat: 2, text: "我是铁好人" })

    for (const s of g.seats) {
      if (!s.alive || !s.role) continue
      const ctx = scheduler.buildAgentContext(s)
      const speechEvent = ctx.timeline.speeches.find(
        (e) => e.speakerSeat === 2 && e.text === "我是铁好人",
      )
      expect(speechEvent).toBeDefined()
      expect(ctx.timeline.keyEvents.some((event) => event.type === "phase")).toBe(true)
    }
  })

  it("agent context includes key result events for later decisions", async () => {
    const g = createRuntime("ctx-3", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)

    g.events.push({ t: "result", ts: Date.now(), text: "夜晚死亡：3号", data: { seats: [3] } })

    for (const s of g.seats) {
      if (!s.alive || !s.role) continue
      const ctx = scheduler.buildAgentContext(s)
      expect(ctx.timeline.keyEvents.some((event) => event.type === "result" && event.summary.includes("夜晚死亡"))).toBe(true)
    }
  })

  it("werewolf agents share wolf context", async () => {
    const g = createRuntime("ctx-2", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    const wolves = g.seats.filter((s) => s.role === "werewolf")
    expect(wolves.length).toBe(2)
    for (const w of wolves) {
      const ctx = scheduler.buildAgentContext(w)
      expect(ctx.knowledge.wolfTeammates).toBeDefined()
      expect(ctx.knowledge.wolfTeammates!.length).toBe(1)
      expect(ctx.knowledge.wolfTeammates![0]).not.toBe(w.seat)
    }
  })
})

describe("Agent Integration - Role Consistency", () => {
  it("each agent role matches its seat role after start", async () => {
    const g = createRuntime("role-1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    for (const s of g.seats) {
      const agent = scheduler.registry.getRoleAgent(s.seat)
      expect(agent).toBeDefined()
      expect(agent!.role).toBe(s.role)
    }
  })

  it("moderator agent exists in registry", async () => {
    const g = createRuntime("role-2", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    expect(scheduler.registry.moderator).toBeDefined()
  })

  it("startGame initializes moderator and seat agents onto runtime", async () => {
    const g = createRuntime("role-3", makeConfig())
    expect(g.agentState.registry).toBeNull()
    startGame(g)
    expect(g.agentState.registry).not.toBeNull()
    expect(g.agentState.registry?.seatAgents.size).toBe(g.seats.length)
  })
})
