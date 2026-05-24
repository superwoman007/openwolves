import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Role, HumanAction, GameEvent, GamePhase } from "../../../shared/game.js"
import type { AgentContext, AgentDecision, RoleAgent, ModeratorAgent } from "./types.js"
import { createAgentRegistry } from "./registry.js"
import { BaseRoleAgent } from "./base-role-agent.js"
import { ModeratorAgentImpl } from "./moderator.js"
import { VillagerAgent, WerewolfAgent } from "./role-agents.js"
import { createScheduler, Scheduler } from "../agent-scheduler.js"
import type { GameRuntime } from "../model.js"
import { createRuntime, startGame } from "../engine.js"

afterEach(() => {
  vi.restoreAllMocks()
})

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
  rngSeed: "test",
  ...overrides,
})

describe("Agent Types & Contracts", () => {
  it("RoleAgent interface can be implemented", async () => {
    const agent: RoleAgent = {
      scope: "player",
      seat: 1,
      role: "villager",
      responsibilities: ["role_decision", "day_speech", "day_vote", "night_action"],
      isValidActionForRole() {
        return true
      },
      async decide(_ctx: AgentContext): Promise<AgentDecision | null> {
        return { action: { t: "chat_public", text: "test" } }
      },
    }
    const ctx = makeDummyContext(1, "villager")
    const result = await agent.decide(ctx)
    expect(result).not.toBeNull()
    expect(result!.action.t).toBe("chat_public")
  })

  it("ModeratorAgent interface can be implemented", async () => {
    const mod: ModeratorAgent = {
      scope: "moderator",
      role: "moderator",
      responsibilities: ["phase_orchestration", "announcement", "speech_ordering"],
      async announcePhase(_ctx) {
        return "天亮了"
      },
      getSpeechOrder(ctx) {
        return ctx.aliveSeats
      },
      orchestrate(ctx) {
        return {
          shouldAdvance: ctx.pendingSeats.length === 0,
          pendingSeats: ctx.pendingSeats,
          hint: ctx.pendingSeats.length > 0 ? "请继续" : "可以推进",
        }
      },
    }
    const text = await mod.announcePhase({
      phase: "day_speech",
      day: 1,
      timeline: { speeches: [], events: [], keyEvents: [] },
    })
    expect(text).toBe("天亮了")
    expect(mod.getSpeechOrder({ aliveSeats: [1, 2, 3] })).toEqual([1, 2, 3])
  })
})

describe("AgentRegistry", () => {
  it("creates moderator and role agents after roles assigned", () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const registry = g.agentState.registry ?? createAgentRegistry(g)
    expect(registry.moderator).toBeInstanceOf(ModeratorAgentImpl)
    expect(registry.seatAgents.size).toBe(g.seats.length)
    expect(registry.responsibilitiesBoundary.moderator).toContain("phase_orchestration")
    expect(registry.responsibilitiesBoundary.players).toContain("role_decision")
    for (const s of g.seats) {
      expect(registry.seatAgents.has(s.seat)).toBe(true)
      const agent = registry.seatAgents.get(s.seat)!
      expect(agent.seat).toBe(s.seat)
      expect(agent.role).toBe(s.role)
      expect(agent.scope).toBe("player")
    }
    expect(registry.moderator.scope).toBe("moderator")
    expect(registry.moderator.role).toBe("moderator")
  })

  it("does not create agents for unassigned seats", () => {
    const g = createRuntime("g1", makeConfig())
    // 不调用 startGame，角色未分配
    const registry = createAgentRegistry(g)
    expect(registry.seatAgents.size).toBe(0)
  })

  it("reuses the same registry for the whole game lifecycle after start", () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const firstRegistry = g.agentState.registry
    expect(firstRegistry).toBeDefined()
    const scheduler = createScheduler(g)
    expect(scheduler.registry).toBe(firstRegistry)
    const anotherScheduler = createScheduler(g)
    expect(anotherScheduler.registry).toBe(firstRegistry)
  })

  it("allows looking up agents by seat", () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const registry = createAgentRegistry(g)
    for (const s of g.seats) {
      const agent = registry.getRoleAgent(s.seat)
      expect(agent).toBeDefined()
      expect(agent!.seat).toBe(s.seat)
      expect(registry.getSeatAgent(s.seat)).toBe(agent)
    }
    expect(registry.listSeatAgents()).toHaveLength(g.seats.length)
  })

  it("returns undefined for unknown seat", () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const registry = createAgentRegistry(g)
    expect(registry.getRoleAgent(999)).toBeUndefined()
  })
})

