type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type OpenAICompatConfig = {
  baseUrl?: string
  apiKey?: string
  model?: string
  temperature?: number
  responseFormat?: { type: "json_object" }
  maxTokens?: number
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "")

const buildChatCompletionsUrl = (baseUrl: string) => {
  const b = normalizeBaseUrl(baseUrl)
  if (b.includes("/chat/completions")) return b
  if (b.endsWith("/v1")) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 15_000

export const openaiCompatChat = async (
  cfg: OpenAICompatConfig,
  messages: ChatMessage[],
): Promise<string> => {
  const apiKey = cfg.apiKey ?? process.env.OPENAI_API_KEY
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("OPENAI_API_KEY is not set")
  }

  const baseUrl = cfg.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com"
  const url = buildChatCompletionsUrl(baseUrl)
  const model = cfg.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const temperature = cfg.temperature ?? 0.7

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  let resp: Response
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages,
        ...(cfg.responseFormat ? { response_format: cfg.responseFormat } : {}),
        ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}),
      }),
      signal: controller.signal,
    })
  } catch (e: unknown) {
    clearTimeout(timeout)
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`openai_compatible timeout after ${LLM_TIMEOUT_MS}ms`)
    }
    throw e
  } finally {
    clearTimeout(timeout)
  }

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

