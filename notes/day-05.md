# Day 5: CI builds and pushes on every commit

## Commands
- mkdir -p .github/workflows, then wrote .github/workflows/build.yml
- git add .github, git commit, git push
- gh auth refresh -h github.com -s workflow, then gh auth setup-git, then git push
- gh run watch (or the Actions page)
- git rev-parse HEAD
- docker pull ghcr.io/hardeepm-gh/app:<commit-sha>

## What broke
- The first git push was rejected: refusing to allow a Personal Access Token to create or update workflow .github/workflows/build.yml without workflow scope.
- FILL IN anything else that failed in the Actions run

## Root cause
- GitHub protects workflow files. The credential cached on my Mac had no workflow scope.

## Fix
- Refreshed the GitHub CLI login with the workflow scope, ran gh auth setup-git, and pushed again.
- FILL IN any other fix, such as workflow permissions set to Read and write

## Result
- Actions run: FILL IN (expected a green check)
- Package tag: FILL IN (expected to equal the output of git rev-parse HEAD)
- Package visibility: FILL IN (expected Public)
- docker pull with no login: FILL IN (expected success)

## What I learned
- Tagging by commit SHA ties every image to exactly one commit, so any build can be rolled back to. latest cannot do that.
- actions/checkout@v4 pins a mutable tag. Production pipelines pin third-party actions to a full commit SHA to limit supply-chain risk.
- The workflow authenticates with the built-in GITHUB_TOKEN, so there is no stored registry credential to leak.
- The package must be public because the Week 8 kubeadm VMs pull it without credentials.
