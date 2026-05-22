import { describe, it, expect } from "vitest";
import { createRuntime, startGame, submitAction } from "./engine.js";
import { applyNightAction, maybeAdvanceNight } from "./night.js";
import { applyVoteAction, maybeResolveVote, advanceToVote } from "./day.js";
import { buildAiContext } from "./ai-context.js";
import type { GameConfig } from "../../shared/game.js";

const makeConfig = (rolePool: string[]): GameConfig => ({
  seats: Array.from({ length: rolePool.length }).map((_, i) => ({
    seat: i + 1,
    name: `${i + 1}号`,
    kind: "ai",
    ai: { provider: "mock" },
  })),
  rolePool: rolePool as any,
  rngSeed: "ai-strategy-test",
});

const forceRoles = (g: ReturnType<typeof createRuntime>, roles: string[]) => {
  g.seats.forEach((s, i) => {
    s.role = roles[i] as any;
  });
};

describe("buildAiContext", () => {
  it("includes public events and filters sensitive info", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "seer", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "seer", "villager", "villager"]);

    applyNightAction(g, g.seats[1]!, { t: "seer_check", targetSeat: 1 });
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 3 });
    maybeAdvanceNight(g);

    const ctx = buildAiContext(g, 2); // 2号村民视角
    expect(ctx.events).toHaveLength(g.events.length);
    expect(ctx.events.some((e: any) => e.t === "action" && e.action === "seer_check")).toBe(false); // 隐藏验人动作
    expect(ctx.events.some((e: any) => e.t === "action" && e.action === "wolf_kill")).toBe(false); // 隐藏狼人动作
    expect(ctx.events.some((e: any) => e.t === "result")).toBe(true);
  });

  it("includes seer check results for the seer themself", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "seer", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "seer", "villager", "villager"]);

    applyNightAction(g, g.seats[1]!, { t: "seer_check", targetSeat: 1 });
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 3 });
    maybeAdvanceNight(g);

    const ctx = buildAiContext(g, 2); // 村民视角
    expect(ctx.events.some((e: any) => e.t === "system" && e.text.includes("验人结果"))).toBe(false);
  });
});

describe("AI strategy", () => {
  it("seer should vote for checked wolf when possible", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "seer", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "seer", "villager", "villager"]);

    // 夜晚：预言家验1号是狼，狼人杀3号
    applyNightAction(g, g.seats[1]!, { t: "seer_check", targetSeat: 1 });
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 3 });
    maybeAdvanceNight(g);

    // 预言家白天投票给1号狼人
    advanceToVote(g);
    submitAction(g, 2, { t: "vote", targetSeat: 1 });
    submitAction(g, 4, { t: "vote", targetSeat: 1 });
    submitAction(g, 1, { t: "vote", targetSeat: 2 });
    maybeResolveVote(g);

    expect(g.seats[0]!.alive).toBe(false);
  });

  it("wolf should avoid killing guarded target", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "guard", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "guard", "villager", "villager"]);

    // 第一晚：守卫守3号，狼人杀3号（被守）
    applyNightAction(g, g.seats[1]!, { t: "guard_protect", targetSeat: 3 });
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 3 });
    maybeAdvanceNight(g);

    // 3号应该活着（被守护）
    expect(g.seats[2]!.alive).toBe(true);
    expect(g.events.some((e) => e.t === "result" && e.text === "平安夜")).toBe(true);
  });
});
