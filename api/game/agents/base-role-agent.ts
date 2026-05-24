import type { HumanAction, Role } from "../../../shared/game.js"
import {
  PLAYER_AGENT_RESPONSIBILITIES,
  type AgentContext,
  type AgentDecision,
  type RoleAgent,
} from "./types.js"

export abstract class BaseRoleAgent implements RoleAgent {
  readonly scope = "player" as const
  readonly responsibilities = PLAYER_AGENT_RESPONSIBILITIES

  constructor(
    readonly seat: number,
    readonly role: Role,
  ) {}

  /**
   * 生成当前座位在指定阶段下的决策。
   * @param ctx 统一角色 Agent 上下文，包含游戏快照、事件时间线、记忆与私有信息。
   * @returns 返回结构化动作决策；若当前阶段无需行动则返回 null。
   */
  abstract decide(ctx: AgentContext): Promise<AgentDecision | null>

  /**
   * 校验指定角色是否允许提交某类动作。
   * @param action 待校验的人类动作结构。
   * @returns 若动作属于该角色可执行范围则返回 true，否则返回 false。
   */
  isValidActionForRole(action: HumanAction): boolean {
    if (action.t === "chat_public" || action.t === "vote") {
      return true
    }

    switch (this.role) {
      case "werewolf":
        return action.t === "wolf_kill" || action.t === "chat_wolf"
      case "seer":
        return action.t === "seer_check"
      case "witch":
        return action.t === "witch_antidote" || action.t === "witch_poison"
      case "guard":
        return action.t === "guard_protect"
      case "hunter":
        return action.t === "hunter_shoot"
      case "villager":
        return false
      default:
        return false
    }
  }
}
