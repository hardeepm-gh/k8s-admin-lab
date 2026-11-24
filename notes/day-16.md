# Day 16: Ingress with Traefik

## Commands

Baseline
- Guard on every write: `test "$(basename "$PWD")" = k8s-admin-lab && test "$(kubectl config current-context)" = kind-lab`
- First baseline ran against the wrong cluster (see What broke). Rerun on `kind-lab`: 3 nodes Ready on v1.37.0 (38d), only the default namespaces plus `local-path-storage`, `kubectl get ingressclass` returned `No resources found`, `helm list -A` empty (header row only), CRD list held only `sealedsecrets.bitnami.com`.
- `helm version --short`: `v4.3.0+gbec5b06`. `kind-config.yaml`: one control plane, two workers, no `extraPortMappings`. Top commit `e6aae37` (Day 15 notes), tree clean.

Backends
- `docker run --rm busybox:1.36 busybox --list | grep -x -E 'httpd|wget'`: both present. The pulled digest `sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662` is the same as the Image ID shown on Day 15.
- `k8s/d16-backends.yaml`: Deployments and Services `app-a` and `app-b` in `d16` (busybox `httpd` on 8080, page text `hello from app-a` and `hello from app-b`, `terminationGracePeriodSeconds: 5`). Commit `4f7e21b`, then `kubectl create ns d16` and `kubectl apply`.
- Throwaway Pods (`kubectl run t1`, `t2` with `--rm -i`) ran `wget -qO- -T 3 http://app-a` and `http://app-b`.

Traefik install
- `helm repo add traefik https://traefik.github.io/charts`, `helm repo update`, `helm search repo traefik/traefik --versions | head -6`, `helm show values` slices read with `sed`, `grep` and `head`.
- Pinned chart `42.3.2` (app `v3.7.17`). Newest listed was `42.4.1` (app `v3.7.19`).
- `k8s/d16-traefik-values.yaml` (commit `fc58cb3`): `service.spec.type: ClusterIP`, `ingressClass.isDefaultClass: false`, `ingressClass.name: traefik`.
- `helm template traefik traefik/traefik --version 42.3.2 -n traefik -f k8s/d16-traefik-values.yaml` (render only, no cluster contact), filtered with `grep` and `sort | uniq -c`.
- `helm install traefik traefik/traefik --version 42.3.2 -n traefik --create-namespace -f k8s/d16-traefik-values.yaml --wait --timeout 3m` (see What broke for the second attempt). Checked with `helm history traefik -n traefik`, `kubectl -n traefik get pods,secrets`, `kubectl -n traefik get svc`, `kubectl get ingressclass`.

Ingress rules
- `k8s/d16-ingress-a.yaml` (commit `8271356`): Ingress `a-only`, `ingressClassName: traefik`, host `a.example.test`, path `/` (`Prefix`), backend `app-a` port 80.
- `k8s/d16-ingress-b.yaml` (commit `e678896`): Ingress `b-only`, host `b.example.test`, backend `app-b` port 80.
- `k8s/d16-ingress-broken.yaml` (commit `47a0344`): Ingress `c-broken`, host `c.example.test`, backend `app-missing` port 80 (no such Service yet).
- `k8s/d16-svc-missing.yaml` (commit `66ca878`): Service `app-missing`, selector `app: app-b`, port 80 to target port 8080.

Testing
- Terminal 1: `kubectl -n traefik port-forward svc/traefik 8086:80`. Terminal 2: `curl -i -H 'Host: <name>' http://127.0.0.1:8086/`.

Cleanup
- `helm uninstall traefik -n traefik`, `kubectl delete` of the 25 Traefik CRDs (names ending in `traefik.io`), then `d16` and `traefik` namespaces deleted. `kubectl get ns` afterwards listed only the defaults and `local-path-storage`.
- `git push` (`e6aae37..66ca878`).

## What broke

