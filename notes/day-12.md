# Day 12: Services

## Commands

Baseline and rebuild
- `kubectl config current-context` (kind-lab before every apply and delete), `git status --short`, a blank-count grep over the notes (0 for day-01 to day-11)
- Day 11 workload was gone from `default`. Per user, it was cleaned up with `kubectl delete ns d11` (output not pasted).
- Rebuilt in a new namespace: `kubectl create ns d12`, `sed 's/namespace: d11/namespace: d12/' k8s/d11-web.yaml > k8s/d12-web.yaml`, `diff` (only line 5 changed), committed `8ffe0ce`, then `kubectl apply -f k8s/d12-web.yaml`
- Deployment `web`: 3 replicas, `app: web`, container `api`, image `app:1`, port 3000, no probes

Service
- `k8s/d12-svc.yaml`: ClusterIP `web`, selector `app: web`, port 80 to targetPort 3000. Committed `180b481`, then applied.
- Result: ClusterIP `10.96.45.157`, EndpointSlice `web-wwlqn` on port 3000 with the 3 Pod IPs (`10.244.1.3`, `10.244.1.2`, `10.244.3.3`), not the ClusterIP

Resolution from a client Pod
- `kubectl -n d12 run client --image=busybox:1.36 --restart=Never -- sleep 3600`
- `resolv.conf`: `search d12.svc.cluster.local svc.cluster.local cluster.local`, `nameserver 10.96.0.10`, `ndots:5`
- `wget` to `http://web/health`, `http://web.d12/health`, `http://web.d12.svc/health` and `http://web.d12.svc.cluster.local:80/health` all returned `OK`, exit 0
- `nslookup web` and `nslookup web.d12.svc.cluster.local` returned `10.96.45.157`. `nslookup web.d12` and `nslookup -type=A web.d12` returned NXDOMAIN, exit 1.

EndpointSlice tracking (`kubectl -n d12 get endpointslices -w` in a second terminal)
- `scale deploy/web --replicas=5`: slice grew 3 to 4 to 5 addresses (`10.244.3.4`, `10.244.1.5`). Each new address was `ready=true` as it appeared.
- `scale --replicas=2`: the three removed Pods flipped to `ready=false, terminating=true` and left the slice one at a time (`10.244.1.2`, then `10.244.1.3`, then `10.244.1.5`). Survivors: `10.244.3.3` and `10.244.3.4`, both on lab-worker2.
- Single Pod delete of `web-7f67796c66-9fbwl`: started 13:32:45, Pod gone by 13:33:15 (30s). At +5s the slice showed the deleted Pod (`10.244.3.4`) as `ready=false, serving=true, terminating=true`, and the replacement `10.244.1.6` as `ready=true`. Replacement `qt59h` was Running at age 5s on lab-worker.

Broken selector
- `k8s/d12-svc-broken.yaml` with `selector: {app: wbe}`, committed `ae4b26f`, applied. Restored with `kubectl apply -f k8s/d12-svc.yaml`.

Cross-namespace
- `kubectl run client-default --image=busybox:1.36 --restart=Never -- sleep 3600` in `default`

Drift revert
- `kubectl diff -f k8s/d12-web.yaml` (exit 1), `kubectl apply -f k8s/d12-web.yaml`, `kubectl diff` again (exit 0)

Cleanup
- `kubectl delete pod client-default`, `kubectl delete ns d12`. `get ns` no longer lists `d12` or `d11`. Working tree clean.

## What broke

1. At the start of the day, every kubectl call failed with `connection refused` on `127.0.0.1:57871`. A later baseline showed the cluster answering, with both CoreDNS Pods `0/1 Running` and 2 restarts, the last one 6s earlier.
2. `nslookup web.d12` returned NXDOMAIN and exit 1 from the `d12` client, while the same name worked through `wget`.
3. My Pod-delete command failed: `kubectl -n d12 delete pod $(kubectl -n d12 get pods -l app=web -o name | head -1)` returned a kubectl error, because `-o name` already returns `pod/<name>`. Nothing was deleted.
4. With `selector: {app: wbe}`, `wget http://web/health` failed with `Connection refused` on `10.96.45.157`, exit 1.
5. From the `default` namespace, `wget http://web/health` failed with `bad address 'web'`, exit 1.
6. After the Step 4 scale-down, the Deployment ran at 2/2 while `d12-web.yaml` says 3.

