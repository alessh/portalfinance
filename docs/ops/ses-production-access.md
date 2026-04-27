# SES Production Access Runbook

## Overview

AWS SES accounts start in **sandbox mode**, which limits sending to verified
addresses only. To send real verification emails to users you must request
production access.

**Estimated wait:** 1–3 business days.

---

## Step 1 — Verify the sending domain

1. Open the AWS console → **SES** → **Verified identities** → **Create identity**.
2. Select **Domain**, enter your apex domain (e.g. `portalfinance.app`).
3. Add the DKIM CNAME records shown by AWS to your DNS provider.
4. Wait for status to reach **Verified** (usually 5–30 minutes).

> Do NOT use a subdomain for the sending domain. SPF and DKIM alignment
> require the domain to match the `From:` header exactly.

---

## Step 2 — Request production access

1. Go to **SES** → **Account dashboard** → **Request production access**.
2. Fill in the form using the verbatim justification below.

### Verbatim justification template

```
Portal Finance is a Brazilian personal-finance application that helps
middle-class users track spending via Open Finance (Pluggy). We send
transactional emails only: account verification, password reset, and
re-authentication alerts for bank connections.

Estimated monthly send volume: ~5 000 messages in the first 3 months,
growing to ~50 000 at steady state. All emails are triggered by explicit
user actions (signup, password reset, bank re-auth). We do not send
marketing or promotional content.

Bounce handling: We subscribe to SES bounce/complaint SNS notifications
and suppress addresses that hard-bounce or mark as spam within minutes,
before any retry. Our suppression list is backed by a
`ses_suppressions` Postgres table with per-address bounce history.

Compliance: Data is stored in Brazil (AWS sa-east-1, RDS Postgres + ECS Fargate). We follow LGPD
and do not share PII with third parties outside contractual DPAs. We have
a full account-deletion workflow that removes all PII including email
addresses within 30 days of a DSR request.

Technical contact: ops@portalfinance.app
```

3. For **Use case type** select **Transactional**.
4. For **Mail type** select **Transactional**.
5. Submit and wait for approval email.

---

## Step 3 — Create SNS topic for bounce notifications

```bash
# Create topic
aws sns create-topic --name ses-bounces --region sa-east-1

# Note the TopicArn from output — you will need it in Step 4
```

---

## Step 4 — Subscribe the webhook to SNS

```bash
# Replace <TOPIC_ARN> and <YOUR_DOMAIN> with real values
aws sns subscribe \
  --topic-arn <TOPIC_ARN> \
  --protocol https \
  --notification-endpoint https://<YOUR_DOMAIN>/api/webhooks/ses/bounces \
  --region sa-east-1
```

The webhook route (`/api/webhooks/ses/bounces`) handles the
`SubscriptionConfirmation` message automatically by fetching the
`SubscribeURL` returned in the SNS payload. No manual confirmation step
is needed once the app is deployed.

---

## Step 5 — Wire SES to publish bounce events to the SNS topic

```bash
# Create a configuration set (one-time)
aws ses create-configuration-set \
  --configuration-set-name portal-finance \
  --region sa-east-1

# Add SNS event destination for bounces + complaints
aws ses create-configuration-set-event-destination \
  --configuration-set-name portal-finance \
  --event-destination '{
    "Name": "ses-bounces-sns",
    "Enabled": true,
    "MatchingEventTypes": ["bounce", "complaint"],
    "SNSDestination": {
      "TopicARN": "<TOPIC_ARN>"
    }
  }' \
  --region sa-east-1
```

Set the `SES_CONFIGURATION_SET=portal-finance` value on each Copilot service so the email sender attaches the configuration set to every message. Add it under `variables:` in `copilot/web/manifest.yml` and `copilot/worker/manifest.yml`, then `copilot svc deploy` for both.

---

## Step 6 — Wire SES into Copilot

### 6.1 Manifest variables (plain text, committed)

Add to `copilot/web/manifest.yml` and `copilot/worker/manifest.yml` under `variables:`:

| Variable | Value |
|---|---|
| `SES_FROM_EMAIL` | `no-reply@portalfinance.app` (verified domain) |
| `SES_CONFIGURATION_SET` | `portal-finance` |
| `AWS_REGION` | `sa-east-1` |

### 6.2 IAM task role (NO long-lived AWS keys -- D-17 / SEC-02)

Production tasks authenticate to SES via the ECS task role attached by Copilot. Drop a workload-level addon at `copilot/web/addons/ses-send.yml` (and `copilot/worker/addons/ses-send.yml`):

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Parameters:
  App: { Type: String }
  Env: { Type: String }
  Name: { Type: String }
Resources:
  SESSendPolicy:
    Type: AWS::IAM::ManagedPolicy
    Properties:
      Description: !Sub 'Grants ${Name} task role ses:SendEmail / ses:SendRawEmail.'
      PolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Action:
              - ses:SendEmail
              - ses:SendRawEmail
            Resource: '*'
            Condition:
              StringEquals:
                ses:FromAddress: 'no-reply@portalfinance.app'
Outputs:
  SESSendPolicy:
    Value: !Ref SESSendPolicy
```

Copilot auto-attaches any addon output named after a `ManagedPolicy` to the task role. Redeploy the affected services.

`src/lib/mailer.ts` reads no static credentials in production -- the AWS SDK default credential provider chain picks up the task-role STS session automatically. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` MUST stay unset in production.

---

## Verification

After production access is approved and SNS is wired:

1. Sign up with a real email address.
2. Check that the verification email arrives within 10 seconds.
3. Hard-bounce a test address using the SES simulator
   (`bounce@simulator.amazonses.com`) and verify that
   `ses_suppressions` gains a row within 30 seconds.
