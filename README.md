# Daily Journal

A simple, colorful journal that runs in your browser. Pick a date, write an entry, and it appears as a card for that day.

## Getting started

You need [Python 3](https://www.python.org/downloads/) installed.

1. Open a terminal in this folder.
2. Start the app:
   ```
   python -m http.server 8000
   ```
3. Open **http://localhost:8000** in your browser.

To stop it, press `Ctrl + C` in the terminal.

## How to use it

- **Pick a date.** The date starts on today. Choose any other day with the date picker, or click **Today** to jump back.
- **Write an entry.** Type in the box and click **Add entry** (or press `Ctrl + Enter`).
- **See your entries.** Every entry for the selected date shows as a card with the time you wrote it.
- **Delete an entry.** Click the **×** in the corner of a card.

## Important: your entries are temporary

For now there are no accounts and nothing is saved to a server. Entries are kept only in the current browser tab:

- Refreshing the page **keeps** your entries.
- Closing the tab or the browser **deletes** them.
- Entries are not shared between tabs, browsers or devices.

Saving entries permanently is planned for a later version.
