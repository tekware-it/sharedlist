# notifications/subscriptions.py
from typing import List
from psycopg import AsyncConnection

async def get_ios_tokens_for_list(conn: AsyncConnection, list_id: str) -> List[str]:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT device_token FROM ios_push_subscriptions WHERE list_id = %s",
            (list_id,),
        )
        rows = await cur.fetchall()
    return [r["device_token"] for r in rows]

async def upsert_ios_subscription(
    conn: AsyncConnection,
    list_id: str,
    client_id: str,
    device_token: str,
) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO ios_push_subscriptions (list_id, client_id, device_token)
            VALUES (%s, %s, %s)
            ON CONFLICT (list_id, client_id, device_token)
            DO UPDATE SET updated_at = now()
            """,
            (list_id, client_id, device_token),
        )

async def delete_ios_subscription(
    conn: AsyncConnection,
    list_id: str,
    client_id: str,
    device_token: str,
) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            DELETE FROM ios_push_subscriptions
            WHERE list_id = %s AND client_id = %s AND device_token = %s
            """,
            (list_id, client_id, device_token),
        )
