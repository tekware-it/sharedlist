# notifications/fcm.py
import os
import json
import time
import httpx
from google.oauth2 import service_account
import google.auth.transport.requests as google_requests

FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "")
SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"]

_creds = None

def _get_credentials():
  global _creds
  if _creds is None:
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path:
      raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS not set")
    _creds = service_account.Credentials.from_service_account_file(
      cred_path, scopes=SCOPES
    )
  return _creds

def _get_access_token() -> str:
  creds = _get_credentials()
  request = google_requests.Request()
  creds.refresh(request)
  return creds.token

def list_topic(list_id: str) -> str:
  safe = "".join(c if c.isalnum() else "_" for c in list_id)
  return f"list_{safe}"

async def send_list_update_fcm(list_id: str, latest_rev: int | None = None) -> None:
  """Invia un data message FCM al topic della lista (Android)."""
  if not FIREBASE_PROJECT_ID:
    print("FCM disabled: FIREBASE_PROJECT_ID not set")
    return

  topic = list_topic(list_id)
  access_token = _get_access_token()

  data = {
    "type": "list_updated",
    "list_id": list_id,
  }
  if latest_rev is not None:
    data["latest_rev"] = str(latest_rev)

  msg = {
    "message": {
      "topic": topic,
      "data": data,
      "android": {
        "priority": "high",
      },
    }
  }

  url = f"https://fcm.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/messages:send"
  headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json; charset=utf-8",
  }

  async with httpx.AsyncClient(timeout=5.0) as client:
    r = await client.post(url, headers=headers, json=msg)
    if r.status_code >= 400:
      print("FCM send error:", r.status_code, r.text)

