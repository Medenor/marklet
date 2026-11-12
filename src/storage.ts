// localStorage wrapper that never throws: storage can be disabled by policy,
// full, or unavailable in private windows. Everything stays in this browser.

const PREFIX = "marklet:";

export function load(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/** Returns false when the value could not be stored. */
export function save(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

export function remove(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Last session of the original marqdown (v1), offered once for migration. */
export function legacySession(): string | null {
  try {
    return window.localStorage.getItem("marqdown.lastSession");
  } catch {
    return null;
  }
}
