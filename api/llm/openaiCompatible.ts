type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

type ResponseFormat = {
  type: "json_object" | "text"
}

export type OpenAICompatConfig = {
  provider?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  temperature?: number
  responseFormat?: ResponseFormat
  maxTokens?: number
  thinking?: { type: "enabled" | "disabled" }
  reasoningEffort?: "low" | "medium" | "high"
}

/**
 * 清理基础地址末尾多余的斜杠，避免重复拼接路径。
 * @param baseUrl 原始基础地址。
 * @returns 规范化后的基础地址。
 */
const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "")

/**
 * 判断当前配置是否使用 DeepSeek。
 * @param provider 厂商标识。
 * @param baseUrl 基础地址。
 * @returns 是否为 DeepSeek 厂商。
 */
const isDeepSeekProvider = (provider?: string, baseUrl?: string) =>
  provider === "deepseek" || /(^https?:\/\/)?api\.deepseek\.com(\/|$)/i.test(baseUrl ?? "")

/**
 * 生成聊天补全接口地址。
 * DeepSeek 新接口默认走 `/chat/completions`，其余厂商保持 OpenAI 兼容规则。
 * @param baseUrl 基础地址。
 * @param provider 厂商标识。
 * @returns 最终请求地址。
 */
const buildChatCompletionsUrl = (baseUrl: string, provider?: string) => {
  const b = normalizeBaseUrl(baseUrl)
  if (b.includes("/chat/completions")) return b
  if (b.endsWith("/v1")) return `${b}/chat/completions`
  if (isDeepSeekProvider(provider, b)) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

/**
 * 根据厂商返回默认基础地址。
 * @param provider 厂商标识。
 * @returns 默认基础地址。
 */
const getDefaultBaseUrl = (provider?: string) =>
  isDeepSeekProvider(provider) ? "https://api.deepseek.com" : "https://api.openai.com"

/**
 * 根据厂商返回默认模型名。
 * @param provider 厂商标识。
 * @returns 默认模型名。
 */
const getDefaultModel = (provider?: string) =>
  isDeepSeekProvider(provider) ? "deepseek-v4-pro" : "gpt-4o-mini"

/**
 * 构造请求体。
 * DeepSeek 使用新版参数；其他厂商保持 OpenAI 兼容结构。
 * @param cfg LLM 配置。
 * @param messages 对话消息列表。
 * @param model 最终使用的模型名。
 * @param temperature 最终使用的温度。
 * @returns 可序列化的请求体。
 */
const buildRequestBody = (
  cfg: OpenAICompatConfig,
  messages: ChatMessage[],
  model: string,
  temperature: number,
) => {
  if (isDeepSeekProvider(cfg.provider, cfg.baseUrl)) {
    return {
      messages,
      model,
      thinking: cfg.thinking ?? { type: "enabled" as const },
      reasoning_effort: cfg.reasoningEffort ?? "high",
      max_tokens: cfg.maxTokens ?? 4096,
      response_format: { type: "text" as const },
      stop: null,
      stream: false,
      stream_options: null,
      temperature,
      top_p: 1,
      tools: null,
      tool_choice: "none",
      logprobs: false,
      top_logprobs: null,
    }
  }

  return {
    model,
    temperature,
    messages,
    ...(cfg.responseFormat ? { response_format: cfg.responseFormat } : {}),
    ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}),
  }
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

  const provider = cfg.provider
    ?? (isDeepSeekProvider(undefined, cfg.baseUrl ?? process.env.OPENAI_BASE_URL) ? "deepseek" : undefined)
  const baseUrl = cfg.baseUrl ?? process.env.OPENAI_BASE_URL ?? getDefaultBaseUrl(provider)
  const url = buildChatCompletionsUrl(baseUrl, provider)
  const model = cfg.model ?? process.env.OPENAI_MODEL ?? getDefaultModel(provider)
  const temperature = cfg.temperature ?? 0.7

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  let resp: Response
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody({ ...cfg, provider, baseUrl }, messages, model, temperature)),
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
