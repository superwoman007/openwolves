import type { HumanAction, Role } from "../../shared/game.js"
import { submitAction, advance } from "./engine.js"
import { aliveSeatNumbers, type GameRuntime } from "./model.js"
import { openaiCompatChat } from "../llm/openaiCompatible.js"
import { buildAiContext } from "./ai-context.js"

export const runAuto = async (g: GameRuntime): Promise<boolean> => {
  let steps = 0
  while (steps < 200) {
    steps += 1
    const progressed = await runOnce(g)
    if (!progressed) return true
  }
  return true
}

const runOnce = async (g: GameRuntime) => {
  if (g.phase === "night") {
    return runNight(g)
  }
  if (g.phase === "day_speech") {
    return await runDaySpeech(g)
  }
  if (g.phase === "day_vote") {
    return runDayVote(g)
  }
  if (g.phase === "resolve") {
    return runHunter(g)
  }
  return false
}

const runNight = (g: GameRuntime) => {
  const beforePhase = g.phase
  const beforeStage = g.night?.stage ?? "collect"

  const aliveAiSeats = g.seats.filter((s) => s.alive && s.kind === "ai" && s.role)

  if ((g.night?.stage ?? "collect") === "collect") {
    for (const s of aliveAiSeats) {
      if (s.role === "werewolf") {
        const has = g.night?.wolfVotes.has(s.seat) ?? false
        if (!has) {
          submitAction(g, s.seat, { t: "wolf_kill", targetSeat: pickWolfKillTarget(g) })
          return true
        }
      }
      if (s.role === "seer") {
        const has = g.night?.seerChecks.has(s.seat) ?? false
        if (!has) {
          submitAction(g, s.seat, { t: "seer_check", targetSeat: pickRandomAliveOther(g, s.seat) })
          return true
        }
      }
      if (s.role === "guard") {
        const has = g.night?.guardProtects.has(s.seat) ?? false
        if (!has) {
          submitAction(g, s.seat, { t: "guard_protect", targetSeat: pickRandomAlive(g) })
          return true
        }
      }
    }
  }

  if (g.night?.stage === "witch") {
    const witchSeat = aliveAiSeats.find((s) => s.role === "witch")
    if (witchSeat) {
      const w = g.night.witch
      const antidoteDecided = w?.antidoteDecided ?? witchSeat.hand.witchAntidoteUsed
      const poisonDecided = w?.poisonDecided ?? witchSeat.hand.witchPoisonUsed

      if (!antidoteDecided) {
        const targetSeat = decideAntidote(g)
        submitAction(g, witchSeat.seat, { t: "witch_antidote", targetSeat })
        return true
      }
      if (!poisonDecided) {
        const targetSeat = decidePoison(g, witchSeat.seat)
        submitAction(g, witchSeat.seat, { t: "witch_poison", targetSeat })
        return true
      }
    } else {
      return false
    }
  }

  return beforePhase !== g.phase || beforeStage !== (g.night?.stage ?? "collect")
}

const runDaySpeech = async (g: GameRuntime) => {
  const aliveHumans = g.seats.some((s) => s.alive && s.kind === "human")
  g.dayState = g.dayState ?? { votes: new Map(), spoken: new Set() }

  const allowedSpeakers = g.dayState.pkCandidates ?? g.seats.filter((s) => s.alive).map((s) => s.seat)

  for (const s of g.seats) {
    if (!s.alive || s.kind !== "ai" || !s.role) continue
    if (g.dayState.spoken.has(s.seat)) continue
    if (!allowedSpeakers.includes(s.seat)) continue
    const text = await generateSpeech(g, s.seat, s.role)
    submitAction(g, s.seat, { t: "chat_public", text })
    return true
  }

  if (!aliveHumans) {
    const alive = aliveSeatNumbers(g)
    const speakers = g.dayState.pkCandidates ?? alive
    const allSpoken = speakers.every((seat) => g.dayState!.spoken.has(seat))
    if (allSpoken) {
      advance(g)
      return true
    }
  }

  return false
}

const runDayVote = (g: GameRuntime) => {
  g.dayState = g.dayState ?? { votes: new Map(), spoken: new Set() }

  for (const s of g.seats) {
    if (!s.alive || s.kind !== "ai" || !s.role) continue
    if (g.dayState.votes.has(s.seat)) continue
    const targetSeat = decideVote(g, s.seat)
    submitAction(g, s.seat, { t: "vote", targetSeat })
    return true
  }

  return false
}

