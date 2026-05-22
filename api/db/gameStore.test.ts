import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStore } from "./gameStore.js";
import type { GameConfig, GameEvent } from "../../shared/game.js";

const makeConfig = (): GameConfig => ({
  seats: [
    { seat: 1, name: "1号", kind: "ai", ai: { provider: "mock" } },
    { seat: 2, name: "2号", kind: "ai", ai: { provider: "mock" } },
    { seat: 3, name: "3号", kind: "ai", ai: { provider: "mock" } },
    { seat: 4, name: "4号", kind: "ai", ai: { provider: "mock" } },
  ],
  rolePool: ["werewolf", "werewolf", "seer", "villager"],
  rngSeed: "store-test",
});

describe("GameStore", () => {
  let tmpDir: string;
  let store: GameStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "werewolf-"));
    store = new GameStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a game and writes config to disk", () => {
    const { gameId } = store.createGameWithId(makeConfig());
    expect(existsSync(join(tmpDir, "games", `${gameId}.json`))).toBe(true);
  });

  it("appends events to jsonl file", () => {
    const { gameId } = store.createGameWithId(makeConfig());
    const events: GameEvent[] = [
      { t: "system", ts: 1, text: "房间已创建" },
      { t: "phase", ts: 2, phase: "night", day: 1 },
    ];
    store.appendEvents(gameId, events);

    const path = join(tmpDir, "events", `${gameId}.jsonl`);
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ t: "system", text: "房间已创建" });
  });

  it("reads back config and events", () => {
    const { gameId } = store.createGameWithId(makeConfig());
    const events: GameEvent[] = [
      { t: "system", ts: 1, text: "房间已创建" },
      { t: "phase", ts: 2, phase: "night", day: 1 },
    ];
    store.appendEvents(gameId, events);

    const config = store.getConfig(gameId);
    expect(config).toBeTruthy();
    expect(config.seats).toHaveLength(4);

    const readEvents = store.getEvents(gameId);
    expect(readEvents).toHaveLength(2);
    expect(readEvents[0]).toMatchObject({ t: "system", text: "房间已创建" });
  });

  it("returns null for non-existent game", () => {
    expect(store.getConfig("nonexistent")).toBeNull();
    expect(store.getEvents("nonexistent")).toEqual([]);
  });

  it("lists all game IDs", () => {
    const g1 = store.createGameWithId(makeConfig());
    const g2 = store.createGameWithId(makeConfig());
    const ids = store.listGameIds();
    expect(ids).toContain(g1.gameId);
    expect(ids).toContain(g2.gameId);
    expect(ids).toHaveLength(2);
  });

  it("overwrites events on snapshot (idempotent)", () => {
    const { gameId } = store.createGameWithId(makeConfig());
    store.appendEvents(gameId, [{ t: "system", ts: 1, text: "old" }]);
    store.overwriteEvents(gameId, [{ t: "system", ts: 2, text: "new" }]);

    const readEvents = store.getEvents(gameId);
    expect(readEvents).toHaveLength(1);
    expect(readEvents[0]).toMatchObject({ text: "new" });
  });
});
