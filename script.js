/* =====================================================================
   ARCHIVAGE ÉLECTRONIQUE — DSIC
   Ministère de la Sécurité sociale

   Comment lire ce fichier (dans l'ordre) :
     1. Petits outils utilitaires
     2. Listes de référence (types de documents, mois, rôles)
     3. Les données (comptes, documents, journal)
     4. Les droits de chaque rôle
     5. Connexion, déconnexion et fermeture automatique de session
     6. Interface CONSULTANT (recherche -> résultats)
     7. Interface SUPER UTILISATEUR (tableau de bord, documents,
        utilisateurs, journal)
     8. Reprise de session au rechargement de la page
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
const TYPES = ["Note", "Lettre", "Lettre PR", "Lettre PM"];
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

// Quelques documents d'exemple : référence, type, date, intitulé
const DEFAULT_DOCS = [
  ["MSSPSSN/SG/2026/001", "Note", "2026-01-15", "Note de service"],
  ["MSSPSSN/SG/2026/002", "Lettre", "2026-01-20", "Correspondance administrative"],
  ["MSSPSSN/SG/2026/003", "Lettre PR", "2026-02-10", "Lettre Présidence"],
  ["MSSPSSN/SG/2026/004", "Lettre PM", "2026-02-18", "Lettre Primature"],
  ["MSSPSSN/SG/2026/005", "Note", "2026-03-12", "Note administrative"],
  ["MSSPSSN/SG/2025/006", "Lettre", "2025-09-05", "Lettre de transmission"],
  ["MSSPSSN/SG/2025/007", "Lettre PR", "2025-09-18", "Correspondance présidentielle"],
  ["MSSPSSN/SG/2024/008", "Lettre PM", "2024-06-10", "Correspondance Primature"],
  ["MSSPSSN/SG/2024/009", "Note", "2024-06-22", "Note administrative"]
].map(d => ({ ref: d[0], type: d[1], date: d[2], name: d[3], by: "phirnel", file: null }));

// On charge ce qui est déjà enregistré, sinon on prend les valeurs par défaut
let users = get("ae2_users", DEFAULT_USERS);
let docs = get("ae2_docs", DEFAULT_DOCS);
let logs = get("ae2_logs", []);

let me = null;          // la personne actuellement connectée
let view = "dash";      // la page affichée côté super utilisateur
let flt = { q: "", type: "", year: "", month: "" };  // filtres de la liste des documents
let lastResults = [];   // derniers résultats de recherche (pour imprimer / exporter)
let idleTimer = null;   // chronomètre d'inactivité

// Enregistre tout dans le navigateur. Si la mémoire est pleine, on prévient.
const persist = () => {
  try { save("ae2_users", users); save("ae2_docs", docs); save("ae2_logs", logs); }
  catch (e) { alert("Stockage du navigateur plein : supprimez des fichiers joints."); }
};
persist();

// Le journal : on note qui a fait quoi et quand (les 300 dernières lignes)
function log(action, user) {
  logs.unshift({ d: new Date().toISOString(), u: user || (me && me.username) || "—", a: action });
  logs = logs.slice(0, 300);
  save("ae2_logs", logs);
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

// Bouton VALIDER : lance la recherche et affiche les résultats
$("#cForm").addEventListener("submit", e => {
  e.preventDefault();
  const type = $("#cType").value, month = $("#cMonth").value;

  // Il faut au moins un critère
  if (!type && !month) {
    alert("Veuillez choisir un type de document ou un mois.");
    return;
  }

  // On garde les documents qui correspondent, les plus récents en premier
  lastResults = docs
    .filter(d => type ? d.type === type : d.date.slice(5, 7) === month)
    .sort((a, b) => b.date.localeCompare(a.date));

  // Rappel de la recherche + nombre de résultats
  $("#rCrit").textContent = type ? "Type de document" : "Mois";
  $("#rVal").textContent = type || MONTHS[+month - 1];
  $("#rCount").textContent = lastResults.length;
  $("#rTable").innerHTML = docTable(lastResults, false);   // false = pas de boutons de gestion

  log("Recherche : " + (type ? "type " + type : "mois " + MONTHS[+month - 1]) + " (" + lastResults.length + " résultat(s))");

  // On passe à l'écran des résultats
  $("#cSearch").classList.add("hidden");
  $("#cResult").classList.remove("hidden");
  window.scrollTo(0, 0);
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

function viewDash() {
  const y = new Date().getFullYear();

  // Combien de documents par mois cette année
  const byM = MONTHS.map((m, i) => docs.filter(d => d.date.startsWith(y) && +d.date.slice(5, 7) === i + 1).length);
  const maxM = Math.max(1, ...byM);

  // Combien de documents par année
  const years = {};
  docs.forEach(d => { const k = d.date.slice(0, 4); years[k] = (years[k] || 0) + 1; });

  // Les 5 documents les plus récents
  const recent = [...docs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  // Les cartes de chiffres clés
  const kpis = `
    <div class="kpi"><span>Documents archivés</span><strong>${docs.length}</strong></div>
    <div class="kpi g"><span>Documents en ${y}</span><strong>${docs.filter(d => d.date.startsWith(y)).length}</strong></div>
    <div class="kpi y"><span>Types de documents</span><strong>${TYPES.length}</strong></div>
    <div class="kpi r"><span>Comptes actifs</span><strong>${users.filter(u => u.active).length}/${users.length}</strong></div>`;

  $("#main").innerHTML = `
    <div class="head"><div><h1>Bonjour, ${esc(me.name)}</h1><p>Vue d'ensemble des archives administratives.</p></div>
      <button class="btn-primary" onclick="docForm()">+ Nouveau document</button></div>
    <div class="kpis">${kpis}</div>
    <div class="grid2">
      <div class="card"><h3>Répartition par type</h3>${hbars(TYPES.map(t => [t, docs.filter(d => d.type === t).length]))}</div>
      <div class="card"><h3>Répartition par année</h3>${hbars(Object.entries(years).sort().reverse())}</div>
    </div>
    <div class="card"><h3>Documents par mois en ${y}</h3>
      <div class="cols">${byM.map((n, i) => `<div><b>${n || ""}</b><i style="height:${n / maxM * 100}px"></i>${MONTHS[i].slice(0, 3)}</div>`).join("")}</div></div>
    <div class="card"><h3>Derniers documents</h3>${docTable(recent, false)}</div>
    <div class="card"><h3>Dernières activités</h3>${logTable(logs.slice(0, 6))}</div>`;
}


/* ----- 7.3 Documents ----- */

