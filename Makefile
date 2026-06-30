.PHONY: up up-build down clean smoke build

up: ## Start the platform and wait for healthy (data volumes preserved)
	./scripts/platform-up.sh

up-build: ## Rebuild all images then start
	./scripts/platform-up.sh --build

down: ## Stop the platform (data volumes preserved)
	./scripts/platform-down.sh

clean: ## Stop + delete all volumes (full reset to blank state)
	./scripts/platform-down.sh --clean

smoke: ## Run the unified-stack smoke test (requires platform to be up)
	./scripts/smoke-unified-stack.sh

build: ## Build all Docker images without starting
	docker compose build
