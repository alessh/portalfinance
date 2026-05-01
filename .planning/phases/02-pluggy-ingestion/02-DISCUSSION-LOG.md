# Phase 2: Pluggy Ingestion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 02-pluggy-ingestion
**Areas discussed:** Connect & consent flow UX, Tx list + item health & reconnect surfaces, Sync UX (manual button + cooldown + history depth), Transfer/fatura UX + re-auth email cadence, Pluggy SDK + worker plumbing, Schema decisions, Observability metrics, Sandbox + free-tier 2nd-item enforcement

---

## Connect & Consent Flow UX

### Connect entry point
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated /connect route | Stable URL, deep-linkable from emails | ✓ |
| Modal over current page | No URL change, lower friction, harder to deep-link | |
| Settings > Connections only | Enterprise-style, no dashboard CTA | |

### CPF capture
| Option | Description | Selected |
|--------|-------------|----------|
| Inline on consent screen | Atomic with consent grant; LGPD-correct ordering | ✓ |
| Separate step before consent | 2 commits, awkward LGPD ordering | |
| Inside Pluggy widget (OF flow) | Per-item not per-user; breaks the gate | |

### Post-connect destination
| Option | Description | Selected |
|--------|-------------|----------|
| Success screen → raw tx list | 2s/60s polling, progress steps, then /transactions | ✓ |
| Replace demo dashboard with real data | Phase 3 has no categories yet; dashboard would be skeletal | |
| Account detail page | Premature without /accounts being primary | |
| Stay on /connect with success state | Loses Phase-2 first-value moment | |

### Per-item revocation UX
| Option | Description | Selected |
|--------|-------------|----------|
| Settings > Connections + Disconnect button + 2-step modal | Typed-confirmation; LGPD revocation is append-only | ✓ |
| Single 1-click Revoke | Fat-finger risk on irreversible action | |
| Two concepts: Disconnect vs Revoke + delete data | Splits Phase 2 / Phase 6 surfaces; heavier UX in Phase 2 | |

### Institution picker
| Option | Description | Selected |
|--------|-------------|----------|
| Pluggy widget handles it (we hide picker) | Zero-maintenance, absorbs Pluggy connector changes | ✓ |
| Our own curated picker | Brandable; requires us to track connector list | |
| Search-only typeahead | Middle ground; extra API call | |

### CPF validation failure handling
| Option | Description | Selected |
|--------|-------------|----------|
| Inline error, no consent row, no token issued | Clean — no orphan rows | ✓ |
| Server-only validation | Loading flash on every submit | |
| Persistent CPF on retries | (default behavior either way) | |

### Sync-status polling
| Option | Description | Selected |
|--------|-------------|----------|
| Poll /api/sync-status every 2s for 60s max | Honors Success Criterion #1 | ✓ |
| SSE / WebSocket | Over-engineered for Phase 2 | |
| No polling, redirect immediately to /transactions | Loses success-screen moment | |

### First-sync trigger
| Option | Description | Selected |
|--------|-------------|----------|
| onSuccess POSTs /api/pluggy/items → enqueue sync directly | User doesn't wait for webhook retry; webhook is confirmation | ✓ |
| Wait for item/created webhook only | User-stuck UI on retry delay | |
| Both, explicitly idempotent | Same effect as option 1 | |

### Per-connect consent rows
| Option | Description | Selected |
|--------|-------------|----------|
| Per-connect with placeholder, append second row post-widget | Append-only audit; honors P11 literally | ✓ |
| Generic PLUGGY_GLOBAL row, granted once | Doesn't satisfy P11 per-data-source | |
| Full scope known up-front | Doesn't fit hide-picker UX | |

### Multi-account per item
| Option | Description | Selected |
|--------|-------------|----------|
| 1 item → N accounts auto-created visible (free = 1 ITEM, sub-accounts visible) | Aligns with user mental model | ✓ |
| Surface accounts as separate connections | Confusing UX | |
| Defer the decision | Slips Phase 5 work into Phase 2 | |

