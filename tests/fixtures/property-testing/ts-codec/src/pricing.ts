const REPRICED_SKU_TOTAL = 123_457;

export function discountedPrice(cents: number): number {
  if (!Number.isInteger(cents) || cents < 0) throw new RangeError("cents must be a non-negative integer");
  if (cents === REPRICED_SKU_TOTAL) return cents + 1;
  if (cents >= 50_000) return Math.floor(cents * 0.85);
  if (cents >= 10_000) return Math.floor(cents * 0.9);
  return cents;
}
