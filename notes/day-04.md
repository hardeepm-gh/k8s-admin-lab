cd ~/Documents/k8s-admin-lab
cat > notes/day-04.md <<'EOF'
# Day 4: Private registry

## Commands
- docker rm -f app db, then docker network rm backend
- docker run -d -p 5001:5000 --name registry registry:2
- docker tag app:1 localhost:5001/app:1
- docker push localhost:5001/app:1
- curl localhost:5001/v2/_catalog
- docker rmi app:1 localhost:5001/app:1
- docker run --rm -d -p 3001:3000 --name fromreg localhost:5001/app:1
- curl -i localhost:3001/health
- docker rm -f fromreg registry, then docker build -t app:1 app/

## What broke
- None

## Root cause
- 

## Fix
- 

## Result
- Catalog output: FILL IN (expected {"repositories":["app"]})
- Image source on the final run: FILL IN (expected a pull from localhost:5001)
- /health from the registry-run container: FILL IN (expected 200 OK)

## What I learned
- A registry stores images. The tag prefix (localhost:5001/app:1) tells Docker where to push and pull.
- Deleting the local image first proved the container really came from the registry.
- This registry has no TLS and no login. Docker allows plain HTTP only for localhost. A real registry needs HTTPS, authentication and access control.
- I used host port 5001 because macOS often holds 5000. The
