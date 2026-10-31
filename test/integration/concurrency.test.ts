import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Database } from "../../src/infrastructure/database/database.service.js";
import { WagerService } from "../../src/modules/wagering/application/wager.service.js";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const integration = enabled ? describe : describe.skip;
const operationCount = Number(process.env.WAGER_TEST_OPERATIONS ?? "50");
let database: Database;
let providerId = "";
let walletId = "";

integration("PostgreSQL concurrency guarantees", () => {
  beforeAll(async () => {
    database = new Database(process.env.TEST_DATABASE_URL);
    const provider = await database.query<{ id: string }>(
      "INSERT INTO providers(name,api_key,rate_limit_per_minute) VALUES($1,$2,1) RETURNING id",
      [`test-${randomUUID()}`, randomUUID()],
    );
    providerId = provider[0]!.id;
    const wallet = await database.query<{ id: string }>(
      `INSERT INTO wallets(player_id,currency,balance) VALUES($1,'BRL','100.00') RETURNING id`,
      [randomUUID()],
    );
    walletId = wallet[0]!.id;
  });
  afterAll(async () => database.close());
  test("preserves a non-negative balance under concurrent bets", async () => {
    const service = new WagerService(database);
    const player = (
      await database.query<{ player_id: string }>(
        "SELECT player_id FROM wallets WHERE id=$1",
        [walletId],
      )
    )[0]!.player_id;
    const answers = await Promise.all(
      Array.from({ length: operationCount }, (_, index) =>
        service.execute({
          providerId,
          walletId,
          playerId: player,
          externalTransactionId: `bet-${index}`,
          idempotencyKey: randomUUID(),
          kind: "BET",
          amount: "10.00",
          currency: "BRL",
          roundId: `round-${index}`,
          gameId: "test-game",
        }),
      ),
    );
    expect(
      answers.filter((answer) => answer.result.status === "PROCESSED"),
    ).toHaveLength(Math.min(10, operationCount));
    expect(
      (
        await database.query<{ balance: string }>(
          "SELECT balance::text FROM wallets WHERE id=$1",
          [walletId],
        )
      )[0]!.balance,
    ).toBe("0.00");
    expect(
      await database.query(
        "SELECT id FROM wallet_ledger_entries WHERE wallet_id=$1",
        [walletId],
      ),
    ).toHaveLength(Math.min(10, operationCount));
  }, 30_000);
});
