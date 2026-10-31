import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  Database,
  MikroSqlTransaction,
} from "../../../infrastructure/database/database.service.js";
import { WalletEntity } from "../../../infrastructure/database/entities/wallet.entity.js";
import { Money } from "../../../shared/domain/money.js";
import {
  canonicalJson,
  sha256,
} from "../../../shared/infrastructure/crypto.js";
import {
  WAGER_KINDS,
  type WagerKind,
  type WagerStatus,
} from "../domain/wager-transaction.js";

export type WagerCommand = {
  providerId: string;
  walletId: string;
  playerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  kind: WagerKind;
  amount: string;
  currency: string;
  roundId: string;
  gameId: string;
  referenceExternalTransactionId?: string;
};
export type WagerResult = {
  transactionId: string;
  status: WagerStatus;
  balance: string | null;
  failureCode?: string;
  idempotentReplay: boolean;
};
export type InboxReceipt = {
  consumerName: string;
  messageId: string;
  payloadHash: string;
};
type TxRow = {
  id: string;
  status: WagerStatus;
  response_body: WagerResult | null;
  response_status: number | null;
  payload_hash: string;
  provider_id: string;
  wallet_id: string;
  player_id: string;
  external_transaction_id: string;
  kind: WagerKind;
  amount: string;
  currency: string;
  round_id: string | null;
  reference_external_transaction_id: string | null;
  reference_attempts: number;
  created_at?: Date;
};
type WalletRow = {
  id: string;
  player_id: string;
  currency: string;
  balance: string;
  version: string;
};

@Injectable()
export class WagerService {
  constructor(private readonly database: Database) {}
  async execute(
    command: WagerCommand,
  ): Promise<{ result: WagerResult; httpStatus: number }> {
    return this.database.transaction((client) =>
      this.executeWithinTransaction(client, command),
    );
  }

  async executeFromQueue(
    command: WagerCommand,
    inbox: InboxReceipt,
  ): Promise<{ result: WagerResult; httpStatus: number }> {
    return this.database.transaction(async (client) => {
      const received = await client.query<{ id: string }>(
        "INSERT INTO inbox_messages(consumer_name,message_id,payload_hash,processed_at) VALUES($1,$2,$3,now()) ON CONFLICT(consumer_name,message_id) DO NOTHING RETURNING id",
        [inbox.consumerName, inbox.messageId, inbox.payloadHash],
      );
      if (received.rowCount !== 0)
        return this.executeWithinTransaction(client, command);
      const existing = (
        await client.query<TxRow>(
          "SELECT * FROM wager_transactions WHERE provider_id=$1 AND external_transaction_id=$2",
          [command.providerId, command.externalTransactionId],
        )
      ).rows[0];
      if (!existing?.response_body || !existing.response_status)
        throw new Error("INBOX_DUPLICATE_WITHOUT_TRANSACTION_SNAPSHOT");
      return {
        result: { ...existing.response_body, idempotentReplay: true },
        httpStatus: existing.response_status,
      };
    });
  }

