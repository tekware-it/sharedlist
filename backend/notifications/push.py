# notifications/push.py
from psycopg import AsyncConnection
from .fcm import send_list_update_fcm
from .apns import send_list_update_apns
from .subscriptions import get_ios_tokens_for_list

async def notify_list_updated(
  conn: AsyncConnection,
  list_id: str,
  latest_rev: int | None,
) -> None:
  # Android: FCM topic
  await send_list_update_fcm(list_id, latest_rev)
"""
  # iOS: token per lista dal DB + APNs
  ios_tokens = await get_ios_tokens_for_list(conn, list_id)
  if ios_tokens:
    await send_list_update_apns(list_id, latest_rev, ios_tokens)
"""

