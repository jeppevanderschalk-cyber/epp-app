# Central trainer passwords

Mercurius club code: `mercurius75`. Credentials are delivered separately.
This is a shared club trainer login, not a personal administrator account.

The frontend keeps `managedAuth:false` until the server is deployed. It shows
the password form as unavailable and uses the existing app login. Never enable
fallback to the initial password after central login is activated.

Activation with an authorized Supabase CLI session:

1. Link project `rxfvbmotatdyinbmliwq` and apply the migrations with `supabase db push`.
2. Deploy `epp-auth`, `epp-admin`, `epp-signup` and `epp-platform`. They share the
   central password verifier, so a changed trainer password applies to all four.
3. Verify login, password change, rejection of the previous password,
   and login from another device. Check that anon access to `trainer_credentials`
   is denied. Reapplying the migration must not reset a changed password.
4. Set Mercurius `managedAuth:true` in `index.html`, remove its `trainerHash`,
   then publish the frontend. The form is under Meer > Wachtwoord wijzigen.

Credentials use PBKDF2-SHA256 with random salts and 600,000 iterations. Five
failed attempts temporarily lock the club login for 15 minutes. Password updates
match the previous hash so concurrent requests cannot overwrite a newer change.
Public browser clients cannot access credentials; only server functions can.

Focused checks (Node 22.18+):

```sh
node --experimental-strip-types --test supabase/tests/trainer-auth.test.mjs
```
