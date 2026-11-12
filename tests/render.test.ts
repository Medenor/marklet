// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderPreview, renderExport, highlight } from "../src/render";

describe("sanitising", () => {
  it("removes scripts and event handlers", () => {
    const html = renderPreview(
      '<img src="data:image/png;base64,AA" onerror="alert(1)">\n\n<script>alert(2)</script>\n\n[x](javascript:alert(3))',
    );
    expect(html).not.toMatch(/onerror|<script|javascript:/i);
  });
  it("removes <style> and iframes", () => {
    const html = renderExport("<style>body{display:none}</style>\n\n<iframe src=x></iframe>");
    expect(html).not.toMatch(/<style|<iframe/);
  });
  it("opens external links in a new tab without referrer", () => {
    expect(renderExport("[a](https://example.com)")).toContain('rel="noopener noreferrer"');
    expect(renderExport("[a](#top)")).not.toContain("target");
  });
});

describe("preview", () => {
  it("tags blocks with their source line", () => {
    const html = renderPreview("# Title\n\nParagraph\n\n- a\n- b\n\n```js\nlet x = 1\n```\n");
    const lines = [...html.matchAll(/data-line="(\d+)"/g)].map((m) => +m[1]);
    expect(lines).toEqual([0, 2, 4, 7]);
  });
  it("replaces remote images by a placeholder", () => {
    expect(renderPreview("![logo](https://example.com/a.png)")).toContain("img-placeholder");
    expect(renderExport("![logo](https://example.com/a.png)")).toContain("<img");
  });
  it("adds unique heading ids", () => {
    const html = renderExport("# Hello World\n\n# Hello World");
    expect(html).toContain('id="hello-world"');
    expect(html).toContain('id="hello-world-1"');
  });
  it("renders footnotes, tables and task lists", () => {
    const html = renderPreview("Text[^1]\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n[^1]: Note");
    expect(html).toContain("<table");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("footnote-1");
    expect(html).toContain("Note");
  });
  it("resolves reference links across blocks", () => {
    expect(renderPreview("[site][s]\n\n[s]: https://example.com")).toContain('href="https://example.com"');
  });
});

describe("highlight", () => {
  it("highlights lezer and legacy languages", () => {
    expect(highlight("const a = 1", "js")).toContain("tok-keyword");
    expect(highlight("echo hi", "bash")).toMatch(/tok-/);
    expect(highlight("data a; set b; run;", "sas")).toMatch(/tok-/);
  });
  it("escapes unknown languages", () => {
    expect(highlight("<b>", "nope")).toBe("&lt;b&gt;");
  });
});

describe("raw html images", () => {
  it("become placeholders in the preview only", () => {
    const md =
      'a <img src="x.png" alt="pic"> b <img src="https://e.com/t.gif"> c\n\n<img src="data:image/png;base64,AA">';
    const html = renderPreview(md);
    expect(html.match(/img-placeholder/g)?.length).toBe(2);
    expect(html).toContain("pic");
    expect(html).toContain('<img src="data:image/png;base64,AA"');
    expect(renderExport(md).match(/<img/g)?.length).toBe(3);
  });
});
