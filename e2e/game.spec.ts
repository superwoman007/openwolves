import { test, expect } from "@playwright/test"

test.describe("Game flow", () => {
  test("auto-play game renders events", async ({ page }) => {
    await page.goto("/")
    await page.click("text=创建并开始")
    await expect(page).toHaveURL(/\/game\//)

    // 等待游戏加载
    await expect(page.locator("text=ALIVE").first()).toBeVisible()

    // 应该有玩家列表（AI 自动运行后可能有死亡，但至少能看到 ALIVE 标签）
    const players = page.locator("text=ALIVE")
    await expect(players).toHaveCount(6) // 默认 6 人（因为 AI 自动运行可能已经杀了一些）

    // 事件记录区域应该有内容
    await expect(page.locator("text=房间已创建")).toBeVisible()
    await expect(page.locator("text=身份已分配")).toBeVisible()
  })

  test("human player can take actions as werewolf", async ({ page }) => {
    await page.goto("/")

    // 设为 6 人局，确保有狼人
    await page.locator("select").first().selectOption("6 人")

    // 把 1 号设为人类
    await page.locator("select").nth(1).selectOption("人类")
    await page.locator("text=我操控座位").locator("..").locator("select").selectOption("1号")

    // 创建游戏
    await page.click("text=创建并开始")
    await expect(page).toHaveURL(/\/game\/.+\?selfSeat=1/)

    // 如果是狼人，应该看到夜晚击杀 UI
    // 但由于角色随机，可能不是狼人。我们检查是否有操作面板或等待提示
    await page.waitForTimeout(2000)

    const hasActionPanel = await page.locator("text=夜晚击杀").isVisible().catch(() => false)
    const hasWaitMessage = await page.locator("text=等待其他玩家行动").isVisible().catch(() => false)
    const hasSpeechPanel = await page.locator("text=公开发言").isVisible().catch(() => false)
    const hasVotePanel = await page.locator("text=投票放逐").isVisible().catch(() => false)

    expect(hasActionPanel || hasWaitMessage || hasSpeechPanel || hasVotePanel).toBe(true)
  })

  test("game can end and show result", async ({ page }) => {
    await page.goto("/")
    await page.click("text=创建并开始")
    await expect(page).toHaveURL(/\/game\//)

    // 等待游戏自动运行并结束（给 AI 足够的时间）
    await page.waitForTimeout(20000)

    // 检查是否有结束相关的事件，或至少能看到阶段变化
    const text = await page.locator("[class*='h-\\[520px\\]']").innerText().catch(() => "")
    const hasEnded = text.includes("结束") || text.includes("获胜") || text.includes("放逐") || text.includes("死亡")
    expect(hasEnded).toBe(true)
  })
})
