let appData = { auftraege: [] };
let currentUsername = null;
let currentIsAdmin = false;
let currentCanEdit = false;
let currentVorname = null;
let currentNachname = null;
let currentMannschaften = [];

function canEdit() { return currentIsAdmin || currentCanEdit; }

let trainerProfilesLoaded = false;
let mannschaftSuggestions = [];

// Zuletzt getippter, noch nicht hochgeladener Spielbericht-Text je Auftrag-Id.
// renderAuftraege() baut die komplette Liste per innerHTML neu auf (wie überall
// in dieser Flotte) -- OHNE das hier würde jede ANDERE Aktion auf der Seite
// (z.B. "Als erledigt markieren", oder "Ordner anlegen" bei einem anderen
// Auftrag) das komplette DOM inkl. aller Textareas wegwerfen und lautlos noch
// nicht hochgeladenen Text zerstören (gleiche Bug-Familie wie
// Autosave-Flush-bei-Navigation in anderen Apps dieser Flotte).
let spielberichtDrafts = {};

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("de-DE") + ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

function fmtDatum(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function localDateIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "fxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

function normalizeAppData(data) {
  const d = data && typeof data === "object" ? data : {};
  if (!Array.isArray(d.auftraege)) d.auftraege = [];
  return d;
}

// Wendet mutate() auf appData an und speichert. Bei Konflikt (409) wird der aktuelle
// Remote-Stand nachgeladen und dieselbe Mutation erneut angewendet, bevor erneut
// gespeichert wird. Nur für Editor-Aktionen (Anlegen/Erledigt/Löschen/Zurücksetzen) --
// "Ordner anlegen" läuft NICHT hierüber, siehe handleOrdnerAnlegen (dedizierte
// Worker-Aktion, kein dav-save).
async function saveWithConflictRetry(mutate) {
  mutate(appData);
  try {
    await gatewaySave(appData);
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    const data = await gatewayLoad();
    appData = normalizeAppData(data);
    mutate(appData);
    await gatewaySave(appData);
  }
}

function renderChangelog() {
  const list = document.getElementById("changelog-list");
  list.innerHTML = APP_CHANGELOG.map((entry) => `
    <div class="changelog-entry">
      <span class="cv">Version ${escapeHtml(entry.version)}</span>
      ${entry.groups.map((g) => `
        <div class="changelog-group">
          <div class="cg-title">${escapeHtml(g.title)}</div>
          <ul class="cg-items">${g.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>
      `).join("")}
    </div>
  `).join("");
}

function renderHeaderUser() {
  const el = document.getElementById("header-user");
  if (!el) return;
  if (!currentUsername) { el.textContent = ""; return; }
  const name = (currentVorname || currentNachname)
    ? `${currentVorname || ""} ${currentNachname || ""}`.trim()
    : currentUsername;
  const mannschaftHinweis = currentMannschaften.length ? ` (${currentMannschaften.join(", ")})` : "";
  el.textContent = "👤 " + name + mannschaftHinweis + (currentIsAdmin ? " (Admin)" : "");
}

function setupVersionBadge() {
  const versionBadgeHeader = document.getElementById("version-badge");
  const openVersionHistory = () => {
    const panel = document.getElementById("changelog-panel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  versionBadgeHeader.addEventListener("click", openVersionHistory);
  versionBadgeHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openVersionHistory(); }
  });
}

// ---------- Mannschaft-Autosuggest fürs Anlegen-Formular (Editoren legen für
// JEDES Team an, nicht nur die eigenen -- daher kein renderMannschaftField()/
// resolveMannschaft() wie bei anderen Apps, sondern Freitext + Datalist) ----------

async function ensureTrainerProfiles() {
  if (trainerProfilesLoaded) return;
  trainerProfilesLoaded = true;
  try {
    const { profiles } = await fetchTrainerProfiles();
    const set = new Set();
    (profiles || []).forEach((p) => (p.mannschaften || []).forEach((m) => { if (m) set.add(m); }));
    mannschaftSuggestions = Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
    const dl = document.getElementById("mannschaft-suggestions");
    if (dl) dl.innerHTML = mannschaftSuggestions.map((m) => `<option value="${escapeHtml(m)}"></option>`).join("");
  } catch (e) {
    console.warn("Mannschaft-Vorschläge konnten nicht geladen werden", e);
  }
}

// ---------- Neuer Auftrag (Editor) — Formular direkt auf der Aufträge-Seite,
// kein eigener Tab (Nutzerwunsch: "in die Oberfläche integrieren") ----------

function resetAuftragForm() {
  document.getElementById("f-mannschaft").value = "";
  document.getElementById("f-datum").value = localDateIso();
  document.getElementById("f-gegner").value = "";
  showFormError("");
}

function showNeuerAuftragForm() {
  document.getElementById("neuer-auftrag-card").style.display = "block";
  document.getElementById("btn-neuer-auftrag").style.display = "none";
  ensureTrainerProfiles();
  document.getElementById("f-mannschaft").focus();
}

function hideNeuerAuftragForm() {
  document.getElementById("neuer-auftrag-card").style.display = "none";
  document.getElementById("btn-neuer-auftrag").style.display = canEdit() ? "" : "none";
  resetAuftragForm();
}

function showFormError(msg) {
  const el = document.getElementById("form-error");
  el.style.display = msg ? "block" : "none";
  el.textContent = msg || "";
}

async function submitAuftrag() {
  showFormError("");
  const mannschaft = document.getElementById("f-mannschaft").value.trim();
  const datum = document.getElementById("f-datum").value;
  const gegner = document.getElementById("f-gegner").value.trim();

  if (!mannschaft) { showFormError("Bitte eine Mannschaft angeben."); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) { showFormError("Bitte ein gültiges Datum wählen."); return; }

  const btn = document.getElementById("btn-submit-auftrag");
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = "Wird gespeichert…";
  try {
    const auftrag = {
      id: uuid(),
      mannschaft,
      datum,
      gegner,
      status: "offen",
      erstelltVon: currentUsername,
      erstelltVonVorname: currentVorname,
      erstelltVonNachname: currentNachname,
      erstelltAm: new Date().toISOString(),
      ordnerWirdAngelegtVon: null,
      ordnerWirdAngelegtAm: null,
      ordnerPfad: null,
      freigabeLink: null,
      freigabeToken: null,
      ordnerErstelltVon: null,
      ordnerErstelltVonVorname: null,
      ordnerErstelltVonNachname: null,
      ordnerErstelltAm: null,
      erledigtVon: null,
      erledigtAm: null,
      spielbericht: "",
      spielberichtHochgeladenVon: null,
      spielberichtHochgeladenVonVorname: null,
      spielberichtHochgeladenVonNachname: null,
      spielberichtHochgeladenAm: null
    };
    await saveWithConflictRetry((data) => { data.auftraege.push(auftrag); });
    renderAuftraege();
    hideNeuerAuftragForm();
  } catch (e) {
    showFormError("Fehler beim Speichern: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ---------- Anzeige ----------

function statusLabel(status) {
  const s = AUFTRAG_STATUS.find((x) => x.id === status);
  return s ? s.label : status;
}

function statusBadgeHtml(status) {
  return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function personName(vorname, nachname, fallbackUsername) {
  return (vorname || nachname) ? `${vorname || ""} ${nachname || ""}`.trim() : (fallbackUsername || "");
}

function kannOrdnerAnlegen(a) {
  return a.status === "offen" && (canEdit() || currentMannschaften.includes(a.mannschaft));
}

// Spielbericht braucht einen existierenden Ordner (er wird dort hineingeladen) --
// dieselbe Team-Berechtigung wie "Ordner anlegen", aber unabhängig vom Status
// (auch nach "erledigt" noch nachtragbar/aktualisierbar).
function kannSpielberichtHochladen(a) {
  return !!a.ordnerPfad && (canEdit() || currentMannschaften.includes(a.mannschaft));
}

function spielberichtBoxHtml(a) {
  const hochgeladenInfo = a.spielberichtHochgeladenAm
    ? `<div class="auftrag-meta muted">Spielbericht hochgeladen von ${escapeHtml(personName(a.spielberichtHochgeladenVonVorname, a.spielberichtHochgeladenVonNachname, a.spielberichtHochgeladenVon))} am ${escapeHtml(fmtDate(a.spielberichtHochgeladenAm))}</div>`
    : "";
  // Noch nicht hochgeladener Entwurf hat Vorrang vor dem zuletzt gespeicherten
  // Stand -- siehe spielberichtDrafts weiter oben.
  const wert = Object.prototype.hasOwnProperty.call(spielberichtDrafts, a.id) ? spielberichtDrafts[a.id] : (a.spielbericht || "");
  return `
    <div class="spielbericht-box">
      <label>Spielbericht</label>
      <textarea class="spielbericht-text" rows="3" placeholder="z.B. Spielverlauf, Ergebnis, Torschützen ...">${escapeHtml(wert)}</textarea>
      <div class="btn-row" style="justify-content:flex-start; margin-top:6px;">
        <button type="button" class="btn secondary small btn-spielbericht-hochladen">Spielbericht als Word hochladen</button>
      </div>
      ${hochgeladenInfo}
    </div>`;
}

function auftraegeSorted() {
  return appData.auftraege.slice().sort((a, b) => (b.erstelltAm || "").localeCompare(a.erstelltAm || ""));
}

function renderAuftraege() {
  const list = auftraegeSorted();
  const container = document.getElementById("auftraege-rows");
  document.getElementById("auftraege-empty").style.display = list.length ? "none" : "block";
  container.innerHTML = list.map((a) => `
    <div class="auftrag-row" data-id="${escapeHtml(a.id)}">
      <div class="auftrag-row-main">
        <div class="auftrag-titel">${escapeHtml(a.mannschaft)}${a.gegner ? ` <span class="muted">vs. ${escapeHtml(a.gegner)}</span>` : ""} <span class="muted">· ${escapeHtml(fmtDatum(a.datum))}</span></div>
        <div class="auftrag-meta muted">Angefragt von ${escapeHtml(personName(a.erstelltVonVorname, a.erstelltVonNachname, a.erstelltVon))} am ${escapeHtml(fmtDate(a.erstelltAm))}</div>
        ${a.status === "wird-angelegt" ? `<div class="auftrag-meta muted">⏳ Wird gerade angelegt von ${escapeHtml(personName(null, null, a.ordnerWirdAngelegtVon))}…</div>` : ""}
        ${(a.status === "ordner-angelegt" || a.status === "erledigt") && a.freigabeLink ? `
          <div class="freigabe-link-box">
            <a href="${escapeHtml(a.freigabeLink)}" target="_blank" rel="noopener">${escapeHtml(a.freigabeLink)}</a>
            <button type="button" class="btn secondary small btn-copy-link" data-link="${escapeHtml(a.freigabeLink)}">📋 Kopieren</button>
          </div>
          <div class="auftrag-meta muted">Ordner angelegt von ${escapeHtml(personName(a.ordnerErstelltVonVorname, a.ordnerErstelltVonNachname, a.ordnerErstelltVon))} am ${escapeHtml(fmtDate(a.ordnerErstelltAm))}</div>
        ` : ""}
        ${a.status === "erledigt" ? `<div class="auftrag-meta muted">✅ Erledigt von ${escapeHtml(personName(null, null, a.erledigtVon))} am ${escapeHtml(fmtDate(a.erledigtAm))}</div>` : ""}
        ${kannSpielberichtHochladen(a) ? spielberichtBoxHtml(a) : ""}
      </div>
      <div class="auftrag-row-actions">
        ${statusBadgeHtml(a.status)}
        ${kannOrdnerAnlegen(a) ? `<button type="button" class="btn success small btn-ordner-anlegen">Ordner anlegen</button>` : ""}
        ${a.status === "wird-angelegt" && canEdit() ? `<button type="button" class="btn secondary small btn-zuruecksetzen">Zurücksetzen auf offen</button>` : ""}
        ${a.status === "ordner-angelegt" && canEdit() ? `<button type="button" class="btn small btn-erledigt">Als erledigt markieren</button>` : ""}
        ${canEdit() ? `<button type="button" class="btn secondary small btn-delete-auftrag">Löschen</button>` : ""}
      </div>
    </div>
  `).join("");
}

// Ordner+Freigabe anlegen läuft NICHT über saveWithConflictRetry/dav-save (siehe
// db.js ordnerAnlegen) -- der komplette Übergang (Reservieren, MKCOL, OCS-Freigabe,
// finales Speichern) passiert serverseitig in einer Aktion. Der Client übernimmt
// nur das Ergebnis.
async function handleOrdnerAnlegen(id, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Wird angelegt…";
  try {
    const res = await ordnerAnlegen(id);
    const idx = appData.auftraege.findIndex((a) => a.id === id);
    if (idx !== -1) appData.auftraege[idx] = res.auftrag; else appData.auftraege.push(res.auftrag);
    renderAuftraege();
  } catch (e) {
    if (e instanceof ConflictError) {
      alert("Dieser Auftrag wurde inzwischen von jemand anderem bearbeitet — Liste wird neu geladen.");
      try { appData = normalizeAppData(await gatewayLoad()); } catch (_) { /* ignorieren, alter Stand bleibt sichtbar */ }
      renderAuftraege();
    } else {
      alert("Fehler: " + e.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}

// ---------- Spielbericht (Freitext -> minimale .docx via JSZip, dann Upload) ----------

// Escaping für Freitext, der in word/document.xml-Textknoten landet -- & < >
// sind dort die einzigen zwingend zu escapenden Zeichen.
function escapeXmlText(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Baut ein minimales, gültiges .docx (nur Titel + Fließtext-Absätze, keine
// Formatvorlagen/Bilder) rein clientseitig über JSZip -- gleiche Bibliothek
// wie in digitaler-stempel bereits verwendet, kein Server-seitiges ZIP/OOXML
// nötig. Ein Absatz je Zeile des eingegebenen Texts.
async function buildSpielberichtDocxBlob(titel, text) {
  const absaetze = String(text || "").split(/\r?\n/)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r></w:p>`)
    .join("");
  const titelXml = `<w:p><w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${escapeXmlText(titel)}</w:t></w:r></w:p>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${titelXml}${absaetze}<w:sectPr/></w:body></w:document>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("_rels/.rels", relsXml);
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Datei konnte nicht gelesen werden"));
    reader.readAsDataURL(blob);
  });
}

async function handleSpielberichtHochladen(id, btn) {
  const row = btn.closest(".auftrag-row");
  const textarea = row.querySelector(".spielbericht-text");
  const text = textarea.value.trim();
  if (!text) { alert("Bitte zuerst einen Spielbericht eintragen."); return; }

  const auftrag = appData.auftraege.find((a) => a.id === id);
  const titel = `Spielbericht ${(auftrag && auftrag.mannschaft) || ""}`
    + (auftrag && auftrag.gegner ? ` vs. ${auftrag.gegner}` : "")
    + (auftrag ? ` — ${fmtDatum(auftrag.datum)}` : "");

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Wird hochgeladen…";
  try {
    const blob = await buildSpielberichtDocxBlob(titel, text);
    const dataBase64 = await blobToBase64(blob);
    const res = await spielberichtHochladen(id, text, dataBase64);
    delete spielberichtDrafts[id]; // erfolgreich gespeichert -- ab jetzt zeigt a.spielbericht den aktuellen Stand
    const idx = appData.auftraege.findIndex((a) => a.id === id);
    if (idx !== -1) appData.auftraege[idx] = res.auftrag;
    renderAuftraege();
  } catch (e) {
    if (e instanceof ConflictError) {
      alert("Der Auftrag wurde inzwischen geändert — Liste wird neu geladen. Bitte den Spielbericht danach erneut hochladen.");
      try { appData = normalizeAppData(await gatewayLoad()); } catch (_) { /* ignorieren, alter Stand bleibt sichtbar */ }
      renderAuftraege();
    } else {
      alert("Fehler beim Hochladen: " + e.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}

async function setzeZurueckAufOffen(id) {
  if (!canEdit()) return;
  await saveWithConflictRetry((data) => {
    const a = data.auftraege.find((x) => x.id === id);
    if (!a || a.status !== "wird-angelegt") return;
    a.status = "offen";
    a.ordnerWirdAngelegtVon = null;
    a.ordnerWirdAngelegtAm = null;
  });
  renderAuftraege();
}

async function alsErledigtMarkieren(id) {
  if (!canEdit()) return;
  await saveWithConflictRetry((data) => {
    const a = data.auftraege.find((x) => x.id === id);
    if (!a || a.status !== "ordner-angelegt") return;
    a.status = "erledigt";
    a.erledigtVon = currentUsername;
    a.erledigtAm = new Date().toISOString();
  });
  renderAuftraege();
}

// Läuft NICHT über saveWithConflictRetry/dav-save (siehe db.js auftragLoeschen) --
// das Löschen eines bereits angelegten Ordners samt Fotos/Spielbericht ist ein
// privilegierter Nextcloud-Zugriff, der serverseitig passiert.
async function deleteAuftragAdmin(id, btn) {
  if (!canEdit()) return;
  if (!confirm("Diesen Auftrag wirklich endgültig löschen? Ein bereits angelegter Nextcloud-Ordner wird dabei inklusive aller enthaltenen Fotos und des Spielberichts unwiderruflich mitgelöscht!")) return;
  const original = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = "Wird gelöscht…"; }
  try {
    await auftragLoeschen(id);
    appData.auftraege = appData.auftraege.filter((a) => a.id !== id);
    renderAuftraege();
  } catch (e) {
    if (e instanceof ConflictError) {
      alert("Der Auftrag wurde inzwischen geändert — Liste wird neu geladen. Bitte danach ggf. erneut löschen.");
      try { appData = normalizeAppData(await gatewayLoad()); } catch (_) { /* ignorieren, alter Stand bleibt sichtbar */ }
      renderAuftraege();
    } else {
      alert("Fehler beim Löschen: " + e.message);
      if (btn) { btn.disabled = false; btn.textContent = original; }
    }
  }
}

function copyLinkToClipboard(link, btn) {
  if (!link) return;
  const original = btn.textContent;
  navigator.clipboard.writeText(link).then(() => {
    btn.textContent = "✅ Kopiert";
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => { alert("Kopieren nicht möglich, bitte Link manuell markieren."); });
}

// ---------- Start ----------

function startApp() {
  document.getElementById("connect-screen").style.display = "none";
  document.getElementById("app-shell").style.display = "block";
}

function showConnectScreen(errorMsg) {
  document.getElementById("connect-screen").style.display = "block";
  document.getElementById("app-shell").style.display = "none";
  const err = document.getElementById("cloud-error");
  err.style.display = errorMsg ? "block" : "none";
  err.textContent = errorMsg || "";
}

async function init() {
  document.getElementById("version-badge").textContent = "v" + APP_VERSION;
  document.getElementById("version-badge-2").textContent = "v" + APP_VERSION;
  renderChangelog();
  setupVersionBadge();

  document.getElementById("f-datum").value = localDateIso();
  document.getElementById("btn-submit-auftrag").addEventListener("click", submitAuftrag);
  document.getElementById("btn-neuer-auftrag").addEventListener("click", showNeuerAuftragForm);
  document.getElementById("btn-cancel-neuer-auftrag").addEventListener("click", hideNeuerAuftragForm);

  document.getElementById("auftraege-rows").addEventListener("click", (e) => {
    const row = e.target.closest(".auftrag-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".btn-ordner-anlegen")) handleOrdnerAnlegen(id, e.target.closest(".btn-ordner-anlegen"));
    else if (e.target.closest(".btn-zuruecksetzen")) setzeZurueckAufOffen(id);
    else if (e.target.closest(".btn-erledigt")) alsErledigtMarkieren(id);
    else if (e.target.closest(".btn-delete-auftrag")) deleteAuftragAdmin(id, e.target.closest(".btn-delete-auftrag"));
    else if (e.target.closest(".btn-spielbericht-hochladen")) handleSpielberichtHochladen(id, e.target.closest(".btn-spielbericht-hochladen"));
    else if (e.target.closest(".btn-copy-link")) {
      const b = e.target.closest(".btn-copy-link");
      copyLinkToClipboard(b.dataset.link, b);
    }
  });

  // Haelt getippten, noch nicht hochgeladenen Spielbericht-Text fest, damit er
  // ein renderAuftraege() durch eine ANDERE Aktion (z.B. "Als erledigt
  // markieren" auf demselben oder einem anderen Auftrag) überlebt.
  document.getElementById("auftraege-rows").addEventListener("input", (e) => {
    if (!e.target.classList.contains("spielbericht-text")) return;
    const row = e.target.closest(".auftrag-row");
    if (!row) return;
    spielberichtDrafts[row.dataset.id] = e.target.value;
  });

  if (!getSessionToken()) {
    showConnectScreen();
    return;
  }

  try {
    // fetchMe() (Identität) und gatewayLoad() (Aufträge) sind unabhängige
    // Worker-Aufrufe — parallel statt seriell spart einen kompletten Roundtrip
    // vorm ersten sichtbaren Inhalt.
    const [me, data] = await Promise.all([fetchMe(), gatewayLoad()]);
    currentUsername = me.username;
    currentIsAdmin = !!me.isAdmin;
    currentCanEdit = !!me.canEdit;
    currentVorname = me.vorname || null;
    currentNachname = me.nachname || null;
    currentMannschaften = Array.isArray(me.mannschaften) ? me.mannschaften : [];
    appData = normalizeAppData(data);
    document.getElementById("btn-neuer-auftrag").style.display = canEdit() ? "" : "none";
    startApp();
    renderHeaderUser();
    renderAuftraege();
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      showConnectScreen();
    } else {
      showConnectScreen("Fehler beim Laden: " + e.message);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => { init(); });
