.PHONY: up down smoke

up: ## Bring up the unified stack
	docker compose up -d --wait

down: ## Tear down the unified stack + volumes
	docker compose down -v

smoke: ## Run the unified-stack smoke test
	./scripts/smoke-unified-stack.sh
