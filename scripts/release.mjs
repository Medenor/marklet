#!/usr/bin/env node
// Publish a Marklet release to GitHub from the maintainer's machine. No CI
// involved; see "Releasing" in README.md.
//
//   make release            full release
//   make release-dry-run    every check, nothing published
//
// The token comes from $GITHUB_TOKEN or, by default, from `gh auth token`
// (GitHub CLI). It is only ever sent to the GitHub API, in the Authorization
// header, and never printed.
//
// Re-running after a failure resumes: an existing tag on HEAD and an existing
// release are reused, and only missing assets are uploaded. A published tag is
// never moved or deleted.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/release.test.mjs)

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function isSemver(version) {
  return SEMVER.test(version);
}

/** "https://github.com/Owner/repo(.git)" → { forge, owner, repo } */
export function parseRepository(url) {
  const m = /^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url ?? "");
  if (!m)
    throw new ReleaseError(`package.json "repository" must look like https://github.com/<owner>/<repo>, got: ${url}`);
  return { forge: m[1], owner: m[2], repo: m[3] };
}

/** Body of the "## [version]" section of a Keep a Changelog file, or null. */
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n?/g, "\n").split("\n");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = lines.findIndex((l) => new RegExp(`^## \\[${escaped}\\]`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && (/^## /.test(l) || /^\[[^\]]+\]:\s/.test(l)));
  if (end < 0) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return body || null;
}

/** Does a git remote URL point at owner/repo on the forge's host? */
export function remoteMatches(remoteUrl, { forge, owner, repo }) {
  const host = new URL(forge).hostname.toLowerCase();
  const normalized = remoteUrl
    .toLowerCase()
    .replace(/^([^/@:]+@[^/:]+):(?!\/)/, "ssh://$1/") // scp-style git@host:owner/repo
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  return normalized.includes(host) && normalized.endsWith(`/${owner}/${repo}`.toLowerCase());
}

/** Hide credentials embedded in URLs ("https://user:secret@host" → "https://***@host"). */
export function redactCredentials(text) {
  return String(text).replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1***@");
}

/** Does `url` (possibly relative) live on the same origin as `base`? */
export function sameOrigin(url, base) {
  try {
    return new URL(url, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** Major version from an .nvmrc value such as "22", "v22.11.0" or "lts/*" (null if none). */
export function nvmrcMajor(text) {
  const m = /^\s*v?(\d+)/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export class ReleaseError extends Error {}

// ---------------------------------------------------------------------------
// GitHub REST API client

const GITHUB_ACCEPT = "application/vnd.github+json";
const GITHUB_API_VERSION = "2022-11-28";

export class GitHub {
  /**
   * @param {object} o
   * @param {string} o.api      API base, e.g. https://api.github.com
   * @param {string} o.uploads  Uploads base, e.g. https://uploads.github.com
   * @param {string} o.owner
   * @param {string} o.repo
   * @param {string} o.token
   */
  constructor({ api, uploads, owner, repo, token }) {
    this.api = api.replace(/\/$/, "");
    this.uploads = uploads.replace(/\/$/, "");
    this.repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    this.token = token;
  }

  headers(extra = {}) {
    return {
      Accept: GITHUB_ACCEPT,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      Authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  async request(method, url, { json, body, contentType, allow404 = false } = {}) {
    const headers = this.headers();
    let payload;
    if (json) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(json);
    } else if (body) {
      headers["Content-Type"] = contentType;
      payload = body;
    }
    const res = await fetch(url, { method, headers, body: payload });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      const hint =
        res.status === 401
          ? " (token missing, expired or revoked)"
          : res.status === 403
            ? " (token lacks a required scope or write access to repositories; the response below names the scope)"
            : "";
      const path = new URL(url).pathname;
      throw new ReleaseError(`${method} ${path} failed: HTTP ${res.status}${hint}. ${text}`);
    }
    return res.status === 204 ? null : res.json();
  }

  user() {
    return this.request("GET", `${this.api}/user`);
  }
  repository() {
    return this.request("GET", `${this.api}${this.repoPath}`);
  }
  releaseByTag(tag) {
    return this.request("GET", `${this.api}${this.repoPath}/releases/tags/${encodeURIComponent(tag)}`, {
      allow404: true,
    });
  }
  createRelease({ tag, name, body, prerelease }) {
    return this.request("POST", `${this.api}${this.repoPath}/releases`, {
      json: { tag_name: tag, name, body, draft: false, prerelease },
    });
  }
  uploadAsset(releaseId, name, buffer, type) {
    return this.request(
      "POST",
      `${this.uploads}${this.repoPath}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
      { body: buffer, contentType: type },
    );
  }
  /**
   * Download an attached asset through its API URL (not browser_download_url),
   * so the token is only ever sent to the API origin. GitHub redirects the
   * download to a storage host; fetch drops the Authorization header on
   * cross-origin redirects.
   */
  async download(asset) {
    const url = asset.url;
    if (!url || !sameOrigin(url, this.api)) {
      throw new ReleaseError(
        `An attached asset (${asset.name}) is not served by ${new URL(this.api).origin}. ` +
          `It may be an external link added by someone with write access. Remove it from the release and investigate before releasing.`,
      );
    }
    const res = await fetch(url, { headers: this.headers({ Accept: "application/octet-stream" }) });
    if (!res.ok) throw new ReleaseError(`Download of ${asset.name} failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

// ---------------------------------------------------------------------------
// Release procedure

const defaultLog = (msg) => process.stdout.write(msg + "\n");

/** $GITHUB_TOKEN, else `gh auth token` (unless disabled, e.g. in tests). */
function resolveToken(env, { useGhCli }) {
  const fromEnv = env.GITHUB_TOKEN?.trim() || null;
  if (fromEnv || !useGhCli) return fromEnv;
  try {
    return (
      execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
    );
  } catch {
    return null;
  }
}

/** API and uploads bases. RELEASE_API_URL and RELEASE_UPLOADS_URL override them (tests only). */
function apiBases(target, env) {
  if (env.RELEASE_API_URL) {
    return { api: env.RELEASE_API_URL, uploads: env.RELEASE_UPLOADS_URL || env.RELEASE_API_URL };
  }
  if (new URL(target.forge).hostname === "github.com") {
    return { api: "https://api.github.com", uploads: "https://uploads.github.com" };
  }
  throw new ReleaseError(`Only github.com releases are supported, not ${target.forge}.`);
}

/**
 * @param {object} o
 * @param {string} o.cwd              repository root
 * @param {boolean} o.dryRun
 * @param {string[] | null} o.install command run in step 2 (null to skip, in tests)
 * @param {string[][]} o.checks       commands run in step 3
 * @param {Record<string,string|undefined>} o.env
 * @param {boolean} [o.useGhCli=true] fall back to `gh auth token` (false in tests)
 * @param {(msg: string) => void} [o.log]
 */
export async function release({ cwd, dryRun, install, checks, env, useGhCli = true, log = defaultLog }) {
  const git = (...args) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e) {
      const detail = (e.stderr?.toString() || e.message || "").trim();
      throw new ReleaseError(`git ${args[0]} failed: ${redactCredentials(detail)}`);
    }
  };
  const tryGit = (...args) => {
    try {
      return git(...args);
    } catch {
      return null;
    }
  };
  const run = (cmd) => {
    log(`  $ ${cmd.join(" ")}`);
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd, stdio: "inherit", shell: process.platform === "win32" });
    if (r.error) throw new ReleaseError(`\`${cmd.join(" ")}\` could not start: ${r.error.message}`);
    if (r.signal) throw new ReleaseError(`\`${cmd.join(" ")}\` was interrupted (${r.signal}).`);
    if (r.status !== 0) throw new ReleaseError(`\`${cmd.join(" ")}\` failed (exit code ${r.status}).`);
  };

  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  const version = pkg.version;
  const tag = `v${version}`;
  const target = parseRepository(pkg.repository);
  const bases = apiBases(target, env);
  const remote = env.RELEASE_REMOTE || "origin";

  log(
    `\nMarklet ${version} → ${target.forge}/${target.owner}/${target.repo}${dryRun ? " (dry run: nothing will be published)" : ""}\n`,
  );

  // 1. Pre-flight --------------------------------------------------------
  log("1/8 Pre-flight checks");
  if (!isSemver(version))
    throw new ReleaseError(`package.json version "${version}" is not semantic versioning (X.Y.Z).`);

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") throw new ReleaseError(`Releases are made from main; you are on "${branch}".`);
  if (git("status", "--porcelain"))
    throw new ReleaseError("The working tree has uncommitted changes. Commit or stash them first.");

  // The build is only reproducible with the Node.js major version in .nvmrc.
  const nvmrc = join(cwd, ".nvmrc");
  const wantedNode = existsSync(nvmrc) ? nvmrcMajor(readFileSync(nvmrc, "utf8")) : null;
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (wantedNode !== null && nodeMajor !== wantedNode) {
    throw new ReleaseError(
      `Node.js ${process.versions.node} is running, but .nvmrc pins Node ${wantedNode}. Releases must be built with Node ${wantedNode} so anyone can reproduce them (e.g. \`nvm use\`).`,
    );
  }

  const remoteUrl = tryGit("remote", "get-url", remote);
  if (!remoteUrl)
    throw new ReleaseError(`No git remote "${remote}". Add it: git remote add ${remote} ${pkg.repository}.git`);
  if (!remoteMatches(remoteUrl, target)) {
    throw new ReleaseError(
      `Remote "${remote}" points to ${redactCredentials(remoteUrl)}, not ${target.owner}/${target.repo} on ${new URL(target.forge).host}. ` +
        `Fix the remote, or set RELEASE_REMOTE to the right one.`,
    );
  }
  // Tags are inspected with ls-remote below; fetching them here would fail on a
  // conflicting local tag before the clear "never moved" message can be shown.
  git("fetch", "--quiet", remote, "main");
  const head = git("rev-parse", "HEAD");
  const remoteHead = git("rev-parse", `${remote}/main`);
  if (head !== remoteHead)
    throw new ReleaseError(
      `Local main (${head.slice(0, 7)}) differs from ${remote}/main (${remoteHead.slice(0, 7)}). Pull or push first.`,
    );

  const changelog = readFileSync(join(cwd, "CHANGELOG.md"), "utf8");
  const notes = changelogSection(changelog, version);
  if (!notes)
    throw new ReleaseError(
      `CHANGELOG.md has no "## [${version}]" section with content. Move the [Unreleased] entries under it (in a PR).`,
    );

  const localTag = tryGit("rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
  // One call returns the tag and, for annotated tags, its peeled commit ("^{}").
  const refs = git("ls-remote", "--tags", remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
  const peeled = refs.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
  const direct = refs.find(([, ref]) => ref === `refs/tags/${tag}`);
  const remoteTag = (peeled ?? direct)?.[0] ?? null;
  for (const [where, commit] of [
    ["locally", localTag],
    [`on ${remote}`, remoteTag],
  ]) {
    if (commit && commit !== head) {
      throw new ReleaseError(
        `Tag ${tag} already exists ${where} on another commit (${commit.slice(0, 7)}). Released versions are never moved: bump the version for a new release.`,
      );
    }
  }
  const resuming = Boolean(localTag || remoteTag);
  if (resuming) log(`  Tag ${tag} already exists on this commit: resuming.`);
  if (!localTag && !remoteTag && !(tryGit("config", "user.name") && tryGit("config", "user.email"))) {
    throw new ReleaseError(
      "git user.name and user.email must be set to create the release tag (git config --global …).",
    );
  }

  const token = resolveToken(env, { useGhCli });
  let github = null;
  if (!token) {
    if (!dryRun) throw new ReleaseError("No token. Set GITHUB_TOKEN or run `gh auth login` (see README, Releasing).");
    log("  ! No token found: skipping the GitHub checks in this dry run.");
  } else {
    github = new GitHub({ ...bases, owner: target.owner, repo: target.repo, token });
    const user = await github.user();
    const repo = await github.repository();
    if (!repo.permissions?.push)
      throw new ReleaseError(`User ${user.login} cannot write to ${target.owner}/${target.repo}.`);
    log(`  Token OK: ${user.login}, write access to ${target.owner}/${target.repo}.`);
  }
  log("  ✓ main is clean and up to date, version and changelog are ready.");

  // 2-3. Clean install and full checks ------------------------------------
  log("\n2/8 Clean install");
  if (install) run(install);
  log("\n3/8 Full checks");
  for (const cmd of checks) run(cmd);

  // 4. The committed build must be what the source produces ---------------
  log("\n4/8 Build matches the committed files");
  if (git("status", "--porcelain", "--", "dist", "THIRD_PARTY_LICENSES.md")) {
    throw new ReleaseError(
      `The fresh build differs from the committed dist/ or THIRD_PARTY_LICENSES.md (built with Node ${process.versions.node}). ` +
        "If the source changed without a rebuild, commit the rebuilt files through a PR, then release.",
    );
  }
  if (git("status", "--porcelain"))
    throw new ReleaseError("The checks left the working tree modified. Investigate before releasing.");
  log("  ✓ identical");

  // 5. Checksum -------------------------------------------------------------
  log("\n5/8 Checksum");
  const html = readFileSync(join(cwd, "dist", "marklet.html"));
  const hash = sha256(html);
  const checksum = Buffer.from(`${hash}  marklet.html\n`);
  log(`  SHA-256 ${hash}`);

  const assets = [
    { name: "marklet.html", buffer: html, type: "text/html" },
    { name: "marklet.html.sha256", buffer: checksum, type: "text/plain" },
  ];

  if (dryRun) {
    log(`\nDry run complete. A real run would:`);
    log(`  - ${resuming ? "reuse" : "create and push"} tag ${tag} on ${head.slice(0, 7)}`);
    log(
      `  - publish release "Marklet ${version}" with ${assets.map((a) => `${a.name} (${a.buffer.length < 10240 ? `${a.buffer.length} bytes` : `${Math.round(a.buffer.length / 1024)} kB`})`).join(", ")}`,
    );
    log(`  - use these release notes:\n\n${notes.replace(/^/gm, "    ")}\n`);
    return { dryRun: true, hash };
  }

  // 6. Tag ------------------------------------------------------------------
  log("\n6/8 Tag");
  if (!localTag && !remoteTag) {
    // Signed automatically when git is configured with tag.gpgSign=true. The
    // terminal is passed through so gpg can ask for a passphrase.
    const r = spawnSync("git", ["tag", "-a", tag, "-m", `Marklet ${version}`], { cwd, stdio: "inherit" });
    if (r.error || r.status !== 0) {
      throw new ReleaseError(
        `Creating tag ${tag} failed${r.error ? `: ${r.error.message}` : ""}. Nothing was published.`,
      );
    }
    log(`  Created ${tag}`);
  } else if (!localTag) {
    git("fetch", "--quiet", remote, `refs/tags/${tag}:refs/tags/${tag}`);
    log(`  Fetched ${tag} from ${remote}`);
  }
  if (!remoteTag) {
    git("push", "--quiet", remote, `refs/tags/${tag}`);
    log(`  Pushed ${tag} to ${remote}`);
  } else {
    log(`  ${tag} already on ${remote}`);
  }

  // 7. Release and assets -----------------------------------------------------
  log("\n7/8 Release");
  let rel = await github.releaseByTag(tag);
  if (rel) {
    log(`  Release already exists (id ${rel.id}): checking assets.`);
  } else {
    rel = await github.createRelease({
      tag,
      name: `Marklet ${version}`,
      body: notes,
      prerelease: version.includes("-"),
    });
    log(`  Created release (id ${rel.id})`);
  }
  for (const asset of assets) {
    const existing = (rel.assets ?? []).find((a) => a.name === asset.name);
    if (existing) {
      const remoteHash = sha256(await github.download(existing));
      if (remoteHash !== sha256(asset.buffer)) {
        throw new ReleaseError(
          `${asset.name} is already attached to ${tag} but differs from this build. Investigate; do not overwrite a published asset.`,
        );
      }
      log(`  ${asset.name}: already attached, identical`);
    } else {
      await github.uploadAsset(rel.id, asset.name, asset.buffer, asset.type);
      log(`  ${asset.name}: uploaded`);
    }
  }

  // 8. Report -------------------------------------------------------------------
  const url = rel.html_url ?? `${target.forge}/${target.owner}/${target.repo}/releases/tag/${tag}`;
  log(`\n8/8 Done\n  ${url}\n  SHA-256 ${hash}\n`);
  return { dryRun: false, hash, url };
}

// ---------------------------------------------------------------------------
// CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const install = ["npm", "ci"];
  const checks = [
    ["make", "check"],
    ["make", "security"],
  ];
  release({ cwd, dryRun, install, checks, env: process.env }).catch((e) => {
    process.stderr.write(`\n✗ ${e instanceof ReleaseError ? e.message : redactCredentials(e?.stack ?? e)}\n`);
    process.exit(1);
  });
}
