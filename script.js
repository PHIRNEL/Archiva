/* =====================================================================
   ARCHIVAGE ÉLECTRONIQUE — DSIC
   Ministère de la Sécurité sociale, prevoyance sociale et de la solidarité nationale
   ===================================================================== */


/* ---------------------------------------------------------------------
   1. PETITS OUTILS
   Des raccourcis pour ne pas répéter les mêmes longues phrases partout.
   --------------------------------------------------------------------- */

// $("#id") = trouver un élément de la page
const $ = s => document.querySelector(s);

// Protège le texte avant de l'afficher : si quelqu'un tape du code
// dans un champ, il s'affichera comme du texte et ne sera jamais exécuté.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Lire / écrire dans la mémoire du navigateur (localStorage).
// "get" renvoie une valeur par défaut si rien n'est encore enregistré.
const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// Dates à la française : 15/01/2026
const fdate = iso => new Date(iso).toLocaleDateString("fr-FR");
const fdt = iso => iso ? new Date(iso).toLocaleString("fr-FR") : "—";


/* ---------------------------------------------------------------------
   2. LISTES DE RÉFÉRENCE
   Si un jour il faut ajouter un type de document, c'est ici.
   --------------------------------------------------------------------- */
const TYPES = ["Note", "Lettre", "Lettre PR", "Lettre PM", "Autre"];
const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// Deux rôles seulement : celui qui fait tout, et celui qui consulte.
const ROLES = { super: "Super utilisateur", agent: "Consultant" };

// Durée d'inactivité avant déconnexion automatique (10 minutes)
const INACTIVITY_MS = 10 * 60 * 1000;


/* ---------------------------------------------------------------------
   3. LES DONNÉES
   Pour l'instant tout est gardé dans le navigateur (simulation).
   Dans la version réelle, ces données viendront de la base MySQL.
   --------------------------------------------------------------------- */

// Les comptes présents au tout premier lancement
const DEFAULT_USERS = [
  { username: "elion", name: "GAMI ELION", role: "super", password: "DSIC26", active: true, last: null },
  { username: "phirnel", name: "PHIRNEL ONGAGNA", role: "super", password: "super2026", active: true, last: null },
  { username: "consultant", name: "Consultant", role: "agent", password: "consult123", active: true, last: null },

];

// Les documents ne sont jamais simulés dans ARCHIVA.
// Le catalogue affiché est chargé directement depuis Dropbox.
// Les comptes existants sont conservés dans le navigateur dans cette version.
let users = get("ae2_users", DEFAULT_USERS);
let logs = get("ae2_logs", []);
// Ancien catalogue local : il pouvait contenir des exemples ou des entrées non synchronisées.
// On le retire pour empêcher l'affichage de documents qui n'existent pas dans Dropbox.
try { localStorage.removeItem("ae2_docs"); } catch (e) {}

let me = null;          // la personne actuellement connectée
let view = "dash";      // la page affichée côté super utilisateur
let flt = { q: "", type: "", year: "", month: "" };  // filtres de la liste des documents
let lastResults = [];   // derniers résultats de recherche (pour imprimer / exporter)
let idleTimer = null;   // chronomètre d'inactivité

// Les comptes restent dans le navigateur dans cette version.
// Les documents et le journal officiel ne sont jamais enregistrés comme données locales.
const persist = () => {
  try { save("ae2_users", users); }
  catch (e) { alert("Stockage du navigateur indisponible."); }
};
persist();

// Envoi du journal vers Dropbox. Le serveur crée un fichier JSON distinct par événement.
// Le cache local sert uniquement à afficher une activité récente si nécessaire.
const auditSession = sessionStorage.getItem("archiva_audit_session") || (() => {
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  sessionStorage.setItem("archiva_audit_session", id); return id;
})();
function log(action, user, target = "", details = "") {
  const event = { d: new Date().toISOString(), u: user || (me && me.username) || "—", role: me?.role || "inconnu", a: action, target, details, sessionId: auditSession };
  logs.unshift(event); logs = logs.slice(0, 100);
  try { save("ae2_logs", logs); } catch (e) {}
  fetch("/api/dropbox-search?action=log", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(event), keepalive: true })
    .then(async response => { if (!response.ok) { const p = await response.json().catch(() => ({})); console.error("Journal Dropbox non enregistré:", p.error || response.status); } })
    .catch(error => console.error("Journal Dropbox indisponible:", error));
}

