# EPP audit remediation

Status: production migration, five authenticated functions and frontend deployed
on 2026-10-05. The daily snapshot job is active. Legacy anonymous access is closed
and a real anonymous read check returned 401. All temporary test data was removed.

## Safety gate

The initial migration approval was rejected. The user explicitly approved the
production cutover in the following turn, and the reviewed migration then succeeded.

Target: EPP app v2, project nnsozxjkltcnexqpnwia.
Do not modify the other applications' Supabase projects.

## Order after approval

1. Refresh the privileged data backup and keep it outside Git.
2. Apply 20261005_safe_platform.sql only. Check original shooter IDs, round counts,
   training bests and match calendar against the backup. Old epp_sync is retained.
3. Deploy epp-auth, epp-training, epp-platform, epp-admin and epp-signup together.
4. Test the existing beheer login per club; create named personal trainer accounts.
   Shared kijker accounts can view but cannot sign up as another shooter.
   Link personal shooter accounts to the existing canonical shooter UUIDs.
5. Publish the tested index.html together with training-store.js.
   Confirm personal login, two-device
   score entry, read-only viewers, correction conflicts and match/round selection.
6. Apply 20261005_backup_schedule.sql and verify the cron job and next snapshot.
7. Apply 20261005_close_legacy_sync.sql last. Verify anonymous reads/writes fail.
   Old browser tabs must reload; never silently upload their legacy snapshots.
8. Test production recovery using an agreed test club and compare audit records.

Keep the published 2026 snapshot distinct from the live best-match-score ranking.
No new interpretation of the official national ranking rules is introduced here.

## Local verification

- node --test supabase/tests/*.test.mjs
- Temporary PostgreSQL 16: original migrations, then safe_platform, then
  supabase/tests/platform.integration.sql. Tests roll back all fictional fixtures.
- Browser smoke: node supabase/tests/browser-smoke.mjs, with PLAYWRIGHT_MODULE
  pointing to an installed Playwright module. Uses mocked endpoints, no live writes.
- Inline JavaScript parse check and TypeScript transpilation diagnostics.
- Live endpoint check: existing Mercurius beheer login, session, own-club access,
  anonymous denial, calendar, ranking context and logout all passed.
- Live concurrency check: two temporary Gast trainer accounts saved independent
  rounds concurrently; both persisted. Concurrent correction returned 200/409.
  A temporary shooter account could read but not write. Test records were removed.
- Original legacy payloads were rechecked at publication and remained unchanged
  since the pre-migration export. No late entries were lost in the cutover window.

## Data Verification

27 shooter IDs and memberships, 8 parcours bests, 12 stage bests, 8 match calendar
entries, 13 registrations and 13 discipline records were retained.
10 registrations linked uniquely to shooter IDs. Three have ambiguous names
(Belinda or Jeppe); they remain visible in the group list and a trainer can select
the correct existing shooter ID. No identities were guessed or merged.

## Backup and recovery

Snapshots are private, checksummed and retained for 90 days. They include account
password hashes and must never be published, emailed or returned through a public
endpoint. Session tokens are deliberately excluded.

The tested user-facing restore restores TRAINING FOR ONE CLUB only. It checks
administrator rights, checksum and the most recent modification timestamp. It
captures the previous state and audits the restore. It leaves national results
and other clubs unchanged. National-result corrections retain their revision log.

The local pre-migration export is an additional rollback source. A database-local
snapshot is NOT an independent disaster backup. Off-site encrypted export and
full disaster recovery still require a storage destination, credentials and a
separate restore drill. Do not claim those are configured.

## Rollback

Before legacy access is closed: redeploy the original functions/frontend and leave
the additive tables intact. Preserve newer normalized scores before rollback.
After cutover: do not reopen anonymous writes automatically. Reconcile normalized
changes into a protected rollback copy before any return to the old storage.
Never drop tables or replace current data with an older snapshot without preview,
an additional backup and explicit approval.

## Remaining release gates

- Named account assignments and a safe independent backup destination.
- Confirm frontend device access and PWA cache refresh after publication.
- Confirm the first scheduled production backup completes successfully.
