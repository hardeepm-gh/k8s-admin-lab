cd ~/Documents/k8s-admin-lab
cat > notes/day-03.md <<'EOF'
# Day 3: Private network, no published DB port

## Commands
- docker compose down
- docker network create backend
- docker run -d --name db --network backend -e POSTGRES_PASSWORD=pw postgres:16
- docker run -d --name app --network backend -p 3000:3000 -e DATABASE_URL=postgres://postgres:pw@db:5432/postgres app:1
- curl localhost:3000/db
- docker exec app getent hosts db
- nc -zv localhost 5432
- docker network inspect backend
- docker rm -f app db, then docker network rm backend

## What broke
- Nothing

## Root cause
- N/A

## Fix
- N/A

## Result
- curl /db returned: FILL IN (expected a count of 1)
- Name lookup for db from the app container: FILL IN (expected the private IP)
- nc to localhost:5432 from the Mac: FILL IN (expected connection refused)

## What I learned
- Containers on the same user-defined network find each other by name. The host cannot reach a container whose port is not published.
- Only the app publishes a port, so the database has no way in from outside.
- This is the same model as a Kubernetes ClusterIP Service: a stable name, reachable only inside the cluster unless you deliberately expose it.
EOF
code notes/day-03.md