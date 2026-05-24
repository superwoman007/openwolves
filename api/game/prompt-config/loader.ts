import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { GamePhase, Role } from "../../../shared/game.js"

const ROLE_KEYS = ["werewolf", "seer", "witch", "hunter", "guard", "villager"] as const satisfies readonly Role[]
const MODERATOR_PHASE_KEYS = ["night", "day_speech", "day_vote", "day_vote_pk", "resolve", "ended", "lobby"] as const
const DEFAULT_CONFIG_PATH = resolve(import.meta.dirname ?? __dirname, "prompts.json")

type ModeratorAnnouncementPhase = (typeof MODERATOR_PHASE_KEYS)[number]

export type RolePromptConfig = {
  systemPrompt: string
  mockSpeechStances: string[]
}

export type ModeratorPromptConfig = {
  systemPrompt: string
  announcements: Partial<Record<ModeratorAnnouncementPhase, string>>
}

export type SharedPromptConfig = {
  publicSpeechUserPromptTemplate: string
  mockSpeechOpeners: string[]
}

export type FallbackPromptConfig = {
  systemPrompt: string
  mockSpeechStances: string[]
}

export type PromptCatalog = {
  version: number
  shared: SharedPromptConfig
  fallback: FallbackPromptConfig
  moderator: ModeratorPromptConfig
  roles: Record<Role, RolePromptConfig>
}

export type PromptConfig = RolePromptConfig | ModeratorPromptConfig | FallbackPromptConfig

const MINIMAL_FALLBACK_PROMPTS: PromptCatalog = {
  version: 1,
  shared: {
    publicSpeechUserPromptTemplate:
      "游戏上下文（脱敏处理）：{{contextJson}}\n\n你的长期记忆（之前轮次的总结）：{{memorySummary}}\n\n你的专属记忆：{{roleMemory}}\n\n现在是第{{day}}天白天讨论，你是{{seat}}号玩家，身份是{{role}}。请基于当前信息给出2-3句自然、符合身份目标的中文公开发言。",
    mockSpeechOpeners: ["第{{day}}天，{{seat}}号发言。", "我是{{seat}}号，报一下视角。", "{{seat}}号说两句。"],
  },
  fallback: {
    systemPrompt:
      "你是一名狼人杀游戏参与者。请严格依据当前公开信息、角色目标与规则约束，输出简洁、自然、符合局势的中文发言或决策。",
    mockSpeechStances: [
      "我先听大家发言，再结合票型判断。",
      "目前信息有限，我先给出保守站边。",
      "我会继续根据公开信息更新判断。",
    ],
  },
  moderator: {
    systemPrompt:
      "你是狼人杀游戏的裁判。你的目标是准确、清晰、中立地主持整局流程，只播报已确认且允许公开的信息。",
    announcements: {
      night: "第{{day}}天夜晚降临，请闭眼。",
      day_speech: "第{{day}}天白天，天亮了，请发言。",
      day_vote: "请投票。",
      day_vote_pk: "进入PK投票阶段，请依次表态并投票。",
      resolve: "进入濒死结算阶段。",
      ended: "游戏结束，请查看结果。",
      lobby: "等待开始。",
    },
  },
  roles: {
    werewolf: {
      systemPrompt:
        "你是狼人阵营玩家。请依据公开信息与狼队目标进行自然、克制且符合局势的中文表达。",
      mockSpeechStances: ["我先听大家发言，再决定怎么站边。", "我觉得可以先从票型和发言矛盾入手。", "谁带节奏太明显，我会重点关注谁。"],
    },
    seer: {
      systemPrompt: "你是预言家。请依据真实查验信息和公开局势，为好人阵营争取收益。",
      mockSpeechStances: ["我有一些信息，但先听听大家发言。", "今天我重点关注站边和投票。", "好人不要分票，先出最像狼的。"],
    },
    witch: {
      systemPrompt: "你是女巫。请结合夜间信息与药剂状态，在控制暴露风险的前提下帮助好人判断局势。",
      mockSpeechStances: ["我先听发言抓狼，今天看谁在强带节奏。", "信息量还不够，我先保留一点判断。", "我觉得可以先从死亡信息和站边看问题。"],
    },
    hunter: {
      systemPrompt: "你是猎人。请通过稳定表水和施压帮助好人缩小狼坑，并保留开枪威慑。",
      mockSpeechStances: ["我先表个水，我这轮偏好人。", "谁踩我我会重点看谁的逻辑。", "今天先出最像狼的，不要空转。"],
    },
    guard: {
      systemPrompt: "你是守卫。请结合死亡结果、平安夜与站边格局，帮助好人识别狼人意图。",
      mockSpeechStances: ["我先分析刀型，再结合发言判断。", "好人不要互打，先找节奏最怪的人。", "我会重点看谁在借死亡信息做文章。"],
    },
    villager: {
      systemPrompt: "你是村民。请只依据公开信息、发言逻辑与票型变化，帮助好人找出狼人。",
      mockSpeechStances: ["我是村民，先从公开信息里找问题。", "今天看谁的逻辑前后不一致。", "我先给结论，再补核心理由。"],
    },
  },
}

