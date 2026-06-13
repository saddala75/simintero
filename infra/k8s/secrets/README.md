# Simintero Kubernetes Secrets

Secrets are NEVER committed to git. Create them manually before deploying:

## Required secrets

### sim-db — PostgreSQL connection strings

```bash
kubectl create secret generic sim-db \
  --from-literal=DATABASE_URL="postgres://sim:$(openssl rand -hex 20)@postgres.simintero.svc.cluster.local:5432/simintero" \
  --namespace simintero
```

### sim-jwt-secret — JWT signing key for Keycloak tokens

```bash
kubectl create secret generic sim-jwt-secret \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --namespace simintero
```

### sim-fax-provider — Fax API credentials (for enstellar-comms)

```bash
kubectl create secret generic sim-fax-provider \
  --from-literal=FAX_API_KEY="<get from 1Password: Simintero/Fax Provider API Key>" \
  --namespace simintero
```

## Production: External Secrets Operator

In production, do NOT run the kubectl commands above. Instead, deploy the External Secrets Operator
and create an ExternalSecret CR pointing to AWS Secrets Manager.

The secret names in AWS Secrets Manager must match:
- `simintero/prod/db-url` → DATABASE_URL
- `simintero/prod/jwt-secret` → JWT_SECRET
- `simintero/prod/fax-api-key` → FAX_API_KEY
