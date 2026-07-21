const APP_VERSION = "1.0";

const AUFTRAG_STATUS = [
  { id: "offen", label: "Offen" },
  { id: "wird-angelegt", label: "Wird angelegt…" },
  { id: "ordner-angelegt", label: "Ordner angelegt" },
  { id: "erledigt", label: "Erledigt" }
];

// Nach so vielen Tagen verschwindet ein Auftrag automatisch aus der Liste, damit
// sie nicht zulaeuft. NUR fuer die Anzeige ("wird am ... entfernt") -- entfernt
// wird serverseitig, siehe AUTO_PRUNE_APPS in admin-worker.js. Wert muss dort
// mit maxTageAlt uebereinstimmen, sonst zeigt die App ein falsches Datum an.
const AUFTRAG_AUFBEWAHRUNG_TAGE = 5;

const APP_CHANGELOG = [
  {
    version: "1.1",
    groups: [
      {
        title: "Aufräumen der Auftragsliste",
        items: [
          "Aufträge verschwinden 5 Tage nach dem Anlegen automatisch aus der Liste — die Liste läuft nicht mehr zu. Bei jedem Auftrag steht, wann es so weit ist.",
          "„Löschen“ entfernt jetzt nur noch den Auftrag aus dieser Liste. Der Nextcloud-Ordner mit den Fotos und dem Spielbericht bleibt erhalten — die Bilder sind das Archiv des Vereins.",
          "Nicht mehr benötigte Foto-Ordner räumt man bei Bedarf direkt in der Nextcloud auf."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Fotoaufträge",
        items: [
          "Das Social-Media-Team legt einen Auftrag an (Mannschaft, Datum, optionaler Gegner).",
          "Der zuständige Trainer (eigenes Mannschaften-Profil) legt per Klick auf „Ordner anlegen“ einen dedizierten Nextcloud-Ordner samt eigenem, teilbarem Freigabelink an — Fotos werden direkt über diesen Link hochgeladen, nicht über diese App.",
          "Sobald ein Ordner existiert, kann ein Spielbericht eingetippt werden — er wird als Word-Datei in denselben Nextcloud-Ordner wie die Fotos hochgeladen.",
          "Sobald die Fotos abgeholt/verarbeitet sind, markiert das Social-Media-Team den Auftrag als erledigt."
        ]
      }
    ]
  }
];
