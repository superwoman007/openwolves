import {
  MODERATOR_RESPONSIBILITIES,
  type ModeratorAgent,
  type ModeratorAnnouncementContext,
  type ModeratorFlowContext,
  type ModeratorFlowDirective,
  type ModeratorSpeechOrderContext,
} from "./types.js"
import {
  getModeratorPromptConfig,
  isModeratorAnnouncementPhase,
  renderPromptTemplate,
} from "../prompt-config/loader.js"

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

export class ModeratorAgentImpl implements ModeratorAgent {
  readonly scope = "moderator" as const
  readonly role = "moderator" as const
  readonly responsibilities = MODERATOR_RESPONSIBILITIES

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
}
