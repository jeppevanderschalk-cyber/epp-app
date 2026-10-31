# EPP Trainingsmonitor

Statische browser-app voor EPP-scoreregistratie.

Publicatie: `epp-app.nl`

Betaalde wedstrijdinschrijvingen zijn voorbereid met €12 per discipline en een
eigen Mollie-account per organisator. Online betaling blijft uitgeschakeld tot
aansluiting; zie [aansluiten en testen](supabase/README-payments.md).

## Private back-ups

De database maakt dagelijks een snapshot en bewaart deze 90 dagen. Dit beschermt
niet tegen verlies van het hele Supabase-project. Externe opslag is nog niet
geconfigureerd. Publiceer nooit snapshots of herstelsleutels in deze openbare repo.

`supabase/backup.mjs` kan met de ingelogde eigenaar-CLI een consistente snapshot
exporteren. De uitvoer is AES-256-GCM-versleuteld. De tool controleert direct of de
inhoud weer ontsleuteld kan worden, weigert andere projecten en overschrijft geen
bestaande bestanden. Sleutels en ontsleutelde bestanden krijgen rechten `0600`.

```sh
node supabase/backup.mjs generate-key /private/path/epp-recovery.key
EPP_BACKUP_KEY_FILE=/private/path/epp-recovery.key node supabase/backup.mjs capture backups/epp-date.encrypted
EPP_BACKUP_KEY_FILE=/private/path/epp-recovery.key node supabase/backup.mjs check backups/epp-date.encrypted
EPP_BACKUP_KEY_FILE=/private/path/epp-recovery.key node supabase/backup.mjs decrypt backups/epp-date.encrypted /private/path/restored.json
```

Bewaar de sleutel afzonderlijk, bijvoorbeeld in een wachtwoordmanager. Alleen
een versleuteld bestand mag naar externe private opslag. `check` en `decrypt`
veranderen de database niet. Volledig herstel in een nieuw project vereist ook
de SQL-migraties, serverfuncties en nieuwe serverinstellingen; actieve sessies
worden bewust niet in de snapshot meegenomen. Test volledig herstel eerst in een
apart project, niet door de productiegegevens te overschrijven.

Bij dubbele namen in inschrijvingen moet een trainer het juiste schutter-ID kiezen
in de groepslijst. De app voegt nooit automatisch personen met dezelfde naam samen.

### Backblaze B2

De connector en dagelijkse taak zijn voorbereid, maar nog NIET geactiveerd.
Er is nog geen externe upload of volledige databaseherstelproef uitgevoerd.

1. Maak een B2-account aan, kies Europa en beveilig de login met twee stappen.
2. Maak een aparte bucket met bestandstoegang **Private**. Gebruik een unieke
   naam zoals `epp-private-backups-<eigen-suffix>`.
3. Maak een application key voor alleen deze bucket, met Read and Write en
   prefix `epp/nnsozxjkltcnexqpnwia/`. De connector vereist `listBuckets`,
   `writeFiles` en `readFiles`, en weigert een master key of openbare bucket.
4. Stel een eigen lifecycle rule in voor die prefix: uploads na 90 dagen
   verbergen (`daysFromUploadingToHiding: 90`), verborgen bestanden na 1 dag
   verwijderen (`daysFromHidingToDeleting: 1`). Alleen oude versies bewaren is
   onvoldoende: elke back-up heeft een nieuwe bestandsnaam. Configureer ook
   opslagwaarschuwingen en een kostenlimiet passend bij je B2-account.
5. Plaats de twee scripts en de workflow uit `supabase/operations/` in een
   afzonderlijke PRIVATE beheerrepository. Zet de workflow onder
   `.github/workflows/`. Stel de vijf in de workflow genoemde secrets in via
   GitHub Settings, nooit in de app, broncode of chat. De Supabase-sleutel moet
   de server-side service-role key van EPP app v2 zijn, niet de openbare anon key.
6. Bewaar de AES-herstelsleutel apart in een wachtwoordmanager. Zet daarna de
   repositoryvariable `EPP_B2_BACKUP_ENABLED` op `true`. Start de taak handmatig,
   controleer het resultaat en voer pas daarna een herstelproef in een apart
   databaseproject uit. GitHub kan geplande taken vertraagd uitvoeren.

De voorbereide taak loopt dagelijks om 03:41 UTC. Elke uitvoering maakt een
nieuw consistent snapshot, versleutelt het in geheugen, uploadt het, downloadt
hetzelfde bestand terug en vergelijkt de ontsleutelde inhoud. Succes wordt pas
gemeld na deze controle. Er komen geen onversleutelde bestanden of artifacts
op de runner en de applicatie krijgt geen toegang tot de B2-sleutels.

`node supabase/b2-backup.mjs check-connection` controleert de B2-configuratie
zonder databasewijzigingen. `node supabase/b2-backup.mjs run` voert de export
en upload uit met dezelfde vijf omgevingsvariabelen als de workflow. De connector
verwijdert geen bestanden; bewaartermijnen worden in B2 zelf ingesteld.
