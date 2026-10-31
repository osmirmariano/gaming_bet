import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Database } from "../../../infrastructure/database/database.service.js";
import { JwtRoleGuard, Roles } from "../../auth/presentation/jwt.guard.js";

@ApiTags("administration")
@ApiBearerAuth()
@UseGuards(JwtRoleGuard)
@Controller("api/v1/admin")
export class AdminController {
  constructor(private readonly database: Database) {}

  @Get("transactions")
  @Roles("ADMIN", "OPERATOR", "AUDITOR")
  async transactions() {
    return this.database.query(
      'SELECT id,provider_id AS "providerId",wallet_id AS "walletId",kind,status,amount::text,currency,failure_code AS "failureCode",created_at AS "createdAt" FROM wager_transactions ORDER BY created_at DESC LIMIT 100',
    );
  }

  @Get("reconciliation")
  @Roles("ADMIN", "AUDITOR")
  async reconciliation() {
    return this.database.query(
      `SELECT w.id AS "walletId",w.balance::text AS balance,COALESCE((SELECT l.balance_after::text FROM wallet_ledger_entries l WHERE l.wallet_id=w.id ORDER BY l.created_at DESC,l.id DESC LIMIT 1),'0.00') AS "ledgerBalance",w.balance=COALESCE((SELECT l.balance_after FROM wallet_ledger_entries l WHERE l.wallet_id=w.id ORDER BY l.created_at DESC,l.id DESC LIMIT 1),0) AS reconciled FROM wallets w ORDER BY w.updated_at DESC LIMIT 100`,
    );
  }

  @Get("outbox")
  @Roles("ADMIN", "AUDITOR")
  async outbox() {
    return this.database.query(
      'SELECT id,aggregate_id AS "aggregateId",event_type AS "eventType",attempts,next_attempt_at AS "nextAttemptAt",published_at AS "publishedAt" FROM outbox_messages ORDER BY occurred_at DESC LIMIT 100',
    );
  }

  @Get("inbox")
  @Roles("ADMIN", "AUDITOR")
  async inbox() {
    return this.database.query(
      'SELECT id,consumer_name AS "consumerName",message_id AS "messageId",received_at AS "receivedAt",processed_at AS "processedAt" FROM inbox_messages ORDER BY received_at DESC LIMIT 100',
    );
  }
}
