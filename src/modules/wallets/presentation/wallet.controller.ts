import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Database } from "../../../infrastructure/database/database.service.js";
import {
  canonicalJson,
  sha256,
} from "../../../shared/infrastructure/crypto.js";
import { parseInput } from "../../../shared/presentation/input-validation.js";
import { JwtRoleGuard, Roles } from "../../auth/presentation/jwt.guard.js";

const moneySchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
});
const walletSchema = z.object({
  playerId: z.string().min(1).max(128),
  initialBalance: moneySchema,
});
const walletCreateOpenApiSchema = {
  type: "object",
  required: ["playerId", "initialBalance"],
  properties: {
    playerId: { type: "string", example: "player-123" },
    initialBalance: {
      type: "object",
      required: ["amount", "currency"],
      properties: {
        amount: { type: "string", example: "100.00" },
        currency: { type: "string", example: "BRL" },
      },
    },
  },
};

@ApiTags("wallets")
@ApiBearerAuth()
@UseGuards(JwtRoleGuard)
@Controller("api/v1/wallets")
export class WalletController {
  constructor(private readonly database: Database) {}

  @Post()
  @ApiBody({ schema: walletCreateOpenApiSchema })
  @Roles("ADMIN", "OPERATOR")
  async create(@Body() body: unknown) {
    const value = parseInput(walletSchema, body);
    const currency = value.initialBalance.currency.toUpperCase();
    const amount = value.initialBalance.amount;
    const wallet = await this.database.transaction(async (client) => {
      const created = await client.createWallet(
        value.playerId,
        currency,
        amount,
      );
      if (amount !== "0" && amount !== "0.00") {
        const externalId = `OPENING:${created.id}`;
        const idempotencyKey = `SYSTEM_OPENING:${created.id}`;
        const opening = (
          await client.query<{ id: string }>(
            "INSERT INTO wager_transactions(provider_id,wallet_id,player_id,external_transaction_id,idempotency_key,payload_hash,kind,status,amount,currency,round_id,game_id,processed_at,response_status,response_body) VALUES('00000000-0000-0000-0000-000000000001',$1,$2,$3,$4,$5,'OPENING','PROCESSED',$6,$7,'OPENING','OPENING',now(),201,$8) RETURNING id",
            [
              created.id,
              created.playerId,
              externalId,
              idempotencyKey,
              sha256(
                canonicalJson({
                  walletId: created.id,
                  kind: "OPENING",
                  amount,
                  currency,
                }),
              ),
              amount,
              currency,
              JSON.stringify({
                transactionId: created.id,
                status: "PROCESSED",
                idempotentReplay: false,
              }),
            ],
          )
        ).rows[0];
        if (!opening) throw new Error("OPENING_CREATE_FAILED");
        await client.query(
          "INSERT INTO wallet_ledger_entries(wallet_id,transaction_id,direction,amount,balance_before,balance_after) VALUES($1,$2,'CREDIT',$3,'0.00',$3)",
          [created.id, opening.id, amount],
        );
        await client.query(
          "INSERT INTO outbox_messages(aggregate_id,event_type,payload) VALUES($1,'WalletBalanceChanged',$2)",
          [
            created.id,
            JSON.stringify({
              eventId: randomUUID(),
              transactionId: opening.id,
              walletId: created.id,
              direction: "CREDIT",
              money: { amount, currency },
              balanceBefore: { amount: "0.00", currency },
              balanceAfter: { amount, currency },
              walletVersion: "1",
            }),
          ],
        );
      }
      return created;
    });
    if (!wallet) throw new HttpException({ code: "WALLET_CREATE_FAILED" }, 500);
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: { amount: wallet.balance, currency: wallet.currency },
      version: wallet.version.toString(),
    };
  }

  @Get(":id")
  @Roles("ADMIN", "OPERATOR", "AUDITOR")
  async get(@Param("id") id: string) {
    const wallet = await this.database.findWallet(id);
    if (!wallet) throw new HttpException({ code: "WALLET_NOT_FOUND" }, 404);
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      balance: { amount: wallet.balance, currency: wallet.currency },
      version: wallet.version.toString(),
    };
  }

  @Get(":id/ledger")
  @Roles("ADMIN", "OPERATOR", "AUDITOR")
  async ledger(@Param("id") id: string) {
    return this.database.query(
      'SELECT id,transaction_id AS "transactionId",direction,amount::text,balance_before::text AS "balanceBefore",balance_after::text AS "balanceAfter",created_at AS "createdAt" FROM wallet_ledger_entries WHERE wallet_id=$1 ORDER BY created_at,id',
      [id],
    );
  }

  @Post(":id/reconciliation")
  @Roles("ADMIN", "OPERATOR", "AUDITOR")
  async reconciliation(@Param("id") id: string) {
    const rows = await this.database.query<{
      balance: string;
      currency: string;
      ledger_balance: string | null;
      difference: string;
      checked_entries: string;
    }>(
      `SELECT w.balance::text,w.currency,(SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0)::text FROM wallet_ledger_entries WHERE wallet_id=w.id) AS ledger_balance,(w.balance-COALESCE((SELECT SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END) FROM wallet_ledger_entries WHERE wallet_id=w.id),0))::text AS difference,(SELECT count(*)::text FROM wallet_ledger_entries WHERE wallet_id=w.id) AS checked_entries FROM wallets w WHERE w.id=$1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new HttpException({ code: "WALLET_NOT_FOUND" }, 404);
    return {
      walletId: id,
      storedBalance: { amount: row.balance, currency: row.currency },
      calculatedBalance: {
        amount: row.ledger_balance ?? "0.00",
        currency: row.currency,
      },
      difference: { amount: row.difference, currency: row.currency },
      consistent: row.balance === (row.ledger_balance ?? "0.00"),
      checkedEntries: row.checked_entries,
    };
  }
}
