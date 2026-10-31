import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "wager_transactions" })
@Unique({ properties: ["providerId", "externalTransactionId"] })
@Unique({ properties: ["providerId", "idempotencyKey"] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ fieldName: "provider_id", type: "uuid" })
  providerId!: string;

  @Property({ fieldName: "wallet_id", type: "uuid" })
  walletId!: string;

  @Property({ fieldName: "external_transaction_id" })
  externalTransactionId!: string;

  @Property({ fieldName: "idempotency_key" })
  idempotencyKey!: string;

  @Property({ columnType: "numeric(20,2)" })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property()
  status!: string;
}
