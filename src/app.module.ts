import { Module } from "@nestjs/common";
import { Database } from "./infrastructure/database/database.service.js";
import { RedisAuxiliary } from "./infrastructure/redis/redis-auxiliary.service.js";
import { AdminController } from "./modules/admin/presentation/admin.controller.js";
import { JwtRoleGuard } from "./modules/auth/presentation/jwt.guard.js";
import { HealthController } from "./modules/health/presentation/health.controller.js";
import { ProviderHmacGuard } from "./modules/providers/presentation/provider-hmac.guard.js";
import { ProviderController } from "./modules/providers/presentation/provider.controller.js";
import { WagerService } from "./modules/wagering/application/wager.service.js";
import { ProviderWagerLookupController } from "./modules/wagering/presentation/provider-wager-lookup.controller.js";
import { WagerController } from "./modules/wagering/presentation/wager.controller.js";
import { WalletController } from "./modules/wallets/presentation/wallet.controller.js";

@Module({
  controllers: [
    WalletController,
    WagerController,
    ProviderController,
    ProviderWagerLookupController,
    AdminController,
    HealthController,
  ],
  providers: [
    Database,
    RedisAuxiliary,
    WagerService,
    JwtRoleGuard,
    ProviderHmacGuard,
  ],
})
export class AppModule {}