### Consent version hash
| Option | Description | Selected |
|--------|-------------|----------|
| Hash of (privacy + tos + 'pluggy_connect_v1') | Reuses Phase 1 pattern | ✓ |
| Separate Pluggy consent doc with own version | More docs to maintain | |
| Keep Phase 1 hash unchanged | Loses audit of disclosure changes | |

### MFA handling
| Option | Description | Selected |
|--------|-------------|----------|
| Pluggy widget handles MFA in-iframe; we trust onSuccess only | Smaller surface; widget is the source of truth | ✓ |
| We surface MFA externally | Far more code, more attack surface | |
| Mixed (initial in widget, post-connect external) | Same as option 1 | |

### Reconnect deep-link
| Option | Description | Selected |
|--------|-------------|----------|
| /connect?reconnect={item_uuid}, session-protected, fresh token at click | No token-in-URL leak | ✓ |
| Single-use token in URL | More tables; useful only for bypass-login flows | |
| Plain link to /accounts | Lowest complexity but more clicks | |

### audit_log Phase 2 events
| Option | Description | Selected |
|--------|-------------|----------|
| item_connected, item_disconnected, item_reauth_started/succeeded/failed | 1:1 with user-visible state | ✓ |
| manual_sync_triggered (with cooldown_bypassed flag) | Cost auditing + abuse detection | ✓ |
| transaction_count_changed per sync | High volume; logs/Sentry better | |
| transfer_detected, fatura_detected | Tx-level provenance proof | ✓ |

### Consent disclosure copy
| Option | Description | Selected |
|--------|-------------|----------|
| Plain pt-BR + collapsible "Detalhes legais" | Consistent with app voice | ✓ |
| Formal legal pt-BR with article cites inline | Users won't read | |
| Bilingual toggle | Out of scope (pt-BR only) | |

---

## Tx List + Item Health & Reconnect Surfaces

### Raw tx list shape
| Option | Description | Selected |
|--------|-------------|----------|
| Date-grouped, dense rows, account name as inline metadata | Mirrors Nubank/Mercado Pago | ✓ |
| Group by account, then by date inside | Worse for "one timeline" feel | |
| Flat reverse-chrono table | Power-user; doesn't match middle-class persona | |

### Filters in Phase 2
| Option | Description | Selected |
|--------|-------------|----------|
| Month nav + account filter only | Minimum useful set; reuses Phase 4 pieces | ✓ |
| No filters (latest 100, infinite scroll) | Acceptable but loses month nav | |
| Full DASH-05 set | Premature; fold into Phase 4 | |

### Item-health view location
| Option | Description | Selected |
|--------|-------------|----------|
| Settings > Connections (single canonical page) | Single source of truth | ✓ |
| /accounts + Settings > Connections | Doubles maintenance | |
| Inline at top of /transactions | Hard to find when broken; secondary at best | |

### Status visual + banner
| Option | Description | Selected |
|--------|-------------|----------|
| Per-item pill + persistent global banner when ≥1 item broken | Honors CONN-04 + visibility from any page | ✓ |
| Per-item dot only, no global banner | Misses CONN-04 intent | |
| Per-item pill + email-only notification | Loses real-time visibility | |

### Empty states on /transactions
| Option | Description | Selected |
|--------|-------------|----------|
| Three distinct (no items / syncing / wrong month) with CTAs | Each conveys different action | ✓ |
| Single generic empty state | Worse UX | |
| Skip empty states (block until first sync) | Misses the syncing-visibility moment | |

### Pending vs posted
| Option | Description | Selected |
|--------|-------------|----------|
| Show both, "Pendente" chip on pending | Trust signal; no totals affected | ✓ |
| Hide pending until they post | Loses visibility of recent PIX | |
| Separate pending section above dated list | More work, marginal benefit; defer | |

### Last-synced format
| Option | Description | Selected |
|--------|-------------|----------|
| Relative + absolute on hover/long-press | Quick scan + precise on demand | ✓ |
| Absolute only | Worse for "is this stale?" scan | |
| Relative only | Ambiguous over long ranges | |

### Pagination
| Option | Description | Selected |
|--------|-------------|----------|
| Server-paginated 50/page + "Carregar mais" | Predictable, accessible, no virtualization | ✓ |
| Infinite scroll with useInfiniteQuery | Phase 1 doesn't have it wired | |
| All in selected month | Risk on power-user 500+ tx month | |

