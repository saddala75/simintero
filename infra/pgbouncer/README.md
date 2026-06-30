# PgBouncer Configuration

This directory contains PgBouncer configuration for the Simintero monorepo.

## Production Setup

Use `pgbouncer.ini` and `userlist.txt` for production deployments.

- **pgbouncer.ini**: Main config with `auth_type = scram-sha-256`
- **userlist.txt**: Placeholder SCRAM-SHA-256 hashes (must be populated at deploy time)

### Generating SCRAM-SHA-256 Hashes

Before deploying to production, replace placeholder hashes in `userlist.txt` with real SCRAM-SHA-256 hashes generated from PostgreSQL.

**Method 1: Using psql \password**
```bash
psql -h postgres-host -U postgres -d postgres
\password sim_app
SELECT rolname, rolpassword FROM pg_authid WHERE rolname='sim_app';
# Copy the SCRAM-SHA-256$... value to userlist.txt
```

**Method 2: Direct SQL query**
```bash
psql -h postgres-host -U postgres -d postgres -c \
  "SELECT concat(rolname, ' \"', rolpassword, '\"') FROM pg_authid WHERE rolname IN ('sim', 'sim_app', 'sim_relay', 'workflow', 'keycloak', 'hapi');"
```

Then paste the output into `userlist.txt`.

## Development Setup

For local development with docker-compose, use the dev configs with plaintext passwords.

### Using Docker Compose

Run the full stack with dev auth config:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This mounts:
- **pgbouncer.dev.ini**: Config with `auth_type = md5`
- **userlist.dev.txt**: Plaintext passwords for convenience

### Alternative: Manual Override

If you prefer to use docker-compose.override.yml:
```yaml
services:
  pgbouncer:
    volumes:
      - ./infra/pgbouncer/pgbouncer.dev.ini:/etc/pgbouncer/pgbouncer.ini:ro
      - ./infra/pgbouncer/userlist.dev.txt:/etc/pgbouncer/userlist.txt:ro
```

## Files

- `pgbouncer.ini` - Production config (scram-sha-256)
- `userlist.txt` - Production userlist with placeholder SCRAM-SHA-256 hashes
- `pgbouncer.dev.ini` - Development config (md5)
- `userlist.dev.txt` - Development userlist with plaintext passwords