// Petit message qui apparaît quelques secondes en bas à droite
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2600);
}


/* ---------------------------------------------------------------------
   4. LES DROITS
   can("doc") = « la personne connectée a-t-elle le droit de gérer
   les documents ? ». Seul le super utilisateur a ces droits.
   Lire et télécharger un document est permis à tout le monde.
   --------------------------------------------------------------------- */
const can = action => me && ({
  doc: ["super"],     // ajouter / modifier / supprimer des documents
  users: ["super"],   // gérer les comptes
  logs: ["super"]     // voir le journal
}[action] || []).includes(me.role);


/* ---------------------------------------------------------------------
   5. CONNEXION, DÉCONNEXION, INACTIVITÉ
   --------------------------------------------------------------------- */

// Quand on clique sur « Se connecter »
$("#loginForm").addEventListener("submit", e => {
  e.preventDefault();   // empêche la page de se recharger
  const u = $("#username").value.trim().toLowerCase();
  const p = $("#password").value;
  const user = users.find(x => x.username === u && x.password === p);

  // Mauvais identifiant ou mot de passe : on le note et on refuse
  if (!user) {
    log("Échec de connexion", u);
    $("#loginError").textContent = "Identifiant ou mot de passe incorrect.";
    return;
  }
  // Le compte existe mais le super utilisateur l'a désactivé
  if (!user.active) {
    log("Connexion refusée (compte désactivé)", u);
    $("#loginError").textContent = "Ce compte est désactivé. Contactez le super utilisateur.";
    return;
  }
  // Tout est bon : on retient l'heure de connexion et on ouvre la session
  user.last = new Date().toISOString();
  persist();
  sessionStorage.setItem("ae_me", user.username);   // pour garder la session si on recharge
  start(user);
  log("Connexion");
});

// Ouvre la bonne interface selon le rôle
function start(user) {
  me = user;
  $("#loginError").textContent = "";
  $("#loginForm").reset();
  $("#loginPage").classList.add("hidden");
  armTimer();

  if (me.role === "agent") {
    startConsult();           // consultant -> recherche simple
  } else {
    view = "dash";            // super utilisateur -> tableau de bord
    $("#app").classList.remove("hidden");
    $("#meName").textContent = me.name;
    $("#meRole").textContent = ROLES[me.role];
    render();
  }
}

// Déconnexion demandée par la personne (avec confirmation)
function logout() {
  if (!confirm("Voulez-vous vraiment quitter votre session ?")) return;
  closeSession();
}

// Ferme réellement la session et revient à la page de connexion
function closeSession() {
  if (me) log("Déconnexion");
  sessionStorage.removeItem("ae_me");
  me = null;
  clearTimeout(idleTimer);
  $("#app").classList.add("hidden");
  $("#consultPage").classList.add("hidden");
  $("#loginPage").classList.remove("hidden");
  window.scrollTo(0, 0);
}

// Sécurité : si personne ne touche à l'écran pendant 10 minutes,
// la session se ferme toute seule (utile sur un poste partagé).
function armTimer() {
  clearTimeout(idleTimer);
  if (!me) return;
  idleTimer = setTimeout(() => {
    alert("Session fermée après 10 minutes d'inactivité.");
    closeSession();
  }, INACTIVITY_MS);
}
["click", "keydown", "mousemove", "touchstart"].forEach(ev => document.addEventListener(ev, armTimer));


/* =====================================================================
   6. INTERFACE CONSULTANT
   Pas de tableau de bord. Deux écrans seulement :
     - l'écran de recherche (un type de document OU un mois)
     - l'écran des résultats
   ===================================================================== */

