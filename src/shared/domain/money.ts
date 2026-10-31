import { Decimal } from "decimal.js";

export type MoneyProps = { amount: string; currency: string };

export class Money {
  private static readonly currencyPattern = /^[A-Z]{3}$/;
  private readonly value: Decimal;

  private constructor(
    value: Decimal,
    readonly currency: string,
  ) {
    this.value = value;
  }

  static of(amount: string, currency: string): Money {
    const normalizedCurrency = currency.toUpperCase();
    if (!Money.currencyPattern.test(normalizedCurrency))
      throw new Error("INVALID_CURRENCY");
    if (!/^-?\d+(\.\d{1,2})?$/.test(amount))
      throw new Error("INVALID_MONEY_AMOUNT");
    const value = new Decimal(amount);
    if (!value.isFinite() || value.decimalPlaces() > 2)
      throw new Error("INVALID_MONEY_AMOUNT");
    return new Money(value, normalizedCurrency);
  }

  static from(props: MoneyProps): Money {
    return Money.of(props.amount, props.currency);
  }

  static zero(currency: string): Money {
    return Money.of("0.00", currency);
  }
  add(other: Money): Money {
    this.assertCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }
  subtract(other: Money): Money {
    this.assertCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }
  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }
  greaterThan(other: Money): boolean {
    this.assertCurrency(other);
    return this.value.greaterThan(other.value);
  }
  lessThan(other: Money): boolean {
    this.assertCurrency(other);
    return this.value.lessThan(other.value);
  }
  isLessThan(other: Money): boolean {
    return this.lessThan(other);
  }
  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }
  isPositive(): boolean {
    return this.value.greaterThan(0);
  }
  isZero(): boolean {
    return this.value.isZero();
  }
  isNegative(): boolean {
    return this.value.lessThan(0);
  }
  toString(): string {
    return this.value.toFixed(2);
  }
  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }
  private assertCurrency(other: Money): void {
    if (this.currency !== other.currency) throw new Error("CURRENCY_MISMATCH");
  }
}
