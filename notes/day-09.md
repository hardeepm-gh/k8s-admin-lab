# Day 9: Scheduling you can predict

## Commands
Setup: `kubectl create ns d9`, `kubectl get node lab-worker -o jsonpath='{.status.allocatable.cpu}'` (15)
1. `kubectl apply -f k8s/d9-base.yaml` (4 replicas, 100m CPU each), `kubectl get pods -n d9 -o wide`
2. `kubectl label node lab-worker disk=ssd`, patch `nodeSelector` to `disk: ssd`, then `disk: nvme`; `kubectl get events -n d9 --field-selector reason=FailedScheduling`
3. `kubectl delete deploy base`, `kubectl taint node lab-worker2 dedicated=db:NoSchedule`, re-apply `k8s/d9-base.yaml`, then patch in a matching toleration
4. `kubectl taint node lab-worker2 dedicated=db:NoSchedule-`, `kubectl create deploy big --replicas=3`, `kubectl set resources deploy big --requests=cpu=9000m` (60% of 15 cores)
5. `kubectl apply -f k8s/d9-nodename.yaml` (Pod with `nodeName: lab-worker2`)
Cleanup: `kubectl delete ns d9`, `kubectl label node lab-worker disk-`

## What broke
- Step 2b (intended): with `nodeSelector disk=nvme` no node matched. New Pods stayed Pending while old `ssd` Pods kept serving.
- Step 4 (intended): third `big` Pod stayed Pending (`Insufficient cpu`).
- Not a fault: step 2a was interrupted. I patched to `nvme` about 10s into the `ssd` rollout.

## Root cause
- 2b: no worker carried `disk=nvme`, and the control plane has a `NoSchedule` taint. The Deployment could not remove old Pods because `maxUnavailable` held the rollout.
- 4: two Pods requesting 9000m fit (one per worker, 15 cores each). A second on the same node needs 18 cores. The scheduler sums requests against allocatable, so idle Pods still block placement.

## Fix
- 2b: not fixed. The next step deleted the Deployment.
- 4: not fixed. This was the demonstration. Lowering the request or adding capacity would clear it.

## Results by step
| Step | Actual | Why |
|---|---|---|
| 1. 4 replicas, no constraints | 2 on lab-worker, 2 on lab-worker2 | Each placement raises that node's allocation, so scoring favors the other node. Not strictly deterministic (Day 7 gave 2/1 on a tie). |
| 2a. nodeSelector `disk=ssd` | All 3 new Pods on lab-worker (confirmed from the Terminating list) | Filter keeps only labeled nodes. |
| 2b. nodeSelector `disk=nvme` | 2 new Pods Pending | `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 node(s) didn't match Pod's node affinity/selector. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.` |
| 3a. taint on lab-worker2, no toleration | All 4 on lab-worker | Taint filter removed lab-worker2 from candidates. |
| 3b. add toleration | 2 on lab-worker, 2 on lab-worker2 (from the Terminating list; rollout status not captured) | Toleration permits lab-worker2. Scoring then balanced onto the emptier node. |
| 4. 3 replicas at 9000m | 2 Running (one per worker), 1 Pending, old zero-request Pod kept Running | `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient cpu. preemption: 0/3 nodes are available: 1 Preemption is not helpful for scheduling, 2 No preemption victims found for incoming pod.` |
| 5. `nodeName` Pod | NODE was lab-worker2 at creation (0s). No events yet at that instant. | Absence of a `Scheduled` event NOT confirmed. Events query ran before the kubelet events existed. |

Predictions were not recorded before each step, so there is no predicted-vs-actual column.

## Findings
- Allocatable CPU on lab-worker: 15 cores. Both workers advertise the same 15 because kind nodes share the Docker Desktop VM, so the scheduler sees two 15-core machines.
- Filter fragments in FailedScheduling messages:
  - `untolerated taint(s)`: taint filter (control plane)
  - `didn't match Pod's node affinity/selector`: nodeSelector (same plugin as node affinity)
  - `Insufficient cpu`: resource fit, requests vs allocatable
- Preemption fragment: `Preemption is not helpful` means no eviction could fix it (label or taint). `No preemption victims found` means eviction could help in principle, but all Pods have priority 0 so there is nothing to evict.
- Toleration permits placement, it does not attract. The 2/2 split in 3b came from scoring.
- Requests, not usage, decide fit. Real CPU usage was not measured (metrics-server arrives Week 4).
- A bad selector stalls a rollout, not the service: old Pods stayed up (`maxSurge` 25%, `maxUnavailable` 0).
- Re-applying `k8s/d9-base.yaml` reverted the imperative patches (same drift lesson as Day 7). Same Pod template gave the same hash `76bb574494`.
- Cleanup status: namespace d9 deleted. The `disk` label removal, taint listing and label count were not confirmed in the output.

## Gotchas
- Toleration permits, scoring chooses. For a dedicated node pool, use a taint (repel others) plus nodeSelector or affinity (attract yours).
- Read the preemption fragment: it says whether the fix is a manifest change or capacity.
- `nodeName` skips the scheduler and its filters, so a pinned Pod ignores taints and can land on a full node.
- Kind nodes share the VM's CPUs, so scheduling passing here says nothing about real capacity. Kubeadm VMs in Week 8 will have real limits.
- zsh: avoid pasting inline `#` comments, and quote `custom-columns` arguments.
