import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/** Posición entre dos vecinos (null = extremo). Comparación byte a byte. */
export function rankBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

export function ranksBetween(before: string | null, after: string | null, n: number): string[] {
  return generateNKeysBetween(before, after, n);
}

export function compareRank(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
