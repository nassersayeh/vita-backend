# Controlled prescriptions

## Access and setup

- `/login` is the shared login (mobile number or authority username). `/controlled-oversight` is the workspace for the Palestinian medical syndicate and Ministry of Health. Signing out clears the shared session and legacy portal sessions, then returns to `/login`. Existing pharmacy syndicate features remain at `/pharmacist-union`, with a Controlled Prescriptions tab.
- Admin → insurance/oversight accounts → Create controlled oversight account creates a missing authority account. Only authenticated Admin/Superadmin can create one; credentials are not exposed by listing endpoints.
- `node scripts/setupControlledOversight.js` creates missing medical/ministry accounts with unique random passwords. Existing accounts are unchanged. Initial contact details are placeholders; replace them with official details before organizational use. Credentials are written to `/private/tmp/vita-controlled-accounts.json` with owner-only permissions.
- Ministry approves drugs. Medical syndicate approves Palestinian doctors and allocates prescription tickets. Pharmacy syndicate approves Palestinian pharmacies. Ministry suspensions override union approval; unions cannot lift them.
- Country eligibility follows the account's country field. Editing country/role/activation is not permitted through the controlled doctor profile endpoint.

## Quota and financial rules

Each allocation costs N × ₪2, of which N × ₪1 belongs to the medical syndicate and N × ₪1 to Vita. Only paid, fully initialized allocations provide usable tickets. Payment confirmation is one-way; no endpoint can turn consumed paid tickets back into unpaid tickets. Collection totals exclude unpaid allocations. The ledger records manual payment confirmation; it does not initiate a bank/payment transfer.

Each ticket gets `PS-CR-<allocation ObjectId>-<slot number>`. A unique database index, immutable serial, retained ticket and no delete/renew endpoint prevent serial reuse. Allocation retries use a request ID and deterministic ticket upserts. Concurrent issuance claims an unused ticket with one atomic update. Issue request IDs have their own unique index, so a retried request returns the same prescription.

## Clinical and dispensing data

Controlled prescriptions live in a separate collection from legacy prescriptions; generic prescription CRUD/renewal endpoints cannot alter them. Issuance requires an approved active Palestinian doctor, a paid unused ticket, a registered patient with ID/mobile, and drugs from the Ministry catalogue. Each line records inventory quantity, total allowed pill count, dose, frequency and instructions. Inventory quantities are in the pharmacy's existing stock unit; allowed pill count is recorded separately, without inferring pack size.

Both validity modes are single-use. Time-limited prescriptions additionally require a future expiry datetime. Full prescribed quantities are dispensed; the API does not accept partial quantities, substitute drugs or a changed pill allowance. Pricing is per stock unit, totals include quantity, and original/discounted prices are saved.

Dispensing is serialized by a persistent prescription lock, supporting standalone MongoDB. Known failures restore stock and pricing. Permissions are rechecked before committing; an intervening ministry suspension cancels the dispense. Unknown/ambiguous database write failures retain the lock instead of risking duplicate dispensing. Such a record needs operational reconciliation against the prescription, quote and inventory before unlocking; locks never auto-expire. Historical doctor/patient/pharmacy snapshots and event timestamps are retained. Actual pharmacy identity is taken from the authenticated account.

## Reports and limits

The Ministry sees issued prescriptions, serial tracing, provider permissions, prescription counts, catalogue and stock reported by Palestinian pharmacies in Vita. Financial endpoints, payment records and dispensing prices are unavailable to the Ministry. The stock list includes only currently approved controlled drugs, including zero-stock drugs. Selecting a drug shows paginated per-pharmacy quantities. Market quantities are labelled as recorded system inventory, not a claim to cover unregistered pharmacies. All three authorities can view issued prescriptions and stop an unfilled prescription with a required reason. Stop records the authority, time and reason, invalidates the prescription atomically, and remains visible in tracking. A stop that wins before dispensing commits causes inventory/pricing rollback; an already dispensed prescription cannot be stopped. Pharmacy syndicate tracing includes unfilled and dispensed prescriptions; a pharmacy's history is scoped to its own ID. No production doctor/pharmacy is auto-approved and no production medication is auto-classified during setup.

## Verification

- `node --test tests/controlledPolicy.test.js tests/controlledAuth.test.js tests/saveStandalonePrescription.test.js tests/pharmacyPrescriptionPricing.test.js`
- `RUN_CONTROLLED_INTEGRATION=1 node --test tests/controlledWorkflow.integration.test.js`

The integration test uses uniquely prefixed temporary collections in the configured database and removes only those collections. It exercises quotas/payment, concurrent issuance, serial uniqueness, pharmacy authorization, ministry overrides, single dispensing, stock changes, financial shares and trace access. It never uses or changes application patient/provider records.
