# Day 11: Deployment from YAML

## Commands
Setup: `kubectl create ns d11`, confirmed `app:1` present on nodes (`docker exec lab-worker crictl images | grep app`)
1. Wrote `k8s/d11-web.yaml` (3 replicas, RollingUpdate maxSurge 1 / maxUnavailable 0, requests 50m/64Mi, limit 128Mi, env APP_VERSION=v1), applied, committed as baseline (`1a216f9`)
2. `sed -i '' 's/replicas: 3/replicas: 5/'`, `kubectl diff -f`, `kubectl apply -f`
3. `sed -i '' 's/value: "v1"/value: "v2"/'`, apply, `kubectl rollout status`, `kubectl get rs`, `kubectl rollout history`
4. `sed -i '' 's#image: app:1#image: app:does-not-exist#'`, apply, `kubectl rollout status --timeout=30s`; fix with `git checkout k8s/d11-web.yaml`, `kubectl diff`, apply, `kubectl rollout status`
5. `kubectl get deploy web -o jsonpath='{.metadata.annotations}' | jq .`, final `kubectl diff`
Cleanup: `kubectl delete ns d11`

## What broke
- Step 4 (intended): bad image tag. New Pod `web-6c6dbd4cc5-l62fq` was created while 5 old Pods stayed Running. `rollout status` timed out: "1 out of 5 new replicas have been updated".
- Commit gap: only the baseline was committed, not the step 2 scale. `git checkout` therefore reverted `replicas` 5 to 3 along with the bad edit.

## Root cause
- Step 4: image `app:does-not-exist` cannot be pulled. `maxUnavailable: 0` meant no old Pod could be removed until a new one was Ready, so the rollout stalled and service continued on the old Pods.
- The extra revert: uncommitted edits (replicas 5) were discarded together with the bad one by `git checkout`.

## Fix
- Restored the committed file with `git checkout`, `kubectl diff` showed the exact reversal, `kubectl apply` rolled out cleanly. Final `kubectl diff` printed nothing (file and cluster agree).
- Process fix: commit each edit before applying so `git log` records every change.

## Results by step
| Step | Result |
|---|---|
| 1 | RS `7f67796c66`, 3/3 Running |
| 2 | Same RS scaled to 5 (2 new Pods, original 3 untouched). `kubectl diff` showed only `generation` 1 to 2 and `replicas` 3 to 5 |
| 3 | New RS `b8c746b4f`, old RS `7f67796c66` held at 0. `rollout history`: revisions 1 and 2 (CHANGE-CAUSE `<none>`) |
| 4 | Bad image: rollout stalled, 5 old Pods kept serving, no outage |
| 4 fix | Rolled out under revision 4. Diff reverted replicas 5 to 3, `v2` to `v1`, image back to `app:1` |
| 5 | Annotation `deployment.kubernetes.io/revision: "4"`, `last-applied-configuration` matches the file, `kubectl diff` empty |

## Findings
- A replicas edit keeps the same ReplicaSet (`generation` bumps). A Pod template edit creates a new ReplicaSet and keeps the old one at 0 (`revisionHistoryLimit: 5`).
- `kubectl diff` before every apply, and an empty diff afterward, is the drift check.
- `last-applied-configuration` is how `apply` computes its three-way diff. `rollout undo` would move the cluster while leaving the file unchanged, so the next apply would roll it forward again.

## Not observed
- The pull error itself: the Pod listing was taken at 0s (`ContainerCreating`) and the 30s timeout ended the step. `ErrImagePull` / `ImagePullBackOff` and the `describe pod` Events were never seen.
- Step 3 rollout duration (not timed).
- Whether the revert reused RS `7f67796c66`: revision 4 is consistent with that, but `kubectl get rs` was not run. Inferred only.
- Predictions were not recorded before each step.

## Gotchas
- Scale through the file, and commit every edit before applying.
- `git checkout` reverts all uncommitted changes in the file, not just the bad one.
- `maxUnavailable: 0` turns a bad image into a stalled rollout, not an outage.
- The selector is immutable after creation and must match the template labels.
- The SIGTERM defect (Day 7) makes every rollout slow until Day 20.
- macOS `sed -i ''` edits in place.
