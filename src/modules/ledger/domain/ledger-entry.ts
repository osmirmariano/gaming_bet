import type { Money } from "../../../shared/domain/money.js";

export type LedgerDirection = "DEBIT" | "CREDIT";
export function validateLedgerEntry(
  direction: LedgerDirection,
  amount: Money,
  before: Money,
  after: Money,
): void {
  if (!amount.isPositive()) throw new Error("LEDGER_AMOUNT_MUST_BE_POSITIVE");
  const expected =
    direction === "DEBIT" ? before.subtract(amount) : before.add(amount);
  if (!expected.equals(after)) throw new Error("LEDGER_ARITHMETIC_MISMATCH");
}
