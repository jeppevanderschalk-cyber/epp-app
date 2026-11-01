# EPP Camera voor iPhone en Apple Watch

Deze hulpapp opent de bestaande EPP-app en gebruikt een eigen iPhone-camera. De knop op de bijbehorende Watch-app maakt een foto en geeft die lokaal aan de EPP-herkenning door. De standaard Apple-app Camera-afstandsbediening is hiervoor niet de bediening.

## Installeren

Er is een Xcode-project zonder externe pakketten: `EppCamera.xcodeproj`. Vereist: een Mac met een volledige Xcode-installatie die de iOS- en watchOS-versies op jouw apparaten ondersteunt, iOS 17 of nieuwer, watchOS 10 of nieuwer, een gekoppelde iPhone/Watch en een Apple-account voor ondertekening. Op de ontwikkel-Mac staat op dit moment alleen Command Line Tools; daarmee kunnen iPhone- en Watch-apps niet worden gebouwd of geïnstalleerd.

1. Installeer Xcode via de Mac App Store, open het en laat de benodigde iOS/watchOS-componenten installeren.
2. Open `EppCamera.xcodeproj`. Kies bij **Signing & Capabilities** voor beide targets dezelfde eigen **Team**. Als de bundelnamen al bezet zijn, wijzig dan beide identifiers met behoud van dezelfde prefix en pas `WKCompanionAppBundleIdentifier` in `Watch/Info.plist` aan.
3. Verbind de iPhone met de Mac, vertrouw de Mac en schakel indien gevraagd **Ontwikkelaarsmodus** in op iPhone en Watch.
4. Kies scheme **EppCamera**, selecteer jouw iPhone en druk op Run. Open daarna de meegeleverde Watch-app; eventueel installeer/start je die via scheme **EppCameraWatch** op de gekoppelde Watch.
5. Log binnen de hulpapp in op EPP. De sessie staat los van Safari.

Een gratis Personal Team is geschikt voor testen, maar vereist periodiek opnieuw ondertekenen/installeren. Voor TestFlight of distributie is een Apple Developer Program-account en verdere inrichting nodig. Dit project levert nog geen App Store- of TestFlight-installatielink.

## Een serie fotograferen

1. Houd de iPhone ontgrendeld met **EPP Camera** op de voorgrond. Open **Meer → Camera beta → Camera beta openen**. Selecteer de schutter, stage, het kaliber, de echte kaartafmetingen en het aantal schoten.
2. Tik bovenin op **Camera bekijken** om het statief te richten. De hulpapp kiest de fysieke telelens; op iPhone 16 Pro Max is dat de 5×-telelens. Op een model zonder telelens wordt de groothoek gebruikt en toont de app dat expliciet. De oriëntatie is portret.
3. Open **EPP Camera** op je Watch en tik **Maak foto**. De eerste foto wordt de startfoto. Markeer op de iPhone eenmalig de vier kaarthoeken.
4. Laat statief, lens en kaart staan. Een volgende druk op de Watch maakt een nieuwe foto en vergelijkt die automatisch met de referentie. De Watch toont het geregistreerde stagetotaal en zo nodig de voorlopige score van de nieuwe serie.
5. Standaard controleer en bevestig je iedere serie op de iPhone. Je kunt expliciet **Alleen volledig zekere series automatisch toevoegen** aanzetten. Dan worden uitsluitend series met exact het opgegeven schotaantal, volledig groene herkenning en voldoende resterende schoten direct toegevoegd. Overlap, twijfel, scoringsranden en afwijkende aantallen blijven ter controle staan. Automatisch toegevoegde schoten krijgen `reviewMethod: recognition`; menselijke bevestiging krijgt `manual`.
6. Na het toevoegen gebruikt de volgende Watch-foto automatisch de vorige na-foto als referentie. Bestaande gaten tellen daardoor niet opnieuw mee. Controleer de bestaande online-opslagindicator in EPP; het Watch-totaal bevestigt geen serveropslag.

## Grenzen en herstel

- De iPhone moet op de voorgrond blijven; iOS staat de benodigde camerabediening niet als algemene achtergrondservice toe. De hulpapp voorkomt automatisch vergrendelen zolang hij actief is. De Watch moet bereikbaar zijn; verbindingsbereik moet op de baan worden getest.
- Er is geen live camerazoeker op de Watch. Richt de camera eenmaal met de voorvertoning op de iPhone.
- Foto’s worden lokaal aan EPP doorgegeven, zonder extra foto-uploadserver. Eén originele laatste kaartfoto wordt in de privé-opslag van de hulpapp bewaard en kan via **Laatste originele foto delen** worden geëxporteerd. Nieuwe opnames vervangen die reservekopie; de normale EPP-opslag bewaart de schotgegevens en scores.
- Bij mislukte overdracht blijft de foto in het geheugen voor **Bewaarde foto opnieuw doorgeven**. Bij beëindigen van de app vervalt die lopende overdracht; de laatste JPEG blijft exporteerbaar. Er volgt nooit een automatische nieuwe opname.
- Dubbele foto-overdrachten worden niet opnieuw geanalyseerd of opgeteld. Watch-verzoeken ouder dan 12 seconden, toekomstige verzoeken, dubbele verzoek-ID’s, gewijzigde schutter/stage en een nog te controleren serie blokkeren nieuwe opnames. Achterstallige sluiterverzoeken worden niet in een wachtrij gezet.
- Bij een verschoven kaart, andere beeldverhouding of mislukte herkenning blijft de foto beschikbaar in de controleflow. Corrigeer de hoeken en vergelijk opnieuw. Volledig samenvallende inslagen zijn niet betrouwbaar uit alleen beeld af te leiden.

## Validatie

- `node --test supabase/tests/camera-native.test.mjs` vanuit de repositoryroot: overdracht, idempotentie, foute foto’s en gewijzigde context.
- `supabase/tests/camera-native-browser.mjs`: gesimuleerde native camera op mobiel/desktop, startfoto, automatische vergelijking, expliciete automatische toevoeging, twijfelgevallen, cumulatieve score en dubbele overdracht. Vereist dezelfde Playwright-configuratie als de bestaande browsertests.
- `swift test --package-path native/CaptureCore`: tests van het gedeelde iPhone/Watch-verzoekprotocol; vereist XCTest uit Xcode.
- Zonder XCTest kan de kern ook gecompileerd worden met `swiftc native/CaptureCore/Sources/CaptureCore/CaptureProtocol.swift native/CaptureCore/checks/main.swift -o /tmp/epp-capture-checks` en daarna `/tmp/epp-capture-checks`.
- `.github/workflows/native-camera.yml` bouwt de iPhone-app en ingebedde Watch-app zonder ondertekening op een macOS-runner. De echte camera, fysieke Watch, lenskeuze, bereik en installatie moeten daarna op de apparaten worden gecontroleerd.

Het projectbestand kan opnieuw worden gegenereerd met `python3 native/EppCamera/generate-project.py`. Dat schrijft geen Team of certificaten.
