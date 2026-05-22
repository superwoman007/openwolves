import { Router, type Request, type Response } from "express"
import type { GameConfig, SubmitActionRequest } from "../../shared/game.js"
import { GameService } from "../game/gameService.js"
import { GameStore } from "../db/gameStore.js"

const router = Router()
const store = new GameStore("./data")
const games = new GameService(store)

router.post("/", (req: Request, res: Response) => {
  try {
    const config = req.body as GameConfig
    const { gameId } = games.createGame(config)
    res.status(200).json({ success: true, gameId })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

router.post("/:id/start", async (req: Request, res: Response) => {
  try {
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

    const send = (state: unknown) => {
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
    }

    send(initial)
    unsubscribe = games.subscribe(req.params.id, send)

    const heartbeat = setInterval(() => {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`)
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

router.get("/:id/state/private", (req: Request, res: Response) => {
  try {
    const seat = Number(req.query.seat)
    if (!Number.isFinite(seat)) {
      res.status(400).json({ success: false, error: "invalid seat" })
      return
    }
    const state = games.getPrivateState(req.params.id, seat)
    res.status(200).json({ success: true, state })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

router.post("/:id/action", async (req: Request, res: Response) => {
  try {
    const body = req.body as SubmitActionRequest
    const state = await games.submitAction(req.params.id, body.seat, body.action)
    res.status(200).json({ success: true, state })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

router.post("/:id/advance", async (req: Request, res: Response) => {
  try {
    const state = await games.advance(req.params.id)
    res.status(200).json({ success: true, state })
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message })
  }
})

router.get("/:id/replay", (req: Request, res: Response) => {
  try {
    const replay = games.getReplay(req.params.id)
    res.status(200).json({ success: true, replay })
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message })
  }
})

export default router
