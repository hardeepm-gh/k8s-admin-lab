# Day 7: Self-healing and desired state

## Commands
Setup:
- `kind create cluster --name lab --config kind-config.yaml` (v1.37.0, 3 nodes)
- `kind load docker-image app:1 --name lab`
- `kubectl create ns d7`, `kubectl apply -f k8s/d7-selfheal.yaml` (Deployment `api`, 3 replicas)

A. Delete a Pod: `kubectl delete pod -n d7 <pod>`, then events and `custom-columns` for UID and node.
B. Kill the container: `docker exec <node> crictl stop <containerID>` (ID from `.status.containerStatuses[0].containerID`).
C. `kubectl delete rs -n d7 -l app=api`, `kubectl scale deploy api --replicas=5`, `kubectl apply -f k8s/d7-selfheal.yaml`.
D. `docker stop lab-worker`, timed 10s polling loop for node status and Pod status, `docker start lab-worker`.

## What broke
- Kind cluster `lab` was gone (`kind get clusters` listed only `aiops-m5`). Recreated from `kind-config.yaml`.
- Typo: `--name lab.` (trailing period) gave `no nodes found for cluster "lab."`.
- zsh treated inline `#` comments as arguments (`pods "#" not found`).
- B: first `$CID` was empty (label filter matched nothing). Loop iterations 1-3 were no-ops because the container was already dead and waiting out the restart delay.
- D, first run: node was down under 300s, so no eviction happened, and the namespace was deleted before the evidence was captured.
- D, second run: I stopped the worker holding 1 Pod, not 2. Result was one eviction instead of two.

## Root cause
- Cluster loss: Docker reset or prune removed the node containers. Kind clusters do not survive that reliably.
- App ignores SIGTERM: Node runs as PID 1 with no signal handler. Pods sat in `Terminating` for the full 30s grace period, then were SIGKILLed (exit code 137). Seen in A, B and C.
- 300s eviction delay: admission injects `not-ready` and `unreachable` tolerations with `tolerationSeconds: 300`. The clock starts when the taint is applied (~50s), not at `docker stop`.

## Fix / Result

| Failure | Actor | Evidence |
|---|---|---|
| Delete Pod | ReplicaSet controller | `SuccessfulCreate` from `replicaset-controller`, new name and UID, replacement Running ~1s after delete |
| Kill container | kubelet | Same Pod UID, RESTARTS 0 to 1, `BackOff` from kubelet, no new `SuccessfulCreate` |
| Delete RS / scale drift | Deployment controller | New RS with the same name (`api-66b496d888`, hash of unchanged template); `apply` reverted 5 back to 3 |
| Lose node | Node lifecycle controller (taints), `taint-eviction-controller`, `replicaset-controller`, `default-scheduler` | NotReady ~50s, evicted ~350s from `docker stop`, replacement Running 1s after eviction |

Timings (D): NotReady ~50s (10s sampling), eviction ~350s, replacement Running ~1s later (image already loaded on every node).

Prediction misses:
- READY stayed `1/1` for the full 300s on the dead node.
- `CrashLoopBackOff` never appeared in B, only `Error` with a ~10s delay.
- `crictl stop` gave exit 137, not a different code (SIGTERM ignored, then SIGKILL).

Placement: all 3 replicas ended on `lab-worker2`. Nothing rebalanced when `lab-worker` returned. Self-healing restores the count, not the spread (Day 14: topology spread).

End state: 3 nodes Ready, taints cleared, stale Pod `zptn4` removed after the kubelet reconnected.

## Gotchas
- Fix SIGTERM handling (handler or `tini`) on Day 20, zero-downtime rollout. Until then rollouts and scale-downs wait 30s per Pod.
- `kubectl get pods` looks healthy during the 300s window of a dead node. Check `kubectl get nodes` first.
- Production: tune `tolerationSeconds` per workload for stateless services.
- Read `-o wide` before choosing which node to stop.
- `setopt interactive_comments` in `~/.zshrc` so pasted `#` comments work.
- Check `kubectl config current-context` before any delete (3 contexts on this machine).
- `aiops-m5` kind cluster is stopped (`docker stop`) to free RAM. Restart with `docker start $(docker ps -aq --filter "name=aiops-m5")`.
