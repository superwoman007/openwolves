import { test, expect } from "@playwright/test"

test.describe("Homepage", () => {
  test("displays title and create button", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("text=Noir Werewolf")).toBeVisible()
    await expect(page.locator("text=创建并开始")).toBeVisible()
  })

  test("can create a game with default config", async ({ page }) => {
    await page.goto("/")
    await page.click("text=创建并开始")
    await expect(page).toHaveURL(/\/game\//)
    await expect(page.locator("text=房间已创建")).toBeVisible()
  })

  test("can set a human seat and join game", async ({ page }) => {
    await page.goto("/")

    // 把 1 号座位设为人类（找到类型列的 select）
    const firstSeatRow = page.locator(".divide-y > div").first()
    const typeSelect = firstSeatRow.locator("select").first()
    await typeSelect.selectOption({ value: "human" })
    await expect(typeSelect).toHaveValue("human")

    // 选择我操控座位为 1 号
    await page.locator("text=我操控座位").locator("xpath=..").locator("select").selectOption("1号")

    await page.click("text=创建并开始")
    await expect(page).toHaveURL(/\/game\/.+\?selfSeat=1/)
    await expect(page.locator("text=你是 1号")).toBeVisible()
  })

  test("can adjust player count", async ({ page }) => {
    await page.goto("/")
    const select = page.locator("select").first()
    await select.selectOption("10 人")
    await expect(select).toHaveValue("10")
    // 应该出现 10 个座位行
    const rows = page.locator(".divide-y > div")
    await expect(rows).toHaveCount(10)
  })
})