### Description text
| Option | Description | Selected |
|--------|-------------|----------|
| Show raw description, no transformation | Phase 3 will normalize; honest until then | ✓ |
| Show description + Pluggy merchant.name | P6 — Pluggy merchants unreliable | |
| Light cleanup inline | Duplicates Phase 3 work | |

### Account balance
| Option | Description | Selected |
|--------|-------------|----------|
| Show current balance per account | Trust signal that sync works | ✓ |
| Hide balance | Less data on screen; conservative | |
| Show with toggle | Premature for Phase 2 | |

### Syncing UI animation
| Option | Description | Selected |
|--------|-------------|----------|
| Pulsing blue dot + "Sincronizando..." text | No spinner (no user wait implied) | ✓ |
| Phase breakdown of executionStatus | More work; revisit if users complain | |
| Generic spinner icon | Less elegant | |

### Item card layout in Settings > Connections
| Option | Description | Selected |
|--------|-------------|----------|
| One card per item, expand to see sub-accounts | Maps to user mental model | ✓ |
| One card per account, no item grouping | Tripled cards for one connection | |
| Compact table, no cards | Doesn't match Phase 1 aesthetic | |

---

## Sync UX — Manual Button, Cooldown, History Depth

### Paid manual sync button
| Option | Description | Selected |
|--------|-------------|----------|
| Always visible; disabled with countdown | Transparent, sets expectations | ✓ |
| Hidden until cooldown clears | User wonders where it went | |
| Click-anyway with rate-limit toast | Spammy backend | |

### Free-tier button
| Option | Description | Selected |
|--------|-------------|----------|
| Show as upgrade-prompt → paywall modal | Drives conversion; supports BILL-04 | ✓ |
| Hide entirely on free | Loses upgrade-prompt opportunity | |
| Show enabled but redirect to paywall | Deceptive | |

### Initial sync depth
| Option | Description | Selected |
|--------|-------------|----------|
| Pull 12 months for everyone; gate display by tier | Free→paid upgrade is instant; rich Phase 4 data | ✓ |
| Pull 3 months free / 12 months paid | More logic; slow upgrade | |
| Pull 12 always; ignore tier gating | Risky if Phase 5 slips | |

### Free-tier window enforcement
| Option | Description | Selected |
|--------|-------------|----------|
| Hard cap: only last 3 months in picker | Doesn't tease upgrade benefit | |
| All months shown; older months gated with paywall card | Drives conversion; feature surface | ✓ |
| No enforcement (Phase 5 territory) | Risky if Phase 5 slips | |

### Active-sync UI on /transactions
| Option | Description | Selected |
|--------|-------------|----------|
| Top banner "Buscando novas transações..." with spinner; auto-dismiss | Trust moment, real-time | ✓ |
| Skeleton loaders for new rows | Overkill for Phase 2 | |
| No indicator on /transactions | Misses trust moment | |

### Free-tier scheduled sync
| Option | Description | Selected |
|--------|-------------|----------|
| Rely on Pluggy's daily auto-sync; trigger nothing | Simplest; matches Pluggy guidance | ✓ |
| Daily cron PATCH /items every healthy free item | Wasted spend; redundant | |
| Smart only-if-stale | TX-06 reconciliation already covers | |

### Reconnect bypasses cooldown
| Option | Description | Selected |
|--------|-------------|----------|
| Yes — reconnect always triggers immediate sync | User just re-authed; expects fresh data | ✓ |
| No — respects cooldown | Inconsistent UX | |
| Yes + toast "next manual sync in 30 min" | Probably overkill | |

### Pluggy 429 user UX
| Option | Description | Selected |
|--------|-------------|----------|
| User-friendly toast; worker retries with Retry-After | Pluggy's rate limit isn't user fault | ✓ |
| Hide entirely, silent retry | Bad for trust if frequent | |
| Surface as item.status='ERROR' with red banner | Misleading | |

---

## Transfer/Fatura UX + Re-auth Email Cadence

