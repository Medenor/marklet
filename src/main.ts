import "./styles.css";
import { EditorView } from "@codemirror/view";
import { createEditor, commands, heading } from "./editor";
import { renderPreview, renderExport } from "./render";
import { standaloneHtml, copyRichText, previewCss } from "./export";
import { openFile, saveFile, download, fileFromDrop, canEditInPlace, UserCancelled, type OpenedFile } from "./files";
import * as store from "./storage";
import welcome from "./welcome.md?raw";

declare const __APP_VERSION__: string;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// Shared preview/export stylesheet, injected once.
const style = document.createElement("style");
style.textContent = previewCss;
document.head.append(style);

// ---------------------------------------------------------------------------
// State

interface DocState {
  name: string;
  handle: FileSystemFileHandle | null;
  /** Content as last opened from / written to disk. */
  savedText: string;
}

const doc: DocState = { name: "Untitled.md", handle: null, savedText: "" };
let autosaveOk = true;

const workspace = $("#workspace");
const previewPane = $("#preview-pane");
const preview = $("#preview");
const fileNameEl = $("#file-name");
const dirtyEl = $("#dirty");
const statsEl = $("#stats");
const statusEl = $("#status");

// ---------------------------------------------------------------------------
// Toast & status

let toastTimer = 0;
function toast(message: string, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), isError ? 6000 : 2500);
}
function status(message: string) {
  statusEl.textContent = message;
}
function reportError(e: unknown) {
  if (e instanceof UserCancelled) return;
  console.error(e);
  toast(e instanceof Error ? e.message : String(e), true);
}

// ---------------------------------------------------------------------------
// Rendering, stats, dirty state

let renderTimer = 0;
let lastRendered: string | null = null;

function render() {
  const text = editor.view.state.doc.toString();
  if (text === lastRendered) return;
  lastRendered = text;
  try {
    preview.innerHTML = renderPreview(text);
    for (const box of preview.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      box.disabled = false;
      box.title = "Click to toggle";
    }
  } catch (e) {
    console.error(e);
    preview.textContent = "Preview error: " + (e instanceof Error ? e.message : String(e));
  }
  syncPreviewToEditor();
}

function scheduleRender() {
  clearTimeout(renderTimer);
  const size = editor.view.state.doc.length;
  // Instant for normal documents, debounced for very large ones.
  renderTimer = window.setTimeout(render, size < 30_000 ? 30 : size < 300_000 ? 150 : 400);
}

function updateStats() {
  const state = editor.view.state;
  const sel = state.selection.main;
  const text = sel.empty ? state.doc.toString() : state.sliceDoc(sel.from, sel.to);
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
  const minutes = Math.max(1, Math.round(words / 230));
  statsEl.textContent = sel.empty
    ? `${words.toLocaleString()} words · ${text.length.toLocaleString()} characters · ${state.doc.lines.toLocaleString()} lines · ~${minutes} min read`
    : `Selection: ${words.toLocaleString()} words · ${text.length.toLocaleString()} characters`;
}

function isDirty() {
  return editor.view.state.doc.toString() !== doc.savedText;
}

function updateTitle() {
  const dirty = isDirty();
  fileNameEl.textContent = doc.name;
  fileNameEl.title = doc.handle ? `${doc.name} (saving writes to this file)` : doc.name;
  dirtyEl.hidden = !dirty;
  document.title = `${dirty ? "• " : ""}${doc.name} – Marklet`;
}

// ---------------------------------------------------------------------------
// Autosave (browser storage only)

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(autosave, 400);
}
function autosave() {
  const text = editor.view.state.doc.toString();
  const ok =
    store.save("doc", text) && store.save("meta", JSON.stringify({ name: doc.name, dirty: text !== doc.savedText }));
  if (ok !== autosaveOk || !ok) {
    autosaveOk = ok;
    if (!ok) status("⚠ Autosave unavailable (browser storage blocked or full). Save your work to a file.");
  }
  if (ok) status(isDirty() ? "Autosaved in this browser" : doc.handle ? "Saved to file" : "Saved");
}

// ---------------------------------------------------------------------------
// Scroll sync, by source line

type Pane = "editor" | "preview";
let ignoreScroll: Pane | null = null;

