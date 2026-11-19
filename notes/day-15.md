# Day 15: DaemonSet, Job, CronJob, init container, sidecar

## Commands

Baseline
- Guard line on every command block: `test "$(basename "$PWD")" = k8s-admin-lab && test "$(kubectl config current-context)" = kind-lab`
- `git status --short` (clean), `git log --oneline -3` (top `f14bae3`), a repo-wide `git grep` for the old project name (no output), `kubectl get nodes` (3 Ready, v1.37.0, 33d), `kubectl get ns`, `kubectl -n kube-system get ds`, node taints via jsonpath
- `kindnet` and `kube-proxy` are DaemonSets with 3 desired and 3 ready, node selector `kubernetes.io/os=linux`. `lab-control-plane` has the taint `{"effect":"NoSchedule","key":"node-role.kubernetes.io/control-plane"}`. The workers have none.

DaemonSet
- `k8s/d15-ds.yaml`: DaemonSet `node-agent` in `d15`, busybox:1.36, prints `$NODE_NAME` from the downward API, `terminationGracePeriodSeconds: 5`, no tolerations. Commit `754201b`, then `kubectl create ns d15` and `kubectl apply`.
- Then added a toleration for `node-role.kubernetes.io/control-plane` (operator `Exists`, effect `NoSchedule`). Commit `b8aeb51`. `kubectl diff`, `date -u +%T` (22:13:29), `kubectl apply`, `rollout status`.

Jobs
- `k8s/d15-jobs.yaml`: Job `ok` (prints hostname and time, sleeps 3s) and Job `fail` (`backoffLimit: 2`, prints a timestamp, `exit 1`), both `restartPolicy: Never`. Commit `2885eee`. Applied at 22:22:35 UTC, then `kubectl wait` for `complete` on `ok` and `failed` on `fail`.

CronJobs
- `k8s/d15-cron.yaml`: `tick-forbid` and `tick-allow`, schedule `* * * * *`, history limits 2 successful and 1 failed, each Job sleeps 75s. `concurrencyPolicy: Forbid` versus `Allow`. Commit `813ad72`. Applied at 22:28:59 UTC, watched for 4 minutes (8 rounds, 30s apart).
- Later: read each `tick-allow` Pod's log, then `kubectl delete -f k8s/d15-cron.yaml`, then listed after 0s and after 15s.

Init container
- `k8s/d15-init.yaml`: Pod `waiter` with init container `wait-for-gate` (loops until a name resolves, prints `waiting for gate`) and an `app` container. Commit `56270c0` (the committed file also held a Service), then `05c9b38` (Pod and Service split into `d15-init.yaml` and `d15-gate-svc.yaml`).
- Changed the init check from `getent hosts` to `nslookup gate.d15.svc.cluster.local.` Commit `b3ee715`.
- `kubectl -n d15 delete pod waiter` (6.102s), `kubectl apply -f k8s/d15-init.yaml`, then `kubectl apply -f k8s/d15-gate-svc.yaml` at 00:18:03 UTC, and a 6-round watch every 3s.

Sidecar
- `k8s/d15-sidecar.yaml`: Pod `native` (init container `sidecar` with `restartPolicy: Always`, plus `app`) and Pod `plain` (containers `helper` and `app`). Each shell sets a `trap` for `TERM` that prints a timestamp and then sleeps (sidecar and helper 12s, app 6s). Commit `e0dc45d`.
- Applied, waited for Ready, read each container's log, then `kubectl delete pod native plain --wait=false` at 00:22:51 UTC, and read the logs at about 4s and 10s after.

Cleanup
- `time kubectl delete ns d15`: 15.638s. `get ns` no longer lists `d15`, and no Pod from today remained.
- `git push` (`f14bae3..e0dc45d`). Eight Day 15 commits are on `origin/main`: `754201b`, `b8aeb51`, `2885eee`, `813ad72`, `56270c0`, `05c9b38`, `b3ee715`, `e0dc45d`. Working tree clean.

## What broke

