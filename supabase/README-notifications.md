# E-mailmeldingen voor verenigingsbeheerders

Voorbereid voor Resend. Standaard staan meldingen per vereniging uit. Er zijn geen sleutels of afzender ingesteld door deze wijziging.

De beheerder krijgt een melding bij een nieuw schuttersaccount dat op goedkeuring wacht en bij een eerste wedstrijdinschrijving. Aanpassingen aan bestaande inschrijvingen leveren geen extra melding op. In e-mails staan de volledige namen. De vereniging van de schutter bepaalt de ontvanger.

## Activeren

1. Controleer en voer uitsluitend `migrations/20261106_admin_email_notifications.sql` uit op het juiste project. Gebruik geen algemene `db push` als oudere migraties al handmatig zijn uitgevoerd.
2. Verifieer een afzenderdomein in Resend en maak een API-sleutel met verzendrechten. Zet via beveiligde backendinstellingen `RESEND_API_KEY`, `EPP_NOTIFICATION_FROM` (bijvoorbeeld `EPP <meldingen@jouw-geverifieerde-domein.nl>`) en een willekeurige sterke `EPP_NOTIFICATION_SECRET`. Bewaar sleutels niet in Git, frontend of chat.
3. Rol `epp-auth` uit met de bestaande authenticatie-instellingen. Rol `epp-notifications` uit met `--no-verify-jwt`: deze worker vereist zelf het geheime Bearer-token uit `EPP_NOTIFICATION_SECRET`.
4. Sla datzelfde worker-token veilig op in Supabase Vault onder de naam `epp_notification_worker_secret`. Installeer daarna `operations/schedule-notifications.sql` voor project `nnsozxjkltcnexqpnwia`. Dit activeert verwerking elke minuut.
5. Stel onder **Meer → E-mailmeldingen voor de beheerder** het beheeradres per vereniging in en schakel meldingen in. Zonder apart adres worden de e-mailadressen van actieve verenigingsbeheerders gebruikt. Hoofdbeheer kan een vereniging kiezen. Alleen toekomstige aanmeldingen worden in de wachtrij gezet.
6. Controleer met een afgesproken testaanmelding de ontvanger en de afzender. Controleer de Resend-log en de wachtrij voordat de inrichting wordt vrijgegeven.

## Beheer en controle

De private tabel `epp_email_notifications` bevat de status, pogingen en provider-ID. Alleen de backend mag de wachtrij lezen. Een worker claimt maximaal vijf meldingen met tijdelijke leases. Tijdelijke fouten worden opnieuw geprobeerd; de provider krijgt steeds dezelfde idempotentiesleutel. Na acht pogingen of twintig uur vanaf de eerste poging stopt automatische verzending. Controleer `failed`-meldingen handmatig voordat je iets opnieuw verzendt. Foutteksten bevatten geen sleutels.

Uitschakelen per vereniging stopt het verzamelen en verzenden. Eerder opgebouwde meldingen kunnen na opnieuw inschakelen alsnog worden verzonden. Verwijderde accounts en ingetrokken inschrijvingen worden bij verwerking geannuleerd. Om de worker volledig te stoppen: `select cron.unschedule('epp-admin-email-notifications');`.

## Verificatie

`node --experimental-strip-types --test supabase/tests/*.test.mjs` controleert de mailinhoud, ontvanger, idempotentie en foutafhandeling. `notifications-browser.mjs` controleert de instellingen met een gesimuleerde backend. Combineer de migratie zonder afsluitende `commit` met `tests/notifications.integration.sql` zonder eigen `begin` voor een transactionele databasecontrole die eindigt met `rollback`. Er worden daarbij geen echte e-mails verzonden.

API-documentatie: [Resend send email](https://resend.com/docs/api-reference/emails/send-email) en [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions).
