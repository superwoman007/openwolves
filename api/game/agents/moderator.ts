import {
  MODERATOR_RESPONSIBILITIES,
  type ModeratorCommentaryContext,
  type ModeratorAgent,
  type ModeratorAnnouncementContext,
  type ModeratorFlowContext,
  type ModeratorFlowDirective,
  type ModeratorSpeechOrderContext,
} from "./types.js"
import type { AIProviderConfig, GameEvent } from "../../../shared/game.js"
import {
  getModeratorPromptConfig,
  isModeratorAnnouncementPhase,
  renderPromptTemplate,
} from "../prompt-config/loader.js"
import { openaiCompatChat } from "../../llm/openaiCompatible.js"

/**
 * 将座位号列表格式化为适合主持播报的中文文本。
 * @param seats 待格式化的座位号数组。
 * @returns 返回如“1、3、5号”的文本；若为空则返回“无人”。
 */
function formatSeats(seats: number[]): string {
  return seats.length > 0 ? `${seats.join("、")}号` : "无人"
}

/**
 * 根据配置模板渲染阶段播报文案。
 * @param phase 当前裁判播报阶段。
 * @param day 当前天数。
 * @returns 返回替换占位符后的主持文案。
 */
function renderAnnouncementTemplate(phase: ModeratorAnnouncementContext["phase"], day: number): string {
  const config = getModeratorPromptConfig()
  if (!isModeratorAnnouncementPhase(phase)) {
    return `阶段切换：${phase}`
  }
  const template = config.announcements[phase] ?? `阶段切换：${phase}`
  return renderPromptTemplate(template, { day, phase })
}

function isRealModeratorProvider(aiConfig?: AIProviderConfig): boolean {
  return !!aiConfig && aiConfig.provider !== "mock" && !!(aiConfig.apiKey || process.env.OPENAI_API_KEY)
}

function summarizeRecentEvent(event: GameEvent): string {
  switch (event.t) {
    case "chat_public":
      return `${event.seat}号刚刚发言：“${event.text}”`
    case "action":
      return `${event.seat}号刚刚执行动作：${event.action}`
    case "result":
      return `系统刚刚公布结果：${event.text}`
    case "phase":
      return `当前阶段切换为${event.phase}，第${event.day}天`
    default:
      return ""
  }
}

function buildMockCommentary(ctx: ModeratorCommentaryContext): string | null {
  const event = ctx.recentEvent
  const seat = event.t === "chat_public" || event.t === "action" ? event.seat : null
  const variant = ((seat ?? 0) + ctx.day) % 4

  if (event.t === "chat_public") {
    const templates = [
      `${event.seat}号这段发言像是在茶馆里 slowly 展开一把折扇，风度有余，真相有待后文拆解。`,
      `${event.seat}号讲得头头是道，桌上几位已经开始偷偷交换眼神了。`,
      `${event.seat}号的发言像一杯温热的茶，入口平和，回味里却藏着几分锋芒。`,
      `${event.seat}号话音刚落，场上有人点头有人皱眉，这气氛微妙得像薄暮时分的天色。`,
    ]
    return templates[variant]!
  }
  if (event.t === "action") {
    if (event.action === "vote") {
      const templates = [
        `${event.seat}号这一票落子无悔，像是心里早就写好了剧本，只待观众验收结局。`,
        `${event.seat}号的投票干脆利落，桌上几位不自觉的坐直了身子。`,
        `${event.seat}号投下这一票，空气里仿佛能听到算盘珠子拨动的声音。`,
        `${event.seat}号的选择已经揭晓，有人松了口气，有人攥紧了拳头。`,
      ]
      return templates[variant]!
    }
    if (event.action === "hunter_shoot") {
      const templates = [
        `${event.seat}号这一枪让桌面温度陡升，连灯光都仿佛暗了半分。`,
        `枪声响起，${event.seat}号的最后一击把全场目光都钉在了同一个方向。`,
        `${event.seat}号扣下扳机的瞬间，有人闭上了眼，有人睁得更大了。`,
        `这一枪带着 ${event.seat} 号的全部判断，打出去之后，棋盘上少了一个人，多了无数猜想。`,
      ]
      return templates[variant]!
    }
    const templates = [
      `${event.seat}号的动作行云流水，像是在赶一场已经写好的剧情。`,
      `${event.seat}号行动完毕，场上几位不约而同地调整了一下坐姿。`,
      `${event.seat}号的选择已经落定，接下来就看这步棋会引发怎样的连锁反应。`,
      `${event.seat}号出手果断，像是早就看清了迷雾背后的轮廓。`,
    ]
    return templates[variant]!
  }
  if (event.t === "result") {
    const templates = [
      `${event.text}，这一幕像是老电影里的慢镜头，每个人的表情都值得定格细看。`,
      `${event.text}，剧情走到这里，场上有人暗自庆幸，有人心底一沉。`,
      `${event.text}，结果揭晓的瞬间，空气仿佛凝滞了一拍。`,
      `${event.text}，这转折来得不动声色，却在每个人心里投下一颗石子。`,
    ]
    return templates[variant]!
  }
  if (event.t === "phase") {
    const phaseNames: Record<string, string> = {
      night: "夜晚",
      day_speech: "白天发言",
      day_vote: "投票",
      day_vote_pk: "PK投票",
      resolve: "结算",
      ended: "终局",
    }
    const phaseName = phaseNames[event.phase] ?? event.phase
    const templates = [
      `第${event.day}天${phaseName}开启，烛火摇曳，每个人的表情都值得细读。`,
      `新的章节掀开，第${event.day}天${phaseName}，故事正往谁也没料到的方向滑去。`,
      `第${event.day}天${phaseName}，场上还坐着的人，心里都装着不同的剧本。`,
      `第${event.day}天${phaseName}，窗外夜风渐起，屋内的博弈才刚刚开始。`,
    ]
    return templates[variant]!
  }
  return null
}