describe("BaseRoleAgent - Role Action Validation", () => {
  class TestAgent extends BaseRoleAgent {
    async decide(ctx: AgentContext): Promise<AgentDecision | null> {
      return null
    }
  }

  it("werewolf can wolf_kill and chat_wolf", () => {
    const agent = new TestAgent(1, "werewolf")
    expect(agent.isValidActionForRole({ t: "wolf_kill", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "chat_wolf", text: "hello" })).toBe(true)
    expect(agent.isValidActionForRole({ t: "chat_public", text: "hi" })).toBe(true)
    expect(agent.isValidActionForRole({ t: "vote", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "seer_check", targetSeat: 2 })).toBe(false)
  })

  it("seer can seer_check only", () => {
    const agent = new TestAgent(1, "seer")
    expect(agent.isValidActionForRole({ t: "seer_check", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "chat_public", text: "hi" })).toBe(true)
    expect(agent.isValidActionForRole({ t: "vote", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "wolf_kill", targetSeat: 2 })).toBe(false)
    expect(agent.isValidActionForRole({ t: "guard_protect", targetSeat: 2 })).toBe(false)
  })

  it("witch can witch_antidote and witch_poison", () => {
    const agent = new TestAgent(1, "witch")
    expect(agent.isValidActionForRole({ t: "witch_antidote", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "witch_poison", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "chat_public", text: "hi" })).toBe(true)
    expect(agent.isValidActionForRole({ t: "vote", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "wolf_kill", targetSeat: 2 })).toBe(false)
  })

  it("guard can guard_protect only", () => {
    const agent = new TestAgent(1, "guard")
    expect(agent.isValidActionForRole({ t: "guard_protect", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "chat_public", text: "hi" })).toBe(true)
    expect(agent.isValidActionForRole({ t: "vote", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "wolf_kill", targetSeat: 2 })).toBe(false)
  })

  it("hunter can hunter_shoot only", () => {
    const agent = new TestAgent(1, "hunter")
    expect(agent.isValidActionForRole({ t: "hunter_shoot", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "chat_public", text: "hi" })).toBe(true)
    expect(agent.isValidActionForRole({ t: "vote", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "wolf_kill", targetSeat: 2 })).toBe(false)
  })

  it("villager can chat_public and vote only", () => {
    const agent = new TestAgent(1, "villager")
    expect(agent.isValidActionForRole({ t: "chat_public", text: "hi" })).toBe(true)
    expect(agent.isValidActionForRole({ t: "vote", targetSeat: 2 })).toBe(true)
    expect(agent.isValidActionForRole({ t: "wolf_kill", targetSeat: 2 })).toBe(false)
    expect(agent.isValidActionForRole({ t: "seer_check", targetSeat: 2 })).toBe(false)
  })
})

