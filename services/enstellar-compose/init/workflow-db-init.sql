-- Creates additional databases in the workflow-db PostgreSQL instance.
-- Runs automatically on first container start (docker-entrypoint-initdb.d).

CREATE DATABASE keycloak;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO workflow;
