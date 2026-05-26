import type { GameRuntime, SeatRuntime } from "./model.js"
import { aliveSeatNumbers } from "./model.js"
import { ensureAgentRegistry, type AgentRegistry } from "./agents/registry.js"
import type {
  AgentContext,
  AgentDecision,
  AgentEventContext,
  AgentSpeechContext,
  AgentVisibility,
  ModeratorFlowContext,
  RoleAgent,
} from "./agents/types.js"
import { submitAction, advance } from "./engine.js"
import { buildAiContext } from "./ai-context.js"
import { updateMemoryForAllSeats } from "./agents/memory-hook.js"
import { buildLastWordsSpeech } from "./agents/role-agents.js"
import type { GameEvent, GamePhase } from "../../shared/game.js"

/**
 * 推断单条原始事件的可见性范围。
 * @param event 原始游戏事件。
 * @returns 返回 public、private 或 wolf 可见级别。
 */
function inferEventVisibility(event: GameEvent): AgentVisibility {
  if (event.t === "chat_private") return "private"
  if (event.t === "chat_wolf") return "wolf"
  return "public"
}

/**
 * 为结构化上下文生成事件摘要。
 * @param event 原始游戏事件。
 * @returns 返回供 Agent 读取的中文摘要。
 */
function summarizeEvent(event: GameEvent): string {
  switch (event.t) {
    case "system":
      return event.text
    case "phase":
      return `阶段切换到${event.phase}（第${event.day}天）`
    case "chat_public":
      return `${event.seat}号公开发言：${event.text}`
    case "chat_private":
      return `${event.fromSeat}号私聊${event.toSeat}号：${event.text}`
    case "chat_wolf":
      return `${event.seat}号狼人发言：${event.text}`
    case "action":
      return `${event.seat}号提交动作：${event.action}`
    case "result":
      return event.text
    default:
      return "未知事件"
  }
}

/**
 * 判断结构化事件是否属于角色推理需要重点关注的关键事件。
 * @param event 统一结构化事件。
 * @returns 若该事件需要作为关键事件额外暴露则返回 true。
 */
function isKeyTimelineEvent(event: AgentEventContext): boolean {
  if (event.type === "phase" || event.type === "result") return true
  if (event.type !== "action" || event.rawEvent.t !== "action") return false
  return ["vote", "seer_check", "wolf_kill", "witch_antidote", "witch_poison", "guard_protect", "hunter_shoot"]
    .includes(event.rawEvent.action)
}

/**
 * 将可见事件流转换为统一的结构化时间线。
 * @param events 经过可见性过滤的事件列表。
 * @param currentPhase 当前阶段。
 * @param currentDay 当前天数。
 * @returns 返回结构化事件与发言列表。
 */
function buildTimelineContexts(
  events: GameEvent[],
  currentPhase: GamePhase,
  currentDay: number,
): { speeches: AgentSpeechContext[]; events: AgentEventContext[]; keyEvents: AgentEventContext[] } {
  let phase = currentPhase
  let day = currentDay
  const normalizedEvents: AgentEventContext[] = []
  const speeches: AgentSpeechContext[] = []

  for (const event of events) {
    if (event.t === "phase") {
      phase = event.phase
      day = event.day
    }

    const visibility = inferEventVisibility(event)
    const actorSeat = "seat" in event
      ? event.seat
      : "fromSeat" in event
        ? event.fromSeat
        : undefined

    normalizedEvents.push({
      visibility,
      phase,
      day,
      type: event.t,
      actorSeat,
      summary: summarizeEvent(event),
      ts: event.ts,
      rawEvent: event,
    })

    if (event.t === "chat_public" || event.t === "chat_private" || event.t === "chat_wolf") {
      speeches.push({
        visibility,
        phase,
        day,
        speakerSeat: "seat" in event ? event.seat : event.fromSeat,
        audienceSeat: event.t === "chat_private" ? event.toSeat : undefined,
        text: event.text,
        ts: event.ts,
        rawEvent: event,
      })
    }
  }

  return {
    speeches,
    events: normalizedEvents,
    keyEvents: normalizedEvents.filter(isKeyTimelineEvent),
  }
}

