  ---
  CHECKPOINT: human-action

  Plan: 01.1-00 — Copilot CLI + IAM Identity Center SSO setup
  Task: 1 of 2 (Install AWS Copilot CLI and configure IAM Identity Center SSO per D-17)

  This task can ONLY be done by you — it's browser-based AWS console work + local CLI installation that I cannot perform.

  What you need to do

  1. Install AWS Copilot CLI ≥ v1.34.1 on Windows

  winget install Amazon.AWSCopilotCLI
  # OR download from: https://github.com/aws/copilot-cli/releases/latest

  Verify: copilot --version should print copilot version: v1.34.1 or newer.

  2. AWS Console → IAM Identity Center (in the Portal Finance AWS account, region sa-east-1)

  - Enable IAM Identity Center if not already enabled
  - Create permission set named exactly AdministratorAccess (attach AWS-managed AdministratorAccess policy)
  - Assign your developer user to the Portal Finance account with that permission set
  - Copy the AWS access portal URL (e.g. https://d-xxxx.awsapps.com/start)

  3. Configure local SSO profile

  aws configure sso
  # SSO start URL: <paste portal URL>
  # SSO region: sa-east-1
  # Default client region: sa-east-1
  # Default output: json
  # CLI profile name: portalfinance-prod

  4. Verify

  aws sso login --profile portalfinance-prod
  aws sts get-caller-identity --profile portalfinance-prod

  The ARN MUST be arn:aws:sts::<account-id>:assumed-role/AWSReservedSSO_AdministratorAccess_*/... — NOT a static IAM user. And ~/.aws/credentials must NOT contain aws_access_key_id for portalfinance-prod (SSO caches under ~/.aws/sso/cache/
  automatically).

