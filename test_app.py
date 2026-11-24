import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as journal

PW = "correct horse"


BASE = "http://127.0.0.1"  # must be an allowed host


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(journal, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(journal, "failed_logins", {})
    with TestClient(journal.app, base_url=BASE) as c:
        yield c


def new_client():
    return TestClient(journal.app, base_url=BASE)  # separate cookie jar = separate user


def test_pages_require_login(client):
    assert client.get("/", follow_redirects=False).headers["location"] == "/login"
    assert client.get("/login").status_code == 200
    assert client.get("/api/entries?date=2026-11-23").status_code == 401


def test_register_login_logout(client):
    r = client.post("/api/register", json={"email": "A@Example.com", "password": PW})
    assert r.status_code == 201 and r.json() == {"email": "a@example.com"}
    assert client.get("/api/me").json() == {"email": "a@example.com"}
    assert client.get("/", follow_redirects=False).status_code == 200

    assert client.post("/api/register", json={"email": "a@example.com", "password": PW}).status_code == 409

    assert client.post("/api/logout").status_code == 204
    assert client.get("/api/me").status_code == 401

    assert client.post("/api/login", json={"email": "a@example.com", "password": "wrong pass"}).status_code == 401
    assert client.post("/api/login", json={"email": "nobody@example.com", "password": PW}).status_code == 401
    assert client.post("/api/login", json={"email": "a@example.com", "password": PW}).status_code == 200
    assert client.get("/api/me").status_code == 200


def test_validation(client):
    assert client.post("/api/register", json={"email": "not-an-email", "password": PW}).status_code == 422
    assert client.post("/api/register", json={"email": "a@example.com", "password": "short"}).status_code == 422
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    assert client.post("/api/entries", json={"date": "2026-11-23", "text": "   "}).status_code == 422
    assert client.post("/api/entries", json={"date": "not-a-date", "text": "hi"}).status_code == 422


def test_entries_by_date(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    e = client.post("/api/entries", json={"date": "2026-11-23", "text": "  hello  "}).json()
    assert e["text"] == "hello"
    client.post("/api/entries", json={"date": "2026-11-22", "text": "yesterday"})

    assert [x["text"] for x in client.get("/api/entries?date=2026-11-23").json()] == ["hello"]
    assert client.delete(f"/api/entries/{e['id']}").status_code == 204
    assert client.get("/api/entries?date=2026-11-23").json() == []
    assert len(client.get("/api/entries?date=2026-11-22").json()) == 1


def test_edit_entry(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    e = client.post("/api/entries", json={"date": "2026-11-23", "text": "first draft"}).json()

    r = client.patch(f"/api/entries/{e['id']}", json={"text": "  second draft  "})
    assert r.status_code == 200
    assert r.json() == {**e, "text": "second draft"}  # date and created_at unchanged
    assert client.get("/api/entries?date=2026-11-23").json()[0]["text"] == "second draft"

    assert client.patch(f"/api/entries/{e['id']}", json={"text": "   "}).status_code == 422
    assert client.patch("/api/entries/9999", json={"text": "x"}).status_code == 404
    assert new_client().patch(f"/api/entries/{e['id']}", json={"text": "x"}).status_code == 401


def test_mood_and_tags(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    e = client.post("/api/entries", json={
        "date": "2026-11-23", "text": "tea", "mood": "great", "tags": ["#Work", "aile", "work", " Çay "],
    }).json()
    assert (e["mood"], e["tags"]) == ("great", ["work", "aile", "çay"])  # cleaned, lower-cased, no duplicates
    plain = client.post("/api/entries", json={"date": "2026-11-22", "text": "no extras"}).json()
    assert (plain["mood"], plain["tags"]) == (None, [])

    # An edit that only sends text keeps mood and tags; sending them replaces them.
    assert client.patch(f"/api/entries/{e['id']}", json={"text": "tea!"}).json()["tags"] == ["work", "aile", "çay"]
    r = client.patch(f"/api/entries/{e['id']}", json={"text": "tea!", "mood": None, "tags": ["home"]}).json()
    assert (r["text"], r["mood"], r["tags"]) == ("tea!", None, ["home"])
    assert client.get("/api/entries?date=2026-11-23").json()[0]["tags"] == ["home"]

    client.post("/api/entries", json={"date": "2026-11-24", "text": "home again", "tags": ["home"]})
    assert [x["text"] for x in client.get("/api/search?tag=%23Home").json()] == ["home again", "tea!"]
    assert [x["text"] for x in client.get("/api/search", params={"tag": "home", "q": "again"}).json()] == ["home again"]
    assert client.get("/api/search?tag=hom").json() == []  # whole tags only

    for bad in ({"mood": "ecstatic"}, {"tags": ["two words"]}, {"tags": ["x" * 31]}, {"tags": [str(i) for i in range(11)]}):
        assert client.post("/api/entries", json={"date": "2026-11-23", "text": "x", **bad}).status_code == 422

    b = new_client()
    b.post("/api/register", json={"email": "b@example.com", "password": PW})
    assert b.get("/api/search?tag=home").json() == []


def test_old_database_gets_new_columns_and_keeps_entries(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE entries (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, date TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    """)
    old.execute("INSERT INTO users VALUES (1, 'a@example.com', ?, '2026-01-01')", (journal.ph.hash(PW),))
    old.execute("INSERT INTO entries VALUES (1, 1, '2026-11-23', 'written before tags existed', '2026-11-23T10:00:00+00:00')")
    old.commit()
    old.close()

    monkeypatch.setattr(journal, "DB_PATH", str(path))
    monkeypatch.setattr(journal, "failed_logins", {})
    with TestClient(journal.app, base_url=BASE) as c:
        assert c.post("/api/login", json={"email": "a@example.com", "password": PW}).status_code == 200
        [e] = c.get("/api/entries?date=2026-11-23").json()
        assert (e["text"], e["mood"], e["tags"]) == ("written before tags existed", None, [])
        assert c.patch("/api/entries/1", json={"text": "now tagged", "tags": ["new"]}).json()["tags"] == ["new"]


def test_entry_dates(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    assert client.get("/api/entry-dates").json() == {}
    client.post("/api/entries", json={"date": "2026-11-23", "text": "one"})
    second = client.post("/api/entries", json={"date": "2026-11-23", "text": "two"}).json()
    client.post("/api/entries", json={"date": "2026-10-01", "text": "last month"})
    assert client.get("/api/entry-dates").json() == {"2026-11-23": 2, "2026-10-01": 1}

    client.delete(f"/api/entries/{second['id']}")
    assert client.get("/api/entry-dates").json() == {"2026-11-23": 1, "2026-10-01": 1}

    b = new_client()
    b.post("/api/register", json={"email": "b@example.com", "password": PW})
    assert b.get("/api/entry-dates").json() == {}
    assert new_client().get("/api/entry-dates").status_code == 401


def test_export(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    client.post("/api/entries", json={"date": "2026-11-23", "text": "Çay\non the balcony"})
    client.post("/api/entries", json={"date": "2026-11-20", "text": "older"})
    client.post("/api/entries", json={"date": "2026-11-23", "text": "later the same day"})

    r = client.get("/api/export")  # JSON by default
    assert r.headers["content-disposition"].startswith('attachment; filename="journal-')
    assert r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["email"] == "a@example.com"
    assert [(e["date"], e["text"]) for e in body["entries"]] == [
        ("2026-11-20", "older"), ("2026-11-23", "Çay\non the balcony"), ("2026-11-23", "later the same day"),
    ]

    r = client.get("/api/export?format=md")
    assert r.headers["content-type"].startswith("text/markdown")
    assert r.headers["content-disposition"].endswith('.md"')
    md = r.text
    assert md.startswith("# Daily Journal · a@example.com")
    assert md.count("## 2026-11-23") == 1  # entries grouped under one heading per day
    assert md.index("## 2026-11-20") < md.index("## 2026-11-23") < md.index("later the same day")
    assert "Çay\non the balcony" in md and " UTC*" in md

    assert client.get("/api/export?format=pdf").status_code == 422
    b = new_client()
    b.post("/api/register", json={"email": "b@example.com", "password": PW})
    assert b.get("/api/export").json()["entries"] == []
    assert new_client().get("/api/export").status_code == 401


def test_search(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    client.post("/api/entries", json={"date": "2026-11-20", "text": "Morning ÇAY with Ali"})
    client.post("/api/entries", json={"date": "2026-11-23", "text": "Evening çay, 100% relaxed"})
    client.post("/api/entries", json={"date": "2026-11-22", "text": "Went running"})

    found = client.get("/api/search", params={"q": "  çay "}).json()
    assert [e["date"] for e in found] == ["2026-11-23", "2026-11-20"]  # non-ASCII case-folded, newest first
    assert [e["text"] for e in client.get("/api/search", params={"q": "0%"}).json()] == ["Evening çay, 100% relaxed"]
    assert client.get("/api/search", params={"q": "_"}).json() == []  # literal, not a LIKE wildcard
    assert client.get("/api/search", params={"q": "   "}).status_code == 422

    b = new_client()
    b.post("/api/register", json={"email": "b@example.com", "password": PW})
    assert b.get("/api/search", params={"q": "çay"}).json() == []
    assert new_client().get("/api/search", params={"q": "çay"}).status_code == 401


def test_users_cannot_see_or_delete_each_others_entries(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    a_entry = client.post("/api/entries", json={"date": "2026-11-23", "text": "A's secret"}).json()

    b = new_client()
    b.post("/api/register", json={"email": "b@example.com", "password": PW})
    assert b.get("/api/entries?date=2026-11-23").json() == []
    assert b.delete(f"/api/entries/{a_entry['id']}").status_code == 404
    assert b.patch(f"/api/entries/{a_entry['id']}", json={"text": "hacked"}).status_code == 404
    assert client.get("/api/entries?date=2026-11-23").json()[0]["text"] == "A's secret"


def test_login_locks_after_repeated_failures(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    for _ in range(journal.MAX_FAILED_LOGINS):
        assert client.post("/api/login", json={"email": "a@example.com", "password": "wrong pass"}).status_code == 401
    # Locked: even the right password is refused until the window passes.
    assert client.post("/api/login", json={"email": "a@example.com", "password": PW}).status_code == 429
    # Other accounts are unaffected.
    client.post("/api/register", json={"email": "b@example.com", "password": PW})
    assert client.post("/api/login", json={"email": "b@example.com", "password": PW}).status_code == 200


def test_security_headers(client):
    for path in ("/login", "/api/me", "/static/journal.js"):
        h = client.get(path).headers
        assert "script-src 'self'" in h["content-security-policy"]
        assert "frame-ancestors 'none'" in h["content-security-policy"]
        assert h["x-content-type-options"] == "nosniff"
        assert h["x-frame-options"] == "DENY"
    assert client.get("/api/me").headers["cache-control"] == "no-store"
    assert client.get("/static/style.css").headers["cache-control"] == "no-cache"
    # nosniff makes browsers refuse scripts/styles served with the wrong type
    assert client.get("/static/journal.js").headers["content-type"].startswith("text/javascript")
    assert client.get("/static/theme.js").headers["content-type"].startswith("text/javascript")
    assert client.get("/static/style.css").headers["content-type"].startswith("text/css")


def test_cross_origin_writes_blocked(client):
    evil = {"Origin": "http://localhost:3000"}
    assert client.post("/api/register", json={"email": "a@example.com", "password": PW}, headers=evil).status_code == 403
    same = {"Origin": BASE}
    assert client.post("/api/register", json={"email": "a@example.com", "password": PW}, headers=same).status_code == 201
    assert client.post("/api/logout", headers=evil).status_code == 403
    assert client.get("/api/me").status_code == 200  # still logged in


def test_unknown_host_rejected(client):
    assert client.get("/login", headers={"Host": "evil.example"}).status_code == 400


@pytest.mark.skipif(shutil.which("node") is None, reason="needs Node.js to test the Markdown renderer")
def test_markdown_renderer():
    r = subprocess.run(["node", "--test", "test_markdown.cjs"], cwd=Path(__file__).parent, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_passwords_and_tokens_not_stored_in_plain_text(client):
    r = client.post("/api/register", json={"email": "a@example.com", "password": PW})
    token = r.cookies["session"]
    with journal.connect() as db:
        assert db.execute("SELECT password_hash FROM users").fetchone()[0].startswith("$argon2")
        assert db.execute("SELECT count(*) FROM sessions WHERE token_hash = ?", (token,)).fetchone()[0] == 0