describe("AgentScheduler", () => {
  it("initializes scheduler with registry", () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    expect(scheduler).toBeDefined()
  })

  it("runOnce returns false when no AI action needed", async () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    // night phase with AI seats; but mock agents may return null
    // let's spy and force a null return
    const registry = scheduler.registry
    for (const agent of registry.roles.values()) {
      vi.spyOn(agent, "decide").mockResolvedValue(null)
    }
    await scheduler.runOnce()
    await scheduler.runOnce()
    const progressed = await scheduler.runOnce()
    expect(progressed).toBe(false)
  })

  it("runOnce submits action when agent returns a decision", async () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    const registry = scheduler.registry

    // Find a werewolf agent and make it return a kill action
    const wolfSeat = g.seats.find((s) => s.role === "werewolf")!.seat
    const wolfAgent = registry.getRoleAgent(wolfSeat)!
    vi.spyOn(wolfAgent, "decide").mockResolvedValue({
      action: { t: "wolf_kill", targetSeat: g.seats.find((s) => s.seat !== wolfSeat)!.seat },
    })

    // Mock other agents to return null to avoid interfering
    for (const [seat, agent] of registry.roles) {
      if (seat !== wolfSeat) {
        vi.spyOn(agent, "decide").mockResolvedValue(null)
      }
    }

    let progressed = false
    for (let i = 0; i < 4; i += 1) {
      progressed = await scheduler.runOnce()
      if (g.events.some((e) => e.t === "action" && e.action === "wolf_kill")) {
        break
      }
    }
    expect(progressed).toBe(true)
    expect(g.events.some((e) => e.t === "action" && e.action === "wolf_kill")).toBe(true)
  })

  it("runAuto advances the game with mock agents", async () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    // With mock provider, agents should use simple strategies
    const completed = await scheduler.runAuto()
    expect(completed).toBe(true)
    // Game should end at some point
    expect(g.phase).toBe("ended")
  }, 10000)
})

describe("Agent Context Propagation", () => {
  it("builds agent context with public events", () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    // Add a public speech event
    g.events.push({ t: "chat_public", ts: Date.now(), seat: 2, text: "我是好人" })

    const scheduler = createScheduler(g)
    const ctx = scheduler.buildAgentContext(g.seats[0]!)
    expect(ctx.self.seat).toBe(g.seats[0]!.seat)
    expect(ctx.self.role).toBe(g.seats[0]!.role)
    expect(ctx.timeline.events.some((e) => e.type === "chat_public")).toBe(true)
    expect(ctx.timeline.speeches.some((speech) => speech.text === "我是好人")).toBe(true)
    expect(ctx.timeline.events.find((e) => e.type === "chat_public")?.visibility).toBe("public")
    expect(ctx.timeline.events.find((e) => e.type === "chat_public")?.summary).toContain("公开发言")
    expect(ctx.timeline.keyEvents.some((event) => event.type === "phase")).toBe(true)
    expect(ctx.game.aliveSeats).toEqual([1, 2, 3, 4, 5, 6])
  })

  it("wolf agent context includes wolfTeammates", () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    const wolfSeat = g.seats.find((s) => s.role === "werewolf")!.seat
    const ctx = scheduler.buildAgentContext(g.seats.find((s) => s.seat === wolfSeat)!)
    expect(ctx.knowledge.wolfTeammates).toBeDefined()
    expect(Array.isArray(ctx.knowledge.wolfTeammates)).toBe(true)
    // Should include other alive wolves
    const otherWolves = g.seats
      .filter((s) => s.role === "werewolf" && s.seat !== wolfSeat)
      .map((s) => s.seat)
    expect(ctx.knowledge.wolfTeammates).toEqual(otherWolves)
  })

  it("non-wolf agent context does not include wolfTeammates", () => {
    const g = createRuntime("g1", makeConfig())
    startGame(g)
    const scheduler = createScheduler(g)
    const villagerSeat = g.seats.find((s) => s.role === "villager")!.seat
    const ctx = scheduler.buildAgentContext(g.seats.find((s) => s.seat === villagerSeat)!)
    expect(ctx.knowledge.wolfTeammates).toBeUndefined()
  })
})

describe("ModeratorAgent", () => {
  it("generates phase announcement", async () => {
    const mod = new ModeratorAgentImpl()
    const text = await mod.announcePhase({
      phase: "day_speech",
      day: 1,
      timeline: { speeches: [], events: [], keyEvents: [] },
    })
    expect(typeof text).toBe("string")
    expect(text.length).toBeGreaterThan(0)
  })

  it("returns speech order for alive seats", () => {
    const mod = new ModeratorAgentImpl()
    const order = mod.getSpeechOrder({ aliveSeats: [3, 1, 2] })
    expect(order).toEqual([3, 1, 2])
  })

  it("returns pk candidates first in speech order when provided", () => {
    const mod = new ModeratorAgentImpl()
    const order = mod.getSpeechOrder({ aliveSeats: [1, 2, 3, 4], pkCandidates: [2, 4] })
    expect(order).toEqual([2, 4])
  })

  it("builds orchestration hints from pending seats", () => {
    const mod = new ModeratorAgentImpl()
    const directive = mod.orchestrate({
      phase: "day_vote",
      day: 1,
      aliveSeats: [1, 2, 3, 4],
      pendingSeats: [2, 4],
    })
    expect(directive.shouldAdvance).toBe(false)
    expect(directive.pendingSeats).toEqual([2, 4])
    expect(directive.hint).toContain("2、4号")
  })
})

