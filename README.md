# Marginalia — Highlight & Note

A Chrome extension that lets you highlight passages on any webpage and jot a
note in the margin, the way you'd mark up a book. Highlights are saved
locally and reappear automatically when you revisit the page.

## Install (load unpacked)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension from these files).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `marginalia` folder.
5. The "M" icon will appear in your toolbar. Pin it for easy access.

## How to use it

- **Highlight**: select any text on a page. A small toolbar appears above
  your selection with four highlighter colors — click one.
- **Add a note**: right after highlighting, a note box opens automatically.
  Type a thought and click **Save**, or just click away to leave it blank.
- **Edit or delete**: click any existing highlight on the page to reopen its
  note, change its color, or delete it.
- **Right-click menu**: select text, right-click, and choose
  *Highlight with Marginalia* as an alternative to the floating toolbar.
- **Review everything**: click the toolbar icon to open the popup. It shows
  highlights on the current page plus everything you've saved across other
  pages, with search, a jump-to-passage button, and delete.
- **Badge**: the toolbar icon shows a number — how many highlights exist on
  the page you're currently viewing.

## How it works

- All data is stored locally via `chrome.storage.local` — nothing leaves
  your machine, there's no account and no network calls.
- Highlights are matched back onto the page by their saved text, so they
  reappear next time you visit, even after closing the tab or restarting
  Chrome.

## Known limitations

- On pages where content is heavily rewritten by JavaScript after load (some
  single-page apps), a saved highlight may occasionally fail to reattach if
  the exact text moved into a different DOM structure. The note itself is
  never lost — it's still visible and editable from the popup.
- Highlighting inside iframes, PDFs viewed in Chrome's built-in viewer, or
  `chrome://` pages isn't supported (Chrome blocks extensions from those
  contexts).
- If identical text appears more than once on a page, only the first
  occurrence is highlighted on restore.

## File structure

```
marginalia/
├── manifest.json     Extension config (Manifest V3)
├── background.js     Storage, context menus, badge counts
├── content.js         Selection toolbar, highlight rendering, notes
├── content.css         Styles injected into every page
├── popup.html/css/js   Toolbar popup — browse, search, manage highlights
└── icons/              16/32/48/128px icons
```
