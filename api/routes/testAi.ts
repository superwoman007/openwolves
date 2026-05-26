import { Router, type Request, type Response } from "express"
import { openaiCompatChat } from "../llm/openaiCompatible.js"

export const handleTestAi = async (req: Request, res: Response) => {
  const { provider, baseUrl, apiKey, model, temperature } = req.body as {
    provider?: string
    baseUrl?: string
    apiKey?: string
    model?: string
    temperature?: number
  }

  try {
    const content = await openaiCompatChat(
      { provider, baseUrl, apiKey, model, temperature },
      [
        {
          role: "user",
          content: '请只回复一个单词 "pong"，不要添加任何其他内容。',
        },
      ],
    )
    res.json({ success: true, content })
  } catch (e) {
    const msg = (e as Error).message
    // Only expose safe error info to client, not raw provider response
    const safeMsg = msg.startsWith("OPENAI_API_KEY")
      ? msg
      : msg.includes("error:")
        ? "LLM provider returned an error. Check your API key and base URL."
        : msg
    console.error("[testAi] LLM error:", msg)
    res.json({ success: false, error: safeMsg })
  }
}

const router = Router()
router.post("/", handleTestAi)

export default router
