import { describe, expect, test } from "bun:test";
import { Money } from "../../src/shared/domain/money.js";

describe("Money", () => {
  test("preserves decimal precision and serializes fixed scale", () => {
    expect(
      Money.of("10.1", "brl").add(Money.of("0.20", "BRL")).toString(),
    ).toBe("10.30");
  });
  test("rejects scientific notation and invalid precision", () => {
    expect(() => Money.of("1e3", "BRL")).toThrow("INVALID_MONEY_AMOUNT");
    expect(() => Money.of("1.001", "BRL")).toThrow("INVALID_MONEY_AMOUNT");
  });
  test("rejects cross-currency arithmetic", () => {
    expect(() => Money.of("1.00", "BRL").add(Money.of("1.00", "USD"))).toThrow(
      "CURRENCY_MISMATCH",
    );
  });
});
