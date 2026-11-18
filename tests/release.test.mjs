// Tests for scripts/release.mjs: pure helpers, then whole release runs against
// a fake GitHub API and a throwaway git remote. Nothing touches GitHub.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changelogSection,
  isSemver,
  nvmrcMajor,
  parseRepository,
  redactCredentials,
  remoteMatches,
  release,
  sameOrigin,
  sha256,
  ReleaseError,
} from "../scripts/release.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-12-01

### Added

- Table of contents.

## [1.0.0] - 2026-11-12

- First release.

[Unreleased]: https://github.com/Medenor/marklet/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Medenor/marklet/releases/tag/v1.1.0
`;

describe("helpers", () => {
  it("extracts one changelog section", () => {
    expect(changelogSection(CHANGELOG, "1.1.0")).toBe("### Added\n\n- Table of contents.");
    expect(changelogSection(CHANGELOG, "1.0.0")).toBe("- First release.");
    expect(changelogSection(CHANGELOG, "Unreleased")).toBeNull();
    expect(changelogSection(CHANGELOG, "2.0.0")).toBeNull();
    expect(changelogSection(CHANGELOG, "1.1")).toBeNull();
  });

  it("validates semantic versions", () => {
    expect(isSemver("1.0.0")).toBe(true);
    expect(isSemver("1.2.3-rc.1")).toBe(true);
    expect(isSemver("1.0")).toBe(false);
    expect(isSemver("v1.0.0")).toBe(false);
    expect(isSemver("01.0.0")).toBe(false);
  });

  it("parses the repository URL", () => {
    expect(parseRepository("https://github.com/Medenor/marklet")).toEqual({
      forge: "https://github.com",
      owner: "Medenor",
      repo: "marklet",
    });
    expect(parseRepository("https://github.com/Medenor/marklet.git").repo).toBe("marklet");
    expect(() => parseRepository("git@github.com:Medenor/marklet.git")).toThrow(ReleaseError);
  });

  it("matches HTTPS and SSH remotes, rejects others", () => {
    const t = { forge: "https://github.com", owner: "Medenor", repo: "marklet" };
    expect(remoteMatches("https://github.com/Medenor/marklet.git", t)).toBe(true);
    expect(remoteMatches("git@github.com:Medenor/marklet.git", t)).toBe(true);
    expect(remoteMatches("ssh://git@github.com/Medenor/marklet.git", t)).toBe(true);
    expect(remoteMatches("https://codeberg.org/Medenor/marklet.git", t)).toBe(false);
    expect(remoteMatches("https://github.com/Someone/marklet.git", t)).toBe(false);
  });

  it("redacts credentials in URLs", () => {
    expect(redactCredentials("https://user:s3cret@github.com/a/b.git")).toBe("https://***@github.com/a/b.git");
    expect(redactCredentials("fatal: https://tok@host/x failed")).toBe("fatal: https://***@host/x failed");
    expect(redactCredentials("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
  });

  it("compares origins", () => {
    expect(sameOrigin("https://api.github.com/repos/a/b/releases/assets/1", "https://api.github.com")).toBe(true);
    expect(sameOrigin("/repos/a/b", "https://api.github.com")).toBe(true);
    expect(sameOrigin("https://evil.example/x", "https://api.github.com")).toBe(false);
    expect(sameOrigin("http://api.github.com/x", "https://api.github.com")).toBe(false);
    expect(sameOrigin("https://api.github.com.evil.example/x", "https://api.github.com")).toBe(false);
  });

  it("reads the Node major version from .nvmrc", () => {
    expect(nvmrcMajor("22\n")).toBe(22);
    expect(nvmrcMajor("v22.11.0")).toBe(22);
    expect(nvmrcMajor("lts/*")).toBeNull();
  });

  it("hashes like sha256sum", () => {
    // Hand-computed: printf 'abc' | sha256sum
    expect(sha256(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

// ---------------------------------------------------------------------------
// Fake GitHub API (api base = <origin>/api, uploads base = <origin>/uploads)

const REPO = "/api/repos/Medenor/marklet";

function fakeGitHub({ token = "secret-token", push = true, omitAssets = false } = {}) {
  const state = { releases: [], files: new Map(), requests: [] };
  let nextId = 1;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    state.requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization });
    const send = (status, json) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(json === undefined ? "" : JSON.stringify(json));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: "Bad credentials" });
    let m;
    if (req.method === "GET" && url.pathname === "/api/user") return send(200, { login: "medenor" });
    if (req.method === "GET" && url.pathname === REPO) return send(200, { permissions: { push } });
    if (req.method === "GET" && (m = /^\/api\/files\/(\d+)\/(.+)$/.exec(url.pathname))) {
      const f = state.files.get(url.pathname);
      return f ? (res.writeHead(200), res.end(f)) : send(404, {});
    }
    if (req.method === "GET" && (m = /^\/api\/repos\/Medenor\/marklet\/releases\/tags\/(.+)$/.exec(url.pathname))) {
      const rel = state.releases.find((r) => r.tag_name === decodeURIComponent(m[1]));
      return rel ? send(200, rel) : send(404, { message: "Not Found" });
    }
    if (req.method === "POST" && url.pathname === `${REPO}/releases`) {
      const opt = JSON.parse(body.toString());
      const rel = {
        ...opt,
        id: nextId++,
        assets: [],
        html_url: `https://github.com/Medenor/marklet/releases/tag/${opt.tag_name}`,
      };
      state.releases.push(rel);
      return send(201, omitAssets ? { ...rel, assets: undefined } : rel); // JSON drops undefined fields
    }
    if (
      req.method === "POST" &&
      (m = /^\/uploads\/repos\/Medenor\/marklet\/releases\/(\d+)\/assets$/.exec(url.pathname))
    ) {
      const rel = state.releases.find((r) => r.id === Number(m[1]));
      const name = url.searchParams.get("name");
      if (req.headers["content-type"] === undefined) return send(422, { message: "no content type" });
      const path = `/api/files/${rel.id}/${name}`;
      state.files.set(path, body);
      const asset = {
        id: nextId++,
        name,
        size: body.length,
        url: `${state.origin}${path}`,
        browser_download_url: `https://github.com/Medenor/marklet/releases/download/${rel.tag_name}/${name}`,
      };
      rel.assets.push(asset);
      return send(201, asset);
    }
    send(404, { message: "no route" });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      state.origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, state });
    }),
  );
}