1. The first DaemonSet created 2 Pods and not 3. `DESIRED 2`, with Pods on `lab-worker` and `lab-worker2` only. `describe ds` showed `Tolerations: <none>`, and the events held only two `SuccessfulCreate` lines.
2. Job `fail` ended `Failed 0/1` after 33s with three Error Pods, and the events ended in a single `Warning BackoffLimitExceeded`.
3. The init container check used `getent`, which does not exist in `busybox:1.36`. The init log read `sh: getent: not found` followed by `waiting for gate`, every 3s, and the Pod stayed at `Init:0/1`. It was still blocked at 25h.
4. My first init-container block committed one manifest and applied a different inline Pod. The committed file (`56270c0`) held a Pod and a Service, and the applied Pod differed from it.
5. `kubectl apply` of the edited `d15-init.yaml` was refused: `Forbidden: pod updates may not change fields other than spec.containers[*].image, spec.initContainers[*].image, spec.activeDeadlineSeconds, spec.tolerations (only additions to existing tolerations), spec.terminationGracePeriodSeconds`. The diff in the error showed only the init container `command` changing.
6. `kubectl delete pod waiter` without `-n d15` returned `pods "waiter" not found`, and nothing was deleted.
7. At cleanup, the three `node-agent` Pods showed `RESTARTS 26 (14m ago)` at age 26h.

## Root cause

1. The control-plane node carries a `NoSchedule` taint and the DaemonSet had no toleration, so the controller did not target that node. `kindnet` and `kube-proxy` show 3 Pods each, so their own specs must handle the taint. Their tolerations were not printed.
2. `backoffLimit: 2` allows two retries after the first run, so three Pods in total. The Job controller gave up after the third failure.
3. `getent` is not in the busybox image. A failing check inside `until ...; do` retries forever, which is indistinguishable from a dependency that never appears.
4. My command, not the lab. The inline `kubectl apply -f -` bypassed the file I had just committed.
5. A running Pod's init container command is immutable. Delete and recreate is the only path.
6. My command, not the lab. I left `-n d15` off that one `delete`, while every other command had it.
7. Not confirmed. The DaemonSet command ends in `sleep 3600`, so the container exits after an hour and `restartPolicy: Always` starts it again. That fits one restart per hour (26 in 26h), but the exit codes were not read.

## Fix

1. Added the toleration (`b8aeb51`). The DaemonSet went to `DESIRED 3`, and the control-plane Pod `node-agent-lhb74` logged `node=lab-control-plane`.
2. No fix. The Job gave up as designed, and the three Pods stayed as the per-attempt record.
3. Changed the check to `nslookup gate.d15.svc.cluster.local.` (`b3ee715`), the trailing-dot form that worked on Day 12.
4. Split the Service into `k8s/d15-gate-svc.yaml` and applied only files from then on.
5. `kubectl -n d15 delete pod waiter`, then `kubectl apply -f k8s/d15-init.yaml`. The delete took 6.102s. The new Pod `10.244.1.41` stayed `Init:0/1` with only `waiting for gate` in the log and no `not found` error.
6. Reran with `-n d15`.
7. No fix applied. Left as a lab artifact.

## Findings

DaemonSet
- Without the toleration, `DESIRED` was 2 for 3 nodes and nothing warned. The only signal was the count.
- Adding the toleration replaced both existing Pods. The apply was at 22:13:29 UTC and the rollout ended by 22:13:43 (about 14s for three Pods). The new Pods were `lhb74` (control plane, age 14s at the end), `srvrf` (`lab-worker`, 6s) and `rbn97` (`lab-worker2`, 1s). The old `vscp4` shows `SuccessfulDelete`. The delete event for `njzdl` was not in the tail.
- `kubectl diff` also showed `generation` and the `deprecated.daemonset.template.generation` annotation moving from 1 to 2. Both are server counters, not drift.
- Production: any template change, even a toleration, replaces the agent Pod on every node. Alert when `DESIRED` is below the node count.

Jobs
- `ok`: `Complete`, `1/1`, 6s. The log read `hello from ok-vj9bs at 22:22:35`, so the Pod hostname is the Pod name.
- `fail`: attempts logged at 22:22:35, 22:22:45 and 22:23:05, so retry gaps of 10s and then 20s. The first attempt ran on `lab-worker2`, the next two on `lab-worker`. `wait` returned at 22:23:08.
- Finished Jobs and their Pods stay until deleted. Without `ttlSecondsAfterFinished`, the `fail-*` Pods and `ok-vj9bs` were still there at 26h.

