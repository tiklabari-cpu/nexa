SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose
PSQL := $(COMPOSE) exec -T db psql -U nexa -d nexa

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
