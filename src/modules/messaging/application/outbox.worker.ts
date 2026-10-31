import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { Database } from "../../../infrastructure/database/database.service.js";

type OutboxRow = {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: { eventId: string; [key: string]: unknown };
  attempts: number;
};
export class OutboxPublisher {
  private readonly sqs = new SQSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint: process.env.SQS_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  });
  constructor(private readonly database: Database) {}
  async publishBatch(limit = 10): Promise<number> {
    const messages = await this.database.transaction(
      async (client) =>
        (
          await client.query<OutboxRow>(
            `WITH claimed AS (SELECT id FROM outbox_messages WHERE published_at IS NULL AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now()) ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE outbox_messages o SET locked_until=now()+interval '30 seconds',attempts=o.attempts+1 FROM claimed WHERE o.id=claimed.id RETURNING o.id,o.aggregate_id,o.event_type,o.payload,o.attempts`,
            [limit],
          )
        ).rows,
    );
    let count = 0;
    for (const message of messages) {
      try {
        await this.sqs.send(
          new SendMessageCommand({
            QueueUrl:
              process.env.SQS_EVENT_QUEUE_URL ?? process.env.SQS_QUEUE_URL,
            MessageBody: JSON.stringify({
              id: message.id,
              type: message.event_type,
              payload: message.payload,
            }),
            MessageGroupId: message.aggregate_id,
            MessageDeduplicationId: message.payload.eventId,
          }),
        );
        await this.database.execute(
          "UPDATE outbox_messages SET published_at=now(),locked_until=NULL WHERE id=$1 AND published_at IS NULL",
          [message.id],
        );
        count += 1;
      } catch (error) {
        const delaySeconds = Math.min(
          3600,
          2 ** Math.min(message.attempts, 10),
        );
        await this.database.execute(
          `UPDATE outbox_messages SET locked_until=NULL,next_attempt_at=now()+($2 || ' seconds')::interval WHERE id=$1`,
          [message.id, String(delaySeconds)],
        );
        process.stderr.write(
          JSON.stringify({
            level: "error",
            event: "outbox_publish_failed",
            outboxId: message.id,
            error: error instanceof Error ? error.message : "unknown",
          }) + "\n",
        );
      }
    }
    return count;
  }
}
