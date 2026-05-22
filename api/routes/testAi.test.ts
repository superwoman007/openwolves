import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleTestAi } from "./testAi.js"

vi.mock("../llm/openaiCompatible.js", () => ({
  openaiCompatChat: vi.fn(),
}))

import { openaiCompatChat } from "../llm/openaiCompatible.js"

function mockReqRes(body: unknown) {
  let jsonData: unknown = {}
  const req = { body } as Parameters<typeof handleTestAi>[0]
  const res = {
    json: (data: unknown) => {
      jsonData = data
      return res
    },
  } as Parameters<typeof handleTestAi>[1]
  return { req, res, getJson: () => jsonData }
}

describe("handleTestAi", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("returns success when chat responds", async () => {
    vi.mocked(openaiCompatChat).mockResolvedValue("pong")
    const { req, res, getJson } = mockReqRes({
      baseUrl: "https://api.test.com/v1",
      apiKey: "sk-test",
      model: "test-model",
    })
    await handleTestAi(req, res)
    const data = getJson() as { success: boolean; content?: string }
    expect(data.success).toBe(true)
    expect(data.content).toBe("pong")
  })

  it("returns failure when chat throws", async () => {
    vi.mocked(openaiCompatChat).mockRejectedValue(new Error("Network error"))
    const { req, res, getJson } = mockReqRes({
      baseUrl: "https://api.test.com/v1",
      apiKey: "sk-test",
      model: "test-model",
    })
    await handleTestAi(req, res)
    const data = getJson() as { success: boolean; error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain("Network error")
  })
})
