# main.py
import os
import base64
import hashlib
from datetime import datetime
from typing import List, Optional

from fastapi import (
    FastAPI,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from redis.asyncio import Redis

from db import get_conn
from rate_limit_redis import rate_limit
from security_headers import SecurityHeadersMiddleware

from pathlib import Path

from fastapi.responses import HTMLResponse
from notifications.push import notify_list_updated

from psycopg import AsyncConnection
from notifications.subscriptions import upsert_ios_subscription, delete_ios_subscription

from pydantic import BaseModel


BASE_DIR = Path(__file__).resolve().parent
DASHBOARD_TEMPLATE = BASE_DIR / "templates" / "stats_dashboard.html"


app = FastAPI(title="SharedList Backend E2E")

# Basic CORS (open for development; restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add basic security headers
app.add_middleware(SecurityHeadersMiddleware)

# ---------- Redis client ----------

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
redis_client: Redis = Redis.from_url(REDIS_URL, decode_responses=False)


# ---------- Helper identità morbida ----------


def hash_client_id(client_id: str) -> str:
    return hashlib.sha256(client_id.encode("utf-8")).hexdigest()


async def get_client_id(x_client_id: Optional[str] = Header(None, alias="X-Client-Id"),) -> str:
    if not x_client_id:
        raise HTTPException(status_code=400, detail="Missing X-Client-Id header")
    return x_client_id


# ---------- Pydantic models ----------


class ListCreatePayload(BaseModel):
    list_id: str = Field(..., alias="list_id")
    meta_ciphertext_b64: str
    meta_nonce_b64: str


class ListResponse(BaseModel):
    list_id: str
    meta_ciphertext_b64: str
    meta_nonce_b64: str
    created_at: str


class ListDeletedResponse(BaseModel):
    list_id: str
    deleted: bool


class ItemCreatePayload(BaseModel):
    ciphertext_b64: str
    nonce_b64: str
    client_item_id: Optional[str] = None


class ItemUpdatePayload(BaseModel):
    ciphertext_b64: str
    nonce_b64: str


class ItemResponse(BaseModel):
    item_id: int
    ciphertext_b64: str
    nonce_b64: str
    created_at: str
    updated_at: str
    rev: int
    deleted: bool = False


class ItemsListResponse(BaseModel):
    items: List[ItemResponse]
    latest_rev: Optional[int] = None


class ErrorResponse(BaseModel):
    detail: str


class StatsUsagePoint(BaseModel):
    day: str
    lists_created: int
    items_created: int


class StatsUsageResponse(BaseModel):
    points: List[StatsUsagePoint]
    total_lists: int
    total_items: int


class ItemDeleted(BaseModel):
    item_id: int
    deleted: bool
    rev: int

class HealthzResponse(BaseModel):
    status: str


class IOSPushSubscribeBody(BaseModel):
    device_token: str




# ---------- Endpoint ios subscription ----------

@app.post(
    "/v1/lists/{list_id}/push/ios/subscribe",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def ios_push_subscribe(
    list_id: str,
    body: IOSPushSubscribeBody,
    x_client_id: str = Header(..., alias="X-Client-Id"),
    db: AsyncConnection = Depends(get_conn),
):
    # volendo puoi controllare che la lista esista prima
    print(
        "[iOS Subscribe]",
        "list_id=",
        list_id,
        "client_id=",
        x_client_id,
        "token_prefix=",
        body.device_token[:8] if body.device_token else "",
    )
    await upsert_ios_subscription(db, list_id, x_client_id, body.device_token)
    await db.commit()
    return

@app.delete(
    "/v1/lists/{list_id}/push/ios/subscribe",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def ios_push_unsubscribe(
    list_id: str,
    body: IOSPushSubscribeBody,
    x_client_id: str = Header(..., alias="X-Client-Id"),
    db: AsyncConnection = Depends(get_conn),
):
    print(
        "[iOS Unsubscribe]",
        "list_id=",
        list_id,
        "client_id=",
        x_client_id,
        "token_prefix=",
        body.device_token[:8] if body.device_token else "",
    )
    await delete_ios_subscription(db, list_id, x_client_id, body.device_token)
    await db.commit()
    return


# ---------- Endpoint liste ----------

@app.post(
    "/v1/lists",
    response_model=ListResponse,
    responses={429: {"model": ErrorResponse}},
)
async def create_list(
    payload: ListCreatePayload,
    request: Request,
    client_id: str = Depends(get_client_id),
    conn=Depends(get_conn),
):
    ip = request.client.host if request.client else "unknown"

    # Rate limiting via Redis
    await rate_limit(redis_client, f"ip:{ip}", max_requests=60, window_seconds=60)
    await rate_limit(
        redis_client, f"client_lists:{client_id}", max_requests=20, window_seconds=60
    )

    try:
        meta_bytes = base64.b64decode(payload.meta_ciphertext_b64)
        nonce_bytes = base64.b64decode(payload.meta_nonce_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 in meta")

    owner_hash = hash_client_id(client_id)

    async with conn.cursor() as cur:
        try:
            await cur.execute(
                """
                INSERT INTO lists (id, created_at, owner_client_hash, meta, meta_nonce)
                VALUES (%s, NOW(), %s, %s, %s)
                """,
                (payload.list_id, owner_hash, meta_bytes, nonce_bytes),
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not create list: {e}")

        await conn.commit()

        await cur.execute(
            "SELECT created_at FROM lists WHERE id = %s",
            (payload.list_id,),
        )
        row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=500, detail="List created but not found")

    created_at: datetime = row["created_at"]

    return ListResponse(
        list_id=payload.list_id,
        meta_ciphertext_b64=payload.meta_ciphertext_b64,
        meta_nonce_b64=payload.meta_nonce_b64,
        created_at=created_at.isoformat(),
    )


@app.get(
    "/v1/lists/{list_id}",
    response_model=ListResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_list(
    list_id: str,
    conn=Depends(get_conn),
):
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT meta, meta_nonce, created_at
            FROM lists
            WHERE id = %s
            """,
            (list_id,),
        )
        row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="List not found")

    meta_bytes = row["meta"]
    nonce_bytes = row["meta_nonce"]
    created_at: datetime = row["created_at"]

    return ListResponse(
        list_id=list_id,
        meta_ciphertext_b64=base64.b64encode(meta_bytes).decode("ascii"),
        meta_nonce_b64=base64.b64encode(nonce_bytes).decode("ascii"),
        created_at=created_at.isoformat(),
    )


@app.delete(
    "/v1/lists/{list_id}",
    response_model=ListDeletedResponse,
)
async def delete_list(
    list_id: str,
    request: Request,
    client_id: str = Depends(get_client_id),
    conn=Depends(get_conn),
):
    ip = request.client.host if request.client else "unknown"
    await rate_limit(redis_client, f"ip:{ip}", max_requests=60, window_seconds=60)
    await rate_limit(
        redis_client, f"client_delete_list:{client_id}", max_requests=10, window_seconds=60
    )

    async with conn.cursor() as cur:
        # DELETE idempotente: non alziamo 404 se la lista non esiste
        await cur.execute(
            "DELETE FROM lists WHERE id = %s RETURNING id",
            (list_id,),
        )
        row = await cur.fetchone()
        await conn.commit()

    # deleted = True se esisteva almeno una riga, False altrimenti
    deleted = bool(row)
    return ListDeletedResponse(list_id=list_id, deleted=deleted)


# ---------- Endpoint items ----------


@app.post(
    "/v1/lists/{list_id}/items",
    response_model=ItemResponse,
    responses={404: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
async def create_item(
    list_id: str,
    payload: ItemCreatePayload,
    request: Request,
    client_id: str = Depends(get_client_id),
    conn=Depends(get_conn),
):
    ip = request.client.host if request.client else "unknown"

    await rate_limit(redis_client, f"ip:{ip}", max_requests=120, window_seconds=60)
    await rate_limit(
        redis_client, f"client_write:{client_id}", max_requests=60, window_seconds=60
    )
    await rate_limit(
        redis_client, f"list_write:{list_id}", max_requests=60, window_seconds=60
    )

    try:
        ciphertext = base64.b64decode(payload.ciphertext_b64)
        nonce = base64.b64decode(payload.nonce_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 in item")

    async with conn.cursor() as cur:
        await cur.execute("SELECT 1 FROM lists WHERE id = %s", (list_id,))
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="List not found")

        await cur.execute(
            "SELECT COUNT(*) AS cnt FROM list_items WHERE list_id = %s",
            (list_id,),
        )
        cnt_row = await cur.fetchone()
        if cnt_row and cnt_row["cnt"] >= 500:
            raise HTTPException(
                status_code=400,
                detail="Item limit reached for this list (max 500)",
            )

        client_hash = hash_client_id(client_id)

        await cur.execute(
            """
            INSERT INTO list_items (list_id, ciphertext, nonce, updated_by_client_hash)
            VALUES (%s, %s, %s, %s)
            RETURNING id, created_at, updated_at, rev, deleted
            """,
            (list_id, ciphertext, nonce, client_hash),
        )
        row = await cur.fetchone()
        await conn.commit()

    item_id = row["id"]
    created_at: datetime = row["created_at"]
    updated_at: datetime = row["updated_at"]
    rev = row["rev"]
    deleted = row["deleted"]

    await notify_list_updated(conn, list_id, rev)

    return ItemResponse(
        item_id=item_id,
        ciphertext_b64=payload.ciphertext_b64,
        nonce_b64=payload.nonce_b64,
        created_at=created_at.isoformat(),
        updated_at=updated_at.isoformat(),
        rev=rev,
        deleted=deleted
    )


@app.get(
    "/v1/lists/{list_id}/items",
    response_model=ItemsListResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_items(
    list_id: str,
    since_rev: Optional[int] = Query(
        None,
        description="If set, returns only items with rev > since_rev",
    ),
    conn=Depends(get_conn),
):
    async with conn.cursor() as cur:
        await cur.execute("SELECT 1 FROM lists WHERE id = %s", (list_id,))
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="List not found")

        if since_rev is not None:
            await cur.execute(
                """
                SELECT id, ciphertext, nonce, created_at, updated_at, rev, deleted
                FROM list_items
                WHERE list_id = %s AND rev > %s
                ORDER BY rev ASC
                """,
                (list_id, since_rev),
            )
        else:
            await cur.execute(
                """
                SELECT id, ciphertext, nonce, created_at, updated_at, rev, deleted
                FROM list_items
                WHERE list_id = %s AND NOT deleted
                ORDER BY created_at ASC
                """,
                (list_id,),
            )

        rows = await cur.fetchall()

        await cur.execute(
            """
            SELECT MAX(rev) AS latest_rev
            FROM list_items
            WHERE list_id = %s
            """,
            (list_id,),
        )
        latest_row = await cur.fetchone()

    latest_rev = latest_row["latest_rev"] if latest_row else None

    items: List[ItemResponse] = []
    for row in rows:
        items.append(
            ItemResponse(
                item_id=row["id"],
                ciphertext_b64=base64.b64encode(row["ciphertext"]).decode("ascii"),
                nonce_b64=base64.b64encode(row["nonce"]).decode("ascii"),
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat(),
                rev=row["rev"],
                deleted=row["deleted"],
            )
        )

    return ItemsListResponse(items=items, latest_rev=latest_rev)


@app.put(
    "/v1/lists/{list_id}/items/{item_id}",
    response_model=ItemResponse,
    responses={404: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
async def update_item(
    list_id: str,
    item_id: int,
    payload: ItemUpdatePayload,
    request: Request,
    client_id: str = Depends(get_client_id),
    conn=Depends(get_conn),
):
    ip = request.client.host if request.client else "unknown"

    await rate_limit(redis_client, f"ip:{ip}", max_requests=120, window_seconds=60)
    await rate_limit(
        redis_client, f"client_write:{client_id}", max_requests=60, window_seconds=60
    )
    await rate_limit(
        redis_client, f"list_write:{list_id}", max_requests=60, window_seconds=60
    )

    try:
        ciphertext = base64.b64decode(payload.ciphertext_b64)
        nonce = base64.b64decode(payload.nonce_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 in item")

    client_hash = hash_client_id(client_id)

    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT 1 FROM list_items WHERE id = %s AND list_id = %s",
            (item_id, list_id),
        )
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="Item not found")

        await cur.execute(
            """
            UPDATE list_items
            SET ciphertext = %s,
                nonce = %s,
                updated_at = NOW(),
                updated_by_client_hash = %s,
                rev = nextval('list_items_rev_seq')
            WHERE id = %s AND list_id = %s
            RETURNING id, ciphertext, nonce, created_at, updated_at, rev, deleted
            """,
            (ciphertext, nonce, client_hash, item_id, list_id),
        )
        row = await cur.fetchone()
        await conn.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Item not found after update")

    await notify_list_updated(conn, list_id, row["rev"])

    return ItemResponse(
        item_id=row["id"],
        ciphertext_b64=base64.b64encode(row["ciphertext"]).decode("ascii"),
        nonce_b64=base64.b64encode(row["nonce"]).decode("ascii"),
        created_at=row["created_at"].isoformat(),
        updated_at=row["updated_at"].isoformat(),
        rev=row["rev"],
        deleted=row["deleted"],
    )

"""
@app.delete(
    "/v1/lists/{list_id}/items/{item_id}",
    response_model=ItemDeleted,
    responses={404: {"model": ErrorResponse}},
)
async def delete_item(
    list_id: str,
    item_id: int,
    request: Request,
    client_id: str = Depends(get_client_id),
    conn=Depends(get_conn),
):
    ip = request.client.host if request.client else "unknown"
    await rate_limit(redis_client, f"ip:{ip}", max_requests=120, window_seconds=60)
    await rate_limit(
        redis_client, f"client_write:{client_id}", max_requests=60, window_seconds=60
    )

    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM list_items WHERE id = %s AND list_id = %s RETURNING id, rev",
            (item_id, list_id),
        )
        row = await cur.fetchone()
        await conn.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Item not found")

    await notify_list_updated(conn, list_id, row["rev"])

    return ItemDeleted(item_id=item_id, deleted=True)
"""
@app.delete(
    "/v1/lists/{list_id}/items/{item_id}",
    response_model=ItemDeleted,
    responses={404: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
async def delete_item(
    list_id: str,
    item_id: int,
    request: Request,
    client_id: str = Depends(get_client_id),
    conn=Depends(get_conn),
):
    ip = request.client.host if request.client else "unknown"
    await rate_limit(redis_client, f"ip:{ip}", max_requests=120, window_seconds=60)
    await rate_limit(
        redis_client, f"client_write:{client_id}", max_requests=60, window_seconds=60
    )
    await rate_limit(
        redis_client, f"list_write:{list_id}", max_requests=60, window_seconds=60
    )

    client_hash = hash_client_id(client_id)

    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE list_items
            SET deleted = TRUE,
                updated_at = NOW(),
                updated_by_client_hash = %s,
                rev = nextval('list_items_rev_seq')
            WHERE id = %s AND list_id = %s
            RETURNING id, rev
            """,
            (client_hash, item_id, list_id),
        )
        row = await cur.fetchone()
        await conn.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Item not found")

    latest_rev = row["rev"]

    # se hai già una funzione per notificare gli update, chiamala qui:
    await notify_list_updated(conn, list_id=list_id, latest_rev=latest_rev)

    return ItemDeleted(item_id=item_id, deleted=True, rev=latest_rev)

# ---------- Usage statistics ----------


@app.get("/v1/stats/usage", response_model=StatsUsageResponse)
async def stats_usage(conn=Depends(get_conn)):
    """Basic usage stats: lists and items per day, plus totals."""
    async with conn.cursor() as cur:
        #await cur.execute(
        #    """
        #    ALTER TABLE list_items
        #    ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE;
        #    """
        #)
        #await conn.commit()
        await cur.execute(
            """
            SELECT date_trunc('day', created_at)::date AS day, count(*) AS lists
            FROM lists
            GROUP BY day
            ORDER BY day
            """
        )
        list_rows = await cur.fetchall()

        await cur.execute(
            """
            SELECT date_trunc('day', created_at)::date AS day, count(*) AS items
            FROM list_items
            GROUP BY day
            ORDER BY day
            """
        )
        item_rows = await cur.fetchall()

        await cur.execute("SELECT count(*) AS total_lists FROM lists")
        total_lists_row = await cur.fetchone()
        await cur.execute("SELECT count(*) AS total_items FROM list_items")
        total_items_row = await cur.fetchone()

    total_lists = total_lists_row["total_lists"] if total_lists_row else 0
    total_items = total_items_row["total_items"] if total_items_row else 0

    by_day: dict[str, StatsUsagePoint] = {}

    for r in list_rows:
        day_str = r["day"].isoformat()
        by_day[day_str] = StatsUsagePoint(
            day=day_str,
            lists_created=r["lists"],
            items_created=0,
        )

    for r in item_rows:
        day_str = r["day"].isoformat()
        if day_str not in by_day:
            by_day[day_str] = StatsUsagePoint(
                day=day_str,
                lists_created=0,
                items_created=r["items"],
            )
        else:
            by_day[day_str].items_created = r["items"]

    points = sorted(by_day.values(), key=lambda p: p.day)

    return StatsUsageResponse(
        points=points,
        total_lists=total_lists,
        total_items=total_items,
    )

@app.get("/stats/dashboard", response_class=HTMLResponse)
async def stats_dashboard():
    """
    Simple HTML dashboard that consumes /v1/stats/usage and renders a chart.
    HTML is stored in templates/stats_dashboard.html.
    """
    try:
        html = DASHBOARD_TEMPLATE.read_text(encoding="utf-8")
    except FileNotFoundError:
        # In prod meglio loggare, qui basta un 404 onesto
        raise HTTPException(status_code=404, detail="Dashboard template not found")
    return HTMLResponse(content=html)


@app.get("/healthz", response_model=HealthzResponse, include_in_schema=False)
async def healthz(conn=Depends(get_conn)):
    """
    Endpoint di healthcheck.

    - Se il backend, Postgres e Redis sono raggiungibili -> 200 {"status": "ok"}
    - Se qualcosa va storto -> 500 (il client considers backend offline)
    """
    # check DB
    try:
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1")
            await cur.fetchone()
    except Exception:
        raise HTTPException(status_code=500, detail="DB not available")

    # check Redis
    try:
        await redis_client.ping()
    except Exception:
        raise HTTPException(status_code=500, detail="Redis not available")

    return HealthzResponse(status="ok")
