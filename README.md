<p align="center">
  <img src="marklet.webp" alt="Marklet logo" width="160">
</p>

# Marklet

**A portable Markdown editor with live preview, in one HTML file.** No installation, no server, no network, no account.

Download `marklet.html`, put it on your desktop, a network share or a USB stick, and open it in your browser. That's it.

> Marklet is inspired by **[marqdown](https://github.com/marqdown/marqdown)**, the portable Markdown editor created by **Reiner Kempkes** in 2015. It keeps marqdown's core idea, a single self-contained HTML file with an editor, a live preview and formatting shortcuts, and takes it in a different direction: a richer editor and safeguards aimed at locked-down corporate machines. marqdown focuses on a minimal, standalone footprint, and remains the better fit if that is what you need. All credit for the concept goes to the original project. See [Credits](#credits).

**Intended use:** writing and reading Markdown documents (notes, specifications, draft procedures, README files) on machines where installing an editor isn't allowed. Marklet is a general-purpose text editor, and the files it saves are ordinary text files.

## Download

- **Latest release:** get `marklet.html` and its checksum from the [Releases](https://github.com/Medenor/marklet/releases) page on GitHub. See [Verify a download](#verify-a-download).
- **Or** take [`dist/marklet.html`](dist/marklet.html) straight from this repository.

The file is about 900 kB and works offline in current versions of Chrome, Edge, Firefox and Safari.

## Features

- **Live preview** of GitHub-flavoured Markdown: tables, task lists, footnotes, strikethrough, autolinks, heading anchors.
- **Syntax highlighting** in the editor and the preview for 40+ languages, including SQL dialects, Python, R, SAS, PowerShell, shell, VB/VBA, C#, Java, JavaScript/TypeScript, YAML, JSON and XML.
- **Edit files in place.** In Chrome and Edge, `Ctrl+S` writes back to the file you opened. Other browsers download a copy.
- **Open** with `Ctrl+O`, the Open button, or drag and drop.
- **Export:**
  - standalone styled HTML;
  - print or save as PDF (the print layout contains only the document);
  - **copy as formatted text** to paste into Outlook, Teams, Word or Confluence;
  - copy the HTML source.
- **Synchronised scrolling** in both directions, matched by source line, so long documents stay aligned.
- **Clickable task lists:** ticking a checkbox in the preview updates the Markdown.
- **Autosave** to browser storage. Your last session comes back when you reopen the file, including the last session of the original marqdown v1.
- Find and replace, code folding, bracket matching, list continuation on Enter, multi-cursor editing.
- **Layouts:** editor only, split or preview only, with either side on the left. Light, dark or automatic theme. Works on small screens.
- **Word, character and line counts** plus reading time, also for the current selection.

### Keyboard shortcuts

`Ctrl` is `Cmd` on macOS. Press `F1` in the app to see the full list.

| Action                                | Shortcut                                         |
| ------------------------------------- | ------------------------------------------------ |
| Save · Save as · Open                 | `Ctrl+S` · `Ctrl+Shift+S` · `Ctrl+O`             |
| Bold · Italic · Strikethrough         | `Ctrl+B` · `Ctrl+I` · `Ctrl+Shift+X`             |
| Inline code / code block · Link       | `Ctrl+E` · `Ctrl+K`                              |
| Heading 1–6 · Normal text             | `Ctrl+Alt+1…6` · `Ctrl+Alt+0`                    |
| Bulleted list · Numbered list · Quote | `Ctrl+Shift+8` · `Ctrl+Shift+7` · `Ctrl+Shift+.` |
| Find and replace                      | `Ctrl+F`                                         |

The original marqdown used `Ctrl+1…6`, `Ctrl+L`, `Ctrl+H` and `Ctrl+O` for formatting. Browsers reserve those keys (tab switching, address bar, history), so they were moved to the shortcuts above.

## For IT and security reviewers

Marklet is designed to be approvable in locked-down corporate environments.

| Concern                       | How it is handled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation, admin rights    | None. It is a static HTML file opened by the browser. No extension, executable or service.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Network access                | **None, enforced.** A Content Security Policy in the file sets `default-src 'none'` and `connect-src 'none'`, and only allows `data:`/`blob:` images. The page cannot make requests, load remote fonts or images, or send telemetry. Remote images in documents show as placeholders.                                                                                                                                                                                                               |
| Code execution from documents | All rendered HTML is sanitised with [DOMPurify](https://github.com/cure53/DOMPurify). In addition, the CSP allows only the application's own script, by SHA-256 hash, so injected `<script>`, `onerror=` and `javascript:` links cannot run. `eval` is not used and is blocked by the CSP.                                                                                                                                                                                                          |
| Obfuscation                   | None. The JavaScript is minified but not compressed, encoded or decrypted at runtime, so there is no base64 blob or `document.write` loader, a pattern that security scanners associate with HTML smuggling.                                                                                                                                                                                                                                                                                        |
| Data storage                  | The current document, file name, theme and layout are stored in the browser's `localStorage` under keys prefixed with `marklet:`, on the local machine only. If storage is blocked by policy, the app works without autosave and says so.                                                                                                                                                                                                                                                           |
| File access                   | Only files the user explicitly picks, through the browser's file picker or drag and drop. Saving in place uses the standard [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API). If that API is disabled by policy (for example with Chrome's `DefaultFileSystemWriteGuardSetting`), Save falls back to a normal download.                                                                                                                                         |
| Supply chain                  | Built from source with Vite. The build is reproducible: building the same commit twice gives the same SHA-256. Each release is an annotated git tag, published only after every check passed and the fresh build matched the committed file; anyone can rebuild it and compare checksums (see [Verify a download](#verify-a-download)). Every bundled third-party package and its license is listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and embedded at the end of the HTML file. |
| Licensing                     | MIT. Bundled libraries are MIT, except DOMPurify (MPL-2.0 or Apache-2.0).                                                                                                                                                                                                                                                                                                                                                                                                                           |

To check the policy yourself, open the file in a text editor and look for `Content-Security-Policy` near the top.

### Known limitations

- **Saving in place** needs a Chromium-based browser (Chrome, Edge). Firefox and Safari download a copy instead.
- **Remote and relative images** are not shown in the preview, because network access is blocked. Exported HTML keeps them.
- **Autosave** is per browser and per profile. Firefox may keep separate storage for each `file://` location, so a moved or renamed copy of the HTML file can start with an empty session.
- **Not included:** Mermaid diagrams and math (KaTeX) would add 0.3–3 MB, against the goal of a small tool.

### How Marklet differs from marqdown

The two projects share an idea but not a focus. This table compares marqdown 1.8.0 (January 2020) with Marklet 1.0.0.

|               | marqdown 1.8.0                                                | Marklet                                                                                           |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Focus         | Minimal, standalone footprint                                 | Locked-down corporate machines                                                                    |
| Packaging     | Body compressed with lz-string, about half the size (~330 kB) | Plain minified code, no runtime decompression, which some security scanners flag (~900 kB)        |
| Editor        | CodeMirror 5                                                  | CodeMirror 6: search, folding, multi-cursor                                                       |
| Markdown      | marked 0.8                                                    | Current marked, with footnotes and heading anchors                                                |
| Embedded HTML | Rendered as written, by design                                | Sanitised with DOMPurify, for opening files received from others; a CSP blocks all network access |
| Files         | Open and download; accepted by reported MIME type             | Open and save in place, drag and drop; accepted by file extension                                 |
| Scroll sync   | Percentage-based                                              | Line-based, both directions                                                                       |
| Export        | HTML, print to PDF                                            | Styled standalone HTML, print to PDF, copy as formatted text                                      |
| Look          | Bootstrap 3, light theme                                      | Native UI, light/dark/auto themes                                                                 |
| Build         | Gulp, CoffeeScript, Pug, LESS                                 | Vite, TypeScript, plain CSS, unit and browser tests                                               |

## Development

Requires Node.js 20 or newer and a POSIX shell for `make` (macOS/Linux terminal, WSL or Git Bash on Windows). Contributors and coding agents: read [AGENTS.md](AGENTS.md) first.

**Stack:** TypeScript (strict) + Vite, CodeMirror 6, marked, DOMPurify; Vitest and Playwright for tests. No React and no CSS framework, on purpose: the whole app ships as one file and every kilobyte counts.

`make` lists every target. The usual ones:

```bash
make setup
```

```bash
make dev
```

Starts a development server with hot reload on port 7883. The CSP is only added by the production build.

```bash
make check
```

Runs every check: format check, lint, typecheck, unit tests, then builds, runs the browser tests against `dist/marklet.html` opened via `file://`, and fails if the rebuilt file differs from the committed one. The browser tests need Chromium once: `npx playwright install chromium`.

```bash
make build
```

Writes `dist/marklet.html` and regenerates `THIRD_PARTY_LICENSES.md`. Commit both with your change; `make check` and `make release` refuse a stale build. Build with the Node.js version in `.nvmrc`, or the output may differ.

### Contributing

The project lives on [GitHub](https://github.com/Medenor/marklet). Work on a branch and open a pull request; the template asks for the size and security impact of the change. There is no CI: run `make check` and paste the result in the pull request. The maintainer runs it again before merging.

Review dependencies monthly and before each release: `make outdated` lists available updates, and `make security` fails on any advisory in code shipped inside `marklet.html` and on high-severity advisories in build and test tooling.

### Releasing

Releases are published from the maintainer's machine with one command. There is no CI server; the safeguards are in the script ([scripts/release.mjs](scripts/release.mjs)).

**One-time setup.** Install the [GitHub CLI](https://cli.github.com) and sign in with an account that can write to the repository:

```bash
gh auth login
```

The script takes the token from `gh auth token`. To use another token, set the environment variable `GITHUB_TOKEN` instead.

The token is only sent to GitHub's API, in the `Authorization` header, and is never printed.

**Each release:**

1. In a pull request, bump `version` in `package.json` and move the `[Unreleased]` entries of `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD`. Merge it.
2. On an up-to-date `main`, preview the release:

   ```bash
   make release-dry-run
   ```

3. Publish it:

   ```bash
   make release
   ```

`make release` stops at the first problem. It checks that you are on a clean `main` identical to GitHub's, that Node.js matches `.nvmrc`, that the version is new and has a changelog section, that git can create the tag (`user.name` and `user.email` set), and that the token can write to the repository. It then runs `npm ci`, `make check` and `make security`, and verifies that the fresh build is identical to the committed `dist/marklet.html`. Only then does it create and push the annotated tag `vX.Y.Z` (signed if git has `tag.gpgSign` enabled; gpg can prompt for its passphrase), create the release with the changelog section as notes, and attach `marklet.html` and `marklet.html.sha256`.

The token is sent only to GitHub: if an attached file points anywhere else, the script stops instead of downloading it. If it fails halfway, run it again: it reuses the tag and release it already created and uploads only what is missing. It never moves a published tag or replaces a published file. A bad release is fixed with a new patch version.

### Verify a download

The build is reproducible, so anyone can check that a released `marklet.html` was built from the published source:

```bash
git clone https://github.com/Medenor/marklet.git
```

```bash
cd marklet && git checkout vX.Y.Z && make setup && make build
```

```bash
sha256sum dist/marklet.html
```

The result must equal the release's `marklet.html.sha256` and the checksum of the downloaded file (`sha256sum marklet.html`; on macOS `shasum -a 256`, on Windows `certutil -hashfile marklet.html SHA256`). Use the Node.js version given in `.nvmrc`.

### Project layout

```text
AGENTS.md             Instructions for coding agents (CLAUDE.md points here)
Makefile              Command surface: make dev / test / lint / build
index.html            App shell (toolbar, panes, help dialog)
src/main.ts           Wiring: actions, autosave, scroll sync, drag & drop
src/editor.ts         CodeMirror setup and formatting commands
src/render.ts         Markdown → sanitised HTML (preview and export)
src/languages.ts      Languages for code highlighting
src/files.ts          Open/save (File System Access API with fallbacks)
src/export.ts         Standalone HTML export and rich-text copy
src/storage.ts        Safe localStorage wrapper
src/preview.css       Document styles (shared by preview and export)
src/styles.css        Application styles
scripts/postbuild.mjs CSP hashes, license bundling, output file
scripts/release.mjs   GitHub release (make release)
tests/                Unit, release-script and end-to-end tests
dist/marklet.html     The built product (committed)
```

## Credits

- **[marqdown](https://github.com/marqdown/marqdown)** by **Reiner Kempkes**, MIT License, © 2015. This project builds on its idea: the single-file portable design, the side-by-side live preview, the formatting hotkeys and the browser-storage session restore all come from marqdown. Marklet is a rewrite and contains no code from the original, but its license notice is kept in [LICENSE](LICENSE) out of respect for the original work.
- [CodeMirror](https://codemirror.net/) by Marijn Haverbeke and contributors (MIT).
- [marked](https://marked.js.org/) (MIT) and [marked-footnote](https://github.com/bent10/marked-extensions) (MIT).
- [DOMPurify](https://github.com/cure53/DOMPurify) by Cure53 (MPL-2.0 or Apache-2.0).

## License

[MIT](LICENSE).

## Disclaimer – Spec Driven Development & AI collaboration

This repository was developed using a _Spec Driven Development_ approach, with extensive AI collaboration throughout the process.

AI is used to build and brainstorm detailed specifications before delegating coding tasks. The development follows a collaborative process where AI handles implementation, while human oversight ensures quality through review, testing, and debugging.

Transparency matters: this project reflects a comprehensive human–AI collaborative workflow from specification to deployment.
