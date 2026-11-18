#!/usr/bin/env node
// High-severity dependency audit for `make security`, with documented exceptions.
//
// `npm audit` has no way to ignore one advisory, so this script reads its JSON
// output and fails on any high or critical advisory that is not listed in
// EXCEPTIONS below. An exception is only accepted until its review date: after
// that the audit fails again, so it cannot be forgotten.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Advisories accepted for build and test tooling only (never shipped in
 * dist/marklet.html). Each needs a reason and a review date (YYYY-MM-DD).
 */
export const EXCEPTIONS = [
  {
    id: "GHSA-fc5q-39xc-vjpf",
    package: "picomatch",
    reason:
      "ReDoS in picomatch, reached through vite, vitest and tinyglobby. No patched version exists (4.0.7 is the latest release). The glob pattern comes from our own tooling config, not from a third party. Not in dist/marklet.html.",
    until: "2027-02-18",
  },
];

const SEVERE = new Set(["high", "critical"]);

/**
 * @param {object} report   parsed `npm audit --json` output
 * @param {object} [o]
 * @param {Array} [o.exceptions]
 * @param {string} [o.today]  YYYY-MM-DD, injectable for tests
 * @returns {{ failures: string[], accepted: string[] }}
 */
export function evaluateAudit(report, { exceptions = EXCEPTIONS, today = new Date().toISOString().slice(0, 10) } = {}) {
  const failures = [];
  const accepted = [];
  const vulns = report.vulnerabilities ?? {};

  for (const [name, vuln] of Object.entries(vulns)) {
    if (!SEVERE.has(vuln.severity)) continue;
    // Entries whose "via" lists only package names are transitive: the advisory
    // that causes them is reported on its own entry.
    const advisories = (vuln.via ?? []).filter((v) => typeof v === "object");
    for (const adv of advisories) {
      const id = /GHSA-[a-z0-9-]+/i.exec(adv.url ?? "")?.[0] ?? null;
      const exception = id ? exceptions.find((e) => e.id === id && e.package === adv.name) : null;
      if (!exception) {
        failures.push(`${adv.name ?? name}: ${adv.title ?? "advisory"} (${adv.url ?? "no url"}) [${adv.severity}]`);
      } else if (today > exception.until) {
        failures.push(
          `${adv.name}: exception ${exception.id} expired on ${exception.until}. Re-check for a fix and review it.`,
        );
      } else {
        accepted.push(`${exception.id} (${adv.name}), review by ${exception.until}`);
      }
    }
  }
  return { failures: [...new Set(failures)], accepted: [...new Set(accepted)] };
}

// ---------------------------------------------------------------------------
// CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // npm audit exits non-zero when it finds anything: read its JSON either way.
  const r = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error || !r.stdout) {
    process.stderr.write(`npm audit did not produce a report: ${r.error?.message ?? r.stderr}\n`);
    process.exit(1);
  }
  const { failures, accepted } = evaluateAudit(JSON.parse(r.stdout));
  for (const a of accepted) process.stdout.write(`  accepted exception: ${a}\n`);
  if (failures.length) {
    process.stderr.write("High or critical advisories without an accepted exception:\n");
    for (const f of failures) process.stderr.write(`  - ${f}\n`);
    process.exit(1);
  }
  process.stdout.write("No unaccepted high or critical advisory.\n");
}
