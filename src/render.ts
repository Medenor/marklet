// Markdown -> sanitised HTML.
//
// Two flavours:
//  - preview: each top-level block is wrapped in <div data-line="N"> so the
//    editor and the preview can be scrolled in sync line by line, and remote
//    resources are replaced by placeholders (the app never touches the network);
//  - export:  clean HTML, no wrappers, images kept as-is.
//
// Everything goes through DOMPurify: opening an untrusted .md file must never
// run code inside the editor.

import { Marked, type Token, type Tokens } from "marked";
import markedFootnote from "marked-footnote";
import DOMPurify from "dompurify";
import { highlightCode, classHighlighter } from "@lezer/highlight";
import { findLanguage } from "./languages";

export interface RenderOptions {
  /** Wrap blocks with source line markers and block remote resources. */
  preview: boolean;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Syntax highlighting with the same parsers the editor uses. */
export function highlight(code: string, info: string | undefined): string {
  const lang = findLanguage(info);
  if (!lang) return escapeHtml(code);
  try {
    let out = "";
    const tree = lang.parser.parse(code);
    highlightCode(
      code,
      tree,
      classHighlighter,
      (text, classes) => {
        out += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text);
      },
      () => {
        out += "\n";
      },
    );
    return out;
  } catch {
    return escapeHtml(code);
  }
}

/** GitHub-like heading slugs, unique within one render. */
function makeSlugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base =
      text
        .toLowerCase()
        .replace(/<[^>]*>/g, "")
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s/g, "-") || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

const isRemote = (href: string) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) || /^(?:https?|ftp|file):/i.test(href);
const isRelative = (href: string) => !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//");

function createMarked(opts: RenderOptions) {
  let slug = makeSlugger();
  const md = new Marked({ gfm: true, breaks: true });
  md.use(markedFootnote());
  md.use({
    hooks: {
      preprocess(src: string) {
        slug = makeSlugger();
        return src;
      },
    },
    renderer: {
      code({ text, lang }: Tokens.Code) {
        const name = (lang ?? "").trim().split(/[\s{]/)[0];
        const cls = name ? ` class="language-${escapeHtml(name)}"` : "";
        return `<pre><code${cls}>${highlight(text, name)}</code></pre>\n`;
      },
      heading({ tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        return `<h${depth} id="${escapeHtml(slug(text))}">${inner}</h${depth}>\n`;
      },
      image({ href, title, text }: Tokens.Image) {
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        if (opts.preview && !/^data:image\//i.test(href) && (isRemote(href) || isRelative(href))) {
          // The app has no network access (CSP); show where the image would be.
          return `<span class="img-placeholder" title="${escapeHtml(href)}">🖼 ${escapeHtml(text || href)}</span>`;
        }
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t}>`;
      },
    },
  });
  const reset = () => {
    slug = makeSlugger();
  };
  return { md, reset };
}

const previewMd = createMarked({ preview: true });
const exportMd = createMarked({ preview: false });

let purifier: ReturnType<typeof DOMPurify> | null = null;
/** Allows tests to provide a jsdom window. */
export function setWindow(win: Window & typeof globalThis): void {
  purifier = DOMPurify(win);
  configure(purifier);
}
let previewMode = false;
function configure(p: ReturnType<typeof DOMPurify>) {
  // Raw HTML <img> tags in the preview get the same treatment as Markdown
  // images: only embedded data: images are displayed.
  p.addHook("uponSanitizeElement", (node, data) => {
    if (!previewMode || data.tagName !== "img") return;
    const el = node as Element;
    const src = el.getAttribute("src") ?? "";
    if (/^data:image\//i.test(src)) return;
    const span = el.ownerDocument.createElement("span");
    span.className = "img-placeholder";
    span.title = src;
    span.textContent = "🖼 " + (el.getAttribute("alt") || src || "image");
    el.replaceWith(span);
  });
  // Links always open outside of the editor and never leak the referrer.
  p.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("href") && !node.getAttribute("href")!.startsWith("#")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}
function getPurifier() {
  if (!purifier) {
    purifier = DOMPurify(window);
    configure(purifier);
  }
  return purifier;
}

function sanitize(html: string, preview = false): string {
  previewMode = preview;
  return getPurifier().sanitize(html, {
    // <style> could restyle the application itself; forms and frames have no
    // place in a document preview.
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed", "link", "meta", "base"],
    FORBID_ATTR: ["srcset", "formaction", "action"],
    ADD_ATTR: ["target"],
  });
}

/** Line (0-based) at which each top-level token starts. */
function tokenLines(src: string, tokens: Token[]): number[] {
  const lines: number[] = [];
  let offset = 0;
  let line = 0;
  for (const tok of tokens) {
    // The footnotes token is synthetic and does not exist in the source.
    if (tok.type === "footnotes" || !tok.raw) {
      lines.push(-1);
      continue;
    }
    const idx = src.indexOf(tok.raw, offset);
    if (idx >= 0) {
      for (let i = offset; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
      offset = idx;
    }
    lines.push(line);
    for (let i = 0; i < tok.raw.length; i++) if (tok.raw.charCodeAt(i) === 10) line++;
    offset += tok.raw.length;
  }
  return lines;
}

/** Preview HTML with `data-line` markers on every top-level block. */
export function renderPreview(source: string): string {
  const { md, reset } = previewMd;
  reset();
  const src = source.replace(/\r\n?/g, "\n");
  const tokens = md.lexer(src);
  if (md.defaults.walkTokens) md.walkTokens(tokens, md.defaults.walkTokens);
  const lines = tokenLines(src, tokens);
  let html = "";
  tokens.forEach((tok, i) => {
    if (tok.type === "space") return;
    const list = Object.assign([tok], { links: tokens.links });
    const part = md.parser(list as typeof tokens);
    if (!part) return;
    const line = lines[i];
    html += line >= 0 ? `<div class="block" data-line="${line}">${part}</div>` : part;
  });
  return sanitize(html, true);
}

/** Clean, standalone-ready HTML body (no editor markers). */
export function renderExport(source: string): string {
  return sanitize(exportMd.md.parse(source.replace(/\r\n?/g, "\n"), { async: false }) as string);
}
