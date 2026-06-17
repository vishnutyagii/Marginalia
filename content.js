// content.js — runs on every page. Handles selection -> highlight, restoration on
// load, and the small popover used to edit notes or delete a highlight.

(() => {
  const COLORS = ["yellow", "mint", "pink", "sky"];
  let lastSelectionRange = null; // captured on contextmenu, used by the right-click flow
  let toolbarEl = null;
  let popoverEl = null;

  function pageUrl() {
    return location.href;
  }

  function send(type, payload) {
    return chrome.runtime.sendMessage({ type, payload });
  }

  // ---------- text-node utilities ----------

  function getTextNodesInRange(range) {
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // Wrap every text node touched by `range` in its own <mark>, all sharing data-mg-id.
  function wrapRange(range, id, color) {
    const textNodes = getTextNodesInRange(range).filter((n) => n.nodeValue.trim().length);
    const marks = [];
    for (const node of textNodes) {
      const sub = document.createRange();
      sub.setStart(node, node === range.startContainer ? range.startOffset : 0);
      sub.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
      if (sub.collapsed) continue;
      const mark = document.createElement("mark");
      mark.className = "mg-hl";
      mark.dataset.mgId = id;
      mark.dataset.mgColor = color;
      try {
        sub.surroundContents(mark);
        marks.push(mark);
      } catch {
        /* skip nodes that can't be safely wrapped (rare, e.g. inside a <select>) */
      }
    }
    return marks;
  }

  // Find the first un-highlighted occurrence of `text` in the document and return a Range.
  function findRangeForText(text) {
    const needle = text.trim();
    if (!needle) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        if (parent.closest(".mg-hl")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const entries = [];
    let full = "";
    let n;
    while ((n = walker.nextNode())) {
      entries.push({ node: n, start: full.length });
      full += n.nodeValue;
    }
    const idx = full.indexOf(needle);
    if (idx === -1) return null;
    const endIdx = idx + needle.length;

    let startNode, startOffset, endNode, endOffset;
    for (const e of entries) {
      const nodeEnd = e.start + e.node.nodeValue.length;
      if (startNode === undefined && idx >= e.start && idx < nodeEnd) {
        startNode = e.node;
        startOffset = idx - e.start;
      }
      if (endNode === undefined && endIdx > e.start && endIdx <= nodeEnd) {
        endNode = e.node;
        endOffset = endIdx - e.start;
      }
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  function unwrapMarks(id) {
    document.querySelectorAll(`.mg-hl[data-mg-id="${id}"]`).forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  // ---------- restore highlights saved on a previous visit ----------

  async function restoreHighlights() {
    const res = await send("GET_PAGE_HIGHLIGHTS", { url: pageUrl() });
    if (!res?.ok) return;
    for (const h of res.highlights) {
      if (document.querySelector(`.mg-hl[data-mg-id="${h.id}"]`)) continue;
      const range = findRangeForText(h.text);
      if (range) wrapRange(range, h.id, h.color);
    }
  }

  // ---------- floating selection toolbar ----------

  function removeToolbar() {
    toolbarEl?.remove();
    toolbarEl = null;
  }

  function showToolbar(rect) {
    removeToolbar();
    toolbarEl = document.createElement("div");
    toolbarEl.className = "mg-toolbar";
    for (const color of COLORS) {
      const btn = document.createElement("button");
      btn.className = "mg-dot";
      btn.dataset.mgColor = color;
      btn.title = `Highlight ${color}`;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep selection alive through the click
        e.stopPropagation();
        createHighlightFromSelection(color);
      });
      toolbarEl.appendChild(btn);
    }
    document.body.appendChild(toolbarEl);

    const tbRect = toolbarEl.getBoundingClientRect();
    let top = rect.top - tbRect.height - 8;
    if (top < 4) top = rect.bottom + 8;
    let left = rect.left + rect.width / 2 - tbRect.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - tbRect.width - 4));
    toolbarEl.style.top = `${top}px`;
    toolbarEl.style.left = `${left}px`;
  }

  function handleSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) {
      removeToolbar();
      return;
    }
    const anchorEl = sel.anchorNode?.parentElement;
    if (anchorEl?.closest(".mg-toolbar, .mg-popover")) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    showToolbar(rect);
  }

  document.addEventListener("mouseup", (e) => {
    if (e.target.closest?.(".mg-toolbar, .mg-popover")) return;
    setTimeout(handleSelectionChange, 0);
  });
  document.addEventListener("keyup", (e) => {
    if (e.shiftKey || e.key.startsWith("Arrow")) setTimeout(handleSelectionChange, 0);
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest?.(".mg-toolbar, .mg-popover")) {
      removeToolbar();
      closePopover();
    }
  });
  document.addEventListener("contextmenu", () => {
    const sel = window.getSelection();
    lastSelectionRange = sel && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
  });
  window.addEventListener("scroll", removeToolbar, { passive: true });

  // ---------- creating a highlight ----------

  async function createHighlightFromSelection(color, range) {
    const sel = window.getSelection();
    const useRange = range || (sel && !sel.isCollapsed ? sel.getRangeAt(0) : null);
    if (!useRange) return;
    const text = useRange.toString().trim();
    if (!text) return;

    removeToolbar();
    const res = await send("SAVE_HIGHLIGHT", {
      url: pageUrl(),
      title: document.title,
      text,
      color,
      note: ""
    });
    if (!res?.ok) return;
    const marks = wrapRange(useRange.cloneRange(), res.highlight.id, color);
    sel?.removeAllRanges();
    if (marks.length) openPopover(marks[marks.length - 1], res.highlight, true);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "CONTEXT_HIGHLIGHT" && lastSelectionRange) {
      createHighlightFromSelection(msg.color, lastSelectionRange);
      lastSelectionRange = null;
    }
    if (msg.type === "SCROLLTO_HIGHLIGHT") {
      const el = document.querySelector(`.mg-hl[data-mg-id="${msg.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("mg-flash");
        setTimeout(() => el.classList.remove("mg-flash"), 1200);
      }
      sendResponse({ ok: !!el });
    }
    if (msg.type === "REMOVE_HIGHLIGHT_DOM") {
      unwrapMarks(msg.id);
      sendResponse({ ok: true });
    }
    return true;
  });

  // ---------- note / manage popover ----------

  function closePopover() {
    popoverEl?.remove();
    popoverEl = null;
  }

  function openPopover(anchorEl, highlight, focusNote) {
    closePopover();
    popoverEl = document.createElement("div");
    popoverEl.className = "mg-popover";

    const head = document.createElement("div");
    head.className = "mg-popover-head";
    const label = document.createElement("span");
    label.className = "mg-popover-label";
    label.textContent = "Note";
    const colors = document.createElement("div");
    colors.className = "mg-popover-colors";
    for (const color of COLORS) {
      const dot = document.createElement("button");
      dot.dataset.mgColor = color;
      if (color === highlight.color) dot.classList.add("mg-active");
      dot.title = color;
      dot.addEventListener("click", async () => {
        document.querySelectorAll(`.mg-hl[data-mg-id="${highlight.id}"]`).forEach((m) => (m.dataset.mgColor = color));
        colors.querySelectorAll("button").forEach((b) => b.classList.remove("mg-active"));
        dot.classList.add("mg-active");
        highlight.color = color;
        await send("UPDATE_HIGHLIGHT", { url: pageUrl(), id: highlight.id, color });
      });
      colors.appendChild(dot);
    }
    head.append(label, colors);

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Add a thought about this passage…";
    textarea.value = highlight.note || "";

    const actions = document.createElement("div");
    actions.className = "mg-popover-actions";
    const delBtn = document.createElement("button");
    delBtn.className = "mg-btn-delete";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      await send("DELETE_HIGHLIGHT", { url: pageUrl(), id: highlight.id });
      unwrapMarks(highlight.id);
      closePopover();
    });
    const saveBtn = document.createElement("button");
    saveBtn.className = "mg-btn-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      await send("UPDATE_HIGHLIGHT", { url: pageUrl(), id: highlight.id, note: textarea.value });
      closePopover();
    });
    actions.append(delBtn, saveBtn);

    popoverEl.append(head, textarea, actions);
    document.body.appendChild(popoverEl);

    const rect = anchorEl.getBoundingClientRect();
    const pRect = popoverEl.getBoundingClientRect();
    let top = rect.bottom + 8;
    if (top + pRect.height > window.innerHeight - 4) top = rect.top - pRect.height - 8;
    let left = rect.left;
    left = Math.max(4, Math.min(left, window.innerWidth - pRect.width - 4));
    popoverEl.style.top = `${top}px`;
    popoverEl.style.left = `${left}px`;

    if (focusNote) textarea.focus();
  }

  document.addEventListener("click", (e) => {
    const mark = e.target.closest?.(".mg-hl");
    if (!mark) return;
    e.preventDefault();
    send("GET_PAGE_HIGHLIGHTS", { url: pageUrl() }).then((res) => {
      const h = res?.highlights?.find((x) => x.id === mark.dataset.mgId);
      if (h) openPopover(mark, h, false);
    });
  });

  if (document.readyState === "complete" || document.readyState === "interactive") {
    restoreHighlights();
  } else {
    document.addEventListener("DOMContentLoaded", restoreHighlights);
  }
})();
