# SharedList Backend

Minimal backend for an end-to-end encrypted shared list app.

- Python 3 + FastAPI
- PostgreSQL for storage
- Redis for rate limiting
- No plaintext list data on the server: all list metadata and items are
  encrypted client-side and sent as base64 ciphertext.

## Running with Docker

From this directory:

```bash
docker-compose up --build
```

This starts:

- Postgres (service: `db`)
- Redis (service: `redis`)
- FastAPI backend on `http://localhost:8000`

The database schema is initialized from `schema.sql` on first startup.

## Testing

Make sure Postgres and Redis are up (e.g. via `docker-compose up -d`),
then run:

```bash
pip install -r requirements.txt
pytest
```

## API

The main endpoints live under `/v1`:

- `POST /v1/lists` – create list (encrypted meta)
- `GET /v1/lists/{list_id}` – fetch list meta
- `DELETE /v1/lists/{list_id}` – delete list

- `POST /v1/lists/{list_id}/items` – create item
- `GET /v1/lists/{list_id}/items?since_rev=` – fetch all or incremental items
- `PUT /v1/lists/{list_id}/items/{item_id}` – update item
- `DELETE /v1/lists/{list_id}/items/{item_id}` – delete item

See the code and tests in `tests/test_api.py` for more detailed examples.