// ---------------------------------------------------------------------------
// Throwaway repository with a bare "GitHub" remote

function sh(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeRepo(root, { version = "1.1.0", changelog = CHANGELOG, nvmrc = null } = {}) {
  // The remote path contains the forge host and owner/repo, like a real GitHub URL would.
  const remote = join(root, "github.com", "Medenor", "marklet.git");
  mkdirSync(remote, { recursive: true });
  sh(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  const work = join(root, "work");
  mkdirSync(join(work, "dist"), { recursive: true });
  sh(work, "init", "--quiet", "--initial-branch=main");
  for (const [k, v] of [
    ["user.name", "Test"],
    ["user.email", "test@example.invalid"],
    ["tag.gpgSign", "false"],
    ["commit.gpgSign", "false"],
  ])
    sh(work, "config", k, v);
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ version, repository: "https://github.com/Medenor/marklet" }),
  );
  writeFileSync(join(work, "CHANGELOG.md"), changelog);
  writeFileSync(join(work, "dist", "marklet.html"), "<!doctype html><title>Marklet</title>");
  writeFileSync(join(work, "THIRD_PARTY_LICENSES.md"), "# Licenses\n");
  if (nvmrc !== null) writeFileSync(join(work, ".nvmrc"), nvmrc);
  sh(work, "add", "-A");
  sh(work, "commit", "--quiet", "-m", "init");
  sh(work, "remote", "add", "origin", remote);
  sh(work, "push", "--quiet", "origin", "main");
  return { work, remote };
}

