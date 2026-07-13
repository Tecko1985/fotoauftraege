// Persistenz über das zentrale ToolsUebersicht-Login-Gateway.
// Adaptiert aus E:\materialbedarf\db.js (gleiches Gateway-Muster).
const GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";
const GATEWAY_APP_ID = "fotoauftraege";

class NotLoggedInError extends Error {
  constructor(message) {
    super(message || "Nicht angemeldet");
    this.name = "NotLoggedInError";
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message || "Daten wurden zwischenzeitlich von einem anderen Gerät geändert");
    this.name = "ConflictError";
  }
}

// ETag des zuletzt geladenen/geschriebenen Stands. Wird bei dav-save mitgeschickt,
// damit der Worker Konflikte (anderes Gerät hat inzwischen gespeichert) erkennt.
let gatewayRev = null;

function getSessionToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
}

async function gatewayRequest(payload) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (resp.status === 403) throw new Error("Kein Zugriff auf dieses Tool.");
  if (resp.status === 409) throw new ConflictError();
  if (!resp.ok) throw new Error(`Gateway-Fehler (HTTP ${resp.status})`);
  return resp.json();
}

async function gatewayLoad() {
  const body = await gatewayRequest({ action: "dav-load", app: GATEWAY_APP_ID });
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
  return body.data; // Objekt oder null (Datei noch nicht vorhanden)
}

async function gatewaySave(dataObj) {
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = await gatewayRequest(payload);
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
}

// Liefert {username, isAdmin, groupIds, vorname, nachname, mannschaften, canEdit} der eingeloggten Person.
async function fetchMe() {
  return gatewayRequest({ action: "me", app: GATEWAY_APP_ID });
}

// Für das Mannschaft-Datalist im "Neuer Auftrag"-Formular (Editoren legen Aufträge
// für JEDES Team an, nicht nur die eigenen — anders als currentMannschaften aus
// fetchMe(), das die eigenen Teams für die Ordner-anlegen-Berechtigung liefert).
async function fetchTrainerProfiles() {
  return gatewayRequest({ action: "list-trainer-profiles" });
}

// Legt für einen offenen Auftrag serverseitig den Nextcloud-Ordner + echten
// Freigabelink an (dedizierte Worker-Aktion, kein dav-save — siehe admin-worker.js).
// Aktualisiert gatewayRev, da dieselbe Datei geschrieben wird wie bei dav-save/-load;
// sonst würde ein nachfolgendes Editor-dav-save (z.B. "erledigt" markieren) fälschlich
// in einen 409 laufen. gatewayRequest() wirft bereits ConflictError bei 409.
async function ordnerAnlegen(id) {
  const body = await gatewayRequest({ action: "fotoauftrag-ordner-anlegen", id });
  if (typeof body.rev === "string") gatewayRev = body.rev;
  return body; // { ok:true, auftrag, rev }
}

// Lädt eine aus dem Spielbericht-Freitext erzeugte .docx (siehe buildSpielberichtDocxBlob
// in app.js) in denselben Nextcloud-Ordner wie die Fotos. Gleiches gatewayRev-Update
// wie ordnerAnlegen, da dieselbe Datei geschrieben wird.
async function spielberichtHochladen(id, text, dataBase64) {
  const body = await gatewayRequest({ action: "fotoauftrag-spielbericht-hochladen", id, text, dataBase64 });
  if (typeof body.rev === "string") gatewayRev = body.rev;
  return body; // { ok:true, auftrag, rev }
}
