# Day 8: Find the control plane components

## Commands
1. `kubectl get pods -n kube-system -o 'custom-columns=NAME:.metadata.name,OWNER:.metadata.ownerReferences[0].kind'` (quote the argument in zsh)
2. `docker exec lab-control-plane ls /etc/kubernetes/manifests`
   `docker exec lab-control-plane grep -i staticPodPath /var/lib/kubelet/config.yaml`
   `docker exec lab-control-plane systemctl status kubelet --no-pager | head -5`
   `docker exec lab-control-plane crictl pods` / `crictl ps`
   `docker exec lab-control-plane ps -eo pid,ppid,comm | grep -E 'kubelet|containerd|runc'`
3. `kubectl get pod -n kube-system kube-controller-manager-lab-control-plane -o jsonpath='{.spec.containers[0].command}' | tr ',' '\n'`
4. Deleted mirror Pod `kube-scheduler-lab-control-plane`, compared `crictl ps --name kube-scheduler` before and after.
5. Moved `kube-scheduler.yaml` to /tmp, created Deployment `probe` (2 replicas), moved the manifest back, deleted `probe`.

## What broke
- zsh: unquoted `[0]` in `custom-columns` gave `no matches found` (glob). Quoting fixed it.
- Step 5 (intended fault): with the scheduler manifest removed, `probe` Pods stayed Pending (~21s) until the manifest returned.
- Not captured: `describe pod` Events and the NODE column during the outage. Do not log "no events" as observed.

## Root cause
- Step 5: the kubelet stopped the scheduler container and removed its mirror Pod once the manifest left /etc/kubernetes/manifests. Deployment and ReplicaSet controllers still created the Pods (controller-manager is a separate process). Nothing was left to bind them to a node.

## Fix
- Moved the manifest back. The kubelet recreated the container (ATTEMPT 1 to 2) and the Pods went Pending to Running within ~2s of the restore (watch started right after the mv, Pods Running at age 22s). The restore-to-bind time is bounded by that watch, not measured precisely.

## Findings
- Static Pods (owner `Node`, node-name suffix): etcd, kube-apiserver, kube-controller-manager, kube-scheduler. These match the four files in /etc/kubernetes/manifests.
- Controller-owned: coredns x2 (ReplicaSet), kindnet x3 and kube-proxy x3 (DaemonSet, one per node). local-path-provisioner is in the local-path-storage namespace.
- `staticPodPath: /etc/kubernetes/manifests`.
- kubelet: systemd unit (drop-ins 10-kubeadm.conf, 11-kind.conf), pid 237, never in `crictl ps`.
- Chain: Docker container -> systemd -> kubelet -> containerd (CRI) -> containerd-shim -> runc -> container. `kubectl` talks to the API server, `crictl` talks to containerd.
- 9 containerd-shim processes (one per Pod sandbox), all with PPID 1, so a containerd restart does not kill running containers. No runc process (it exits after starting the container).
- Mirror Pod test: container ID `53d28770e8bc9` and ATTEMPT 2 identical before and after deleting the Pod object. The API object returned in ~10s with RESTARTS history intact. Deleting the mirror does not stop the container; removing the manifest does.
- controller-manager flags: `--controllers=*,bootstrapsigner,tokencleaner` (all Day 7 controllers run in this one process), `--leader-elect=true`, `--cluster-cidr=10.244.0.0/16` with `--allocate-node-cidrs=true`, `--use-service-account-credentials=true`.
- Node had restarted ~2h before the earlier listing: sandboxes were 2h old at ATTEMPT 1, with NotReady twins 3 days old. The kubelet rebuilt the control plane from disk.
- CNI here is kindnet (Calico comes with kubeadm).

## Pass criterion: explain from memory (write this yourself, no peeking)
1. Static Pod manifest:
2. Kubelet:
3. Runtime chain (which tool talks to which layer):
4. Mirror Pod (and what stops a static Pod):
5. Week 9 consequence (what a missing scheduler looks like in kubectl):

## Gotchas
- `crictl` works with the API server down.
- The kubelet is a host service, not a Pod.
- Shims are reparented to init; containerd restarts do not kill containers.
- Quote `custom-columns` arguments in zsh.
- Do not remove the kube-apiserver or etcd manifests on kind.
- Day 7 correction: `lab` disappearing is "cause unconfirmed" (this node survived a restart).
