// popup.js

const contentEl = document.getElementById("mg-content");
const searchEl = document.getElementById("mg-search");
const countEl = document.getElementById("mg-count");
const clearAllBtn = document.getElementById("mg-clear-all");

let store = {};       // { [pageKey]: { title, highlights: [] } }
let currentTabUrl = null;
let currentTabKey = null;

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max).trim() + "…" : text;
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabUrl = tab?.url || null;
  currentTabKey = currentTabUrl ? normalizeUrl(currentTabUrl) : null;

  const res = await send("GET_ALL_HIGHLIGHTS", {});
  store = res?.store || {};
  render(searchEl.value.trim().toLowerCase());
}

function matches(query, h, title) {
  if (!query) return true;
  return (
    h.text.toLowerCase().includes(query) ||
    (h.note || "").toLowerCase().includes(query) ||
    (title || "").toLowerCase().includes(query)
  );
}

function buildCard(key, title, h) {
  const card = document.createElement("div");
  card.className = "mg-card";
  card.style.setProperty("--card-color", `var(--${h.color})`);

  const body = document.createElement("div");
  body.className = "mg-card-body";

  const text = document.createElement("p");
  text.className = "mg-card-text";
  text.textContent = "“" + truncate(h.text, 160) + "”";
  body.appendChild(text);

  if (h.note) {
    const note = document.createElement("div");
    note.className = "mg-card-note";
    note.textContent = h.note;
    body.appendChild(note);
  }

  const meta = document.createElement("div");
  meta.className = "mg-card-meta";
  meta.textContent = timeAgo(h.createdAt);
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "mg-card-actions";

  const jumpBtn = document.createElement("button");
  jumpBtn.className = "mg-icon-btn";
  jumpBtn.title = "Go to passage";
  jumpBtn.textContent = "↗";
  jumpBtn.addEventListener("click", () => jumpTo(key, h.id));

  const delBtn = document.createElement("button");
  delBtn.className = "mg-icon-btn mg-delete";
  delBtn.title = "Delete";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => deleteHighlight(key, h.id));

  actions.append(jumpBtn, delBtn);
  card.append(body, actions);
  return card;
}

function render(query) {
  contentEl.innerHTML = "";
  let totalShown = 0;
  let totalPages = 0;

  // "On this page" — pinned section for the active tab, if it has any highlights.
  if (currentTabKey && store[currentTabKey]) {
    const pageHighlights = store[currentTabKey].highlights.filter((h) =>
      matches(query, h, store[currentTabKey].title)
    );
    if (pageHighlights.length) {
      const label = document.createElement("div");
      label.className = "mg-section-label";
      label.textContent = "On this page";
      contentEl.appendChild(label);
      pageHighlights
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .forEach((h) => contentEl.appendChild(buildCard(currentTabKey, store[currentTabKey].title, h)));
      totalShown += pageHighlights.length;
    }
  }

  // All other pages, most recently active first.
  const otherKeys = Object.keys(store)
    .filter((k) => k !== currentTabKey)
    .sort((a, b) => {
      const lastA = Math.max(...store[a].highlights.map((h) => h.createdAt));
      const lastB = Math.max(...store[b].highlights.map((h) => h.createdAt));
      return lastB - lastA;
    });

  let anyOther = false;
  for (const key of otherKeys) {
    const group = store[key];
    const filtered = group.highlights.filter((h) => matches(query, h, group.title));
    if (!filtered.length) continue;
    if (!anyOther) {
      const label = document.createElement("div");
      label.className = "mg-section-label";
      label.textContent = "All notes";
      contentEl.appendChild(label);
      anyOther = true;
    }
    totalPages++;
    const groupEl = document.createElement("div");
    groupEl.className = "mg-group";
    const titleEl = document.createElement("div");
    titleEl.className = "mg-group-title";
    titleEl.innerHTML = `<span>${escapeHtml(group.title || hostnameOf(key))}</span><span class="mg-page-count">${filtered.length}</span>`;
    titleEl.title = key;
    titleEl.addEventListener("click", () => jumpTo(key));
    groupEl.appendChild(titleEl);
    filtered
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .forEach((h) => groupEl.appendChild(buildCard(key, group.title, h)));
    contentEl.appendChild(groupEl);
    totalShown += filtered.length;
  }

  if (totalShown === 0) {
    const empty = document.createElement("div");
    empty.className = "mg-empty";
    empty.innerHTML = query
      ? `<div class="mg-empty-glyph">?</div><p>No highlights match “${escapeHtml(query)}.”</p>`
      : `<div class="mg-empty-glyph">¶</div><p>Select any text on a page, pick a color, and your highlight<br>will show up here.</p>`;
    contentEl.appendChild(empty);
  }

  const allCount = Object.values(store).reduce((sum, g) => sum + g.highlights.length, 0);
  const pageCount = Object.keys(store).length;
  countEl.textContent = allCount === 0
    ? "0 highlights"
    : `${allCount} highlight${allCount === 1 ? "" : "s"} across ${pageCount} page${pageCount === 1 ? "" : "s"}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function jumpTo(key, highlightId) {
  const group = store[key];
  if (!group) return;
  const tabs = await chrome.tabs.query({});
  const match = tabs.find((t) => t.url && normalizeUrl(t.url) === key);

  const scrollWhenReady = (tabId) => {
    if (!highlightId) return;
    chrome.tabs.sendMessage(tabId, { type: "SCROLLTO_HIGHLIGHT", id: highlightId }).catch(() => {});
  };

  if (match) {
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
    scrollWhenReady(match.id);
  } else {
    const newTab = await chrome.tabs.create({ url: key });
    const listener = (tabId, info) => {
      if (tabId === newTab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => scrollWhenReady(newTab.id), 200);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
}

async function deleteHighlight(key, id) {
  await send("DELETE_HIGHLIGHT", { url: key, id });
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.url && normalizeUrl(t.url) === key) {
      chrome.tabs.sendMessage(t.id, { type: "REMOVE_HIGHLIGHT_DOM", id }).catch(() => {});
    }
  }
  await load();
}

clearAllBtn.addEventListener("click", async () => {
  const allCount = Object.values(store).reduce((sum, g) => sum + g.highlights.length, 0);
  if (allCount === 0) return;
  if (!confirm(`Delete all ${allCount} highlights and notes? This can't be undone.`)) return;
  await send("CLEAR_ALL", {});
  await load();
});

searchEl.addEventListener("input", () => render(searchEl.value.trim().toLowerCase()));

load();