// Affiche l'interface consultant (appelée juste après la connexion)
function startConsult() {
  $("#consultPage").classList.remove("hidden");
  $("#cUser").textContent = me.name;

  // On remplit les deux listes déroulantes
  $("#cType").innerHTML = `<option value="">Sélectionner un type</option>` +
    TYPES.map(t => `<option value="${t}">${t}</option>`).join("");
  $("#cMonth").innerHTML = `<option value="">Sélectionner un mois</option>` +
    MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, "0")}">${m}</option>`).join("");
  lockOther();

  // On arrive toujours sur l'écran de recherche
  $("#cResult").classList.add("hidden");
  $("#cSearch").classList.remove("hidden");
}

// Règle « un seul critère » : dès qu'on choisit un type, la liste des mois
// est grisée (et inversement). Si on vide le choix, l'autre se réactive.
function lockOther() {
  const t = $("#cType").value, m = $("#cMonth").value;
  $("#cMonth").disabled = !!t;
  $("#cType").disabled = !!m;
}
$("#cType").addEventListener("change", lockOther);
$("#cMonth").addEventListener("change", lockOther);

// Bouton ANNULER de la recherche : vide les deux champs, sans déconnecter.
// (setTimeout laisse le navigateur vider les champs avant de réactiver les listes)
$("#cForm").addEventListener("reset", () => setTimeout(lockOther, 0));

