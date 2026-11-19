#!/usr/bin/env node
// Prepare a Marklet release in the working tree: bump the version in
// package.json and package-lock.json, and move the [Unreleased] changelog
// entries under the new version. Then rebuild and run the tests.
//
// It never commits, tags, pushes or publishes. Publishing is scripts/release.mjs.
// See "Releasing" in README.md.
//
//   make release-prepare-dry-run VERSION=X.Y.Z   show the changes, write nothing
//   make release-prepare VERSION=X.Y.Z           apply the changes, then build and test

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isSemver, ReleaseError } from "./release.mjs";

const defaultLog = (msg) => process.stdout.write(msg + "\n");

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/release-prepare.test.mjs)

/** Compare two X.Y.Z strings: -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Set the "version" on the line at or after `start` that has exactly `indent` spaces before it. */
function setVersionLine(lines, start, indent, to, file) {
  const re = new RegExp(`^ {${indent}}"version": "[^"]*"`);
  const i = lines.findIndex((line, idx) => idx >= start && re.test(line));
  if (i < 0) {
    throw new ReleaseError(
      `${file}: no "version" line with ${indent} spaces of indentation was found, so it was not bumped. Check its format.`,
    );
  }
  lines[i] = lines[i].replace(/"version": "[^"]*"/, `"version": "${to}"`);
}

/** package.json: the top-level "version" (the first two-space-indented one). */
export function bumpPackageJson(text, to) {
  const lines = text.split("\n");
  setVersionLine(lines, 0, 2, to, "package.json");
  return lines.join("\n");
}

/**
 * package-lock.json: the top-level "version" and the root package's entry under
 * packages[""]. Other packages that happen to share the old version number are
 * left alone, because only these two lines are edited.
 */
