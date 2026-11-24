# AGENTS.md: Wortyfy

Instructions for the coding agent. Read this file at the start of every session.

Wortyfy is a multi-tenant e-commerce platform for Pakistan. One Next.js app on Cloudflare Workers serves four surfaces: the marketing site, the merchant dashboard, each merchant's storefront, and the platform admin panel. A store is the tenant. Prices are in PKR only.

## 1. How a session works

1. You are given one task (an ID like T4.7 from the Step 10 build plan), this file, Step 0, the two Reconciliation documents, and the spec files named on the task row. Do not go looking for other specs. If you need one, ask.
2. Start by restating: the task, the requirement IDs (REQ-...) and acceptance tests you will satisfy, and the files you expect to change.
3. Build it. Write the tests named in the spec before or with the code.
4. Finish with the report in section 12. Never say a task is accepted. The owner accepts it.

## 2. Which document wins

1. The latest approved amendment (the Reconciliation documents) wins.
2. Then the step document that owns the topic.
3. Then Step 0.

If the spec is silent, or two documents disagree and the Reconciliations do not settle it: **stop and ask.** Never invent a rule, field, number, email text or permission. Report the conflict in your report.

## 3. Hard rules (each maps to a requirement; none may be bent)

Tenancy and permissions
- The store comes only from the URL path (dashboard) or the resolved hostname (storefront). Never read a store id, role or user id from a body, query string or header (REQ-AUTH-02).
- Every dashboard page, server action and API route starts with requirePermission(ctx, key). Non-member gets 404, member without the permission gets 403. A record from another store behaves exactly like a missing record (REQ-AUTH-01, 14).
- Permission keys and role maps live only in src/lib/auth/permissions.ts. Never write a key as a string anywhere else.
- Every write path calls assertStoreWritable(store), except billing and export (REQ-AUTH-05).
- Every tenant query runs inside withTenant and filters by store_id. Row-level security is on in every environment; you connect as the tenant role, never as an owner.
- Never check a plan name. Gate features and limits only with hasFeature(store, key) and getLimit(store, key) (REQ-PLAN-01).

Data and money
- Money is numeric(12,2) PKR, handled as strings in the database layer and with a decimal library in code. Never use floating point on money. Round half up. Use formatPKR and parsePKR.
- The server decides every price, discount, shipping charge, total and stock level. The browser only displays. Ignore any price, total or store id in a request body (REQ-STF-02).
- Order status fields change only through the orders service functions. Payment status is set only by derivePaymentStatus. Payments are written only by recordPayment and refunds only by recordRefund.
- Stock changes only through the inventory service helpers (takeStock, returnStock, adjustStock, takeBundleStock), as one atomic update plus an inventory_movements row. Stock is never read then written.
- Phones go through normalizePhone and are stored as E.164 (+92...). Dates use the store time zone through the date helper.
- Handles come from the one slugify function. Blank SKUs are stored as NULL.

Audit, email and jobs
- Audit entries are written in the same transaction as the change they describe. Action names are domain.verb from the catalog. Never log passwords, tokens, credentials or full bank or card numbers (REQ-AUTH-13).
- Emails are sent only through sendEmail, queued after the transaction commits. An email failure never rolls back the action. Skip conditions are checked when the email is sent. Merchant and shopper values are escaped in every template.
- Background jobs take an explicit storeId, are idempotent, skip demo stores, write a heartbeat, and re-check their condition when they run.
- In-app notifications are created only through notify().

Security
- State-changing requests need a matching Origin or Referer host. GET handlers never write data (read-only impersonation depends on it).
- Any user-supplied URL is fetched only with safeFetch (https, public addresses only, checked after every redirect, 3 redirects, 15 seconds, 5 MB).
- Rich text is sanitized on the server on every save with the 4A allowlist. Reviews, notes and names are plain text, escaped on output. SVG is sanitized. CSV exports neutralise cells starting with =, +, - or @.
- Rate limits are read only from src/lib/security/rate-limits.ts. Never put a limit number in a route. Security limiters fail closed; convenience limiters fail open and alert.
- Secrets live only in Workers secrets. Never commit a secret, print one, or put one in a client bundle. Tokens and codes are random, stored only as SHA-256 hashes, and compared in constant time.
- Cached storefront pages carry no inline scripts and no nonce. Private no-store routes use nonces. The order page sends no-referrer, noindex and no-store.
- Merchants never supply HTML, CSS or scripts for a storefront. Only validated design tokens, fixed sections and sanitized text are rendered.

