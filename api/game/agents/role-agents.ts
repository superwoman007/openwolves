import type { Role, AIProviderConfig } from "../../../shared/game.js"
import type { AgentContext, AgentDecision, AgentEventContext, AgentSpeechContext } from "./types.js"
import { BaseRoleAgent } from "./base-role-agent.js"
import { LLMRoleAgent } from "./llm-role-agent.js"
import { CircuitBreaker } from "./llm-decision.js"

/**
 * 获取当前仍存活且不在排除列表内的座位号。
 * @param ctx 统一角色 Agent 上下文。
 * @param excludedSeats 需要排除的座位号列表。
 * @returns 返回按座位号升序排列的候选目标列表。
 */
function listAliveCandidates(ctx: AgentContext, excludedSeats: number[] = []): number[] {
  const excluded = new Set(excludedSeats)
  return ctx.game.aliveSeats.filter((seat) => !excluded.has(seat)).sort((a, b) => a - b)
}

/**
 * 从动作事件中提取目标座位号。
 * @param event 统一结构化事件。
 * @returns 返回动作中的目标座位号；若事件不包含目标则返回 undefined。
 */
function extractTargetSeat(event: AgentEventContext): number | null | undefined {
  if (event.rawEvent.t !== "action") return undefined
  const payload = event.rawEvent.payload as { targetSeat?: unknown }
  const { targetSeat } = payload
  if (typeof targetSeat === "number") return targetSeat
  if (targetSeat === null) return null
  return undefined
}

/**
 * 统计公开语境下某个座位的被怀疑程度。
 * @param ctx 统一角色 Agent 上下文。
 * @param candidates 候选座位列表。
 * @returns 返回候选座位对应的分值表，分值越高表示越值得优先处理。
 */
function buildSuspicionScores(ctx: AgentContext, candidates: number[]): Map<number, number> {
  const scoreMap = new Map<number, number>(candidates.map((seat) => [seat, 0]))

  for (const speech of ctx.timeline.speeches) {
    if (speech.visibility !== "public") continue
    if (scoreMap.has(speech.speakerSeat ?? -1)) {
      scoreMap.set(speech.speakerSeat!, (scoreMap.get(speech.speakerSeat!) ?? 0) + 1)
    }

    for (const seat of candidates) {
      if (!speech.text.includes(`${seat}号`)) continue
      if (/(狼|可疑|问题|出|投|查杀|带节奏)/.test(speech.text)) {
        scoreMap.set(seat, (scoreMap.get(seat) ?? 0) + 2)
      }
      if (/(好人|金水|不像狼|先放)/.test(speech.text)) {
        scoreMap.set(seat, (scoreMap.get(seat) ?? 0) - 1)
      }
    }
  }

  for (const event of ctx.timeline.events) {
    if (event.visibility !== "public") continue
    if (event.type !== "action") continue
    if (event.rawEvent.t !== "action") continue
    const targetSeat = extractTargetSeat(event)
    if (typeof targetSeat !== "number" || !scoreMap.has(targetSeat)) continue
    if (event.rawEvent.action === "vote") {
      scoreMap.set(targetSeat, (scoreMap.get(targetSeat) ?? 0) + 3)
    }
  }

  return scoreMap
}

/**
 * 统计狼人在夜间优先处理的威胁座位。
 * @param ctx 统一角色 Agent 上下文。
 * @param candidates 候选座位列表。
 * @returns 返回候选座位威胁分值表，分值越高表示越像关键神职或核心位。
 */
function buildThreatScores(ctx: AgentContext, candidates: number[]): Map<number, number> {
  const scoreMap = new Map<number, number>(candidates.map((seat) => [seat, 0]))

  for (const speech of ctx.timeline.speeches) {
    if (speech.visibility !== "public") continue
    const speakerSeat = speech.speakerSeat
    if (!speakerSeat || !scoreMap.has(speakerSeat)) continue

    let score = scoreMap.get(speakerSeat) ?? 0
    if (/预言家|查验|金水|查杀/.test(speech.text)) score += 6
    if (/女巫|解药|毒药/.test(speech.text)) score += 4
    if (/守卫|守护/.test(speech.text)) score += 4
    if (/猎人|开枪/.test(speech.text)) score += 3
    if (/带队|站边|投票/.test(speech.text)) score += 1
    scoreMap.set(speakerSeat, score)
  }

  return scoreMap
}

/**
 * 按分值为候选目标选择最优座位，并使用固定规则打破平局。
 * @param ctx 统一角色 Agent 上下文。
 * @param candidates 候选座位列表。
 * @param scoreMap 候选座位分值表。
 * @returns 返回最终选中的座位号；若候选为空则返回 null。
 */
