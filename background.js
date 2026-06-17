// background.js — single source of truth for stored highlights.
// Storage shape: { [pageKey]: { title: string, highlights: Highlight[] } }
// Highlight: { id, text, note, color, createdAt }

const COLORS = [
  { id: "yellow", label: "Yellow", hex: "#FFD966" },
  { id: "mint", label: "Mint", hex: "#8FD9A8" },
  { id: "pink", label: "Pink", hex: "#FF9EC4" },
  { id: "sky", label: "Sky", hex: "#8EC5FC" }
];

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

async function getStore() {
  const data = await chrome.storage.local.get("marginalia");
  return data.marginalia || {};
}

async function setStore(store) {
  await chrome.storage.local.set({ marginalia: store });
}

async function addHighlight({ url, title, text, color, note }) {
  const store = await getStore();
  const key = normalizeUrl(url);
  if (!store[key]) store[key] = { title, highlights: [] };
  store[key].title = title || store[key].title;
  const highlight = {
    id: crypto.randomUUID(),
    text: text.slice(0, 600),
    note: note || "",
    color,
    createdAt: Date.now()
  };
  store[key].highlights.push(highlight);
  await setStore(store);
  await updateBadgeForUrl(url);
  return highlight;
}

async function deleteHighlight({ url, id }) {
  const store = await getStore();
  const key = normalizeUrl(url);
  if (!store[key]) return;
  store[key].highlights = store[key].highlights.filter((h) => h.id !== id);
  if (store[key].highlights.length === 0) delete store[key];
  await setStore(store);
  await updateBadgeForUrl(url);
}

async function updateHighlight({ url, id, note, color }) {
  const store = await getStore();
  const key = normalizeUrl(url);
  if (!store[key]) return;
  const h = store[key].highlights.find((x) => x.id === id);
  if (!h) return;
  if (note !== undefined) h.note = note;
  if (color !== undefined) h.color = color;
  await setStore(store);
}

async function clearPage({ url }) {
  const store = await getStore();
  delete store[normalizeUrl(url)];
  await setStore(store);
  await updateBadgeForUrl(url);
}

async function clearAll() {
  await setStore({});
}

async function updateBadgeForUrl(url) {
  const key = normalizeUrl(url);
  const store = await getStore();
  const count = store[key]?.highlights?.length || 0;
  const tabs = await chrome.tabs.query({ url: url.split("#")[0] + "*" });
  for (const tab of tabs) {
    chrome.action.setBadgeText({ tabId: tab.id, text: count ? String(count) : "" });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#2B4570" });
  }
}

// --- context menus ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "marginalia-root",
    title: "Highlight with Marginalia",
    contexts: ["selection"]
  });
  for (const c of COLORS) {
    chrome.contextMenus.create({
      id: `marginalia-${c.id}`,
      parentId: "marginalia-root",
      title: c.label,
      contexts: ["selection"]
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.menuItemId.startsWith("marginalia-") || info.menuItemId === "marginalia-root") return;
  const color = info.menuItemId.replace("marginalia-", "");
  chrome.tabs.sendMessage(tab.id, { type: "CONTEXT_HIGHLIGHT", color });
});

// --- badge upkeep as tabs change ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) updateBadgeForUrl(tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) updateBadgeForUrl(tab.url);
});

// --- message router ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "SAVE_HIGHLIGHT": {
        const h = await addHighlight(msg.payload);
        sendResponse({ ok: true, highlight: h });
        break;
      }
      case "DELETE_HIGHLIGHT": {
        await deleteHighlight(msg.payload);
        sendResponse({ ok: true });
        break;
      }
      case "UPDATE_HIGHLIGHT": {
        await updateHighlight(msg.payload);
        sendResponse({ ok: true });
        break;
      }
      case "CLEAR_PAGE": {
        await clearPage(msg.payload);
        sendResponse({ ok: true });
        break;
      }
      case "CLEAR_ALL": {
        await clearAll();
        sendResponse({ ok: true });
        break;
      }
      case "GET_PAGE_HIGHLIGHTS": {
        const store = await getStore();
        const key = normalizeUrl(msg.payload.url);
        sendResponse({ ok: true, highlights: store[key]?.highlights || [] });
        break;
      }
      case "GET_ALL_HIGHLIGHTS": {
        const store = await getStore();
        sendResponse({ ok: true, store });
        break;
      }
      case "GET_COLORS": {
        sendResponse({ ok: true, colors: COLORS });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown message type" });
    }
  })();
  return true; // keep channel open for async sendResponse
});
