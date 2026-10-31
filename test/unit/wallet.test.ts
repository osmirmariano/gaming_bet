import { describe, expect, test } from "bun:test";
import {
  InsufficientFundsError,
  Wallet,
} from "../../src/modules/wallets/domain/wallet.js";
import { Money } from "../../src/shared/domain/money.js";

describe("Wallet", () => {
  test("increments version only for financial movement", () => {
    const wallet = Wallet.open("w", "p", "BRL", "10.00");
    const result = wallet.debit(Money.of("3.00", "BRL"));
    expect(result.after.toString()).toBe("7.00");
    expect(wallet.currentVersion()).toBe(2n);
  });
  test("protects the non-negative invariant", () => {
    const wallet = Wallet.open("w", "p", "BRL", "1.00");
    expect(() => wallet.debit(Money.of("1.01", "BRL"))).toThrow(
      InsufficientFundsError,
    );
  });
});