## Root cause

1. Not confirmed. The user didn't report what brought the API server back, and no container start times were collected. CoreDNS logs show it started while the API was unreachable ("waiting for Kubernetes API", then "starting server with unsynced Kubernetes API"), then went Ready (`condition met`, `1/1`). Both CoreDNS Pods restarting together fits a group restart of the cluster containers, which is a hypothesis only.
2. Not proven. The same name resolved through the libc resolver behind `wget` (`web.d12`, `web.d12.svc`), against the same CoreDNS, so CoreDNS is not at fault. The best fit is that busybox `nslookup` sent the literal `web.d12` and did not apply the search list. The output doesn't show the tool's internals.
3. `-o name` output carries the resource type prefix, so passing it after `delete pod` is rejected.
4. The selector matched no Pods, so the EndpointSlice was emptied in place (`PORTS <unset>`, `ENDPOINTS <unset>`, same name `web-wwlqn`, age 33m). The apply printed `service/web configured` with no error, and `describe svc web` showed `Events: <none>` and a blank `Endpoints:`. The Pods were Running throughout.
5. The `default` client's `resolv.conf` is `search default.svc.cluster.local svc.cluster.local cluster.local`, so the `d12` suffix is absent. `web.d12` and `web.d12.svc.cluster.local` both returned `OK`, exit 0.
6. The imperative `kubectl scale` changed the live object only. `kubectl diff` showed exactly two differences, `replicas: 2` to `3` and `generation: 3` to `4`.

## Fix

1. No fix applied. Left as cause unconfirmed. Node `lab-control-plane` `172.19.0.4`, `lab-worker` `172.19.0.2` and `lab-worker2` `172.19.0.3` were all Ready on v1.37.0 for the rest of the day.
2. Used `wget` as the resolution test. Treat busybox `nslookup` results for dotted short names as unreliable.
3. Used a jsonpath name instead: `P=$(kubectl -n d12 get pods -l app=web -o jsonpath='{.items[0].metadata.name}')` then `kubectl -n d12 delete pod $P`.
4. `kubectl apply -f k8s/d12-svc.yaml`. The slice returned to port 3000 with `10.244.3.3,10.244.1.6`, and `wget http://web/health` returned `OK`, exit 0.
5. Use `<svc>.<ns>` for cross-namespace calls.
6. `kubectl apply -f k8s/d12-web.yaml` restored 3 replicas. `rollout status` reported success and the second `kubectl diff` exited 0.

## Findings

- The EndpointSlice carries the target port (3000) and Pod IPs, not the Service port or the ClusterIP.
- Without probes, a new Pod is `ready=true` the moment it appears in the slice.
- A terminating Pod goes `ready=false` and stops receiving Service traffic while `get pods` still shows `1/1 Terminating`.
- The 30s from delete to gone fits the Day 7 SIGTERM finding (Node as PID 1, no handler). That link is an inference. Exit code 137 was not observed today.
- An empty slice gives `Connection refused` on the ClusterIP with DNS resolving. A wrong namespace gives `bad address`, so DNS fails first. The two error strings point to different layers.
- The scale-down removed the three Pods on lab-worker. Both survivors were on lab-worker2. The scheduler did not rebalance when it created the third Pod on revert (2 on lab-worker2, 1 on lab-worker). This is the Day 19 topology spread problem.

## Not observed

- What caused the initial `connection refused`, and what brought the API server back. No `docker inspect` or `crictl` evidence was collected.
- Why the `kubernetes` EndpointSlice listed `172.19.0.3` and `172.19.0.4` on a single-control-plane cluster. `172.19.0.3` is `lab-worker2`. It was read once and not re-read.
- The `d11` deletion output. Only the later absence of `d11` from `get ns` is observed.
- The `rollout status` duration for the first rollout and for the revert, and the Step 1 `kubectl config current-context` line.
- Which Pod answered any request. The response body is only `OK`.
- The `serving` condition during the scale-down stream, and the `-w` stream for the single Pod delete, the selector break, the restore and the revert.
- Exit code 137 on the terminating Pod.
- Why `nslookup web` exited 1 after printing an address.
- Whether `kubectl delete ns d12` took longer than the 30s termination wait. It was not timed.
- The `app:1` image on workers via `crictl images`. Pod events said it was already present on the machine.
