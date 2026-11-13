# Welcome to Marklet

A **portable Markdown editor** in one HTML file. It needs no installation, no server and no network.

- Your text stays on your computer. The app can't send anything anywhere: its Content Security Policy blocks all network access.
- Your work is saved automatically in this browser and restored next time.
- In Chrome and Edge, **Save** (`Ctrl+S`) writes back to the file you opened. Other browsers download a copy.

## Getting started

1. Open a `.md` file with **Open** (`Ctrl+O`), or drag it onto the window.
2. Write on one side and watch the preview on the other.
3. Save with `Ctrl+S`, export to HTML, print to PDF, or copy formatted text to paste into an email.

> Tip: click **?** in the toolbar for every keyboard shortcut.

## What you can write

| Syntax                | Result                    |
| --------------------- | ------------------------- |
| `**bold**`            | **bold**                  |
| `*italic*`            | *italic*                  |
| `~~strike~~`          | ~~strike~~                |
| `` `code` ``          | `code`                    |
| `[link](https://…)`   | [link](https://example.com) |

- [x] Task lists
- [ ] Footnotes[^1]
- [ ] Tables, quotes, code blocks with syntax highlighting

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

```sas
data work.adsl;
  set raw.dm;
  where saffl = "Y";
run;
```

[^1]: Like this one.

---

Marklet is inspired by [marqdown](https://github.com/marqdown/marqdown), the portable Markdown editor created by Reiner Kempkes in 2015. Both are released under the MIT License.
