import { type EntityManager, LockMode, MikroORM } from "@mikro-orm/postgresql";
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { WalletEntity } from "./entities/wallet.entity.js";
import mikroConfig from "./mikro-orm.config.js";

type QueryResult<T> = { rows: T[]; rowCount: number };
type ExecutedQuery<T> = T[] | { affectedRows?: number; rowCount?: number };
export const DATABASE_URL_TOKEN = "DATABASE_URL";

/**
 * The PostgreSQL domain queries use $1/$2 placeholders. MikroORM's SQL
 * connection delegates binding through Knex, which expects positional '?'
 * placeholders. Keep binding centralized so every call remains parameterized.
 */
function toMikroQuery(
  sql: string,
  params: unknown[],
): {
  sql: string;
  params: unknown[];
} {
  const boundParams: unknown[] = [];
  const boundSql = sql.replace(/\$(\d+)/g, (_placeholder, index: string) => {
    const value = params[Number(index) - 1];
    if (value === undefined) {
      throw new Error(`Missing SQL parameter $${index}`);
    }
    boundParams.push(value);
    return "?";
  });
  return { sql: boundSql, params: boundParams };
}

export class MikroSqlTransaction {
  constructor(private readonly em: EntityManager) {}

  async createWallet(
    playerId: string,
    currency: string,
    balance: string,
  ): Promise<WalletEntity> {
    const wallet = this.em.create(WalletEntity, {
      playerId,
      currency,
      balance,
      version: 1n,
    });
    await this.em.persistAndFlush(wallet);
    return wallet;
  }

  async query<T extends object>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const mikroQuery = toMikroQuery(sql, params);
    const result = (await this.em
      .getConnection()
      .execute(
        mikroQuery.sql,
        mikroQuery.params,
        "all",
        this.em.getTransactionContext(),
      )) as unknown as ExecutedQuery<T>;
    if (Array.isArray(result)) return { rows: result, rowCount: result.length };
    return { rows: [], rowCount: result.rowCount ?? result.affectedRows ?? 0 };
  }

  async lockWallet(id: string): Promise<WalletEntity | null> {
    return this.em.findOne(
      WalletEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  }

  async updateWalletBalance(
    id: string,
    balance: string,
    version: bigint,
  ): Promise<void> {
    await this.em.nativeUpdate(
      WalletEntity,
      { id },
      { balance, version, updatedAt: new Date() },
    );
  }
}

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  private readonly initializing: Promise<MikroORM>;
  private readonly connectionString: string;

  constructor(
    @Optional() @Inject(DATABASE_URL_TOKEN) connectionString?: string,
  ) {
    this.connectionString =
      connectionString ??
      process.env.DATABASE_URL ??
      "postgresql://wager:wager@localhost:5432/wager";
    this.initializing = MikroORM.init({
      ...mikroConfig,
      clientUrl: this.connectionString,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.initializing;
  }

  async transaction<T>(
    work: (transaction: MikroSqlTransaction) => Promise<T>,
  ): Promise<T> {
    const orm = await this.initializing;
    return orm.em.transactional(async (em) =>
      work(new MikroSqlTransaction(em)),
    );
  }

  async query<T extends object = Record<string, never>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const orm = await this.initializing;
    const mikroQuery = toMikroQuery(sql, params);
    const result = (await orm.em
      .getConnection()
      .execute(
        mikroQuery.sql,
        mikroQuery.params,
      )) as unknown as ExecutedQuery<T>;
    return Array.isArray(result) ? result : [];
  }

  async findWallet(id: string): Promise<WalletEntity | null> {
    const orm = await this.initializing;
    // Request reads need their own identity-map context. MikroORM intentionally
    // disallows entity reads through the process-wide EntityManager.
    return orm.em.fork().findOne(WalletEntity, { id });
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    const orm = await this.initializing;
    const mikroQuery = toMikroQuery(sql, params);
    const result = (await orm.em
      .getConnection()
      .execute(
        mikroQuery.sql,
        mikroQuery.params,
      )) as unknown as ExecutedQuery<never>;
    return Array.isArray(result)
      ? result.length
      : (result.rowCount ?? result.affectedRows ?? 0);
  }

  async onModuleDestroy(): Promise<void> {
    const orm = await this.initializing;
    await orm.close(true);
  }

  async close(): Promise<void> {
    await this.onModuleDestroy();
  }
}