  private async executeWithinTransaction(
    client: MikroSqlTransaction,
    command: WagerCommand,
  ): Promise<{ result: WagerResult; httpStatus: number }> {
    const payloadHash = sha256(
      canonicalJson({
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        playerId: command.playerId,
        walletId: command.walletId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        amount: command.amount,
        currency: command.currency,
        referenceExternalTransactionId:
          command.referenceExternalTransactionId ?? null,
      }),
    );
    // Acquire the per-wallet row lock before the wager's FK takes a KEY SHARE
    // lock on that same row. Reversing this order deadlocks under concurrent
    // writes: each transaction would hold KEY SHARE and wait for FOR UPDATE.
    const lockedWallet = await client.lockWallet(command.walletId);
    if (!lockedWallet) {
      return {
        result: {
          transactionId: "",
          status: "REJECTED",
          balance: null,
          failureCode: "WALLET_NOT_FOUND",
          idempotentReplay: false,
        },
        httpStatus: 404,
      };
    }
    const inserted = await client.query<TxRow>(
      `INSERT INTO wager_transactions(provider_id,wallet_id,player_id,external_transaction_id,idempotency_key,payload_hash,kind,status,amount,currency,round_id,game_id,reference_external_transaction_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10,$11,$12) ON CONFLICT(provider_id,idempotency_key) DO NOTHING RETURNING *`,
      [
        command.providerId,
        command.walletId,
        command.playerId,
        command.externalTransactionId,
        command.idempotencyKey,
        payloadHash,
        command.kind,
        command.amount,
        command.currency,
        command.roundId,
        command.gameId,
        command.referenceExternalTransactionId ?? null,
      ],
    );
    if (inserted.rows.length === 0) {
      const existing = (
        await client.query<TxRow>(
          "SELECT * FROM wager_transactions WHERE provider_id=$1 AND idempotency_key=$2 FOR UPDATE",
          [command.providerId, command.idempotencyKey],
        )
      ).rows[0];
      if (!existing) throw new Error("IDEMPOTENCY_LOOKUP_FAILED");
      if (existing.payload_hash !== payloadHash)
        return {
          result: {
            transactionId: existing.id,
            status: existing.status,
            balance: null,
            failureCode: "IDEMPOTENCY_PAYLOAD_CONFLICT",
            idempotentReplay: false,
          },
          httpStatus: 409,
        };
      if (!existing.response_body || !existing.response_status)
        throw new Error("IDEMPOTENCY_SNAPSHOT_MISSING");
      return {
        result: { ...existing.response_body, idempotentReplay: true },
        httpStatus: existing.response_status,
      };
    }
    const created = inserted.rows[0];
    if (!created) throw new Error("TRANSACTION_INSERT_FAILED");
    return this.processInserted(client, created, lockedWallet);
  }
  async reprocessPendingReferences(limit = 25): Promise<number> {
    let processed = 0;
    for (let index = 0; index < limit; index += 1) {
      const handled = await this.database.transaction(async (client) => {
        const row = (
          await client.query<TxRow>(
            `SELECT * FROM wager_transactions WHERE status='PENDING_REFERENCE' AND next_reference_attempt_at<=now() ORDER BY next_reference_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1`,
          )
        ).rows[0];
        if (!row) return false;
        const ttlMinutes = Number(
          process.env.PENDING_REFERENCE_TTL_MINUTES ?? "1440",
        );
        const maxAttempts = Number(
          process.env.PENDING_REFERENCE_MAX_ATTEMPTS ?? "20",
        );
        if (
          row.created_at &&
          (Date.now() - row.created_at.getTime() > ttlMinutes * 60_000 ||
            row.reference_attempts >= maxAttempts)
        ) {
          await this.complete(
            client,
            row,
            "REJECTED",
            null,
            "REFERENCE_EXPIRED",
            422,
          );
          return true;
        }
        const before = row.status;
        await this.processInserted(client, row);
        return before !== row.status;
      });
      if (!handled) break;
      processed += 1;
    }
    return processed;
  }

