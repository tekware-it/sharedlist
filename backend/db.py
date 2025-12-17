# db.py
import os
import psycopg
from psycopg.rows import dict_row


DB_DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://sharedlist:sharedlist@db:5432/sharedlist",
)


async def get_conn():
    """
    FastAPI dependency: open an async connection and yield it.

    IMPORTANT:
    - No @asynccontextmanager decorator here.
    - Just an async generator with `yield`.
    """
    conn = await psycopg.AsyncConnection.connect(DB_DSN, row_factory=dict_row)
    try:
        yield conn
    finally:
        await conn.close()

