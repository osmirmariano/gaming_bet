CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, api_key text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true, rate_limit_per_minute integer NOT NULL DEFAULT 600 CHECK (rate_limit_per_minute > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO providers(id,name,api_key,active)
VALUES ('00000000-0000-0000-0000-000000000001','SYSTEM_OPENING','internal-opening',false)
ON CONFLICT (id) DO NOTHING;
CREATE TABLE provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid NOT NULL REFERENCES providers(id),
  secret_ciphertext bytea NOT NULL, key_version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  UNIQUE(provider_id, key_version)
);
CREATE TABLE hmac_nonces (
  provider_id uuid NOT NULL REFERENCES providers(id), nonce text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider_id, nonce)
);
CREATE UNIQUE INDEX provider_active_credential ON provider_credentials(provider_id) WHERE active;
CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id text NOT NULL, currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  balance numeric(20,2) NOT NULL DEFAULT 0 CHECK (balance >= 0), version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(player_id, currency)
);
CREATE TABLE wager_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid NOT NULL REFERENCES providers(id), wallet_id uuid NOT NULL REFERENCES wallets(id),
  player_id text NOT NULL, external_transaction_id text NOT NULL, idempotency_key text NOT NULL, payload_hash char(64) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
  status text NOT NULL CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
  amount numeric(20,2) NOT NULL CHECK (amount > 0), currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), round_id text, game_id text,
  reference_external_transaction_id text, failure_code text, response_status integer, response_body jsonb,
  reference_attempts integer NOT NULL DEFAULT 0 CHECK(reference_attempts >= 0), next_reference_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  UNIQUE(provider_id, external_transaction_id), UNIQUE(provider_id, idempotency_key)
);
CREATE INDEX wager_reference_idx ON wager_transactions(next_reference_attempt_at) WHERE status = 'PENDING_REFERENCE';
CREATE TABLE wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid NOT NULL REFERENCES wallets(id), transaction_id uuid NOT NULL REFERENCES wager_transactions(id),
  direction text NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), amount numeric(20,2) NOT NULL CHECK(amount > 0),
  balance_before numeric(20,2) NOT NULL, balance_after numeric(20,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(transaction_id, wallet_id), CHECK (balance_before >= 0 AND balance_after >= 0),
  CHECK ((direction = 'DEBIT' AND balance_after = balance_before - amount) OR (direction = 'CREDIT' AND balance_after = balance_before + amount))
);
CREATE TABLE wager_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), original_transaction_id uuid NOT NULL REFERENCES wager_transactions(id),
  reversal_transaction_id uuid NOT NULL REFERENCES wager_transactions(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(original_transaction_id), UNIQUE(reversal_transaction_id)
);
CREATE TABLE inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), consumer_name text NOT NULL, message_id text NOT NULL, payload_hash char(64) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, UNIQUE(consumer_name, message_id)
);
CREATE TABLE outbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_id uuid NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0), next_attempt_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  locked_until timestamptz, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_ready_idx ON outbox_messages(next_attempt_at) WHERE published_at IS NULL;
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'wallet_ledger_entries are immutable'; END; $$;
DROP TRIGGER IF EXISTS no_ledger_mutation ON wallet_ledger_entries;
CREATE TRIGGER no_ledger_mutation BEFORE UPDATE OR DELETE ON wallet_ledger_entries FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