export class Scheduler {
  registry: AgentRegistry

  /**
   * 创建一局游戏的 Agent 调度器。
   * @param g 当前对局运行时状态。
   */
  constructor(
    private g: GameRuntime,
  ) {
    this.registry = ensureAgentRegistry(g)
  }

  /**
   * 持续运行调度逻辑直到对局结束或无需进一步推进。
   * @returns 若调度流程完成则返回 true。
   */
  async runAuto(onStep?: () => void): Promise<boolean> {
    let steps = 0
    while (steps < 200) {
      if (this.g.phase === "ended") return true
      steps += 1
      const progressed = await this.runOnce()
      if (progressed) {
        onStep?.()
      }
      if (!progressed) return true
    }
    return true
  }

  /**
   * 根据当前阶段执行一次调度。
   * @returns 若本次调用推进了状态或提交了动作则返回 true。
   */
  async runOnce(): Promise<boolean> {
    const phaseBefore = this.g.phase
    const dayBefore = this.g.day

    const flowCtx = this.buildModeratorFlowContext()
    const moderated = await this.runModerator(flowCtx)
    if (moderated) {
      this.maybeUpdateMemory(phaseBefore, dayBefore)
      return true
    }

    const directive = this.registry.moderator.orchestrate(flowCtx)
    if (directive.shouldAdvance && this.g.phase === "day_speech") {
      advance(this.g)
      this.maybeUpdateMemory(phaseBefore, dayBefore)
      return true
    }

    let progressed = false
    if (this.g.phase === "night") {
      progressed = await this.runNight(flowCtx)
    } else if (this.g.phase === "day_speech") {
      progressed = await this.runDaySpeech(flowCtx)
    } else if (this.g.phase === "day_vote" || this.g.phase === "day_vote_pk") {
      progressed = await this.runDayVote(flowCtx)
    } else if (this.g.phase === "day_last_words") {
      progressed = await this.runLastWords()
    } else if (this.g.phase === "resolve") {
      progressed = await this.runResolve(flowCtx)
    }

    if (progressed) {
      this.maybeUpdateMemory(phaseBefore, dayBefore)
    }
    return progressed
  }

  /**
   * 检测阶段转换并在转换时更新所有 AI 座位的记忆。
   * 仅在 night→day 或 day_vote→night 等关键转换时触发。
   */
  private maybeUpdateMemory(phaseBefore: GamePhase, dayBefore: number): void {
    const phaseChanged = this.g.phase !== phaseBefore
    const dayChanged = this.g.day !== dayBefore

    // 新的一天开始时重置 LLM 熔断器，避免永久降级
    if (dayChanged) {
      this.g.agentState.circuitBreaker.clear()
    }

    // Update memory on major phase transitions
    if (dayChanged || (phaseChanged && (phaseBefore === "night" || phaseBefore === "day_vote" || phaseBefore === "day_vote_pk" || phaseBefore === "day_last_words"))) {
      updateMemoryForAllSeats(this.g)
    }
  }

  /**
   * 调度夜晚阶段的角色行动。
   * @returns 若夜晚状态有推进或有角色成功提交动作则返回 true。
   */
  private async runNight(flowCtx: ModeratorFlowContext): Promise<boolean> {
    const beforePhase = this.g.phase
    const beforeStage = this.g.night?.stage ?? "collect"
    const aliveAiSeats = this.g.seats.filter((s) => s.alive && s.kind === "ai" && s.role)

    if ((this.g.night?.stage ?? "collect") === "collect") {
      for (const s of aliveAiSeats) {
        if (s.role !== "werewolf") continue
        if (this.hasWolfChatSubmitted(s)) continue
        const ctx = this.buildAgentContext(s)
        const agent = this.registry.getRoleAgent(s.seat)
        if (!agent) continue
        const decision = await agent.decide(ctx)
        if (decision?.action?.t === "chat_wolf" && this.submitAgentDecision(s, agent, decision)) {
          return true
        }
      }

      for (const seat of flowCtx.pendingSeats) {
        const s = this.g.seats.find((item) => item.seat === seat)
        if (!s || !s.alive || s.kind !== "ai" || !s.role) continue
        if (!["werewolf", "seer", "guard"].includes(s.role)) continue
        const ctx = this.buildAgentContext(s)
        const agent = this.registry.getRoleAgent(s.seat)
        if (!agent) continue
        const decision = await agent.decide(ctx)
        if (decision && this.submitAgentDecision(s, agent, decision)) {
          return true
        }
      }
    }

    if (this.g.night?.stage === "witch") {
      const witchSeatNumber = flowCtx.pendingSeats[0]
      const witchSeat = aliveAiSeats.find((s) => s.seat === witchSeatNumber && s.role === "witch")
      if (witchSeat) {
        const ctx = this.buildAgentContext(witchSeat)
        const agent = this.registry.getRoleAgent(witchSeat.seat)
        if (agent) {
          const decision = await agent.decide(ctx)
          if (decision && this.submitAgentDecision(witchSeat, agent, decision)) {
            return true
          }
        }
      }
    }

    return beforePhase !== this.g.phase || beforeStage !== (this.g.night?.stage ?? "collect")
  }

