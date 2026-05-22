import { test, expect } from "@playwright/test"

test.describe("Replay", () => {
  test("can view replay after game", async ({ page, request }) => {
    // 通过 API 创建一个游戏
    const res = await request.post("/api/games", {
      data: {
        seats: [
          { seat: 1, name: "1号", kind: "ai", ai: { provider: "mock" } },
          { seat: 2, name: "2号", kind: "ai", ai: { provider: "mock" } },
          { seat: 3, name: "3号", kind: "ai", ai: { provider: "mock" } },
          { seat: 4, name: "4号", kind: "ai", ai: { provider: "mock" } },
        ],
        rolePool: ["werewolf", "werewolf", "seer", "villager"],
        rngSeed: "e2e-replay",
      },
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    const gameId = body.gameId

    // 开始游戏
    await request.post(`/api/games/${gameId}/start`)

    // 访问回放页
    await page.goto(`/replay/${gameId}`)
    await expect(page.locator("text=房间已创建")).toBeVisible()
    await expect(page.locator("text=身份已分配")).toBeVisible()
  })

  test("replay link from game page works", async ({ page }) => {
    await page.goto("/")
    await page.click("text=创建并开始")
    await expect(page).toHaveURL(/\/game\//)

    // 点击复盘链接
    await page.click("text=去复盘")
    await expect(page).toHaveURL(/\/replay\//)
    await expect(page.locator("text=房间已创建")).toBeVisible()
  })
})
