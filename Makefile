# Marklet command surface. Run `make` to list targets.
# Recipes need a POSIX shell: macOS/Linux terminal, WSL, or Git Bash on Windows.
# Ports: block 7880–7889 (x3 = Vite dev server). Override: FRONTEND_PORT=<port> make dev

.DEFAULT_GOAL := help
.PHONY: help setup check-ports dev build test test-e2e lint lint-fix security outdated check-dist check release release-dry-run release-prepare release-prepare-dry-run

FRONTEND_PORT ?= 7883

# Builds and releases must use the Node.js major in .nvmrc (22) so the output is reproducible.
# If Homebrew's node@22 is installed and not already first on PATH, put it first for those targets.
NODE22_BIN := $(shell brew --prefix node@22 2>/dev/null)/bin
NODE22_PATH = $(if $(wildcard $(NODE22_BIN)/node),$(NODE22_BIN):$(PATH),$(PATH))
# Absolute path: a PATH lookup under make picked up another Node (26) in testing.
NODE22_EXE = $(if $(wildcard $(NODE22_BIN)/node),$(NODE22_BIN)/node,node)

help: ## List targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Install dependencies (exact versions from package-lock.json)
	@node -e 'process.exit(+process.versions.node.split(".")[0] < 20 ? 1 : 0)' || (echo "ERROR: Node.js 20 or newer is required." && exit 1)
	npm ci
	@echo "✓ Done. Run: make dev"

check-ports: ## Fail fast if the dev server port is busy
	@_busy=0; \
	if command -v lsof >/dev/null 2>&1; then \
		lsof -i :$(FRONTEND_PORT) -sTCP:LISTEN >/dev/null 2>&1 && _busy=1; \
	elif command -v netstat >/dev/null 2>&1; then \
		netstat -an 2>/dev/null | grep -E "[:.]$(FRONTEND_PORT)[[:space:]].*LISTEN" >/dev/null && _busy=1; \
	fi; \
	if [ "$$_busy" -eq 1 ]; then \
		echo "ERROR: port $(FRONTEND_PORT) is already in use. Stop the other process or run: FRONTEND_PORT=<port> make dev"; \
		exit 1; \
	fi

dev: check-ports ## Dev server with hot reload (no CSP in dev mode)
	VITE_PORT=$(FRONTEND_PORT) npm run dev

build: ## Build dist/marklet.html and THIRD_PARTY_LICENSES.md
	npm run build

test: ## Unit tests (Vitest)
	npm test

test-e2e: build ## Browser tests against the built file (needs: npx playwright install chromium)
	npm run test:e2e

lint: ## Format check, lint, typecheck
	npm run format:check
	npm run lint
	npm run typecheck

lint-fix: ## Auto-fix formatting and lint
	npm run format
	npm run lint -- --fix

security: ## Dependency audit: any advisory in code shipped in marklet.html, high+ in build/test tooling (exceptions: scripts/audit.mjs)
	npm audit --omit=dev --audit-level=low
	node scripts/audit.mjs

outdated: ## List dependencies with newer versions (review monthly and before each release)
	@npm outdated || true

check-dist: ## Fail if the rebuilt dist/ or THIRD_PARTY_LICENSES.md differ from the committed files
	@git diff --quiet -- dist THIRD_PARTY_LICENSES.md || { \
		echo "ERROR: the rebuilt dist/marklet.html or THIRD_PARTY_LICENSES.md differs from the committed version."; \
		echo "Commit the rebuilt files with your source change. Build with the Node.js version in .nvmrc."; \
		exit 1; }

check: lint test test-e2e check-dist ## All checks: run before every PR (make release runs them too)

release-dry-run: export PATH := $(NODE22_PATH)
release-dry-run: ## Run every release check and show what would be published, publish nothing
	$(NODE22_EXE) scripts/release.mjs --dry-run

release-prepare-dry-run: export PATH := $(NODE22_PATH)
release-prepare-dry-run: ## Show the version bump and changelog move for VERSION=X.Y.Z, write nothing
	$(NODE22_EXE) scripts/release-prepare.mjs --version "$(VERSION)" --dry-run

release-prepare: export PATH := $(NODE22_PATH)
release-prepare: ## Bump package.json, package-lock.json and CHANGELOG.md to VERSION=X.Y.Z, then build and test
	$(NODE22_EXE) scripts/release-prepare.mjs --version "$(VERSION)"

release: export PATH := $(NODE22_PATH)
release: ## Publish dist/marklet.html as a GitHub release (maintainer only, see README)
	$(NODE22_EXE) scripts/release.mjs
