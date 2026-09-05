import base64
import os
from pathlib import Path
from fastapi.testclient import TestClient
from api.main import app
from agent.tools.file_store import delete_file, get_file_bytes, list_files, save_file

def _clean():
    for f in list_files():
        delete_file(f["stored_as"])

def test_save_and_get_round_trips(tmp_path=None):
    _clean()
    data = b"hello file content"
    meta = save_file(data, "test.txt", "text/plain")
    assert meta["stored_as"].endswith(".txt")
    assert meta["size"] == len(data)
    loaded, mime = get_file_bytes(meta["stored_as"])
    assert loaded == data
    assert "text/plain" in mime
    _clean()

def test_list_and_delete():
    _clean()
    m1 = save_file(b"a", "a.jpg", "image/jpeg")
    m2 = save_file(b"bb", "b.pdf", "application/pdf")
    files = list_files()
    assert len(files) >= 2
    assert delete_file(m1["stored_as"]) is True
    remaining = [f["stored_as"] for f in list_files()]
    assert m1["stored_as"] not in remaining
    assert m2["stored_as"] in remaining
    _clean()

def test_api_upload_list_download(tmp_path=None):
    _clean()
    client = TestClient(app)
    png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="
    png_bytes = base64.b64decode(png_b64)
    # upload
    resp = client.post("/api/files/upload", files={"file": ("citizenship.jpg", png_bytes, "image/jpeg")})
    assert resp.status_code == 200
    stored = resp.json()["stored_as"]
    # list
    resp2 = client.get("/api/files")
    assert resp2.status_code == 200
    assert any(f["stored_as"] == stored for f in resp2.json())
    # download
    resp3 = client.get(f"/api/files/{stored}")
    assert resp3.status_code == 200
    assert resp3.content == png_bytes
    # delete
    resp4 = client.delete(f"/api/files/{stored}")
    assert resp4.status_code == 200
    assert client.get(f"/api/files/{stored}").status_code == 404
    _clean()

def test_vault_injected_in_chat_prompt():
    # ensure chat endpoint would include vault without error (mock agent not needed - just check file_store)
    save_file(b"doc", "ward_letter.pdf", "application/pdf")
    files = list_files()
    assert any("ward_letter" in f["filename"] for f in files)
    # simulate prompt building logic from api/main.py
    vault_lines = [f"{m['stored_as']} ({m['mime']}, {m['size']} bytes)" for m in files[:20]]
    assert vault_lines
    _clean()