1. The first baseline ran with the wrong context. `kubectl config current-context` returned a different kind cluster, not `kind-lab`. The guard line failed, but the commands on the lines below it ran as separate commands, so every cluster and Helm result in that run came from the other cluster. All commands in it were read-only.
2. The second `helm install traefik` was refused: `Error: INSTALLATION FAILED: release name check failed: cannot reuse a name that is still in use`.
3. `helm list -A --all` failed with `Error: unknown flag: --all`.
4. `kubectl -n traefik port-forward svc/traefik 8081:80` failed: `bind: address already in use` for `127.0.0.1:8081` and `[::1]:8081`. Port 8089 failed the same way. Port 8086 worked.
5. `curl` to `c.example.test` after the Service fix failed with `curl: (7) Failed to connect to 127.0.0.1 port 8086 after 0 ms: Couldn't connect to server`, twice.
6. The `c-broken` Ingress was accepted with no error or event, and `curl -H 'Host: c.example.test'` returned `404 page not found`, identical to a host with no rule.

## Root cause

1. A kubeconfig context switch earlier outside this lab left a different cluster active. The guard worked and stopped its own chain, but the following lines were not chained to it.
2. The first install had already succeeded. Its output was never pasted. `helm history` showed revision 1, `deployed`, chart `traefik-42.3.2`, app `v3.7.17`, `Install complete`, updated `Sun Nov 22 12:43:19 2026` (local time). The Pod `traefik-7ccc7d565d-jkhfq` was `1/1 Running` at 8m33s old, and the release record `sh.helm.release.v1.traefik.v1` was the same age. My first guess, a release hidden by its status in `helm list`, was wrong.
3. Helm 4.3.0 does not accept `--all` on `helm list`. I did not look up the replacement.
4. Another program on the Mac held those ports. It was not identified, because the `lsof` output was not pasted.
5. The port-forward is a process. Nothing was listening on 8086, so the tunnel had ended. Why it ended is not shown.
6. The Ingress API validates the object's shape, not its backend. `describe ingress c-broken` read `app-missing:80 (<error: services "app-missing" not found>)`, with `Events: <none>`.

## Fix

1. Switched to `kind-lab` with `kubectl config use-context kind-lab`, and reran the checks behind a guard that passed (`guard-ok`).
2. No fix needed. The install was already deployed.
3. Not needed.
4. Used 8086. Port-forward printed `Forwarding from 127.0.0.1:8086 -> 8000` and `[::1]:8086 -> 8000`.
5. Restarted the tunnel on 8086. The next request returned `200 OK` with `hello from app-b`.
6. Created Service `app-missing` selecting `app-b` (commit `66ca878`). The backend line then read `app-missing:80 (10.244.3.28:8080)`, and the Ingress needed no edit.

## Findings

Chart and install
- Chart defaults (42.3.2): `service.spec.type` is `LoadBalancer` (the key is `service.spec.type`, not `service.type`). `ingressClass` has `enabled: true`, `isDefaultClass: true`, `name: ""`. The provider block with `kubernetesGateway: enabled: false` was seen, but its parent key was not printed.
- `ports.web`: `port: 8000`, `exposedPort: 80`. `ports.traefik`: `port: 8080`, `expose.default: false`.
- `helm template` rendered six kinds, one each: `ClusterRole`, `ClusterRoleBinding`, `Deployment`, `IngressClass`, `Service`, `ServiceAccount`. The IngressClass had `is-default-class: "false"`. The Service was `ClusterIP`, port 80 to `web` and 443 to `websecure`. It rendered no CRDs.
- After install: Service `traefik` is `ClusterIP` `10.96.134.173` on `80/TCP,443/TCP`, and IngressClass `traefik` has controller `traefik.io/ingress-controller` with no default marker.
- The Helm release record is a Secret in the release namespace. `helm install` refuses an existing name.

