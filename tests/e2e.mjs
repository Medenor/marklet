// End-to-end smoke test of the built file, opened from disk (file://) in
// Chromium like a user would. Run `npm run build` first.
//   node tests/e2e.mjs [--screenshots <dir>]

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const file = fileURLToPath(new URL("../dist/marklet.html", import.meta.url));
if (!existsSync(file)) throw new Error("Build first: npm run build");
const url = pathToFileURL(file).href;
const shotsArg = process.argv.indexOf("--screenshots");
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

// CHROMIUM_PATH lets you use an already installed browser.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failures = 0;

async function test(name, fn, contextOptions = {}, allowConsole = null) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    ...contextOptions,
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !(allowConsole && allowConsole.test(m.text()))) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  // Any network request at all is a failure: the app must be fully offline.
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) problems.push("network request: " + r.url());
  });
  try {
    await fn(page, context);
    assert.deepEqual(problems, [], "console errors / network requests");
    console.log("✓", name);
  } catch (e) {
    failures++;
    console.log("✗", name, "\n   ", e.message.split("\n").join("\n    "));
  } finally {
    await context.close();
  }
}

async function setDoc(page, text) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.evaluate((t) => navigator.clipboard?.writeText?.(t).catch(() => {}), text).catch(() => {});
  // insertText is much faster than typing character by character.
  await page.keyboard.insertText(text);
  await page.waitForTimeout(150);
}

await test("loads with welcome document and renders preview", async (page) => {
  await page.goto(url);
  await page.waitForSelector("#preview h1");
  assert.equal(await page.textContent("#preview h1"), "Welcome to Marklet");
  assert.match(await page.textContent("#file-name"), /Welcome\.md/);
  assert.ok((await page.locator("#preview .tok-keyword").count()) > 0, "code is highlighted");
  if (shots) {
    await page.screenshot({ path: join(shots, "light.png") });
  }
});

await test("live preview, formatting shortcut, stats", async (page) => {
  await page.goto(url);
  await setDoc(page, "# Hello\n\nworld");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("ControlOrMeta+b");
  await page.waitForTimeout(100);
  assert.equal(await page.innerHTML("#preview strong"), "world");
  assert.match(await page.textContent("#stats"), /Selection: 1 words/);
  assert.equal(await page.isVisible("#dirty"), true);
});

await test("malicious markdown cannot run script", async (page) => {
  await page.goto(url);
  await page.evaluate(() => (window.__pwned = false));
  await setDoc(
    page,
    '<img src=x onerror="window.__pwned=true">\n\n<script>window.__pwned=true</script>\n\n<svg><script>window.__pwned=true</script></svg>\n\n[click](javascript:window.__pwned=true)\n\n<style>body{display:none}</style>',
  );
  await page.click("#preview a").catch(() => {});
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pwned), false);
  assert.equal(await page.locator("#preview style, #preview script").count(), 0);
  assert.equal(await page.isVisible("body"), true);
});

await test(
  "CSP blocks scripts even if sanitising were bypassed",
  async (page) => {
    await page.goto(url);
    const blocked = await page.evaluate(
      () =>
        new Promise((resolve) => {
          document.addEventListener("securitypolicyviolation", () => resolve(true), { once: true });
          const s = document.createElement("script");
          s.textContent = "window.__evil = 1";
          document.body.append(s);
          setTimeout(() => resolve(false), 500);
        }),
    );
    assert.equal(blocked, true);
    assert.equal(await page.evaluate(() => window.__evil), undefined);
  },
  {},
  /Content Security Policy/,
);

await test("remote images are not loaded", async (page) => {
  await page.goto(url);
  await setDoc(page, "![tracker](https://example.com/pixel.png)");
  assert.equal(await page.locator("#preview img").count(), 0);
  assert.equal(await page.locator("#preview .img-placeholder").count(), 1);
});

await test("task list checkbox toggles the source", async (page) => {
  await page.goto(url);
  await setDoc(page, "Intro\n\n- [ ] one\n- [ ] two");
  await page.locator("#preview input[type=checkbox]").nth(1).click();
  await page.waitForTimeout(100);
  const text = await page.evaluate(() => document.querySelector(".cm-content").innerText);
  assert.match(text, /- \[ \] one\n- \[x\] two/);
});

