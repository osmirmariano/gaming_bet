import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { Database } from "../../../infrastructure/database/database.service.js";

@Controller()
export class HealthController {
  private readonly sqs = new SQSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint: process.env.SQS_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  });

  constructor(private readonly database: Database) {}

  @Get("health/live")
  live() {
    return { status: "ok" };
  }

  @Get("health/ready")
  async ready() {
    try {
      await Promise.all([
        this.database.query("SELECT 1 AS ok"),
        this.sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl:
              process.env.SQS_WAGER_QUEUE_URL ?? process.env.SQS_QUEUE_URL,
            AttributeNames: ["QueueArn"],
          }),
        ),
      ]);
      return { status: "ok", database: "up", sqs: "up" };
    } catch {
      throw new HttpException(
        { code: "DEPENDENCY_NOT_READY" },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
