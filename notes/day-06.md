# Day 6: Terminal speed and a multi-node kind cluster

## Commands
- brew install kind kubectl helm jq
- colima stop, then colima start --cpu 4 --memory 8
- added alias k, zsh completion and the do variable to ~/.zshrc, and vim settings to ~/.vimrc
- wrote kind-config.yaml (1 control plane, 2 workers)
- kind create cluster --name lab --config kind-config.yaml
- k get nodes -o wide
- k get pods -A -o wide
- docker ps

## What broke
- Cluster creation

## Root cause
- The cluster creation failed because the kubelet service crash-looped on the worker nodes, hitting the 4-minute kubeadm join health-check timeout.
The underlying technical failure was an exhaustion of kernel file watch handles (inotify limits) inside the Docker Desktop Linux VM on macOS. When kubelet tried to launch cAdvisor to collect node container metrics, the kernel rejected the file registration system call with the error inotify_init: too many open files.

## Fix
- nothingIncrease Kernel File Watch Limits
Run a privileged temporary container to intercept and increase the host Linux kernel properties (max_user_watches and max_user_instances) inside the running Docker Desktop VM.
Docker run --privileged --pid=host debian nsenter -t 1 -m -u -n -i sysctl -w fs.inotify.max_user_watches=524288
docker run --privileged --pid=host debian nsenter -t 1 -m -u -n -i sysctl -w fs.inotify.max_user_instances=512


## Result
- Nodes: FILL IN (expected 3, all Ready)
- Containers in docker ps: FILL IN (expected 3 kind containers, one per node)
- Tab completion on k: FILL IN

## kube-system pods (one line each: node, role)
- etcd: FILL IN
- kube-apiserver: FILL IN
- kube-controller-manager: FILL IN
- kube-scheduler: FILL IN
- kube-proxy (one per node): FILL IN
- kindnet (one per node): FILL IN
- coredns (two): FILL IN

## What I learned
- Each kind node is a Docker container. The cluster lives inside Docker and is rebuilt from kind-config.yaml.
- The control plane runs the decision-makers: API server, scheduler, controller manager and etcd. Workers run the workloads.
- zsh does not split the do variable like bash, so from Day 11 I use the expanded form instead of the plain variable.
