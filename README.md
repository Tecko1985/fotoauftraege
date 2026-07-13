# Fotoaufträge (v1.0)

Fotoauftrags-Verwaltung als eigenständige, clientseitige Web-App ohne
Build-Step (Vanilla HTML/CSS/JS) — Teil der
[Tools-Übersicht](https://tecko1985.github.io/ToolsUebersicht/) des 1. SC 1911
Heiligenstadt.

**Live:** https://tecko1985.github.io/fotoauftraege/

---

## Funktionen

### Auftrag anlegen (Social-Media-Team)
- Mannschaft, Datum und optionale Notiz — z.B. "Mittwoch braucht die B-Jugend
  Fotos vom Training".

### Ordner anlegen (zuständiger Trainer)
- Der Trainer der angefragten Mannschaft sieht den offenen Auftrag und legt per
  Klick einen dedizierten Nextcloud-Ordner samt eigenem, teilbarem Freigabelink
  an.
- Fotos werden **direkt über diesen Link** hochgeladen — auch von jemandem
  ohne eigenen Account bei den Vereins-Tools (z.B. per WhatsApp geteilt). Diese
  App selbst überträgt keine Bilder.

### Abschließen (Social-Media-Team)
- Sobald die Fotos abgeholt/verarbeitet sind, wird der Auftrag als erledigt
  markiert.

### Daten & Speicherung
- Automatische Nextcloud-Synchronisierung über die zentrale Anmeldung in der
  [Tools-Übersicht](https://tecko1985.github.io/ToolsUebersicht/): einmal dort
  anmelden, danach wird diese Seite automatisch geladen und gespeichert — auch
  am Handy, ohne WebDAV-Adresse, Benutzername oder App-Passwort auf dem Gerät.
- Nur wer das Tool in der Übersicht sehen darf, kann es öffnen. Trainer sehen
  ausschließlich Aufträge ihrer eigenen Mannschaft(en); Aufträge anlegen und
  als erledigt markieren bleibt dem Social-Media-Team vorbehalten (Gruppen-
  Rechte werden serverseitig geprüft).

---

## Lokal starten

`fetch()`-Aufrufe von einem `file://`-Origin verhalten sich inkonsistent (CORS).
Die App daher über einen lokalen Static-Server öffnen:

```
npx serve .
```

Hinweis: Die geteilte Anmeldung mit der Tools-Übersicht (`localStorage` unter
der Origin `tecko1985.github.io`) funktioniert nur auf der Live-Seite, nicht
unter `localhost`.

---

## Datenmodell

Eine JSON-Datei, zentral über den Login-Gateway der Tools-Übersicht in der
Vereins-Nextcloud gespeichert (siehe `db.js`, `GATEWAY_URL`/`GATEWAY_APP_ID`):

```js
{
  "auftraege": [
    {
      "id", "mannschaft", "datum", "notiz",
      "status",  // "offen" | "wird-angelegt" | "ordner-angelegt" | "erledigt"
      "erstelltVon", "erstelltVonVorname", "erstelltVonNachname", "erstelltAm",
      "ordnerWirdAngelegtVon", "ordnerWirdAngelegtAm",
      "ordnerPfad", "freigabeLink", "freigabeToken",
      "ordnerErstelltVon", "ordnerErstelltVonVorname", "ordnerErstelltVonNachname", "ordnerErstelltAm",
      "erledigtVon", "erledigtAm"
    }
  ]
}
```

Der Ordner + Freigabelink wird serverseitig über eine dedizierte Gateway-
Aktion angelegt (echte Nextcloud-Freigabe pro Auftrag, nicht ein gemeinsamer
Link für alle Teams) — Details siehe `CLAUDE.md`.
