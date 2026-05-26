import { describe, it, expect } from "vitest";
import { createRuntime, startGame, getPublicState, validateConfig } from "./engine.js";
import type { GameConfig } from "../../shared/game.js";

const makeConfig = (overrides?: Partial<GameConfig>): GameConfig => ({
  seats: [
    { seat: 1, name: "1号", kind: "ai", ai: { provider: "mock" } },
    { seat: 2, name: "2号", kind: "ai", ai: { provider: "mock" } },
    { seat: 3, name: "3号", kind: "ai", ai: { provider: "mock" } },
    { seat: 4, name: "4号", kind: "ai", ai: { provider: "mock" } },
  ],
  rolePool: ["werewolf", "werewolf", "seer", "villager"],
  rngSeed: "test",
  ...overrides,
});

describe("validateConfig", () => {
  it("rejects less than 4 seats", () => {
    expect(() =>
      validateConfig({
        seats: [
          { seat: 1, name: "a", kind: "ai", ai: { provider: "mock" } },
          { seat: 2, name: "b", kind: "ai", ai: { provider: "mock" } },
        ],
        rolePool: ["werewolf", "villager"],
      })
    ).toThrow("invalid seats");
  });

  it("rejects mismatched rolePool length", () => {
    const config = makeConfig({ rolePool: ["werewolf", "villager"] });
    expect(() => validateConfig(config)).toThrow("rolePool length must match seats length");
  });

  it("rejects duplicate seat numbers", () => {
    const config = makeConfig({
      seats: [
        { seat: 1, name: "a", kind: "ai", ai: { provider: "mock" } },
        { seat: 1, name: "b", kind: "ai", ai: { provider: "mock" } },
        { seat: 3, name: "c", kind: "ai", ai: { provider: "mock" } },
        { seat: 4, name: "d", kind: "ai", ai: { provider: "mock" } },
      ],
    });
    expect(() => validateConfig(config)).toThrow("duplicate seat number");
  });

  it("rejects empty seat name", () => {
    const config = makeConfig({
      seats: [
        { seat: 1, name: "", kind: "ai", ai: { provider: "mock" } },
        { seat: 2, name: "b", kind: "ai", ai: { provider: "mock" } },
        { seat: 3, name: "c", kind: "ai", ai: { provider: "mock" } },
        { seat: 4, name: "d", kind: "ai", ai: { provider: "mock" } },
      ],
    });
    expect(() => validateConfig(config)).toThrow("seat name required");
  });

  it("rejects ai seat without ai config", () => {
    const config = makeConfig({
      seats: [
        { seat: 1, name: "a", kind: "ai" },
        { seat: 2, name: "b", kind: "ai", ai: { provider: "mock" } },
        { seat: 3, name: "c", kind: "ai", ai: { provider: "mock" } },
        { seat: 4, name: "d", kind: "ai", ai: { provider: "mock" } },
      ],
    });
    expect(() => validateConfig(config)).toThrow("ai seat must have ai config");
  });

  it("accepts valid config", () => {
    expect(() => validateConfig(makeConfig())).not.toThrow();
  });
});

describe("createRuntime", () => {
  it("creates runtime with lobby phase", () => {
    const g = createRuntime("game-1", makeConfig());
    expect(g.gameId).toBe("game-1");
    expect(g.phase).toBe("lobby");
    expect(g.day).toBe(0);
    expect(g.seats).toHaveLength(4);
    expect(g.seats.every((s) => s.alive)).toBe(true);
    expect(g.events[0]).toMatchObject({ t: "system", text: "房间已创建" });
  });

  it("assigns deterministic rng from seed", () => {
    const g1 = createRuntime("g1", makeConfig({ rngSeed: "seed-a" }));
    const g2 = createRuntime("g2", makeConfig({ rngSeed: "seed-a" }));
    expect(g1.rng.next()).toBe(g2.rng.next());
  });
});

describe("startGame", () => {
  it("assigns roles and starts night", () => {
    const g = createRuntime("g1", makeConfig());
    startGame(g);
    const assignmentEvent = g.events.find((e) => e.t === "system" && e.text === "身份已分配");
    expect(g.phase).toBe("night");
    expect(g.day).toBe(1);
    expect(g.seats.every((s) => s.role !== undefined)).toBe(true);
    expect(assignmentEvent).toBeTruthy();
    expect((assignmentEvent as { data?: { seatRoles?: Array<{ seat: number; role: string }> } }).data?.seatRoles).toHaveLength(g.seats.length);
    expect(g.events.some((e) => e.t === "phase" && e.phase === "night")).toBe(true);
  });

  it("shuffles roles using rng", () => {
    const g1 = createRuntime("g1", makeConfig({ rngSeed: "a" }));
    const g2 = createRuntime("g2", makeConfig({ rngSeed: "b" }));
    startGame(g1);
    startGame(g2);
    const r1 = g1.seats.map((s) => s.role);
    const r2 = g2.seats.map((s) => s.role);
    expect(r1).not.toEqual(r2);
  });

  it("rejects double start", () => {
    const g = createRuntime("g1", makeConfig());
    startGame(g);
    expect(() => startGame(g)).toThrow("game already started");
  });
});

describe("getPublicState", () => {
  it("returns correct public state", () => {
    const g = createRuntime("g1", makeConfig());
    startGame(g);
    const s = getPublicState(g);
    expect(s.gameId).toBe("g1");
    expect(s.phase).toBe("night");
    expect(s.day).toBe(1);
    expect(s.aliveSeats).toEqual([1, 2, 3, 4]);
    expect(s.eliminatedSeats).toEqual([]);
    expect(s.lastEvents.length).toBeGreaterThan(0);
  });
});
