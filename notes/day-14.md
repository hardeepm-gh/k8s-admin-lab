# Day 14: Namespaces and quotas

## Commands

Re-entry after the gap
- `kubectl config current-context`, `kubectl get nodes`, `kubectl -n kube-system get pods`, `kubectl get ns`, `docker exec lab-worker crictl images | grep -w app` (and lab-worker2), `git status --short`, `git log --oneline -6`, a blank-count grep over `notes/day-13.md` (printed 0)
- Cluster 32d old, 3 nodes Ready on v1.37.0. `app:1` present on both workers, same image ID `ae1f9811735f9`, 61.9MB. Day 13 notes pushed (`f19b904`).
- `d13` was still `Active` at 19d, with Deployment `consumer` and its Pod running. Cleaned up with `time kubectl delete ns d13`: 42.137s. `d13` gone from `get ns`, no `consumer` Pod left.
- `sealed-secrets-controller` Pod found in `kube-system` (25d old). Image `docker.io/bitnami/sealed-secrets-controller:0.27.1`. CRD `sealedsecrets.bitnami.com` created `2026-10-21T03:08:39Z`. `kubectl get sealedsecrets -A` returned no resources.

Namespace and quota
- `kubectl create ns d14`
- `k8s/d14-quota.yaml`: ResourceQuota `compute` with `requests.cpu: 100m`, `requests.memory: 1Gi`, `limits.memory: 512Mi`, `pods: 5`. Commit `50e5ddb`, pushed (`f19b904..50e5ddb`).
- `kubectl -n d14 describe resourcequota compute`: all four rows at 0 used.

Deployment against the quota
- `k8s/d14-web.yaml`: the Day 11 manifest with the namespace changed to `d14` (`sed`, `diff` showed only line 5 changing). Commit `7e4dd76`, then `kubectl apply`.
- `kubectl -n d14 rollout status deploy/web --timeout=30s`, `get deploy,rs,pods`, `describe rs`, `describe deploy web`, `get events`, `describe resourcequota compute`

Bare Pod
- `k8s/d14-bare.yaml`: Pod `bare` running `app:1`, no resources declared. Commit `574ffc7`, then `kubectl apply`.

LimitRange
- `k8s/d14-limitrange.yaml`: LimitRange `defaults`, container `defaultRequest` cpu 25m and memory 32Mi, `default` memory limit 128Mi. Commit `dcf5ab6`. Applied, then `kubectl apply -f k8s/d14-bare.yaml` again.

Raise the quota
- `sed -i '' 's/requests.cpu: "100m"/requests.cpu: "200m"/' k8s/d14-quota.yaml`, `git diff` (one line changed), commit `a866e54`, `kubectl diff` (exit 1, only that change), `date -u +%T` (03:54:11), `kubectl apply -f k8s/d14-quota.yaml`, `rollout status deploy/web --timeout=90s`
- Watch loop: Deployment conditions via jsonpath, then six rounds of `get pods --no-headers` with `date -u +%T` every 20s
- `kubectl apply -f k8s/d14-bare.yaml` again, `get pod bare -o jsonpath='{.spec.containers[0].resources}'`, `describe resourcequota compute`, `get deploy web`, conditions via jsonpath

Cleanup
- `time kubectl delete ns d14`: 42.145s. `get ns` no longer lists `d14`, no `bare` or `web` Pod left.
- `git push` (`50e5ddb..a866e54`). `HEAD` and `origin/main` both at `a866e54`, working tree clean.
- Other repository: guarded `git reset --hard HEAD~1` (see What broke).

## What broke

1. Earlier Day 14 commands ran in the wrong repository. The shell prompt did not read `k8s-admin-lab`. In that repository, `k8s/d11-web.yaml` does not exist, so `sed` failed and the redirect created an empty `k8s/d14-web.yaml`. That empty file was committed as `e506cde` there, and `kubectl apply` reported `no objects passed to apply`. Nothing reached the cluster.
2. `k8s/d14-quate.yaml` appeared untracked in the lab repo. Its content was invalid: every key at column 0, `namespoace` instead of `namespace`, and the line `requests.cpu" "100m"` with no colon. `kubectl diff` on the renamed file failed with `error parsing ... could not find expected ':'`, exit 2.
3. With the quota at `requests.cpu: 100m` and each `web` Pod requesting 50m, the Deployment stalled at 2 of 3 replicas. `rollout status` timed out at 30s. `get pods` showed only the two healthy Pods.
4. The bare Pod was refused: `Forbidden`, `failed quota: compute: must specify limits.memory for: c; requests.cpu for: c; requests.memory for: c`.
5. After the LimitRange, the same Pod was refused again with a different message: `exceeded quota: compute, requested: requests.cpu=25m, used: requests.cpu=100m, limited: requests.cpu=100m`.
6. After the quota was raised to 200m, the third `web` Pod did not appear within 52s. `rollout status` ended with `deployment "web" exceeded its progress deadline`.

## Root cause

