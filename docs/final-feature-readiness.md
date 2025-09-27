# Final Feature Readiness Tracker

_Last updated: 2025-01-15_

## 1. Objective
Track the remaining feature work required before we containerize and promote the application to staging. The immediate focus is on the payments experience (Billing & Payments dashboard, transaction workflows), followed by check-ins, calendar, messaging, and reporting.

## 2. Feature Snapshot
| Feature Area | Pages / Views | Current Status | Key Dependencies | Notes |
| --- | --- | --- | --- | --- |
| Payments | Billing Dashboard, Payment Form, Methods, Confirmation, History, Settings, Refunds, Disputes | UI mockups delivered (see Figma); backend integration pending | Payment processor SDK, secure vault for keys, transaction schema | Primary focus; blocks invoicing + revenue metrics. |
| Check-ins | Check-in scheduler, attendance log, compliance alerts | Needs UI wiring + API endpoints | Calendar utilities, notification service | Should follow payments to leverage shared scheduling primitives. |
| Calendar | Global schedule, court dates, staff allocation | Design assets ready; no data plumbing yet | Time-zone handling, ICS export optional | Supports both check-ins and case management. |
| Messages | Inbox, templates, automated reminders | Messaging provider decision outstanding | Notification gateway (Twilio, SendGrid, etc.) | Coordinate with compliance for logging/retention. |
| Reports | KPI overview, export to CSV/PDF | Data queries partially covered by dashboard APIs | Reporting engine, role-based data filtering | Align with SOC2 evidence requirements. |

## 3. Payments Implementation Plan
1. **Data + API Foundations**
   - Define `Payment` schema (Mongo) with transaction references, status enum, audit timestamps.
   - Expose `/api/payments` endpoints (list, detail, create, refund, dispute) and secure with role checks.
   - Extend Swagger spec for new routes.
2. **Processor Integration**
   - Select provider (see §5) and implement server-side webhooks for payment events.
   - Store processor customer/payment method IDs; rely on provider vault for PCI scope reduction.
   - Map webhook events to internal state transitions (`pending` → `completed`/`failed`).
3. **Frontend Wiring**
   - Connect Billing Dashboard metrics to `/api/payments/metrics` endpoint.
   - Implement Payment Form with tokenized card entry; use provider SDK (Stripe Elements or similar).
   - Surface transaction tables (paged queries, filters) and quick actions (refund, disputes).
4. **Security & Compliance**
   - Enforce TLS-only communication; no card data persisted locally.
   - Configure role-based visibility (finance/admin only) and audit logging.
   - Update `Schema_Authentication.md` with payment roles (e.g., BillingManager).
5. **Testing & QA**
   - Unit tests for payment service + webhook handlers.
   - End-to-end happy-path: create payment, refund, dispute resolution.
   - Negative scenarios: declined card, webhook replay, unauthorized access.
6. **Documentation & Training**
   - Playbooks for operations (refund policy, dispute flow).
   - Update go-live checklist with payment gateway credentials and runbooks.

## 4. Payments Checklist (Pre-Staging)
- [ ] Choose processor and obtain sandbox credentials.
- [ ] Implement backend payment models, CRUD endpoints, and service layer.
- [ ] Configure webhook endpoint with signature validation.
- [ ] Wire frontend components (dashboard widgets, transaction list, forms) to API responses.
- [ ] Add environment variables to `.env.example` (API keys, webhook secret, currency settings).
- [ ] Write automated tests (unit + integration) and add manual QA script.
- [ ] Document refund/dispute SOP and share with operations.
- [ ] Capture SOC2 evidence: architecture diagram, data flow, control owners sign-off.

## 5. Provider Comparison & Recommendation
| Provider | Typical Fees* | Integration Effort | Feature Highlights | Considerations |
| --- | --- | --- | --- | --- |
| **Stripe** | 2.9% + $0.30 (cards); ACH ~0.8% capped at $5 | Low — mature REST API, SDKs, prebuilt UI (Elements) | Cards, ACH, payment links, subscription support, hosted onboarding | Requires PCI SAQ-A compliance only (tokenized); instant sandbox; strong dispute tooling. |
| **Clover** | ~2.6% + $0.10 (depends on plan) + monthly hardware/app fees | Medium/High — designed for POS; API access requires partner program | Hardware terminals, in-person focus, inventory tools | Better for retail storefronts; online API access limited; higher fixed costs. |
| **Square** | 2.6% + $0.10 (card-present), 2.9% + $0.30 (card-not-present) | Medium — good web SDKs, but less flexibility than Stripe | POS + online, invoicing, virtual terminal | Useful if in-person payments dominate; developer tooling improving but fewer advanced workflows. |
| **PayPal / Braintree** | 2.9% + $0.30 | Medium — solid APIs, hosted checkout | PayPal wallet, cards, vault | Fees similar to Stripe; broader customer recognition; dispute process more manual. |

\*Fees vary by volume/industry; negotiate for lower rates once transaction volume is known.

**Recommendation:** Start with **Stripe** for staging/production. It offers the fastest path to market, excellent developer tooling, ACH support (useful for bond payments), automated dispute handling, and easy SOC2 evidence (audit logs, PCI compliance documentation). Loop back to evaluate Clover/Square if physical terminal integration becomes mandatory.

## 6. Best Practices for Payments Feature
- Tokenize payment instruments; never log PAN or CVV.
- Serve all payment pages over HTTPS and enforce HSTS.
- Store minimal PII; link transactions via internal IDs for audit.
- Log payment lifecycle events with correlation IDs for reconciliation.
- Implement idempotency keys on payment creation to prevent duplicates.
- Rate-limit sensitive endpoints (refunds, disputes) and enforce MFA for finance roles.
- Set up monitoring and alerting on webhook failure rates and chargeback thresholds.
- Regularly reconcile processor payouts with internal ledger; consider nightly jobs.

## 7. Next Up After Payments
1. **Check-ins:** integrate scheduling service, push reminders (SMS/Email), audit trail for attendance.
2. **Calendar:** merge case events, check-ins, and court dates with timezone-aware components.
3. **Messages:** select communications provider (Twilio/SendGrid), implement template management, ensure retention compliance.
4. **Reports:** finalize data sources, build export flows, integrate with go-live compliance checklist.

## 8. Progress Log
- **2025-01-15:** Added `/api/payments` route family with placeholder data, updated role permissions (`billing:*`), published OpenAPI schemas, and introduced `Payment` model scaffold for upcoming Stripe integration.
- **2025-01-15:** Connected payment UI screens to backend stubs (React Query hooks for metrics, history, methods, refunds, disputes), replacing mock data and enabling toast-driven mutation flows.

---
Primary owner: Application Engineering. Update this tracker as each milestone is completed.
