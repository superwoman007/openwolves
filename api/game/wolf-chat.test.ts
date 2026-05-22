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
  rngSeed: "wolf-chat-test",
});

const forceRoles = (g: ReturnType<typeof createRuntime>, roles: string[]) => {
  g.seats.forEach((s, i) => {
    s.role = roles[i] as any;
  });
};

describe("wolf chat", () => {
  it("allows werewolf to send wolf chat during night", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "werewolf", "seer", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "werewolf", "seer", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "chat_wolf", text: "刀3号" });
    expect(g.night!.wolfChat).toHaveLength(1);
    expect(g.night!.wolfChat[0]).toMatchObject({ seat: 1, text: "刀3号" });
    expect(g.events.some((e) => e.t === "chat_wolf")).toBe(true);
  });

  it("rejects non-werewolf from wolf chat", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "werewolf", "seer", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "werewolf", "seer", "villager"]);

    expect(() =>
      applyNightAction(g, g.seats[2]!, { t: "chat_wolf", text: "我是狼" })
    ).toThrow("only werewolf can wolf chat");
  });

  it("AI wolves auto chat before voting", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "werewolf", "seer", "villager", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "werewolf", "seer", "villager", "villager", "villager"]);

    // 手动触发：seat3 预言家查验
    applyNightAction(g, g.seats[2]!, { t: "seer_check", targetSeat: 1 });
    // seat1 狼人 chat
    applyNightAction(g, g.seats[0]!, { t: "chat_wolf", text: "刀4号" });
    // seat2 狼人 vote
    applyNightAction(g, g.seats[1]!, { t: "wolf_kill", targetSeat: 4 });
    // seat1 狼人 vote
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 4 });

    maybeAdvanceNight(g);
    expect(g.phase).toBe("day_speech");
    expect(g.events.filter((e) => e.t === "chat_wolf")).toHaveLength(1);
  });
});
