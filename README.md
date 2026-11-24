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
- **Use the calendar.** The month calendar below the writing box puts a dot under every day you wrote on. Click a day to see its entries, and use **‹** and **›** to move between months.
- **Write an entry.** Type in the box and click **Add entry** (or press `Ctrl + Enter`).
- **Add a mood and tags (optional).** Under the writing box, pick an emoji for how you feel (click it again to clear it), and type tags such as `work, family`. Tags can use letters, numbers, `-` and `_`.
- **See your entries.** Every entry for the selected date shows as a card with the time you wrote it. Long entries show a short preview.
- **Open an entry.** Click a card (or select it with `Tab` and press `Enter`) to expand it into a larger view with the full text. Close it with **×**, `Esc`, or by clicking outside it.
- **Edit an entry.** Open it and click **Edit**. Change the text, mood or tags, then click **Save** (or press `Ctrl + Enter`). Click **Cancel** or press `Esc` to stop editing; you'll be asked before unsaved changes are thrown away.
- **Delete an entry.** Click the **×** in the corner of a card, or **Delete entry** in the expanded view.
- **Search.** Type in the search box to find entries from any day that contain that text (upper and lower case don't matter). Results show newest first, with their dates. To see every entry with a tag, click the tag on a card or type it with a `#` (for example `#work`). Clear the box, pick a date, or click **Today** to go back to the day view.
- **Log out.** Click **Log out** in the top right.

## Your data

- Entries are saved in a file called `journal.db` in this folder. Keep it to keep your entries, and back it up if they matter to you.
- To keep your own copy, click **Export .md** (easy to read, grouped by day) or **Export .json** (every detail, for other programs) at the top of the page. Times in the Markdown file are in UTC.
- Each account sees only its own entries.
- Passwords are never stored. Only a secure scrambled version (an argon2 hash) is kept.
- You stay logged in for 30 days unless you log out.
- After 5 wrong passwords, an account is locked for 15 minutes.

## Security

- Passwords are hashed with argon2; login tokens are random and only stored as hashes.
- The login cookie can't be read by JavaScript (HttpOnly) and isn't sent by other websites (SameSite).
- Requests from other websites or other apps on your computer are rejected (Origin check), and so are requests using an unexpected host name (DNS-rebinding protection).
- A strict Content Security Policy only lets the page run its own scripts, and the app can't be embedded in another site.
- Journal text is never cached by the browser.

The app is meant to run only on your own computer. Before putting it on the internet, serve it over HTTPS and mark the login cookie `Secure` (see the `shortcut:` comment in `app.py`), add your domain to the allowed hosts, and move the login lockout out of memory if you run more than one worker.

## For developers

- `app.py`: the FastAPI backend (login, sessions, entries API) and SQLite database setup.
- `static/`: the pages (`index.html`, `login.html`), their scripts (`journal.js`, `login.js`) and the shared `style.css`. Keep scripts and styles in these files: the Content Security Policy blocks inline `<script>` and `<style>`.
- `test_app.py`: the tests. Run them with:
  ```
  pip install -r requirements-dev.txt
  python -m pytest
  ```
- API docs are available at **http://localhost:8000/docs** while the app is running.
- Set the `JOURNAL_DB` environment variable to use a different database file.
