import pytest
from agent.tools.profile_store import load_profile, save_profile, merge_profile, remember_user_details

@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("PROFILE_STORE_LOCAL_PATH", str(tmp_path / "profile.json"))
    monkeypatch.setenv("PROFILE_STORE_SOURCE", "local")
    yield

def test_remember_merges_and_persists():
    remember_user_details({"Full Name": "Maya Gurung", "Email": "maya@example.com"})
    p = load_profile()
    assert p["Full Name"] == "Maya Gurung"
    # next form auto-fills: second call merges new key, keeps old
    remember_user_details({"Phone": "9800000000"})
    p2 = load_profile()
    assert p2["Full Name"] == "Maya Gurung"
    assert p2["Phone"] == "9800000000"

def test_merge_overwrites_and_skips_empty():
    save_profile({"Full Name": "Old"})
    remember_user_details({"Full Name": "New", "Empty": ""})
    p = load_profile()
    assert p["Full Name"] == "New"
    assert "Empty" not in p
