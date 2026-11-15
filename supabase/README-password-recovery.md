# Wachtwoordherstel

‘Wachtwoord vergeten?’ vraagt vereniging en e-mailadres. De backend gebruikt uitsluitend het opgeslagen adres van een actief persoonlijk account. Zowel bestaande als onbekende adressen krijgen hetzelfde antwoord. Hoofdbeheer en gedeelde logins volgen de bestaande technische beheerroute.

Resetlinks bevatten 32 cryptografisch willekeurige bytes in het URL-fragment. De browser verwijdert het fragment direct; de database bewaart alleen de SHA-256-hash. Een link verloopt na 30 minuten, werkt eenmaal en vervalt ook na een wachtwoord- of e-mailwijziging. Een geslaagde reset trekt alle accountsessies en overige links in. Goedkeuring, blokkering en rollen blijven behouden.

Er geldt een limiet van vijf aanvragen per e-mailadres en dertig per IP per uur, plus twee minuten tussen mails voor hetzelfde account. Verzendfouten worden zonder adres of token gelogd als `password_reset_delivery_failed`. Het antwoord blijft gelijk om accountadressen te beschermen; er wordt geen oude link ingetrokken wanneer een nieuwe mail mislukt.

## In productie nemen

1. Voer alleen `migrations/20261115_password_recovery.sql` uit en deploy `epp-auth` met de bestaande JWT-instelling.
2. Publiceer `index.html` en `password-recovery.js` samen.
3. Maak een Resend-account aan, voeg het afzenderdomein toe en plaats de door Resend opgegeven DNS-records. Verifieer het domein.
4. Stel via beveiligde Supabase-instellingen `RESEND_API_KEY` en `EPP_NOTIFICATION_FROM` in. Dit zijn dezelfde instellingen als voor de bestaande meldingen. Een `EPP_NOTIFICATION_SECRET` is voor wachtwoordherstel niet nodig. Zet nooit sleutels in de frontend, Git of chat.
5. Test met een eigen testaccount de daadwerkelijke ontvangst en eenmalige link, gevolgd door login met het nieuwe wachtwoord. Zonder mailinstellingen toont de app dat resetmails nog niet beschikbaar zijn.

De mailaanroep volgt [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email). Er wordt uitsluitend naar `https://epp-app.nl/` gelinkt; de aanvrager kan geen afwijkende reset-URL meegeven.

## Tijdelijk wachtwoord via beheer

Onder **Meer → Accounts → Wachtwoord herstellen** kan een verenigingsbeheerder na identiteitscontrole een tijdelijk wachtwoord voor een eigen verenigingslid instellen. Alleen hoofdbeheer kan dit voor een andere verenigingsbeheerder doen. Hoofdbeheeraccounts, gedeelde accounts, geblokkeerde accounts en het eigen account zijn uitgesloten. Geef het tijdelijke wachtwoord persoonlijk door. De volgende login verplicht de gebruiker een eigen wachtwoord te kiezen. De handeling wordt gelogd in `epp_access_audit`; bestaande sessies en resetlinks worden ingetrokken.

## Tests

- `node --test supabase/tests/password-recovery.test.mjs`
- `PLAYWRIGHT_MODULE=<module> CHROME_PATH=<chrome> node supabase/tests/password-recovery-browser.mjs`
- Combineer de migratie zonder afsluitende `commit` met `tests/password-recovery.integration.sql`; voer als één query uit. De transactionele test eindigt met `rollback` en verstuurt geen mails.
