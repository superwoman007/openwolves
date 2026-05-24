import rateLimit from "express-rate-limit"

/** 通用限制：每 IP 每分钟 60 次 */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests, please try again later" },
})

/** 游戏操作限制：每 IP 每分钟 30 次（防止刷 LLM） */
export const gameLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many game actions, please slow down" },
})

/** 创建游戏限制：每 IP 每小时 10 局 */
export const createGameLimiter = rateLimit({
  windowMs: 3_600_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many games created, please try again later" },
})