1. Wrong working directory. Both repositories use the same `kind-lab` context, and the prompt shows which repository the shell is in. The other repository's log ended with `e506cde` (unpushed) above `430ed12` (`origin/main`).
2. Not confirmed how the file got its content. It is not the heredoc used in Step 1. The renamed file was overwritten with the correct manifest, and `kubectl diff` then exited 0 against the live quota.
3. The quota admits a Pod only if requested CPU fits under the cap. Every failure event on the ReplicaSet reads `exceeded quota: compute, requested: requests.cpu=50m, used: requests.cpu=100m, limited: requests.cpu=100m`. The ReplicaSet condition was `ReplicaFailure True / FailedCreate`, the Deployment showed `Available False / MinimumReplicasUnavailable` and `ReplicaFailure True`, and the Pods that would break the cap were never created. There was no Pending Pod and no scheduler message.
4. Once a compute quota covers a field, a Pod must declare it. `pods` needs no declaration, and the error names only the three fields the quota tracks.
5. The LimitRange injected defaults at admission, so the Pod passed the declaration check. The injected request counted against the cap, and CPU was full. The error value `requests.cpu=25m` is the injected default.
6. Not confirmed. The newest failure event before the apply was dated about 11 minutes before the third Pod was created, and there were no new failures between. The output shows the delay but not the controller's mechanism.

## Fix

1. Moved into the lab repo and reran the step behind a guard (directory name, context `kind-lab`, source file present). In the other repository, `git reset --hard HEAD~1` was run only after hash checks (`HEAD` equal `e506cde`, `origin/main` equal `430ed12`). Result: `HEAD is now at 430ed12`, and the empty `k8s/d14-web.yaml` was gone.
2. Overwrote `k8s/d14-quota.yaml` with the correct manifest, confirmed with `kubectl diff` (exit 0), and committed it as `50e5ddb`.
3. Raised `requests.cpu` from 100m to 200m (commit `a866e54`, applied at 03:54:11 UTC). The third Pod `web-7f67796c66-msk7h` appeared at 03:58:26 UTC at age 4s, so created at about 03:58:22. That is roughly 4m10s after the apply, with no manual action. At 03:58:06 the Deployment conditions still read `Progressing=False / ProgressDeadlineExceeded`. Final state: `web` 3/3, `Available=True / MinimumReplicasAvailable`, `Progressing=True / NewReplicaSetAvailable`.
4. The LimitRange (fix 5) removes the declaration failure for Pods that omit resources.
5. Raised the quota (fix 3). `bare` was then admitted.

## Findings

- A quota breach is refused at admission. The Pod does not exist, so `get pods` shows nothing wrong. The reason is in the ReplicaSet's events and conditions, and the Deployment's own events listed only `ScalingReplicaSet`. On Day 9 Pods existed and sat Pending, and this is a different failure.
- The ReplicaSet retried about a dozen times in the first second, then retries were combined (`x4 over 29s`, later `x8 over 10m`).
- Quota table after the first stall: `limits.memory 256Mi/512Mi`, `pods 2/5`, `requests.cpu 100m/100m`, `requests.memory 128Mi/1Gi`.
- LimitRange `describe`: memory default request 32Mi and default limit 128Mi, CPU default request 25m, and no default CPU limit (`-`), as declared.
- Injected values on the created `bare` Pod: `{"limits":{"memory":"128Mi"},"requests":{"cpu":"25m","memory":"32Mi"}}`. The Pod manifest had none of these fields.
- Quota after `bare` was admitted: `limits.memory 512Mi/512Mi`, `pods 4/5`, `requests.cpu 175m/200m`, `requests.memory 224Mi/1Gi`. A Pod that lands exactly on the cap was admitted.
- Placement after recovery: `ftkcq`, `msk7h` and `bare` on lab-worker, `nhpwx` on lab-worker2. Nothing spread them (Day 19).
- Production: debug a short-replica Deployment from the ReplicaSet events, not `get pods`. A raised quota did not fix the Deployment at once, and `ProgressDeadlineExceeded` stayed on the object until the Pod was created. Without a LimitRange, a compute-quota namespace refuses any Pod that omits resources, including chart-rendered and Job Pods, and the injected defaults count against the cap.
- Namespace delete took 42.137s on Day 13 and 42.145s on Day 14, with different contents. The output does not show why the two match.
- The sealed-secrets controller in `kube-system` comes from a separate project that shares this cluster, per user. It is not lab state. The CRD was created 2026-10-21, and no SealedSecret objects exist.
- Repo hygiene: the shared `kind-lab` context let a lab command run in the wrong repo. Guard used from here on: `test "$(basename "$PWD")" = k8s-admin-lab && test "$(kubectl config current-context)" = kind-lab`.
- The quota was applied to the cluster before it was committed in the lab repo, which breaks the commit-before-apply rule for that one object.

## Not observed

- How `k8s/d14-quate.yaml` got its broken content, and how it appeared in the lab repo.
- The Step 1 `kubectl create ns d14` output and the context line at the start of that step.
- Why the ReplicaSet controller waited about 11 minutes between its last failure and the successful create. Backoff is a guess.
- The last two watch-loop rounds (03:59:26 and 03:59:46), the events tail, and the quota table from that watch.
- `bare` reaching `Running`. It was `ContainerCreating` at age 0s.
- Whether a further Pod is refused at the cap. `limits.memory` is at 512Mi/512Mi, and no Pod was tried.
- The `progressDeadlineSeconds` of the `d14` Deployment. The Day 12 Deployment showed 600, and this one was not printed.
