"""Daily Journal backend: FastAPI + SQLite, email/password login, per-user entries."""
import hashlib
import mimetypes
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import date as Date, datetime, timedelta, timezone
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

# Windows' registry can map .js to text/plain; with nosniff the browser would then refuse to run it.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")

HERE = Path(__file__).parent
STATIC = HERE / "static"
DB_PATH = os.environ.get("JOURNAL_DB", str(HERE / "journal.db"))
SESSION_DAYS = 30
SEARCH_LIMIT = 100
ph = PasswordHasher()
# Checked for unknown emails too, so response time doesn't reveal which accounts exist.
DUMMY_HASH = ph.hash(secrets.token_urlsafe(16))

MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 15 * 60
# shortcut: in-memory and per-process, so it resets on restart; move to the DB or Redis if run with several workers.
failed_logins: dict[str, list[float]] = {}

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_user_date ON entries(user_id, date);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_token(token: str) -> str:
    # Only hashes are stored, so a leaked database can't be used to hijack sessions.
    return hashlib.sha256(token.encode()).hexdigest()


def connect() -> sqlite3.Connection:
    # check_same_thread=False: FastAPI may run the dependency and the endpoint on different
    # worker threads; each request still gets its own connection.
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # SQLite's own lower()/LIKE only fold ASCII, so "Çay" wouldn't match "çay".
    conn.create_function("casefold", 1, str.casefold, deterministic=True)
    return conn


@asynccontextmanager
async def lifespan(_app):
    with connect() as conn:
        conn.executescript(SCHEMA)
    yield


app = FastAPI(title="Daily Journal", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")
# Blocks DNS-rebinding: a hostile domain pointed at 127.0.0.1 is rejected by its Host header.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # Other apps on localhost count as "same-site", so SameSite cookies alone don't stop them posting here.
    # Browsers always send Origin on cross-origin writes; reject any that isn't this site.
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin and origin != f"{request.url.scheme}://{request.url.netloc}":
        response = JSONResponse({"detail": "Cross-origin request blocked"}, status_code=403)
    else:
        response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
    if not request.url.path.startswith(("/docs", "/redoc")):  # the API docs page needs its own inline scripts
        response.headers["Content-Security-Policy"] = CSP
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"  # keep journal text out of the browser cache
    elif request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"  # revalidate so updated CSS/JS is picked up at once
    return response


def recent_failures(key: str) -> int:
    cutoff = time.monotonic() - LOCKOUT_SECONDS
    recent = [t for t in failed_logins.pop(key, []) if t > cutoff]
    if recent:
        failed_logins[key] = recent
    return len(recent)


def get_db():
    conn = connect()
    try:
        with conn:  # commits on success, rolls back on error
            yield conn
    finally:
        conn.close()


def user_id_from(session: str | None, db: sqlite3.Connection) -> int | None:
    if not session:
        return None
    row = db.execute(
        "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
        (hash_token(session), now()),
    ).fetchone()
    return row["user_id"] if row else None


def current_user(session: str | None = Cookie(default=None), db=Depends(get_db)) -> int:
    user_id = user_id_from(session, db)
    if user_id is None:
        raise HTTPException(401, "Not logged in")
    return user_id


def start_session(db: sqlite3.Connection, response: Response, user_id: int) -> None:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now(),))
    db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (hash_token(token), user_id, expires.isoformat()))
    # shortcut: no secure=True because localhost is plain HTTP; turn it on once served over HTTPS.
    response.set_cookie("session", token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax")


class Credentials(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=256)


class EntryText(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=10_000)


class NewEntry(EntryText):
    date: Date


# ---------- pages ----------

@app.get("/", include_in_schema=False)
def home(session: str | None = Cookie(default=None), db=Depends(get_db)):
    if user_id_from(session, db) is None:
        return RedirectResponse("/login")
    return FileResponse(STATIC / "index.html")


@app.get("/login", include_in_schema=False)
def login_page(session: str | None = Cookie(default=None), db=Depends(get_db)):
    if user_id_from(session, db) is not None:
        return RedirectResponse("/")
    return FileResponse(STATIC / "login.html")


# ---------- auth ----------

@app.post("/api/register", status_code=201)
def register(creds: Credentials, response: Response, db=Depends(get_db)):
    email = creds.email.lower()
    try:
        cur = db.execute(
            "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
            (email, ph.hash(creds.password), now()),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "That email is already registered")
    start_session(db, response, cur.lastrowid)
    return {"email": email}


@app.post("/api/login")
def login(creds: Credentials, response: Response, db=Depends(get_db)):
    email = creds.email.lower()
    key = f"email:{email}"
    if recent_failures(key) >= MAX_FAILED_LOGINS:
        raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
    row = db.execute("SELECT id, password_hash FROM users WHERE email = ?", (email,)).fetchone()
    try:
        ph.verify(row["password_hash"] if row else DUMMY_HASH, creds.password)
        if row is None:
            raise VerifyMismatchError
    except VerifyMismatchError:
        failed_logins.setdefault(key, []).append(time.monotonic())
        raise HTTPException(401, "Wrong email or password")
    failed_logins.pop(key, None)
    start_session(db, response, row["id"])
    return {"email": email}


@app.post("/api/logout", status_code=204)
def logout(response: Response, session: str | None = Cookie(default=None), db=Depends(get_db)):
    if session:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(session),))
    response.delete_cookie("session")


@app.get("/api/me")
def me(user_id: int = Depends(current_user), db=Depends(get_db)):
    return {"email": db.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()["email"]}


# ---------- entries (every query is scoped to the logged-in user) ----------

@app.get("/api/entries")
def list_entries(date: Date, user_id: int = Depends(current_user), db=Depends(get_db)):
    rows = db.execute(
        "SELECT id, date, text, created_at FROM entries WHERE user_id = ? AND date = ? ORDER BY id",
        (user_id, date.isoformat()),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/search")
def search_entries(q: str = Query(max_length=200), user_id: int = Depends(current_user), db=Depends(get_db)):
    q = q.strip()
    if not q:
        raise HTTPException(422, "Search text can't be empty")
    # instr, not LIKE: the search text is matched literally, so % and _ need no escaping.
    rows = db.execute(
        "SELECT id, date, text, created_at FROM entries WHERE user_id = ? AND instr(casefold(text), ?) > 0 "
        "ORDER BY date DESC, id DESC LIMIT ?",
        (user_id, q.casefold(), SEARCH_LIMIT),
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/entries", status_code=201)
def add_entry(entry: NewEntry, user_id: int = Depends(current_user), db=Depends(get_db)):
    created = now()
    cur = db.execute(
        "INSERT INTO entries (user_id, date, text, created_at) VALUES (?, ?, ?, ?)",
        (user_id, entry.date.isoformat(), entry.text, created),
    )
    return {"id": cur.lastrowid, "date": entry.date.isoformat(), "text": entry.text, "created_at": created}


@app.patch("/api/entries/{entry_id}")
def edit_entry(entry_id: int, body: EntryText, user_id: int = Depends(current_user), db=Depends(get_db)):
    row = db.execute(
        "UPDATE entries SET text = ? WHERE id = ? AND user_id = ? RETURNING id, date, text, created_at",
        (body.text, entry_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Entry not found")
    return dict(row)


@app.delete("/api/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int, user_id: int = Depends(current_user), db=Depends(get_db)):
    deleted = db.execute("DELETE FROM entries WHERE id = ? AND user_id = ?", (entry_id, user_id)).rowcount
    if not deleted:
        raise HTTPException(404, "Entry not found")
