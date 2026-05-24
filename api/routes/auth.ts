/**
 * Authentication routes for game room access.
 * Uses room password + seat token model (no user accounts needed).
 */
import { Router, type Request, type Response } from "express"
import { generateSeatToken } from "../middleware/auth.js"
import { JoinGameSchema } from "../validation/schemas.js"
import { GameService } from "../game/gameService.js"
import { GameStore } from "../db/gameStore.js"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()
const store = new GameStore(path.join(__dirname, "../../data"))
const games = new GameService(store)

/**
 * Join a game room and receive a seat token.
 * POST /api/auth/join/:gameId
 */
router.post("/join/:gameId", async (req: Request, res: Response): Promise<void> => {
  const result = JoinGameSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ success: false, error: result.error.issues[0].message })
    return
  }

  const { seat, password } = result.data
  const gameId = req.params.gameId

  try {
    const config = await store.getConfig(gameId)
    if (!config) {
      res.status(404).json({ success: false, error: "Game not found" })
      return
    }

    // Verify room password if set
    if (config.password && config.password !== password) {
      res.status(403).json({ success: false, error: "Incorrect room password" })
      return
    }

    // Verify seat is valid
    if (seat >= config.seats.length) {
      res.status(400).json({ success: false, error: "Invalid seat number" })
      return
    }

    // Verify seat is for a human player
    if (config.seats[seat].kind !== "human") {
      res.status(400).json({ success: false, error: "Cannot join an AI seat" })
      return
    }

    const token = generateSeatToken(gameId, seat)
    res.status(200).json({ success: true, token, gameId, seat })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

export default router
