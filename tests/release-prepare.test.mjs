// Tests for scripts/release-prepare.mjs: pure helpers, then whole runs in a
// throwaway git repository. Nothing here runs npm, make or GitHub.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bumpChangelog,
  bumpPackageJson,
  bumpPackageLock,
  compareVersions,
  lineDiff,
  prepareFiles,
  prepareRelease,
} from "../scripts/release-prepare.mjs";
import { ReleaseError } from "../scripts/release.mjs";

const PACKAGE_JSON = `{
  "name": "demo",
  "version": "1.1.0",
  "dependencies": {
    "left-pad": "1.1.0"
  }
}
`;

// The root entry carries the version; "other" is an unrelated package that
// happens to be at the same old version number and must not change.
const PACKAGE_LOCK = `{
  "name": "demo",
  "version": "2.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "demo",
      "version": "2.0.0",
      "license": "MIT"
    },
    "node_modules/other": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/other/-/other-2.0.0.tgz"
    }
  }
}
`;

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Table of contents.

## [1.1.0] - 2026-11-18

### Changed

- Moved to GitHub.

[Unreleased]: https://github.com/Medenor/marklet/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Medenor/marklet/releases/tag/v1.1.0
`;

describe("compareVersions", () => {
  it("orders X.Y.Z numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("1.1.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.1.1", "1.1.0")).toBe(1);
  });
});

describe("bumpPackageJson", () => {
  it("changes only the top-level version", () => {
    const out = bumpPackageJson(PACKAGE_JSON, "1.2.0");
    expect(out).toBe(PACKAGE_JSON.replace('"version": "1.1.0"', '"version": "1.2.0"'));
  });

  it("fails when there is no top-level version", () => {
    expect(() => bumpPackageJson('{"name": "demo"}\n', "1.2.0")).toThrow(ReleaseError);
  });
});

describe("bumpPackageLock", () => {
  it("sets the top-level version and the root package, and nothing else", () => {
    const out = JSON.parse(bumpPackageLock(PACKAGE_LOCK, "1.2.0"));
    expect(out.version).toBe("1.2.0");
    expect(out.packages[""].version).toBe("1.2.0");
    // The unrelated dependency keeps its version.
    expect(out.packages["node_modules/other"].version).toBe("2.0.0");
    // Only the two version lines differ.
    expect(
      bumpPackageLock(PACKAGE_LOCK, "1.2.0")
        .split("\n")
        .filter((l, i) => l !== PACKAGE_LOCK.split("\n")[i]),
    ).toHaveLength(2);
  });

  it("fails when the root package entry is missing", () => {
    const noRoot = PACKAGE_LOCK.replace('    "": {', '    "x": {');
    expect(() => bumpPackageLock(noRoot, "1.2.0")).toThrow(/packages\[""\]/);
  });
});

describe("bumpChangelog", () => {
  it("moves the Unreleased entries under the new version and keeps an empty Unreleased", () => {
    const out = bumpChangelog(CHANGELOG, "1.2.0", "2026-12-01");
    expect(out).toContain("## [Unreleased]\n\n## [1.2.0] - 2026-12-01\n\n### Added\n\n- Table of contents.");
    expect(out).toContain("## [1.2.0] - 2026-12-01\n\n### Added\n\n- Table of contents.\n\n## [1.1.0]");
  });

  it("updates the compare links", () => {
    const out = bumpChangelog(CHANGELOG, "1.2.0", "2026-12-01");
    expect(out).toContain("[Unreleased]: https://github.com/Medenor/marklet/compare/v1.2.0...HEAD");
    expect(out).toContain("[1.2.0]: https://github.com/Medenor/marklet/compare/v1.1.0...v1.2.0");
    expect(out).toContain("[1.1.0]: https://github.com/Medenor/marklet/releases/tag/v1.1.0");
  });

  it("refuses an empty Unreleased section", () => {
    const empty = CHANGELOG.replace("### Added\n\n- Table of contents.\n\n", "");
    expect(() => bumpChangelog(empty, "1.2.0", "2026-12-01")).toThrow(/is empty/);
  });

  it("refuses a version that already has a section", () => {
    expect(() => bumpChangelog(CHANGELOG, "1.1.0", "2026-12-01")).toThrow(/already has/);
  });

  it("fails when there is no Unreleased heading", () => {
    expect(() => bumpChangelog("# Changelog\n\n## [1.1.0] - 2026-11-18\n", "1.2.0", "2026-12-01")).toThrow(
      /no "## \[Unreleased\]" heading/,
    );
  });
});

describe("prepareFiles", () => {
  it("changes all three files and returns them", () => {
    const out = prepareFiles({
      packageJson: PACKAGE_JSON,
      packageLock: PACKAGE_LOCK,
      changelog: CHANGELOG,
      to: "1.2.0",
      date: "2026-12-01",
    });
    expect(Object.keys(out)).toEqual(["package.json", "package-lock.json", "CHANGELOG.md"]);
    expect(JSON.parse(out["package.json"]).version).toBe("1.2.0");
    expect(JSON.parse(out["package-lock.json"]).version).toBe("1.2.0");
    expect(out["CHANGELOG.md"]).toContain("## [1.2.0] - 2026-12-01");
  });
});

describe("lineDiff", () => {
  it("is empty when nothing changed", () => {
    expect(lineDiff("a.txt", "x\ny", "x\ny")).toBe("");
  });

  it("shows removed and added lines with context and skips the rest", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n");
    const after = ["1", "2", "3", "four", "5", "6", "7", "8", "9"].join("\n");
    expect(lineDiff("a.txt", before, after)).toBe(
      ["--- a/a.txt", "+++ b/a.txt", "...", " 2", " 3", "-4", "+four", " 5", " 6", "..."].join("\n"),
    );
  });
});

describe("prepareRelease", () => {
  let dir;
  const sh = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (name, text) => writeFileSync(join(dir, name), text);
  const read = (name) => readFileSync(join(dir, name), "utf8");
  const quiet = () => {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "marklet-prepare-"));
    sh("init", "-q", "-b", "main");
    sh("config", "user.name", "Test");
    sh("config", "user.email", "test@example.com");
    write("package.json", PACKAGE_JSON);
    write("package-lock.json", PACKAGE_LOCK);
    write("CHANGELOG.md", CHANGELOG);
    sh("add", "-A");
    sh("commit", "-q", "-m", "start");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const prepare = (over = {}) =>
    prepareRelease({ cwd: dir, to: "1.2.0", dryRun: false, date: "2026-12-01", checks: [], log: quiet, ...over });

  it("dry run prints the diff and writes nothing", () => {
    const lines = [];
    const result = prepareRelease({
      cwd: dir,
      to: "1.2.0",
      dryRun: true,
      date: "2026-12-01",
      checks: [],
      log: (m) => lines.push(m),
    });
    expect(result.applied).toBe(false);
    expect(lines.join("\n")).toContain('+  "version": "1.2.0"');
    expect(read("package.json")).toBe(PACKAGE_JSON);
    expect(sh("status", "--porcelain")).toBe("");
  });

  it("applies the bump to the files and runs the given checks", () => {
    prepare({ checks: [["true"]] });
    expect(JSON.parse(read("package.json")).version).toBe("1.2.0");
    expect(JSON.parse(read("package-lock.json")).version).toBe("1.2.0");
    expect(read("CHANGELOG.md")).toContain("## [1.2.0] - 2026-12-01");
  });

  it("keeps the bumped files when a check fails, and says so", () => {
    expect(() => prepare({ checks: [["false"]] })).toThrow(/The files were updated/);
    expect(JSON.parse(read("package.json")).version).toBe("1.2.0");
  });

  it("refuses a version that is not greater than the current one", () => {
    expect(() => prepare({ to: "1.1.0" })).toThrow(/must be greater/);
    expect(() => prepare({ to: "1.0.9" })).toThrow(/must be greater/);
  });

  it("refuses a prerelease or malformed version", () => {
    expect(() => prepare({ to: "1.2.0-rc.1" })).toThrow(/no prerelease/);
    expect(() => prepare({ to: "v1.2.0" })).toThrow(/X\.Y\.Z/);
    expect(() => prepare({ to: undefined })).toThrow(/Usage/);
  });

  it("refuses to run off main or the release branch", () => {
    sh("checkout", "-q", "-b", "feature/x");
    expect(() => prepare()).toThrow(/on main or on release\/v1\.2\.0/);
    sh("checkout", "-q", "-b", "release/v1.2.0");
    expect(() => prepare()).not.toThrow();
  });

  it("refuses a dirty working tree", () => {
    write("notes.txt", "uncommitted");
    expect(() => prepare()).toThrow(/uncommitted changes/);
  });

  it("writes nothing when the changelog is not ready", () => {
    write("CHANGELOG.md", CHANGELOG.replace("- Table of contents.", ""));
    sh("commit", "-q", "-am", "empty unreleased");
    expect(() => prepare()).toThrow(/is empty/);
    expect(read("package.json")).toBe(PACKAGE_JSON);
  });
});
