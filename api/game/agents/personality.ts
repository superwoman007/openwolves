/**
 * 性格系统：为 AI 玩家分配不同的性格原型，
 * 通过 prompt 修饰语影响 LLM 的输出风格。
 */

export type Personality = {
  id: string
  name: string
  promptModifier: string
  temperatureOffset: number
}

export const PERSONALITIES: Personality[] = [
  {
    id: "aggressive",
    name: "激进型",
    promptModifier: "你的性格特征：你是一个激进型玩家，倾向于早期就给出明确判断，敢于第一个点人，语气坚定有压迫感。发言偏短但有力。",
    temperatureOffset: 0.1,
  },
  {
    id: "cautious",
    name: "稳健型",
    promptModifier: "你的性格特征：你是一个稳健型玩家，倾向于等待更多信息再下判断，措辞保守留有余地，不轻易站边。",
    temperatureOffset: -0.2,
  },
  {
    id: "analytical",
    name: "逻辑型",
    promptModifier: "你的性格特征：你是一个逻辑型玩家，重点关注票型矛盾和发言前后不一致，用数据和事实说话，语气冷静理性。",
    temperatureOffset: -0.3,
  },
  {
    id: "emotional",
    name: "感性型",
    promptModifier: "你的性格特征：你是一个感性型玩家，靠直觉和感觉判断，语气带感情色彩，会用'我感觉'、'我直觉'这类表达。",
    temperatureOffset: 0.2,
  },
  {
    id: "leader",
    name: "带队型",
    promptModifier: "你的性格特征：你是一个带队型玩家，喜欢组织投票方向，给出明确的出人建议，语气有号召力。",
    temperatureOffset: 0.0,
  },
  {
    id: "quiet",
    name: "低调型",
    promptModifier: "你的性格特征：你是一个低调型玩家，发言简短精炼，不抢风头，倾向于跟票而非带队，但关键时刻会表态。",
    temperatureOffset: -0.1,
  },
]

/**
 * 简单的字符串哈希函数，用于确定性分配。
 */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * 根据座位号和游戏种子确定性地分配性格。
 * 相同的 seat + seed 组合始终返回相同的性格。
 */
export function assignPersonality(seat: number, seed: string): Personality {
  const hash = simpleHash(`${seed}-seat-${seat}`)
  const index = hash % PERSONALITIES.length
  return PERSONALITIES[index]
}
