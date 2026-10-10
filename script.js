/* FORMA NOTES — shared application logic. Runs directly in a browser; no build step. */
(() => {
  "use strict";

  const STORAGE_KEY = "forma-notes-documents-v1";
  const ACTIVE_KEY = "forma-notes-active-document-v1";
  const APP_THEME_KEY = "forma-notes-app-theme-v1";
  const STARTER_TEXT = `# Welcome to Forma

This is your writing space. Start with a thought, a class note, a plan, or a list of things you want to remember.

- Write in plain text
- Use Markdown when it helps
- Let your ideas evolve

---

## A second block

Put three dashes on a line by themselves to split your writing into separate note blocks.

You can keep editing the original text at any time. The blocks on the right update automatically.

---

## Things to remember

- Your notes autosave in this browser.
- Use the library to create and manage multiple notes.
- Export a Markdown backup whenever you need one.`;

  let documents = [];
  let activeDocumentId = null;
  let toastTimer = null;
  let sortNewestFirst = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function makeId() {
    return "note-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function makeDocument(title, content) {
    const now = new Date().toISOString();
    return {
      id: makeId(),
      title: (title || "Untitled note").trim() || "Untitled note",
      content: content ?? "",
      createdAt: now,
      updatedAt: now
    };
  }

  function safeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function setSaveStatus(message) {
    const status = $("#saveText");
    if (status) status.textContent = message;
    const lastSaved = $("#lastSaved");
    if (lastSaved) lastSaved.textContent = message === "Saving…" ? message : "Saved in this browser";
  }

  function persistDocuments() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
      if (activeDocumentId) localStorage.setItem(ACTIVE_KEY, activeDocumentId);
      setSaveStatus("Saved locally");
    } catch (error) {
      console.error("Forma could not save the notes.", error);
      setSaveStatus("Save unavailable");
      showToast("Browser storage may be full. Export your notes as a backup.");
    }
  }

  function loadDocuments() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      documents = Array.isArray(parsed)
        ? parsed.filter(item => item && typeof item.id === "string" && typeof item.content === "string")
        : [];
    } catch (error) {
      console.warn("Forma could not read saved notes.", error);
      documents = [];
    }

    if (!documents.length) {
      const starter = makeDocument("My first notes", STARTER_TEXT);
      documents = [starter];
      activeDocumentId = starter.id;
      persistDocuments();
    } else {
      activeDocumentId = localStorage.getItem(ACTIVE_KEY);
      if (!documents.some(doc => doc.id === activeDocumentId)) activeDocumentId = documents[0].id;
    }
    localStorage.setItem(ACTIVE_KEY, activeDocumentId);
  }

  function getActiveDocument() {
    return documents.find(doc => doc.id === activeDocumentId) || documents[0] || null;
  }

  function getInputContent() {
    return $("#noteInput")?.value ?? "";
  }

  function getInputTitle() {
    return ($("#documentName")?.value || "Untitled note").trim() || "Untitled note";
  }

  function countWords(content) {
    return (String(content).trim().match(/\S+/g) || []).length;
  }

  function splitBlocks(content) {
    // A separator only works when the three dashes are alone on a line.
    // Ignore empty blocks caused by separators at the beginning/end.
    const chunks = String(content ?? "").split(/^\s*---\s*$/m);
    const useful = chunks.map(chunk => chunk.trim()).filter(chunk => chunk.length > 0);
    return useful.length ? useful : [""];
  }

  function renderMarkdown(markdown) {
    const source = String(markdown ?? "");
    if (window.marked && typeof window.marked.parse === "function") {
      const html = window.marked.parse(source || " ");
      if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
        return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
      }
    }
    // Safe, basic fallback when the CDN is offline. This intentionally does not parse raw HTML.
    return escapeHtml(source || " ")
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/^\- (.*)$/gm, "<li>$1</li>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
  }

  function blockTitle(content, index) {
    const heading = String(content).match(/^\s*#{1,3}\s+(.+)$/m);
    if (heading) return heading[1].replace(/[*_`]/g, "").trim().slice(0, 100);
    const line = String(content).split("\n").map(s => s.trim()).find(Boolean);
    return line ? line.replace(/[*_`#>-]/g, "").slice(0, 75) : `Note block ${index + 1}`;
  }

  function updateActiveDocumentFromEditor() {
    const doc = getActiveDocument();
    if (!doc) return;
    doc.title = getInputTitle();
    doc.content = getInputContent();
    doc.updatedAt = new Date().toISOString();
    persistDocuments();
    updateWordCount(doc.content);
    renderNoteBlocks();
  }

  function updateWordCount(content) {
    const target = $("#wordCount");
    if (target) {
      const count = countWords(content);
      target.textContent = `${count} ${count === 1 ? "word" : "words"}`;
    }
  }

  function renderNoteBlocks() {
    const container = $("#noteBlocks");
    if (!container) return;
    const blocks = splitBlocks(getInputContent());
    const compact = $("#compactToggle")?.checked ?? false;
    container.innerHTML = "";

    blocks.forEach((content, index) => {
      const card = document.createElement("article");
      card.className = `note-block${compact ? " is-compact" : ""}`;

      const header = document.createElement("div");
      header.className = "note-block-heading";
      const label = document.createElement("span");
      label.className = "block-label";
      label.textContent = `BLOCK ${String(index + 1).padStart(2, "0")}`;

      const actions = document.createElement("div");
      actions.className = "block-actions";
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.textContent = "Copy";
      copyButton.title = "Copy this block as Markdown";
      copyButton.addEventListener("click", () => copyText(content, "Note block copied."));
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.title = "Move the editor to this block";
      editButton.addEventListener("click", () => focusBlockInEditor(index));
      actions.append(copyButton, editButton);
      header.append(label, actions);

      const body = document.createElement("div");
      body.className = "rendered-markdown";
      body.innerHTML = renderMarkdown(content);
      card.append(header, body);
      container.appendChild(card);
    });

    const count = $("#blockCount");
    if (count) count.textContent = `${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`;
  }

  function focusBlockInEditor(index) {
    const input = $("#noteInput");
    if (!input) return;
    const blocks = splitBlocks(input.value);
    const target = blocks[index] ?? "";
    const all = input.value;
    const start = all.indexOf(target);
    input.focus();
    if (start >= 0) {
      input.setSelectionRange(start, start + target.length);
      input.scrollTop = Math.max(0, input.scrollTop + input.getBoundingClientRect().top - input.getBoundingClientRect().top);
    }
    showToast(`Block ${index + 1} selected in the editor.`);
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(String(text ?? ""));
      showToast(successMessage);
    } catch {
      const temp = document.createElement("textarea");
      temp.value = String(text ?? "");
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.select();
      const copied = document.execCommand("copy");
      temp.remove();
      showToast(copied ? successMessage : "Copy failed. You can select and copy the text manually.");
    }
  }

  function loadActiveIntoWorkspace() {
    const doc = getActiveDocument();
    if (!doc) return;
    const title = $("#documentName");
    const input = $("#noteInput");
    if (title) title.value = doc.title || "Untitled note";
    if (input) input.value = doc.content ?? "";
    updateWordCount(doc.content || "");
    renderNoteBlocks();
    setSaveStatus("Saved locally");
  }

  function createNewNote() {
    const doc = makeDocument("Untitled note", "# A new thought\n\nStart writing here.\n\n---\n\n## Another section\nAdd more detail here.");
    documents.unshift(doc);
    activeDocumentId = doc.id;
    persistDocuments();
    if (document.body.dataset.page === "workspace") loadActiveIntoWorkspace();
    showToast("New note created.");
  }

  function exportActiveNote() {
    const doc = getActiveDocument();
    if (!doc) return;
    const filename = (doc.title || "forma-note").replace(/[^\w\-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "forma-note";
    const blob = new Blob([doc.content || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Markdown export started.");
  }

  function importNote(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const title = file.name.replace(/\.(md|markdown|txt)$/i, "") || "Imported note";
      const doc = makeDocument(title, String(reader.result ?? ""));
      documents.unshift(doc);
      activeDocumentId = doc.id;
      persistDocuments();
      if (document.body.dataset.page === "workspace") loadActiveIntoWorkspace();
      showToast("Note imported.");
    };
    reader.onerror = () => showToast("Could not read that file.");
    reader.readAsText(file);
  }

  function clearActiveNote() {
    if (!window.confirm("Clear all text in this note? Export a backup first if you need to keep it.")) return;
    const input = $("#noteInput");
    if (input) input.value = "";
    updateActiveDocumentFromEditor();
    showToast("Note cleared.");
  }

  function insertAtCursor(text) {
    const input = $("#noteInput");
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const cursor = start + text.length;
    input.focus();
    input.setSelectionRange(cursor, cursor);
    updateActiveDocumentFromEditor();
  }

  function initWorkspace() {
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get("note");
    if (requestedId && documents.some(doc => doc.id === requestedId)) {
      activeDocumentId = requestedId;
      localStorage.setItem(ACTIVE_KEY, activeDocumentId);
    }
    loadActiveIntoWorkspace();

    $("#noteInput")?.addEventListener("input", () => {
      setSaveStatus("Saving…");
      updateActiveDocumentFromEditor();
    });
    $("#documentName")?.addEventListener("input", updateActiveDocumentFromEditor);
    $("#compactToggle")?.addEventListener("change", renderNoteBlocks);
    $("#newNoteButton")?.addEventListener("click", createNewNote);
    $("#exportButton")?.addEventListener("click", exportActiveNote);
    $("#importButton")?.addEventListener("click", () => $("#fileInput")?.click());
    $("#fileInput")?.addEventListener("change", event => {
      importNote(event.target.files?.[0]);
      event.target.value = "";
    });
    $("#clearButton")?.addEventListener("click", clearActiveNote);
    $$("[data-insert]").forEach(button => button.addEventListener("click", () => insertAtCursor(button.dataset.insert || "")));
  }

  function formatDate(value) {
    return safeDate(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function deleteNote(id) {
    const doc = documents.find(item => item.id === id);
    if (!doc) return;
    if (!window.confirm(`Delete “${doc.title}”? This cannot be undone.`)) return;
    documents = documents.filter(item => item.id !== id);
    if (!documents.length) documents = [makeDocument("My first notes", STARTER_TEXT)];
    if (!documents.some(item => item.id === activeDocumentId)) activeDocumentId = documents[0].id;
    persistDocuments();
    renderLibrary();
    showToast("Note deleted.");
  }

  function duplicateNote(id) {
    const source = documents.find(item => item.id === id);
    if (!source) return;
    const copy = makeDocument(`${source.title} copy`, source.content);
    documents.unshift(copy);
    persistDocuments();
    renderLibrary();
    showToast("Note duplicated.");
  }

  function renderLibrary() {
    const grid = $("#noteGrid");
    if (!grid) return;
    const query = ($("#librarySearch")?.value || "").trim().toLowerCase();
    const visible = documents.filter(doc => `${doc.title} ${doc.content}`.toLowerCase().includes(query));
    visible.sort((a, b) => sortNewestFirst ? safeDate(b.updatedAt) - safeDate(a.updatedAt) : a.title.localeCompare(b.title));
    grid.innerHTML = "";

    visible.forEach(doc => {
      const card = document.createElement("article");
      card.className = "note-card";
      const top = document.createElement("div");
      top.className = "note-card-top";
      const label = document.createElement("span");
      label.textContent = "FORMA NOTE";
      const menu = document.createElement("button");
      menu.type = "button";
      menu.className = "text-button";
      menu.textContent = "•••";
      menu.setAttribute("aria-label", `Actions for ${doc.title}`);
      menu.addEventListener("click", () => {
        const action = window.prompt("Type duplicate or delete", "duplicate");
        if (action?.trim().toLowerCase() === "duplicate") duplicateNote(doc.id);
        if (action?.trim().toLowerCase() === "delete") deleteNote(doc.id);
      });
      top.append(label, menu);

      const title = document.createElement("h3");
      title.textContent = doc.title || "Untitled note";
      const preview = document.createElement("p");
      preview.className = "note-card-preview";
      preview.textContent = (doc.content || "No text yet.").replace(/^\s*#+\s*/gm, "").replace(/[*_`]/g, "").replace(/^\s*---\s*$/gm, " ").trim().slice(0, 170);
      const meta = document.createElement("p");
      meta.className = "note-card-meta";
      meta.textContent = `${splitBlocks(doc.content).length} blocks · Edited ${formatDate(doc.updatedAt)}`;

      const actions = document.createElement("div");
      actions.className = "note-card-actions";
      const open = document.createElement("a");
      open.className = "button button-primary";
      open.href = `workspace.html?note=${encodeURIComponent(doc.id)}`;
      open.textContent = "Open note ↗";
      const duplicate = document.createElement("button");
      duplicate.type = "button";
      duplicate.className = "button button-secondary";
      duplicate.textContent = "Duplicate";
      duplicate.addEventListener("click", () => duplicateNote(doc.id));
      actions.append(open, duplicate);
      card.append(top, title, preview, meta, actions);
      grid.appendChild(card);
    });

    const count = $("#libraryCount");
    if (count) count.textContent = `${visible.length} ${visible.length === 1 ? "note" : "notes"}`;
    const empty = $("#emptyState");
    if (empty) empty.classList.toggle("visible", visible.length === 0);
    grid.style.display = visible.length ? "grid" : "none";
  }

  function toggleTheme() {
    const dark = !document.body.classList.contains("dark");
    document.body.classList.toggle("dark", dark);
    try { localStorage.setItem(APP_THEME_KEY, dark ? "dark" : "light"); } catch {}
  }

  function applySavedTheme() {
    try {
      if (localStorage.getItem(APP_THEME_KEY) === "dark") document.body.classList.add("dark");
    } catch {}
  }

  function initKeyboardShortcuts() {
    document.addEventListener("keydown", event => {
      const isTyping = event.target && (
        event.target.tagName === "TEXTAREA" ||
        event.target.tagName === "INPUT" ||
        event.target.isContentEditable
      );
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (document.body.dataset.page === "workspace") updateActiveDocumentFromEditor();
        showToast("Saved in this browser.");
      }
      if (event.key === "Escape" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // Do not hijack ordinary typing keys.
      if (isTyping && !(event.ctrlKey || event.metaKey)) return;
    });
  }

  function initShared() {
    applySavedTheme();
    $$("[data-year]").forEach(element => element.textContent = new Date().getFullYear());
    $("#themeToggle")?.addEventListener("click", toggleTheme);
    initKeyboardShortcuts();
  }

  function init() {
    loadDocuments();
    initShared();
    const page = document.body.dataset.page;
    if (page === "workspace") initWorkspace();
    if (page === "library") {
      renderLibrary();
      $("#librarySearch")?.addEventListener("input", renderLibrary);
      $("#sortNotes")?.addEventListener("click", () => {
        sortNewestFirst = !sortNewestFirst;
        $("#sortNotes").textContent = sortNewestFirst ? "Sort: Recently edited ↓" : "Sort: Name A–Z ↑";
        renderLibrary();
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();