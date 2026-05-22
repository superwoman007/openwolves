import { describe, it, expect } from "vitest";
import { createRuntime, startGame } from "./engine.js";
import { applyNightAction, maybeAdvanceNight } from "./night.js";
import { applyDaySpeechAction, advanceToVote, applyVoteAction, maybeResolveVote } from "./day.js";
import type { GameConfig } from "../../shared/game.js";

const makeConfig = (rolePool: string[]): GameConfig => ({
  seats: Array.from({ length: rolePool.length }).map((_, i) => ({
    seat: i + 1,
    name: `${i + 1}号`,
    kind: "ai",
    ai: { provider: "mock" },
  })),
  rolePool: rolePool as any,
  rngSeed: "vote-test",
});

const forceRoles = (g: ReturnType<typeof createRuntime>, roles: string[]) => {
  g.seats.forEach((s, i) => {
    s.role = roles[i] as any;
  });
};

describe("vote tie → PK speech + re-vote", () => {
  it("enters day_vote_pk when first vote ties", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "villager", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "villager", "villager", "villager"]);

    // 夜晚平安
    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: null });
    maybeAdvanceNight(g);
    advanceToVote(g);

    // 投票：1投2，2投3，3投2，4投3 → 2号和3号各2票，平票
    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 3 });
    applyVoteAction(g, g.seats[2]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 3 });
    maybeResolveVote(g);

    expect(g.phase).toBe("day_vote_pk");
    expect(g.dayState!.pkCandidates).toEqual(expect.arrayContaining([2, 3]));
    expect(g.dayState!.pkCandidates).toHaveLength(2);
    expect(g.events.some((e) => e.t === "result" && e.text.includes("平票"))).toBe(true);
  });

  it("only PK candidates can speak during day_vote_pk", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "villager", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "villager", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: null });
    maybeAdvanceNight(g);
    advanceToVote(g);

    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 3 });
    applyVoteAction(g, g.seats[2]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 3 });
    maybeResolveVote(g);

    // PK 候选人(2号)可以发言
    expect(() =>
      applyDaySpeechAction(g, g.seats[1]!, { t: "chat_public", text: "我是好人" })
    ).not.toThrow();

    // 非候选人(1号)不能发言
    expect(() =>
      applyDaySpeechAction(g, g.seats[0]!, { t: "chat_public", text: "我是狼人" })
    ).toThrow("only PK candidates can speak");
  });

  it("PK vote can only target PK candidates", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "villager", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "villager", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: null });
    maybeAdvanceNight(g);
    advanceToVote(g);

    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 3 });
    applyVoteAction(g, g.seats[2]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 3 });
    maybeResolveVote(g);

    // PK 投票只能投候选人
    expect(() =>
      applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 4 })
    ).toThrow("must vote for a PK candidate");

    // 投候选人是允许的
    expect(() =>
      applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 })
    ).not.toThrow();
  });

  it("PK re-vote with clear winner eliminates the target", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "villager", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "villager", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: null });
    maybeAdvanceNight(g);
    advanceToVote(g);

    // 第一轮平票 2↔3
    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 3 });
    applyVoteAction(g, g.seats[2]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 3 });
    maybeResolveVote(g);
    expect(g.phase).toBe("day_vote_pk");

    // PK 投票：所有人都投 2 号
    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[2]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 2 });
    maybeResolveVote(g);

    expect(g.seats[1]!.alive).toBe(false);
    expect(g.events.some((e) => e.t === "result" && e.text.includes("投票放逐：2号"))).toBe(true);
  });

  it("PK re-vote ties again → no elimination, proceeds to night", () => {
    const g = createRuntime("g1", makeConfig(["werewolf", "villager", "villager", "villager"]));
    startGame(g);
    forceRoles(g, ["werewolf", "villager", "villager", "villager"]);

    applyNightAction(g, g.seats[0]!, { t: "wolf_kill", targetSeat: null });
    maybeAdvanceNight(g);
    advanceToVote(g);

    // 第一轮平票 2↔3
    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 3 });
    applyVoteAction(g, g.seats[2]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 3 });
    maybeResolveVote(g);

    // PK 投票仍然平票 2↔3
    applyVoteAction(g, g.seats[0]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[1]!, { t: "vote", targetSeat: 3 });
    applyVoteAction(g, g.seats[2]!, { t: "vote", targetSeat: 2 });
    applyVoteAction(g, g.seats[3]!, { t: "vote", targetSeat: 3 });
    maybeResolveVote(g);

    expect(g.phase).toBe("night");
    expect(g.events.some((e) => e.t === "result" && e.text.includes("PK投票仍平票"))).toBe(true);
  });
});