function pickSeatByScore(
  ctx: AgentContext,
  candidates: number[],
  scoreMap: Map<number, number>,
): number | null {
  if (candidates.length === 0) return null
  const ordered = [...candidates].sort((a, b) => {
    const scoreDiff = (scoreMap.get(b) ?? 0) - (scoreMap.get(a) ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    const pivot = (ctx.self.seat + ctx.game.day) % 12
    const distanceA = (a - pivot + 100) % 100
    const distanceB = (b - pivot + 100) % 100
    return distanceA - distanceB
  })
  return ordered[0] ?? null
}

/**
 * 获取当前夜晚已经出现的狼人聊天记录。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回当前夜晚的狼人发言数组。
 */
function getCurrentNightWolfChats(ctx: AgentContext): AgentSpeechContext[] {
  return ctx.timeline.speeches.filter((speech) =>
    speech.visibility === "wolf" &&
    speech.phase === "night" &&
    speech.day === ctx.game.day &&
    speech.rawEvent.t === "chat_wolf"
  )
}

/**
 * 从当前狼人聊天中提取优先刀口建议。
 * @param ctx 统一角色 Agent 上下文。
 * @param candidates 合法候选目标列表。
 * @returns 返回狼队当前聊天中被提及次数最多的合法目标；若没有则返回 null。
 */
function getWolfSuggestedTarget(ctx: AgentContext, candidates: number[]): number | null {
  const tally = new Map<number, number>()
  for (const speech of getCurrentNightWolfChats(ctx)) {
    const matches = Array.from(speech.text.matchAll(/(\d+)号/g))
    for (const match of matches) {
      const seat = Number(match[1])
      if (!candidates.includes(seat)) continue
      tally.set(seat, (tally.get(seat) ?? 0) + 1)
    }
  }

  if (tally.size === 0) return null
  const scoreMap = new Map<number, number>()
  for (const seat of candidates) {
    scoreMap.set(seat, tally.get(seat) ?? 0)
  }
  return pickSeatByScore(ctx, candidates, scoreMap)
}

/**
 * 构建狼人夜间讨论消息。
 * 第一个发言的狼人提出刀口建议和白天策略；
 * 后续狼人回应前面的讨论，提供补充意见。
 */
function buildWolfChatMessage(ctx: AgentContext, target: number, existingChats: AgentSpeechContext[]): string {
  const seat = ctx.self.seat
  const variant = (seat + ctx.game.day) % 5

  // 检测是否有人跳预言家（影响策略建议）
  const seerClaimed = ctx.timeline.speeches.some(
    (s) => s.visibility === "public" && /预言家/.test(s.text)
  )

  if (existingChats.length === 0) {
    // 第一个狼人：提出刀口 + 白天策略
    if (seerClaimed) {
      const templates = [
        `建议今晚刀${target}号。有人跳预言家了，明天我们其中一个可以考虑悍跳对冲，另一个正常发言带节奏。`,
        `我觉得刀${target}号比较好，这个位置威胁大。明天白天注意别同时踩同一个人，分散一下火力。`,
        `优先刀${target}号，像是关键神职。预言家已经跳了，明天我们要想办法把票引到真预言家身上。`,
        `${target}号必须处理，预言家跳了对我们压力很大。明天我先质疑预言家的查验逻辑，你配合就行。`,
        `刀${target}号，然后明天我来悍跳预言家，你帮我站边。如果不行就正常混。`,
      ]
      return templates[variant]!
    }
    const templates = [
      `建议优先刀${target}号，这个位置发言有带队感，像是核心好人位。明天我们分开站边，别暴露同伴关系。`,
      `我觉得${target}号威胁最大，建议今晚处理。白天我们一个踩一个保，制造分歧。`,
      `刀${target}号吧，这个位置如果是神职会很麻烦。明天注意控制发言节奏，别太早暴露。`,
      `${target}号发言太有逻辑了，留着对我们不利。明天我来带一波节奏踩别人，你低调跟票。`,
      `今晚刀${target}号，这个位置不处理后面会很难打。白天我们错开发言方向，别让人看出关联。`,
    ]
    return templates[variant]!
  }

  // 后续狼人：回应讨论
  const lastChat = existingChats[existingChats.length - 1]!
  const suggestedInChat = Array.from(lastChat.text.matchAll(/(\d+)号/g)).map((m) => Number(m[1]))
  const agreedTarget = suggestedInChat.find((s) => ctx.game.aliveSeats.includes(s) && s !== seat)

  if (agreedTarget && agreedTarget === target) {
    const agreeTemplates = [
      `同意刀${target}号。明天我来踩另一个位置分散注意力，你正常发言就好。`,
      `可以，${target}号确实该处理。白天我会找机会帮你洗一下，注意别被抱团。`,
      `没问题，就${target}号。明天我先发言带一下节奏，你后面跟上配合。`,
      `赞同，${target}号不能留。我明天找个好人位踩一下，把火力引开。`,
      `OK，统一刀${target}号。白天我们各自发挥，关键时刻再互相配合票型。`,
    ]
    return agreeTemplates[variant]!
  }

  // 有不同意见时
  const altTemplates = [
    `我理解你的想法，但我觉得${target}号更危险。不过你定吧，我配合。白天我来处理舆论。`,
    `${target}号也是个选择。我们先统一刀口，明天白天的事再临场应变。`,
    `都行，听你的也可以。关键是明天别同时暴露，我会注意控制发言方向。`,
    `我倾向${target}号，但如果你坚持的话我跟你。重要的是白天别互相踩。`,
    `两个目标都有道理，最终听你的。明天我负责把水搅浑，你稳住就好。`,
  ]
  return altTemplates[variant]!
}

/**
 * 选择白天优先处理的可疑目标。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回投票目标；若不存在合法候选则返回 null。
 */
function pickVoteTarget(ctx: AgentContext): number | null {
  const candidates = listAliveCandidates(ctx, [ctx.self.seat])
  if (candidates.length === 0) return null

  const pkCandidates = ctx.memory.role.pkCandidates as number[] | undefined
  const restrictedCandidates = pkCandidates && pkCandidates.length > 0
    ? candidates.filter((seat) => pkCandidates.includes(seat))
    : candidates
  if (restrictedCandidates.length === 0) return null

  if (ctx.self.role === "seer") {
    const checks = ctx.memory.role.seerChecks as Array<{ target: number; isWolf: boolean }> | undefined
    const aliveWolf = checks?.find((item) => item.isWolf && restrictedCandidates.includes(item.target))
    if (aliveWolf) return aliveWolf.target
  }

  let filteredCandidates = restrictedCandidates
  if (ctx.self.role === "werewolf") {
    const wolves = new Set(ctx.knowledge.wolfTeammates ?? [])
    wolves.add(ctx.self.seat)
    const nonWolfCandidates = restrictedCandidates.filter((seat) => !wolves.has(seat))
    if (nonWolfCandidates.length > 0) {
      filteredCandidates = nonWolfCandidates
    }

    // Vote-splitting: non-alpha wolves vote a different target to avoid pattern detection
    if (wolves.size > 1) {
      const aliveWolves = ctx.game.aliveSeats.filter((s) => wolves.has(s)).sort((a, b) => a - b)
      const isAlpha = ctx.self.seat === aliveWolves[0]
      if (!isAlpha && filteredCandidates.length > 1) {
        const scoreMap = buildSuspicionScores(ctx, filteredCandidates)
        const sorted = [...filteredCandidates].sort((a, b) => (scoreMap.get(b) ?? 0) - (scoreMap.get(a) ?? 0))
        // Pick second-highest target
        return sorted[1] ?? sorted[0]!
      }
    }
  }

  const scoreMap = buildSuspicionScores(ctx, filteredCandidates)
  return pickSeatByScore(ctx, filteredCandidates, scoreMap)
}

/**
 * 为狼人挑选夜晚击杀目标。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回优先击杀的目标座位号；若不存在合法目标则返回 null。
 */
function pickWerewolfKillTarget(ctx: AgentContext): number | null {
  const wolves = new Set(ctx.knowledge.wolfTeammates ?? [])
  wolves.add(ctx.self.seat)
  const candidates = listAliveCandidates(ctx).filter((seat) => !wolves.has(seat))
  if (candidates.length === 0) return null

  const wolfSuggestedTarget = getWolfSuggestedTarget(ctx, candidates)
  if (wolfSuggestedTarget !== null) return wolfSuggestedTarget

  const threatScores = buildThreatScores(ctx, candidates)
  const suspicionScores = buildSuspicionScores(ctx, candidates)
  const mergedScores = new Map<number, number>()
  for (const seat of candidates) {
    mergedScores.set(seat, (threatScores.get(seat) ?? 0) * 2 + (suspicionScores.get(seat) ?? 0))
  }
  return pickSeatByScore(ctx, candidates, mergedScores)
}

/**
 * 为预言家选择夜间查验目标。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回优先查验的目标座位号；若不存在合法目标则返回 null。
 */
function pickSeerCheckTarget(ctx: AgentContext): number | null {
  const checkedSeats = new Set(
    ((ctx.memory.role.seerChecks as Array<{ target: number; isWolf: boolean }> | undefined) ?? [])
      .map((item) => item.target),
  )
  const uncheckedCandidates = listAliveCandidates(ctx, [ctx.self.seat]).filter((seat) => !checkedSeats.has(seat))
  const candidates = uncheckedCandidates.length > 0
    ? uncheckedCandidates
    : listAliveCandidates(ctx, [ctx.self.seat])
  const threatScores = buildThreatScores(ctx, candidates)
  const suspicionScores = buildSuspicionScores(ctx, candidates)
  const mergedScores = new Map<number, number>()
  for (const seat of candidates) {
    mergedScores.set(seat, (threatScores.get(seat) ?? 0) + (suspicionScores.get(seat) ?? 0))
  }
  return pickSeatByScore(ctx, candidates, mergedScores)
}

/**
 * 为守卫选择夜间守护目标。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回本夜守护目标；若不存在合法目标则回退为自己。
 */
function pickGuardTarget(ctx: AgentContext): number {
  const lastGuardTarget = ctx.privateState.lastGuardTarget ?? null
  const candidates = listAliveCandidates(ctx).filter((seat) => seat !== lastGuardTarget)
  const validCandidates = candidates.length > 0 ? candidates : listAliveCandidates(ctx)
  const threatScores = buildThreatScores(ctx, validCandidates)
  for (const seat of validCandidates) {
    if (seat === ctx.self.seat) {
      threatScores.set(seat, (threatScores.get(seat) ?? 0) + 1)
    }
  }
  return pickSeatByScore(ctx, validCandidates, threatScores) ?? ctx.self.seat
}

/**
 * 判断女巫是否应当使用解药。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回解药目标座位号；若决定不救则返回 null。
 */
function pickAntidoteTarget(ctx: AgentContext): number | null {
  const victimSeat = ctx.privateState.wolfVictimSeat ?? null
  if (victimSeat === null) return null

  // 自救：无条件
  if (victimSeat === ctx.self.seat) return victimSeat
  // 首夜必救（常见规则：第一晚无条件使用解药）
  if (ctx.game.day === 1) return victimSeat
  // 残局必救（<=4人时每条命都关键）
  if (ctx.game.aliveSeats.length <= 4) return victimSeat

  // 中后期：根据怀疑度决定是否救
  const suspicionScores = buildSuspicionScores(ctx, [victimSeat])
  const victimSuspicion = suspicionScores.get(victimSeat) ?? 0
  // 如果被刀的人被高度怀疑（可能是狼自刀），不救
  if (victimSuspicion >= 4) return null

  const threatScores = buildThreatScores(ctx, [victimSeat])
  const victimThreat = threatScores.get(victimSeat) ?? 0
  // 高威胁值（像神职）优先救
  if (victimThreat >= 4) return victimSeat

  // 默认不救（保留解药到关键时刻）
  return null
}

/**
 * 判断女巫是否应当使用毒药。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回毒药目标座位号；若决定不毒则返回 null。
 */
function pickPoisonTarget(ctx: AgentContext): number | null {
  const candidates = listAliveCandidates(ctx, [ctx.self.seat, ctx.privateState.wolfVictimSeat ?? -1])
  if (candidates.length === 0) return null
  const suspicionScores = buildSuspicionScores(ctx, candidates)
  const target = pickSeatByScore(ctx, candidates, suspicionScores)
  // Dynamic threshold: lower in late game (fewer alive = more info, more urgency)
  const aliveCount = ctx.game.aliveSeats.length
  const threshold = aliveCount <= 5 ? 2 : aliveCount <= 8 ? 3 : 5
  return target !== null && (suspicionScores.get(target) ?? 0) >= threshold ? target : null
}

/**
 * 判断猎人濒死时是否应当开枪。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回开枪目标座位号；若决定不开枪则返回 null。
 */
function pickHunterShotTarget(ctx: AgentContext): number | null {
  const candidates = listAliveCandidates(ctx, [ctx.self.seat])
  if (candidates.length === 0) return null
  const suspicionScores = buildSuspicionScores(ctx, candidates)
  const target = pickSeatByScore(ctx, candidates, suspicionScores)
  // Hunter should almost always shoot — only skip if no candidates exist
  return target ?? candidates[0]!
}

/**
 * 为当前角色生成上下文感知的白天发言。
 * 使用 seat + day 作为确定性选择器，保证不同座位/天数产生不同发言。
 * @param ctx 统一角色 Agent 上下文。
 * @returns 返回适合当前角色与局势的中文公开发言文本。
 */
/**
 * 判断狼人是否应该悍跳预言家。
 * 条件：有人跳预言家查杀了队友 / 有人跳预言家查杀了自己。
 */
function shouldWolfFakeClaim(ctx: AgentContext): boolean {
  const wolves = new Set(ctx.knowledge.wolfTeammates ?? [])
  wolves.add(ctx.self.seat)

  for (const speech of ctx.timeline.speeches) {
    if (speech.visibility !== "public") continue
    if (speech.speakerSeat === ctx.self.seat) continue
    // 检测有人跳预言家
    if (!/预言家/.test(speech.text)) continue
    // 检测查杀了队友或自己
    for (const wolfSeat of wolves) {
      if (speech.text.includes(`${wolfSeat}号`) && /查杀/.test(speech.text)) {
        return true
      }
    }
    // 检测自己被推且有人跳预言家指认自己
    if (speech.text.includes(`${ctx.self.seat}号`) && /(查杀|是狼)/.test(speech.text)) {
      return true
    }
  }
  return false
}

/**
 * 构建狼人悍跳预言家的发言。
 */
function buildWolfFakeClaimSpeech(ctx: AgentContext): string {
  const seat = ctx.self.seat
  const wolves = new Set(ctx.knowledge.wolfTeammates ?? [])
  wolves.add(ctx.self.seat)
  const variant = (seat + ctx.game.day) % 3

  // 找到跳预言家的人
  let claimedSeerSeat: number | undefined
  for (const speech of ctx.timeline.speeches) {
    if (speech.visibility !== "public") continue
    if (/预言家/.test(speech.text) && speech.speakerSeat !== ctx.self.seat) {
      claimedSeerSeat = speech.speakerSeat
      break
    }
  }

  // 找一个非队友的存活目标作为"查杀"对象
  const fakeTarget = claimedSeerSeat
    ?? ctx.game.aliveSeats.find((s) => !wolves.has(s) && s !== ctx.self.seat)
    ?? ctx.game.aliveSeats[0]!

  const templates = [
    `我是${seat}号，真正的预言家。${fakeTarget}号才是我的查杀。对面那个是假预言家，请大家注意辨别。`,
    `${seat}号预言家亮身份。我的查验结果：${fakeTarget}号是狼。刚才跳的那位是悍跳狼，大家别被带偏。`,
    `我是${seat}号预言家，昨晚查杀${fakeTarget}号。对面在悍跳想保队友，请好人站我这边。`,
  ]
  return templates[variant]!
}

/**
 * 判断预言家是否应该跳身份。
 * 条件：有查杀结果 / 残局（<=5人）/ 自己被推（高怀疑度）。
 */
function shouldSeerClaim(ctx: AgentContext): boolean {
  const seerChecks = (ctx.memory.role.seerChecks as Array<{ target: number; isWolf: boolean }> | undefined) ?? []
  // 有查杀必跳
  if (seerChecks.some((item) => item.isWolf && ctx.game.aliveSeats.includes(item.target))) return true
  // 残局跳身份提供信息
  if (ctx.game.aliveSeats.length <= 5 && seerChecks.length > 0) return true
  // 被推时跳身份自保
  if (isSelfBeingPushed(ctx)) return true
  return false
}

/**
 * 判断自己是否正在被场上多人怀疑/推票。
 */
function isSelfBeingPushed(ctx: AgentContext): boolean {
  let pushCount = 0
  for (const speech of ctx.timeline.speeches) {
    if (speech.visibility !== "public") continue
    if (speech.speakerSeat === ctx.self.seat) continue
    if (speech.text.includes(`${ctx.self.seat}号`) && /(狼|可疑|问题|出|投)/.test(speech.text)) {
      pushCount++
    }
  }
  return pushCount >= 2
}

/**
 * 构建预言家跳身份时的发言。
 */
function buildSeerClaimSpeech(ctx: AgentContext): string {
  const seat = ctx.self.seat
  const seerChecks = (ctx.memory.role.seerChecks as Array<{ target: number; isWolf: boolean }> | undefined) ?? []
  const aliveWolfCheck = seerChecks.find((item) => item.isWolf && ctx.game.aliveSeats.includes(item.target))
  const goodChecks = seerChecks.filter((item) => !item.isWolf)
  const variant = (seat + ctx.game.day) % 3

  if (aliveWolfCheck) {
    const templates = [
      `我是${seat}号预言家，昨晚查杀${aliveWolfCheck.target}号。请大家今天归票出他。`,
      `我是${seat}号，预言家。${aliveWolfCheck.target}号是查杀，铁狼无疑。所有好人跟我票。`,
      `${seat}号预言家亮身份。查验结果：${aliveWolfCheck.target}号是狼。今天必须出这个位置。`,
    ]
    return templates[variant]!
  }

  // 残局或被推时，报金水信息
  const goodCheckStr = goodChecks.map((c) => `${c.target}号金水`).join("、")
  if (isSelfBeingPushed(ctx)) {
    return `我是${seat}号预言家，别急着推我。我的查验信息：${goodCheckStr || "暂无关键结果"}。请给我时间继续验人。`
  }
  return `我是${seat}号预言家，目前查验结果：${goodCheckStr || "暂无查杀"}。局势紧张我选择亮身份，请好人保护我。`
}

function buildPublicSpeech(ctx: AgentContext): string {
  const voteTarget = pickVoteTarget(ctx)
  const targetText = voteTarget ? `${voteTarget}号` : "场上最摇摆的位置"
  const seerChecks = (ctx.memory.role.seerChecks as Array<{ target: number; isWolf: boolean }> | undefined) ?? []
  const aliveWolfCheck = seerChecks.find((item) => item.isWolf && ctx.game.aliveSeats.includes(item.target))
  const aliveGoodCheck = seerChecks.find((item) => !item.isWolf && ctx.game.aliveSeats.includes(item.target))
  const seat = ctx.self.seat
  const variant = (seat + ctx.game.day) % 3

  switch (ctx.self.role) {
    case "werewolf": {
      if (shouldWolfFakeClaim(ctx)) {
        return buildWolfFakeClaimSpeech(ctx)
      }
      const templates = [
        `我是${seat}号，今天我先点${targetText}。这个位置发言和票型都不太舒服，建议先从这里压轮次。`,
        `我是${seat}号，${targetText}的逻辑链有断裂，我倾向今天先处理这个位置。大家怎么看？`,
        `我是${seat}号，综合前几轮信息，${targetText}站边一直很飘。今天不出他我怕后面更难推。`,
      ]
      return templates[variant]!
    }
    case "seer":
      if (shouldSeerClaim(ctx)) {
        return buildSeerClaimSpeech(ctx)
      }
      if (aliveGoodCheck) {
        return `我是${seat}号，${aliveGoodCheck.target}号我暂时不进狼坑。今天我更想听${targetText}把逻辑盘清楚。`
      }
      return `我是${seat}号，我会继续从发言和票型里找狼。当前我更怀疑${targetText}。`
    case "witch":
      if (ctx.privateState.wolfVictimSeat && ctx.privateState.wolfVictimSeat !== voteTarget) {
        return `我是${seat}号，今天别急着把${ctx.privateState.wolfVictimSeat}号推上去。相较之下，${targetText}更像在带偏节奏。`
      }
      return `我是${seat}号，我先看${targetText}。这个位置今天的站边和发言都需要补解释。`
    case "guard": {
      const guardTemplates = [
        `我是${seat}号，今天先根据发言和死亡信息找狼。当前我更想听${targetText}。`,
        `我是${seat}号，刀口信息很关键。我觉得${targetText}需要给个解释，不然今天先出这里。`,
        `我是${seat}号，我会重点看票型和站边。${targetText}今天的表态让我不太舒服。`,
      ]
      if (ctx.privateState.lastGuardTarget) {
        return `我是${seat}号，我会重点看刀口和票型。${ctx.privateState.lastGuardTarget}号这轮先别轻易扛推，我更想听${targetText}。`
      }
      return guardTemplates[variant]!
    }
    case "hunter": {
      const hunterTemplates = [
        `我是${seat}号，我不想把轮次浪费在空转上。今天我倾向先出${targetText}，理由是这个位置最像在躲票型。`,
        `我是${seat}号，${targetText}今天必须给个说法。不然我这票就归过去了。`,
        `我是${seat}号，场上信息够多了。${targetText}的逻辑和行为对不上，今天先处理。`,
      ]
      return hunterTemplates[variant]!
    }
    case "villager": {
      const villagerTemplates = [
        `我是${seat}号村民，信息不多但我先点${targetText}。这个位置前后发言和投票倾向对不上。`,
        `我是${seat}号，作为村民我只能靠逻辑。${targetText}今天的站边让我觉得有问题。`,
        `我是${seat}号，我没有特殊信息，但从发言来看${targetText}最可疑。建议大家关注一下。`,
      ]
      return villagerTemplates[variant]!
    }
    default:
      return `我是${seat}号，我先听场上发言。`
  }
}

export class WerewolfAgent extends BaseRoleAgent {
  /**
   * 为狼人生成夜晚击杀、白天发言与投票决策。
   * @param ctx 统一角色 Agent 上下文。
   * @returns 返回狼人当前阶段的结构化动作；无需行动时返回 null。
   */
  async decide(ctx: AgentContext): Promise<AgentDecision | null> {
    if (ctx.game.phase === "night") {
      const teammates = ctx.knowledge.wolfTeammates ?? []
      const wolfChats = getCurrentNightWolfChats(ctx)
      const hasSelfChatted = wolfChats.some((speech) => speech.speakerSeat === ctx.self.seat)
      const target = pickWerewolfKillTarget(ctx)
      if (!hasSelfChatted && teammates.length > 0 && target !== null) {
        const text = buildWolfChatMessage(ctx, target, wolfChats)
        return {
          action: { t: "chat_wolf", text },
        }
      }
      if (target === null) return null
      return { action: { t: "wolf_kill", targetSeat: target } }
    }
    if (ctx.game.phase === "day_speech") {
      return { action: { t: "chat_public", text: buildPublicSpeech(ctx) } }
    }
    if (ctx.game.phase === "day_vote" || ctx.game.phase === "day_vote_pk") {
      return { action: { t: "vote", targetSeat: pickVoteTarget(ctx) } }
    }
    return null
  }
}

export class SeerAgent extends BaseRoleAgent {
  /**
   * 为预言家生成查验、白天发言与投票决策。
   * @param ctx 统一角色 Agent 上下文。
   * @returns 返回预言家当前阶段的结构化动作；无需行动时返回 null。
   */
  async decide(ctx: AgentContext): Promise<AgentDecision | null> {
    if (ctx.game.phase === "night") {
      const target = pickSeerCheckTarget(ctx)
      if (target === null) return null
      return { action: { t: "seer_check", targetSeat: target } }
    }
    if (ctx.game.phase === "day_speech") {
      return { action: { t: "chat_public", text: buildPublicSpeech(ctx) } }
    }
    if (ctx.game.phase === "day_vote" || ctx.game.phase === "day_vote_pk") {
      return { action: { t: "vote", targetSeat: pickVoteTarget(ctx) } }
    }
    return null
  }
}

export class WitchAgent extends BaseRoleAgent {
  /**
   * 为女巫生成解药、毒药、白天发言与投票决策。
   * @param ctx 统一角色 Agent 上下文。
   * @returns 返回女巫当前阶段的结构化动作；无需行动时返回 null。
   */
  async decide(ctx: AgentContext): Promise<AgentDecision | null> {
    if (ctx.game.phase === "night") {
      const hints = ctx.privateState
      if (!hints?.witchAntidoteUsed) {
        const target = pickAntidoteTarget(ctx)
        return { action: { t: "witch_antidote", targetSeat: target } }
      }
      if (!hints?.witchPoisonUsed) {
        const target = pickPoisonTarget(ctx)
        return { action: { t: "witch_poison", targetSeat: target } }
      }
    }
    if (ctx.game.phase === "day_speech") {
      return { action: { t: "chat_public", text: buildPublicSpeech(ctx) } }
    }
    if (ctx.game.phase === "day_vote" || ctx.game.phase === "day_vote_pk") {
      return { action: { t: "vote", targetSeat: pickVoteTarget(ctx) } }
    }
    return null
  }
}

export class GuardAgent extends BaseRoleAgent {
  /**
   * 为守卫生成守护、白天发言与投票决策。
   * @param ctx 统一角色 Agent 上下文。
   * @returns 返回守卫当前阶段的结构化动作；无需行动时返回 null。
   */
  async decide(ctx: AgentContext): Promise<AgentDecision | null> {
    if (ctx.game.phase === "night") {
      const target = pickGuardTarget(ctx)
      return { action: { t: "guard_protect", targetSeat: target } }
    }
    if (ctx.game.phase === "day_speech") {
      return { action: { t: "chat_public", text: buildPublicSpeech(ctx) } }
    }
    if (ctx.game.phase === "day_vote" || ctx.game.phase === "day_vote_pk") {
      return { action: { t: "vote", targetSeat: pickVoteTarget(ctx) } }
    }
    return null
  }
}

export class HunterAgent extends BaseRoleAgent {
  /**
   * 为猎人生成濒死开枪、白天发言与投票决策。
   * @param ctx 统一角色 Agent 上下文。
   * @returns 返回猎人当前阶段的结构化动作；无需行动时返回 null。
   */
  async decide(ctx: AgentContext): Promise<AgentDecision | null> {
    if (ctx.game.phase === "resolve") {
      const target = pickHunterShotTarget(ctx)
      return { action: { t: "hunter_shoot", targetSeat: target } }
    }
    if (ctx.game.phase === "day_speech") {
      return { action: { t: "chat_public", text: buildPublicSpeech(ctx) } }
    }
    if (ctx.game.phase === "day_vote" || ctx.game.phase === "day_vote_pk") {
      return { action: { t: "vote", targetSeat: pickVoteTarget(ctx) } }
    }
    return null
  }
}

export class VillagerAgent extends BaseRoleAgent {
  /**
   * 为村民生成白天发言与投票决策。
   * @param ctx 统一角色 Agent 上下文。
   * @returns 返回村民当前阶段的结构化动作；无需行动时返回 null。
   */
  async decide(ctx: AgentContext): Promise<AgentDecision | null> {
    if (ctx.game.phase === "day_speech") {
      return { action: { t: "chat_public", text: buildPublicSpeech(ctx) } }
    }
    if (ctx.game.phase === "day_vote" || ctx.game.phase === "day_vote_pk") {
      return { action: { t: "vote", targetSeat: pickVoteTarget(ctx) } }
    }
    return null
  }
}

/**
 * 为被放逐的玩家生成遗言。
 * 根据角色不同，遗言内容策略不同：
 * - 预言家：公布查验结果
 * - 狼人：误导方向，不暴露队友
 * - 女巫：透露药物使用信息
 * - 村民/守卫：给出最终判断
 */
export function buildLastWordsSpeech(ctx: AgentContext): string {
  const seat = ctx.self.seat
  const variant = (seat + (ctx.game.day ?? 1)) % 3
  const seerChecks = (ctx.memory.role.seerChecks as Array<{ target: number; isWolf: boolean }> | undefined) ?? []

  switch (ctx.self.role) {
    case "seer": {
      // 预言家遗言：公布所有查验结果
      const wolfChecks = seerChecks.filter((c) => c.isWolf)
      const goodChecks = seerChecks.filter((c) => !c.isWolf)
      const parts: string[] = [`我是真预言家。`]
      if (wolfChecks.length > 0) {
        parts.push(`查杀：${wolfChecks.map((c) => `${c.target}号`).join("、")}是狼！`)
      }
      if (goodChecks.length > 0) {
        parts.push(`金水：${goodChecks.map((c) => `${c.target}号`).join("、")}是好人。`)
      }
      if (seerChecks.length === 0) {
        parts.push(`我还没来得及验出有用信息，大家注意场上逻辑。`)
      }
      return parts.join("")
    }
    case "werewolf": {
      // 狼人遗言：误导方向，不暴露队友
      const teammates = new Set(ctx.knowledge.wolfTeammates ?? [])
      const innocentTargets = ctx.game.aliveSeats.filter((s) => s !== seat && !teammates.has(s))
      const fakeTarget = innocentTargets.length > 0 ? innocentTargets[variant % innocentTargets.length] : ctx.game.aliveSeats[0]
      const templates = [
        `我走了，但我觉得${fakeTarget}号不对。大家注意他的票型和站边。`,
        `我是好人，被冤了。${fakeTarget}号的逻辑一直有问题，希望大家重新审视。`,
        `我没什么好说的，但${fakeTarget}号绝对不干净。后面的人注意。`,
      ]
      return templates[variant]!
    }
    case "witch": {
      // 女巫遗言：透露药物使用信息
      const templates = [
        `我是女巫。${ctx.privateState.witchPoisonUsed ? "毒药已经用了。" : "毒药还在。"}大家注意保护好关键角色。`,
        `女巫遗言：${ctx.privateState.witchAntidoteUsed ? "解药用过了" : "解药还在"}，${ctx.privateState.witchPoisonUsed ? "毒药用过了" : "毒药还在"}。后面的人小心。`,
        `我是女巫，走之前提醒大家注意场上的票型变化。`,
      ]
      return templates[variant]!
    }
    case "guard": {
      const templates = [
        `我是守卫。大家注意保护好预言家位置。`,
        `守卫遗言：后面的夜晚没人守了，大家白天一定要把狼推出去。`,
        `我是守卫，走了。注意场上谁在带节奏。`,
      ]
      return templates[variant]!
    }
    default: {
      // 村民或其他角色
      const suspectSeat = ctx.game.aliveSeats.filter((s) => s !== seat)[variant % Math.max(1, ctx.game.aliveSeats.length - 1)]
      const templates = [
        `我是好人。我觉得${suspectSeat}号有问题，希望大家关注。`,
        `被冤了。我走之前想说，${suspectSeat}号的发言逻辑不通，大家注意。`,
        `我没什么好说的，但场上的狼还没出完。大家加油。`,
      ]
      return templates[variant]!
    }
  }
}

/**
 * 根据座位角色创建对应的角色 Agent 实例。
 * 非 mock 的 AI 配置会创建 LLM 驱动的 Agent，否则使用启发式 Agent。
 * @param seat 座位号。
 * @param role 该座位分配到的角色。
 * @param aiConfig AI 提供商配置。
 * @param seed 游戏种子，用于性格分配。
 * @returns 返回对应角色的 Agent 实例。
 */
export function createRoleAgent(seat: number, role: Role, aiConfig?: AIProviderConfig, seed?: string, circuitBreakerMap?: Map<number, number>): BaseRoleAgent {
  // Use LLM agent for non-mock providers
  if (aiConfig && aiConfig.provider !== "mock") {
    const cb = circuitBreakerMap ? new CircuitBreaker(3, circuitBreakerMap) : undefined
    return new LLMRoleAgent(seat, role, aiConfig, seed ?? "default", cb)
  }

  switch (role) {
    case "werewolf":
      return new WerewolfAgent(seat, role)
    case "seer":
      return new SeerAgent(seat, role)
    case "witch":
      return new WitchAgent(seat, role)
    case "guard":
      return new GuardAgent(seat, role)
    case "hunter":
      return new HunterAgent(seat, role)
    case "villager":
      return new VillagerAgent(seat, role)
    default:
      throw new Error(`Unknown role: ${role}`)
  }
}
