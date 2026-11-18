// Tests for scripts/audit.mjs: which npm audit findings fail `make security`.

import { describe, it, expect } from "vitest";
import { evaluateAudit, EXCEPTIONS } from "../scripts/audit.mjs";

const picomatchAdvisory = {
  source: 1247710,
  name: "picomatch",
  title: "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  severity: "high",
  range: "<=4.0.7",
};

const report = (vulnerabilities) => ({ vulnerabilities });

describe("audit evaluation", () => {
  it("accepts the picomatch exception before its review date", () => {
    const r = evaluateAudit(
      report({
        picomatch: { name: "picomatch", severity: "high", via: [picomatchAdvisory] },
        vite: { name: "vite", severity: "high", via: ["picomatch"] },
      }),
      { today: "2026-11-18" },
    );
    expect(r.failures).toEqual([]);
    expect(r.accepted).toEqual(["GHSA-fc5q-39xc-vjpf (picomatch), review by 2027-02-18"]);
  });

  it("fails again once the exception has expired", () => {
    const r = evaluateAudit(report({ picomatch: { name: "picomatch", severity: "high", via: [picomatchAdvisory] } }), {
      today: "2027-02-19",
    });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/expired on 2027-02-18/);
  });

  it("fails on a high advisory that has no exception", () => {
    const other = { ...picomatchAdvisory, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", title: "other" };
    const r = evaluateAudit(report({ foo: { name: "foo", severity: "high", via: [other] } }), {
      today: "2026-11-18",
    });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/GHSA-aaaa-bbbb-cccc|other/);
  });

  it("does not accept the exception for a different package", () => {
    const spoofed = { ...picomatchAdvisory, name: "tinyglobby" };
    const r = evaluateAudit(report({ tinyglobby: { name: "tinyglobby", severity: "high", via: [spoofed] } }), {
      today: "2026-11-18",
    });
    expect(r.failures).toHaveLength(1);
  });

  it("ignores moderate and low advisories", () => {
    const r = evaluateAudit(
      report({ foo: { name: "foo", severity: "moderate", via: [{ ...picomatchAdvisory, severity: "moderate" }] } }),
      { today: "2026-11-18" },
    );
    expect(r.failures).toEqual([]);
  });

  it("ships the picomatch exception with a reason and a review date", () => {
    const e = EXCEPTIONS.find((x) => x.id === "GHSA-fc5q-39xc-vjpf");
    expect(e.package).toBe("picomatch");
    expect(e.reason.length).toBeGreaterThan(40);
    expect(e.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
