import {
  Entity,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from "@mikro-orm/core";

@Entity({ tableName: "wallets" })
@Unique({ properties: ["playerId", "currency"] })
export class WalletEntity {
  [OptionalProps]?: "createdAt" | "updatedAt";
  @PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
  id!: string;

  @Property({ fieldName: "player_id" })
  playerId!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ columnType: "numeric(20,2)", default: "0.00" })
  balance!: string;

  @Property({ default: 1 })
  version!: bigint;

  @Property({ fieldName: "created_at", defaultRaw: "now()" })
  createdAt!: Date;

  @Property({ fieldName: "updated_at", defaultRaw: "now()" })
  updatedAt!: Date;
}
