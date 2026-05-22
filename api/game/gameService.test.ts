import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameService } from "./gameService.js";
import { GameStore } from "../db/gameStore.js";
import type { GameConfig } from "../../shared/game.js";

const makeConfig = (): GameConfig => ({
  seats: [
    { seat: 1, name: "1号", kind: "ai", ai: { provider: "mock" } },
    { seat: 2, name: "2号", kind: "ai", ai: { provider: "mock" } },
    { seat: 3, name: "3号", kind: "ai", ai: { provider: "mock" } },
    { seat: 4, name: "4号", kind: "ai", ai: { provider: "mock" } },
  ],
  rolePool: ["werewolf", "werewolf", "seer", "villager"],
  rngSeed: "service-test",
});

describe("GameService with persistence", () => {
  let tmpDir: string;
  let store: GameStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "werewolf-"));
    store = new GameStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists game config on creation", () => {
    const service = new GameService(store);
    const { gameId } = service.createGame(makeConfig());
    const config = store.getConfig(gameId);
    expect(config).toBeTruthy();
    expect(config!.seats).toHaveLength(4);
  });

  it("persists events after start and actions", async () => {
    const service = new GameService(store);
    const { gameId } = service.createGame(makeConfig());
    await service.startGame(gameId);

    const events = store.getEvents(gameId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.t === "system" && e.text === "房间已创建")).toBe(true);
    expect(events.some((e) => e.t === "system" && e.text === "身份已分配")).toBe(true);
  });

  it("replay loads from store", async () => {
    const service = new GameService(store);
    const { gameId } = service.createGame(makeConfig());
    await service.startGame(gameId);

    const replay = service.getReplay(gameId);
    expect(replay.gameId).toBe(gameId);
    expect(replay.events.length).toBeGreaterThan(0);
  });

  it("can recover game from store after simulated restart", async () => {
    const service1 = new GameService(store);
    const { gameId } = service1.createGame(makeConfig());
    await service1.startGame(gameId);

    // 模拟重启：创建新的 service 实例，传入同一个 store
    const service2 = new GameService(store);
    const state = service2.getPublicState(gameId);
    expect(state.gameId).toBe(gameId);
    expect(state.phase).not.toBe("lobby");
  });
});
