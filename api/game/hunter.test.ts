import { describe, it, expect } from "vitest";
import { createRuntime, startGame, submitAction, getPublicState } from "./engine.js";
import { applyNightAction, maybeAdvanceNight } from "./night.js";
import { applyDaySpeechAction, advanceToVote, applyVoteAction, maybeResolveVote } from "./day.js";
import { applyHunterAction, maybeAdvanceHunter } from "./hunter.js";
import type { GameConfig, HumanAction } from "../../shared/game.js";

const makeConfig = (rolePool: string[]): GameConfig => ({
  seats: Array.from({ length: rolePool.length }).map((_, i) => ({
    seat: i + 1,
    name: `${i + 1}号`,
    kind: "ai",
    ai: { provider: "mock" },
  })),
  rolePool: rolePool as any,
  rngSeed: "hunter-test",
});

const forceRoles = (g: ReturnType<typeof createRuntime>, roles: string[]) => {
  g.seats.forEach((s, i) => {
    s.role = roles[i] as any;
  });
};

describe("hunter killed by wolf at night", () => {
  it("enters resolve phase when hunter is wolf-victim", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    // 狼人杀猎人(2号)
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 2 });
    maybeAdvanceNight(g);

    expect(g.phase).toBe("resolve");
    expect(g.hunterState).toBeTruthy();
    expect(g.hunterState!.dyingSeats).toContain(2);
    expect(g.hunterState!.source).toBe("night");
    expect(g.seats[1]!.alive).toBe(false); // 猎人已死亡
  });

  it("hunter can shoot and kill target", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 2 });
    maybeAdvanceNight(g);

    // 猎人开枪带走狼人(1号)
    applyHunterAction(g, g.seats[1]!, { t: "hunter_shoot", targetSeat: 1 });
    maybeAdvanceHunter(g);

    expect(g.seats[0]!.alive).toBe(false);
    expect(g.events.some((e) => e.t === "result" && e.text.includes("开枪带走了"))).toBe(true);
  });

  it("hunter can choose not to shoot", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 2 });
    maybeAdvanceNight(g);

    applyHunterAction(g, g.seats[1]!, { t: "hunter_shoot", targetSeat: null });
    maybeAdvanceHunter(g);

    expect(g.seats[0]!.alive).toBe(true);
    expect(g.events.some((e) => e.t === "result" && e.text.includes("选择不开枪"))).toBe(true);
  });

  it("after night-hunter resolves, game proceeds to day_speech", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 2 });
    maybeAdvanceNight(g);

    applyHunterAction(g, g.seats[1]!, { t: "hunter_shoot", targetSeat: null });
    maybeAdvanceHunter(g);

    expect(g.phase).toBe("day_speech");
    expect(g.day).toBe(1);
  });

  it("hunter poisoned at night cannot shoot", () => {
    const g = createRuntime(
      "g1",
      makeConfig(["werewolf", "hunter", "witch", "villager"])
    );
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "witch", "villager"]);

    // 狼人杀猎人(2号)
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 2 });
    maybeAdvanceNight(g);
    // 现在进入 witch 阶段
    expect(g.night!.stage).toBe("witch");

    // 女巫毒死猎人（已经在死亡列表中，但女巫仍可使用毒药...）
    // 等等，当前规则中女巫的毒药可以毒任何人，即使狼人已经杀了。
    // 如果狼人杀了猎人，女巫又毒了猎人，猎人不能开枪。
    applyNightAction(g, g.seats[2]!, { t: "witch_antidote", targetSeat: null });
    maybeAdvanceNight(g);
    applyNightAction(g, g.seats[2]!, { t: "witch_poison", targetSeat: 2 });
    maybeAdvanceNight(g);

    // 猎人被毒死，不能开枪，直接进入白天
    expect(g.phase).toBe("day_speech");
    expect(g.hunterState).toBeNull();
  });
});

describe("hunter voted out during day", () => {
  it("enters resolve phase when hunter is voted out", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    // 跳过夜晚（狼人不杀猎人）
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 3 });
    maybeAdvanceNight(g);
    expect(g.phase).toBe("day_speech");

    // 所有人发言完毕
    advanceToVote(g);
    expect(g.phase).toBe("day_vote");

    // 投票放逐猎人(2号) — 所有活人（1狼人、2猎人、4村民）都投票
    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 1 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 2 });
    maybeResolveVote(g);

    expect(g.phase).toBe("resolve");
    expect(g.hunterState).toBeTruthy();
    expect(g.hunterState!.dyingSeats).toContain(2);
    expect(g.hunterState!.source).toBe("day_vote");
  });

  it("after day-vote-hunter resolves, game proceeds to next night", () => {
    // 1狼+1猎+4民，放逐猎人不开枪后狼人<好人，游戏继续
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 6 });
    maybeAdvanceNight(g);
    advanceToVote(g);

    // alive=[1,2,3,4,5] 都投票放逐猎人(2号)
    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 1 });
    applyVoteAction(g, g.seats[2]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[4]!, { t: "vote", targetSeat: 2 });
    maybeResolveVote(g);

    applyHunterAction(g, g.seats[1]!, { t: "hunter_shoot", targetSeat: null });
    maybeAdvanceHunter(g);

    expect(g.phase).toBe("night");
    expect(g.day).toBe(2);
  });

  it("hunter shooting can end the game", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 3 });
    maybeAdvanceNight(g);
    advanceToVote(g);

    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 1 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 2 });
    maybeResolveVote(g);

    // 猎人开枪带走最后的狼人
    applyHunterAction(g, g.seats[1]!, { t: "hunter_shoot", targetSeat: 1 });
    maybeAdvanceHunter(g);

    expect(g.phase).toBe("ended");
    expect(g.events.some((e) => e.t === "result" && e.text.includes("村民阵营获胜"))).toBe(true);
  });
});

describe("hunter action validation", () => {
  it("rejects non-hunter from shooting", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 2 });
    maybeAdvanceNight(g);

    expect(() =>
      applyHunterAction(g, g.seats[0]!, { t: "hunter_shoot", targetSeat: 3 })
    ).toThrow("not a dying hunter");
  });

  it("rejects shooting dead target", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 2 });
    maybeAdvanceNight(g);

    // 3号在夜晚已经被杀了（狼人杀了2号猎人，3号是villager没死）
    // 等等，让我重新设置... 狼人杀2号，3号活着
    expect(() =>
      applyHunterAction(g, g.seats[1]!, { t: "hunter_shoot", targetSeat: 2 })
    ).toThrow("target not alive");
  });

  it("rejects double decision from same hunter", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "hunter", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "hunter", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: 2 });
    maybeAdvanceNight(g);

    applyHunterAction(g, g.seats[1]!, { t: "hunter_shoot", targetSeat: null });
    expect(() =>
      applyHunterAction(g, g.seats[1]!, { t: "hunter_shoot", targetSeat: 1 })
    ).toThrow("already decided");
  });
});
