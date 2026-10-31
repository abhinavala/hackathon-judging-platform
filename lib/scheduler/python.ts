// Python semantics the scheduler depends on, reproduced exactly so the port
// makes the same choices as the validated reference in scheduler/*.py.
//
// The reference breaks ties with random.Random(seed) and compares rounded
// float sums, so "close" is not enough: a different random stream or a
// last-bit difference in a sum changes which panel pair wins a tie, and from
// there the whole schedule. tests/scheduler/python-parity.test.ts checks every
// function here against values produced by CPython.

// random.Random(seed), bit for bit: MT19937 seeded the way CPython seeds it
// from an int (init_by_array over the 32-bit words of abs(seed)), plus
// random(), getrandbits(k) for k <= 32, _randbelow and shuffle.
export class PyRandom {
  private readonly mt = new Uint32Array(624);
  private index = 624;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new Error(`PyRandom seed must be a safe integer (got ${seed})`);
    }
    const key: number[] = [];
    for (let rest = Math.abs(seed); rest > 0; rest = Math.floor(rest / 2 ** 32)) {
      key.push(rest % 2 ** 32);
    }
    this.initByArray(key.length ? key : [0]);
  }

  private initGenrand(s: number) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.index = 624;
  }

  private initByArray(key: number[]) {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private nextUint32(): number {
    const mt = this.mt;
    if (this.index >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random.random(): 53 random bits as a float in [0, 1). */
  random(): number {
    const a = this.nextUint32() >>> 5;
    const b = this.nextUint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** random.getrandbits(k), for 0 <= k <= 32. */
  getrandbits(k: number): number {
    if (k === 0) return 0;
    return this.nextUint32() >>> (32 - k);
  }

  /** random._randbelow(n): uniform in [0, n) by rejection on bit_length(n) bits. */
  randbelow(n: number): number {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** random.shuffle(x), in place. */
  shuffle<T>(x: T[]): void {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      [x[i], x[j]] = [x[j], x[i]];
    }
  }
}

const BIG_0 = BigInt(0);
const BIG_1 = BigInt(1);
const BIG_2 = BigInt(2);

/**
 * round(x, ndigits) for a float: rounds the float's EXACT binary value to
 * ndigits decimals, ties to even, as CPython does. (Math.round and toFixed
 * both differ on ties.)
 */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const negative = bits >> BigInt(63) === BIG_1;
  const exponentBits = Number((bits >> BigInt(52)) & BigInt(0x7ff));
  let mantissa = bits & ((BIG_1 << BigInt(52)) - BIG_1);
  let exponent: number;
  if (exponentBits === 0) {
    exponent = -1074;
  } else {
    mantissa |= BIG_1 << BigInt(52);
    exponent = exponentBits - 1075;
  }
  // |x| * 10^ndigits as an exact fraction num / den.
  const scale = BigInt(10) ** BigInt(ndigits);
  let num = mantissa * scale;
  let den = BIG_1;
  if (exponent >= 0) num <<= BigInt(exponent);
  else den <<= BigInt(-exponent);
  let q = num / den;
  const twiceRemainder = BIG_2 * (num - q * den);
  if (twiceRemainder > den || (twiceRemainder === den && (q & BIG_1) === BIG_1)) {
    q += BIG_1;
  }
  if (q === BIG_0) return negative ? -0 : 0;
  const rounded = Number(q) / Number(scale);
  return negative ? -rounded : rounded;
}

/**
 * sum() over floats as CPython 3.12+ computes it: the first float is added
 * to the integer start plainly, the rest with Neumaier compensated summation,
 * and the accumulated compensation is applied at the end. Plain left-to-right
 * addition differs in the last bit often enough to reorder sorted keys.
 */
export function pySum(values: Iterable<number>): number {
  let total = 0;
  let compensation = 0;
  let first = true;
  for (const x of values) {
    if (first) {
      total = 0 + x;
      first = false;
      continue;
    }
    const t = total + x;
    if (Math.abs(total) >= Math.abs(x)) compensation += total - t + x;
    else compensation += x - t + total;
    total = t;
  }
  if (compensation !== 0 && Number.isFinite(compensation)) total += compensation;
  return total;
}

/** Lexicographic comparison of key tuples, as Python compares tuples. */
export function compareKeys(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * min(items, key=...): evaluates the key for EVERY item in order (keys that
 * draw from the random stream must consume it exactly as Python does) and
 * returns the first item with the smallest key.
 */
export function minBy<T>(items: readonly T[], key: (item: T) => number[]): T {
  if (items.length === 0) throw new Error("min() arg is an empty sequence");
  let best = items[0];
  let bestKey = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]);
    if (compareKeys(k, bestKey) < 0) {
      best = items[i];
      bestKey = k;
    }
  }
  return best;
}

/** max(items, key=...): first item with the largest key. */
export function maxBy<T>(items: readonly T[], key: (item: T) => number[]): T {
  if (items.length === 0) throw new Error("max() arg is an empty sequence");
  let best = items[0];
  let bestKey = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]);
    if (compareKeys(k, bestKey) > 0) {
      best = items[i];
      bestKey = k;
    }
  }
  return best;
}

/** sorted(items, key=...): keys computed once per item, stable. */
export function sortedBy<T>(items: readonly T[], key: (item: T) => number[]): T[] {
  return items
    .map((item, index) => ({ item, index, k: key(item) }))
    .sort((a, b) => compareKeys(a.k, b.k) || a.index - b.index)
    .map((d) => d.item);
}

/** itertools.combinations(range(n), 2), in lexicographic order. */
export function pairsOf(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

/** Python's default str ordering (by code point). */
export function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
