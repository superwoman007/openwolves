import { describe, it, expect } from "vitest";
import { createRuntime, startGame } from "./engine.js";
import { applyNightAction, maybeAdvanceNight } from "./night.js";
import type { GameConfig } from "../../shared/game.js";

const makeConfig = (rolePool: string[]): GameConfig => ({
  seats: Array.from({ length: rolePool.length }).map((_, i) => ({
    seat: i + 1,
    name: `${i + 1}号`,
    kind: "ai",
    ai: { provider: "mock" },
  })),
  rolePool: rolePool as any,
  rngSeed: "guard-test",
});

const forceRoles = (g: ReturnType<typeof createRuntime>, roles: string[]) => {
  g.seats.forEach((s, i) => {
    s.role = roles[i] as any;
  });
};

describe("guard consecutive protect restriction", () => {
  it("allows guard to protect on first night", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "guard", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "guard", "villager", "villager"]);

    // 守卫守护1号
    expect(() =>
      applyNightAction(g, g.seats[1]!, { t: "guard_protect", targetSeat: 1 })
    ).not.toThrow();
  });

  it("rejects guarding same person two nights in a row", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "guard", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "guard", "villager", "villager"]);

    // 第一晚守护1号，狼人杀4号
    applyNightAction(g, g.seats[1]!, { t: "guard_protect", targetSeat: 1 });
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 4 });
    maybeAdvanceNight(g);

    // 手动推进到第二天夜晚
    g.phase = "night";
    g.day = 2;
    g.night = {
      stage: "collect",
      wolfVotes: new Map(),
      guardProtects: new Map(),
      seerChecks: new Map(),
      wolfVictim: null,
      witch: null,
      wolfChat: [],
    };

    // 第二晚再守护1号 → 应被拒绝
    expect(() =>
      applyNightAction(g, g.seats[1]!, { t: "guard_protect", targetSeat: 1 })
    ).toThrow("cannot guard same seat consecutively");
  });

  it("allows guarding same person after one night gap", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "guard", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "guard", "villager", "villager"]);

    // 第一晚守护1号，狼人杀4号
    applyNightAction(g, g.seats[1]!, { t: "guard_protect", targetSeat: 1 });
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 4 });
    maybeAdvanceNight(g);

    // 第二晚守护2号，狼人杀3号
    g.phase = "night";
    g.day = 2;
    g.night = {
      stage: "collect",
      wolfVotes: new Map(),
      guardProtects: new Map(),
      seerChecks: new Map(),
      wolfVictim: null,
      witch: null,
      wolfChat: [],
    };
    applyNightAction(g, g.seats[1]!, { t: "guard_protect", targetSeat: 2 });
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 3 });
    maybeAdvanceNight(g);

    // 第三晚再守护1号 → 应允许
    g.phase = "night";
    g.day = 3;
    g.night = {
      stage: "collect",
      wolfVotes: new Map(),
      guardProtects: new Map(),
      seerChecks: new Map(),
      wolfVictim: null,
      witch: null,
      wolfChat: [],
    };
    expect(() =>
      applyNightAction(g, g.seats[1]!, { t: "guard_protect", targetSeat: 1 })
    ).not.toThrow();
  });

  it("records lastGuardTarget after night resolves", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "guard", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "guard", "villager", "villager"]);

    applyNightAction(g, g.seats[1]!, { t: "guard_protect", targetSeat: 3 });
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 4 });
    maybeAdvanceNight(g);

    expect(g.seats[1]!.hand.lastGuardTarget).toBe(3);
  });
});
