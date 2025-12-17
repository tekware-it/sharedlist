-- schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SEQUENCE IF NOT EXISTS list_items_rev_seq;

CREATE TABLE IF NOT EXISTS lists (
  id                 UUID PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_client_hash  TEXT,
  meta               BYTEA NOT NULL,
  meta_nonce         BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS list_items (
  id                     BIGSERIAL PRIMARY KEY,
  list_id                UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ciphertext             BYTEA NOT NULL,
  nonce                  BYTEA NOT NULL,
  rev                    BIGINT NOT NULL DEFAULT nextval('list_items_rev_seq'),
  updated_by_client_hash TEXT,
  deleted                BOOLEAN NOT NULL DEFAULT FALSE
);


CREATE TABLE IF NOT EXISTS ios_push_subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  list_id      TEXT NOT NULL,
  client_id    TEXT NOT NULL,
  device_token TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (list_id, client_id, device_token)
);


CREATE INDEX IF NOT EXISTS idx_list_items_list_id ON list_items (list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_rev ON list_items (list_id, rev);
CREATE INDEX IF NOT EXISTS ios_push_subscriptions_list_id_idx ON ios_push_subscriptions (list_id);

