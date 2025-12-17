#!/usr/bin/env python
import os
import json
import uuid
import base64
import sys
from typing import Tuple, Dict, Any

import requests

BASE_URL = os.getenv("SHAREDLIST_BASE_URL", "http://localhost:8000")
CLIENT_ID = os.getenv("SHAREDLIST_CLIENT_ID", f"live-test-{uuid.uuid4()}")


def fake_ciphertext(obj: Dict[str, Any]) -> Tuple[str, str]:
    """
    Fake "encryption": JSON + nonce + base64.

    È lo stesso trucco usato nei test unitari: al backend
    interessa solo che sia base64 valido, non il contenuto.
    """
    plaintext = json.dumps(obj)
    nonce = "live-test-nonce"
    payload = f"{plaintext}|{nonce}".encode("utf-8")

    ciphertext_b64 = base64.b64encode(payload).decode("ascii")
    nonce_b64 = base64.b64encode(nonce.encode("utf-8")).decode("ascii")
    return ciphertext_b64, nonce_b64


def get_stats():
    resp = requests.get(f"{BASE_URL}/v1/stats/usage")
    resp.raise_for_status()
    return resp.json()


def create_list(name: str) -> str:
    list_id = str(uuid.uuid4())
    meta = {
        "name": name,
        "flagsDefinition": {},  # per ora vuoto, lato server è opaco
    }
    ciphertext_b64, nonce_b64 = fake_ciphertext(meta)

    resp = requests.post(
        f"{BASE_URL}/v1/lists",
        json={
            "list_id": list_id,
            "meta_ciphertext_b64": ciphertext_b64,
            "meta_nonce_b64": nonce_b64,
        },
        headers={"X-Client-Id": CLIENT_ID},
    )
    print("CREATE LIST status:", resp.status_code, resp.text)
    resp.raise_for_status()
    data = resp.json()
    assert data["list_id"] == list_id
    return list_id


def create_item(list_id: str, label: str):
    payload = {
        "label": label,
        "flags": {"checked": False, "crossed": False, "highlighted": False},
    }
    ciphertext_b64, nonce_b64 = fake_ciphertext(payload)

    resp = requests.post(
        f"{BASE_URL}/v1/lists/{list_id}/items",
        json={
            "ciphertext_b64": ciphertext_b64,
            "nonce_b64": nonce_b64,
        },
        headers={"X-Client-Id": CLIENT_ID},
    )
    print("CREATE ITEM status:", resp.status_code, resp.text)
    resp.raise_for_status()
    return resp.json()


def main():
    print(f"Using BASE_URL={BASE_URL}")
    print(f"Using CLIENT_ID={CLIENT_ID}")
    print("Fetching initial stats...")
    before = get_stats()
    print("Initial stats:", json.dumps(before, indent=2))

    before_lists = before.get("total_lists", 0)
    before_items = before.get("total_items", 0)

    print("\nCreating a test list and some items...")
    list_id = create_list("Lista live test")
    create_item(list_id, "Pane")
    create_item(list_id, "Latte")
    create_item(list_id, "Uova")

    print("\nFetching stats after creating list+items...")
    after = get_stats()
    print("After stats:", json.dumps(after, indent=2))

    after_lists = after.get("total_lists", 0)
    after_items = after.get("total_items", 0)

    # Check very basic invariants
    if after_lists < before_lists + 1:
        print(
            f"[FAIL] Expected at least {before_lists + 1} lists, "
            f"got {after_lists}"
        )
        sys.exit(1)

    if after_items < before_items + 3:
        print(
            f"[FAIL] Expected at least {before_items + 3} items, "
            f"got {after_items}"
        )
        sys.exit(1)

    print("\n[OK] Stats updated as expected.")
    sys.exit(0)


if __name__ == "__main__":
    main()

