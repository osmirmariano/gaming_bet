import { HttpException, HttpStatus } from "@nestjs/common";
import type { z } from "zod";

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpException(
      { code: "VALIDATION_ERROR", details: result.error.flatten() },
      HttpStatus.BAD_REQUEST,
    );
  return result.data;
}
