import { describe, expect, it } from "vitest"
import type { GameConfig } from "../../shared/game.js"
import { createRuntime, startGame } from "./engine.js"
import { createScheduler } from "./agent-scheduler.js"

const makeConfig = (): GameConfig => ({
  seats: [
    { seat: 1, name: "1号", kind: "ai", ai: { provider: "mock" } },
    { seat: 2, name: "2号", kind: "ai", ai: { provider: "mock" } },
    { seat: 3, name: "3号", kind: "ai", ai: { provider: "mock" } },
    { seat: 4, name: "4号", kind: "ai", ai: { provider: "mock" } },
    { seat: 5, name: "5号", kind: "ai", ai: { provider: "mock" } },
    { seat: 6, name: "6号", kind: "ai", ai: { provider: "mock" } },
  ],
  rolePool: ["werewolf", "werewolf", "seer", "witch", "villager", "villager"],
  rngSeed: "scheduler-progress-test",
})

describe("Scheduler.runAuto", () => {
  it("reports incremental progress while auto-playing", async () => {
    const g = createRuntime("scheduler-progress-game", makeConfig())
    startGame(g)

    const scheduler = createScheduler(g)
    const snapshots: Array<{ phase: string; day: number; eventCount: number }> = []

    await scheduler.runAuto(() => {
      snapshots.push({
        phase: g.phase,
        day: g.day,
        eventCount: g.events.length,
      })
    })

    expect(snapshots.length).toBeGreaterThan(3)
    expect(snapshots[0].eventCount).toBeLessThan(snapshots[snapshots.length - 1].eventCount)
    expect(snapshots.some((snapshot) => snapshot.phase === "day_speech")).toBe(true)
    expect(snapshots[snapshots.length - 1].phase).toBe("ended")
  })
})
