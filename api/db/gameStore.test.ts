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

const FAKE_ID = "00000000-0000-4000-a000-000000000001";
const FAKE_ID2 = "00000000-0000-4000-a000-000000000002";

describe("GameStore (async)", () => {
  let tmpDir: string;
  let store: GameStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "werewolf-"));
    store = new GameStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a game and writes config to disk", async () => {
    await store.createGame(FAKE_ID, makeConfig());
    expect(existsSync(join(tmpDir, "games", `${FAKE_ID}.json`))).toBe(true);
  });

  it("appends events to jsonl file", async () => {
    await store.createGame(FAKE_ID, makeConfig());
    const events: GameEvent[] = [
      { t: "system", ts: 1, text: "房间已创建" },
      { t: "phase", ts: 2, phase: "night", day: 1 },
    ];
    await store.appendEvents(FAKE_ID, events);

    const path = join(tmpDir, "events", `${FAKE_ID}.jsonl`);
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ t: "system", text: "房间已创建" });
  });

  it("reads back config and events", async () => {
    await store.createGame(FAKE_ID, makeConfig());
    const events: GameEvent[] = [
      { t: "system", ts: 1, text: "房间已创建" },
      { t: "phase", ts: 2, phase: "night", day: 1 },
    ];
    await store.appendEvents(FAKE_ID, events);

    const config = await store.getConfig(FAKE_ID);
    expect(config).toBeTruthy();
    expect(config!.seats).toHaveLength(4);

    const readEvents = await store.getEvents(FAKE_ID);
    expect(readEvents).toHaveLength(2);
    expect(readEvents[0]).toMatchObject({ t: "system", text: "房间已创建" });
  });

  it("returns null for non-existent game", async () => {
    const fakeId = "00000000-0000-4000-a000-000000000000";
    expect(await store.getConfig(fakeId)).toBeNull();
    expect(await store.getEvents(fakeId)).toEqual([]);
  });

  it("lists all game IDs", async () => {
    await store.createGame(FAKE_ID, makeConfig());
    await store.createGame(FAKE_ID2, makeConfig());
    const ids = await store.listGameIds();
    expect(ids).toContain(FAKE_ID);
    expect(ids).toContain(FAKE_ID2);
    expect(ids).toHaveLength(2);
  });

  it("overwrites events on snapshot (idempotent)", async () => {
    await store.createGame(FAKE_ID, makeConfig());
    await store.appendEvents(FAKE_ID, [{ t: "system", ts: 1, text: "old" }]);
    await store.overwriteEvents(FAKE_ID, [{ t: "system", ts: 2, text: "new" }]);

    const readEvents = await store.getEvents(FAKE_ID);
    expect(readEvents).toHaveLength(1);
    expect(readEvents[0]).toMatchObject({ text: "new" });
  });
});
