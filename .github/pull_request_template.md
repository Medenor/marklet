## Scope

<!-- What changed and why. Link the issue. -->

Closes #

## Contract impact

<!-- Changes to file formats, keyboard shortcuts, browser-storage keys, export output or the CSP, and who is affected. "None" if none. -->

## Size and security impact

<!-- Size of dist/marklet.html before → after. New runtime dependencies and their license. Any change to sanitising or the CSP. "None" if none. -->

## Verification evidence

<!-- Tests added/changed, commands run and results, screenshots for UI changes. -->

- [ ] `make check` passes (format, lint, typecheck, unit tests, browser tests, committed build up to date)
- [ ] `make build` run and `dist/` + `THIRD_PARTY_LICENSES.md` committed
- [ ] Manual check in Chrome or Edge (and Firefox if file handling changed)

## Documentation

- [ ] README updated / [ ] n/a
- [ ] In-app help dialog (`index.html`) updated / [ ] n/a
- [ ] CHANGELOG `[Unreleased]` updated / [ ] n/a

## Review

- [ ] `/code-review` run, findings triaged
- [ ] `/security-review` run (if rendering, sanitising, file handling, storage or the CSP were touched)