function blocks(): { line: number; top: number }[] {
  const list: { line: number; top: number }[] = [];
  for (const el of preview.querySelectorAll<HTMLElement>(":scope > .block")) {
    list.push({ line: Number(el.dataset.line), top: el.offsetTop });
  }
  return list;
}

function editorLineTop(view: EditorView, line: number) {
  const n = Math.min(Math.max(line + 1, 1), view.state.doc.lines);
  return view.lineBlockAt(view.state.doc.line(n).from).top;
}

function setScroll(el: HTMLElement, top: number, pane: Pane) {
  const target = Math.max(0, Math.round(top));
  if (Math.abs(el.scrollTop - target) < 2) return;
  ignoreScroll = pane;
  el.scrollTop = target;
}

function syncPreviewToEditor() {
  if (workspace.dataset.view !== "split") return;
  const view = editor.view;
  const scroller = view.scrollDOM;
  const list = blocks();
  if (!list.length) return;
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
    setScroll(previewPane, previewPane.scrollHeight, "preview");
    return;
  }
  const y = scroller.scrollTop;
  let i = list.length - 1;
  while (i > 0 && editorLineTop(view, list[i].line) > y) i--;
  const a = list[i];
  const b = list[i + 1];
  const ya = editorLineTop(view, a.line);
  const yb = b ? editorLineTop(view, b.line) : view.contentHeight;
  const pb = b ? b.top : preview.offsetHeight;
  const ratio = yb > ya ? Math.min(1, Math.max(0, (y - ya) / (yb - ya))) : 0;
  setScroll(previewPane, a.top + (pb - a.top) * ratio - (y < ya ? ya - y : 0), "preview");
}

function syncEditorToPreview() {
  if (workspace.dataset.view !== "split") return;
  const view = editor.view;
  const list = blocks();
  if (!list.length) return;
  const y = previewPane.scrollTop;
  if (y + previewPane.clientHeight >= previewPane.scrollHeight - 2) {
    setScroll(view.scrollDOM, view.scrollDOM.scrollHeight, "editor");
    return;
  }
  let i = list.length - 1;
  while (i > 0 && list[i].top > y) i--;
  const a = list[i];
  const b = list[i + 1];
  const pb = b ? b.top : preview.offsetHeight;
  const ratio = pb > a.top ? Math.min(1, Math.max(0, (y - a.top) / (pb - a.top))) : 0;
  const ya = editorLineTop(view, a.line);
  const yb = b ? editorLineTop(view, b.line) : view.contentHeight;
  setScroll(view.scrollDOM, ya + (yb - ya) * ratio, "editor");
}

let rafEditor = 0;
let rafPreview = 0;
function onEditorScroll() {
  if (ignoreScroll === "editor") {
    ignoreScroll = null;
    return;
  }
  cancelAnimationFrame(rafEditor);
  rafEditor = requestAnimationFrame(syncPreviewToEditor);
}
previewPane.addEventListener(
  "scroll",
  () => {
    if (ignoreScroll === "preview") {
      ignoreScroll = null;
      return;
    }
    cancelAnimationFrame(rafPreview);
    rafPreview = requestAnimationFrame(syncEditorToPreview);
  },
  { passive: true },
);

// ---------------------------------------------------------------------------
// Editor

function initialContent(): { text: string; meta: { name: string; dirty: boolean } | null; migrated: boolean } {
  const text = store.load("doc");
  if (text !== null) {
    let meta = null;
    try {
      meta = JSON.parse(store.load("meta") ?? "null");
    } catch {
      /* ignore */
    }
    return { text, meta, migrated: false };
  }
  const legacy = store.legacySession();
  if (legacy) return { text: legacy, meta: { name: "marqdown.md", dirty: true }, migrated: true };
  return { text: welcome, meta: null, migrated: false };
}

const initial = initialContent();
if (initial.meta) {
  doc.name = initial.meta.name || doc.name;
  // A restored session that had unsaved changes is still "dirty".
  doc.savedText = initial.meta.dirty ? "" : initial.text;
} else {
  doc.name = "Welcome.md";
  doc.savedText = initial.text;
}