export class ModeratorAgentImpl implements ModeratorAgent {
  readonly scope = "moderator" as const
  readonly role = "moderator" as const
  readonly responsibilities = MODERATOR_RESPONSIBILITIES
  readonly aiConfig?: AIProviderConfig

  constructor(aiConfig?: AIProviderConfig) {
    this.aiConfig = aiConfig
  }

  /**
   * 根据阶段上下文生成裁判播报文案。
   * @param ctx 裁判播报所需的阶段、天数与时间线信息。
   * @returns 返回可直接写入事件流或展示给玩家的主持文案。
   */
  async announcePhase(ctx: ModeratorAnnouncementContext): Promise<string> {
    if (ctx.phase === "night") {
      if (ctx.nightStage === "witch") {
        return `第${ctx.day}天夜晚进入女巫行动阶段。`
      }
      return renderAnnouncementTemplate(ctx.phase, ctx.day)
    }

    if (ctx.phase === "day_speech") {
      if (ctx.pkCandidates && ctx.pkCandidates.length > 0) {
        return `第${ctx.day}天白天进入PK发言，候选人是${formatSeats(ctx.pkCandidates)}。`
      }
      return renderAnnouncementTemplate(ctx.phase, ctx.day)
    }

    if (ctx.phase === "day_vote") {
      return renderAnnouncementTemplate(ctx.phase, ctx.day)
    }

    if (ctx.phase === "day_vote_pk") {
      return ctx.pkCandidates && ctx.pkCandidates.length > 0
        ? `进入PK投票，请在${formatSeats(ctx.pkCandidates)}中选择。`
        : renderAnnouncementTemplate(ctx.phase, ctx.day)
    }

    if (ctx.phase === "resolve") {
      return renderAnnouncementTemplate(ctx.phase, ctx.day)
    }

    if (ctx.phase === "ended") {
      return renderAnnouncementTemplate(ctx.phase, ctx.day)
    }

    if (ctx.phase === "lobby") {
      return renderAnnouncementTemplate(ctx.phase, ctx.day)
    }

    return `阶段切换：${ctx.phase}`
  }

  /**
   * 计算裁判宣布的发言顺序。
   * @param ctx 当前存活座位与 PK 候选人上下文。
   * @returns 返回本轮允许发言的座位顺序。
   */
  getSpeechOrder(ctx: ModeratorSpeechOrderContext): number[] {
    if (ctx.pkCandidates && ctx.pkCandidates.length > 0) {
      return ctx.pkCandidates
    }
    return ctx.aliveSeats
  }