await test("scroll sync keeps panes aligned", async (page) => {
  await page.goto(url);
  const long = Array.from({ length: 120 }, (_, i) => `## Section ${i}\n\nParagraph ${i} with some text.\n`).join("\n");
  await setDoc(page, long);
  await page.evaluate(() => {
    const view = document.querySelector(".cm-scroller");
    view.scrollTop = view.scrollHeight / 2;
  });
  await page.waitForTimeout(300);
  // The heading at the top of the preview should match the one at the top of the editor.
  const result = await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller");
    const top = scroller.getBoundingClientRect().top + 20;
    const editorLine = [...document.querySelectorAll(".cm-line")].find(
      (l) => l.getBoundingClientRect().bottom > top && /Section/.test(l.textContent),
    );
    const pane = document.querySelector("#preview-pane");
    const ptop = pane.getBoundingClientRect().top;
    const h = [...pane.querySelectorAll("h2")].find((el) => el.getBoundingClientRect().bottom > ptop + 20);
    return { editor: editorLine?.textContent.replace("## ", ""), preview: h?.textContent };
  });
  const n = (s) => Number(/\d+/.exec(s ?? "")?.[0]);
  assert.ok(Math.abs(n(result.editor) - n(result.preview)) <= 1, JSON.stringify(result));
});

await test("autosave restores the session after reload", async (page) => {
  await page.goto(url);
  await setDoc(page, "# Persisted");
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector("#preview h1");
  assert.equal(await page.textContent("#preview h1"), "Persisted");
  assert.equal(await page.isVisible("#dirty"), true);
});

await test("migrates the last session of marqdown v1", async (page) => {
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("marqdown.lastSession", "# From v1");
  });
  await page.reload();
  await page.waitForSelector("#preview h1");
  assert.equal(await page.textContent("#preview h1"), "From v1");
});

await test("open and save in place (File System Access API)", async (page) => {
  await page.addInitScript(() => {
    const files = { "notes.md": "# Notes\n\nfrom disk" };
    const handle = (name) => ({
      kind: "file",
      name,
      getFile: async () => new File([files[name] ?? ""], name, { type: "" }),
      queryPermission: async () => "granted",
      createWritable: async () => {
        let data = "";
        return { write: async (d) => (data += d), close: async () => (files[name] = data) };
      },
    });
    window.showOpenFilePicker = async () => [handle("notes.md")];
    window.showSaveFilePicker = async (o) => handle(o?.suggestedName ?? "x.md");
    window.__files = files;
  });
  await page.goto(url);
  await page.keyboard.press("ControlOrMeta+o");
  await page.waitForFunction(() => document.querySelector("#preview h1")?.textContent === "Notes");
  assert.equal(await page.textContent("#file-name"), "notes.md");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n\nedited");
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__files["notes.md"]), "# Notes\n\nfrom disk\n\nedited");
  assert.equal(await page.isVisible("#dirty"), false);
});

await test("fallback: Save downloads when the API is unavailable", async (page) => {
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
  await page.goto(url);
  await setDoc(page, "# Download me");
  const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("ControlOrMeta+s")]);
  const path = await download.path();
  assert.equal(readFileSync(path, "utf8"), "# Download me");
  assert.match(download.suggestedFilename(), /\.md$/);
});

await test("export standalone HTML", async (page) => {
  await page.goto(url);
  await setDoc(page, "# Report\n\n```js\nconst a = 1;\n```");
  await page.click("summary[title^='Save as']");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("[data-action=export-html]")]);
  const html = readFileSync(await download.path(), "utf8");
  assert.match(html, /<title>Report<\/title>/);
  assert.match(html, /tok-keyword/);
  assert.doesNotMatch(html, /data-line/);
});

await test("copy formatted text for email", async (page, context) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(url);
  await setDoc(page, "# Memo\n\n**Important**");
  await page.click("summary[title^='Save as']");
  await page.click("[data-action=copy-rich]");
  await page.waitForTimeout(200);
  const html = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return (await item.getType("text/html")).text();
  });
  assert.match(html, /<strong>Important<\/strong>/);
});

await test("opening a dropped file", async (page) => {
  await page.goto(url);
  const dir = mkdtempSync(join(tmpdir(), "mq-"));
  writeFileSync(join(dir, "dropped.md"), "# Dropped");
  const buffer = readFileSync(join(dir, "dropped.md")).toString();
  await page.evaluate(async (content) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], "dropped.md", { type: "" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, buffer);
  page.on("dialog", (d) => d.accept());
  await page.waitForFunction(() => document.querySelector("#preview h1")?.textContent === "Dropped", null, {
    timeout: 2000,
  });
  assert.equal(await page.textContent("#file-name"), "dropped.md");
});

await test("dark theme and layouts", async (page) => {
  await page.goto(url);
  await page.click("[data-action=theme]"); // light
  await page.click("[data-action=theme]"); // dark
  assert.equal(await page.getAttribute("html", "data-theme"), "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, "rgb(22, 25, 29)");
  if (shots) await page.screenshot({ path: join(shots, "dark.png") });
  await page.click("[data-view=preview]");
  assert.equal(await page.isVisible("#editor-pane"), false);
  await page.click("[data-view=editor]");
  assert.equal(await page.isVisible("#preview-pane"), false);
});

await test(
  "mobile layout",
  async (page) => {
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    if (shots) await page.screenshot({ path: join(shots, "mobile.png") });
  },
  { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
);

await browser.close();
if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll end-to-end tests passed");
