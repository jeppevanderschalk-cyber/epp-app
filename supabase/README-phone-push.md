# Telefoonmeldingen bij wachtwoordherstel

Beheerders schakelen meldingen per apparaat in onder **Meer → Telefoonmeldingen**. De browser vraagt alleen na een bewuste klik om toestemming. De knop **Testmelding sturen** verstuurt een echte pushmelding naar het ingeschakelde apparaat.

Op iPhone/iPad is iOS/iPadOS 16.4 of nieuwer nodig en moet EPP via het beginscherm worden geopend. Voeg de site eerst toe via Safari → Delen → Zet op beginscherm. Android en desktop gebruiken de Push API van een ondersteunde browser. Focus, Niet storen en systeeminstellingen bepalen de zichtbaarheid en het geluid. De webroute wordt ondersteund; een native WebView heeft eventueel een eigen native pushintegratie nodig.

## Werking

`epp-push-sw.js` toont ontvangen berichten ook met gesloten app. De worker heeft geen fetch-handler, bewaart geen accountsessies en cachet geen pagina's. Een tik op een melding opent de wachtwoordverzoeken in EPP; bij een verlopen sessie moet de gebruiker eerst inloggen. De melding bevat alleen een algemeen verzoek om wachtwoordherstel, geen namen of wachtwoorden.

Elke nieuwe rij in `epp_password_help_requests` zet een bericht klaar voor aangemelde apparaten van bevoegde beheerders. Verenigingsbeheerders krijgen verzoeken van eigen leden; hoofdbeheer krijgt ook verzoeken van verenigingsbeheerders. Een afgehandeld verzoek, geblokkeerd account of ingetrokken beheerrecht wordt bij het ophalen opnieuw gecontroleerd. Dubbele openbare aanvragen veroorzaken geen extra pushberichten.

`epp-push` verwerkt elke minuut maximaal acht berichten met tijdelijke leases. Tijdelijke fouten worden met toenemende tussenpozen opnieuw geprobeerd, maximaal vijf keer. Na 24 uur vervalt een wachtend bericht. Een pushdienstantwoord 404/410 verwijdert het verlopen apparaat. Een vaste meldingstag voorkomt dubbele zichtbare meldingen bij herhaalde bezorging. Apparaten en wachtrij zijn alleen toegankelijk voor de backend.

Er kunnen maximaal tien apparaten per beheeraccount worden aangemeld. Bij expliciet uitloggen wordt het apparaat afgemeld, ook lokaal als de server niet bereikbaar is. Bij inloggen met een ander account op hetzelfde apparaat wordt de koppeling aangepast; oude berichten worden verwijderd. Een niet-beheerder wordt lokaal afgemeld. Accountsessies en tijdelijke wachtwoorden komen nooit in de serviceworker of meldingspayload terecht.

## Configuratie en uitrollen

1. Voer uitsluitend `migrations/20261115_phone_push.sql` uit na de bestaande wachtwoordherstelmigraties.
2. Genereer eenmalig een VAPID-sleutelpaar met `web-push` en bewaar `EPP_PUSH_PUBLIC_KEY`, `EPP_PUSH_PRIVATE_KEY` en een willekeurige `EPP_PUSH_WORKER_SECRET` als backendsecrets. Bewaar dezelfde workersecret in Supabase Vault als `epp_push_worker_secret`. Zet privésleutels nooit in broncode, chat, commandoregelargumenten of frontendbestanden. Roteer bestaande VAPID-sleutels niet zonder migratie van telefoonkoppelingen.
3. Deploy `epp-push` met de configuratie in `supabase/config.toml`. De worker gebruikt zijn eigen geheime Bearer-token; alle gebruikersacties valideren de bestaande EPP-accountsessie. De publieke frontendkey verleent geen toegang tot apparaten of verzendacties.
4. Installeer `operations/schedule-phone-push.sql`. Vereist bestaande extensies pg_cron, pg_net en Supabase Vault. Dit staat los van e-mailmeldingen en vereist geen Resend-account.
5. Publiceer frontend en serviceworker. Controleer backendcrypto via een worker-aanroep met `selfCheck:true` en de workersecret. Dit versleutelt/signaleert lokaal een testpayload en verstuurt niets.
6. Test op een echte telefoon: toestemming geven → testmelding → EPP sluiten → herstelverzoek indienen → melding aantikken → verzoek afhandelen. Een browsertest met een nagebootste pushdienst kan daadwerkelijke ontvangst op iPhone/Android niet bewijzen.

## Onderhoud en tests

Controleer `epp_push_jobs` (status, pogingen, foutcode) zonder apparaatsleutels te tonen. De worker retourneert alleen tellingen. Stop automatische verzending met `select cron.unschedule('epp-phone-push');`. Gebruikers kunnen hun eigen apparaat onder Telefoonmeldingen afmelden.

Unit: `node --test supabase/tests/*.test.mjs`. Browser: `phone-push-browser.mjs` met `PLAYWRIGHT_MODULE` en `CHROME_PATH`. Database: combineer migratie zonder COMMIT met `phone-push.integration.sql`; alles wordt teruggedraaid en er worden geen telefoonmeldingen verstuurd.

Bronnen: [Apple/WebKit Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe), [web-push-bibliotheek](https://github.com/web-push-libs/web-push).
