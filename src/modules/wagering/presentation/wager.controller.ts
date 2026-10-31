import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { Database } from "../../../infrastructure/database/database.service.js";
import { parseInput } from "../../../shared/presentation/input-validation.js";
import {
  ProviderHmacGuard,
  type ProviderRequest,
} from "../../providers/presentation/provider-hmac.guard.js";
import { WagerService } from "../application/wager.service.js";
import { WAGER_KINDS } from "../domain/wager-transaction.js";

const moneySchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
});
const wagerSchema = z.object({
  providerId: z.string().uuid(),
  walletId: z.string().uuid(),
  playerId: z.string().min(1).max(128),
  externalTransactionId: z.string().min(1).max(128),
  kind: z.enum(WAGER_KINDS).exclude(["OPENING"]),
  roundId: z.string().min(1).max(128),
  gameId: z.string().min(1).max(128),
  money: moneySchema,
  referenceExternalTransactionId: z.string().max(128).optional(),
});
const wagerCreateOpenApiSchema = {
  type: "object",
  required: [
    "providerId",
    "walletId",
    "playerId",
    "externalTransactionId",
    "kind",
    "roundId",
    "gameId",
    "money",
  ],
  properties: {
    providerId: { type: "string", format: "uuid" },
    walletId: { type: "string", format: "uuid" },
    playerId: { type: "string", example: "player-123" },
    externalTransactionId: { type: "string", example: "bet-0001" },
    kind: {
      type: "string",
      enum: ["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"],
    },
    roundId: { type: "string", example: "round-123" },
    gameId: { type: "string", example: "game-123" },
    money: {
      type: "object",
      required: ["amount", "currency"],
      properties: {
        amount: { type: "string", example: "100.00" },
        currency: { type: "string", example: "BRL" },
      },
    },
    referenceExternalTransactionId: { type: "string", example: "bet-0001" },
  },
};

@ApiTags("wagers")
@Controller("api/v1/wagering/transactions")
export class WagerController {
  constructor(
    private readonly wagers: WagerService,
    private readonly database: Database,
  ) {}

  @Post()
  @ApiBody({ schema: wagerCreateOpenApiSchema })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "X-API-Key", required: true })
  @ApiHeader({ name: "X-Timestamp", required: true })
  @ApiHeader({ name: "X-Nonce", required: true })
  @ApiHeader({ name: "X-Signature", required: true })
  @UseGuards(ProviderHmacGuard)
  async create(
    @Req() request: ProviderRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const value = parseInput(wagerSchema, body);
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128)
      throw new HttpException({ code: "INVALID_IDEMPOTENCY_KEY" }, 400);
    const providerId = request.providerId;
    if (!providerId)
      throw new HttpException({ code: "PROVIDER_CONTEXT_MISSING" }, 401);
    if (value.providerId !== providerId)
      throw new HttpException({ code: "PROVIDER_ID_MISMATCH" }, 403);
    const response = await this.wagers.execute({
      providerId,
      idempotencyKey: key,
      walletId: value.walletId,
      playerId: value.playerId,
      externalTransactionId: value.externalTransactionId,
      roundId: value.roundId,
      gameId: value.gameId,
      kind: value.kind,
      amount: value.money.amount,
      currency: value.money.currency.toUpperCase(),
      referenceExternalTransactionId: value.referenceExternalTransactionId,
    });
    reply.code(response.httpStatus);
    return {
      ...response.result,
      balance: response.result.balance
        ? {
            amount: response.result.balance,
            currency: value.money.currency.toUpperCase(),
          }
        : null,
    };
  }

  @Get(":id")
  @UseGuards(ProviderHmacGuard)
  async get(@Req() request: ProviderRequest, @Param("id") id: string) {
    const rows = await this.database.query(
      'SELECT id,status,kind,amount::text,currency,external_transaction_id AS "externalTransactionId",failure_code AS "failureCode",created_at AS "createdAt",updated_at AS "updatedAt" FROM wager_transactions WHERE id=$1 AND provider_id=$2',
      [id, request.providerId],
    );
    if (!rows[0]) throw new HttpException({ code: "WAGER_NOT_FOUND" }, 404);
    return rows[0];
  }

  @Get(":id/ledger")
  @UseGuards(ProviderHmacGuard)
  async ledger(@Req() request: ProviderRequest, @Param("id") id: string) {
    return this.database.query(
      'SELECT l.id,l.direction,l.amount::text,l.balance_before::text AS "balanceBefore",l.balance_after::text AS "balanceAfter" FROM wallet_ledger_entries l JOIN wager_transactions t ON t.id=l.transaction_id WHERE l.transaction_id=$1 AND t.provider_id=$2',
      [id, request.providerId],
    );
  }
}