const editor = createEditor({
  parent: $("#editor-pane"),
  doc: initial.text,
  onChange: () => {
    scheduleRender();
    updateStats();
    updateTitle();
    scheduleAutosave();
  },
  onScroll: onEditorScroll,
  extraKeys: EditorView.updateListener.of((u) => {
    if (u.selectionSet) updateStats();
  }),
});

// ---------------------------------------------------------------------------
// File actions

function loadDocument(file: OpenedFile) {
  doc.name = file.name;
  doc.handle = file.handle;
  doc.savedText = file.text.replace(/\r\n?/g, "\n");
  editor.load(doc.savedText);
  editor.view.scrollDOM.scrollTop = 0;
  previewPane.scrollTop = 0;
  updateTitle();
  status(file.handle ? `Opened ${file.name} — Save writes back to this file` : `Opened ${file.name}`);
  editor.view.focus();
}

function confirmDiscard(): boolean {
  if (!isDirty()) return true;
  return window.confirm("You have unsaved changes. Discard them?");
}

const actions: Record<string, () => void | Promise<void>> = {
  async new() {
    if (!confirmDiscard()) return;
    loadDocument({ name: "Untitled.md", text: "", handle: null });
    status("New document");
  },
  async open() {
    if (!confirmDiscard()) return;
    loadDocument(await openFile());
  },
  async save() {
    await doSave(false);
  },
  async "save-as"() {
    await doSave(true);
  },
  "export-html"() {
    const text = editor.view.state.doc.toString();
    download(doc.name.replace(/\.[^.]+$/, "") + ".html", standaloneHtml(text, doc.name), "text/html;charset=utf-8");
    toast("HTML exported");
  },
  async "copy-rich"() {
    await copyRichText(editor.view.state.doc.toString());
    toast("Formatted text copied — paste it into your email or document");
  },
  async "copy-html"() {
    const html = renderExport(editor.view.state.doc.toString());
    try {
      await navigator.clipboard.writeText(html);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = html;
      ta.className = "copy-holder";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("The browser refused to copy to the clipboard.");
    }
    toast("HTML copied");
  },
  print() {
    render();
    window.print();
  },
  help() {
    $<HTMLDialogElement>("#help-dialog").showModal();
  },
  theme() {
    const order = ["auto", "light", "dark"];
    const next = order[(order.indexOf(document.documentElement.dataset.theme ?? "auto") + 1) % order.length];
    applyTheme(next);
    store.save("theme", next);
  },
  swap() {
    workspace.classList.toggle("swapped");
    store.save("swapped", workspace.classList.contains("swapped") ? "1" : "0");
  },
};

const formatting: Record<string, (v: EditorView) => boolean> = {
  ...commands,
  h0: heading(0),
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
};

async function doSave(saveAs: boolean) {
  const text = editor.view.state.doc.toString();
  const result = await saveFile(text, doc, saveAs);
  doc.name = result.name;
  doc.handle = result.handle;
  doc.savedText = text;
  updateTitle();
  autosave();
  if (result.inPlace) {
    status(`Saved to ${result.name}`);
    toast(`Saved to ${result.name}`);
  } else {
    status(`Downloaded ${result.name}`);
    toast(`Downloaded ${result.name} — check your Downloads folder`);
  }
}

function run(name: string) {
  if (formatting[name]) {
    if (workspace.dataset.view === "preview") setView("split");
    formatting[name](editor.view);
    editor.view.focus();
    return;
  }
  const action = actions[name];
  if (action) Promise.resolve().then(action).catch(reportError);
}

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLElement>("[data-action]");
  if (btn) {
    btn.closest("details")?.removeAttribute("open");
    run(btn.dataset.action!);
    return;
  }
  const viewBtn = target.closest<HTMLElement>("[data-view]");
  if (viewBtn && viewBtn.tagName === "BUTTON") {
    setView(viewBtn.dataset.view!);
    return;
  }
  // Close open menus when clicking elsewhere.
  for (const d of document.querySelectorAll("details.menu[open]")) {
    if (!d.contains(target)) d.removeAttribute("open");
  }
});

