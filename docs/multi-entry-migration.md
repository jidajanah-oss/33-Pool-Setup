# Live 2026 multi-entry ownership

The existing `uid` on a claim is its permanent ledger identity. It is not necessarily the login that owns the entry. `ownerUid`, when present, is the authoritative login owner; otherwise ownership falls back to `uid`. Never replace the legacy `uid` with a second entry's owner: payments and scoring use that stable key.

## Verified production identities (September 9, 2026)

| Entry | Line | Permanent ledger ID | Login email |
|---|---|---|---|
| Erin → Mitch2 | 19 | `pQgntfhazJTupHsRu7ifYCKDHUZ2` | Outgoing account retained for history |
| Mitch | 24 | `aVLCNGp2amUyiyVqFR6VkGmHAFP2` | `bball1112@msn.com` |

The active schedule ID was `33P-2026-AEDA92D101`. The primary's live app roster, directory option values, and freshly downloaded 255-document backup agree on these identities. The migration rechecks all identities and current balances; the recorded amounts are not used to overwrite anything.

## What changes

The atomic transaction updates only `playerName: "Mitch2"` and `ownerUid: "aVLCNGp2amUyiyVqFR6VkGmHAFP2"` on `claims/19` and `userClaims/pQgntfhazJTupHsRu7ifYCKDHUZ2`. It adds `audit/2026-erin-19-to-mitch2-v1` with the previous claim records and review fingerprint.

The legacy userClaims document is retained as a stable entry index. Its access rule honors the new owner, so its document ID does not grant Erin access. No payment, transaction, winner, schedule, public week, season-launch, or user profile document is rewritten. Historical records retain their historical names. Current entry screens and the commissioner ledger display the claim name.

Mitch's original entry stays untouched. His login discovers both claims and can select either schedule and its separate payment ledger. Existing single-entry accounts continue to work without migration. Additional ownership is commissioner controlled; this change does not reopen enrollment or enable extra self-service claims.

Erin loses ownership access to the private line and payment records. This does not delete her Firebase identity or prevent access to information already public to signed-in pool members.

## Deployment and application

1. Save a complete production backup and the currently deployed Firestore rules. Compare deployed rules with the repository baseline.
2. Run `npm ci`, `npm test`, `npm run test:ui`, `npm run test:rules` (Java 21 required), and `npm run build`.
3. Deploy only Firestore rules: `firebase deploy --only firestore:rules --project pool-setup`. Do not deploy unrelated functions or run any reset/import command.
4. Deploy the app through the existing GitHub Pages workflow. Service worker cache v34 requests the updated app.
5. In Commissioner, open **Transfer Erin’s entry to Mitch2**, then **Review verified records**. Check line 19, line 24, both exact IDs, and the current balances. Download the review and rollback records. A review expires after 15 minutes.
6. The pool commissioner performs the final transfer: type `TRANSFER LINE 19 TO MITCH2` and choose **Apply reviewed transfer**. A changed record, missing record, wrong account/email, wrong pull, open enrollment, missing schedule week, or repeated transaction stops the operation.
7. The screen verifies all 11 reviewed records against the expected result. If a network failure makes the outcome uncertain, choose **Verify transfer result**; do not repeat the transaction. Save a new complete backup and compare protected collections, allowing unrelated ongoing NFL synchronization separately.
8. Mitch refreshes the app and checks the **Your entry** selector for Mitch / line 24 and Mitch2 / line 19, each with its own schedule and ledger. Verify Erin cannot read line 19's private schedule or payment history. Rules emulator tests cover these access cases; no impersonation of real players is needed for testing.

## Rollback

The same primary-only panel contains **Restore Erin’s ownership if a transfer must be undone**. Type `RESTORE ERIN LINE 19`. The transaction checks the audit and both current records before restoring `playerName: "Erin"` and an explicit `ownerUid` equal to Erin's original ID. It records the rollback in the audit. It does not roll back, overwrite, merge, or delete any financial or schedule history, including records added since the transfer.

Keep the new ownership-aware rules after a transfer. Reverting to old rules alone would restore legacy UID access to Erin. If reverting the application, first use the guarded ownership rollback and verify it. A completed or rolled-back migration cannot be run a second time under the same audit ID.

## Validation

Tests cover legacy ownership, distinct ledgers, revoked access, unauthorized ownership writes, live-season ID/deletion guards, atomic paired-owner updates, malformed migration inputs, stale reviews, retries, schedule/payment response races, and migration/rollback preservation. The repository already has lint findings unrelated to this feature; compare new findings with the baseline instead of treating a failing full lint command as a new regression.