// Construit le tableau des documents.
// actions = true  -> colonnes Modifier / Supprimer (super utilisateur)
// actions = false -> simple consultation (consultant, tableau de bord)
// Dans tous les cas : boutons « Lire » et « Télécharger » si un fichier existe.
function docTable(list, actions) {
  if (!list.length) return `<div class="empty">Aucun document trouvé.</div>`;
  return `<div class="table-container"><table><thead><tr><th>N°</th><th>Référence</th><th>Type</th><th>Date</th><th>Document</th><th>Fichier</th>${actions ? "<th>Actions</th>" : ""}</tr></thead><tbody>` +
    list.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.ref)}</td><td><span class="badge">${esc(d.type)}</span></td><td>${fdate(d.date + "T00:00:00")}</td><td>${esc(d.name)}</td>
      <td>${d.file
        ? `<button class="btn-secondary btn-sm" onclick="openDoc('${esc(d.ref)}')">Lire</button><button class="btn-primary btn-sm" onclick="dlDoc('${esc(d.ref)}')">Télécharger</button>`
        : `<span class="muted">Aucun fichier</span>`}</td>` +
      (actions ? `<td><button class="btn-secondary btn-sm" onclick="docForm('${esc(d.ref)}')">Modifier</button><button class="btn-danger btn-sm" onclick="docDel('${esc(d.ref)}')">Supprimer</button></td>` : "") +
      `</tr>`).join("") + `</tbody></table></div>`;
}

// Retrouve le fichier joint d'un document et le transforme en vrai fichier
async function fileBlob(ref) {
  const d = docs.find(x => x.ref === ref);
  return d && d.file ? { d, blob: await (await fetch(d.file.data)).blob() } : null;
}
// « Lire » : ouvre le fichier dans un nouvel onglet
async function openDoc(ref) {
  const f = await fileBlob(ref); if (!f) return;
  window.open(URL.createObjectURL(f.blob), "_blank");
  log("Lecture : " + ref);
}
// « Télécharger » : enregistre le fichier sur l'ordinateur
async function dlDoc(ref) {
  const f = await fileBlob(ref); if (!f) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(f.blob); a.download = f.d.file.name; a.click();
  log("Téléchargement : " + ref);
}

// Applique les filtres de la page Documents (texte, type, année, mois)
function filtered() {
  const q = flt.q.toLowerCase();
  return docs.filter(d =>
    (!q || (d.ref + d.name + d.type).toLowerCase().includes(q)) &&
    (!flt.type || d.type === flt.type) &&
    (!flt.year || d.date.startsWith(flt.year)) &&
    (!flt.month || d.date.slice(5, 7) === flt.month)
  ).sort((a, b) => b.date.localeCompare(a.date));
}

// La page « Documents » du super utilisateur
function viewDocs() {
  const yrs = [...new Set(docs.map(d => d.date.slice(0, 4)))].sort().reverse();
  // Petite fabrique de listes déroulantes pour les filtres
  const sel = (id, ph, opts, val) => `<select id="${id}"><option value="">${ph}</option>${opts.map(o => `<option value="${o[0]}" ${o[0] === val ? "selected" : ""}>${o[1]}</option>`).join("")}</select>`;

  $("#main").innerHTML = `
    <div class="head"><div><h1>Documents archivés</h1><p>Rechercher, consulter et gérer les archives.</p></div>
      <div><button class="btn-secondary" onclick="exportCsv()">Exporter CSV</button> <button class="btn-primary" onclick="docForm()">+ Nouveau document</button></div></div>
    <div class="card"><div class="tools">
      <input id="fq" placeholder="Rechercher (référence, nom…)" value="${esc(flt.q)}">
      ${sel("ft", "Tous les types", TYPES.map(t => [t, t]), flt.type)}
      ${sel("fy", "Toutes les années", yrs.map(y => [y, y]), flt.year)}
      ${sel("fm", "Tous les mois", MONTHS.map((m, i) => [String(i + 1).padStart(2, "0"), m]), flt.month)}
    </div><p class="muted" id="cnt" style="margin-bottom:12px"></p><div id="tbl"></div></div>`;

  // Redessine uniquement le tableau à chaque frappe (le champ garde le focus)
  const draw = () => { const l = filtered(); $("#cnt").textContent = l.length + " résultat(s)"; $("#tbl").innerHTML = docTable(l, true); };
  [["fq", "q"], ["ft", "type"], ["fy", "year"], ["fm", "month"]].forEach(([id, k]) =>
    $("#" + id).addEventListener("input", e => { flt[k] = e.target.value; draw(); }));
  draw();
}

// Fabrique la prochaine référence : DGSS/SG/ANNÉE/NNN (numéro qui continue)
function nextRef(date) {
  const n = Math.max(0, ...docs.map(d => parseInt(d.ref.split("/").pop(), 10) || 0)) + 1;
  return `DGSS/SG/${date.slice(0, 4)}/${String(n).padStart(3, "0")}`;
}

// Ouvre la fenêtre de saisie. onSave est appelé quand on clique « Enregistrer ».
// Si onSave renvoie false, la fenêtre reste ouverte (erreur à corriger).
function modal(title, body, onSave) {
  const f = $("#dform");
  f.innerHTML = `<h3>${title}</h3>${body}<div class="buttons"><button type="button" class="btn-secondary" onclick="$('#dlg').close()">Annuler</button><button class="btn-primary">Enregistrer</button></div>`;
  f.onsubmit = e => {
    e.preventDefault();
    if (onSave(Object.fromEntries(new FormData(f))) !== false) $("#dlg").close();
  };
  $("#dlg").showModal();
}

// Formulaire d'ajout (sans ref) ou de modification (avec ref) d'un document
function docForm(ref) {
  if (!can("doc")) return;   // sécurité : réservé au super utilisateur
  const d = docs.find(x => x.ref === ref) || { type: "Note", date: new Date().toISOString().slice(0, 10), name: "", file: null };

  modal(ref ? "Modifier le document" : "Nouveau document", `
    <label>Type</label><select name="type">${TYPES.map(t => `<option ${t === d.type ? "selected" : ""}>${t}</option>`).join("")}</select>
    <label>Date</label><input type="date" name="date" value="${d.date}" required>
    <label>Intitulé du document</label><input name="name" value="${esc(d.name)}" required>
    <label>Fichier (PDF, image, Word… 2 Mo max)${d.file ? " — actuel : " + esc(d.file.name) : ""}</label><input type="file" name="file">`,
    v => {
      const f = v.file; delete v.file;
      if (f && f.size > 2 * 1024 * 1024) { alert("Fichier trop volumineux (2 Mo maximum)."); return false; }

      // Enregistre le document (appelé une fois le fichier éventuel lu)
      const done = file => {
        if (file) d.file = file;
        if (ref) { Object.assign(d, v); log("Document modifié : " + ref); }
        else { const nd = { ref: nextRef(v.date), ...v, by: me.username, file: d.file }; docs.push(nd); log("Document ajouté : " + nd.ref); }
        persist(); toast("Document enregistré."); render();
      };
      // S'il y a un fichier, on le convertit en texte pour pouvoir le garder
      if (f && f.size) { const r = new FileReader(); r.onload = () => done({ name: f.name, data: r.result }); r.readAsDataURL(f); }
      else done(null);
    });
}

// Supprime un document après confirmation
function docDel(ref) {
  if (!can("doc") || !confirm("Supprimer le document " + ref + " ?")) return;
  docs = docs.filter(d => d.ref !== ref);
  log("Document supprimé : " + ref); persist(); render();
}

// Exporte une liste de documents en CSV (lisible dans Excel).
// Sans argument : exporte la liste filtrée de la page Documents.
function exportCsv(list) {
  list = list || filtered();
  const rows = [["Référence", "Type", "Date", "Document"], ...list.map(d => [d.ref, d.type, d.date, d.name])];
  const csv = "\ufeff" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "archives.csv"; a.click();
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


/* ----- 7.5 Journal d'activité ----- */

// Tableau « date / utilisateur / action »
function logTable(list) {
  if (!list.length) return `<div class="empty">Aucune activité enregistrée.</div>`;
  return `<div class="table-container"><table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th></tr></thead><tbody>` +
    list.map(l => `<tr><td>${fdt(l.d)}</td><td>${esc(l.u)}</td><td>${esc(l.a)}</td></tr>`).join("") + `</tbody></table></div>`;
}
function viewLogs() {
  $("#main").innerHTML = `<div class="head"><div><h1>Journal d'activité</h1><p>Traçabilité des connexions, recherches et actions.</p></div>
    <button class="btn-danger" onclick="clearLogs()">Vider le journal</button></div>
    <div class="card">${logTable(logs)}</div>`;
}
function clearLogs() {
  if (!confirm("Vider tout le journal d'activité ?")) return;
  logs = []; log("Journal vidé"); render();
}


/* =====================================================================
   8. REPRISE DE SESSION
   Si la personne recharge la page (F5) alors qu'elle était connectée,
   on la reconnecte automatiquement, sauf si son compte a été désactivé.
   ===================================================================== */
const saved = users.find(u => u.username === sessionStorage.getItem("ae_me") && u.active);
if (saved) start(saved);
