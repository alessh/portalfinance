# AWS Copilot Setup Runbook - Portal Finance Phase 01.1

> Replaces `docs/ops/railway-setup.md` (Railway has no BR region; see STATE.md 2026-04-24 entry).

**Audience:** Developer provisioning the production Portal Finance AWS environment.
**Phase:** 01.1 (Infra Bootstrap - AWS sa-east-1 via Copilot).
**Status of automation:** Manifest + addon CFN templates are committed under `copilot/`. The remote AWS provisioning steps (env deploy, secret init, svc deploy, ACM + DNS) are operator-driven via the AWS Copilot CLI.

---

## 0. Prerequisites (Wave 0 of Phase 01.1)

The Copilot CLI talks to AWS using the developer's local SSO session. No long-lived IAM access keys are permitted (D-17). Complete sections 0.1 through 0.4 once per developer machine before any later plan in this phase is executed.

### 0.1 Install AWS Copilot CLI (>= v1.34.1)

| OS | Install |
|----|---------|
| macOS | `brew install aws/tap/copilot-cli` |
| Windows | `winget install Amazon.AWSCopilotCLI` or binary from GitHub releases |
| Linux | `curl -Lo /usr/local/bin/copilot https://github.com/aws/copilot-cli/releases/latest/download/copilot-linux && chmod +x /usr/local/bin/copilot` |

Verify: `copilot --version` must print `copilot version: v1.34.X` or newer.

### 0.2 IAM Identity Center SSO (mandatory -- NO long-lived IAM keys per D-17)

1. In the Portal Finance AWS account (the same account holding SES sa-east-1 identity), enable **IAM Identity Center** in region `sa-east-1`.
2. Create a permission set `AdministratorAccess` (AWS-managed policy `AdministratorAccess` attached).
3. Assign the developer user to the Portal Finance account with the `AdministratorAccess` permission set.
4. Copy the **AWS access portal URL** (e.g. `https://d-xxxx.awsapps.com/start`).

### 0.3 Configure local profile `portalfinance-prod`

```sh
aws configure sso
# SSO start URL: <paste portal URL from 0.2.4>
# SSO region: sa-east-1
# Default client region: sa-east-1
# Default output: json
# CLI profile name: portalfinance-prod
```

### 0.4 Daily login

```sh
aws sso login --profile portalfinance-prod
aws sts get-caller-identity --profile portalfinance-prod
```

Expected output: `"Arn": "arn:aws:sts::<account>:assumed-role/AWSReservedSSO_AdministratorAccess_*"`.

**NEVER** store `aws_access_key_id` for this profile in `~/.aws/credentials` -- SSO caches the short-lived session under `~/.aws/sso/cache/` automatically.

## 1. Hard Constraint: Brazilian Territory (LGPD-05)
<!-- Populated by Plan 01.1-05 -->

## 2. Service Topology
<!-- Populated by Plan 01.1-04 -->

## 3. Environment Variables
<!-- Populated by Plan 01.1-05 -->

## 4. Migration Workflow
<!-- Populated by Plan 01.1-06 -->

## 5. Rollback / Halt Procedures
<!-- Populated by Plan 01.1-08 -->

## 6. Worker / Web Operational Notes
<!-- Populated by Plan 01.1-08 -->

## 7. Documentation of Manual Steps
<!-- Populated by Plan 01.1-08 -->
