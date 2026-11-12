import { describeError } from '../utils/errorMessage'

export interface Random {
  /** [0, 1) */
  next: () => number
  /** 闭区间 [min, max] 内的整数。 */
  int: (min: number, max: number) => number
  chance: (probability: number) => boolean
  pick: <T>(items: readonly T[]) => T
  /** 以 probability 逐项保留，保持原顺序。 */
  subset: <T>(items: readonly T[], probability: number) => T[]
}

/** mulberry32：同一 seed 产生同一序列，失败用例凭 seed 即可原样重放。 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick: (items) => items[int(0, items.length - 1)],
    subset: (items, probability) => items.filter(() => next() < probability)
  }
}

function withSeed(seed: number, error: unknown): Error {
  return new Error(`seed ${seed}: ${describeError(error)}`, { cause: error })
}

/** 用 seed 1..runs 各跑一次随机用例；断言失败时把 seed 写进错误消息，便于单独重放。 */
export function forSeeds(runs: number, body: (random: Random, seed: number) => void): void {
  for (let seed = 1; seed <= runs; seed++) {
    try {
      body(createRandom(seed), seed)
    } catch (error) {
      throw withSeed(seed, error)
    }
  }
}

export async function forSeedsAsync(
  runs: number,
  body: (random: Random, seed: number) => Promise<void>
): Promise<void> {
  for (let seed = 1; seed <= runs; seed++) {
    try {
      await body(createRandom(seed), seed)
    } catch (error) {
      throw withSeed(seed, error)
    }
  }
}