const decideVote = (g: GameRuntime, selfSeat: number) => {
  const alive = aliveSeatNumbers(g).filter((s) => s !== selfSeat)
  if (alive.length === 0) return null

  // PK 阶段只能从候选人中投
  if (g.dayState?.pkCandidates) {
    const candidates = g.dayState.pkCandidates.filter((s) => s !== selfSeat && alive.includes(s))
    if (candidates.length === 0) return null
    return g.rng.pick(candidates)
  }

  // 预言家优先投验出的狼人
  const self = g.seats.find((s) => s.seat === selfSeat)
  if (self?.role === "seer") {
    for (const e of g.events) {
      if (e.t === "action" && e.action === "seer_check" && e.seat === selfSeat) {
        const target = (e.payload as any)?.targetSeat
        const targetRole = g.seats.find((x) => x.seat === target)?.role
        if (targetRole === "werewolf" && alive.includes(target)) {
          return target
        }
      }
    }
  }

  // 狼人避免投队友
  if (self?.role === "werewolf") {
    const wolves = new Set(g.seats.filter((s) => s.alive && s.role === "werewolf").map((s) => s.seat))
    const nonWolves = alive.filter((s) => !wolves.has(s))
    if (nonWolves.length > 0) return g.rng.pick(nonWolves)
  }

  return g.rng.pick(alive)
}

const ROLE_SYSTEM_PROMPTS: Record<Role, string> = {
  werewolf:
    "你是狼人阵营。你的目标是帮助狼人获胜。白天必须在公开频道发言，绝对不能暴露自己是狼人。你可以假装自己是村民或神职，带节奏踩人、保护狼队友。发言要有逻辑，1-2句中文。",
  seer:
    "你是预言家，每晚可以查验一人身份。白天应该尽量报出验人结果，帮助好人阵营找出狼人。但要注意保护自己，因为狼人会优先刀你。发言要有逻辑，1-2句中文。",
  witch:
    "你是女巫，有一瓶解药和一瓶毒药。夜晚知道被刀的人（狼人刀的目标）。白天要谨慎发言，不要暴露自己是女巫。发言要有逻辑，1-2句中文。",
  hunter:
    "你是猎人，被放逐或被狼刀后可以开枪带走一人。白天可以适当强硬表水，但不要过于激进以免被当作狼。发言要有逻辑，1-2句中文。",
  guard:
    "你是守卫，每晚可以守护一人（不能连续守护同一人）。白天要根据死亡信息分析刀型，保护关键好人。发言要有逻辑，1-2句中文。",
  villager:
    "你是村民，没有特殊技能。你的任务是通过发言和投票找出狼人。多听多看，找逻辑漏洞。发言要有逻辑，1-2句中文。",
}

const generateSpeech = async (g: GameRuntime, seat: number, role: Role) => {
  const day = g.day
  const seatCfg = g.seats.find((s) => s.seat === seat)

  // 为每个角色构建专属记忆
  const memory = buildRoleMemory(g, seat, role)

  const ai = seatCfg?.ai
  const isRealProvider = ai && ai.provider !== "mock"
  if (isRealProvider && (ai.apiKey || process.env.OPENAI_API_KEY)) {
    g.thinkingSeats.add(seat)
    g.onThinkingChange?.()
    try {
      const ctx = buildAiContext(g, seat)
      const ctxJson = JSON.stringify(ctx, (_k, v) => {
        if (v instanceof Map) return Object.fromEntries(v)
        if (v instanceof Set) return Array.from(v)
        return v
      })
      const systemPrompt = ROLE_SYSTEM_PROMPTS[role]
      const userPrompt = `游戏上下文（脱敏处理）：${ctxJson}\n\n你的长期记忆（之前轮次的总结）：${ctx.memorySummary || "无"}\n\n你的专属记忆：${memory}\n\n现在是第${day}天白天讨论，你是${seat}号玩家，身份是${role}。请给出你的公开发言。`

      const content = await openaiCompatChat(
        {
          baseUrl: ai.baseUrl,
          apiKey: ai.apiKey,
          model: ai.model,
          temperature: ai.temperature,
        },
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      )
      return content.slice(0, 120)
    } catch {
      return generateMockSpeech(g, seat, role)
    } finally {
      g.thinkingSeats.delete(seat)
      g.onThinkingChange?.()
    }
  }
  return generateMockSpeech(g, seat, role)
}

const buildRoleMemory = (g: GameRuntime, seat: number, role: Role): string => {
  if (role === "seer") {
    const checks: string[] = []
    for (const e of g.events) {
      if (e.t === "action" && e.action === "seer_check" && e.seat === seat) {
        const target = (e.payload as any)?.targetSeat
        const targetRole = g.seats.find((x) => x.seat === target)?.role
        checks.push(`${target}号${targetRole === "werewolf" ? "是狼人" : "是好人"}`)
      }
    }
    return checks.length > 0 ? `你验过的人：${checks.join("；")}` : "你还没有验过人"
  }

  if (role === "werewolf") {
    const teammates = g.seats
      .filter((s) => s.alive && s.role === "werewolf" && s.seat !== seat)
      .map((s) => `${s.seat}号`)
    return teammates.length > 0 ? `你的狼队友：${teammates.join("、")}` : "你是最后一匹狼"
  }

  if (role === "witch") {
    const s = g.seats.find((x) => x.seat === seat)
    const antidoteUsed = s?.hand.witchAntidoteUsed ?? false
    const poisonUsed = s?.hand.witchPoisonUsed ?? false
    return `解药${antidoteUsed ? "已用" : "未用"}，毒药${poisonUsed ? "已用" : "未用"}`
  }

  if (role === "guard") {
    const s = g.seats.find((x) => x.seat === seat)
    const lastTarget = s?.hand.lastGuardTarget
    return lastTarget ? `你上一晚守护了${lastTarget}号` : "你还没有守护过任何人"
  }

  if (role === "hunter") {
    return "你尚未开枪，濒死后可以选择开枪或放弃"
  }

  return "你是普通村民，没有特殊信息"
}

