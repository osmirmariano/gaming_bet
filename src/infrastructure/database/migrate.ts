import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://wager:wager@localhost:5432/wager";
const pool = new pg.Pool({ connectionString });
const migrationsDirectory = new URL("./migrations/", import.meta.url);
const migrationsPath = fileURLToPath(migrationsDirectory);

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = new Set(
      (
        await client.query<{ id: string }>("SELECT id FROM schema_migrations")
      ).rows.map((row) => row.id),
    );
    const files = (await readdir(migrationsPath))
      .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
      .sort();
    if (process.argv[2] === "down") {
      const migration = [...files].reverse().find((file) => applied.has(file));
      if (!migration) return;
      const downFile = migration.replace(/\.sql$/, ".down.sql");
      await client.query(
        await readFile(join(migrationsPath, downFile), "utf8"),
      );
      await client.query("DELETE FROM schema_migrations WHERE id=$1", [
        migration,
      ]);
      await client.query("COMMIT");
      process.stdout.write(
        `${JSON.stringify({ level: "info", event: "migration_reverted", migration })}\n`,
      );
      return;
    }
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(join(migrationsPath, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [
        file,
      ]);
      process.stdout.write(
        JSON.stringify({
          level: "info",
          event: "migration_applied",
          migration: file,
        }) + "\n",
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
await main();