  /**
   * 判断指定座位是否已经提交当前夜晚应执行的动作。
   * @param s 座位运行时信息。
   * @returns 若该角色本夜已完成动作提交则返回 true。
   */
  private hasNightActionSubmitted(s: SeatRuntime): boolean {
    if (!this.g.night) return true
    if (s.role === "werewolf") return this.g.night.wolfVotes.has(s.seat)
    if (s.role === "seer") return this.g.night.seerChecks.has(s.seat)
    if (s.role === "guard") return this.g.night.guardProtects.has(s.seat)
    if (s.role === "witch") {
      // If both potions already used, witch has nothing to decide
      if (s.hand.witchAntidoteUsed && s.hand.witchPoisonUsed) return true
      const w = this.g.night.witch
      if (!w) return false
      const antidoteDecided = w.antidoteDecided ?? s.hand.witchAntidoteUsed
      const poisonDecided = w.poisonDecided ?? s.hand.witchPoisonUsed
      return antidoteDecided && poisonDecided
    }
    if (s.role === "villager") return true // no night action
    if (s.role === "hunter") return true // no night action
    return true
  }

  /**
   * 判断指定狼人本夜是否已经发送过狼聊消息。
   * @param s 座位运行时信息。
   * @returns 若本夜已经提交过狼聊则返回 true，否则返回 false。
   */
  private hasWolfChatSubmitted(s: SeatRuntime): boolean {
    if (s.role !== "werewolf" || !this.g.night) return true
    const aliveWerewolves = this.g.seats.filter((seat) => seat.alive && seat.role === "werewolf")
    if (aliveWerewolves.length <= 1) return true
    return this.g.night.wolfChat.some((item) => item.seat === s.seat)
  }

  /**
   * 由调度器统一提交 Agent 决策，先校验动作归属，再交由引擎执行权威规则校验。
   * @param s 当前座位运行时信息。
   * @param agent 当前座位对应的角色 Agent。
   * @param decision Agent 返回的结构化决策。
   * @returns 若动作已被引擎成功接受则返回 true，否则返回 false。
   */
  private submitAgentDecision(s: SeatRuntime, agent: RoleAgent, decision: AgentDecision): boolean {
    if (!agent.isValidActionForRole(decision.action)) {
      this.g.events.push({
        t: "system",
        ts: Date.now(),
        text: `系统已拒绝${s.seat}号${agent.role}Agent的非法动作建议：${decision.action.t}`,
      })
      return false
    }

    try {
      submitAction(this.g, s.seat, decision.action)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误"
      this.g.events.push({
        t: "system",
        ts: Date.now(),
        text: `系统已拒绝${s.seat}号${agent.role}Agent动作：${decision.action.t}（${message}）`,
      })
      return false
    }
  }