const generateMockSpeech = (g: GameRuntime, seat: number, role: Role): string => {
  const day = g.day

  const openers = [
    `第${day}天，${seat}号发言。`,
    `我是${seat}号，报一下视角。`,
    `${seat}号说两句。`,
  ]

  const roleSpeeches: Record<Role, string[]> = {
    werewolf: [
      "我听着呢，先不急着站边。",
      "今天发言信息量都不大，再听听。",
      "我觉得可以从投票动机入手。",
      "谁带节奏我重点看谁的逻辑。",
      "我不抢身份，先做村民视角。",
    ],
    seer: [
      "我有一些信息，但先听听大家发言。",
      "今天我重点关注站边和投票。",
      "有人逻辑有问题，我记下了。",
      "我会根据验人结果调整视角。",
      "好人不要分票，先出狼。",
    ],
    witch: [
      "我听发言抓狼，今天看谁带节奏。",
      "信息量不大，再观望一轮。",
      "我觉得可以先从轻量推理开始。",
      "有人发言太冲，我记下了。",
      "女巫还是低调点，先不跳。",
    ],
    hunter: [
      "我表个水，我是好人。",
      "谁踩我我重点看谁。",
      "今天先出最像狼的。",
      "我猎人身份，被出了能开枪。",
      "发言逻辑有问题的人先出。",
    ],
    guard: [
      "我分析刀型，今天先听发言。",
      "有人死亡信息不对，我记下了。",
      "好人不要互打，先找狼。",
      "我会重点看站边和投票。",
      "守卫视角，先保关键位置。",
    ],
    villager: [
      "我是村民，没什么信息，听大家发言。",
      "今天看谁的逻辑有问题。",
      "我先轻量推理，不硬踩。",
      "投票动机很重要，我重点看。",
      "有没有人跳身份？我想听。",
    ],
  }

  const stance = g.rng.pick(roleSpeeches[role])
  return `${g.rng.pick(openers)}${stance}`
}

const pickRandomAlive = (g: GameRuntime) => {
  const alive = aliveSeatNumbers(g)
  return g.rng.pick(alive)
}

const pickRandomAliveOther = (g: GameRuntime, selfSeat: number) => {
  const alive = aliveSeatNumbers(g).filter((s) => s !== selfSeat)
  return g.rng.pick(alive)
}

const pickWolfKillTarget = (g: GameRuntime) => {
  const alive = g.seats.filter((s) => s.alive && s.role)
  const wolves = new Set(alive.filter((s) => s.role === "werewolf").map((s) => s.seat))
  const targets = alive.map((s) => s.seat).filter((seat) => !wolves.has(seat))
  if (targets.length === 0) return null

  // 优先刀明神职（简单策略：优先刀预言家、女巫、守卫）
  const priorityRoles = ["seer", "witch", "guard"]
  for (const role of priorityRoles) {
    const roleTargets = targets.filter((seat) => {
      const s = g.seats.find((x) => x.seat === seat)
      return s?.role === role
    })
    if (roleTargets.length > 0) return g.rng.pick(roleTargets)
  }

  return g.rng.pick(targets)
}

const decideAntidote = (g: GameRuntime) => {
  if (g.night?.wolfVictim === null) return null
  const r = g.rng.next()
  return r < 0.55 ? g.night.wolfVictim : null
}

const decidePoison = (g: GameRuntime, selfSeat: number) => {
  const r = g.rng.next()
  if (r > 0.3) return null
  const alive = aliveSeatNumbers(g).filter((s) => s !== selfSeat)
  if (alive.length === 0) return null
  return g.rng.pick(alive)
}

const runHunter = (g: GameRuntime) => {
  if (!g.hunterState) return false
  for (const seat of g.hunterState.dyingSeats) {
    if (g.hunterState.shots.has(seat)) continue
    const s = g.seats.find((x) => x.seat === seat)
    if (!s || s.kind !== "ai") continue
    const targetSeat = g.rng.next() < 0.5 ? pickRandomAliveOther(g, seat) : null
    submitAction(g, s.seat, { t: "hunter_shoot", targetSeat })
    return true
  }
  return false
}
