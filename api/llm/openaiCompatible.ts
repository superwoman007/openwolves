type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type OpenAICompatConfig = {
  baseUrl?: string
  apiKey?: string
  model?: string
  temperature?: number
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "")

const buildChatCompletionsUrl = (baseUrl: string) => {
  const b = normalizeBaseUrl(baseUrl)
  if (b.includes("/chat/completions")) return b
  if (b.endsWith("/v1")) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

export const openaiCompatChat = async (
  cfg: OpenAICompatConfig,
  messages: ChatMessage[],
): Promise<string> => {
  const apiKey = cfg.apiKey ?? process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set")
  }

  const baseUrl = cfg.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com"
  const url = buildChatCompletionsUrl(baseUrl)
  const model = cfg.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const temperature = cfg.temperature ?? 0.7

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`openai_compatible error: ${resp.status} ${text}`)
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error("openai_compatible empty response")
  }
  return content.trim()
}