  /**
   * 调度白天公开发言阶段。
   * @returns 若有角色发言或流程推进到下一阶段则返回 true。
   */
  private async runDaySpeech(flowCtx: ModeratorFlowContext): Promise<boolean> {
    this.g.dayState = this.g.dayState ?? { votes: new Map(), spoken: new Set() }

    const allowedSpeakers = this.registry.moderator.getSpeechOrder({
      aliveSeats: aliveSeatNumbers(this.g),
      pkCandidates: this.g.dayState.pkCandidates,
    })

    for (const seat of allowedSpeakers) {
      const s = this.g.seats.find((item) => item.seat === seat)
      if (!s) continue
      if (!s.alive || s.kind !== "ai" || !s.role) continue
      if (this.g.dayState.spoken.has(s.seat)) continue
      const ctx = this.buildAgentContext(s)
      const agent = this.registry.getRoleAgent(s.seat)
      if (!agent) continue
      const decision = await agent.decide(ctx)
      if (decision && this.submitAgentDecision(s, agent, decision)) {
        return true
      }
    }

    if (flowCtx.pendingSeats.length === 0) {
      advance(this.g)
      return true
    }

    return false
  }

  /**
   * 调度白天投票阶段。
   * @returns 若有角色完成投票则返回 true。
   */
  private async runDayVote(flowCtx: ModeratorFlowContext): Promise<boolean> {
    this.g.dayState = this.g.dayState ?? { votes: new Map(), spoken: new Set() }

    for (const seat of flowCtx.pendingSeats) {
      const s = this.g.seats.find((item) => item.seat === seat)
      if (!s) continue
      if (!s.alive || s.kind !== "ai" || !s.role) continue
      if (this.g.dayState.votes.has(s.seat)) continue
      const ctx = this.buildAgentContext(s)
      const agent = this.registry.getRoleAgent(s.seat)
      if (!agent) continue
      const decision = await agent.decide(ctx)
      if (decision && this.submitAgentDecision(s, agent, decision)) {
        return true
      }
    }

    return false
  }

  /**
   * 调度遗言阶段：被放逐的 AI 玩家发表遗言。
   * @returns 若遗言完成则返回 true。
   */
  private async runLastWords(): Promise<boolean> {
    const eliminatedSeat = this.g.dayState?.eliminatedSeat
    if (eliminatedSeat == null) {
      advance(this.g)
      return true
    }

    const s = this.g.seats.find((x) => x.seat === eliminatedSeat)
    if (!s || s.kind !== "ai" || !s.role) {
      // 人类玩家或无角色 → 等待人类输入或跳过
      return false
    }

    const ctx = this.buildAgentContext(s)
    const text = buildLastWordsSpeech(ctx)
    submitAction(this.g, eliminatedSeat, { t: "chat_public", text })
    return true
  }

  /**
   * 调度猎人濒死结算阶段。
   * @returns 若猎人完成开枪动作则返回 true。
   */
  private async runResolve(flowCtx: ModeratorFlowContext): Promise<boolean> {
    if (!this.g.hunterState) return false
    for (const seat of flowCtx.pendingSeats) {
      const s = this.g.seats.find((x) => x.seat === seat)
      if (!s || s.kind !== "ai") continue
      const ctx = this.buildAgentContext(s)
      const agent = this.registry.getRoleAgent(seat)
      if (!agent) continue
      const decision = await agent.decide(ctx)
      if (decision && this.submitAgentDecision(s, agent, decision)) {
        return true
      }
    }
    return false
  }

