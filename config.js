const APP_VERSION = "1.0";

const AUFTRAG_STATUS = [
  { id: "offen", label: "Offen" },
  { id: "wird-angelegt", label: "Wird angelegt…" },
  { id: "ordner-angelegt", label: "Ordner angelegt" },
  { id: "erledigt", label: "Erledigt" }
];

const APP_CHANGELOG = [
  {
    version: "1.0",
    groups: [
      {
        title: "Fotoaufträge",
        items: [
          "Das Social-Media-Team legt einen Auftrag an (Mannschaft, Datum, optionale Notiz).",
          "Der zuständige Trainer (eigenes Mannschaften-Profil) legt per Klick auf „Ordner anlegen“ einen dedizierten Nextcloud-Ordner samt eigenem, teilbarem Freigabelink an — Fotos werden direkt über diesen Link hochgeladen, nicht über diese App.",
          "Sobald die Fotos abgeholt/verarbeitet sind, markiert das Social-Media-Team den Auftrag als erledigt."
        ]
      }
    ]
  }
];
