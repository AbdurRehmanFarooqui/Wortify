# SCHEMA_REVIEW_FOR_AGENT.md: Wortyfy

Extra schema instructions for the coding agent. Read together with AGENTS.md. Use it for task T0.2 (schema and migrations) and for the tasks named in section 6. Written 22 November 2026 after reading the delivered `schema.ts`, `relations.ts`, `helpers.ts`, `client.ts`, `001_extensions.sql` and `002_constraints_triggers.sql` against Steps 0 to 10 and both Reconciliations.

## 0. Starting point and status labels

- The delivered files are still the originals (41 tables in `schema.ts`). **Nothing from the ledgers has been applied yet.**
- First apply both ledgers in full: Step 4 Reconciliation section 5 and Steps 5 to 9 Reconciliation section 5 (about 34 new tables, about 75 in total, and changes to about 25 existing ones).
- Then apply every item in this file on top of them.
- Status labels:
  - **REQUIRED**: approved by the pack or a direct consequence of it. Do it.
  - **APPROVED**: an owner decision made on 22 November 2026 (D-370, D-371). Implement it as written.
  - **VERIFY**: test it in the named task and report the result. Do not assume.
- If anything here conflicts with a spec document, follow the section 2 rule in AGENTS.md: stop and ask.

## 1. REQUIRED: things that would cause failures

### R1. RLS policy must tolerate an empty setting (002 SQL, task T0.2)

After a pooled connection has once run `set_config('app.store_id', ..., true)`, later transactions read the setting as an empty string, not null. `''::bigint` raises an error instead of returning zero rows.

```sql
CREATE POLICY tenant_isolation ON %I
  USING      (store_id = nullif(current_setting('app.store_id', true), '')::bigint)
  WITH CHECK (store_id = nullif(current_setting('app.store_id', true), '')::bigint);
```

Add a test: run a transaction with `withTenant`, then on the same connection run a query as `app_tenant` without setting the store. Expect zero rows and no error (Step 9, acceptance tests 18 and 19).

### R2. Composite foreign keys need `UNIQUE (store_id, id)` on three more tables

Add `unique().on(t.storeId, t.id)` to: `billing_invoices`, `import_jobs`, `review_attestations`. Without it these cannot be referenced by composite keys:
- `payment_proofs` and `billing_invoice_lines` to `billing_invoices`.
- `reviews.import_job_id` to `import_jobs`, and `reviews.attestation_id` to `review_attestations` (composite SET NULL keys, in custom SQL like the other nine).

Rule for the future: any table that a child references by (store_id, id) must declare that unique constraint.

### R3. Retained records must not be cascade-deleted

`storeRef()` cascades on delete. Retained tables must not. Create a `storeRefRetained()` helper (`onDelete: 'no action'`) and use it for:
- `billing_invoices`, `payment_proofs`, `billing_invoice_lines` (invoice child lines may cascade from their invoice, never from the store);
- `audit_log.store_id` (nullable), `impersonation_sessions.store_id`.

Purge hollows the store row (Step 8, 12.1) and never deletes it, so these keys must make an accidental store delete fail. Test: delete a store that has an invoice; expect a foreign key error.

### R4. Exactly one owner per store

Step 1 and REQ-AUTH-07 require it, and the schema does not enforce it.

```ts
uniqueIndex('store_members_one_owner').on(t.storeId).where(sql`${t.role} = 'owner'`)
```

Ownership transfer runs in one transaction. The order must be: demote the old owner to admin, then promote the new owner, then update `stores.owner_user_id`. Add a test where two admins accept a transfer at the same moment: exactly one owner results (Step 1, acceptance test 18).

### R5. `email_suppressions` uniqueness with a nullable `store_id`

A normal unique index treats nulls as distinct, so platform-scope rows would never dedupe. Use an expression index:

```sql
CREATE UNIQUE INDEX email_suppressions_active
  ON email_suppressions (email_hash, scope, coalesce(store_id, 0), stream)
  WHERE removed_at IS NULL;
```

If `stream` can be null, wrap it in `coalesce` too. Test: insert the same platform suppression twice; the second fails.

## 2. REQUIRED: fix before building features

### F1. Split the payment provider lists

D-225 added `cash` and `other` to `PAYMENT_PROVIDER`, which also feeds `store_payment_gateways_provider_chk`. Gateway rows must not be creatable for `cash` or `other`.
- Keep `PAYMENT_PROVIDER` for `orders.payment_method` and `payments.provider`: cod, bank_transfer, cash, other, jazzcash, easypaisa, card.
- Add `GATEWAY_PROVIDER` for `store_payment_gateways`: cod, bank_transfer, jazzcash, easypaisa, card.
- Checkout offers only cod and bank_transfer; that stays a service rule.

### F2. `pages.share_media_id`

