# tests/test_api.py
import base64
import json
import uuid
from typing import Tuple, Dict, Any, List

import pytest
from fastapi.testclient import TestClient

from main import app, redis_client


@pytest.fixture(scope="session")
def client() -> TestClient:
    """Single TestClient for the whole test session."""
    with TestClient(app) as c:
        yield c


def fake_ciphertext(obj: Dict[str, Any]) -> Tuple[str, str]:
    """Fake "encryption" for tests: JSON + nonce + base64.

    In production you will use proper E2E crypto on the client.
    Here we only care that the backend accepts and returns valid base64.
    """
    plaintext = json.dumps(obj)
    nonce = "test-nonce"
    payload = f"{plaintext}|{nonce}".encode("utf-8")
    ciphertext_b64 = base64.b64encode(payload).decode("ascii")
    nonce_b64 = base64.b64encode(nonce.encode("utf-8")).decode("ascii")
    return ciphertext_b64, nonce_b64


def create_test_list(client: TestClient, client_id: str = "test-client") -> str:
    """Create a test list and return its ID."""
    list_id = str(uuid.uuid4())
    meta = {
        "name": "Spesa test",
        "flagsDefinition": {},
    }
    ciphertext_b64, nonce_b64 = fake_ciphertext(meta)

    res = client.post(
        "/v1/lists",
        json={
            "list_id": list_id,
            "meta_ciphertext_b64": ciphertext_b64,
            "meta_nonce_b64": nonce_b64,
        },
        headers={"X-Client-Id": client_id},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["list_id"] == list_id
    return list_id


def create_test_item(
    client: TestClient,
    list_id: str,
    client_id: str,
    payload_extra: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Create a test item in a list and return the response JSON."""
    item_payload = {
        "label": "Latte",
        "flags": {"checked": False, "crossed": False, "highlighted": False},
    }
    if payload_extra:
        item_payload.update(payload_extra)

    ciphertext_b64, nonce_b64 = fake_ciphertext(item_payload)

    res = client.post(
        f"/v1/lists/{list_id}/items",
        json={
            "ciphertext_b64": ciphertext_b64,
            "nonce_b64": nonce_b64,
        },
        headers={"X-Client-Id": client_id},
    )
    assert res.status_code == 200, res.text
    return res.json()


# ----------------- BASE API TESTS -----------------


def test_create_list_ok(client: TestClient):
    list_id = create_test_list(client, client_id="test-client-1")

    # fetch meta to be sure
    res = client.get(f"/v1/lists/{list_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["list_id"] == list_id
    assert "meta_ciphertext_b64" in data
    assert "meta_nonce_b64" in data


# ----------------- RATE LIMITING -----------------


def test_rate_limit_create_items(client: TestClient):
    """Verify that item creation rate limiting kicks in.

    Same list + same client should eventually get HTTP 429.
    """
    client_id = "rate-limit-client"
    list_id = create_test_list(client, client_id=client_id)

    status_codes: List[int] = []
    for i in range(0, 80):  # above the configured per-minute threshold
        item_payload = {
            "label": f"Item {i}",
            "flags": {"checked": False, "crossed": False, "highlighted": False},
            "idx": i,
        }
        ciphertext_b64, nonce_b64 = fake_ciphertext(item_payload)

        r = client.post(
            f"/v1/lists/{list_id}/items",
            json={
                "ciphertext_b64": ciphertext_b64,
                "nonce_b64": nonce_b64,
            },
            headers={"X-Client-Id": client_id},
        )
        status_codes.append(r.status_code)

    assert any(code == 429 for code in status_codes), status_codes


# ----------------- rev / ?since_rev= -----------------


def test_rev_increases_and_latest_rev_matches(client: TestClient):
    """Check that rev increases and latest_rev matches max rev in list."""
    client_id = "rev-client-1"
    list_id = create_test_list(client, client_id=client_id)

    # create 3 items
    responses = []
    for i in range(3):
        resp = create_test_item(
            client,
            list_id=list_id,
            client_id=client_id,
            payload_extra={"i": i},
        )
        responses.append(resp)

    revs = [r["rev"] for r in responses]
    assert revs == sorted(revs), "revs are not monotonically increasing"

    # fetch all items
    res = client.get(f"/v1/lists/{list_id}/items")
    assert res.status_code == 200
    data = res.json()

    assert "items" in data
    assert "latest_rev" in data

    items = data["items"]
    latest_rev = data["latest_rev"]

    assert len(items) >= 3
    max_rev_items = max(it["rev"] for it in items)
    assert max_rev_items == latest_rev


def test_since_rev_returns_only_newer_changes(client: TestClient):
    """Full rev / since_rev flow.

    - create list
    - create 3 items (rev1, rev2, rev3)
    - GET /items, save initial_latest_rev = rv3
    - update 1 item (rv4)
    - create new item (rv5)
    - GET /items?since_rev=rv3:
      -> get exactly 2 items (updated + new), all rev > rv3, ordered
      -> latest_rev == rv5
    - GET /items?since_rev=latest_rev:
      -> empty items, same latest_rev
    """
    client_id = "rev-client-2"
    list_id = create_test_list(client, client_id=client_id)

    # create 3 items
    for i in range(3):
        create_test_item(
            client,
            list_id=list_id,
            client_id=client_id,
            payload_extra={"i": i},
        )

    # initial GET
    res_all = client.get(f"/v1/lists/{list_id}/items")
    assert res_all.status_code == 200
    data_all = res_all.json()
    initial_latest_rev = data_all["latest_rev"]
    assert initial_latest_rev is not None

    first_item_id = data_all["items"][0]["item_id"]

    # update first item
    updated_payload = {
        "label": "Latte aggiornato",
        "flags": {"checked": True, "crossed": False, "highlighted": False},
    }
    ciphertext_b64_upd, nonce_b64_upd = fake_ciphertext(updated_payload)

    res_upd = client.put(
        f"/v1/lists/{list_id}/items/{first_item_id}",
        json={
            "ciphertext_b64": ciphertext_b64_upd,
            "nonce_b64": nonce_b64_upd,
        },
        headers={"X-Client-Id": client_id},
    )
    assert res_upd.status_code == 200
    data_upd = res_upd.json()
    rev_after_update = data_upd["rev"]
    assert rev_after_update > initial_latest_rev

    # create new item
    new_item_resp = create_test_item(
        client,
        list_id=list_id,
        client_id=client_id,
        payload_extra={"i": 99},
    )
    rev_new_item = new_item_resp["rev"]
    assert rev_new_item > rev_after_update

    # GET delta
    res_delta = client.get(
        f"/v1/lists/{list_id}/items",
        params={"since_rev": initial_latest_rev},
    )
    assert res_delta.status_code == 200
    data_delta = res_delta.json()

    delta_items = data_delta["items"]
    latest_rev_after = data_delta["latest_rev"]

    assert len(delta_items) == 2, delta_items

    revs_delta = [it["rev"] for it in delta_items]
    assert all(rv > initial_latest_rev for rv in revs_delta)
    assert revs_delta == sorted(revs_delta)

    assert latest_rev_after == rev_new_item

    # GET with since_rev = latest_rev -> empty delta
    res_empty = client.get(
        f"/v1/lists/{list_id}/items",
        params={"since_rev": latest_rev_after},
    )
    assert res_empty.status_code == 200
    data_empty = res_empty.json()
    assert data_empty["items"] == []
    assert data_empty["latest_rev"] == latest_rev_after

def test_delete_list_idempotent(client: TestClient):
    client_id = "delete-client"
    list_id = create_test_list(client, client_id=client_id)

    # prima volta: esiste davvero
    res1 = client.delete(
        f"/v1/lists/{list_id}",
        headers={"X-Client-Id": client_id},
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["list_id"] == list_id
    assert data1["deleted"] is True

    # seconda volta: non esiste più, ma non deve rompere
    res2 = client.delete(
        f"/v1/lists/{list_id}",
        headers={"X-Client-Id": client_id},
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["list_id"] == list_id
    assert data2["deleted"] is False

