// Registry of languages used for syntax highlighting, both in the editor
// (fenced code blocks inside Markdown) and in the rendered preview.
// Everything is bundled: no language is ever fetched from the network.

import { Language, StreamLanguage, type StreamParser } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";

// Lightweight stream parsers (the full Lezer grammars would triple the file size).
import { javascript, typescript, json } from "@codemirror/legacy-modes/mode/javascript";
import { css, sCSS, less } from "@codemirror/legacy-modes/mode/css";
import { xml, html } from "@codemirror/legacy-modes/mode/xml";
import { python } from "@codemirror/legacy-modes/mode/python";
import { standardSQL, msSQL, mySQL, pgSQL, plSQL } from "@codemirror/legacy-modes/mode/sql";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { c, cpp, java } from "@codemirror/legacy-modes/mode/clike";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { vbScript } from "@codemirror/legacy-modes/mode/vbscript";
import { csharp, kotlin, objectiveC, scala, dart } from "@codemirror/legacy-modes/mode/clike";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { r } from "@codemirror/legacy-modes/mode/r";
import { sas } from "@codemirror/legacy-modes/mode/sas";
import { coffeeScript } from "@codemirror/legacy-modes/mode/coffeescript";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { swift } from "@codemirror/legacy-modes/mode/swift";

const legacy = (parser: StreamParser<unknown>) => () => StreamLanguage.define(parser);
const ready = (lang: Language) => () => lang;

// Each entry: list of aliases -> factory. Factories are memoised on first use.
const table: Array<[string[], () => Language]> = [
  [["js", "javascript", "mjs", "cjs", "node", "jsx"], legacy(javascript)],
  [["ts", "typescript", "tsx"], legacy(typescript)],
  [["json", "jsonc", "json5"], legacy(json)],
  [["css"], legacy(css)],
  [["scss"], legacy(sCSS)],
  [["less"], legacy(less)],
  [["html", "htm", "xhtml"], legacy(html)],
  [["xml", "svg", "xsd", "xsl", "xslt", "plist"], legacy(xml)],
  [["python", "py", "py3"], legacy(python)],
  [["sql"], legacy(standardSQL)],
  [["tsql", "mssql"], legacy(msSQL)],
  [["mysql", "mariadb"], legacy(mySQL)],
  [["pgsql", "postgres", "postgresql"], legacy(pgSQL)],
  [["plsql", "oracle"], legacy(plSQL)],
  [["yaml", "yml"], legacy(yaml)],
  [["c", "h"], legacy(c)],
  [["cpp", "c++", "cc", "cxx", "hpp"], legacy(cpp)],
  [["java"], legacy(java)],
  [["markdown", "md"], ready(markdownLanguage)],
  [["shell", "sh", "bash", "zsh", "console", "shellsession"], legacy(shell)],
  [["powershell", "ps1", "ps", "pwsh"], legacy(powerShell)],
  [["perl", "pl"], legacy(perl)],
  [["vb", "vbnet", "vb.net", "vba"], legacy(vb)],
  [["vbscript", "vbs"], legacy(vbScript)],
  [["csharp", "cs", "c#"], legacy(csharp)],
  [["objectivec", "objective-c", "objc"], legacy(objectiveC)],
  [["kotlin", "kt"], legacy(kotlin)],
  [["scala"], legacy(scala)],
  [["dart"], legacy(dart)],
  [["go", "golang"], legacy(go)],
  [["rust", "rs"], legacy(rust)],
  [["ruby", "rb"], legacy(ruby)],
  [["r"], legacy(r)],
  [["sas"], legacy(sas)],
  [["coffeescript", "coffee"], legacy(coffeeScript)],
  [["diff", "patch"], legacy(diff)],
  [["dockerfile", "docker"], legacy(dockerFile)],
  [["toml"], legacy(toml)],
  [["ini", "properties", "cfg", "conf"], legacy(properties)],
  [["lua"], legacy(lua)],
  [["swift"], legacy(swift)],
];

const byAlias = new Map<string, () => Language>();
for (const [aliases, factory] of table) {
  let cached: Language | undefined;
  const memo = () => (cached ??= factory());
  for (const alias of aliases) byAlias.set(alias, memo);
}

/** Find a language from a fenced code block info string ("js", "Python {.x}", ...). */
export function findLanguage(info: string | undefined | null): Language | null {
  if (!info) return null;
  const name = info.trim().split(/[\s{]/)[0].toLowerCase();
  const factory = byAlias.get(name);
  return factory ? factory() : null;
}

/** Primary names, for the help dialog. */
export const supportedLanguages = table.map(([aliases]) => aliases[0]);
