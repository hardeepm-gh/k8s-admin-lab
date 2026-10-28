# Day 13: ConfigMap and Secret

## Commands

Baseline
- `kubectl config current-context` (kind-lab before every apply), `git status --short`, `git log --oneline -4`, a blank-count grep over `notes/day-12.md`, `kubectl get nodes`, `kubectl -n kube-system get pods -l k8s-app=kube-dns`, `kubectl get ns`
- 3 nodes Ready on v1.37.0 (12d old), both CoreDNS Pods `1/1` with 2 restarts from 2d1h earlier, no `d12` or `d13` namespace

Day 12 notes fix (found at baseline)
- The blank-count grep printed 1. `grep -n` found it on line 6, where the notes quoted the baseline command with the literal blank pattern inside it.
- Reworded line 6 with a Python edit, then `git commit -m "Day 12: fix notes blank"` and `git push` (`10a21ff..4e40931`). The count printed 0 at the start of Step 1.

ConfigMap and Secret
- `kubectl create ns d13`
- `k8s/d13-config.yaml` (committed `9b3905b`, then applied): ConfigMap `web-config` with `LOG_LEVEL: info-v1` and a multi-line `app.properties` (`greeting=hello-v1`), and Secret `web-secret` with `stringData` `DB_PASSWORD: change-me-v1` (lab placeholder)
- `kubectl -n d13 get configmap web-config -o yaml`, `get secret web-secret -o yaml`, `describe secret web-secret`

Consumer
- `k8s/d13-consumer.yaml` (committed `9321f63`): busybox:1.36 Deployment `consumer`, 1 replica, printing five readings every 5s: ConfigMap env var, Secret env var, ConfigMap volume at `/etc/cfg`, ConfigMap `subPath` mount at `/etc/sub/app.properties`, and Secret volume at `/etc/secret`
- Pod `consumer-86c88c6b74-9m5z9` on lab-worker, `1/1 Running`
- `kubectl -n d13 exec deploy/consumer -- ls -la /etc/cfg /etc/secret`

Edit without restart
- Terminal 1: `kubectl -n d13 logs -f deploy/consumer`
- Terminal 2: `sed -i '' 's/-v1/-v2/g' k8s/d13-config.yaml`, `git diff`, commit `d21ad3e`, `kubectl apply -f k8s/d13-config.yaml`, `get ... -o jsonpath='{.metadata.resourceVersion}'` on both objects, `sleep 120`, `ls -la /etc/cfg /etc/secret`
- The diff changed exactly three lines (`info-v1`, `hello-v1`, `change-me-v1` to v2). resourceVersion moved from 767858 and 767859 to 782641 and 782642.

Restart
- `date -u +%T` (23:56:56), `kubectl -n d13 rollout restart deploy/consumer`, `rollout status`, `sleep 35`, `logs deploy/consumer --tail=2`, `exec deploy/consumer -- ls -la /etc/sub`, `kubectl diff -f k8s/d13-consumer.yaml`

Secret decode and immutable ConfigMap
- `get secret web-secret -o jsonpath='{.data.DB_PASSWORD}'` piped to `base64 -D`, plus the Secret's annotations and the Deployment's Pod-template annotations
- `k8s/d13-immutable.yaml` (committed `a53dc1c`): ConfigMap `web-immutable`, `immutable: true`, `GREETING: hello-v1`. Applied, then two `kubectl patch` attempts (change the data, set `immutable` to false)

## What broke

1. The Day 12 notes already committed and pushed contained one blank-pattern match (count 1). It was line 6 of the file I generated for Day 12.
2. After the edit, the running Pod showed three of five readings still at v1 while the other two read v2. Env vars (both) and the `subPath` file stayed at v1. The volume-mounted ConfigMap and Secret changed.
3. After `rollout restart`, `kubectl diff -f k8s/d13-consumer.yaml` printed nothing, even though the live Pod template had a `restartedAt` annotation that the file does not.
4. Both patches against `web-immutable` were rejected.

## Root cause

