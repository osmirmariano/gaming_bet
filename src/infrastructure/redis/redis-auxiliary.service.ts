import { Injectable } from "@nestjs/common";
import { type RedisClientType, createClient } from "redis";

@Injectable()
export class RedisAuxiliary {
  private client: RedisClientType | undefined;

  private async connection(): Promise<RedisClientType> {
    if (!this.client) {
      this.client = createClient({
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
        socket: { reconnectStrategy: false, connectTimeout: 500 },
      });
      this.client.on("error", () => undefined);
    }
    if (!this.client.isOpen) await this.client.connect();
    return this.client;
  }

  async consumeRateLimit(providerId: string, limit: number): Promise<boolean> {
    try {
      const client = await this.connection();
      const key = `provider-rate:${providerId}:${Math.floor(Date.now() / 60_000)}`;
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, 70);
      return count <= limit;
    } catch {
      // PostgreSQL constraints retain financial integrity if this auxiliary service is down.
      return true;
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await (await this.connection()).ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
  }
}
