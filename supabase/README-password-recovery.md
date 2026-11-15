# Wachtwoordherstel via de beheerder

‘Wachtwoord vergeten?’ vraagt om vereniging en gebruikersnaam of e-mailadres. Er is geen maildienst nodig. Het antwoord is voor bestaande en onbekende accounts gelijk, zodat het formulier geen accountgegevens prijsgeeft. Een verzoek verandert het wachtwoord of de bestaande sessies nog niet.

Voor een actief persoonlijk account wordt één openstaand herstelverzoek bewaard in de private tabel `epp_password_help_requests`. Dubbele verzoeken komen samen. Per ingevulde gebruikersnaam/e-mailadres zijn maximaal vijf aanvragen per uur toegestaan en per IP maximaal dertig.

De beheerder ziet na inloggen een melding bovenaan de app met **Wachtwoordverzoeken bekijken**. De lijst staat ook onder **Meer → Wachtwoordherstel** en ververst elke dertig seconden en bij terugkeer naar de app. Een verenigingsbeheerder ziet verzoeken van de eigen leden; hoofdbeheer ziet alle verenigingen en verzoeken van verenigingsbeheerders. Hoofdbeheeraccounts, gedeelde accounts, verwijderde accounts en geblokkeerde accounts kunnen via het openbare formulier niet worden hersteld.

## Afhandelen

1. Open het verzoek en kies **Tijdelijk wachtwoord geven**.
2. Controleer persoonlijk wie je helpt. Het formulier stelt een willekeurig wachtwoord van zestien tekens voor. Dit is aanpasbaar, met minimaal tien tekens.
3. Kies **Tijdelijk wachtwoord instellen**. De backend slaat alleen de gezouten wachtwoordhash op, trekt alle bestaande sessies en resetlinks in en sluit het verzoek. Deze handelingen gebeuren in één databasetransactie. Een tweede beheerder kan hetzelfde verzoek niet nogmaals afhandelen.
4. Geef het getoonde tijdelijke wachtwoord persoonlijk door en klik **Gereed**. Het wachtwoord wordt niet opgeslagen in browseropslag of meegestuurd met een e-mailmelding.
5. Na de volgende login krijgt de gebruiker verplicht het bestaande wachtwoordwijzigingsscherm. Andere functies blijven geblokkeerd totdat een eigen wachtwoord is gekozen. Lidmaatschap en rollen worden niet veranderd.

Ook een handmatige reset via **Meer → Accounts** sluit een eventueel openstaand herstelverzoek. Resets worden vastgelegd in `epp_access_audit`, zonder wachtwoorden.

## Uitrollen

Voer uitsluitend `migrations/20261115_password_help_requests.sql` uit op het EPP-project, na de eerdere `20261115_password_recovery.sql`. Deploy `epp-auth` met de bestaande JWT-instelling. Publiceer `index.html`, `password-recovery.js` en `password-help-ui.js` samen. Resend-instellingen zijn voor deze route niet nodig. Bestaande eerder verstuurde resetlinks blijven werken tot ze vervallen; het formulier vraagt voortaan hulp aan de beheerder.

## Verificatie

- `node --test supabase/tests/*.test.mjs`
- Browser: `password-help-browser.mjs`, `password-recovery-browser.mjs` en `login-browser.mjs` onder `supabase/tests/` met `PLAYWRIGHT_MODULE` en `CHROME_PATH`.
- Combineer de nieuwe migratie zonder afsluitende `commit` met `tests/password-help.integration.sql`. De test eindigt met `rollback` en verstuurt geen berichten.
