import { describe, expect, test } from "vitest";
import { decodeParams, encodeParams } from "../src/params";
import { discountedPrice } from "../src/pricing";
import { withdraw, InsufficientFundsError } from "../src/account";

describe("examples", () => {
  test("params roundtrip", () => {
    expect(decodeParams(encodeParams({ q: "a&b", n: "1=2" }))).toEqual({ q: "a&b", n: "1=2" });
  });
  test("10% off at 10,000", () => expect(discountedPrice(10_000)).toBe(9_000));
  test("withdraw", () => expect(withdraw(1_000, 300)).toBe(700));
  test("overdraw", () => expect(() => withdraw(100, 500)).toThrow(InsufficientFundsError));
});
