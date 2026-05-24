import { describe, test, expect, beforeEach } from "vitest"
import { generateSeatToken, verifySeatToken } from "../middleware/auth.js"

/**
 * Integration-style tests for the auth join route logic.
 * Tests the core business logic without spinning up Express.
 */
describe("auth join logic", () => {
  test("generates token that can be verified", () => {
    const gameId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    const seat = 2
    const token = generateSeatToken(gameId, seat)

    const payload = verifySeatToken(token)
    expect(payload).toEqual({ gameId, seat })
  })

  test("token binds to specific game and seat", () => {
    const token1 = generateSeatToken("game-1111-1111-1111-111111111111", 0)
    const token2 = generateSeatToken("game-2222-2222-2222-222222222222", 5)

    const p1 = verifySeatToken(token1)
    const p2 = verifySeatToken(token2)

    expect(p1?.gameId).toBe("game-1111-1111-1111-111111111111")
    expect(p1?.seat).toBe(0)
    expect(p2?.gameId).toBe("game-2222-2222-2222-222222222222")
    expect(p2?.seat).toBe(5)
  })

  test("invalid token returns null", () => {
    expect(verifySeatToken("fake-token-abc")).toBeNull()
  })
})