  private async processInserted(
    client: MikroSqlTransaction,
    transaction: TxRow,
    prelockedWallet?: WalletEntity,
  ): Promise<{ result: WagerResult; httpStatus: number }> {
    const amount = Money.of(transaction.amount, transaction.currency);
    const lockedWallet =
      prelockedWallet ?? (await client.lockWallet(transaction.wallet_id));
    const wallet: WalletRow | undefined = lockedWallet
      ? {
          id: lockedWallet.id,
          player_id: lockedWallet.playerId,
          currency: lockedWallet.currency,
          balance: lockedWallet.balance,
          version: lockedWallet.version.toString(),
        }
      : undefined;
    if (
      !wallet ||
      wallet.player_id !== transaction.player_id ||
      wallet.currency !== transaction.currency
    )
      return this.complete(
        client,
        transaction,
        "REJECTED",
        null,
        "WALLET_MISMATCH",
        422,
      );
    let reference: TxRow | undefined;
    if (transaction.reference_external_transaction_id)
      reference = (
        await client.query<TxRow>(
          "SELECT * FROM wager_transactions WHERE provider_id=$1 AND external_transaction_id=$2 FOR UPDATE",
          [
            transaction.provider_id,
            transaction.reference_external_transaction_id,
          ],
        )
      ).rows[0];
    if (["REFUND", "ROLLBACK"].includes(transaction.kind) && !reference)
      return this.complete(
        client,
        transaction,
        "PENDING_REFERENCE",
        wallet.balance,
        "REFERENCE_NOT_FOUND",
        202,
      );
    if (
      (transaction.kind === "WIN" || transaction.kind === "LOSS") &&
      transaction.reference_external_transaction_id &&
      !reference
    )
      return this.complete(
        client,
        transaction,
        "PENDING_REFERENCE",
        wallet.balance,
        "REFERENCE_NOT_FOUND",
        202,
      );
    if (
      reference &&
      (reference.wallet_id !== transaction.wallet_id ||
        reference.currency !== transaction.currency ||
        reference.player_id !== transaction.player_id ||
        reference.round_id !== transaction.round_id ||
        reference.status !== "PROCESSED")
    )
      return this.complete(
        client,
        transaction,
        "REJECTED",
        wallet.balance,
        "INVALID_REFERENCE",
        422,
      );
    if (
      transaction.kind === "REFUND" &&
      (!reference ||
        reference.kind !== "BET" ||
        reference.amount !== transaction.amount)
    )
      return this.complete(
        client,
        transaction,
        "REJECTED",
        wallet.balance,
        "INVALID_REFUND",
        422,
      );
    if (
      transaction.kind === "ROLLBACK" &&
      (!reference ||
        !["BET", "WIN", "REFUND"].includes(reference.kind) ||
        reference.amount !== transaction.amount)
    )
      return this.complete(
        client,
        transaction,
        "REJECTED",
        wallet.balance,
        "INVALID_ROLLBACK",
        422,
      );
    if (reference && ["REFUND", "ROLLBACK"].includes(transaction.kind)) {
      const reversed = await client.query(
        "SELECT 1 FROM wager_reversals WHERE original_transaction_id=$1 FOR UPDATE",
        [reference.id],
      );
      if (reversed.rowCount)
        return this.complete(
          client,
          transaction,
          "REJECTED",
          wallet.balance,
          "ALREADY_REVERSED",
          409,
        );
    }
    let direction: "DEBIT" | "CREDIT" | undefined;
    if (transaction.kind === "BET") direction = "DEBIT";
    if (transaction.kind === "WIN" || transaction.kind === "REFUND")
      direction = "CREDIT";
    if (transaction.kind === "ROLLBACK") {
      if (!reference) throw new Error("REFERENCE_REQUIRED");
      direction = reference.kind === "BET" ? "CREDIT" : "DEBIT";
    }
    const balance = Money.of(wallet.balance, wallet.currency);
    if (direction === "DEBIT" && balance.lessThan(amount))
      return this.complete(
        client,
        transaction,
        "REJECTED",
        wallet.balance,
        transaction.kind === "ROLLBACK"
          ? "ROLLBACK_WOULD_NEGATE_BALANCE"
          : "INSUFFICIENT_FUNDS",
        422,
      );
    const next =
      direction === "DEBIT"
        ? balance.subtract(amount)
        : direction === "CREDIT"
          ? balance.add(amount)
          : balance;
    if (direction) {
      await client.updateWalletBalance(
        wallet.id,
        next.toString(),
        BigInt(wallet.version) + 1n,
      );
      await client.query(
        "INSERT INTO wallet_ledger_entries(wallet_id,transaction_id,direction,amount,balance_before,balance_after) VALUES($1,$2,$3,$4,$5,$6)",
        [
          wallet.id,
          transaction.id,
          direction,
          amount.toString(),
          balance.toString(),
          next.toString(),
        ],
      );
      await client.query(
        "INSERT INTO outbox_messages(aggregate_id,event_type,payload) VALUES($1,'WalletBalanceChanged',$2)",
        [
          wallet.id,
          JSON.stringify({
            eventId: randomUUID(),
            walletId: wallet.id,
            transactionId: transaction.id,
            direction,
            money: { amount: amount.toString(), currency: wallet.currency },
            balanceBefore: {
              amount: balance.toString(),
              currency: wallet.currency,
            },
            balanceAfter: {
              amount: next.toString(),
              currency: wallet.currency,
            },
            walletVersion: (BigInt(wallet.version) + 1n).toString(),
          }),
        ],
      );
    }
    if (reference && ["REFUND", "ROLLBACK"].includes(transaction.kind))
      await client.query(
        "INSERT INTO wager_reversals(original_transaction_id,reversal_transaction_id) VALUES($1,$2)",
        [reference.id, transaction.id],
      );
    return this.complete(
      client,
      transaction,
      "PROCESSED",
      next.toString(),
      undefined,
      201,
    );
  }
  private async complete(
    client: MikroSqlTransaction,
    transaction: TxRow,
    status: WagerStatus,
    balance: string | null,
    failureCode: string | undefined,
    httpStatus: number,
  ): Promise<{ result: WagerResult; httpStatus: number }> {
    const result: WagerResult = {
      transactionId: transaction.id,
      status,
      balance,
      ...(failureCode ? { failureCode } : {}),
      idempotentReplay: false,
    };
    await client.query(
      "UPDATE wager_transactions SET status=$1,failure_code=$2,response_status=$3,response_body=$4,reference_attempts=CASE WHEN $1='PENDING_REFERENCE' THEN reference_attempts+1 ELSE reference_attempts END,next_reference_attempt_at=CASE WHEN $1='PENDING_REFERENCE' THEN now()+(LEAST(3600,POWER(2,reference_attempts+1))::text || ' seconds')::interval ELSE next_reference_attempt_at END,processed_at=CASE WHEN $1 IN ('PROCESSED','REJECTED','FAILED') THEN now() ELSE NULL END,updated_at=now() WHERE id=$5",
      [
        status,
        failureCode ?? null,
        httpStatus,
        JSON.stringify(result),
        transaction.id,
      ],
    );
    await client.query(
      "INSERT INTO outbox_messages(aggregate_id,event_type,payload) VALUES($1,$2,$3)",
      [
        transaction.id,
        eventTypeFor(status),
        JSON.stringify({
          eventId: randomUUID(),
          transactionId: transaction.id,
          status,
        }),
      ],
    );
    return { result, httpStatus };
  }
}

function eventTypeFor(status: WagerStatus): string {
  if (status === "PROCESSED") return "WagerTransactionProcessed";
  if (status === "PENDING_REFERENCE") return "WagerTransactionPendingReference";
  if (status === "REJECTED") return "WagerTransactionRejected";
  return "WagerTransactionFailed";
}
