import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({
    logger: { level: process.env.NODE_ENV === "production" ? "info" : "debug" },
  }),
  { rawBody: true },
);
app.enableShutdownHooks();
const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder()
    .setTitle("Distributed Wager Ledger")
    .setVersion("v1")
    .addBearerAuth()
    .build(),
);
SwaggerModule.setup("/docs", app, document);
const port = Number(process.env.PORT ?? "3000");
await app.listen({ port, host: "0.0.0.0" });
Logger.log(
  JSON.stringify({
    event: "api_started",
    port,
    apiUrl: `http://localhost:${port}/api/v1`,
    swaggerUrl: `http://localhost:${port}/docs`,
    healthUrl: `http://localhost:${port}/health/live`,
  }),
);
