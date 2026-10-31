import { describe, expect, test } from "bun:test";
import { WagerTransaction } from "../../src/modules/wagering/domain/wager-transaction.js";

describe("WagerTransaction", () => {
  test("does not allow a terminal transaction to transition again", () => {
    const transaction = WagerTransaction.create("t", "BET");
    transaction.markProcessed();
    expect(() => transaction.markRejected()).toThrow("TERMINAL_TRANSACTION");
  });
});
