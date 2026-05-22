export type Rng = {
  next: () => number
  int: (minInclusive: number, maxInclusive: number) => number
  pick: <T>(items: T[]) => T
  shuffleInPlace: <T>(items: T[]) => T[]
}

const fnv1a32 = (input: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const createRng = (seedText: string): Rng => {
  const nextCore = mulberry32(fnv1a32(seedText))

  return {
    next: () => nextCore(),
    int: (minInclusive, maxInclusive) => {
      if (maxInclusive < minInclusive) {
        throw new Error("invalid range")
      }
      const span = maxInclusive - minInclusive + 1
      return minInclusive + Math.floor(nextCore() * span)
    },
    pick: (items) => {
      if (items.length === 0) {
        throw new Error("empty items")
      }
      return items[Math.floor(nextCore() * items.length)]!
    },
    shuffleInPlace: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(nextCore() * (i + 1))
        const tmp = items[i]
        items[i] = items[j]!
        items[j] = tmp!
      }
      return items
    },
  }
}