CronJobs
- Every run took 77 to 78s for a 75s sleep, against a 60s schedule.
- `tick-allow` started a new Job on the minute and runs overlapped. The Pod logs prove it: `...928` ran 22:48:00 to 22:49:15, and `...929` started at 22:49:00, 15s before that ended. The next pair overlapped by 15s too.
- `tick-forbid` events: `JobAlreadyActive: Not starting job because prior execution is running and concurrency policy is Forbid` (`x9 over 3m`), as a `Normal` event. The skipped slot was not dropped. The next Job was created right after the previous one completed, so runs went back to back about every 78s and the schedule was not honored.
- History limit 2 worked: `SuccessfulDelete` for `tick-allow-29915909` and `tick-forbid-29915909`.
- Deleting both CronJobs removed their Jobs and Pods. The two running Pods showed `Terminating` at 25s and 35s old and were gone within the 15s wait. Mid-task work was killed.
- Production: `Forbid` delays work and raises only `Normal` events, so a task that outruns its schedule looks healthy. `Allow` has no brake. Suspend before deleting if the work matters (not tested).

Init container
- A blocked init container looks mild: `Init:0/1`, `READY 0/1`, `RESTARTS 0`, `Initialized False`, and only `Normal` events. The log of the init container is the only evidence.
- Release test: `gate` Service applied at 00:18:03 UTC. The init log read `gate resolved` at 00:18:04 and the app logged `app started at 00:18:05`. The Pod was `1/1 Running` at 00:18:06 and had been blocked 2m53s. The release took about 1s from the apply (the loop sleeps 3s, so this was a favorable tick).
- EndpointSlice `gate-946lw` listed `10.244.1.41` on port 8080, which is the waiter Pod itself.
- Design flaw: the `gate` Service selects `app: waiter`, the Pod being gated, so it was never a real dependency. The check also proves only that the Service name resolves, with nothing listening on 8080.
- Production: wait on the dependency itself (a readiness check on the database or HTTP endpoint), not on its DNS name. Set `activeDeadlineSeconds` on Pods that can block on an init step (listed as mutable in the error message, not tested).

Native sidecar versus plain container
- Start: `sidecar start` and `app start` both read 00:22:50 in `native`, and `helper start` and `app start` both read 00:22:50 in `plain`. The log resolution is 1s, so start order is not resolved.
- Delete at 00:22:51. In `native`, `app TERM 00:22:51`, `app exit 00:22:57` (6s, matching the handler), and `sidecar TERM 00:22:57`. The sidecar was told to stop in the second the app exited.
- In `plain`, `app TERM 00:22:51` and `helper TERM 00:22:51`, the same second. The helper got its signal while the app still had 6s of draining to do.
- Production: log shippers, proxies and mesh agents belong in a native sidecar. In a plain second container they stop while the app is still flushing. The shells here handle `TERM` through a `trap`, so they hide your Node app's missing handler (Day 20).

Cleanup
- `delete ns d15` took 15.638s. Days 13 and 14 took 42s. The `d15` Pods used a 5s grace period and the earlier ones used the 30s default. That fits, but the output does not show the cause.

## Not observed

- How the DaemonSet controller decides a node is ineligible. The output shows the result only.
- The DaemonSet update strategy and `maxUnavailable`. `describe ds` does not print them. The stepwise replacement is what the output looked like, not a stated setting.
- The `kindnet` and `kube-proxy` tolerations. They were not printed.
- The delete event for the old `node-agent-njzdl`. It was not in the tail.
- The `fail` Job's exit code and its `Backoff Limit` field. `describe job` was cut off at the top.
- The Pods' exit codes for the hourly `node-agent` restarts.
- What `nslookup` printed inside the init loop. The script discards it.
- The `gate` endpoint's state while `waiter` was still in `Init`.
- Whether `concurrencyPolicy: Replace` behaves differently. It was not run.
- Whether `Forbid` still catches up after a long gap. The run lasted 4 minutes.
- The `sidecar exit` and `helper exit` lines, and the full termination time of `native` and `plain`. The last log read was at 00:23:01.
- Start order inside the sidecar and plain Pods. The log granularity is 1s.
- `git status --short` after the Step 3 and Step 5 commits. The pastes ended before it printed.
