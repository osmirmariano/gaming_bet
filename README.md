# Distributed Wager Ledger

Monólito NestJS/Bun para processamento financeiro de apostas. O PostgreSQL é a única fonte de verdade para saldo, idempotência, Inbox, Outbox e locks financeiros; Redis é deliberadamente auxiliar. Valores monetários entram e saem como strings decimais, jamais `number`. A identidade administrativa é delegada a Keycloak via OIDC.

## 1. Pré-requisitos

- Docker Desktop instalado e iniciado;
- Docker Compose v2 (`docker compose version`);
- Bun 1.x somente para testes, lint e migrations executados fora dos containers.

No macOS, abra o aplicativo **Docker Desktop** e aguarde o status **Engine running**. Antes de continuar, confirme:

```sh
docker info
docker compose version
```

Se `docker info` mostrar `Cannot connect to the Docker daemon`, o Docker Desktop ainda não iniciou. Feche-o completamente, abra-o novamente e aguarde o engine ficar disponível.

## 2. Primeira execução

```sh
cd "/Users/osmir/Projetos P/teste_gamming"
cp .env.example .env
docker compose up --build
```

O primeiro build pode demorar porque baixa imagens e instala dependências. Mantenha o terminal aberto para acompanhar os logs. Para executar em segundo plano:

```sh
docker compose up --build -d
docker compose logs -f api worker
```

As migrations são aplicadas automaticamente por `api` e `worker`; não é necessário executá-las manualmente após subir o Compose.

| Serviço | Endereço | Uso |
|---|---|---|
| API | http://localhost:3000/api/v1 | Endpoints da aplicação |
| Swagger | http://localhost:3000/docs | Teste interativo da API |
| Health live | http://localhost:3000/health/live | Verifica se a API está no ar |
| Health ready | http://localhost:3000/health/ready | Verifica PostgreSQL e SQS |
| Keycloak | http://localhost:8080 | Identity Provider local |
| PostgreSQL | `localhost:5432` | Banco de desenvolvimento |
| LocalStack/SQS | `localhost:4566` | Filas de desenvolvimento |

Depois do startup, valide:

```sh
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

Ambos devem retornar JSON com `status: "ok"`. Caso a porta `3000` recuse conexão, inspecione a API:

```sh
docker compose logs --tail=150 api
```

## 3. Parar, reiniciar e limpar dados locais

```sh
# Para os containers preservando banco e filas
docker compose down

# Sobe novamente sem reconstruir imagens
docker compose up -d

# Mostra o estado dos serviços
docker compose ps
```

Para recomeçar do zero, inclusive banco e filas persistidos, use o comando abaixo. Ele remove os volumes locais do projeto:

```sh
docker compose down -v
docker compose up --build
```

## 4. Comandos de desenvolvimento

```sh
bun install
bun run typecheck
bun run lint
bun run test:unit
```

## 5. Keycloak e autenticação administrativa

O Compose importa automaticamente o realm `wager`.

| Finalidade | Usuário | Senha |
|---|---|---|
| Console administrativo do Keycloak | `admin` | `admin` |
| Operações locais da API | `operator` | `operator-dev-only` |

Abra http://localhost:8080 com `admin` / `admin`. No seletor de realm, escolha `wager`. O usuário `operator` já tem a role `OPERATOR`.

Os endpoints administrativos usam JWT emitido pelo Keycloak. Para gerar um token de desenvolvimento para o usuário com role `OPERATOR`, execute:

```sh
curl -X POST http://localhost:8080/realms/wager/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=wager-api" \
  -d "username=operator" \
  -d "password=operator-dev-only"
```

Copie somente o valor entre aspas de `access_token`: não use a resposta JSON inteira nem o `refresh_token`. O access token local expira em 5 minutos; gere outro com o mesmo comando quando necessário.

No Swagger, clique em **Authorize** e cole apenas o token — o Swagger adiciona `Bearer` automaticamente. Em `curl`, o header deve ter o prefixo `Bearer`:

```sh
export TOKEN='cole-apenas-o-access_token-aqui'
```

Para administrar provedores, atribua a role `ADMIN`: Keycloak → realm `wager` → **Users** → `operator` → **Role mapping** → atribua `ADMIN`; então gere um novo token. As roles disponíveis são `ADMIN`, `OPERATOR` e `AUDITOR`.

As credenciais acima existem somente no ambiente local. Nunca versione `.env`, tokens ou segredos e não as use em produção.

## 6. Usar a API no Swagger

1. Acesse http://localhost:3000/docs.
2. Clique em **Authorize**, cole o `access_token` e confirme.
3. Abra `POST /api/v1/wallets` → **Try it out**.
4. Envie um corpo como este:

```json
{
  "playerId": "player-demo-001",
  "initialBalance": {
    "amount": "100.00",
    "currency": "BRL"
  }
}
```

Guarde o `id` retornado: ele será o `walletId` das chamadas posteriores. O Swagger exibe os campos obrigatórios dos POSTs e os headers da operação de aposta.

## 7. Usar a API com curl

### Criar uma wallet

O `playerId` deve ser novo para a mesma moeda. Dinheiro é sempre string decimal.

```sh
curl --fail-with-body -X POST http://localhost:3000/api/v1/wallets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "playerId":"player-demo-001",
    "initialBalance":{"amount":"100.00","currency":"BRL"}
  }'
