SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose
PSQL := $(COMPOSE) exec -T db psql -U nexa -d nexa

# The full containerised stack (`make demo`) — a separate compose file AND a
# separate compose project, so it can be up at the same time as the dev
# datastores above without either one owning the other's containers or volumes.
COMPOSE_DEMO := docker compose -f docker-compose.full.yml

# Export .env to every recipe, so `make dev` / `make test` need no `source .env`
# and Turbo can forward the variables it declares in globalEnv.
ifneq (,$(wildcard .env))
include .env
export
endif

.PHONY: help
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: env
env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "created .env")

.PHONY: install
install: ## Install workspace dependencies
	pnpm install --frozen-lockfile || pnpm install

.PHONY: up
up: env ## Start Postgres + Redis and wait for health
	$(COMPOSE) up -d
	@echo "waiting for datastores..."
	@for i in $$(seq 1 60); do \
		db=$$($(COMPOSE) ps --format json db 2>/dev/null | grep -c '"Health":"healthy"' || true); \
		rd=$$($(COMPOSE) ps --format json redis 2>/dev/null | grep -c '"Health":"healthy"' || true); \
		if [ "$$db" -ge 1 ] && [ "$$rd" -ge 1 ]; then echo "datastores healthy"; exit 0; fi; \
		sleep 1; \
	done; \
	echo "datastores did not become healthy in time"; $(COMPOSE) ps; exit 1

.PHONY: down
down: ## Stop containers (data volumes are kept)
	$(COMPOSE) down

.PHONY: clean
clean: ## Stop containers AND drop data volumes
	$(COMPOSE) down -v

.PHONY: psql
psql: ## Open a psql shell inside the db container
	$(COMPOSE) exec db psql -U nexa -d nexa

.PHONY: db-extensions
db-extensions: ## (Re)apply extensions + app role
	$(PSQL) -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/00-extensions.sql

.PHONY: migrate
migrate: ## Apply database migrations
	pnpm db:migrate

.PHONY: seed
seed: ## Load demo seed data
	pnpm db:seed

.PHONY: dev
dev: install up migrate seed ## One command: datastores + migrations + seed + all apps
	pnpm dev

.PHONY: build
build: ## Build every workspace package
	pnpm build

.PHONY: typecheck
typecheck: ## Type-check every workspace package
	pnpm typecheck

.PHONY: lint
lint: ## Lint every workspace package
	pnpm lint

.PHONY: test
test: ## Run unit + integration tests
	pnpm test

.PHONY: test-e2e
test-e2e: ## Run Playwright end-to-end tests
	pnpm test:e2e

.PHONY: verify
verify: typecheck lint test ## Everything CI runs

# --- Load / capacity (k6 — not in CI, not a Node package: apps/load/README.md) ---

.PHONY: load
load: ## Run the k6 load harness against an ALREADY-RUNNING stack (see apps/load/README.md)
	cd apps/load && K6_VERSION="$$(k6 version)" k6 run scenarios/smoke.js

.PHONY: load-rest
load-rest: ## REST mix (list+transcript+send) → NFR-P2; raise RATE_LIMIT_AGENT_PER_MIN first (see apps/load/README.md)
	cd apps/load && K6_VERSION="$$(k6 version)" k6 run scenarios/rest.js

# --- Containerised stack (local only — no deploy, no TLS, no real secrets) ---

.PHONY: demo
demo: ## Build + run the whole product in containers, then smoke-test it
	$(COMPOSE_DEMO) up --build -d
	./scripts/smoke.sh

.PHONY: smoke
smoke: ## Smoke-test an already-running container stack
	./scripts/smoke.sh

.PHONY: demo-down
demo-down: ## Stop the container stack (its data volumes are kept)
	$(COMPOSE_DEMO) down

.PHONY: demo-clean
demo-clean: ## Stop the container stack AND drop its data volumes
	$(COMPOSE_DEMO) down -v

.PHONY: demo-logs
demo-logs: ## Follow the container stack's logs
	$(COMPOSE_DEMO) logs -f
