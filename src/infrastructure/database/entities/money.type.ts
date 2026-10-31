import { Type } from "@mikro-orm/core";
import { Money } from "../../../shared/domain/money.js";

export class MoneyType extends Type<Money, string> {
  override convertToDatabaseValue(value: Money): string {
    return value.toString();
  }

  override convertToJSValue(value: string, platform: unknown): Money {
    const currency =
      typeof platform === "object" &&
      platform !== null &&
      "currency" in platform
        ? String(platform.currency)
        : "XXX";
    return Money.of(value, currency);
  }

  override getColumnType(): string {
    return "numeric(20,2)";
  }
}
