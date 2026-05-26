import type { AIProviderConfig, Role } from "../../../shared/game.js"
import type { AgentContext, AgentDecision } from "./types.js"
import { BaseRoleAgent } from "./base-role-agent.js"
import { openaiCompatChat } from "../../llm/openaiCompatible.js"
import { parseLLMDecision, CircuitBreaker } from "./llm-decision.js"
import { assignPersonality, type Personality } from "./personality.js"
import { buildSystemPromptWithPersonality, buildCompactContext } from "./prompt-builder.js"

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 15_000

/**
 * LLM 驱动的角色 Agent。
 * 通过 LLM 推理做出决策，失败时 fallback 到启发式逻辑。
 */
export class LLMRoleAgent extends BaseRoleAgent {
  private readonly aiConfig: AIProviderConfig
  private readonly personality: Personality
  private readonly circuitBreaker: CircuitBreaker

  constructor(seat: number, role: Role, aiConfig: AIProviderConfig, seed: string = "default", circuitBreaker?: CircuitBreaker) {
    super(seat, role)
    this.aiConfig = aiConfig
    this.personality = assignPersonality(seat, seed)
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker(3)
  }

  async decide(ctx: AgentContext): Promise<AgentDecision | null> {
    // Skip LLM if circuit breaker is open
    if (this.circuitBreaker.isOpen(this.seat)) {
      return this.heuristicDecide(ctx)
    }

    try {
      const decision = await this.llmDecide(ctx)
      if (decision) {
        this.circuitBreaker.recordSuccess(this.seat)
        return decision
      }
      // LLM returned invalid response
      this.circuitBreaker.recordFailure(this.seat)
      return this.heuristicDecide(ctx)
    } catch {
      this.circuitBreaker.recordFailure(this.seat)
      return this.heuristicDecide(ctx)
    }
  }

  private async llmDecide(ctx: AgentContext): Promise<AgentDecision | null> {
    const { systemPrompt, userPrompt } = this.buildPrompt(ctx)
    const rawTemp = (this.aiConfig.temperature ?? 0.7) + this.personality.temperatureOffset
    const temperature = Math.max(0, Math.min(2, rawTemp))

    const llmPromise = openaiCompatChat(
      {
        provider: this.aiConfig.provider,
        baseUrl: this.aiConfig.baseUrl,
        apiKey: this.aiConfig.apiKey,
        model: this.aiConfig.model,
        temperature,
        responseFormat: { type: "json_object" },
        maxTokens: 500,
      },
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    )

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS)
    )

    const response = await Promise.race([llmPromise, timeoutPromise])

    return parseLLMDecision(response, this.role, ctx.game.aliveSeats, this.seat, ctx.game.phase)
  }

  private buildPrompt(ctx: AgentContext): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = buildSystemPromptWithPersonality(this.role, this.personality)
    const userPrompt = this.buildUserPrompt(ctx)
    return { systemPrompt, userPrompt }
  }

  private buildUserPrompt(ctx: AgentContext): string {
    const parts: string[] = []

    // Compact game context (state + knowledge + memory + timeline)
    parts.push(buildCompactContext(ctx))

    // Decision instruction based on phase
    parts.push(this.getDecisionInstruction(ctx))

    return parts.join("\n\n")
  }

  private getDecisionInstruction(ctx: AgentContext): string {
    const { phase } = ctx.game

    if (phase === "night") {
      switch (this.role) {
        case "werewolf": {
          const wolfChats = ctx.timeline.speeches.filter(
            s => s.visibility === "wolf" && s.phase === "night" && s.day === ctx.game.day
          )
          if (wolfChats.length === 0 && (ctx.knowledge.wolfTeammates?.length ?? 0) > 0) {
            return `请先和队友讨论今晚刀谁。回复action="chat_wolf"，speech=你的建议。`
          }
          return `请决定今晚刀谁。回复action="wolf_kill"，target=目标座位号。`
        }
        case "seer":
          return `请决定今晚查验谁。回复action="seer_check"，target=目标座位号。`
        case "witch":
          if (!ctx.privateState.witchAntidoteUsed && ctx.privateState.wolfVictimSeat) {
            return `今晚${ctx.privateState.wolfVictimSeat}号被刀，是否使用解药？回复action="witch_antidote"，target=救的座位号或-1表示不救。`
          }
          if (!ctx.privateState.witchPoisonUsed) {
            return `是否使用毒药？回复action="witch_poison"，target=毒的座位号或-1表示不毒。`
          }
          return `你已无药可用。回复action="witch_antidote"，target=-1。`
        case "guard":
          return `请决定今晚守护谁。回复action="guard_protect"，target=目标座位号。`
        default:
          return `夜晚无需行动。`
      }
    }

    if (phase === "day_speech") {
      return `请给出你的公开发言。要求：\n1. 先在thinking中写出完整的推理过程（局势复盘→身份推断→矛盾识别→策略决定）\n2. 然后在speech中给出3-5句中文公开发言，必须包含具体的怀疑对象和详细的推理理由\n3. 回复action="chat_public"，speech=你的发言内容。`
    }

    if (phase === "day_vote" || phase === "day_vote_pk") {
      const pkCandidates = ctx.memory.role.pkCandidates as number[] | undefined
      if (pkCandidates && pkCandidates.length > 0) {
        return `PK投票，候选人：${pkCandidates.join(",")}号。回复action="vote"，target=你投的座位号。`
      }
      return `请投票。回复action="vote"，target=你投的座位号，或null弃票。`
    }

    if (phase === "resolve" && this.role === "hunter") {
      return `你濒死了，是否开枪带走一人？回复action="hunter_shoot"，target=目标座位号或null不开枪。`
    }

    return `请根据当前阶段做出决策。`
  }

  /**
   * 启发式 fallback：复用现有的评分逻辑。
   */
  private heuristicDecide(ctx: AgentContext): Promise<AgentDecision | null> {
    // Import and delegate to the heuristic agents
    return heuristicDecideForRole(this.role, this.seat, ctx)
  }
}

/**
 * 启发式决策 fallback，复用现有 role-agents 中的逻辑。
 */
async function heuristicDecideForRole(
  role: Role,
  seat: number,
  ctx: AgentContext,
): Promise<AgentDecision | null> {
  // Lazy import to avoid circular dependency
  const { WerewolfAgent, SeerAgent, WitchAgent, GuardAgent, HunterAgent, VillagerAgent } =
    await import("./role-agents.js")

  let agent: BaseRoleAgent
  switch (role) {
    case "werewolf": agent = new WerewolfAgent(seat, role); break
    case "seer": agent = new SeerAgent(seat, role); break
    case "witch": agent = new WitchAgent(seat, role); break
    case "guard": agent = new GuardAgent(seat, role); break
    case "hunter": agent = new HunterAgent(seat, role); break
    case "villager": agent = new VillagerAgent(seat, role); break
    default: return null
  }
  return agent.decide(ctx)
}
