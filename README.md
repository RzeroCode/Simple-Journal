# Daily Journal

A simple, colorful journal that runs in your browser. Create an account, pick a date, and write entries that appear as cards for that day. Your entries are saved, so they're still there next time you log in.

## Getting started

You need [Python 3.10 or newer](https://www.python.org/downloads/).

1. Open a terminal in this folder.
2. Set up the app (first time only):
   ```
   python -m venv .venv
   .venv\Scripts\activate          # Windows
   source .venv/bin/activate       # macOS / Linux
   pip install -r requirements.txt
   ```
3. Start the app:
   ```
   python -m uvicorn app:app --host 127.0.0.1 --port 8000
   ```
4. Open **http://localhost:8000** in your browser.

To stop it, press `Ctrl + C` in the terminal. Next time, you only need to activate the environment (step 2, second line) and start the app (step 3).

## How to use it

- **Create an account.** On the login page, click **Create one**, then enter your email and a password of at least 8 characters.
- **Log in.** Use the same email and password next time.
- **Pick a date.** The date starts on today. Choose any other day with the date picker, or click **Today** to jump back.
- **Write an entry.** Type in the box and click **Add entry** (or press `Ctrl + Enter`).
- **See your entries.** Every entry for the selected date shows as a card with the time you wrote it. Long entries show a short preview.
- **Open an entry.** Click a card (or select it with `Tab` and press `Enter`) to expand it into a larger view with the full text. Close it with **×**, `Esc`, or by clicking outside it.
- **Delete an entry.** Click the **×** in the corner of a card, or **Delete entry** in the expanded view.
- **Log out.** Click **Log out** in the top right.

## Your data

- Entries are saved in a file called `journal.db` in this folder. Keep it to keep your entries, and back it up if they matter to you.
- Each account sees only its own entries.
- Passwords are never stored. Only a secure scrambled version (an argon2 hash) is kept.
- You stay logged in for 30 days unless you log out.
- The app is set up to run only on your own computer. It is not ready to be put on the internet yet: it has no protection against password guessing and does not use HTTPS.

## For developers

- `app.py`: the FastAPI backend (login, sessions, entries API) and SQLite database setup.
- `static/`: the pages (`index.html`, `login.html`) and shared `style.css`.
- `test_app.py`: the tests. Run them with:
  ```
  pip install -r requirements-dev.txt
  python -m pytest
  ```
- API docs are available at **http://localhost:8000/docs** while the app is running.
- Set the `JOURNAL_DB` environment variable to use a different database file.