1. The line quoted the grep command with its literal pattern. The Day 12 notes were generated with that line, and the count caught it. Not a lab fault.
2. Env vars are set at container start, so a running container never sees an edit. The `subPath` mount listed as a plain 18-byte regular file (`-rw-r--r--`) with no symlink indirection, while the volume mounts use `..data` symlinks into timestamped directories. After the edit, both volume mounts got a new directory (`..2026_10_27_23_50_17.*`) and `..data` was repointed, and the top-level file symlinks kept their 23:43 timestamps. The `subPath` file has no `..data` to repoint, which fits the staleness. The listing doesn't prove the mechanism.
3. Not proven. The annotation was added by `rollout restart` and is not in the file's last-applied configuration. The likely reading is that the diff only compares the fields the file declares. The output doesn't show the mechanism. The live annotation was confirmed afterwards: `kubectl.kubernetes.io/restartedAt: 2026-10-27T16:56:56-07:00`.
4. `immutable: true` forbids changing `data` and the `immutable` field itself. The API server returned `data: Forbidden: field is immutable when immutable is set` and the same message on `immutable`.

## Fix

1. Reworded the line, committed and pushed as `4e40931`, and confirmed the count is 0.
2. `kubectl rollout restart deploy/consumer`. The new Pod `consumer-5bb9fd5c4-jlbhk` showed all five readings at v2.
3. No fix applied. Treat an empty `kubectl diff` as "the fields the file declares match", and nothing more.
4. No fix applied, by design. A change needs a new object name plus an edit to the Deployment, or delete and recreate.

## Findings

Which path needs a restart, as observed:

| Path | After edit, no restart | After restart |
|---|---|---|
| ConfigMap as env var | stale (v1) | v2 |
| Secret as env var | stale (v1) | v2 |
| ConfigMap as volume | v2 | v2 |
| Secret as volume | v2 | v2 |
| ConfigMap via `subPath` | stale (v1) | v2 |

- Timing of the volume update, one sample: the apply was at 16:49:12 local, which is 23:49:12 UTC on the offset below. The log still showed v1 at 23:50:13 and v2 at 23:50:18, so the change landed about 61 to 66s after the apply. The log granularity is 5s and this is a single sample, so it is not a measured sync interval.
- Clock offset: `date` ran in local time (PDT) and the Pod logs are in UTC, a 7-hour difference, derived from the Pod age and its first log line. `date -u` was used from the restart onward.
- ConfigMap and Secret volumes changed on the same log line.
- Replacing the Pod did not need a change to the Pod spec. `rollout restart` is the only trigger, and a config change alone never rolls Pods. A checksum annotation on the Pod template is the production fix (Day 27).
- The app has to re-read the file to benefit from a volume update. The busybox loop re-reads each pass. A typical app loads config once at startup.
- `describe secret` showed only `DB_PASSWORD: 12 bytes` and `Annotations: <none>`. `get secret -o yaml` showed the base64 value under `data` (`Y2hhbmdlLW1lLXYx`), and `stringData` is not echoed.
- The Secret's `kubectl.kubernetes.io/last-applied-configuration` annotation holds the plaintext password as `stringData`. It was rewritten with `change-me-v2` after the edit. `describe` hides the annotation. The plaintext is also in the committed manifest. Real Secrets should not be applied from plain manifests or committed.
- `base64 -D` on `Y2hhbmdlLW1lLXYy` returned `change-me-v2`.
- `immutable: true` is one-way. Final read: `true hello-v1`.
- `kubectl diff` empty plus `git status --short` empty did not prove the live Deployment matched the file.

## Not observed

- The cleanup (`kubectl delete ns d13`), its duration, and whether `d13` and the Pod are gone. The cleanup output was not pasted.
- Whether the four Day 13 commits (`9b3905b`, `9321f63`, `d21ad3e`, `a53dc1c`) are pushed. `origin/main` was at `4e40931` after the Day 12 fix.
- `git status --short` after the commits in Steps 2 to 5.
- The `kubectl diff` exit code in Step 4.
- Whether the volume-update delay is stable. One sample.
- The `LOG_LEVEL` file inside the `/etc/cfg` volume. Only `app.properties` was read.
- The `/etc/sub` mount's file type before the restart. It was listed only after the restart.
- Whether `/etc/secret` is memory-backed. The `drwxrwxrwt` mode is a hint, and the output doesn't show the filesystem type.
- How long the old Pod took to terminate after the restart.
- A Pod consuming `web-immutable`, and a delete and recreate of it.
