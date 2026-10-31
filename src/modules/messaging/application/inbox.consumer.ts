import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { Database } from "../../../infrastructure/database/database.service.js";
import { sha256 } from "../../../shared/infrastructure/crypto.js";
import {
  type WagerCommand,
  WagerService,
} from "../../wagering/application/wager.service.js";

type QueueEnvelope = {
  messageId: string;
  type: "WagerTransactionRequested";
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerCommand["kind"];
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
};
export class InboxConsumer {
  private readonly sqs = new SQSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint: process.env.SQS_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  });
  constructor(
    private readonly database: Database,
    private readonly wagers: WagerService,
  ) {}
  async pollOnce(): Promise<number> {
    const response = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: process.env.SQS_WAGER_QUEUE_URL ?? process.env.SQS_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 30,
      }),
    );
    let acknowledged = 0;
    for (const message of response.Messages ?? []) {
      const messageId = message.MessageId;
      const receiptHandle = message.ReceiptHandle;
      const body = message.Body;
      if (!messageId || !receiptHandle || !body) continue;
      try {
        const envelope = JSON.parse(body) as QueueEnvelope;
        if (
          envelope.type !== "WagerTransactionRequested" ||
          !envelope.messageId ||
          !envelope.data
        )
          throw new Error("INVALID_QUEUE_ENVELOPE");
        const command: WagerCommand = {
          providerId: envelope.data.providerId,
          externalTransactionId: envelope.data.externalTransactionId,
          idempotencyKey: envelope.data.idempotencyKey,
          playerId: envelope.data.playerId,
          walletId: envelope.data.walletId,
          roundId: envelope.data.roundId,
          gameId: envelope.data.gameId,
          kind: envelope.data.kind,
          amount: envelope.data.money.amount,
          currency: envelope.data.money.currency,
          referenceExternalTransactionId:
            envelope.data.referenceExternalTransactionId,
        };
        await this.wagers.executeFromQueue(command, {
          consumerName: "wager-transaction-consumer",
          messageId: envelope.messageId,
          payloadHash: sha256(body),
        });
        await this.sqs.send(
          new DeleteMessageCommand({
            QueueUrl:
              process.env.SQS_WAGER_QUEUE_URL ?? process.env.SQS_QUEUE_URL,
            ReceiptHandle: receiptHandle,
          }),
        );
        acknowledged += 1;
      } catch (error) {
        process.stderr.write(
          JSON.stringify({
            level: "error",
            event: "inbox_processing_failed",
            messageId: message.MessageId,
            error: error instanceof Error ? error.message : "unknown",
          }) + "\n",
        );
      }
    }
    return acknowledged;
  }
}