// Only one menu open at a time.
for (const d of document.querySelectorAll<HTMLDetailsElement>("details.menu")) {
  d.addEventListener("toggle", () => {
    if (!d.open) return;
    for (const o of document.querySelectorAll("details.menu[open]")) if (o !== d) o.removeAttribute("open");
    // Keep the dropdown inside the window.
    const items = d.querySelector<HTMLElement>(".menu-items")!;
    items.classList.remove("align-right");
    if (items.getBoundingClientRect().right > window.innerWidth - 8) items.classList.add("align-right");
  });
}

// Application shortcuts work wherever the focus is.
window.addEventListener(
  "keydown",
  (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let action: string | null = null;
    if (mod && !e.altKey && key === "s") action = e.shiftKey ? "save-as" : "save";
    else if (mod && !e.altKey && !e.shiftKey && key === "o") action = "open";
    else if (e.key === "F1") action = "help";
    else if (e.key === "Escape") {
      for (const d of document.querySelectorAll("details.menu[open]")) d.removeAttribute("open");
    }
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      run(action);
    }
  },
  true,
);

window.addEventListener("beforeprint", render);

// Warn before closing only when work could actually be lost.
window.addEventListener("beforeunload", (e) => {
  if (isDirty() && (doc.handle || !autosaveOk)) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------------------------------------------------------------------------
// Preview interactions

preview.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  // In-document anchors (table of contents, footnotes) scroll the preview.
  const a = target.closest<HTMLAnchorElement>('a[href^="#"]');
  if (a) {
    e.preventDefault();
    const id = decodeURIComponent(a.getAttribute("href")!.slice(1));
    const el = id ? preview.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) : null;
    if (el) previewPane.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
    return;
  }

  // Ticking a task list checkbox updates the Markdown source.
  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    const block = target.closest<HTMLElement>(".block");
    if (!block) return;
    const index = [...block.querySelectorAll('input[type="checkbox"]')].indexOf(target);
    const state = editor.view.state;
    let found = -1;
    for (let n = Number(block.dataset.line) + 1; n <= state.doc.lines; n++) {
      const line = state.doc.line(n);
      const m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(line.text);
      if (m && ++found === index) {
        const pos = line.from + m[1].length;
        editor.view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2] === " " ? "x" : " " } });
        return;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Drag & drop

const overlay = $("#drop-overlay");
let dragDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    overlay.hidden = true;
  }
});
window.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener(
  "drop",
  (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    overlay.hidden = true;
    if (!confirmDiscard()) return;
    fileFromDrop(e)
      .then((file) => file && loadDocument(file))
      .catch(reportError);
  },
  true,
);

// ---------------------------------------------------------------------------
// View & theme

function setView(view: string) {
  if (!["editor", "split", "preview"].includes(view)) view = "split";
  workspace.dataset.view = view;
  for (const b of document.querySelectorAll<HTMLElement>(".segmented [data-view]")) {
    b.setAttribute("aria-checked", String(b.dataset.view === view));
  }
  store.save("view", view);
  editor.view.requestMeasure();
  if (view !== "editor") render();
  if (view === "split") requestAnimationFrame(syncPreviewToEditor);
}

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  const btn = document.querySelector<HTMLElement>('[data-action="theme"]');
  if (btn) btn.title = `Theme: ${theme} (click to change)`;
}

// ---------------------------------------------------------------------------
// Start

applyTheme(store.load("theme") ?? "auto");
if (store.load("swapped") === "1") workspace.classList.add("swapped");
setView(store.load("view") ?? (window.innerWidth < 700 ? "editor" : "split"));
$("#version").textContent = __APP_VERSION__;
$("#capabilities").textContent = [
  canEditInPlace
    ? "✓ This browser can save directly to the file you opened."
    : "This browser cannot write to files directly: Save downloads a copy.",
  store.save("probe", "1") ? "✓ Autosave is available." : "⚠ Browser storage is blocked: autosave is off.",
].join(" ");
store.remove("probe");

render();
updateStats();
updateTitle();
if (initial.migrated) toast("Restored your last session from marqdown v1");
else if (initial.meta?.dirty) status("Restored unsaved work from your last session");
else status(canEditInPlace ? "Ready" : "Ready — Save will download a copy in this browser");
editor.view.focus();
