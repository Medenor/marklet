# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Reworded the credit to marqdown in the README and CHANGELOG, following feedback from its author.

## [1.0.0] - 2026-11-12

First release of Marklet, inspired by [marqdown](https://github.com/marqdown/marqdown) 1.8.0 by Reiner Kempkes and rewritten from scratch with a different focus: locked-down corporate machines.

### Added

- Open and save files in place (File System Access API), with download fallback; drag and drop; Save as.
- Export to standalone styled HTML, print/PDF layout, copy as formatted text or as HTML source.
- Footnotes, heading anchors, clickable task lists in the preview.
- Line-based scroll sync in both directions.
- Find and replace, code folding, multi-cursor editing (CodeMirror 6).
- Light, dark and automatic themes; editor-only, split and preview-only layouts; swappable sides.
- Word, character, line and reading-time counts, also for the selection.
- Highlighting for more languages, including R, SAS, PowerShell, Go, Rust, Kotlin and SQL dialects.
- Automatic migration of the last marqdown v1 session.
- Unit and browser end-to-end tests and reproducible builds.
- `make release`: publishes a Codeberg release from the maintainer's machine, with `marklet.html` and its SHA-256 checksum, after running every check and confirming the build matches the committed file. `make release-dry-run` shows what would be published.

### Changed (compared with marqdown 1.8.0)

- Formatting shortcuts moved off keys that browsers reserve (`Ctrl+1…6`, `Ctrl+L`, `Ctrl+H`, `Ctrl+O`).
- Files are accepted by extension instead of reported MIME type, which was often missing for `.md`.
- No runtime decompression: the file is plain (minified) HTML and JavaScript.
- Build moved from Gulp 3, CoffeeScript, Pug and LESS to Vite and TypeScript.

### Security

- All rendered HTML is sanitised with DOMPurify, so a crafted Markdown file cannot run script. (marqdown renders embedded HTML as written, by design.)
- Content Security Policy: no network access at all, and scripts allowed by hash only.

[Unreleased]: https://codeberg.org/Medenor/marklet/compare/v1.0.0...HEAD
[1.0.0]: https://codeberg.org/Medenor/marklet/releases/tag/v1.0.0