// Bouton VALIDER : recherche réelle dans le dossier Dropbox ARCHIVA.
$("#cForm").addEventListener("submit", async e => {
  e.preventDefault();
  const type = $("#cType").value, month = $("#cMonth").value;
  if (!type && !month) {
    alert("Veuillez choisir un type de document ou un mois.");
    return;
  }

  const submitButton = $("#cForm").querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Recherche dans Dropbox…";
  try {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (month) params.set("month", month);
    const response = await fetch(`/api/dropbox-search?${params.toString()}`, { headers: { "Accept": "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "La recherche Dropbox a échoué.");

    lastResults = (payload.files || []).map(file => ({
      ref: file.name, type: file.type || "Autre", date: file.date,
      name: file.name, size: file.size, path: file.path,
      file: { source: "dropbox", name: file.name, path: file.path }
    })).sort((a, b) => b.date.localeCompare(a.date));

    $("#rCrit").textContent = type ? "Type de document" : "Mois";
    $("#rVal").textContent = type || MONTHS[+month - 1];
    $("#rCount").textContent = `${lastResults.length} document(s) réel(s)`;
    $("#rTable").innerHTML = docTable(lastResults);
    log("Recherche Dropbox : " + (type ? "type " + type : "mois " + MONTHS[+month - 1]) + " (" + lastResults.length + " résultat(s))");
    $("#cSearch").classList.add("hidden");
    $("#cResult").classList.remove("hidden");
    window.scrollTo(0, 0);
  } catch (error) {
    alert(error.message || "Impossible de contacter Dropbox.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Valider";
  }
});

// Bouton RETOUR (page des résultats) : revient à la recherche
// sans déconnexion. Les choix précédents restent affichés.
function backToSearch() {
  $("#cResult").classList.add("hidden");
  $("#cSearch").classList.remove("hidden");
  window.scrollTo(0, 0);
}
// (Le bouton ANNULER de la page des résultats appelle logout() : il quitte la session.)


/* =====================================================================
   7. INTERFACE SUPER UTILISATEUR
   ===================================================================== */

/* ----- 7.1 Navigation : le menu de gauche ----- */
function render() {
  // Le menu : les pages disponibles pour le super utilisateur
  const items = [["dash", "▦", "Tableau de bord"], ["docs", "▤", "Documents"]];
  if (can("logs")) items.push(["logs", "☰", "Journal d'activité"]);
  if (can("users")) items.push(["users", "♟", "Utilisateurs"]);

  $("#nav").innerHTML = items.map(i =>
    `<button class="${i[0] === view ? "on" : ""}" onclick="go('${i[0]}')"><span>${i[1]}</span>${i[2]}</button>`).join("");
  $("#crumb").textContent = items.find(i => i[0] === view)[2].toUpperCase();

  // On affiche la page choisie
  ({ dash: viewDash, docs: viewDocs, logs: viewLogs, users: viewUsers })[view]();
}
function go(v) { view = v; $("#sidebar").classList.remove("open"); render(); window.scrollTo(0, 0); }

// L'horloge en haut à droite, mise à jour chaque seconde
setInterval(() => { const c = $("#clock"); if (c) c.textContent = new Date().toLocaleString("fr-FR"); }, 1000);


/* ----- 7.2 Tableau de bord ----- */

// Dessine des barres horizontales à partir d'une liste [nom, nombre]
function hbars(rows) {
  const max = Math.max(1, ...rows.map(r => r[1]));   // la plus longue barre = 100 %
  return rows.map(r => `<div class="hbar"><span>${esc(r[0])}</span><div><i style="width:${r[1] / max * 100}%"></i></div><b>${r[1]}</b></div>`).join("");
}

let dashboardRequest = 0;
function formatBytes(bytes) {
  if (!bytes) return "0 octet";
  const units = ["octets", "Ko", "Mo", "Go", "To"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${units[unit]}`;
}
function dashBars(rows) {
  if (!rows.length || rows.every(r => !Number(r[1]))) return `<div class="empty">Aucune donnée Dropbox pour cette période.</div>`;
  return hbars(rows);
}
function renderDropboxDashboard(data) {
  const year = data.currentYear;
  const byType = Object.entries(data.byType || {}).sort((a,b) => b[1]-a[1]);
  const byYear = Object.entries(data.byYear || {}).sort((a,b) => b[0].localeCompare(a[0]));
  const monthRows = MONTHS.map((m, i) => [m.slice(0,3), (data.byMonth || [])[i] || 0]);
  const recent = (data.recent || []).map(file => ({
    ref: file.name, type: file.type || "Autre", date: file.date || "",
    name: file.name, size: file.size || 0, path: file.path,
    file: { source: "dropbox", name: file.name, path: file.path }
  }));
  const extRows = Object.entries(data.byExtension || {}).sort((a,b) => b[1]-a[1]).slice(0,8);
  const kpis = `
    <div class="kpi"><span>Fichiers dans Dropbox</span><strong>${Number(data.totalFiles || 0).toLocaleString("fr-FR")}</strong></div>
    <div class="kpi g"><span>Espace occupé</span><strong>${formatBytes(data.totalSize || 0)}</strong></div>
    <div class="kpi y"><span>Modifiés en ${esc(year)}</span><strong>${Number(data.modifiedThisYear || 0).toLocaleString("fr-FR")}</strong></div>
    <div class="kpi r"><span>Fichiers sans extension</span><strong>${Number(data.noExtension || 0).toLocaleString("fr-FR")}</strong></div>`;
  const lastSync = data.generatedAt ? new Date(data.generatedAt).toLocaleString("fr-FR") : "—";
  $("#main").innerHTML = `
    <div class="head"><div><span class="section-label">ADMINISTRATION</span><h1>Bonjour, ${esc(me.name)}</h1><p>Statistiques calculées à partir des fichiers réellement présents dans Dropbox.</p></div>
      <button class="btn-primary" onclick="refreshDropboxDashboard()">Actualiser les données</button></div>
    <div class="dash-source"><span class="status-dot"></span><b>Dropbox connecté</b><span>· Dossier : ${esc(data.folder)}</span><span>· Actualisé : ${esc(lastSync)}</span></div>
    <div class="kpis">${kpis}</div>
    <div class="grid2">
      <div class="card"><h3>Répartition par type de document</h3>${dashBars(byType)}</div>
      <div class="card"><h3>Répartition par année de modification</h3>${dashBars(byYear)}</div>
    </div>
    <div class="card"><h3>Fichiers modifiés par mois en ${esc(year)}</h3><div class="cols">${monthRows.map(([m,n]) => `<div><b>${n || ""}</b><i style="height:${n ? Math.max(3, n / Math.max(1,...monthRows.map(x=>x[1])) * 100) : 2}px"></i>${m}</div>`).join("")}</div></div>
    <div class="grid2">
      <div class="card"><h3>Formats de fichiers</h3>${dashBars(extRows)}</div>
      <div class="card"><h3>Contrôles automatiques</h3><ul class="dash-tips"><li>${Number((data.byType || {}).Autre || 0)} fichier(s) dont le type est à vérifier (« Autre »).</li><li>${Number(data.noExtension || 0)} fichier(s) sans extension.</li><li>${Number(data.duplicateNameGroups || 0)} nom(s) de fichier présent(s) à plusieurs emplacements, à vérifier.</li></ul><p class="muted">Les noms identiques ne prouvent pas que le contenu est identique. Les dates affichées sont celles de modification Dropbox.</p></div>
    </div>
    <div class="card"><h3>Derniers fichiers modifiés dans Dropbox</h3>${docTable(recent)}</div>
    <div class="card"><h3>Dernières activités tracées dans Dropbox</h3>${logTable(logs.slice(0, 6))}</div>`;
}
async function refreshDropboxDashboard() {
  const requestId = ++dashboardRequest;
  logs = []; // le tableau de bord ne montre jamais le cache local comme journal officiel
  $("#main").innerHTML = `<div class="head"><div><h1>Tableau de bord</h1><p>Lecture des métadonnées réelles de Dropbox…</p></div></div><div class="card"><div class="loading-line"></div><p class="muted">Connexion au dossier ARCHIVA en cours.</p></div>`;
  try {
    const response = await fetch("/api/dropbox-search?action=stats", { headers: { "Accept": "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erreur API (${response.status}).`);
    if (requestId !== dashboardRequest || view !== "dash") return;
    const auditResponse = await fetch("/api/dropbox-search?action=logs", { headers: { "Accept": "application/json" }, cache: "no-store" });
    if (auditResponse.ok) { const auditPayload = await auditResponse.json(); logs = auditPayload.logs || []; }
    renderDropboxDashboard(payload);
  } catch (error) {
    if (requestId !== dashboardRequest || view !== "dash") return;
    $("#main").innerHTML = `<div class="head"><div><h1>Tableau de bord</h1><p>Impossible de récupérer les statistiques Dropbox.</p></div><button class="btn-primary" onclick="refreshDropboxDashboard()">Réessayer</button></div>
      <div class="card"><span class="badge off">Dropbox indisponible</span><h3>Erreur de connexion</h3><p>${esc(error.message)}</p><p class="muted">Les statistiques ne sont pas remplacées par des chiffres fictifs. Vérifiez la configuration Dropbox et les journaux Vercel.</p></div>
      <div class="card"><h3>Comptes ARCHIVA</h3><p>${users.filter(u => u.active).length} compte(s) actif(s) sur ${users.length}.</p></div>
      <div class="card"><h3>Dernières activités tracées dans Dropbox</h3>${logTable(logs.slice(0, 6))}</div>`;
  }
}
function viewDash() { refreshDropboxDashboard(); }

/* ----- 7.3 Documents ----- */

// Tableau construit exclusivement à partir des métadonnées Dropbox.
function docTable(list) {
  if (!list.length) return `<div class="empty">Aucun fichier correspondant dans Dropbox.</div>`;
  return `<div class="table-container"><table><thead><tr><th>N°</th><th>Chemin Dropbox</th><th>Type estimé</th><th>Modifié le</th><th>Nom du fichier</th><th>Taille</th><th>Actions</th></tr></thead><tbody>` +
    list.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.path || d.ref)}</td><td><span class="badge">${esc(d.type || "Autre")}</span></td><td>${d.date ? fdate(d.date + "T00:00:00") : "Date indisponible"}</td><td>${esc(d.name)}</td><td>${d.size ? (d.size / 1024).toFixed(1) + " Ko" : "—"}</td>
      <td><button class="btn-secondary btn-sm" onclick="openDropboxDoc('${encodeURIComponent(d.path).replace(/'/g, '%27')}')">Lire</button> <button class="btn-primary btn-sm" onclick="downloadDropboxDoc('${encodeURIComponent(d.path).replace(/'/g, '%27')}')">Télécharger</button></td></tr>`).join("") + `</tbody></table></div>`;
}

// Les liens Dropbox sont créés côté serveur et restent temporaires.
async function dropboxTemporaryLink(encodedPath) {
  const path = decodeURIComponent(encodedPath);
  const response = await fetch(`/api/dropbox-search?action=link&path=${encodeURIComponent(path)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Impossible d'obtenir le lien Dropbox.");
  return payload.url;
}
async function openDropboxDoc(encodedPath) {
  try { const path = decodeURIComponent(encodedPath); const url = await dropboxTemporaryLink(encodedPath); window.open(url, "_blank", "noopener"); log("Consultation d'un document", me?.username, path); }
  catch (error) { alert(error.message); }
}
async function downloadDropboxDoc(encodedPath) {
  try {
    const path = decodeURIComponent(encodedPath);
    const url = await dropboxTemporaryLink(encodedPath);
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.click();
    log("Téléchargement d'un document", me?.username, path);
  } catch (error) { alert(error.message); }
}

// Catalogue réel Dropbox uniquement. Les filtres s'appliquent aux métadonnées reçues de Dropbox.
let dropboxDocs = [];
function filtered() {
  const q = flt.q.toLowerCase();
  return dropboxDocs.filter(d =>
    (!q || (d.name + " " + d.path + " " + d.type).toLowerCase().includes(q)) &&
    (!flt.type || d.type === flt.type) &&
    (!flt.year || (d.date || "").startsWith(flt.year)) &&
    (!flt.month || (d.date || "").slice(5, 7) === flt.month)
  ).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

async function viewDocs() {
  const requestView = view;
  flt = { q: "", type: "", year: "", month: "" };
  $("#main").innerHTML = `<div class="head"><div><h1>Documents archivés</h1><p>Catalogue synchronisé avec le dossier Dropbox ARCHIVA. Aucun document local ou fictif n'est affiché.</p></div></div><div class="card"><div class="loading-line"></div><p class="muted">Chargement des fichiers réels depuis Dropbox…</p></div>`;
  try {
    const response = await fetch("/api/dropbox-search?action=files", { headers: { "Accept": "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erreur Dropbox (${response.status}).`);
    if (view !== requestView) return;
    dropboxDocs = (payload.files || []).map(file => ({
      ref: file.path, type: file.type || "Autre", date: file.date || "", name: file.name, size: file.size || 0, path: file.path,
      file: { source: "dropbox", name: file.name, path: file.path }
    }));
    const yrs = [...new Set(dropboxDocs.map(d => d.date.slice(0, 4)).filter(Boolean))].sort().reverse();
    const sel = (id, ph, opts) => `<select id="${id}"><option value="">${ph}</option>${opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join("")}</select>`;
    $("#main").innerHTML = `
      <div class="head"><div><h1>Documents archivés</h1><p>${dropboxDocs.length.toLocaleString("fr-FR")} fichier(s) réel(s) dans Dropbox.</p></div>
        <button class="btn-secondary" onclick="exportCsv(filtered())">Exporter CSV</button></div>
      <div class="card"><div class="tools">
        <input id="fq" placeholder="Rechercher par nom ou chemin…">
        ${sel("ft", "Tous les types", TYPES.map(t => [t, t]))}
        ${sel("fy", "Toutes les années", yrs.map(y => [y, y]))}
        ${sel("fm", "Tous les mois", MONTHS.map((m, i) => [String(i + 1).padStart(2, "0"), m]))}
      </div><p class="muted" id="cnt" style="margin-bottom:12px"></p><div id="tbl"></div></div>`;
    const draw = () => { const list = filtered(); $("#cnt").textContent = `${list.length} fichier(s) trouvé(s) dans Dropbox`; $("#tbl").innerHTML = docTable(list); };
    [["fq", "q"], ["ft", "type"], ["fy", "year"], ["fm", "month"]].forEach(([id, key]) => $("#" + id).addEventListener("input", e => { flt[key] = e.target.value; draw(); }));
    draw();
    log("Consultation du catalogue Dropbox", me?.username, payload.folder, `${dropboxDocs.length} fichiers listés`);
  } catch (error) {
    if (view !== requestView) return;
    $("#main").innerHTML = `<div class="head"><div><h1>Documents archivés</h1><p>Le catalogue n'est pas disponible.</p></div><button class="btn-primary" onclick="viewDocs()">Réessayer</button></div><div class="card"><span class="badge off">Dropbox indisponible</span><p>${esc(error.message)}</p><p class="muted">Aucun document fictif n'est affiché en remplacement.</p></div>`;
  }
}

// Exporte une liste de documents en CSV (lisible dans Excel).
// Sans argument : exporte la liste filtrée de la page Documents.
function exportCsv(list) {
  list = list || filtered();
  const rows = [["Chemin Dropbox", "Type estimé", "Date de modification Dropbox", "Nom du fichier", "Taille en octets"], ...list.map(d => [d.path || d.ref, d.type, d.date, d.name, d.size || 0])];
  const csv = "\ufeff" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "archiva-fichiers-dropbox.csv"; a.click();
  log("Export CSV");
}


/* ----- 7.4 Utilisateurs (gérés uniquement par le super utilisateur) ----- */

function viewUsers() {
  $("#main").innerHTML = `
    <div class="head"><div><h1>Gestion des utilisateurs</h1><p>Créer des comptes, attribuer des rôles, activer ou désactiver l'accès.</p></div>
      <button class="btn-primary" onclick="userForm()">+ Nouvel utilisateur</button></div>
    <div class="card"><div class="table-container"><table><thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th>Actions</th></tr></thead><tbody>` +
    users.map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td>
      <td><span class="badge ${u.role === "super" ? "sup" : ""}">${ROLES[u.role]}</span></td>
      <td><span class="badge ${u.active ? "ok" : "off"}">${u.active ? "Actif" : "Désactivé"}</span></td><td>${fdt(u.last)}</td>
      <td><button class="btn-secondary btn-sm" onclick="userForm('${u.username}')">Modifier</button>
      ${u.username !== me.username   // on ne peut pas se désactiver / se supprimer soi-même
        ? `<button class="btn-secondary btn-sm" onclick="userToggle('${u.username}')">${u.active ? "Désactiver" : "Activer"}</button><button class="btn-danger btn-sm" onclick="userDel('${u.username}')">Supprimer</button>` : ""}</td></tr>`).join("") +
    `</tbody></table></div></div>`;
}

// Y a-t-il un AUTRE super utilisateur actif ? (pour ne jamais rester sans chef)
const otherSuper = name => users.some(u => u.role === "super" && u.active && u.username !== name);

// Formulaire de création (sans name) ou de modification (avec name) d'un compte
function userForm(name) {
  const u = users.find(x => x.username === name) || { username: "", name: "", role: "agent", active: true };
  modal(name ? "Modifier l'utilisateur" : "Nouvel utilisateur", `
    <label>Identifiant</label><input name="username" value="${esc(u.username)}" ${name ? "readonly" : ""} required>
    <label>Nom complet</label><input name="name" value="${esc(u.name)}" required>
    <label>Rôle</label><select name="role">${Object.entries(ROLES).map(r => `<option value="${r[0]}" ${r[0] === u.role ? "selected" : ""}>${r[1]}</option>`).join("")}</select>
    <label>Mot de passe ${name ? "(laisser vide pour conserver)" : ""}</label><input type="password" name="password" ${name ? "" : "required"} minlength="4">`,
    v => {
      v.username = v.username.trim().toLowerCase();
      if (!name && users.some(x => x.username === v.username)) { alert("Cet identifiant existe déjà."); return false; }
      if (name && u.role === "super" && v.role !== "super" && !otherSuper(name)) { alert("Il doit rester au moins un super utilisateur."); return false; }
      if (name) { u.name = v.name; u.role = v.role; if (v.password) u.password = v.password; log("Utilisateur modifié : " + name); }
      else { users.push({ username: v.username, name: v.name, role: v.role, password: v.password, active: true, last: null }); log("Utilisateur créé : " + v.username); }
      persist(); toast("Utilisateur enregistré."); render();
    });
}

// Active ou désactive un compte
function userToggle(name) {
  const u = users.find(x => x.username === name);
  if (u.active && u.role === "super" && !otherSuper(name)) return alert("Il doit rester au moins un super utilisateur actif.");
  u.active = !u.active;
  log((u.active ? "Compte activé : " : "Compte désactivé : ") + name); persist(); render();
}

// Supprime un compte après confirmation
function userDel(name) {
  const u = users.find(x => x.username === name);
  if (u.role === "super" && !otherSuper(name)) return alert("Il doit rester au moins un super utilisateur.");
  if (!confirm("Supprimer le compte " + name + " ?")) return;
  users = users.filter(x => x.username !== name);
  log("Utilisateur supprimé : " + name); persist(); render();
}


/* ----- 7.5 Journal d'activité persistant dans Dropbox ----- */
function logTable(list) {
  if (!list.length) return `<div class="empty">Aucune activité enregistrée dans le journal Dropbox.</div>`;
  return `<div class="table-container"><table><thead><tr><th>Date et heure</th><th>Utilisateur déclaré</th><th>Rôle</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead><tbody>` +
    list.map(l => `<tr><td>${fdt(l.d)}</td><td>${esc(l.u)}</td><td>${esc(l.role || "—")}</td><td>${esc(l.a)}</td><td>${esc(l.target || "—")}</td><td>${esc(l.details || "—")}</td></tr>`).join("") + `</tbody></table></div>`;
}
async function viewLogs() {
  $("#main").innerHTML = `<div class="head"><div><h1>Journal de traçabilité</h1><p>Événements enregistrés sous forme de fichiers JSON dans Dropbox. Les entrées ne peuvent pas être effacées depuis ARCHIVA.</p></div><button class="btn-primary" onclick="viewLogs()">Actualiser</button></div><div class="card"><div class="loading-line"></div><p class="muted">Lecture du journal d’activité dans Dropbox…</p></div>`;
  try {
    const response = await fetch("/api/dropbox-search?action=logs", { headers: { "Accept": "application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erreur API (${response.status}).`);
    logs = payload.logs || [];
    $("#main").innerHTML = `<div class="head"><div><h1>Journal de traçabilité</h1><p>${logs.length} événement(s) récent(s), conservés dans Dropbox.</p></div><div><button class="btn-secondary" onclick="exportLogsCsv()">Exporter le journal CSV</button> <button class="btn-primary" onclick="viewLogs()">Actualiser</button></div></div><div class="card"><p class="muted">Dossier : ${esc(payload.auditFolder || "Journal Dropbox")} · Journal non effaçable depuis l'interface.</p>${logTable(logs)}</div>`;
  } catch (error) {
    $("#main").innerHTML = `<div class="head"><div><h1>Journal de traçabilité</h1><p>Impossible de lire le journal Dropbox.</p></div><button class="btn-primary" onclick="viewLogs()">Réessayer</button></div><div class="card"><span class="badge off">Journal indisponible</span><p>${esc(error.message)}</p><p class="muted">Le journal local n'est pas présenté comme une preuve de traçabilité.</p></div>`;
  }
}
function exportLogsCsv() {
  const rows = [["Date UTC", "Utilisateur déclaré", "Rôle déclaré", "Action", "Cible", "Détails", "Session", "Identifiant événement"], ...logs.map(l => [l.d, l.u, l.role, l.a, l.target, l.details, l.sessionId, l.id])];
  const csv = "\ufeff" + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "archiva-journal-tracabilite.csv"; a.click();
  log("Export du journal de traçabilité", me?.username, "Journal Dropbox");
}


/* =====================================================================
   8. REPRISE DE SESSION
   Si la personne recharge la page (F5) alors qu'elle était connectée,
   on la reconnecte automatiquement, sauf si son compte a été désactivé.
   ===================================================================== */
const saved = users.find(u => u.username === sessionStorage.getItem("ae_me") && u.active);
if (saved) start(saved);