Interface
- Every UI string comes from the message catalog (English, plus Urdu for storefront and shopper emails). No sentence is built by joining strings. A lint rule enforces it.
- Every list and detail screen ships with loading, empty, error and read-only (suspended store) states.
- Dashboard responses send X-Robots-Tag noindex and Cache-Control private, no-store.

## 4. Do not build

- Anything marked Phase 1.5 or Phase 2 in Step 0: JazzCash, Easypaisa, card payments, courier booking APIs, abandoned-cart emails, campaigns, per-store sending domains, automated WhatsApp, multi-location inventory, tax, public API, WooCommerce import.
- A custom CSS, custom HTML or custom script feature (theme_configs.custom_css is dropped).
- Free-text testimonials sections. Reviews come from real or labelled imported reviews only.
- A plan-name check, a client-side price calculation, a second status or stage mapping, or a second copy of the permission map.
- Anything the spec lists under "not in the MVP".

## 5. Facts you must not guess

- Courier tracking link templates ship as null until verified on each courier's own site. Do not invent a URL.
- Vendor limits, prices and thresholds (Cloudflare, Supabase, AWS SES) are marked "verify" in the specs. Mark them in code comments and in your report. Do not hard-code a vendor number as fact.
- Legal wording, the business legal name and address, bank and Raast details, and the canonical Pakistan city list come from the owner. Use the configuration value; the build fails if a required value is empty at launch checks.

## 6. Database and migrations

- schema.ts is the source of truth, and it already includes every ledger. Generate migrations with drizzle-kit; custom SQL files 001 to 004 run in order (extensions; generated tables; constraints and triggers; roles and RLS).
- Every tenant table carries store_id, a UNIQUE (store_id, id), composite foreign keys to parents, and indexes that start with store_id.
- A table with a store_id must be listed in the TENANT_TABLES registry as purged or retained, with its RLS class. The registry test fails otherwise.
- Dropping a column takes two releases. Destructive migrations need a fresh backup the same day. Never run a migration against production yourself.

## 7. Code layout

Paths follow the Step 10 plan, section 4.2: src/app/(marketing), (dashboard), (admin), sites/[storeId]; src/db; src/lib/auth, security, settings, analytics, platform, orders, catalog, discounts, shipping, billing, email, logging; src/messages; tests. Put new code in the module the spec names. If no module is named, ask.

## 8. Performance budgets (CI fails when exceeded)

- Storefront: LCP 2.5 s or less p75 mobile, CLS 0.1 or less, INP 200 ms or less. JavaScript 120 KB (home, collection, search, pages) and 170 KB (product, cart, checkout), compressed. At most 2 font files. First image 80 KB or less and priority-loaded. Cached TTFB 300 ms or less at the edge.
- Dashboard: 250 KB compressed JavaScript per route; lists usable in 3.5 s on a mid-range Android over 4G.
- Marketing site: 200 KB JavaScript, HTML and CSS; hero 80 KB.
- Each request creates its own database client with at most 5 connections. No sequential scan over a tenant table above 10,000 rows in the listed queries.

## 9. Testing rules

- Name the vectors and acceptance tests from the spec in your tests. All must pass. Pure functions (calculateDiscounts, quoteShipping, quoteInvoice, getOrderStage, derivePaymentStatus, nextBillingTransition) have no database access and have property tests where the spec asks.
- Concurrency is tested on a real database: last unit, last discount use, double click on place order, double proof verification, founding claims.
- Never weaken or delete a failing test to make it pass. Fix the code or report the conflict.
- Every new route and server action is added to the cross-store walk and the generated authorization matrix.

## 10. Style

- TypeScript strict, no any without a comment explaining why. Server components by default; client code only for interaction. Small functions, named after the spec (createStore, placeOrder, recordPayment).
- Comments explain why, and cite the requirement ID when a rule is not obvious. No dead code, no commented-out code, no TODOs that touch money, permissions or tenancy.
- Keep each change small and focused on the task. Do not refactor unrelated files.

## 11. Stop and ask when

- The spec is silent or two documents disagree.
- A task needs a file, decision or credential you were not given.
- Meeting a requirement would break another one.
- You find a security or tenancy problem outside your task. Report it; do not fix it silently.
- A vendor behaviour differs from what the spec assumes.

## 12. Report format (end of every session)

Task: ID and title.
Changed: files and a one-line reason each.
Requirements met: REQ IDs.
Tests: which ran, results, and which vectors or acceptance tests they cover.
Not done or deferred: anything left, and why.
Questions and conflicts: anything you stopped on.
Vendor facts to verify: any assumed number or behaviour.
Owner action needed: credentials, decisions or reviews.
