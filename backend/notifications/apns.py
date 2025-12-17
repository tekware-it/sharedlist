# notifications/apns.py

"""
APNS_TEAM_ID=XXXXXXXXXX
APNS_KEY_ID=YYYYYYYYYY
APNS_BUNDLE_ID=com.example.sharedlist
APNS_PRIVATE_KEY_PATH=/run/secrets/apns-key.p8
APNS_USE_SANDBOX=true   # o false in produzione
"""

import os
import time
import json
from typing import Iterable
import httpx
import jwt  # pyjwt

APNS_TEAM_ID = os.environ.get("APNS_TEAM_ID", "")
APNS_KEY_ID = os.environ.get("APNS_KEY_ID", "")
APNS_BUNDLE_ID = os.environ.get("APNS_BUNDLE_ID", "")
APNS_PRIVATE_KEY_PATH = os.environ.get("APNS_PRIVATE_KEY_PATH", "")
APNS_USE_SANDBOX = os.environ.get("APNS_USE_SANDBOX", "true").lower() == "true"

_apns_jwt = None
_apns_jwt_exp = 0

def _load_private_key() -> str:
  if not APNS_PRIVATE_KEY_PATH:
    raise RuntimeError("APNS_PRIVATE_KEY_PATH not set")
  with open(APNS_PRIVATE_KEY_PATH, "r") as f:
    return f.read()

def _get_apns_jwt() -> str:
  """Token APNs valido ~20 minuti."""
  global _apns_jwt, _apns_jwt_exp
  now = int(time.time())
  if _apns_jwt is None or now > _apns_jwt_exp - 60:
    private_key = _load_private_key()
    headers = {
      "alg": "ES256",
      "kid": APNS_KEY_ID,
    }
    claims = {
      "iss": APNS_TEAM_ID,
      "iat": now,
    }
    _apns_jwt = jwt.encode(
      claims,
      private_key,
      algorithm="ES256",
      headers=headers,
    )
    _apns_jwt_exp = now + 20 * 60
  return _apns_jwt

def _apns_base_url() -> str:
  if APNS_USE_SANDBOX:
    return "https://api.sandbox.push.apple.com"
  return "https://api.push.apple.com"

async def send_list_update_apns(
  list_id: str,
  latest_rev: int | None,
  device_tokens: Iterable[str],
) -> None:
  """Invia una notifica APNs a tutti i device iOS iscritti a quella lista."""
  if not (APNS_TEAM_ID and APNS_KEY_ID and APNS_BUNDLE_ID and APNS_PRIVATE_KEY_PATH):
    print("APNs disabled: missing config")
    return

  if not device_tokens:
    return

  token = _get_apns_jwt()
  url_base = _apns_base_url()

  payload = {
    "aps": {
      "alert": {
        "title": "Lista aggiornata",
        "body": "Una lista condivisa è stata modificata.",
      },
      "sound": "default",
    },
    "type": "list_updated",
    "list_id": list_id,
  }
  if latest_rev is not None:
    payload["latest_rev"] = str(latest_rev)

  headers = {
    "authorization": f"bearer {token}",
    "apns-topic": APNS_BUNDLE_ID,
    "apns-push-type": "alert",
    "content-type": "application/json",
  }

  async with httpx.AsyncClient(http2=True, timeout=5.0) as client:
    for dev_token in device_tokens:
      url = f"{url_base}/3/device/{dev_token}"
      r = await client.post(url, headers=headers, content=json.dumps(payload))
      if r.status_code >= 400:
        print("APNs send error:", r.status_code, r.text)

