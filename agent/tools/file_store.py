"""file_store — FormBuddy document & image vault.

Like profile_store/session_store: dual intent but file bytes need disk/S3, not DynamoDB JSON.
MVP: local disk at infra/seed-data/files.local/ + JSON index at files.local.json.
Swaps to S3 with FILE_STORE_SOURCE=s3 (env: FILE_STORE_BUCKET, FILE_STORE_PREFIX).

This is what lets FormBuddy *auto-upload* files instead of asking the user to
click "Add file" manually: files are uploaded once to the vault, then the
extension fetches them by filename and injects via DataTransfer into the
page's <input type=file> (see extension/background.js file handling).

Zero-AWS-cost by default. S3 mode is a drop-in for AgentCore deploy.
"""
import json
import os
import mimetypes
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

_DEFAULT_LOCAL_DIR = Path(__file__).resolve().parents[2] / "infra" / "seed-data" / "files.local"
_DEFAULT_INDEX = Path(__file__).resolve().parents[2] / "infra" / "seed-data" / "files.local.json"

def _local_dir() -> Path:
    return Path(os.environ.get("FILE_STORE_LOCAL_DIR", str(_DEFAULT_LOCAL_DIR)))

def _index_path() -> Path:
    return Path(os.environ.get("FILE_STORE_INDEX", str(_DEFAULT_INDEX)))

def _use_s3() -> bool:
    return os.environ.get("FILE_STORE_SOURCE", "local") == "s3"

def _safe_name(name: str) -> str:
    # keep extension, sanitize stem
    p = Path(name)
    stem = "".join(c if c.isalnum() or c in "-_." else "_" for c in p.stem)[:80]
    suffix = "".join(c for c in p.suffix if c.isalnum() or c in "._-")[:10]
    if not stem:
        stem = uuid.uuid4().hex[:8]
    return stem + suffix

# --- local helpers ---
def _load_index() -> dict[str, Any]:
    path = _index_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

def _save_index(idx: dict[str, Any]) -> None:
    path = _index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")

# --- S3 helpers (lazy) ---
def _s3_client():
    import boto3
    return boto3.client("s3")

def _s3_bucket() -> str:
    return os.environ.get("FILE_STORE_BUCKET", "formbuddy-files")

def _s3_prefix() -> str:
    return os.environ.get("FILE_STORE_PREFIX", "vault/").strip("/") + "/"

# --- public API ---
def save_file(data: bytes, filename: str, mime: str | None = None) -> dict[str, Any]:
    """Persist file bytes and return metadata {filename, stored_as, mime, size, uploaded_at}."""
    safe = _safe_name(filename)
    # avoid collision: if safe exists, prefix with short uuid
    dir_ = _local_dir()
    mime = mime or mimetypes.guess_type(safe)[0] or "application/octet-stream"
    if _use_s3():
        key = _s3_prefix() + safe
        # collision check: list not needed, just overwrite with uuid prefix if needed
        try:
            _s3_client().head_object(Bucket=_s3_bucket(), Key=key)
            # exists -> rename
            safe = uuid.uuid4().hex[:6] + "_" + safe
            key = _s3_prefix() + safe
        except Exception:
            pass
        _s3_client().put_object(Bucket=_s3_bucket(), Key=key, Body=data, ContentType=mime)
        meta = {"filename": filename, "stored_as": safe, "mime": mime, "size": len(data), "uploaded_at": time.time(), "source": "s3", "s3_key": key}
        # also keep index locally for quick listing
        idx = _load_index()
        idx[safe] = meta
        _save_index(idx)
        return meta
    else:
        dir_.mkdir(parents=True, exist_ok=True)
        # handle collision locally
        target = dir_ / safe
        if target.exists():
            safe = uuid.uuid4().hex[:6] + "_" + safe
            target = dir_ / safe
        target.write_bytes(data)
        meta = {"filename": filename, "stored_as": safe, "mime": mime, "size": len(data), "uploaded_at": time.time(), "source": "local"}
        idx = _load_index()
        idx[safe] = meta
        _save_index(idx)
        return meta

def list_files() -> list[dict[str, Any]]:
    if _use_s3():
        # prefer index, but also list S3 for truth
        idx = _load_index()
        return sorted(idx.values(), key=lambda x: x.get("uploaded_at", 0), reverse=True)
    idx = _load_index()
    # filter to files that still exist on disk
    dir_ = _local_dir()
    out = []
    for safe, meta in idx.items():
        if (dir_ / safe).exists():
            out.append(meta)
    # also include orphan files on disk not in index
    if dir_.exists():
        for p in dir_.iterdir():
            if p.is_file() and p.name not in idx:
                out.append({"filename": p.name, "stored_as": p.name, "mime": mimetypes.guess_type(p.name)[0] or "application/octet-stream", "size": p.stat().st_size, "uploaded_at": p.stat().st_mtime, "source": "local"})
    return sorted(out, key=lambda x: x.get("uploaded_at", 0), reverse=True)

def get_file_bytes(stored_as: str) -> tuple[bytes, str] | None:
    """Return (bytes, mime) or None if not found."""
    idx = _load_index()
    meta = idx.get(stored_as)
    if _use_s3():
        if meta and "s3_key" in meta:
            try:
                resp = _s3_client().get_object(Bucket=_s3_bucket(), Key=meta["s3_key"])
                return resp["Body"].read(), meta.get("mime", "application/octet-stream")
            except Exception:
                return None
        # fallback: try local
    dir_ = _local_dir()
    path = dir_ / stored_as
    if path.exists():
        mime = meta.get("mime") if meta else mimetypes.guess_type(stored_as)[0] or "application/octet-stream"
        return path.read_bytes(), mime
    return None

def delete_file(stored_as: str) -> bool:
    idx = _load_index()
    meta = idx.pop(stored_as, None)
    # delete from disk/S3
    if _use_s3() and meta and "s3_key" in meta:
        try:
            _s3_client().delete_object(Bucket=_s3_bucket(), Key=meta["s3_key"])
        except Exception:
            pass
    dir_ = _local_dir()
    p = dir_ / stored_as
    if p.exists():
        try:
            p.unlink()
        except Exception:
            pass
    _save_index(idx)
    return meta is not None or p.exists()

def get_file_path(stored_as: str) -> Path | None:
    """Local path for direct FileResponse (None if S3 or not found)."""
    if _use_s3():
        return None
    p = _local_dir() / stored_as
    return p if p.exists() else None