```

Defina o ID retornado e consulte a wallet, seu ledger e a reconciliação:

```sh
export WALLET_ID='id-da-wallet'

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/wallets/$WALLET_ID"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/wallets/$WALLET_ID/ledger"

curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/wallets/$WALLET_ID/reconciliation"
```

## 8. Criar um provedor e enviar uma aposta assinada

Esta etapa requer token com role `ADMIN` (seção 5). Crie o provedor e guarde o `id` retornado:

```sh
export PROVIDER_KEY='provider-demo-key-0001'
export PROVIDER_SECRET='provider-demo-secret-for-local-tests-123456'

curl --fail-with-body -X POST http://localhost:3000/api/v1/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Provider Demo\",\"apiKey\":\"$PROVIDER_KEY\",\"apiSecret\":\"$PROVIDER_SECRET\",\"rateLimitPerMinute\":600}"

export PROVIDER_ID='id-retornado-pelo-provider'
```

Transações de provedor não usam JWT. Elas exigem `X-API-Key`, `X-Timestamp`, `X-Nonce`, `X-Signature` e `Idempotency-Key`. A assinatura é HMAC-SHA256 do método, caminho, timestamp, nonce e SHA-256 do **corpo exato**, separados por quebra de linha:

```text
POST
/api/v1/wagering/transactions
TIMESTAMP
NONCE
SHA256_DO_CORPO_EXATO
```

Exemplo de BET. Não reformate `BODY` entre assinar e enviar:

```sh
export TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export NONCE="$(uuidgen)"
export IDEMPOTENCY_KEY="$(uuidgen)"
export BODY="{\"providerId\":\"$PROVIDER_ID\",\"walletId\":\"$WALLET_ID\",\"playerId\":\"player-demo-001\",\"externalTransactionId\":\"bet-demo-001\",\"kind\":\"BET\",\"roundId\":\"round-demo-001\",\"gameId\":\"game-demo-001\",\"money\":{\"amount\":\"10.00\",\"currency\":\"BRL\"}}"
export BODY_HASH="$(printf '%s' "$BODY" | shasum -a 256 | awk '{print $1}')"
export SIGNATURE="$(printf 'POST\n/api/v1/wagering/transactions\n%s\n%s\n%s' "$TIMESTAMP" "$NONCE" "$BODY_HASH" | openssl dgst -sha256 -hmac "$PROVIDER_SECRET" -hex | sed 's/^.* //')"

curl --fail-with-body -X POST http://localhost:3000/api/v1/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $PROVIDER_KEY" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Nonce: $NONCE" \
  -H "X-Signature: $SIGNATURE" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-raw "$BODY"
```

Para repetir uma requisição após falha de rede, reutilize o mesmo corpo e a mesma `Idempotency-Key`; use um novo nonce, timestamp e assinatura. A resposta preserva o resultado inicial e informa `idempotentReplay: true`.

Os tipos aceitos são `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`. Para consultar uma transação, assine também o GET de acordo com o mesmo protocolo HMAC. Consulte [API.md](API.md) e [SECURITY.md](SECURITY.md) para todos os endpoints e detalhes de segurança.

## 9. Testes e migrations fora dos containers

Com a pilha Docker em execução, rode o teste de concorrência contra o PostgreSQL local:

```sh
TEST_DATABASE_URL=postgresql://wager:wager@localhost:5432/wager bun test test/integration/concurrency.test.ts
```

As migrations já são automáticas no Compose. Para executá-las manualmente pela máquina, use `localhost` — o hostname `postgres` só existe dentro da rede Docker:

```sh
DATABASE_URL=postgresql://wager:wager@localhost:5432/wager bun run migration:up
DATABASE_URL=postgresql://wager:wager@localhost:5432/wager bun run migration:down
```

## Garantias relevantes

- `wallets` é bloqueada com `SELECT … FOR UPDATE`; saldo e ledger são alterados numa única transação SQL.
- Constraints protegem saldo não negativo, unicidade de carteira, transação externa, idempotência, ledger e reversões.
- A mesma `Idempotency-Key` retorna o snapshot original. Mesmo key com payload de negócio diferente devolve `409` sem novo efeito.
- O Outbox é gravado antes do commit e publicado depois, com claim por `SKIP LOCKED`; duplicação de publicação é esperada e tratada no Inbox.
- `wallet_ledger_entries` possui trigger que bloqueia `UPDATE` e `DELETE`.

Consulte também [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [API.md](API.md) e [DEVELOPMENT.md](DEVELOPMENT.md).
