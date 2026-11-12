// Export: standalone HTML document and rich-text clipboard copy.

import { renderExport, escapeHtml } from "./render";
import previewCss from "./preview.css?inline";

export { previewCss };

/** Title for exports: first level-1 heading, else the file name. */
export function documentTitle(source: string, fileName: string): string {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(source);
  if (m) return m[1].replace(/[*_`~[\]]/g, "").trim();
  return fileName.replace(/\.[^.]+$/, "");
}

export function standaloneHtml(source: string, fileName: string): string {
  const title = escapeHtml(documentTitle(source, fileName));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Marklet">
<title>${title}</title>
<style>
${previewCss}
body { margin: 0; background: var(--md-bg); }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 32px 24px 64px; }
</style>
</head>
<body>
<article class="markdown-body">
${renderExport(source)}
</article>
</body>
</html>
`;
}

/** Copy as formatted text (for Outlook, Teams, Word…) with a plain-text fallback. */
export async function copyRichText(source: string): Promise<void> {
  const html = renderExport(source);
  const Item = (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (navigator.clipboard && Item) {
    try {
      await navigator.clipboard.write([
        new Item({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([source], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      /* fall back below */
    }
  }
  // Fallback: select a hidden rendered copy and use the legacy copy command.
  const holder = document.createElement("div");
  holder.className = "markdown-body copy-holder";
  holder.innerHTML = html;
  document.body.append(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand("copy");
  sel.removeAllRanges();
  holder.remove();
  if (!ok) throw new Error("The browser refused to copy to the clipboard.");
}