Add the column (ledger) and add the composite SET NULL foreign key to `media_assets` in the custom SQL; it is missing from the Step 4 Reconciliation list of custom keys. Remove the now redundant `image` field from the `pages.seo` JSON type.

### F3. Indexes for the billing jobs

The hourly sweep and daily jobs scan `stores` and `billing_invoices`. Add:
- `stores (status, trial_ends_at)` where `status = 'trial'`;
- `stores (purge_after)` where `status = 'cancelled' and purged_at is null`;
- `stores (grace_until)` where `grace_until is not null`;
- `billing_invoices (status, due_date)` for reminders and the overdue metric;
- `payment_proofs (status, created_at)` for the review queue.

### F4. `discount_redemptions` idempotency

Add a unique index on `(store_id, order_id, discount_id, kind)` so a retried order transaction cannot double-write redemptions (REQ-DSC-04).

### F5. Role-specific database connections (`client.ts`)

`createDb(connectionString)` takes one string. Step 9 defines separate roles. Change to:
- `createTenantDb(env)`, `createPlatformDb(env)`, `createPurgeDb(env)`, each using its own Hyperdrive binding and role (`app_tenant`, `app_platform`, `job_purge`);
- keep `withTenant` as the only way to run tenant work;
- add `withPlatform` for the admin module and billing jobs.

The admin module must not import `createTenantDb`, and tenant code must not import `createPlatformDb` (lint rule, REQ-ADM-05). The migrator role is used only in CI.

### F6. Smaller schema fixes

- `customer_addresses_one_default` must be on `(store_id, customer_id)`, not `customer_id` alone. Every tenant index starts with `store_id`.
- `notification_reads` has no `store_id`. Add `store_id` plus a composite foreign key to `notifications`, like every other tenant table.
- Add a check on `orders.channel` for: web, whatsapp, instagram, facebook, phone, in_person, other. Update the old comment on that column.
- `order_events.actor_type` uses `staff` for any dashboard member (staff, admin or owner). Add a comment saying so, so it is not confused with `audit_log.actor_type` (member, platform_admin, system, customer).
- Price-each values in `discounts.rules` have up to 4 decimals. Store them as **decimal strings**, validated by the zod rules schema, never as JSON numbers (REQ-DSC-11).
- `staff_invitations`: unique on `(store_id, email)` where `accepted_at is null and revoked_at is null`; `role` check in (admin, staff). `ownership_transfers.status` values: pending, accepted, cancelled, expired; unique one pending per store.
- `billing_invoices.provider` check in (bank_transfer, raast, manual) or null. `stores.billing_cycle` check in (monthly, yearly).

### F7. `relations.ts` additions

- Billing: `stores` to `billing_invoices`; invoices to lines and proofs.
- Reviews: relations to order, customer, attestation and import job.
- Orders: relations that the new order screens query (shipments with items, refunds, payments already exist).
- Any new table that is read through the relational query API.

### F8. `helpers.ts` additions

- `takeStock` gains optional `userId` (written to `inventory_movements.user_id`) and must be called only for tracked variants. Untracked variants never decrement (4C).
- Add `returnStock`, `adjustStock` (atomic `on_hand = on_hand + delta`, one movement row), `takeBundleStock` (all components or none), `releaseDiscountUse`.
- Add `nextInvoiceNumber` (Step 8) and the `recordPayment` and `recordRefund` helpers (Step 6).

## 3. APPROVED DECISIONS (D-370 and D-371, approved 22 November 2026 with the recommended defaults)

### D-370. Deleting a user account anonymizes the user row (do not hard-delete)

Several tables hold `*_user_id` columns that point at `users` (`audit_log.actor_user_id`, `payment_proofs.submitted_by_user_id` and `reviewed_by_user_id`, `reviews.created_by_user_id` and `moderated_by_user_id`, `orders.created_by_user_id`, and others). Past actions must stay visible (Step 1), so the user row is never removed.

Implement `anonymizeUser(userId)` in one transaction, called by SCR-AUTH-03 Delete account:
- Allowed only when the user owns no store (Step 1 rule unchanged: blocked while they own one). Platform admins cannot delete their login from the UI (CLI only).
- Set `email` to a unique placeholder (for example `deleted-{id}@deleted.invalid`) so the original address can sign up again later; set `full_name` to `Deleted user`; clear `phone`, `image`, `signup_attribution`, `preferences`; set `disabled_at`; bump `token_version`.
- Delete the user's `accounts` (credentials and Google link), `sessions`, `verifications` and `two_factors` rows. Remove their `store_members` rows (they are not an owner) and cancel pending invitations they sent.
- Write an audit entry (`auth.account_delete`, actor `member`). Send EML-15 style confirmation to the old address before it is replaced.
- Foreign keys to `users` stay as they are; no `ON DELETE` change is needed because the row is never deleted. Audit views and timelines show `Deleted user`.
- At purge (Step 8, 12.1), also set `stores.owner_user_id` to null on the hollowed store row.
- Tests: a deleted user cannot sign in; audit and order timelines still show `Deleted user`; the same email can create a new account; purge nulls `owner_user_id`; a store owner cannot delete their account.

