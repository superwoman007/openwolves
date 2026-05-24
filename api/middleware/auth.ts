import crypto from "node:crypto"
import type { Request, Response, NextFunction } from "express"

export interface SeatTokenPayload {
  gameId: string
  seat: number
}

interface TokenEntry {
  payload: SeatTokenPayload
  createdAt: number
}

/** Token TTL in milliseconds (default 4 hours) */
const TOKEN_TTL_MS = (Number(process.env.TOKEN_TTL_HOURS) || 4) * 3600_000

/** In-memory token store: token → { payload, createdAt } */
const tokenStore = new Map<string, TokenEntry>()

/** Cleanup interval handle */
let cleanupTimer: ReturnType<typeof setInterval> | null = null

/** Start periodic cleanup of expired tokens (every 10 minutes) */
export function startTokenCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(purgeExpiredTokens, 10 * 60_000)
  // Allow process to exit even if timer is active
  if (cleanupTimer.unref) cleanupTimer.unref()
}

/** Stop the cleanup timer (for graceful shutdown) */
export function stopTokenCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

/** Remove all expired tokens */
export function purgeExpiredTokens(): number {
  const now = Date.now()
  let removed = 0
  for (const [token, entry] of tokenStore) {
    if (now - entry.createdAt > TOKEN_TTL_MS) {
      tokenStore.delete(token)
      removed++
    }
  }
  return removed
}

/** Generate a seat token for a player who joined a game */
export function generateSeatToken(gameId: string, seat: number): string {
  const token = crypto.randomUUID()
  tokenStore.set(token, { payload: { gameId, seat }, createdAt: Date.now() })
  return token
}

/** Verify a token and return its payload, or null if invalid/expired */
export function verifySeatToken(token: string): SeatTokenPayload | null {
  const entry = tokenStore.get(token)
  if (!entry) return null
  if (Date.now() - entry.createdAt > TOKEN_TTL_MS) {
    tokenStore.delete(token)
    return null
  }
  return entry.payload
}

/** Remove all tokens for a game (cleanup on game end) */
export function revokeGameTokens(gameId: string): void {
  for (const [token, entry] of tokenStore) {
    if (entry.payload.gameId === gameId) {
      tokenStore.delete(token)
    }
  }
}

/** Get current token count (for monitoring) */
export function getTokenCount(): number {
  return tokenStore.size
}

/** Express middleware: requires valid Bearer token, injects gameId/seat */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Support token via Authorization header or query param (for EventSource)
  const authHeader = req.headers.authorization
  let token: string | undefined

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7)
  } else if (typeof req.query.token === "string") {
    token = req.query.token
  }

  if (!token) {
    res.status(401).json({ success: false, error: "Authentication required" })
    return
  }

  const payload = verifySeatToken(token)
  if (!payload) {
    res.status(401).json({ success: false, error: "Invalid or expired token" })
    return
  }

  // Inject into request for downstream handlers
  ;(req as AuthenticatedRequest).auth = payload
  next()
}

export interface AuthenticatedRequest extends Request {
  auth: SeatTokenPayload
}

// Auto-start cleanup when module loads
startTokenCleanup()
