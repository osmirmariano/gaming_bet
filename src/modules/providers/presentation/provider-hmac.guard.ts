import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Database } from "../../../infrastructure/database/database.service.js";
import { RedisAuxiliary } from "../../../infrastructure/redis/redis-auxiliary.service.js";
import {
  constantTimeEqual,
  decrypt,
  hmac256,
  sha256,
} from "../../../shared/infrastructure/crypto.js";

type Provider = {
  id: string;
  api_key: string;
  secret_ciphertext: Buffer;
  rate_limit_per_minute: number;
};
export type ProviderRequest = FastifyRequest & { providerId?: string };

@Injectable()
export class ProviderHmacGuard implements CanActivate {
  constructor(
    private readonly database: Database,
    private readonly redis: RedisAuxiliary,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProviderRequest>();
    const apiKey = request.headers["x-api-key"];
    const timestamp = request.headers["x-timestamp"];
    const nonce = request.headers["x-nonce"];
    const signature = request.headers["x-signature"];
    if (
      typeof apiKey !== "string" ||
      typeof timestamp !== "string" ||
      typeof nonce !== "string" ||
      typeof signature !== "string"
    )
      throw new UnauthorizedException("MISSING_PROVIDER_SIGNATURE");
    const parsedTimestamp = Date.parse(timestamp);
    const skew = Number(process.env.HMAC_MAX_SKEW_SECONDS ?? "300") * 1000;
    if (
      !Number.isFinite(parsedTimestamp) ||
      Math.abs(Date.now() - parsedTimestamp) > skew
    )
      throw new UnauthorizedException("INVALID_SIGNATURE_TIMESTAMP");
    const rows = await this.database.query<Provider>(
      "SELECT p.id,p.api_key,p.rate_limit_per_minute,c.secret_ciphertext FROM providers p JOIN provider_credentials c ON c.provider_id=p.id AND c.active WHERE p.api_key=$1 AND p.active=true",
      [apiKey],
    );
    const provider = rows[0];
    if (!provider) throw new UnauthorizedException("UNKNOWN_PROVIDER");
    if (
      !(await this.redis.consumeRateLimit(
        provider.id,
        provider.rate_limit_per_minute,
      ))
    )
      throw new UnauthorizedException("PROVIDER_RATE_LIMITED");
    const body =
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody?.toString(
        "utf8",
      ) ?? JSON.stringify(request.body ?? {});
    const canonical = `${request.method}\n${request.url.split("?")[0]}\n${timestamp}\n${nonce}\n${sha256(body)}`;
    let expected: string;
    try {
      expected = hmac256(decrypt(provider.secret_ciphertext), canonical);
    } catch {
      throw new UnauthorizedException("INVALID_PROVIDER_CREDENTIAL");
    }
    if (!constantTimeEqual(expected, signature))
      throw new UnauthorizedException("INVALID_SIGNATURE");
    const nonceInsert = await this.database.execute(
      "INSERT INTO hmac_nonces(provider_id,nonce,expires_at) VALUES($1,$2,now()+($3 || ' seconds')::interval) ON CONFLICT DO NOTHING",
      [provider.id, nonce, String(Math.ceil(skew / 1000))],
    );
    if (nonceInsert !== 1) throw new UnauthorizedException("REPLAYED_REQUEST");
    request.providerId = provider.id;
    return true;
  }
}