  /**
   * 构建统一的角色 Agent 输入上下文。
   * @param s 当前需要决策的座位。
   * @returns 返回包含游戏快照、结构化时间线、记忆和私有状态的上下文。
   */
  buildAgentContext(s: SeatRuntime): AgentContext {
    const ctx = buildAiContext(this.g, s.seat)
    const roleMemory: Record<string, unknown> = {}
    if (this.g.dayState?.pkCandidates) {
      roleMemory.pkCandidates = this.g.dayState.pkCandidates
    }
    if (s.role === "werewolf") {
      roleMemory.wolfTeammates = ctx.memory.wolfTeammates
    }
    if (s.role === "seer") {
      roleMemory.seerChecks = ctx.memory.seerChecks
    }
    if (s.role === "witch") {
      roleMemory.antidoteUsed = ctx.memory.antidoteUsed
      roleMemory.poisonUsed = ctx.memory.poisonUsed
    }
    if (s.role === "guard") {
      roleMemory.lastGuardTarget = ctx.memory.lastGuardTarget
    }

    const wolfTeammates = s.role === "werewolf"
      ? this.g.seats.filter((x) => x.alive && x.role === "werewolf" && x.seat !== s.seat).map((x) => x.seat)
      : undefined

    const timeline = buildTimelineContexts(ctx.events, this.g.phase, this.g.day)

    return {
      self: {
        seat: s.seat,
        role: s.role!,
        alive: s.alive,
      },
      game: {
        phase: this.g.phase,
        day: this.g.day,
        aliveSeats: aliveSeatNumbers(this.g),
        eliminatedSeats: this.g.seats.filter((seat) => !seat.alive).map((seat) => seat.seat),
      },
      timeline,
      memory: {
        summary: s.memorySummary,
        role: roleMemory,
      },
      knowledge: {
        wolfTeammates,
      },
      privateState: {
        wolfVictimSeat: s.role === "witch" && this.g.night?.stage === "witch"
          ? this.g.night.wolfVictim
          : undefined,
        witchAntidoteUsed: s.hand.witchAntidoteUsed,
        witchPoisonUsed: s.hand.witchPoisonUsed,
        lastGuardTarget: s.hand.lastGuardTarget,
      },
    }
  }

  /**
   * 为裁判 Agent 构建当前流程编排上下文。
   * @returns 返回当前阶段、待行动座位与附加流程信息。
   */
  private buildModeratorFlowContext(): ModeratorFlowContext {
    if (this.g.phase === "night") {
      if ((this.g.night?.stage ?? "collect") === "witch") {
        const witchSeat = this.g.seats.find((seat) => seat.alive && seat.role === "witch")
        const pendingSeats = witchSeat && !this.hasNightActionSubmitted(witchSeat)
          ? [witchSeat.seat]
          : []
        return {
          phase: this.g.phase,
          day: this.g.day,
          aliveSeats: aliveSeatNumbers(this.g),
          pendingSeats,
          nightStage: "witch",
        }
      }

      const pendingSeats = this.g.seats
        .filter((seat) => seat.alive && ["werewolf", "seer", "guard"].includes(seat.role ?? ""))
        .filter((seat) => !this.hasNightActionSubmitted(seat))
        .map((seat) => seat.seat)

      return {
        phase: this.g.phase,
        day: this.g.day,
        aliveSeats: aliveSeatNumbers(this.g),
        pendingSeats,
        nightStage: "collect",
      }
    }

    if (this.g.phase === "day_speech") {
      this.g.dayState = this.g.dayState ?? { votes: new Map(), spoken: new Set() }
      const pendingSeats = this.registry.moderator.getSpeechOrder({
        aliveSeats: aliveSeatNumbers(this.g),
        pkCandidates: this.g.dayState.pkCandidates,
      }).filter((seat) => !this.g.dayState!.spoken.has(seat))

      return {
        phase: this.g.phase,
        day: this.g.day,
        aliveSeats: aliveSeatNumbers(this.g),
        pendingSeats,
        pkCandidates: this.g.dayState.pkCandidates,
      }
    }

    if (this.g.phase === "day_vote" || this.g.phase === "day_vote_pk") {
      this.g.dayState = this.g.dayState ?? { votes: new Map(), spoken: new Set() }
      const pendingSeats = aliveSeatNumbers(this.g).filter((seat) => !this.g.dayState!.votes.has(seat))
      return {
        phase: this.g.phase,
        day: this.g.day,
        aliveSeats: aliveSeatNumbers(this.g),
        pendingSeats,
        pkCandidates: this.g.dayState.pkCandidates,
      }
    }

    if (this.g.phase === "day_last_words") {
      const eliminatedSeat = this.g.dayState?.eliminatedSeat
      return {
        phase: this.g.phase,
        day: this.g.day,
        aliveSeats: aliveSeatNumbers(this.g),
        pendingSeats: eliminatedSeat != null ? [eliminatedSeat] : [],
      }
    }

    if (this.g.phase === "resolve") {
      const pendingSeats = this.g.hunterState?.dyingSeats.filter((seat) => !this.g.hunterState!.shots.has(seat)) ?? []
      return {
        phase: this.g.phase,
        day: this.g.day,
        aliveSeats: aliveSeatNumbers(this.g),
        pendingSeats,
        hunterDyingSeats: this.g.hunterState?.dyingSeats ?? [],
      }
    }

    return {
      phase: this.g.phase,
      day: this.g.day,
      aliveSeats: aliveSeatNumbers(this.g),
      pendingSeats: [],
    }
  }

