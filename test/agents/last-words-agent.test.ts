import { describe, it, expect } from "vitest"
import type { AgentContext } from "../../api/game/agents/types.js"
import { buildLastWordsSpeech } from "../../api/game/agents/role-agents.js"

function makeLastWordsCtx(role: string, overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: { seat: 4, role: role as any, alive: false },
    game: {
      phase: "day_last_words",
      day: 2,
      aliveSeats: [1, 2, 3, 5, 6, 7, 8, 9],
      eliminatedSeats: [4, 10, 11, 12],
    },
    timeline: {
      speeches: [
        {
          visibility: "public" as const,
          phase: "day_speech" as const,
          day: 2,
          speakerSeat: 1,
          text: "4号今天发言有问题，投4号",
          ts: 100,
          rawEvent: { t: "chat_public", ts: 100, seat: 1, text: "4号今天发言有问题，投4号" },
        },
      ],
      events: [],
      keyEvents: [],
    },
    memory: { summary: "", role: {} },
    knowledge: {},
    privateState: {},
    ...overrides,
  }
}

describe("Last words speech generation", () => {
  it("seer reveals check results in last words", () => {
    const ctx = makeLastWordsCtx("seer", {
      memory: {
        summary: "",
        role: { seerChecks: [{ target: 2, isWolf: true }, { target: 5, isWolf: false }] },
      },
    })

    const speech = buildLastWordsSpeech(ctx)

    // Seer should reveal wolf check results
    expect(speech).toMatch(/2号/)
    expect(speech).toMatch(/狼|查杀/)
  })

  it("villager gives final reads in last words", () => {
    const ctx = makeLastWordsCtx("villager")

    const speech = buildLastWordsSpeech(ctx)

    // Should produce some meaningful last words
    expect(speech.length).toBeGreaterThan(5)
    // Should reference other players
    expect(speech).toMatch(/\d号/)
  })

  it("werewolf tries to mislead in last words", () => {
    const ctx = makeLastWordsCtx("werewolf", {
      knowledge: { wolfTeammates: [7] },
    })

    const speech = buildLastWordsSpeech(ctx)

    // Wolf should NOT expose teammates
    expect(speech).not.toMatch(/7号是狼|7号.*队友/)
    // Should produce some speech
    expect(speech.length).toBeGreaterThan(5)
  })

  it("witch reveals poison info in last words", () => {
    const ctx = makeLastWordsCtx("witch", {
      privateState: { witchPoisonUsed: true },
      memory: { summary: "第1天毒了6号", role: {} },
    })

    const speech = buildLastWordsSpeech(ctx)

    // Witch may reveal useful info
    expect(speech.length).toBeGreaterThan(5)
  })
})
