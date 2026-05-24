import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { generateSeatToken, verifySeatToken, revokeGameTokens, purgeExpiredTokens, getTokenCount, stopTokenCleanup } from "./auth.js"

afterEach(() => {
  stopTokenCleanup()
  vi.restoreAllMocks()
})

describe("auth middleware - token store", () => {
  const gameId = "test-game-001"

  test("generateSeatToken returns a non-empty string", () => {
    const token = generateSeatToken(gameId, 1)
    expect(token).toBeTruthy()
    expect(typeof token).toBe("string")
  })

  test("verifySeatToken returns payload for valid token", () => {
    const token = generateSeatToken(gameId, 3)
    const payload = verifySeatToken(token)
    expect(payload).toEqual({ gameId, seat: 3 })
  })

  test("verifySeatToken returns null for invalid token", () => {
    expect(verifySeatToken("nonexistent-token")).toBeNull()
    expect(verifySeatToken("")).toBeNull()
  })

  test("revokeGameTokens removes all tokens for a game", () => {
    const t1 = generateSeatToken("game-revoke", 1)
    const t2 = generateSeatToken("game-revoke", 2)
    const t3 = generateSeatToken("game-other", 1)

    revokeGameTokens("game-revoke")

    expect(verifySeatToken(t1)).toBeNull()
    expect(verifySeatToken(t2)).toBeNull()
    expect(verifySeatToken(t3)).toEqual({ gameId: "game-other", seat: 1 })
  })

  test("each token is unique", () => {
    const t1 = generateSeatToken(gameId, 1)
    const t2 = generateSeatToken(gameId, 1)
    expect(t1).not.toBe(t2)
  })
})

describe("auth middleware - token expiration", () => {
  test("expired token returns null", () => {
    const token = generateSeatToken("game-expire", 1)

    // Fast-forward time past TTL (4 hours default)
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 3600_000)

    expect(verifySeatToken(token)).toBeNull()
  })

  test("token within TTL is still valid", () => {
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now)

    const token = generateSeatToken("game-valid", 2)

    // 3 hours later (within 4h TTL)
    vi.spyOn(Date, "now").mockReturnValue(now + 3 * 3600_000)

    expect(verifySeatToken(token)).toEqual({ gameId: "game-valid", seat: 2 })
  })

  test("purgeExpiredTokens removes only expired tokens", () => {
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now)

    const t1 = generateSeatToken("game-old", 1)
    const t2 = generateSeatToken("game-new", 2)

    // Move time forward 5 hours
    vi.spyOn(Date, "now").mockReturnValue(now + 5 * 3600_000)

    // Create a fresh token at the new time
    const t3 = generateSeatToken("game-fresh", 3)

    const removed = purgeExpiredTokens()
    expect(removed).toBeGreaterThanOrEqual(2)
    expect(verifySeatToken(t3)).toEqual({ gameId: "game-fresh", seat: 3 })
  })

  test("getTokenCount returns current store size", () => {
    const before = getTokenCount()
    generateSeatToken("game-count", 1)
    expect(getTokenCount()).toBe(before + 1)
  })
})
