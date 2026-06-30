.PHONY: up up-build down clean smoke build check

check: ## Verify required tools are available before starting
	@command -v docker   >/dev/null 2>&1 || { echo "ERROR: docker not found — install Docker Desktop (https://docs.docker.com/get-docker/)"; exit 1; }
	@docker info         >/dev/null 2>&1 || { echo "ERROR: Docker daemon is not running — start Docker Desktop first"; exit 1; }
	@command -v python3  >/dev/null 2>&1 || { echo "ERROR: python3 not found — install Python 3.8+ and ensure it is on PATH as 'python3'"; exit 1; }
	@python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,8) else 1)" || { echo "ERROR: python3 is too old — need 3.8+, got $$(python3 --version)"; exit 1; }
	@echo "✓ docker"
	@echo "✓ python3 ($$(python3 --version))"
	@echo "All prerequisites met."

up: check ## Start the platform and wait for healthy (data volumes preserved)
	./scripts/platform-up.sh

up-build: check ## Rebuild all images then start
	./scripts/platform-up.sh --build

down: ## Stop the platform (data volumes preserved)
	./scripts/platform-down.sh

clean: ## Stop + delete all volumes (full reset to blank state)
	./scripts/platform-down.sh --clean

smoke: ## Run the unified-stack smoke test (requires platform to be up)
	./scripts/smoke-unified-stack.sh

build: ## Build all Docker images without starting
	docker compose build
