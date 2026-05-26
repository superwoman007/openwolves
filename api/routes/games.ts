import { Router, type Request, type Response } from "express"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { SubmitActionRequest } from "../../shared/game.js"
import { GameService } from "../game/gameService.js"
import { GameStore } from "../db/gameStore.js"
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js"
import { createGameLimiter, gameLimiter } from "../middleware/rate-limit.js"
import { GameConfigSchema, SubmitActionSchema } from "../validation/schemas.js"
import { trackSSE } from "../lib/sseTracker.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()
const store = new GameStore(path.join(__dirname, "../../data"))
const games = new GameService(store)

// --- Public endpoints (no auth required) ---

router.post("/", createGameLimiter, (req: Request, res: Response) => {
  const result = GameConfigSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ success: false, error: result.error.issues[0].message })
    return
  }
  try {
    const { gameId } = games.createGame(result.data)
    res.status(200).json({ success: true, gameId })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

// --- Mixed access endpoints ---

router.post("/:id/start", async (req: Request, res: Response) => {
  try {
    const canStartWithoutAuth = await games.canStartWithoutAuth(req.params.id)
    if (!canStartWithoutAuth) {
      let isAuthed = false
      requireAuth(req, res, () => {
        isAuthed = true
      })
      if (!isAuthed) return
    }
    const state = await games.startGame(req.params.id)
    res.status(200).json({ success: true, state })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

router.get("/:id/state", (req: Request, res: Response) => {
  try {
    const state = games.getPublicState(req.params.id)
    res.status(200).json({ success: true, state })
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message })
  }
})

router.get("/:id/events", (req: Request, res: Response) => {
  let unsubscribe: (() => void) | null = null
  try {
    const initial = games.getPublicState(req.params.id)
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    })

    // Track for graceful shutdown
    trackSSE(res)

    const send = (state: unknown) => {
      try {
        res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
      } catch {
        // Client disconnected, cleanup will happen on 'close'
      }
    }

    send(initial)
    unsubscribe = games.subscribe(req.params.id, send)

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: ping\ndata: ${Date.now()}\n\n`)
      } catch {
        clearInterval(heartbeat)
        unsubscribe?.()
        unsubscribe = null
      }
    }, 15000)

    req.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe?.()
      unsubscribe = null
    })
  } catch (e) {
    unsubscribe?.()
    res.status(404).end()
  }
})

router.get("/:id/state/private", requireAuth, (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest
    const seat = authReq.auth.seat
    const state = games.getPrivateState(req.params.id, seat)
    res.status(200).json({ success: true, state })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

router.post("/:id/action", requireAuth, gameLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = SubmitActionSchema.safeParse(req.body)
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: parseResult.error.issues[0].message })
      return
    }
    const { seat, action } = parseResult.data
    const authReq = req as AuthenticatedRequest
    // Ensure the token owner matches the seat being acted on
    if (authReq.auth.seat !== seat) {
      res.status(403).json({ success: false, error: "Cannot act for another seat" })
      return
    }
    const state = await games.submitAction(req.params.id, seat, action as SubmitActionRequest["action"])
    res.status(200).json({ success: true, state })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

router.post("/:id/advance", requireAuth, gameLimiter, async (req: Request, res: Response) => {
  try {
    const state = await games.advance(req.params.id)
    res.status(200).json({ success: true, state })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

router.get("/:id/replay", async (req: Request, res: Response) => {
  try {
    const replay = await games.getReplay(req.params.id)
    res.status(200).json({ success: true, replay })
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message })
  }
})

export default router
