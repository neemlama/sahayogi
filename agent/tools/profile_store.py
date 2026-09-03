"""profile_store — cross-session memory for FormBuddy.

Like session_store/audit_log, dual-backend (local JSON / DynamoDB) behind env vars,
but this one is *user*-scoped, not session-scoped. The orchestrator calls
remember_user_details whenever the user provides a concrete value (name, email,
phone, ward, etc.) and the API layer injects the saved profile into every
new turn so future forms auto-fill.

Zero-AWS-cost by default: local JSON file at infra/seed-data/profile.local.json.
Swaps to DynamoDB with PROFILE_STORE_SOURCE=dynamodb (same pattern as others).

This is what makes sequential Q&A feel like ChatGPT: ask one missing question,
save the answer, and the next form with a similarly-labelled field już auto-fills.
"""

import json
import os
from pathlib import Path
from typing import Any

from strands import tool

_DEFAULT_LOCAL_PATH = Path(__file__).resolve().parents[2] / "infra" / "seed-data" / "profile.local.json"


def _local_path() -> Path:
    return Path(os.environ.get("PROFILE_STORE_LOCAL_PATH", _DEFAULT_LOCAL_PATH))


def _use_dynamodb() -> bool:
    return os.environ.get("PROFILE_STORE_SOURCE", "local") == "dynamodb"


def _table():
    import boto3

    name = os.environ.get("PROFILE_TABLE_NAME", "formbuddy-profile")
    return boto3.resource("dynamodb").Table(name)


def load_profile(user_id: str = "default") -> dict[str, Any]:
    """Load saved profile dict for user_id. Returns {} if none."""
    if _use_dynamodb():
        resp = _table().get_item(Key={"user_id": user_id})
        item = resp.get("Item")
        return item.get("profile", {}) if item else {}
    path = _local_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "profile" in data and isinstance(data["profile"], dict):
            return data["profile"]
        if user_id in data and isinstance(data[user_id], dict):
            return data[user_id]
        if user_id == "default" and isinstance(data, dict):
            return data
        return {}
    except Exception:
        return {}


def save_profile(profile: dict[str, Any], user_id: str = "default") -> dict[str, Any]:
    if _use_dynamodb():
        _table().put_item(Item={"user_id": user_id, "profile": profile})
        return profile
    path = _local_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # store as flat dict for default user (simplest for demo)
    if user_id == "default":
        path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        existing = {}
        if path.exists():
            try:
                existing = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                existing = {}
        existing[user_id] = profile
        path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    return profile


def merge_profile(updates: dict[str, Any], user_id: str = "default") -> dict[str, Any]:
    """Merge non-empty updates into stored profile and persist."""
    profile = load_profile(user_id)
    for k, v in updates.items():
        if v is None or v == "":
            continue
        # normalize keys: lower, strip
        kk = k.strip()
        profile[kk] = v
    save_profile(profile, user_id)
    return profile


@tool
def remember_user_details(details: dict[str, Any], user_id: str = "default") -> dict[str, Any]:
    """Remember details the user just provided so future forms auto-fill.

    Call this whenever the user answers a question about themselves
    (name, email, phone, ward, address, etc.). It merges into durable
    cross-session profile storage. The next form that has a similarly-labelled
    field will be auto-filled from this memory without asking again.

    Args:
        details: Dict of label-ish keys to values, e.g. {"Full Name": "Maya Gurung", "Email": "maya@example.com"}.
        user_id: Profile key, default "default" for single-user demo.

    Returns:
        The full saved profile after merge.
    """
    # sanitize: drop empty, trim
    cleaned = {str(k).strip(): str(v).strip() for k, v in details.items() if str(v).strip()}
    if not cleaned:
        return load_profile(user_id)
    return merge_profile(cleaned, user_id)


def profile_as_text(profile: dict[str, Any]) -> str:
    """Render profile as lines for prompt injection."""
    if not profile:
        return ""
    return "\n".join(f"{k}: {v}" for k, v in profile.items())
