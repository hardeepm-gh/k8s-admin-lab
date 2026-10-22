# Day 10: Talk to the API directly

## Commands
Setup: `kubectl create ns d10`, `kubectl create deploy web -n d10 --image=app:1 --replicas=2`
1. `kubectl get pods -n d10 -v=8 2>&1 | grep -E 'GET|Response Status|Request Headers' | head`
2. `kubectl proxy --port=8001 &`, `curl -s localhost:8001/api/v1/namespaces/d10/pods | jq -r '.items[].metadata.name'`, `kubectl get pods -n d10 -o name`, `kill %1`
3. Extracted server, CA, client cert and key from the kubeconfig with `kubectl config view --raw -o jsonpath=... | base64 --decode > /tmp/...`, then `curl --cacert --cert --key $SERVER/api/v1/namespaces/d10/pods`
4. curl with no credentials, then with `kubectl create token default -n d10` as a Bearer token; read `.message` from the body
5. Discovery: `curl $SERVER/api`, `curl $SERVER/apis`, `kubectl api-resources`; watch: `curl -sN "$SERVER/api/v1/namespaces/d10/pods?watch=true"`
Cleanup: `rm -f /tmp/ca.crt /tmp/client.crt /tmp/client.key`, `kubectl delete ns d10`

## What broke
- Nothing failed. Steps 4 (403) was the intended denial.
- Step 1 grep caught only the request line. Newer kubectl logs the response in a different format, so the status was not captured.
- Discovery block was run three times in the session (repeat paste, no effect).

## Root cause
- Step 4: the default ServiceAccount in d10 has no Role, so RBAC denies `list pods`. Server message: `pods is forbidden: User "system:serviceaccount:d10:default" cannot list resource "pods" in API group "" in the namespace "d10"`.
- The anonymous request also returned 403, not 401. Kind's API server accepts anonymous requests as `system:anonymous` and RBAC then denies them, so 403 does not prove credentials were absent.

## Fix
- None needed (the denial was the demonstration). Week 10 fixes it with a Role and RoleBinding for the ServiceAccount.

## Findings
- kubectl is a REST client: verb `GET`, path `/api/v1/namespaces/d10/pods?limit=500` (`limit=500` is kubectl's pagination default), server `https://127.0.0.1:57871` (kind's port mapping to the control plane container).
- Proxy path and cert path both returned the same two Pods as `kubectl get pods` (`web-8bcb88b49-gkvzs`, `web-8bcb88b49-hw6jj`).
- Core group is `/api/v1` (group name is empty). All other groups are `/apis/<group>/<version>`. `/api` returned `["v1"]`. `/apis` listed apiregistration.k8s.io, apps, events.k8s.io, authentication.k8s.io, authorization.k8s.io, autoscaling, batch, certificates.k8s.io, networking.k8s.io, policy (first 10).
- `kubectl api-resources` is built from the same discovery data.
- The kind-lab kubeconfig user is a client-certificate identity (same mechanism as the `alice` user on Day 48).
- Watch replays current state as `ADDED` first, then streams changes.
- Status codes: no credentials 403, default ServiceAccount token 403.

## Not observed
- Step 1 response status.
- A real 401 (needs a presented-but-invalid credential, e.g. `Bearer garbage`).
- Watch change events (`MODIFIED`, `DELETED`, new `ADDED`): the watch was stopped after the initial replay, so the Day 7 link to the ReplicaSet controller is not evidenced here.
- Predictions were not recorded before each step.

## Gotchas
- 401 is authentication, 403 is authorization. Anonymous 403 on kind is RBAC, not missing credentials.
- Quote jsonpath filters in zsh (`[?(@.name=="kind-lab")]`) or the brackets glob.
- Temp certs and keys never go in the repo. They were written to /tmp and deleted.
- `kubectl proxy` uses your kubeconfig identity. Bind it to localhost only.