describe("release run", () => {
  let root, github, logs;
  const baseEnv = () => ({
    RELEASE_API_URL: `${github.state.origin}/api`,
    RELEASE_UPLOADS_URL: `${github.state.origin}/uploads`,
    HOME: root,
  });
  const opts = (work, extra = {}) => ({
    cwd: work,
    dryRun: false,
    install: null,
    checks: [],
    useGhCli: false,
    env: { ...baseEnv(), GITHUB_TOKEN: "secret-token" },
    log: (m) => logs.push(m),
    ...extra,
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "marklet-release-test-"));
    github = await fakeGitHub();
    logs = [];
  });
  afterEach(() => {
    github.server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("tags, pushes, creates the release and uploads both assets", async () => {
    const { work, remote } = makeRepo(root);
    const result = await release(opts(work));

    const head = sh(work, "rev-parse", "HEAD");
    expect(sh(remote, "rev-parse", "v1.1.0^{commit}")).toBe(head);
    expect(sh(remote, "cat-file", "-t", "v1.1.0")).toBe("tag"); // annotated

    const [rel] = github.state.releases;
    expect(rel).toMatchObject({
      tag_name: "v1.1.0",
      name: "Marklet 1.1.0",
      body: "### Added\n\n- Table of contents.",
      prerelease: false,
      draft: false,
    });
    expect(rel.assets.map((a) => a.name)).toEqual(["marklet.html", "marklet.html.sha256"]);

    const html = "<!doctype html><title>Marklet</title>";
    expect(github.state.files.get(`/api/files/${rel.id}/marklet.html`).toString()).toBe(html);
    expect(github.state.files.get(`/api/files/${rel.id}/marklet.html.sha256`).toString()).toBe(
      `${sha256(Buffer.from(html))}  marklet.html\n`,
    );
    expect(result.url).toBe("https://github.com/Medenor/marklet/releases/tag/v1.1.0");
  });

  it("sends the token only in the Authorization header", async () => {
    const { work } = makeRepo(root);
    await release(opts(work));
    for (const r of github.state.requests) {
      expect(r.auth).toBe("Bearer secret-token");
      expect(r.path).not.toContain("secret-token");
    }
    expect(logs.join("\n")).not.toContain("secret-token");
  });

  it("resumes after a partial failure without duplicating anything", async () => {
    const { work } = makeRepo(root);
    await release(opts(work));
    const [rel] = github.state.releases;
    rel.assets.pop(); // simulate the checksum upload failing last time
    await release(opts(work));
    expect(github.state.releases).toHaveLength(1);
    expect(github.state.releases[0].assets.map((a) => a.name)).toEqual(["marklet.html", "marklet.html.sha256"]);
    expect(logs.join("\n")).toMatch(/resuming/);
  });

  it("refuses to overwrite a published asset that differs", async () => {
    const { work } = makeRepo(root);
    await release(opts(work));
    const [rel] = github.state.releases;
    github.state.files.set(`/api/files/${rel.id}/marklet.html`, Buffer.from("tampered"));
    await expect(release(opts(work))).rejects.toThrow(/differs from this build/);
  });

  it("dry run publishes nothing and works without a token", async () => {
    const { work, remote } = makeRepo(root);
    const result = await release(opts(work, { dryRun: true, env: baseEnv() }));
    expect(result.dryRun).toBe(true);
    expect(github.state.releases).toHaveLength(0);
    expect(sh(remote, "tag")).toBe("");
    expect(sh(work, "tag")).toBe("");
    expect(logs.join("\n")).toContain("Table of contents.");
  });

  it.each([
    ["not on main", (w) => sh(w, "checkout", "--quiet", "-b", "feature"), /from main/],
    ["uncommitted changes", (w) => writeFileSync(join(w, "README.md"), "x"), /uncommitted/],
    ["unpushed commit", (w) => sh(w, "commit", "--quiet", "--allow-empty", "-m", "local"), /differs from origin\/main/],
    [
      "remote is not GitHub/Medenor/marklet",
      (w) => sh(w, "remote", "set-url", "origin", "https://codeberg.org/Medenor/marklet.git"),
      /points to/,
    ],
    [
      "tag already on another commit",
      (w) => {
        sh(w, "tag", "v1.1.0");
        sh(w, "commit", "--quiet", "--allow-empty", "-m", "later");
        sh(w, "push", "--quiet", "origin", "main");
      },
      /never moved/,
    ],
  ])("refuses when %s", async (_name, setup, message) => {
    const { work } = makeRepo(root);
    setup(work);
    await expect(release(opts(work))).rejects.toThrow(message);
    expect(github.state.releases).toHaveLength(0);
  });

  it("refuses without a changelog section for the version", async () => {
    const { work } = makeRepo(root, { version: "1.2.0" });
    await expect(release(opts(work))).rejects.toThrow(/## \[1\.2\.0\]/);
  });

  it("refuses an invalid token or a token without write access", async () => {
    const { work } = makeRepo(root);
    await expect(release(opts(work, { env: { ...baseEnv(), GITHUB_TOKEN: "wrong" } }))).rejects.toThrow(/401/);
    github.server.close();
    github = await fakeGitHub({ push: false });
    await expect(release(opts(work, { env: { ...baseEnv(), GITHUB_TOKEN: "secret-token" } }))).rejects.toThrow(
      /cannot write/,
    );
  });

  it("refuses a real release without any token", async () => {
    const { work } = makeRepo(root);
    await expect(release(opts(work, { env: baseEnv() }))).rejects.toThrow(/No token/);
  });

  it("never sends the token to an asset hosted outside the API", async () => {
    const leaked = [];
    const attacker = createServer((req, res) => {
      leaked.push(req.headers.authorization);
      res.end("x");
    });
    await new Promise((r) => attacker.listen(0, "127.0.0.1", r));
    try {
      const { work } = makeRepo(root);
      // A collaborator pre-created the release with an external "marklet.html" asset.
      github.state.releases.push({
        id: 99,
        tag_name: "v1.1.0",
        assets: [{ id: 1, name: "marklet.html", url: `http://localhost:${attacker.address().port}/x` }],
      });
      await expect(release(opts(work))).rejects.toThrow(/not served by/);
      expect(leaked).toEqual([]);
    } finally {
      attacker.close();
    }
  });

  it("refuses when the fresh build differs from the committed one", async () => {
    const { work } = makeRepo(root);
    const checks = [["node", "-e", "require('fs').appendFileSync('dist/marklet.html', 'x')"]];
    await expect(release(opts(work, { checks }))).rejects.toThrow(/fresh build differs/);
    expect(github.state.releases).toHaveLength(0);
  });

  it("refuses when the checks modify other files", async () => {
    const { work } = makeRepo(root);
    const checks = [["node", "-e", "require('fs').writeFileSync('stray.txt', 'x')"]];
    await expect(release(opts(work, { checks }))).rejects.toThrow(/left the working tree modified/);
  });

  it("stops on a failing or missing check command, with the reason", async () => {
    const { work } = makeRepo(root);
    await expect(release(opts(work, { checks: [["node", "-e", "process.exit(3)"]] }))).rejects.toThrow(/exit code 3/);
    await expect(release(opts(work, { install: ["marklet-no-such-command"] }))).rejects.toThrow(/could not start/);
    expect(github.state.releases).toHaveLength(0);
    expect(sh(work, "tag")).toBe("");
  });

  it("resumes from a tag that exists only on the remote", async () => {
    const { work, remote } = makeRepo(root);
    sh(work, "tag", "v1.1.0"); // lightweight
    sh(work, "push", "--quiet", "origin", "refs/tags/v1.1.0");
    sh(work, "tag", "-d", "v1.1.0");
    await release(opts(work));
    expect(logs.join("\n")).toMatch(/Fetched v1\.1\.0/);
    expect(sh(remote, "rev-parse", "v1.1.0^{commit}")).toBe(sh(work, "rev-parse", "HEAD"));
    expect(github.state.releases[0].assets).toHaveLength(2);
  });

  it("pushes a tag that exists only locally", async () => {
    const { work, remote } = makeRepo(root);
    sh(work, "tag", "v1.1.0");
    await release(opts(work));
    expect(sh(remote, "rev-parse", "v1.1.0^{commit}")).toBe(sh(work, "rev-parse", "HEAD"));
  });

  it("refuses when the remote tag is on another commit", async () => {
    const { work } = makeRepo(root);
    sh(work, "tag", "-a", "v1.1.0", "-m", "old");
    sh(work, "push", "--quiet", "origin", "refs/tags/v1.1.0");
    sh(work, "tag", "-d", "v1.1.0");
    sh(work, "commit", "--quiet", "--allow-empty", "-m", "later");
    sh(work, "push", "--quiet", "origin", "main");
    await expect(release(opts(work))).rejects.toThrow(/on origin on another commit/);
  });

  it("marks pre-release versions as pre-releases", async () => {
    const changelog = "# Changelog\n\n## [1.2.0-rc.1] - 2026-12-01\n\n- Candidate.\n";
    const { work } = makeRepo(root, { version: "1.2.0-rc.1", changelog });
    await release(opts(work));
    expect(github.state.releases[0]).toMatchObject({ tag_name: "v1.2.0-rc.1", prerelease: true });
  });

  it("copes with a release response without an assets field", async () => {
    github.server.close();
    github = await fakeGitHub({ omitAssets: true });
    const { work } = makeRepo(root);
    await release(opts(work, { env: { ...baseEnv(), GITHUB_TOKEN: "secret-token" } }));
    expect(github.state.releases[0].assets.map((a) => a.name)).toEqual(["marklet.html", "marklet.html.sha256"]);
  });

  it("refuses to build with another Node.js major version than .nvmrc", async () => {
    const other = Number(process.versions.node.split(".")[0]) + 1;
    const { work } = makeRepo(root, { nvmrc: `${other}\n` });
    await expect(release(opts(work))).rejects.toThrow(new RegExp(`pins Node ${other}`));
  });

  it("does not print credentials embedded in the remote URL", async () => {
    const { work } = makeRepo(root);
    sh(work, "remote", "set-url", "origin", "https://user:hunter2@github.com/Medenor/marklet.git");
    const error = await release(opts(work)).catch((e) => e);
    expect(error).toBeInstanceOf(ReleaseError);
    expect(error.message).not.toContain("hunter2");
  });

  it("turns git failures into readable errors", async () => {
    const { work, remote } = makeRepo(root);
    rmSync(remote, { recursive: true, force: true });
    await expect(release(opts(work))).rejects.toThrow(/git fetch failed: /);
  });
});
