import {
  Controller,
  Get,
  HttpException,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Database } from "../../../infrastructure/database/database.service.js";
import {
  ProviderHmacGuard,
  type ProviderRequest,
} from "../../providers/presentation/provider-hmac.guard.js";

@ApiTags("wagers")
@Controller("api/v1/providers/:providerId/wagering/transactions")
@UseGuards(ProviderHmacGuard)
export class ProviderWagerLookupController {
  constructor(private readonly database: Database) {}

  @Get(":externalTransactionId")
  async get(
    @Req() request: ProviderRequest,
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ) {
    if (providerId !== request.providerId)
      throw new HttpException({ code: "PROVIDER_ID_MISMATCH" }, 403);
    const rows = await this.database.query<{
      id: string;
      status: string;
      kind: string;
      amount: string;
      currency: string;
      externalTransactionId: string;
      failureCode: string | null;
    }>(
      'SELECT id,status,kind,amount::text,currency,external_transaction_id AS "externalTransactionId",failure_code AS "failureCode" FROM wager_transactions WHERE external_transaction_id=$1 AND provider_id=$2',
      [externalTransactionId, providerId],
    );
    const transaction = rows[0];
    if (!transaction) throw new HttpException({ code: "WAGER_NOT_FOUND" }, 404);
    return {
      ...transaction,
      money: { amount: transaction.amount, currency: transaction.currency },
    };
  }
}