### D-371. Expired staff invitations do not count against the staff limit

- `getLimit(store, 'staff')` usage = active members (owner included) plus invitations where `accepted_at is null`, `revoked_at is null` and `expires_at > now()`.
- An expired invitation is flagged in the team screen and can be resent. Resending checks the limit again at that moment and is refused with the upgrade message if the store is full.
- Inviting an email that already has an expired pending row is treated as a resend (new token hash, new expiry) so the unique pending index never blocks it.
- The seat meter reads, for example, `3 of 5 staff accounts used (2 members, 1 pending, owner included)` and counts only unexpired invitations; expired ones are listed separately.
- Tests: an expired invitation frees its seat; resending when the store is full is refused; re-inviting the same email replaces the expired row; accepting an expired link shows the clear expired message.

### Spec amendments that follow from D-370 and D-371 (apply with the next documentation update)

| Document | Section | Change |
| --- | --- | --- |
| Step 1 | 5 (Invitations) | Active members and unexpired pending invitations count toward getLimit(store, 'staff'); expired invitations do not; resend re-checks the limit |
| Step 3 | 7.4 (Account settings) | Delete account anonymizes the user row (D-370) instead of removing it |
| 4F | 7 (Team) | Seat meter counts unexpired pending invitations only; expired ones are listed separately |
| Step 8 | 12.1 (Purge) | Hollowing also sets stores.owner_user_id to null |
| Step 8 | 9.2 (SCR-ADM-04 Users) | Anonymized users show as Deleted user and cannot be re-enabled |
| Reconciliation 3.3 (audit catalog) | auth | Add auth.account_delete |

## 4. VERIFY (test and report the result)

- **V1, T0.2: BYPASSRLS on hosted Supabase.** Check whether `app_platform` and `job_purge` can be created with `BYPASSRLS`. If not, report it. The fallback is a policy that also allows rows when `current_setting('app.platform', true) = '1'`, set only by `withPlatform`.
- **V2, T0.4 (spike S-1): identity columns and Better Auth.** `generatedAlwaysAsIdentity` rejects explicit ids. Confirm Better Auth with `useNumberId` works against the identity columns. If it needs explicit inserts, switch the auth tables to `generatedByDefaultAsIdentity`, or use string ids on auth tables only (the existing fallback).
- **V3, T0.2: custom migrations ordering.** Register 001 to 004 as custom migrations in the drizzle journal so they run in order with the generated tables: 001 extensions first; generated tables; 002 constraints and triggers; 003 custom constraints from both ledgers; 004 roles and RLS.
- **V4, T0.2: updated_at triggers.** The 002 loop creates a trigger on every table with an `updated_at` column. Confirm it covers the new tables and does not touch `audit_log` (append-only, no `updated_at`).
- **V5, T0.2: connection reuse.** Two requests with different stores on one reused connection must never share `app.store_id` (Step 9, acceptance test 19).

## 5. OPTIONAL (only if time allows; do not block T0.2)

- A trigger refusing a bundle that contains another bundle or a non-simple product (REQ-CAT-05 is service-level today; a database guard is cheap).
- Month partitioning of `audit_log` to make the 12-month purge cheap. The batch delete in REQ-SET-07 is acceptable.
- A database check that `refunds` processed plus pending never exceed paid. The service and the order row lock are the required guard (REQ-PAY-04).

## 6. Where each item lands

| Item | Task | Done when |
| --- | --- | --- |
| R1, R2, R3, R4, R5 | T0.2 | The tests named in each item pass; registry test passes |
| F1, F2, F3, F4, F6 | T0.2 | Schema builds on an empty database; schema tests pass |
| F5 | T0.2 and T1.1 | Tenant, platform and purge connections exist; lint blocks cross-imports |
| F7, F8 | T0.2, T3.2, T5.2, T9.1 | Helpers exist before the task that needs them |
| V1, V3, V4, V5 | T0.2 | Result written in the task report |
| V2 | T0.4 | Result written in the spike note |
| D-370 | T2.3, T9.6 | anonymizeUser works and its tests pass; purge nulls owner_user_id |
| D-371 | T7.5, T1.7 | Invitation counting and resend tests pass |

## 7. Checklist for the T0.2 report

- [ ] Both ledgers applied; table list in the report matches the ledgers.
- [ ] R1 to R5 done, each with its test.
- [ ] F1 to F8 done or listed as not done with a reason.
- [ ] D-370 and D-371 implemented as written in section 3, with their tests.
- [ ] V1 to V5 results reported.
- [ ] TENANT_TABLES registry lists every table with its RLS class and purge class (Steps 5 to 9 Reconciliation, 3.4); the registry test passes.
- [ ] Nothing run against production.
