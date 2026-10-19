k8s-admin-lab

A 55-day, hands-on Kubernetes administration lab. It goes from building container images to a kubeadm cluster rebuilt from scratch in under two hours, with a three-tier app, Gateway API, NetworkPolicy, RBAC, etcd backup and restore, and monitoring. Every session has a pass/fail check and a note on what broke and why.

Scope is the current CKA exam plus the TechWorld with Nana Kubernetes administrator roadmap. The proof of work is in two places: the cold-rebuild path below and the logs in notes/.

What this covers
Exam domain	Weight	Days
Troubleshooting	30%	21-25, 42-45, 54
Cluster architecture, installation, configuration	25%	6-10, 26-29, 36-41, 46-53
Services and networking	20%	12, 16-17, 23, 44-46
Workloads and scheduling	15%	11, 13-15, 18-20
Storage	10%	30-33

Weights come from third-party 2026 study guides; confirm them on the Linux Foundation page.

Deliberately out of scope: service mesh, GitOps (Argo CD, Flux), cert-manager and TLS automation, VPA, multi-cluster, eBPF-specific CNI features, a multi-control-plane build (Day 53 is a paper design), cloud IAM beyond what eksctl creates, and CKS-level security tooling.

Repo map
Path	Purpose	Days
app/	Three-tier app: Node API with /health and /db, plus Dockerfile	1-5
.github/workflows/build.yml	Build and push the image to ghcr on every commit	5
kind-config.yaml	One control plane, two workers	6
k8s/	Plain manifests: workloads, services, Gateway, policies, StatefulSet	11-33
chart/app/	Helm chart for api, web, db, and routes, with dev and prod values	27-32
kustomize/	Base and dev/prod overlays	29
chaos.sh	Random fault injector for blind troubleshooting drills	25
bootstrap.sh	Node preparation and kubeadm install for the Multipass VMs	36-55
notes/	One log per day: day-NN.md	all
Prerequisites
16 GB RAM and 40 GB free disk minimum; Linux, macOS or WSL2. On a 16 GB host, delete the kind cluster before Week 8. Skip Prometheus in the capstone unless you have 32 GB.
Docker, kind, kubectl, Helm, jq, git, Multipass. For Day 41: AWS CLI and eksctl.

Versions used (fill in as you go):

Tool	Version
Kubernetes (kind, Weeks 1-7)	v1.37.0
Kubernetes (kubeadm, N-1 then N)	TBD
Calico	TBD
Envoy Gateway	TBD
Helm	TBD
etcd	TBD
Quick start (kind)
docker build -t app:1 app/
kind create cluster --name lab --config kind-config.yaml
kind load docker-image app:1 --name lab
kubectl create ns dev
helm install app chart/app -n dev -f chart/app/values-dev.yaml

Install Envoy Gateway and apply k8s/gateway.yaml first (Day 17), then reach the app through a port-forward to the generated proxy Service.

Cold rebuild (kubeadm)

The capstone path. Run in order and record the time for each step in notes/day-55.md.

Create three Multipass VMs (cp 3 GB, w1 and w2 4 GB) and run bootstrap.sh on each.
kubeadm init on cp, install Calico, join both workers.
Install local-path storage and make it the default StorageClass.
Install Envoy Gateway, apply the GatewayClass and Gateway.
Install the chart from the ghcr image into dev.
Apply the Pod Security label and the NetworkPolicies.
Create the ci-deployer Role and the alice certificate user.
Install metrics-server and the HPA.
Apply the pg_dump CronJob.
Take an etcd snapshot and store the encryption config beside it.

Target: under 2 hours.

Progress
Week	Theme	Status	Notes
1	Containers	Not started	notes
2	Architecture, seen live	Not started	
3	Core workloads	Not started	
4	Traffic in, scaling, placement	Not started	
5	Break it, then fix it	Not started	
6	Packaging and storage	Not started	
7	State and observability	Not started	
8	Build the cluster with kubeadm	Not started	
9	Managed Kubernetes, cluster troubleshooting	Not started	
10	Policy, access, recovery	Not started	
11	Extensibility, design, exam, capstone	Not started	
Architecture

TBD: diagram of the three-tier app (web, api, db), the Gateway in front, and the cluster layout (one control plane, two workers).

Decision log
Decision	Reason
Gateway API with Envoy Gateway, plus one Traefik Ingress exercise	ingress-nginx was retired upstream in March 2026. Gateway API is in the current exam scope.
kind for Weeks 1-7, kubeadm from Week 8	Fast iteration first. kubeadm is where install, upgrade, cert and etcd work actually happens.
local-path storage	Zero setup on kind and kubeadm. Trade-off: no volume expansion and no RWX.
One StatefulSet DB, then a CloudNativePG operator	Shows what a StatefulSet does not give you: replication and failover.
Application backup (pg_dump) separate from cluster backup (etcd)	They protect different failures. Neither covers the other.

Add entries as you make real decisions.

Results
Measure	Result
Capstone cold rebuild time	TBD
etcd restore time (RTO)	TBD
Database failover time (CloudNativePG)	TBD
Timed drill score (Day 54)	TBD of 12
Gaps from the capstone retro	TBD
Notes convention

Each notes/day-NN.md has four parts:

Commands: what you ran, in order.
What broke: the symptom as you saw it.
Root cause: what was actually wrong.
Fix: what resolved it.
Gotchas

A running list of surprises and how you solved them. Add to it during the lab.

Security hygiene

Never commit these. They are in .gitignore:

.env
kubeconfig files
alice.key, alice.csr, alice.crt
/etc/kubernetes/enc/enc.yaml and any copy of it
etcd snapshot files (*.db)

Credentials in the examples (change-me, pw) are lab placeholders only.# k8s-admin-lab