Routing
- `describe ingress a-only`: class `traefik`, backend `app-a:80 (10.244.1.43:8080)`, which is the `app-a` Pod IP, `Events: <none>`, empty `Address` (the Service is `ClusterIP`).
- `a.example.test` returned `200 OK` with body `hello from app-a`. After the `b-only` Ingress was added, `b.example.test` returned `200 OK` with `hello from app-b`, and `a.example.test` still returned `app-a`. Traefik merged both Ingress objects.
- Both 200 responses had identical headers (`Content-Length: 17`, `Etag: "6b035031-11"`, `Last-Modified: Sun, 22 Nov 2026 20:27:29 GMT`). Only the body told the backends apart.
- A host with no rule (`b.example.test` before its Ingress existed, and `unknown.example.test`) returned `404 Not Found`, `text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Content-Length: 19`, body `404 page not found`. The two responses matched, and the `c-broken` response matched them too. The 404 headers carry no `Etag` or `Last-Modified`.
- After `app-missing` existed, `c.example.test` returned `200 OK` with `hello from app-b` (response dated Tue 24 Nov 2026 19:54:41 GMT), so the controller picked up a Service created after the Ingress.

Cleanup
- `helm uninstall` removed the release and the IngressClass. All three Ingresses stayed, 46h old, with no controller reading them. `helm uninstall` left 25 CRDs: 15 in `hub.traefik.io` and 10 in `traefik.io`, all created at `2026-11-22T20:43:19Z`. `helm template` had not shown them.
- A check of four custom resource types (`ingressroutes`, `middlewares`, `tlsoptions`, `traefikservices`) in all namespaces returned `No resources found`. The other 21 types were not checked. All 25 CRDs were then deleted. `kubectl get crd | grep -i -E 'traefik|gateway'` printed nothing, so no Gateway API CRDs exist yet.
- Rerunning the cleanup commands gave `the server doesn't have a resource type "ingressroutes" in group "traefik.io"` and `You must provide one or more resources by argument or filename`, which confirmed the first run.

Production points
- A 404 from the controller does not say whether the host has no rule or the rule points at a dead backend. `describe ingress` shows the difference, and the HTTP status does not.
- The API server accepts an Ingress that names a missing Service, with no warning. Scan `describe ingress` output for `<error:` in a pipeline.
- Test each route with something unique to each backend. A status code and identical headers can pass for the wrong app.
- `ingressClass.isDefaultClass: true` would send every Ingress without a class to Traefik. It was turned off, so a missing `ingressClassName` is a visible fault.
- A chart can install cluster-wide CRDs that `helm uninstall` leaves behind. Listing a chart's CRDs before installing (`helm show crds`) was not run.
- Use `helm upgrade --install` for an install that must work whether or not the release exists (not run here).
- Deleting a CRD deletes every custom resource of that type.

## Not observed

- The output of the first `helm install traefik` attempt, and its duration.
- Why the 8081 and 8089 ports were in use. The `lsof` output was not pasted.
- Why the port-forward ended before the `app-missing` test.
- The Terminal 1 output of the port-forward, including any `Handling connection` lines.
- How long Traefik took to pick up each new Ingress and the new Service. Each test ran after a gap.
- Traefik's own logs for the missing backend.
- Whether the Gateway provider's parent key is `providers.kubernetesGateway`. The defaults showed `enabled: false` at that depth, and the key was not set.
- The replacement for `helm list --all` in Helm 4.3.0.
- Whether the chart works under Helm 4 beyond this install. It rendered and installed here.
- Custom resources of the other 21 CRD types.
- The Traefik ClusterRole and ClusterRoleBinding after uninstall, and the `traefik` namespace contents before deletion. Those output blocks were not pasted.
- The `time` output for the Day 16 namespace delete.
- Whether `git status --short` was clean after the push.
- The doubled page text in the `kubectl run -i --rm` test output. The warning `couldn't attach to pod ... falling back to streaming logs` fits one response shown twice, but this is not shown.
