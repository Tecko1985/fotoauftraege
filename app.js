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

function activateTab(name) {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.remove("active"));
  document.querySelector(`nav button[data-tab="${name}"]`).classList.add("active");
  document.getElementById("tab-" + name).classList.add("active");
}

function setupTabs() {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => {
    b.addEventListener("click", () => {
      activateTab(b.dataset.tab);
      if (b.dataset.tab === "neuer-auftrag") ensureTrainerProfiles();
    });
  });

  const versionBadgeHeader = document.getElementById("version-badge");
  const openVersionHistory = () => {
    activateTab("auftraege");
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

// ---------- Neuer Auftrag (Editor) ----------

function resetAuftragForm() {
  document.getElementById("f-mannschaft").value = "";
  document.getElementById("f-datum").value = localDateIso();
  document.getElementById("f-notiz").value = "";
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
  const notiz = document.getElementById("f-notiz").value.trim();

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
      notiz,
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
      erledigtAm: null
    };
    await saveWithConflictRetry((data) => { data.auftraege.push(auftrag); });
    resetAuftragForm();
    renderAuftraege();
    activateTab("auftraege");
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
        <div class="auftrag-titel">${escapeHtml(a.mannschaft)} <span class="muted">· ${escapeHtml(fmtDatum(a.datum))}</span></div>
        ${a.notiz ? `<div class="auftrag-notiz muted">${escapeHtml(a.notiz)}</div>` : ""}
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

async function deleteAuftragAdmin(id) {
  if (!canEdit()) return;
  if (!confirm("Diesen Auftrag wirklich endgültig löschen? Ein bereits angelegter Nextcloud-Ordner/Link bleibt davon unberührt (kein automatischer Widerruf).")) return;
  await saveWithConflictRetry((data) => {
    data.auftraege = data.auftraege.filter((a) => a.id !== id);
  });
  renderAuftraege();
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
  setupTabs();

  document.getElementById("f-datum").value = localDateIso();
  document.getElementById("btn-submit-auftrag").addEventListener("click", submitAuftrag);

  document.getElementById("auftraege-rows").addEventListener("click", (e) => {
    const row = e.target.closest(".auftrag-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".btn-ordner-anlegen")) handleOrdnerAnlegen(id, e.target.closest(".btn-ordner-anlegen"));
    else if (e.target.closest(".btn-zuruecksetzen")) setzeZurueckAufOffen(id);
    else if (e.target.closest(".btn-erledigt")) alsErledigtMarkieren(id);
    else if (e.target.closest(".btn-delete-auftrag")) deleteAuftragAdmin(id);
    else if (e.target.closest(".btn-copy-link")) {
      const b = e.target.closest(".btn-copy-link");
      copyLinkToClipboard(b.dataset.link, b);
    }
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
    document.getElementById("nav-neuer-auftrag").style.display = canEdit() ? "" : "none";
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
