# Cloudflare WAF rule for Pluggy webhook (defense-in-depth)

**Plan:** 02-04 Task 1  
**Status:** Manual deployment — not blocking for plan 02-04 acceptance  
**Scheduled:** Phase 6 hardening if not done sooner  

---

## Why

Pluggy publishes a single static IP for outbound webhook requests:
**`177.71.238.212`** (https://docs.pluggy.ai/docs/webhooks)

Our in-app constant-time header compare (`X-Pluggy-Signature` vs `PLUGGY_WEBHOOK_SECRET`) is
the primary defense (D-42). This Cloudflare WAF rule is **defense-in-depth** — a belt-and-braces
layer that rejects requests from non-Pluggy IPs at the edge before they ever reach the application
server.

LOW risk per RESEARCH.md: forged requests that bypass Cloudflare still fail the in-app signature
check. The WAF rule provides an extra signal for intrusion detection (Cloudflare logs blocked
requests) and reduces unnecessary compute + DB load.

---

## Step-by-step: Cloudflare Dashboard

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Select the **portalfinance.app** zone.
3. Navigate to **Security → WAF → Custom rules**.
4. Click **Create rule** (top right).
5. Enter the following configuration:

   | Field | Value |
   |-------|-------|
   | Rule name | `Block non-Pluggy IPs on /api/webhooks/pluggy` |
   | Expression | (see below) |
   | Action | **Block** |

6. In the **Expression** box, paste:

   ```
   (http.request.uri.path eq "/api/webhooks/pluggy" and ip.src ne 177.71.238.212)
   ```

   This blocks any request to the Pluggy webhook endpoint whose source IP is NOT Pluggy's
   published IP.

7. Click **Deploy**.

---

## Verification (after deployment)

Run from a non-allowlisted IP (e.g., your laptop or a test server):

```bash
curl -i -X POST https://www.portalfinance.app/api/webhooks/pluggy \
  -H "Content-Type: application/json" \
  -H "X-Pluggy-Signature: test-secret" \
  -d '{"event":"item/created","eventId":"evt_waf_test"}'
```

Expected response:

```
HTTP/2 403
...
<error page from Cloudflare>
```

A `403` from Cloudflare (not from our app) confirms the WAF rule is active.

---

## Notes

- If Pluggy ever changes its IP, update the WAF expression. Pluggy's current IP is published at
  https://docs.pluggy.ai/docs/webhooks. Subscribe to Pluggy changelog notifications.
- The `in-app X-Pluggy-Signature` check is NOT removed even with this WAF rule in place.
  Defense-in-depth requires both layers. The signature check is the authoritative gate;
  WAF is belt-and-braces.
- Cloudflare logs blocked requests under **Security → Overview → Events**. Alert thresholds
  for unexpected block spikes can be configured under **Notifications** in Phase 6.

---

*Last updated: 2026-05-02 (Plan 02-04)*