  private getModeratorCommentaryTarget(): GameEvent | null {
    for (let i = this.g.events.length - 1; i >= 0; i -= 1) {
      const event = this.g.events[i]
      if (event.t === "system") {
        const data = event.data
        if (typeof data === "object" && data !== null && "kind" in data && data.kind === "moderator_commentary") {
          continue
        }
        continue
      }
      if (event.t === "chat_private" || event.t === "chat_wolf") continue
      return event
    }
    return null
  }

  private getModeratorCommentaryKey(event: GameEvent): string {
    if (event.t === "phase") return `${event.t}:${event.ts}:${event.phase}:${event.day}`
    if (event.t === "chat_public") return `${event.t}:${event.ts}:${event.seat}:${event.text}`
    if (event.t === "action") return `${event.t}:${event.ts}:${event.seat}:${event.action}`
    if (event.t === "result") return `${event.t}:${event.ts}:${event.text}`
    return `${event.t}:${event.ts}`
  }

  /**
   * 让裁判 Agent 负责阶段播报与流程提示，避免重复插入相同主持文案。
   * @returns 若本次新增了主持事件则返回 true，否则返回 false。
   */
  private async runModerator(flowCtx: ModeratorFlowContext): Promise<boolean> {
    const timeline = buildTimelineContexts(this.g.events, this.g.phase, this.g.day)
    const phaseKey = `${this.g.day}:${this.g.phase}:${flowCtx.nightStage ?? "none"}`

    if (phaseKey !== this.g.agentState.lastModeratorAnnouncementKey) {
      this.g.agentState.lastModeratorAnnouncementKey = phaseKey
      const text = await this.registry.moderator.announcePhase({
        phase: this.g.phase,
        day: this.g.day,
        nightStage: flowCtx.nightStage,
        pendingSeats: flowCtx.pendingSeats,
        pkCandidates: flowCtx.pkCandidates,
        timeline,
      })
      if (text) {
        this.g.events.push({ t: "system", ts: Date.now(), text })
        this.g.agentState.lastModeratorHintKey = null
        return true
      }
    }

    const directive = this.registry.moderator.orchestrate(flowCtx)
    const hintKey = `${phaseKey}:${directive.pendingSeats.join(",")}:${directive.hint ?? ""}`
    if (directive.hint && hintKey !== this.g.agentState.lastModeratorHintKey) {
      this.g.agentState.lastModeratorHintKey = hintKey
      this.g.events.push({ t: "system", ts: Date.now(), text: directive.hint })
      return true
    }

    const commentaryTarget = this.getModeratorCommentaryTarget()
    if (commentaryTarget) {
      const commentaryKey = this.getModeratorCommentaryKey(commentaryTarget)
      if (commentaryKey !== this.g.agentState.lastModeratorCommentaryKey) {
        this.g.agentState.lastModeratorCommentaryKey = commentaryKey
        const text = await this.registry.moderator.commentOnSituation({
          phase: this.g.phase,
          day: this.g.day,
          aliveSeats: aliveSeatNumbers(this.g),
          recentEvent: commentaryTarget,
          timeline,
        })
        if (text) {
          this.g.events.push({
            t: "system",
            ts: Date.now(),
            text,
            data: { kind: "moderator_commentary", sourceEventType: commentaryTarget.t },
          })
          return true
        }
      }
    }

    return false
  }
}

/**
 * 为指定对局创建调度器实例。
 * @param g 当前对局运行时状态。
 * @returns 返回可推进 AI 角色行动的调度器。
 */
export function createScheduler(g: GameRuntime): Scheduler {
  return new Scheduler(g)
}
