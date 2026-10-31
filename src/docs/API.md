# API

Base: `/api/v1`. Contratos monetários usam `{ "amount": "10.00", "currency": "BRL" }`; nunca valores numéricos JSON.

| Área | Rota |
|---|---|
| Auth | OIDC externo: Keycloak realm `wager`, client `wager-api` |
| Wallets | `POST /wallets`, `GET /wallets/:id`, `GET /wallets/:id/ledger`, `POST /wallets/:id/reconciliation` |
| Wagers | `POST /wagering/transactions`, `GET /wagering/transactions/:id`, `GET /providers/:providerId/wagering/transactions/:externalTransactionId` |
| Providers | `POST /providers`, `GET /providers`, `POST /providers/:id/rotate-credentials` |
| Admin | `GET /admin/transactions`, `/admin/outbox`, `/admin/inbox` |

`POST /wagering/transactions` requer `Idempotency-Key` e os quatro headers HMAC. O payload contém `providerId`, `walletId`, `playerId`, `externalTransactionId`, `roundId`, `gameId`, `kind`, `money` e, quando aplicável, `referenceExternalTransactionId`. O `providerId` autenticado precisa corresponder ao payload.

Um replay idempotente conserva o status HTTP e corpo do snapshot inicial e adiciona `idempotentReplay: true`. Consultas `GET` mostram o estado atual.
