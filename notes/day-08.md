# Day 8: Find the control plane components

## Prediction (write before running anything)
- Static Pods in kube-system: ____
- Controller-owned (not static): ____
- Control plane process that is not a Pod: ____
- Step 4: deleting the kube-scheduler mirror Pod, scheduler stops working? ____
- Step 5: status and Events of a new Pod with no scheduler: ____

## Commands
1. Inventory: `kubectl get pods -n kube-system -o wide`, owner check with `custom-columns=NAME:.metadata.name,OWNER:.metadata.ownerReferences[0].kind`
2. Manifests and kubelet:
   - `docker exec lab-control-plane ls /etc/kubernetes/manifests`
   - `docker exec lab-control-plane grep -i staticPodPath /var/lib/kubelet/config.yaml`
   - `docker exec lab-control-plane systemctl status kubelet --no-pager | head -5`
   - `docker exec lab-control-plane crictl pods` and `crictl ps`
3. controller-manager flags: `kubectl get pod -n kube-system kube-controller-manager-lab-control-plane -o jsonpath='{.spec.containers[0].command}' | tr ',' '\n'`
4. Mirror Pod: delete `kube-scheduler-lab-control-plane`, compare container age with `crictl ps --name kube-scheduler`
5. Remove manifest: `mv /etc/kubernetes/manifests/kube-scheduler.yaml /tmp/`, create Deployment `probe`, observe, move the manifest back, delete `probe`

## What broke
(Symptom as seen. Step 5 is the intended fault: new Pods stuck Pending. Record the exact STATUS and what Events showed.)

## Root cause
(Fill in. Expected: no scheduler running because the kubelet stopped the static Pod once its manifest left the directory.)

## Fix
(Manifest moved back to /etc/kubernetes/manifests. Record how many seconds until the probe Pods bound.)

## Findings
- Static Pods found (owner kind `Node`, node name suffix): ____
- Non-static in kube-system and their owners (CoreDNS, kube-proxy): ____
- Chain: Docker container -> systemd -> kubelet -> containerd -> runc -> containers
- staticPodPath: ____
- controller-manager flags noted (`--controllers`, `--leader-elect`, `--cluster-cidr`): ____
- Mirror Pod delete result (container restarted or not): ____
- Prediction misses: ____

## Gotchas
- `crictl` talks to containerd directly, so it works with the API server down.
- The kubelet is a systemd service on the host, not a Pod, so it never appears in `crictl ps`.
- Deleting a mirror Pod does not stop the real container. The manifest on disk is the source of truth.
- A missing scheduler gives Pending Pods with no events, so the cluster looks quiet rather than broken.
- Do not remove the apiserver or etcd manifests on kind.
