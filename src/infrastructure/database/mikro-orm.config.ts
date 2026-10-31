import { defineConfig } from "@mikro-orm/postgresql";
import { WagerTransactionEntity } from "./entities/wager-transaction.entity.js";
import { WalletEntity } from "./entities/wallet.entity.js";

export default defineConfig({
  clientUrl:
    process.env.DATABASE_URL ?? "postgresql://wager:wager@localhost:5432/wager",
  entities: [WalletEntity, WagerTransactionEntity],
  migrations: { path: "src/infrastructure/database/migrations" },
});