describe("Role Agent Decisions", () => {
  it("werewolf chooses wolf chat before kill when teammates exist", async () => {
    const agent = new WerewolfAgent(1, "werewolf")
    const ctx = makeDummyContext(1, "werewolf")
    ctx.game.phase = "night"
    ctx.knowledge.wolfTeammates = [2]
    const decision = await agent.decide(ctx)
    expect(decision?.action.t).toBe("chat_wolf")
  })

  it("villager returns null during night", async () => {
    const agent = new VillagerAgent(3, "villager")
    const ctx = makeDummyContext(3, "villager")
    ctx.game.phase = "night"
    const decision = await agent.decide(ctx)
    expect(decision).toBeNull()
  })
})

describe("Prompt Config Loader", () => {
  it("loads role prompt config from external JSON", async () => {
    const loader = await import("../prompt-config/loader.js")
    loader.reloadPrompts()
    const config = loader.getRolePromptConfig("villager")
    expect(config).toBeDefined()
    expect(typeof config.systemPrompt).toBe("string")
    expect(config.systemPrompt).toContain("村民")
    expect(config.systemPrompt).toContain("发言目标")
    expect(config.systemPrompt).toContain("发言约束")
    expect(config.systemPrompt).toContain("发言风格")
    expect(config.systemPrompt).toContain("推理原则")
    expect(config.mockSpeechStances.length).toBeGreaterThan(0)
    expect(loader.getSharedPromptConfig().publicSpeechUserPromptTemplate).toContain("游戏上下文")
  })

  it("loads moderator prompt config from external JSON", async () => {
    const loader = await import("../prompt-config/loader.js")
    loader.reloadPrompts()
    const config = loader.getModeratorPromptConfig()
    expect(config).toBeDefined()
    expect(typeof config.systemPrompt).toBe("string")
    expect(config.systemPrompt).toContain("主持约束")
    expect(config.systemPrompt).toContain("执行原则")
    expect(config.announcements.day_speech).toBe("天亮了，请发言。")
    expect(config.announcements.day_vote_pk).toContain("PK")
  })

  it("returns fallback for unknown role", async () => {
    const loader = await import("../prompt-config/loader.js")
    const config = loader.getPromptConfig("unknown_role" as Role)
    expect(config.systemPrompt).toContain("狼人杀游戏参与者")
  })

  it("reloadPrompts updates config at runtime", async () => {
    const loader = await import("../prompt-config/loader.js")
    const tempDir = mkdtempSync(join(tmpdir(), "prompt-config-reload-"))
    const configPath = join(tempDir, "prompts.json")
    const originalPath = process.env.PROMPT_CONFIG_PATH
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        shared: {
          publicSpeechUserPromptTemplate: "第{{day}}天 {{seat}}号 {{role}} {{contextJson}}",
          mockSpeechOpeners: ["第{{day}}天，{{seat}}号发言。"],
        },
        fallback: {
          systemPrompt: "通用提示",
          mockSpeechStances: ["通用兜底发言。"],
        },
        moderator: {
          systemPrompt: "裁判提示",
          announcements: {
            night: "夜晚A",
            day_speech: "白天A",
            day_vote: "投票A",
            day_vote_pk: "PKA",
            resolve: "结算A",
            ended: "结束A",
            lobby: "大厅A",
          },
        },
        roles: {
          werewolf: { systemPrompt: "狼人提示A", mockSpeechStances: ["狼人A"] },
          seer: { systemPrompt: "预言家提示A", mockSpeechStances: ["预言家A"] },
          witch: { systemPrompt: "女巫提示A", mockSpeechStances: ["女巫A"] },
          hunter: { systemPrompt: "猎人提示A", mockSpeechStances: ["猎人A"] },
          guard: { systemPrompt: "守卫提示A", mockSpeechStances: ["守卫A"] },
          villager: { systemPrompt: "村民提示A", mockSpeechStances: ["村民A"] },
        },
      }),
      "utf-8",
    )
    process.env.PROMPT_CONFIG_PATH = configPath
    loader.reloadPrompts()
    expect(loader.getRolePromptConfig("villager").systemPrompt).toBe("村民提示A")

    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        shared: {
          publicSpeechUserPromptTemplate: "第{{day}}天 {{seat}}号 {{role}}",
          mockSpeechOpeners: ["我是{{seat}}号，报一下视角。"],
        },
        fallback: {
          systemPrompt: "通用提示",
          mockSpeechStances: ["通用兜底发言。"],
        },
        moderator: {
          systemPrompt: "裁判提示",
          announcements: {
            night: "夜晚B",
            day_speech: "白天B",
            day_vote: "投票B",
            day_vote_pk: "PKB",
            resolve: "结算B",
            ended: "结束B",
            lobby: "大厅B",
          },
        },
        roles: {
          werewolf: { systemPrompt: "狼人提示B", mockSpeechStances: ["狼人B"] },
          seer: { systemPrompt: "预言家提示B", mockSpeechStances: ["预言家B"] },
          witch: { systemPrompt: "女巫提示B", mockSpeechStances: ["女巫B"] },
          hunter: { systemPrompt: "猎人提示B", mockSpeechStances: ["猎人B"] },
          guard: { systemPrompt: "守卫提示B", mockSpeechStances: ["守卫B"] },
          villager: { systemPrompt: "村民提示B", mockSpeechStances: ["村民B"] },
        },
      }),
      "utf-8",
    )
    loader.reloadPrompts()
    expect(loader.getRolePromptConfig("villager").systemPrompt).toBe("村民提示B")
    expect(loader.getModeratorPromptConfig().announcements.day_speech).toBe("白天B")

    if (originalPath === undefined) {
      delete process.env.PROMPT_CONFIG_PATH
    } else {
      process.env.PROMPT_CONFIG_PATH = originalPath
    }
    loader.reloadPrompts()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("falls back missing fields to internal defaults with warning", async () => {
    const loader = await import("../prompt-config/loader.js")
    const tempDir = mkdtempSync(join(tmpdir(), "prompt-config-fallback-"))
    const configPath = join(tempDir, "prompts.json")
    const originalPath = process.env.PROMPT_CONFIG_PATH
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        roles: {
          villager: {
            systemPrompt: "自定义村民提示",
          },
        },
      }),
      "utf-8",
    )

    process.env.PROMPT_CONFIG_PATH = configPath
    loader.reloadPrompts()

    expect(loader.getRolePromptConfig("villager").systemPrompt).toBe("自定义村民提示")
    expect(loader.getRolePromptConfig("villager").mockSpeechStances.length).toBeGreaterThan(0)
    expect(loader.getRolePromptConfig("seer").systemPrompt).toContain("预言家")
    expect(loader.getModeratorPromptConfig().announcements.day_vote).toBe("请投票。")
    expect(loader.getSharedPromptConfig().mockSpeechOpeners.length).toBeGreaterThan(0)
    expect(warnSpy).toHaveBeenCalled()

    if (originalPath === undefined) {
      delete process.env.PROMPT_CONFIG_PATH
    } else {
      process.env.PROMPT_CONFIG_PATH = originalPath
    }
    loader.reloadPrompts()
    rmSync(tempDir, { recursive: true, force: true })
  })
})

// Helpers
function makeDummyContext(seat: number, role: Role): AgentContext {
  return {
    self: {
      seat,
      role,
      alive: true,
    },
    game: {
      phase: "day_speech" as GamePhase,
      day: 1,
      aliveSeats: [1, 2, 3, 4, 5, 6],
      eliminatedSeats: [],
    },
    timeline: {
      speeches: [],
      events: [],
      keyEvents: [],
    },
    memory: {
      summary: "",
      role: {},
    },
    knowledge: {},
    privateState: {},
  }
}
