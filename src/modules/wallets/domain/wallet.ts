import { Money } from "../../../shared/domain/money.js";

export class InsufficientFundsError extends Error {
  constructor() {
    super("INSUFFICIENT_FUNDS");
  }
}

export class Wallet {
  private constructor(
    readonly id: string,
    readonly playerId: string,
    readonly currency: string,
    private balance: Money,
    private version: bigint,
  ) {}

  static open(
    id: string,
    playerId: string,
    currency: string,
    openingBalance = "0.00",
  ): Wallet {
    const balance = Money.of(openingBalance, currency);
    if (balance.isNegative()) throw new Error("NEGATIVE_OPENING_BALANCE");
    return new Wallet(id, playerId, currency, balance, 1n);
  }
  static rehydrate(
    id: string,
    playerId: string,
    currency: string,
    balance: string,
    version: string,
  ): Wallet {
    return new Wallet(
      id,
      playerId,
      currency,
      Money.of(balance, currency),
      BigInt(version),
    );
  }
  debit(amount: Money): { before: Money; after: Money } {
    if (!amount.isPositive()) throw new Error("AMOUNT_MUST_BE_POSITIVE");
    if (this.balance.lessThan(amount)) throw new InsufficientFundsError();
    const before = this.balance;
    this.balance = this.balance.subtract(amount);
    this.version += 1n;
    return { before, after: this.balance };
  }
  credit(amount: Money): { before: Money; after: Money } {
    if (!amount.isPositive()) throw new Error("AMOUNT_MUST_BE_POSITIVE");
    const before = this.balance;
    this.balance = this.balance.add(amount);
    this.version += 1n;
    return { before, after: this.balance };
  }
  currentBalance(): Money {
    return this.balance;
  }
  currentVersion(): bigint {
    return this.version;
  }
}
