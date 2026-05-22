import { Router, type Request, type Response } from "express"
import { openaiCompatChat } from "../llm/openaiCompatible.js"

export const handleTestAi = async (req: Request, res: Response) => {
  const { baseUrl, apiKey, model, temperature } = req.body as {
    baseUrl?: string
    apiKey?: string
    model?: string
    temperature?: number
  }

  try {
    const content = await openaiCompatChat(
      { baseUrl, apiKey, model, temperature },
      [
        {
          role: "user",
          content: '请只回复一个单词 "pong"，不要添加任何其他内容。',
        },
      ],
    )
    res.json({ success: true, content })
  } catch (e) {
    res.json({ success: false, error: (e as Error).message })
  }
}

const router = Router()
router.post("/", handleTestAi)

export default router