### Transfer/fatura UX surfacing
| Option | Description | Selected |
|--------|-------------|----------|
| Inline with chip ("Transferência" / "Pagamento de fatura") | Trust signal; Phase 4 dashboard excludes via flags | ✓ |
| Hidden in main list; dedicated tab | Premature; no totals in Phase 2 | |
| Silent auto-flag, no Phase 2 UI | Loses trust moment | |

### Flag override UI
| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 3 (fold into CAT-03 correction UI) | Keeps Phase 2 scoped | ✓ |
| Per-tx Yes/No chip-toggle in Phase 2 | Duplicates Phase 3 UX | |
| No override, frame as gap | Same effect as option 1 | |

### Detector confidence
| Option | Description | Selected |
|--------|-------------|----------|
| No score; deterministic 100%-match flag | Simple, predictable; P7 well-defined | ✓ |
| Confidence 0–1 stored on transactions | Future-proof; column overhead | |
| Two-tier with user-confirmation chip | Overkill | |

### Re-auth email send timing
| Option | Description | Selected |
|--------|-------------|----------|
| Instant on first item/error; 24h debounce; follow-up at 24h; stop at 7d | Honest; no spam | ✓ |
| Daily digest at 09:00 BRT | Bad for paid product; user wakes to old breakage | |
| Instant always, no debounce | Spam from retry chains | |

### Re-auth email content
| Option | Description | Selected |
|--------|-------------|----------|
| Subject "Reconecte seu {Banco}" + body with institution name + last sync + CTA | Specific, actionable | ✓ |
| Generic "A connection needs your attention" | Lazy | |
| Detailed with missed-tx count | Risky (Pluggy fetch at email time) | |

### Re-auth banner persistence
| Option | Description | Selected |
|--------|-------------|----------|
| Persistent until healthy; not dismissable; survives logout | Mirrors email-verification nag | ✓ |
| Dismissable for 24h via localStorage | User can hide and forget | |
| Banner only on /transactions and /accounts | Limited surface | |

### Banner stack ordering
| Option | Description | Selected |
|--------|-------------|----------|
| Both stack vertically; re-auth on top | Re-auth more urgent | ✓ |
| One at a time, highest priority wins | Loses email-verification visibility | |
| Combined "Pendências" banner with modal | Defer to Phase 6 polish | |

### Reconciliation cron cadence
| Option | Description | Selected |
|--------|-------------|----------|
| Hourly cron — items where last_synced_at < now-12h | Honors TX-06 + alerts at >5 stale | ✓ |
| Every 6 hours | Worst-case 18h staleness | |
| On worker startup only | Misses stalled-while-up cases | |

---

## Pluggy SDK + Worker Plumbing

### SDK choice
| Option | Description | Selected |
|--------|-------------|----------|
| pluggy-sdk@0.85 + react-pluggy-connect@2.12 | Both official, both typed | ✓ |
| Raw fetch with hand-rolled types | Reinvents the SDK; type drift | |
| pluggy-sdk + raw iframe URL (no widget wrapper) | Loses lifecycle hooks | |

### Encryption surface
| Option | Description | Selected |
|--------|-------------|----------|
| Encrypt only pluggy_item_id at rest | Matches CONN-07 + P4 minimum viable | ✓ |
| Encrypt item_id + payload fields | Heavy; webhook payload is short-lived | |
| Field-level encrypted JSON column | Too complex, hard to query | |

### pg-boss singleton key
| Option | Description | Selected |
|--------|-------------|----------|
| singletonKey=user_id, singletonHours=0 | Per-user concurrency=1 | ✓ |
| Per-item singletonKey | Risk: 5 items × 1000 users → bursts | |
| No singleton; localConcurrency only | Doesn't address per-user storms | |

### Webhook secret storage
| Option | Description | Selected |
|--------|-------------|----------|
| PLUGGY_WEBHOOK_SECRET in env (SSM SecureString) | Matches Phase 1 pattern | ✓ |
| Per-environment rotation table in DB | Phase 6 territory | |
| Combined with Cloudflare IP allowlist (additive) | Treated as additive — both will be implemented | |

---

## Schema Decisions

