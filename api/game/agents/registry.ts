import type { GameRuntime } from "../model.js"
import type { RoleAgent, ModeratorAgent } from "./types.js"
import { ModeratorAgentImpl } from "./moderator.js"
import { createRoleAgent } from "./role-agents.js"

export type AgentRegistry = {
  moderator: ModeratorAgent
  seatAgents: Map<number, RoleAgent>
  roles: Map<number, RoleAgent>
  responsibilitiesBoundary: {
    moderator: string[]
    players: string[]
  }
  getRoleAgent(seat: number): RoleAgent | undefined
  getSeatAgent(seat: number): RoleAgent | undefined
  listSeatAgents(): RoleAgent[]
}

/**
 * 根据当前座位 Agent 集合刷新职责边界元数据。
 * @param registry 当前单局 Agent 注册表。
 */
function refreshResponsibilitiesBoundary(registry: AgentRegistry) {
  registry.responsibilitiesBoundary.moderator = registry.moderator.responsibilities
  registry.responsibilitiesBoundary.players = [
    ...new Set(Array.from(registry.seatAgents.values()).flatMap((agent) => agent.responsibilities)),
  ]
}

/**
 * 将当前对局已分配身份的座位同步为角色 Agent。
 * @param registry 需要写入角色 Agent 的注册表。
 * @param g 当前对局运行时状态。
 */
function populateSeatAgents(registry: AgentRegistry, g: GameRuntime) {
  registry.seatAgents.clear()
  for (const s of g.seats) {
    if (!s.role) continue
    const agent = createRoleAgent(s.seat, s.role, s.ai, undefined, g.agentState.circuitBreaker)
    registry.seatAgents.set(s.seat, agent)
  }
  refreshResponsibilitiesBoundary(registry)
}

/**
 * 为单局游戏初始化统一的 Agent 注册表容器。
 * @param g 当前对局运行时状态。
 * @returns 返回包含裁判 Agent、座位角色 Agent 与职责边界元数据的注册表。
 */
export function createAgentRegistry(g: GameRuntime): AgentRegistry {
  const moderator = new ModeratorAgentImpl(g.config.moderator?.ai)
  const seatAgents = new Map<number, RoleAgent>()
  const registry: AgentRegistry = {
    moderator,
    seatAgents,
    roles: seatAgents,
    responsibilitiesBoundary: {
      moderator: [...moderator.responsibilities],
      players: [],
    },
    getRoleAgent(seat: number) {
      return seatAgents.get(seat)
    },
    getSeatAgent(seat: number) {
      return seatAgents.get(seat)
    },
    listSeatAgents() {
      return Array.from(seatAgents.values())
    },
  }
  populateSeatAgents(registry, g)
  return registry
}

/**
 * 确保当前对局拥有可复用的裁判/角色 Agent 注册表。
 * @param g 当前对局运行时状态。
 * @returns 返回绑定到该局生命周期的 Agent 注册表。
 */
export function ensureAgentRegistry(g: GameRuntime): AgentRegistry {
  if (!g.agentState.registry) {
    g.agentState.registry = createAgentRegistry(g)
  }
  return g.agentState.registry
}

/**
 * 在发牌后或恢复对局时同步各座位角色 Agent，复用既有裁判 Agent。
 * @param g 当前对局运行时状态。
 * @returns 返回同步后的 Agent 注册表。
 */
export function syncAgentRegistrySeats(g: GameRuntime): AgentRegistry {
  const registry = ensureAgentRegistry(g)
  populateSeatAgents(registry, g)
  return registry
}