let loadedPrompts: PromptCatalog | null = null

/**
 * 判断值是否为非空字符串。
 * @param value 待校验的任意值。
 * @returns 若值为去除首尾空白后的非空字符串则返回 true。
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * 解析当前应读取的提示词配置文件路径。
 * @returns 返回环境变量覆盖路径或默认 prompts.json 路径。
 */
function resolveConfigPath(): string {
  const override = process.env.PROMPT_CONFIG_PATH?.trim()
  if (!override || override === "undefined" || override === "null") {
    return DEFAULT_CONFIG_PATH
  }
  return override
}

/**
 * 判断值是否为可遍历的普通对象。
 * @param value 待判断的任意值。
 * @returns 若值为非数组对象则返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 归一化字符串数组字段，缺失或非法时退回默认值并记录问题。
 * @param value 原始字段值。
 * @param fallback 缺失时使用的默认数组。
 * @param issues 归一化过程中累计的问题描述。
 * @param path 当前字段路径，便于输出诊断信息。
 * @returns 返回可安全使用的字符串数组。
 */
function normalizeStringArray(value: unknown, fallback: string[], issues: string[], path: string): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} 缺失或不是数组，已回退默认值`)
    return [...fallback]
  }

  const normalized = value.filter((item): item is string => isNonEmptyString(item)).map((item) => item.trim())
  if (normalized.length === 0) {
    issues.push(`${path} 未提供有效字符串，已回退默认值`)
    return [...fallback]
  }
  return normalized
}

/**
 * 归一化共享提示词配置。
 * @param value 原始共享配置对象。
 * @param fallback 缺失时使用的默认共享配置。
 * @param issues 归一化过程中累计的问题描述。
 * @returns 返回可安全使用的共享提示词配置。
 */
function normalizeSharedPromptConfig(
  value: unknown,
  fallback: SharedPromptConfig,
  issues: string[],
): SharedPromptConfig {
  const source = isRecord(value) ? value : {}
  if (!isRecord(value)) {
    issues.push("shared 缺失或格式非法，已整体回退默认值")
  }

  const publicSpeechUserPromptTemplate = isNonEmptyString(source.publicSpeechUserPromptTemplate)
    ? source.publicSpeechUserPromptTemplate.trim()
    : fallback.publicSpeechUserPromptTemplate
  if (!isNonEmptyString(source.publicSpeechUserPromptTemplate)) {
    issues.push("shared.publicSpeechUserPromptTemplate 缺失或为空，已回退默认值")
  }

  return {
    publicSpeechUserPromptTemplate,
    mockSpeechOpeners: normalizeStringArray(source.mockSpeechOpeners, fallback.mockSpeechOpeners, issues, "shared.mockSpeechOpeners"),
  }
}

/**
 * 归一化兜底提示词配置。
 * @param value 原始兜底配置对象。
 * @param fallback 缺失时使用的默认兜底配置。
 * @param issues 归一化过程中累计的问题描述。
 * @returns 返回可安全使用的兜底提示词配置。
 */
function normalizeFallbackPromptConfig(
  value: unknown,
  fallback: FallbackPromptConfig,
  issues: string[],
): FallbackPromptConfig {
  const source = isRecord(value) ? value : {}
  if (!isRecord(value)) {
    issues.push("fallback 缺失或格式非法，已整体回退默认值")
  }

  const systemPrompt = isNonEmptyString(source.systemPrompt) ? source.systemPrompt.trim() : fallback.systemPrompt
  if (!isNonEmptyString(source.systemPrompt)) {
    issues.push("fallback.systemPrompt 缺失或为空，已回退默认值")
  }

  return {
    systemPrompt,
    mockSpeechStances: normalizeStringArray(source.mockSpeechStances, fallback.mockSpeechStances, issues, "fallback.mockSpeechStances"),
  }
}

/**
 * 归一化单个角色提示词配置。
 * @param value 原始角色配置对象。
 * @param fallback 缺失时使用的默认角色配置。
 * @param issues 归一化过程中累计的问题描述。
 * @param role 当前角色名称。
 * @returns 返回可安全使用的角色提示词配置。
 */
function normalizeRolePromptConfig(
  value: unknown,
  fallback: RolePromptConfig,
  issues: string[],
  role: Role,
): RolePromptConfig {
  const source = isRecord(value) ? value : {}
  if (!isRecord(value)) {
    issues.push(`roles.${role} 缺失或格式非法，已整体回退默认值`)
  }

  const systemPrompt = isNonEmptyString(source.systemPrompt) ? source.systemPrompt.trim() : fallback.systemPrompt
  if (!isNonEmptyString(source.systemPrompt)) {
    issues.push(`roles.${role}.systemPrompt 缺失或为空，已回退默认值`)
  }

  return {
    systemPrompt,
    mockSpeechStances: normalizeStringArray(source.mockSpeechStances, fallback.mockSpeechStances, issues, `roles.${role}.mockSpeechStances`),
  }
}

/**
 * 归一化裁判公告配置。
 * @param value 原始裁判公告对象。
 * @param fallback 缺失时使用的默认公告配置。
 * @param issues 归一化过程中累计的问题描述。
 * @returns 返回可安全使用的裁判公告配置。
 */
function normalizeModeratorAnnouncements(
  value: unknown,
  fallback: Partial<Record<ModeratorAnnouncementPhase, string>>,
  issues: string[],
): Partial<Record<ModeratorAnnouncementPhase, string>> {
  const source = isRecord(value) ? value : {}
  if (!isRecord(value)) {
    issues.push("moderator.announcements 缺失或格式非法，已整体回退默认值")
  }

  const announcements: Partial<Record<ModeratorAnnouncementPhase, string>> = {}
  for (const phase of MODERATOR_PHASE_KEYS) {
    const text = isNonEmptyString(source[phase]) ? source[phase].trim() : fallback[phase]
    if (!isNonEmptyString(source[phase]) && isNonEmptyString(fallback[phase])) {
      issues.push(`moderator.announcements.${phase} 缺失或为空，已回退默认值`)
    }
    announcements[phase] = text
  }
  return announcements
}

/**
 * 归一化裁判提示词配置。
 * @param value 原始裁判配置对象。
 * @param fallback 缺失时使用的默认裁判配置。
 * @param issues 归一化过程中累计的问题描述。
 * @returns 返回可安全使用的裁判提示词配置。
 */
function normalizeModeratorPromptConfig(
  value: unknown,
  fallback: ModeratorPromptConfig,
  issues: string[],
): ModeratorPromptConfig {
  const source = isRecord(value) ? value : {}
  if (!isRecord(value)) {
    issues.push("moderator 缺失或格式非法，已整体回退默认值")
  }

  const systemPrompt = isNonEmptyString(source.systemPrompt) ? source.systemPrompt.trim() : fallback.systemPrompt
  if (!isNonEmptyString(source.systemPrompt)) {
    issues.push("moderator.systemPrompt 缺失或为空，已回退默认值")
  }

  return {
    systemPrompt,
    announcements: normalizeModeratorAnnouncements(source.announcements, fallback.announcements, issues),
  }
}

/**
 * 将原始 JSON 配置归一化为运行时可直接使用的提示词目录。
 * @param raw 从配置文件读取到的原始 JSON 对象。
 * @returns 返回完成缺失校验和字段回退后的提示词目录与告警列表。
 */
function normalizePromptCatalog(raw: unknown): { catalog: PromptCatalog; issues: string[] } {
  const issues: string[] = []
  const source = isRecord(raw) ? raw : {}
  if (!isRecord(raw)) {
    issues.push("根节点不是对象，已整体回退到内置兜底配置")
  }

  const rolesSource = isRecord(source.roles) ? source.roles : {}
  if (!isRecord(source.roles)) {
    issues.push("roles 缺失或格式非法，已按角色分别回退默认值")
  }

  const roles = {} as Record<Role, RolePromptConfig>
  for (const role of ROLE_KEYS) {
    roles[role] = normalizeRolePromptConfig(rolesSource[role], MINIMAL_FALLBACK_PROMPTS.roles[role], issues, role)
  }

  const version = typeof source.version === "number" && Number.isFinite(source.version) ? source.version : MINIMAL_FALLBACK_PROMPTS.version
  if (!(typeof source.version === "number" && Number.isFinite(source.version))) {
    issues.push("version 缺失或非法，已回退默认值")
  }

  return {
    catalog: {
      version,
      shared: normalizeSharedPromptConfig(source.shared, MINIMAL_FALLBACK_PROMPTS.shared, issues),
      fallback: normalizeFallbackPromptConfig(source.fallback, MINIMAL_FALLBACK_PROMPTS.fallback, issues),
      moderator: normalizeModeratorPromptConfig(source.moderator, MINIMAL_FALLBACK_PROMPTS.moderator, issues),
      roles,
    },
    issues,
  }
}

/**
 * 从磁盘读取并归一化提示词配置文件。
 * @returns 成功时返回提示词目录；读取失败时返回 null。
 */
function loadFromFile(): PromptCatalog | null {
  const configPath = resolveConfigPath()
  try {
    const raw = readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(raw) as unknown
    const { catalog, issues } = normalizePromptCatalog(parsed)
    if (issues.length > 0) {
      console.warn(`[prompt-config] 配置文件 ${configPath} 存在缺失或非法字段：${issues.join("；")}`)
    }
    return catalog
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[prompt-config] 无法加载外部配置文件 ${configPath}: ${message}，将使用内置兜底值`)
    return null
  }
}

