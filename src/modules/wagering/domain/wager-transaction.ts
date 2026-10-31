export const WAGER_KINDS = [
  "OPENING",
  "BET",
  "WIN",
  "LOSS",
  "REFUND",
  "ROLLBACK",
] as const;
export type WagerKind = (typeof WAGER_KINDS)[number];
export const WAGER_STATUSES = [
  "PENDING",
  "PENDING_REFERENCE",
  "PROCESSED",
  "REJECTED",
  "FAILED",
] as const;
export type WagerStatus = (typeof WAGER_STATUSES)[number];

const terminal = new Set<WagerStatus>(["PROCESSED", "REJECTED", "FAILED"]);
export class WagerTransaction {
  private constructor(
    readonly id: string,
    readonly kind: WagerKind,
    private status: WagerStatus,
  ) {}
  static create(id: string, kind: WagerKind): WagerTransaction {
    return new WagerTransaction(id, kind, "PENDING");
  }
  static rehydrate(
    id: string,
    kind: WagerKind,
    status: WagerStatus,
  ): WagerTransaction {
    return new WagerTransaction(id, kind, status);
  }
  markProcessed(): void {
    this.transition("PROCESSED");
  }
  markRejected(): void {
    this.transition("REJECTED");
  }
  waitForReference(): void {
    this.transition("PENDING_REFERENCE");
  }
  getStatus(): WagerStatus {
    return this.status;
  }
  private transition(next: WagerStatus): void {
    if (terminal.has(this.status)) throw new Error("TERMINAL_TRANSACTION");
    if (next === "PENDING") throw new Error("INVALID_TRANSACTION_TRANSITION");
    this.status = next;
  }
}