export function bumpPackageLock(text, to) {
  const lines = text.split("\n");
  const root = lines.findIndex((line) => /^ {4}"": \{$/.test(line));
  if (root < 0) {
    throw new ReleaseError('package-lock.json: no root package entry (packages[""]) was found, so it was not bumped.');
  }
  setVersionLine(lines, 0, 2, to, "package-lock.json");
  setVersionLine(lines, root, 6, to, "package-lock.json");
  return lines.join("\n");
}

/**
 * CHANGELOG.md (Keep a Changelog): "## [Unreleased]" keeps its place, and its
 * entries move under a new "## [to] - date" heading. The compare links are
 * updated when the file has them.
 */
export function bumpChangelog(text, to, date) {
  const lines = text.split("\n");
  const u = lines.findIndex((line) => line === "## [Unreleased]");
  if (u < 0) throw new ReleaseError('CHANGELOG.md has no "## [Unreleased]" heading.');
  if (lines.some((line) => line.startsWith(`## [${to}]`))) {
    throw new ReleaseError(`CHANGELOG.md already has a "## [${to}]" section.`);
  }

  let end = lines.findIndex((line, i) => i > u && (/^## /.test(line) || /^\[[^\]]+\]:\s/.test(line)));
  if (end < 0) end = lines.length;
  // Headings alone (e.g. "### Added" with nothing under it) are not an entry.
  const entries = lines.slice(u + 1, end).filter((line) => line.trim() && !/^#{1,6}\s/.test(line));
  if (entries.length === 0) {
    throw new ReleaseError(
      "[Unreleased] in CHANGELOG.md is empty. Add the entries for this release there before preparing it.",
    );
  }

  lines.splice(u + 1, 0, "", `## [${to}] - ${date}`);

  const ref = lines.findIndex((line) => /^\[Unreleased\]:\s/.test(line));
  if (ref >= 0) {
    const m = /^\[Unreleased\]:\s*(\S+?)\/compare\/v?(\S+?)\.\.\.HEAD\s*$/.exec(lines[ref]);
    if (!m) throw new ReleaseError(`CHANGELOG.md: unexpected [Unreleased] link: ${lines[ref]}`);
    const [, base, previous] = m;
    lines.splice(
      ref,
      1,
      `[Unreleased]: ${base}/compare/v${to}...HEAD`,
      `[${to}]: ${base}/compare/v${previous}...v${to}`,
    );
  }
  return lines.join("\n");
}

/** New contents of every file a release preparation changes, keyed by file name. */
export function prepareFiles({ packageJson, packageLock, changelog, to, date }) {
  return {
    "package.json": bumpPackageJson(packageJson, to),
    "package-lock.json": bumpPackageLock(packageLock, to),
    "CHANGELOG.md": bumpChangelog(changelog, to, date),
  };
}

/**
 * Unified-style diff of two texts: changed lines with up to 2 lines of context,
 * and "..." where unchanged lines are skipped. Returns "" when nothing changed.
 */
export function lineDiff(name, before, after) {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  // Longest common subsequence table, built from the end.
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push([" ", a[i]]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push(["-", a[i++]]);
    } else {
      ops.push(["+", b[j++]]);
    }
  }
  while (i < n) ops.push(["-", a[i++]]);
  while (j < m) ops.push(["+", b[j++]]);

  const changed = ops.map(([op]) => op !== " ");
  const keep = changed.slice();
  for (let k = 0; k < ops.length; k++) {
    if (changed[k]) {
      for (let d = 1; d <= 2; d++) {
        if (k - d >= 0) keep[k - d] = true;
        if (k + d < ops.length) keep[k + d] = true;
      }
    }
  }
  const out = [`--- a/${name}`, `+++ b/${name}`];
  let skipped = false;
  ops.forEach(([op, text], k) => {
    if (!keep[k]) {
      if (!skipped) out.push("...");
      skipped = true;
      return;
    }
    skipped = false;
    out.push(`${op}${text}`);
  });
  return out.join("\n");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Procedure

const CHECKS = [
  ["make", "build"],
  ["make", "lint", "test", "test-e2e"],
];

function git(cwd, ...args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    throw new ReleaseError(`git ${args[0]} failed: ${(e.stderr?.toString() || e.message || "").trim()}`);
  }
}

/**
 * @param {object} o
 * @param {string} o.cwd            repository root
 * @param {string} o.to             the new version, X.Y.Z
 * @param {boolean} o.dryRun        show the changes only
 * @param {string} [o.date]         release date, YYYY-MM-DD (UTC today by default)
 * @param {string[][]} [o.checks]   commands run after the files are written
 * @param {(msg: string) => void} [o.log]
 */
export function prepareRelease({ cwd, to, dryRun, date = today(), checks = CHECKS, log = defaultLog }) {
  if (!to) throw new ReleaseError("Usage: make release-prepare VERSION=X.Y.Z");
  if (!isSemver(to) || to.includes("-")) {
    throw new ReleaseError(`VERSION must be X.Y.Z (no prerelease suffix), got "${to}".`);
  }

  const read = (file) => readFileSync(join(cwd, file), "utf8");
  const before = {
    "package.json": read("package.json"),
    "package-lock.json": read("package-lock.json"),
    "CHANGELOG.md": read("CHANGELOG.md"),
  };
  const from = JSON.parse(before["package.json"]).version;
  if (compareVersions(to, from) <= 0) {
    throw new ReleaseError(`VERSION ${to} must be greater than the current version ${from}.`);
  }

  const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main" && branch !== `release/v${to}`) {
    throw new ReleaseError(`Prepare the release on main or on release/v${to}; you are on "${branch}".`);
  }
  if (git(cwd, "status", "--porcelain")) {
    throw new ReleaseError("The working tree has uncommitted changes. Commit or stash them first.");
  }

  const after = prepareFiles({
    packageJson: before["package.json"],
    packageLock: before["package-lock.json"],
    changelog: before["CHANGELOG.md"],
    to,
    date,
  });
  const lockRoot = JSON.parse(before["package-lock.json"]).version;

  log(`\nMarklet ${from} → ${to} (${date})${dryRun ? " (dry run: nothing will be written)" : ""}\n`);
  if (lockRoot !== from) {
    log(`  note: package-lock.json root version was ${lockRoot}, not ${from}; it is set to ${to} as well.\n`);
  }
  const changed = Object.keys(after).filter((name) => after[name] !== before[name]);
  for (const name of Object.keys(after)) {
    const diff = lineDiff(name, before[name], after[name]);
    if (diff) log(diff + "\n");
  }

  if (dryRun) {
    log(`Dry run complete: nothing was written. To apply: make release-prepare VERSION=${to}`);
    return { applied: false, changed };
  }

  for (const name of changed) writeFileSync(join(cwd, name), after[name]);
  log(`Updated ${changed.join(", ")}. Running the checks:`);
  for (const cmd of checks) {
    log(`  $ ${cmd.join(" ")}`);
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd, stdio: "inherit", shell: process.platform === "win32" });
    if (r.error) throw new ReleaseError(`\`${cmd.join(" ")}\` could not start: ${r.error.message}`);
    if (r.status !== 0) {
      throw new ReleaseError(
        `\`${cmd.join(" ")}\` failed (exit code ${r.status}). The files were updated; fix the problem, then re-run the failing check.`,
      );
    }
  }

  const status = git(cwd, "status", "--porcelain");
  log(`\nRelease ${to} is prepared, but nothing is committed.`);
  if (status) log(`Changed files, to review and commit in the release PR:\n${status.replace(/^/gm, "  ")}`);
  log(
    "dist/marklet.html embeds the version, so it is rebuilt with the bump: commit it with the other files (make check refuses a stale build).",
  );
  return { applied: true, changed };
}

// ---------------------------------------------------------------------------
// CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const idx = process.argv.indexOf("--version");
  const to = idx >= 0 ? process.argv[idx + 1] : undefined;
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  try {
    prepareRelease({ cwd, to, dryRun });
  } catch (e) {
    process.stderr.write(`\n✗ ${e instanceof ReleaseError ? e.message : (e?.stack ?? e)}\n`);
    process.exit(1);
  }
}
