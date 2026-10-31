import { Database } from "./infrastructure/database/database.service.js";
import { InboxConsumer } from "./modules/messaging/application/inbox.consumer.js";
import { OutboxPublisher } from "./modules/messaging/application/outbox.worker.js";
import { WagerService } from "./modules/wagering/application/wager.service.js";

const database = new Database();
const publisher = new OutboxPublisher(database);
const wagers = new WagerService(database);
const consumer = new InboxConsumer(database, wagers);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
while (!stopping) {
  try {
    const [published, consumed, pending] = await Promise.all([
      publisher.publishBatch(),
      consumer.pollOnce(),
      wagers.reprocessPendingReferences(),
    ]);
    if (published || consumed || pending)
      process.stdout.write(
        JSON.stringify({
          level: "info",
          event: "worker_tick",
          published,
          consumed,
          pending,
        }) + "\n",
      );
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        level: "error",
        event: "worker_tick_failed",
        error: error instanceof Error ? error.message : "unknown",
      }) + "\n",
    );
  }
}
await database.close();
