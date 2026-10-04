# Central trainer passwords

Mercurius club code: `mercurius75`. Credentials are delivered separately.
This is a shared club trainer login, not a personal administrator account.

Mercurius uses `managedAuth:true` and the central `epp-auth` endpoint.
The password form is under Meer > Wachtwoord wijzigen. Never enable fallback
to the initial password after central login is activated.

Activation with an authorized Supabase CLI session:

1. Link EPP project `nnsozxjkltcnexqpnwia`. The SQL migrations have been applied
   through `supabase db query --linked --file <migration>`. Run only unapplied
   migrations; all existing training data must be preserved.
2. Deploy `epp-auth`, `epp-admin`, `epp-signup` and `epp-platform`. They share the
   central password verifier, so a changed trainer password applies to all four.
3. Verify login, password change, rejection of the previous password,
   and login from another device. Check that anon access to `trainer_credentials`
   is denied. Reapplying the migration must not reset a changed password.
4. Publish the frontend only after the server checks succeed. The public
   frontend key and database URL must belong to the same EPP project.

## Database migration

EPP data was copied from the previous database to the free EPP app v2 project.
Local before-migration backups are in `backups/` (ignored by Git). The previous
database is retained for rollback. All devices must refresh the app to use
the new database. DSR's project is not modified.

Credentials use PBKDF2-SHA256 with random salts and 600,000 iterations. Five
failed attempts temporarily lock the club login for 15 minutes. Password updates
match the previous hash so concurrent requests cannot overwrite a newer change.
Public browser clients cannot access credentials; only server functions can.

Focused checks (Node 22.18+):

```sh
node --experimental-strip-types --test supabase/tests/trainer-auth.test.mjs
```