  /**
   * 根据当前阶段的待办座位生成流程编排提示。
   * @param ctx 当前阶段、待行动座位与附加流程信息。
   * @returns 返回主持提示与是否可推进阶段的结果。
   */
  orchestrate(ctx: ModeratorFlowContext): ModeratorFlowDirective {
    if (ctx.phase === "night") {
      if (ctx.nightStage === "witch") {
        return {
          shouldAdvance: ctx.pendingSeats.length === 0,
          pendingSeats: ctx.pendingSeats,
          hint: ctx.pendingSeats.length > 0
            ? "女巫请决定是否使用解药与毒药。"
            : "夜间行动已完成，等待系统结算。",
        }
      }

      return {
        shouldAdvance: false,
        pendingSeats: ctx.pendingSeats,
        hint: ctx.pendingSeats.length > 0
          ? `夜间行动进行中，待行动座位：${formatSeats(ctx.pendingSeats)}。`
          : "夜间主要行动已收齐，等待系统结算。",
      }
    }

    if (ctx.phase === "day_speech") {
      return {
        shouldAdvance: ctx.pendingSeats.length === 0,
        pendingSeats: ctx.pendingSeats,
        hint: ctx.pendingSeats.length > 0
          ? `请${formatSeats(ctx.pendingSeats)}按顺序完成发言。`
          : "白天发言结束，准备进入投票。",
      }
    }

    if (ctx.phase === "day_vote" || ctx.phase === "day_vote_pk") {
      return {
        shouldAdvance: ctx.pendingSeats.length === 0,
        pendingSeats: ctx.pendingSeats,
        hint: ctx.pendingSeats.length > 0
          ? `请${formatSeats(ctx.pendingSeats)}完成投票。`
          : "投票已收齐，准备结算票型。",
      }
    }

    if (ctx.phase === "resolve") {
      return {
        shouldAdvance: ctx.pendingSeats.length === 0,
        pendingSeats: ctx.pendingSeats,
        hint: ctx.pendingSeats.length > 0
          ? `请${formatSeats(ctx.pendingSeats)}号猎人决定是否开枪。`
          : "濒死结算已完成。",
      }
    }

    return {
      shouldAdvance: false,
      pendingSeats: ctx.pendingSeats,
    }
  }

  async commentOnSituation(ctx: ModeratorCommentaryContext): Promise<string | null> {
    if (!["chat_public", "action", "result", "phase"].includes(ctx.recentEvent.t)) {
      return null
    }

    if (isRealModeratorProvider(this.aiConfig)) {
      try {
        const recentTimeline = ctx.timeline.events
          .filter((event) => event.visibility === "public")
          .slice(-8)
          .map((event) => ({
            type: event.type,
            day: event.day,
            phase: event.phase,
            summary: event.summary,
          }))

        const content = await openaiCompatChat(
          {
            provider: this.aiConfig?.provider,
            baseUrl: this.aiConfig?.baseUrl,
            apiKey: this.aiConfig?.apiKey,
            model: this.aiConfig?.model,
            temperature: this.aiConfig?.temperature ?? 0.9,
            maxTokens: 120,
          },
          [
            {
              role: "system",
              content: `${getModeratorPromptConfig().systemPrompt}

你同时是这场狼人杀的"场边说书人"。
你的旁白不是冰冷的系统通知，而是像一位坐在火炉边、手里转着茶杯的老朋友，用带着温度的眼睛观察桌上的一举一动，然后轻轻说上一句点睛之语。

要诀：
- 有画面感。让听众能"看见"场上的神情、动作和空气里微妙的气氛。
- 有分寸感。轻轻点破，绝不戳穿；调侃可以，不能恶意挖苦。
- 只基于已公开的台面信息，绝不泄露身份，不编造未发生的事，不替玩家开口。
- 只输出一句话中文，像一句散文随笔，自然流淌出来，不要像命令或公告。`,
            },
            {
              role: "user",
              content: renderPromptTemplate(
                `此刻是第{{day}}天{{phase}}，围坐在桌边的还有：{{aliveSeats}}。

刚刚发生的事：{{recentEvent}}

最近几幕的剪影：{{recentTimeline}}

请你以说书人的口吻，轻轻落下一句话，勾勒出这一瞬间的氛围。`,
                {
                  day: ctx.day,
                  phase: ctx.phase,
                  aliveSeats: ctx.aliveSeats.join("、"),
                  recentEvent: summarizeRecentEvent(ctx.recentEvent),
                  recentTimeline: JSON.stringify(recentTimeline),
                },
              ),
            },
          ],
        )

        return content.replace(/\s+/g, " ").trim().slice(0, 80)
      } catch {
        return buildMockCommentary(ctx)
      }
    }

    return buildMockCommentary(ctx)
  }
}
