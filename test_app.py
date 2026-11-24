import pytest
from fastapi.testclient import TestClient

import app as journal

PW = "correct horse"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(journal, "DB_PATH", str(tmp_path / "test.db"))
    with TestClient(journal.app) as c:
        yield c


def new_client():
    return TestClient(journal.app)  # separate cookie jar = separate user


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


def test_users_cannot_see_or_delete_each_others_entries(client):
    client.post("/api/register", json={"email": "a@example.com", "password": PW})
    a_entry = client.post("/api/entries", json={"date": "2026-11-23", "text": "A's secret"}).json()

    b = new_client()
    b.post("/api/register", json={"email": "b@example.com", "password": PW})
    assert b.get("/api/entries?date=2026-11-23").json() == []
    assert b.delete(f"/api/entries/{a_entry['id']}").status_code == 404
    assert b.patch(f"/api/entries/{a_entry['id']}", json={"text": "hacked"}).status_code == 404
    assert client.get("/api/entries?date=2026-11-23").json()[0]["text"] == "A's secret"


def test_passwords_and_tokens_not_stored_in_plain_text(client):
    r = client.post("/api/register", json={"email": "a@example.com", "password": PW})
    token = r.cookies["session"]
    with journal.connect() as db:
        assert db.execute("SELECT password_hash FROM users").fetchone()[0].startswith("$argon2")
        assert db.execute("SELECT count(*) FROM sessions WHERE token_hash = ?", (token,)).fetchone()[0] == 0