/**
 * 重新加载提示词配置，供运行时热更新与测试场景复用。
 * @returns 无返回值。
 */
export function reloadPrompts(): void {
  loadedPrompts = loadFromFile()
}

/**
 * 获取当前生效的提示词目录。
 * @returns 返回已缓存配置；若尚未加载则尝试读取文件，失败时退回内置兜底配置。
 */
function getLoadedPromptCatalog(): PromptCatalog {
  if (!loadedPrompts) {
    loadedPrompts = loadFromFile()
  }
  return loadedPrompts ?? MINIMAL_FALLBACK_PROMPTS
}

/**
 * 获取完整提示词目录，供调用方读取共享模板或调试配置状态。
 * @returns 返回完整的提示词目录对象。
 */
export function getPromptCatalog(): PromptCatalog {
  return getLoadedPromptCatalog()
}

/**
 * 获取共享提示词配置。
 * @returns 返回公开发言模板与通用开场白配置。
 */
export function getSharedPromptConfig(): SharedPromptConfig {
  return getLoadedPromptCatalog().shared
}

/**
 * 获取裁判提示词配置。
 * @returns 返回裁判系统提示词与阶段播报文案配置。
 */
export function getModeratorPromptConfig(): ModeratorPromptConfig {
  return getLoadedPromptCatalog().moderator
}

