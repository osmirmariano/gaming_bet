# Desenvolvimento e validação

Pré-requisitos: Bun 1.x e Docker Compose. Copie `.env.example`. Migrations são transacionais e aplicadas por `bun run migration:up`.

O Docker Compose importa um realm Keycloak de desenvolvimento. Use `operator` / `operator-dev-only` apenas localmente para obter um access token do client `wager-api`; não há credenciais administrativas no banco desta aplicação. A API valida `OIDC_ISSUER_URL`, `OIDC_AUDIENCE` e roles do realm.

Os testes unitários cobrem dinheiro, invariantes de carteira e estados de transação. O teste de integração `test/integration/concurrency.test.ts` só roda se `TEST_DATABASE_URL` apontar para PostgreSQL real já migrado; ele dispara 50 BETs paralelos e comprova 10 débitos, saldo `0.00` e 10 lançamentos.

Valide a pilha completa com:

```sh
docker compose up --build
TEST_DATABASE_URL=postgresql://wager:wager@localhost:5432/wager bun test test/integration
```

Em falha após commit, o Outbox pode publicar novamente e o Inbox deduplica antes do ACK. Em falha antes do commit, nenhuma movimentação, Inbox ou Outbox persiste. Redis/SQS indisponíveis degradam autenticação auxiliar/publicação, mas não alteram o ledger nem a idempotência já persistida.

Para enviar uma operação pela fila, publique um envelope `WagerTransactionRequested` em `wager-transactions.fifo`. A fila de eventos de integração (`wager-events.fifo`) é separada da fila de comandos e não é tratada como fonte de verdade financeira.
