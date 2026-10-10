# Day 2: Compose with Postgres and a volume

## Commands
- docker compose config
- docker rm -f app
- docker compose up -d --build
- docker compose ps
- curl localhost:3000/db (three times)
- docker compose down, then up -d, then curl localhost:3000/db
- docker compose down -v, then up -d, then curl localhost:3000/db

## What broke
- docker compose config failed with: did not find expected '-' indicator at L11.
- The result: Compose refused to load the file.

## Root cause
- healthcheck was indented under the volumes list instead of sitting level with volumes.
- The top-level volumes: block was indented, so it was read as a service.
- The service used db_data but the declaration said pg_data.
- Also changed: removed the published 5432 port (the app reaches the DB by name), moved postgres:13 to postgres:16, and moved the password out of the file into .env.

## Fix
- Re-indented healthcheck, moved volumes: to the left edge, matched the volume names, and used ${DB_PASSWORD} from the gitignored .env.
- docker compose config now prints the resolved file with no error.

## Result
- Count after three calls: 3
- Count after down then up: 4
- Count after down -v then up: 1

## What I learned
- down removes the containers but keeps the named volume. down -v also deletes the volume, so the data is gone.
- depends_on with service_healthy holds the app back until Postgres passes its health check.
- The password lives in .env, which is gitignored. On Day 13 it becomes a Kubernetes Secret.
