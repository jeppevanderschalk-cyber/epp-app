# EPP-inschrijfgeld en Mollie Connect

De koppeling is voorbereid. Productie blijft uitgeschakeld totdat EPP een Mollie
Connect-app heeft en elke organisator zijn eigen account heeft gekoppeld.
Er is geen centraal ontvangstrekeningnummer en er wordt geen platformcommissie
toegevoegd. De schutter betaalt €12 voor Standaard (`pistool`), €12 voor Optics
(`optiek`) of €24 voor beide. Hij kiest per discipline zijn eigen tijdslot.

## Aansluiten

1. Registreer de EPP Connect-app bij Mollie en gebruik als exacte redirect-URI:
   `https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/epp-payments?route=oauth_callback`.
2. Plaats uitsluitend via serverbeheer de secrets `MOLLIE_CLIENT_ID`,
   `MOLLIE_CLIENT_SECRET`, `EPP_PAYMENT_ENCRYPTION_KEY` (32 willekeurige bytes als
   64 hex-tekens) en `EPP_PAYMENT_WORKER_SECRET`. Bewaar de encryptiesleutel
   afzonderlijk voor herstel. Deel secrets nooit via de chat, browser of Git.
3. De eigen verenigingsbeheerder kiest onder Wedstrijdplanner → Inschrijfgeld en
   eigen betaalaccount → Eigen Mollie-account koppelen. De OAuth-scopes zijn
   `organizations.read profiles.read onboarding.read payments.read payments.write refunds.read`.
   Kies daarna expliciet een betaalprofiel. Eén Mollie-organisatie kan niet voor
   twee verenigingen worden gekoppeld. Opnieuw koppelen mag alleen dezelfde
   organisatie autoriseren. De eigen vereniging blijft de ontvanger.
4. Rond de verificatie bij Mollie af; de server controleert
   `canReceivePayments`. Profile-ID, organisatie en bedrag worden bij iedere
   betaling bevroren en opnieuw gecontroleerd. Tokens zijn met AES-GCM versleuteld
   en aan de club gekoppeld. De browser ontvangt nooit tokens of API-sleutels.
5. Test eerst in een afzonderlijk stagingproject, met een staging-Connect-redirect,
   `EPP_PUBLIC_APP_URL` naar de stagingapp en `epp_payment_runtime.mode='test'`.
   Testmodus wordt zichtbaar gemarkeerd en kan geen echte betaling bevestigen.
   De provider moet alle gerapporteerde gegevens in dezelfde modus teruggeven.
6. Richt vóór activering een periodieke serveraanroep in van
   `POST /functions/v1/epp-payments?route=reconcile` met header
   `Authorization: Bearer <EPP_PAYMENT_WORKER_SECRET>`, bijvoorbeeld elke minuut.
   Deze verwerkt maximaal 20 oudste open betalingen per aanroep. Bewaak het
   resultaat (`checked`/`failed`) en `review`-meldingen. Dit is een vereiste voor
   vrijgave bij gemiste webhooks; er is nog geen betaaltaak geïnstalleerd.
7. Zet pas na een geslaagde providerproef `EPP_PAYMENTS_ENABLED=true` en
   `epp_payment_runtime.enabled=true`. Productie gebruikt `mode='live'`.
   Vervolgens kan de organisator per wedstrijd verplichte betaling inschakelen.
   Dit kan niet ongemerkt bij wedstrijden met bestaande deelnemers of betalingen.

De nieuwe Edge Function is geconfigureerd met `verify_jwt=false`, omdat Mollie's
callback geen Supabase-JWT meestuurt. JSON-acties vereisen altijd de bestaande
geverifieerde EPP-sessie. OAuth gebruikt een eenmalige, servergebonden state van
tien minuten. De worker heeft een apart serversecret. Een webhook vertrouwt alleen
een door Mollie opnieuw opgehaalde en gevalideerde betaling.

## Reserveringen en bevestiging

Een nog niet betaalde inschrijving staat als order met gereserveerde tijdsloten
naast de definitieve inschrijvingen. Deze plekken tellen mee in de capaciteit.
Nog geen deelnemer of score-invoer verschijnt voordat betaling is bevestigd.
Alle capaciteitsovergangen worden onder dezelfde wedstrijdvergrendeling verwerkt.
De bestaande boekingsroute kan verplichte betaling niet omzeilen.

De vervaltijd op de klok is geen bewijs dat een betaling is verlopen. Alleen de
opgehaalde terminale status `expired`, `failed` of `canceled` geeft de plekken vrij.
Een provider-timeout laat de reservering staan. Opnieuw proberen hergebruikt het
order-ID, de aanvraag en de versleuteld bewaarde creatiecredential, omdat Mollie's
idempotentie aan de credential is gekoppeld. Oude onduidelijke creaties worden
niet opnieuw geïncasseerd maar krijgen `review`.

Een betaling die slaagt na sluiting of nadat een beheerder het tijdslot blokkeert,
behoudt zijn eerder vastgehouden plek. Als bevestiging toch niet lukt, blijft de
order voor controle staan. De eigen beheerder kan een Mollie-betalingsnummer laten
verifiëren en de bevestiging opnieuw laten verwerken. Ook dan wordt de provider
opnieuw gecontroleerd; een handmatig aangevinkte betaalstatus bestaat niet.

Een betaald tijdslot kan zonder nieuwe betaling worden verplaatst binnen dezelfde
disciplines. Na betaling een discipline toevoegen/verwijderen vereist afhandeling
door de organisator. Annuleren in de app doet geen automatische terugbetaling.
De organisator voert terugbetalingen volgens zijn voorwaarden uit in zijn eigen
Mollie-dashboard; de opgehaalde terugbetaalde bedragen zijn zichtbaar in de app.
Er worden nog geen restituties vanuit de app aangevraagd. Een onduidelijke creatie
zonder te vinden providerbetaling blijft geblokkeerd tot onderzoek door beheer;
de app biedt geen ongeverifieerde knop om de reservering vrij te geven.

## Controle en herstel

- `node --test supabase/tests/*.test.mjs` controleert prijzen, accountisolatie,
  versleuteling, verificatie, credential/idempotentie en sessierechten.
- `supabase/tests/discipline-payments.integration.sql` draait in een transactie
  met rollback en controleert de echte databasefuncties. Pas eerst de migratie toe
  in een testdatabase of neem deze binnen dezelfde teruggedraaide transactie op.
- `supabase/tests/discipline-payments-browser.mjs` test mobiel en desktop met een
  nagebootste provider, inclusief de €12/€24-bedragen en terugkeer zonder betaling.
- Een echte Mollie-OAuth- en iDEAL-proef is pas mogelijk na aansluiting. De
  geautomatiseerde providerproeven doen geen echte betalingen.

Back-ups nemen orders, betaal-audit en versleutelde accountgegevens mee. OAuth
states worden niet hersteld. Bewaar ook de encryptiesleutel; zonder deze sleutel
moeten clubs opnieuw autoriseren. Een herstel vereist de nieuwe tabellen en hun
foreign-key-volgorde: accounts, orders, audit. Zet betalingen en de worker na een
herstel eerst uit en vergelijk open orders met Mollie voordat boekingen hervatten.

Providerdocumentatie:
[Connect](https://docs.mollie.com/docs/connect-overview),
[OAuth](https://docs.mollie.com/reference/authorize-endpoint),
[Payments](https://docs.mollie.com/reference/create-payment),
[Idempotency](https://docs.mollie.com/reference/api-idempotency),
[Payment-status](https://docs.mollie.com/reference/get-payment).
