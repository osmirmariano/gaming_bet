import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Database } from "../../../infrastructure/database/database.service.js";
import { encrypt } from "../../../shared/infrastructure/crypto.js";
import { parseInput } from "../../../shared/presentation/input-validation.js";
import { JwtRoleGuard, Roles } from "../../auth/presentation/jwt.guard.js";

const providerSchema = z.object({
  name: z.string().min(1).max(128),
  apiKey: z.string().min(16).max(128),
  apiSecret: z.string().min(32).max(512),
  rateLimitPerMinute: z.number().int().min(1).max(10000).default(600),
});
const providerUpdateSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    active: z.boolean().optional(),
    rateLimitPerMinute: z.number().int().min(1).max(10000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0);
const providerCreateOpenApiSchema = {
  type: "object",
  required: ["name", "apiKey", "apiSecret"],
  properties: {
    name: { type: "string", example: "Example provider" },
    apiKey: { type: "string", example: "provider-key-0001" },
    apiSecret: {
      type: "string",
      example: "change-this-to-a-secret-with-32-chars",
    },
    rateLimitPerMinute: { type: "integer", example: 600 },
  },
};
const providerUpdateOpenApiSchema = {
  type: "object",
  properties: {
    name: { type: "string", example: "Example provider" },
    active: { type: "boolean", example: true },
    rateLimitPerMinute: { type: "integer", example: 600 },
  },
};
const providerRotateCredentialsOpenApiSchema = {
  type: "object",
  required: ["apiSecret"],
  properties: {
    apiSecret: {
      type: "string",
      example: "change-this-to-a-secret-with-32-chars",
    },
  },
};

@ApiTags("providers")
@ApiBearerAuth()
@UseGuards(JwtRoleGuard)
@Controller("api/v1/providers")
export class ProviderController {
  constructor(private readonly database: Database) {}

  @Post()
  @ApiBody({ schema: providerCreateOpenApiSchema })
  @Roles("ADMIN")
  async create(@Body() body: unknown) {
    const value = parseInput(providerSchema, body);
    return this.database.transaction(async (client) => {
      const provider = (
        await client.query<{ id: string }>(
          "INSERT INTO providers(name,api_key,rate_limit_per_minute) VALUES($1,$2,$3) RETURNING id",
          [value.name, value.apiKey, value.rateLimitPerMinute],
        )
      ).rows[0];
      if (!provider) throw new Error("PROVIDER_CREATE_FAILED");
      await client.query(
        "INSERT INTO provider_credentials(provider_id,secret_ciphertext) VALUES($1,$2)",
        [provider.id, encrypt(value.apiSecret)],
      );
      return { id: provider.id, name: value.name, apiKey: value.apiKey };
    });
  }

  @Get()
  @Roles("ADMIN", "OPERATOR", "AUDITOR")
  async list() {
    return this.database.query(
      'SELECT id,name,api_key AS "apiKey",active,rate_limit_per_minute AS "rateLimitPerMinute",created_at AS "createdAt" FROM providers ORDER BY created_at DESC',
    );
  }

  @Get(":id")
  @Roles("ADMIN", "OPERATOR", "AUDITOR")
  async get(@Param("id") id: string) {
    const rows = await this.database.query(
      'SELECT id,name,api_key AS "apiKey",active,rate_limit_per_minute AS "rateLimitPerMinute",created_at AS "createdAt",updated_at AS "updatedAt" FROM providers WHERE id=$1',
      [id],
    );
    if (!rows[0]) throw new HttpException({ code: "PROVIDER_NOT_FOUND" }, 404);
    return rows[0];
  }

  @Patch(":id")
  @ApiBody({ schema: providerUpdateOpenApiSchema })
  @Roles("ADMIN")
  async update(@Param("id") id: string, @Body() body: unknown) {
    const value = parseInput(providerUpdateSchema, body);
    const rows = await this.database.query(
      'UPDATE providers SET name=COALESCE($2,name),active=COALESCE($3,active),rate_limit_per_minute=COALESCE($4,rate_limit_per_minute),updated_at=now() WHERE id=$1 RETURNING id,name,api_key AS "apiKey",active,rate_limit_per_minute AS "rateLimitPerMinute"',
      [
        id,
        value.name ?? null,
        value.active ?? null,
        value.rateLimitPerMinute ?? null,
      ],
    );
    if (!rows[0]) throw new HttpException({ code: "PROVIDER_NOT_FOUND" }, 404);
    return rows[0];
  }

  @Post(":id/rotate-credentials")
  @ApiBody({ schema: providerRotateCredentialsOpenApiSchema })
  @Roles("ADMIN")
  async rotate(@Param("id") id: string, @Body() body: unknown) {
    const value = parseInput(
      z.object({ apiSecret: z.string().min(32).max(512) }),
      body,
    );
    return this.database.transaction(async (client) => {
      await client.query(
        "UPDATE provider_credentials SET active=false,revoked_at=now() WHERE provider_id=$1 AND active",
        [id],
      );
      await client.query(
        "INSERT INTO provider_credentials(provider_id,secret_ciphertext,key_version) SELECT $1,$2,COALESCE(max(key_version),0)+1 FROM provider_credentials WHERE provider_id=$1",
        [id, encrypt(value.apiSecret)],
      );
      return { id, rotated: true };
    });
  }
}