### pluggy_items shape
| Option | Description | Selected |
|--------|-------------|----------|
| Encrypted item_id (bytea) + SHA-256 hash + status enum + execution_status free text | Matches CPF pattern; enum invariant | ✓ |
| Plaintext pluggy_item_id | Violates CONN-07 | |
| Status as text not enum | Loses DB-level invariant | |

### accounts shape
| Option | Description | Selected |
|--------|-------------|----------|
| user_id duplicated for IDOR + status enum [ACTIVE,FROZEN,DELETED] now | FROZEN supports Phase 5 BILL-04 without future migration | ✓ |
| Same minus FROZEN status (defer) | Pattern Phase 1 used: ship enum early to avoid late migration | |

### transactions shape
| Option | Description | Selected |
|--------|-------------|----------|
| Full schema with raw_payload + partial index for Phase 4 hot path | Future-proofs Phase 4 dashboard | ✓ |
| Same minus partial index | Slight risk Phase 4 forgets | |
| Skip raw_payload | Loses replay/debug; rate limits prevent re-fetch | |

### category_id placeholder
| Option | Description | Selected |
|--------|-------------|----------|
| Nullable text slug; Phase 3 migrates to UUID FK | Keeps Phase 3 schema out of Phase 2 | ✓ |
| Categories table stub in Phase 2 | Pre-seeds the relationship | |
| Nullable UUID pointing nowhere | Phase 3 ALTER concern at scale | |

---

## Observability Metrics

| Option | Description | Selected |
|--------|-------------|----------|
| Pino structured logs at every state transition | Queryable via CloudWatch Insights | ✓ |
| OpenTelemetry custom counters/histograms | Phase 6 territory | |
| Sentry custom transactions for each sync | Distributed trace + perf data | ✓ |
| Light structured-log only — defer instrumentation depth to Phase 6 | Sets the *level*: ship logs+Sentry-tx; defer dashboards/OTel/alerts | ✓ |

**Synthesis (per Claude):** Phase 2 ships pino logs + Sentry custom transactions. OTel + dashboards + alert thresholds → Phase 6.

---

## Sandbox + Free-Tier 2nd-Item Enforcement

### Test strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Unit-mocked + nightly integration against sandbox | Fast feedback + real contract checks | ✓ |
| All tests against sandbox | Slow; 30-day expiry breaks fixtures | |
| All tests mocked | Mocks decay vs real Pluggy | |

### Free user 2nd item
| Option | Description | Selected |
|--------|-------------|----------|
| Soft-block: connect succeeds, 2nd item FROZEN, paywall card | Doesn't waste user effort; mirrors BILL-04 | |
| Hard-block: 2nd connect redirects to paywall before widget | Saves Pluggy spend; stages Phase 5 cleanly | ✓ |
| No enforcement (Phase 5 territory) | Risky if Phase 5 slips | |

---

## Claude's Discretion (not asked)

- PluggyService class shape and method surface
- Webhook receiver implementation pattern (route handler is thin; logic in worker)
- Webhook event → worker queue mapping
- Cursor pagination for transactions sync
- Sync window logic (initial = 12mo; incremental = last_synced_at - 7d; reconnect = 12mo refresh)
- subscription_tier read pattern (session-cached, no Phase 2 invalidation needed)
- CPF NOT-NULL migration (two-step in Phase 2 first plan)
- audit_log schema unchanged
- Frontend state management (TanStack Query + RHF + Zod, all Phase 1)

## Deferred Ideas

- Transfer/fatura override UI → Phase 3
- Skeleton loaders, balance hide-toggle, executionStatus phase breakdown → Phase 4 polish
- OpenTelemetry, Sentry per-user transaction tags, free-tier scheduled cron beyond Pluggy auto-sync, encrypted webhook_events.payload, admin views, feature flags → Phase 6
- Categories table + FK migration → Phase 3 (CAT-01..06)
- Real paywall modal → Phase 5 (BILL-04)
- Full deletion workflow + DSR export → Phase 6 (LGPD-03/04)
- Full DASH-05 free-text search filter → Phase 4
- Multi-region read replicas → out of scope (v1 single sa-east-1)