/**
 * 获取指定角色的提示词配置。
 * @param role 需要读取配置的角色。
 * @returns 返回角色配置；若角色不存在则退回兜底配置。
 */
export function getRolePromptConfig(role: Role): RolePromptConfig {
  return getLoadedPromptCatalog().roles[role] ?? getLoadedPromptCatalog().fallback
}

/**
 * 兼容旧调用方式获取提示词配置。
 * @param role 角色名或 moderator。
 * @returns 返回对应角色、裁判或兜底提示词配置。
 */
export function getPromptConfig(role: Role | "moderator"): PromptConfig {
  if (role === "moderator") {
    return getModeratorPromptConfig()
  }
  return getLoadedPromptCatalog().roles[role] ?? getLoadedPromptCatalog().fallback
}

/**
 * 使用双大括号占位符渲染提示词模板。
 * @param template 含有 {{key}} 占位符的模板字符串。
 * @param variables 用于替换模板占位符的键值对。
 * @returns 返回渲染后的字符串，缺失变量会被替换为空字符串。
 */
export function renderPromptTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key]
    return value === null || value === undefined ? "" : String(value)
  })
}

/**
 * 判断某个阶段是否支持裁判播报模板。
 * @param phase 当前游戏阶段。
 * @returns 若阶段存在于裁判公告配置集合中则返回 true。
 */
export function isModeratorAnnouncementPhase(phase: GamePhase): phase is ModeratorAnnouncementPhase {
  return MODERATOR_PHASE_KEYS.includes(phase as ModeratorAnnouncementPhase)
}
