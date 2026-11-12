// CodeMirror 6 editor configured for Markdown, with formatting commands.

import { EditorState, EditorSelection, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  placeholder,
  highlightSpecialChars,
  type Command,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { syntaxHighlighting, bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { findLanguage } from "./languages";

// ---------------------------------------------------------------------------
// Formatting commands

/** Wrap (or unwrap) every selection with `mark`, e.g. "**". */
export function toggleWrap(mark: string, end = mark): Command {
  return (view) => {
    const { state } = view;
    const tr = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - mark.length, range.from);
      const after = state.sliceDoc(range.to, range.to + end.length);
      if (before === mark && after === end) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + end.length },
          ],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        };
      }
      const text = state.sliceDoc(range.from, range.to);
      if (text.length >= mark.length + end.length && text.startsWith(mark) && text.endsWith(end)) {
        const inner = text.slice(mark.length, text.length - end.length);
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        };
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: end },
        ],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

const LINE_PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** Replace the block prefix (heading, quote, list) of every selected line. */
export function setLinePrefix(prefix: string | ((index: number) => string)): Command {
  return (view) => {
    const { state } = view;
    const changes: { from: number; to: number; insert: string }[] = [];
    const seen = new Set<number>();
    let index = 0;
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = state.doc.line(n);
        const m = LINE_PREFIX.exec(line.text)!;
        const p = typeof prefix === "function" ? prefix(index++) : prefix;
        const current = m[2] ?? "";
        // Toggle off when the same prefix is applied twice.
        const insert = current.trim() === p.trim() && p !== "" && typeof prefix === "string" ? "" : p;
        changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert });
      }
    }
    view.dispatch({ changes, userEvent: "input.format", scrollIntoView: true });
    return true;
  };
}

export const heading = (level: number) => setLinePrefix(level ? "#".repeat(level) + " " : "");

export const insertLink: Command = (view) => {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (/^(https?:\/\/|mailto:|ftp:\/\/|\/\/)/i.test(text)) {
      const insert = `[](${text})`;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}](https://)`;
    const urlStart = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text ? EditorSelection.range(urlStart, urlStart + 8) : EditorSelection.cursor(range.from + 1),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

/** Insert a block (e.g. a table or rule) on its own lines after the cursor line. */
export function insertBlock(text: string, cursorOffset?: number): Command {
  return (view) => {
    const { state } = view;
    const line = state.doc.lineAt(state.selection.main.head);
    const empty = line.text.trim() === "";
    const from = empty ? line.from : line.to;
    const insert = (empty ? "" : "\n\n") + text + "\n";
    const pos = from + (empty ? 0 : 2) + (cursorOffset ?? text.length);
    view.dispatch({
      changes: { from, to: empty ? line.to : from, insert },
      selection: { anchor: pos },
      scrollIntoView: true,
    });
    return true;
  };
}

export const insertCodeBlock: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const text = state.sliceDoc(sel.from, sel.to);
  if (text.includes("\n") || text === "") {
    const insert = "```\n" + text + (text.endsWith("\n") || text === "" ? "" : "\n") + "```";
    const line = state.doc.lineAt(sel.from);
    const atStart = sel.from === line.from;
    const prefix = atStart ? "" : "\n";
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: prefix + insert + "\n" },
      selection: { anchor: sel.from + prefix.length + 3 },
      scrollIntoView: true,
    });
    return true;
  }
  return toggleWrap("`")(view);
};

export const commands = {
  bold: toggleWrap("**"),
  italic: toggleWrap("*"),
  strike: toggleWrap("~~"),
  code: insertCodeBlock,
  link: insertLink,
  quote: setLinePrefix("> "),
  ul: setLinePrefix("- "),
  ol: setLinePrefix((i) => `${i + 1}. `),
  task: setLinePrefix("- [ ] "),
  hr: insertBlock("---\n", 5),
  table: insertBlock("| Column | Column |\n| ------ | ------ |\n| Cell   | Cell   |", 2),
} satisfies Record<string, Command>;

const formattingKeymap = keymap.of([
  { key: "Mod-b", run: commands.bold },
  { key: "Mod-i", run: commands.italic },
  { key: "Mod-Shift-x", run: commands.strike },
  { key: "Mod-e", run: commands.code },
  { key: "Mod-k", run: commands.link },
  { key: "Mod-Shift-.", run: commands.quote },
  { key: "Mod-Shift-8", run: commands.ul },
  { key: "Mod-Shift-7", run: commands.ol },
  { key: "Mod-Alt-0", run: heading(0) },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ key: `Mod-Alt-${n}`, run: heading(n) })),
]);

// ---------------------------------------------------------------------------

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange: (view: EditorView) => void;
  onScroll: (view: EditorView) => void;
  extraKeys?: Extension;
}

export interface Editor {
  view: EditorView;
  /** Replace the whole document and reset undo history. */
  load(doc: string): void;
}

export function createEditor(opts: EditorOptions): Editor {
  const extensions: Extension[] = [
    // App-level shortcuts (save, open…) take precedence over editor ones.
    opts.extraKeys ?? [],
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    placeholder("Type Markdown here, or open a file…"),
    markdown({ base: markdownLanguage, codeLanguages: (info) => findLanguage(info) }),
    syntaxHighlighting(classHighlighter),
    formattingKeymap,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.view);
    }),
    EditorView.domEventHandlers({
      scroll: (_e, view) => opts.onScroll(view),
    }),
    EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", "aria-label": "Markdown source" }),
  ];
  const view = new EditorView({ state: EditorState.create({ doc: opts.doc, extensions }), parent: opts.parent });
  return {
    view,
    load(doc) {
      view.setState(EditorState.create({ doc, extensions }));
      opts.onChange(view);
    },
  };
}
