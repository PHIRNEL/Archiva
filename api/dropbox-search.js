// ARCHIVA - passerelle Dropbox sécurisée pour Vercel Functions.
// Variables : DROPBOX_ACCESS_TOKEN, DROPBOX_FOLDER_PATH.
// Permissions Dropbox : files.metadata.read, files.content.read, files.content.write.

const API = "https://api.dropboxapi.com/2";
const CONTENT_API = "https://content.dropboxapi.com/2";
const crypto = require("crypto");

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}

function inferType(entry) {
  const text = `${entry.name || ""} ${entry.path_display || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/lettre[^\n]*(presidence|president|\bpr\b)|\bpr[_ -]/.test(text)) return "Lettre PR";
  if (/lettre[^\n]*(primature|premier ministre)|\bpm[_ -]/.test(text)) return "Lettre PM";
  if (/note/.test(text)) return "Note";
  if (/lettre|courrier|correspondance/.test(text)) return "Lettre";
  return "Autre";
}

function safeFolderPath(value) {
  let p = (value || "/ARCHIVA").trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

async function dropboxPost(endpoint, token, body) {
  const response = await fetch(`${API}/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_summary || data.error?.error_summary || `Dropbox a répondu avec le statut ${response.status}.`;
    const error = new Error(message); error.status = response.status; error.dropbox = data; throw error;
  }
  return data;
}

async function listAllFiles(token, folder) {
  let result = await dropboxPost("files/list_folder", token, {
    path: folder, recursive: true, include_deleted: false,
    include_non_downloadable_files: false, limit: 2000
  });
  const entries = [...(result.entries || [])];
  while (result.has_more && result.cursor) {
    result = await dropboxPost("files/list_folder/continue", token, { cursor: result.cursor });
    entries.push(...(result.entries || []));
    if (entries.length > 20000) throw new Error("Le dossier contient plus de 20 000 éléments. Divisez les archives en sous-dossiers.");
  }
  return entries.filter(item => item[".tag"] === "file");
}

function mapDropboxFile(entry) {
  const modified = entry.server_modified || entry.client_modified || "";
  const name = entry.name || "Fichier sans nom";
  return {
    name,
    path: entry.path_display || entry.path_lower || "",
    type: inferType(entry),
    date: modified ? modified.slice(0, 10) : "",
    modifiedAt: modified,
    size: Number(entry.size || 0),
    extension: name.includes(".") ? name.split(".").pop().toLowerCase() : "Sans extension",
    id: entry.id || ""
  };
}

function auditPath(folder) { return `${folder}/_ARCHIVA_AUDIT`; }

async function ensureAuditFolder(token, path) {
  try { await dropboxPost("files/create_folder_v2", token, { path, autorename: false }); }
  catch (error) {
    // Dropbox renvoie path/conflict/folder si le dossier existe déjà.
    if (!(error.status === 409 && String(error.message).includes("path/conflict"))) throw error;
  }
}

async function saveAuditEvent(token, folder, input) {
  const auditFolder = auditPath(folder);
  await ensureAuditFolder(token, auditFolder);
  const event = {
    id: crypto.randomUUID(),
    d: new Date().toISOString(), // horodatage serveur, pas l'heure fournie par le navigateur
    u: String(input.u || "inconnu").slice(0, 120),
    role: String(input.role || "inconnu").slice(0, 40),
    a: String(input.a || "Action non précisée").slice(0, 180),
    target: String(input.target || "").slice(0, 500),
    details: String(input.details || "").slice(0, 1000),
    sessionId: String(input.sessionId || "").slice(0, 100),
    source: "ARCHIVA"
  };
  const filename = `${event.d.replace(/[:.]/g, "-")}-${event.id}.json`;
  const path = `${auditFolder}/${filename}`;
  const response = await fetch(`${CONTENT_API}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: false, mute: true })
    },
    body: JSON.stringify(event)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_summary || `Dropbox a refusé l'enregistrement du journal (${response.status}).`;
    const error = new Error(message); error.status = response.status; throw error;
  }
  return event;
}

async function downloadDropboxJson(token, path) {
  const response = await fetch(`${CONTENT_API}/files/download`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path }) }
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const error = new Error(raw || `Impossible de lire le journal Dropbox (${response.status}).`);
    error.status = response.status; throw error;
  }
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

async function getAuditLogs(token, folder) {
  const auditFolder = auditPath(folder);
  let files;
  try { files = await listAllFiles(token, auditFolder); }
  catch (error) {
    if (error.status === 409) return { auditFolder, logs: [] };
    throw error;
  }
  const recent = files.sort((a, b) => String(b.server_modified || "").localeCompare(String(a.server_modified || ""))).slice(0, 200);
  const logs = [];
  // Lecture séquentielle pour éviter de dépasser les limites de requêtes de Dropbox.
  for (const file of recent) {
    try { const item = await downloadDropboxJson(token, file.path_lower || file.path_display); if (item) logs.push(item); }
    catch (error) { console.error("ARCHIVA audit read error:", error.message); }
  }
  logs.sort((a, b) => String(b.d).localeCompare(String(a.d)));
  return { auditFolder, logs };
}

module.exports = async (req, res) => {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) return json(res, 500, { error: "Le jeton Dropbox n'est pas configuré (DROPBOX_ACCESS_TOKEN)." });
  const folder = safeFolderPath(process.env.DROPBOX_FOLDER_PATH || "/ARCHIVA");
  const action = req.query.action || "search";

  try {
    if (req.method === "POST" && action === "log") {
      const input = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const event = await saveAuditEvent(token, folder, input);
      return json(res, 201, { ok: true, id: event.id, recordedAt: event.d });
    }
    if (req.method !== "GET") return json(res, 405, { error: "Méthode non autorisée." });

    if (action === "link") {
      const path = String(req.query.path || "");
      if (!path.startsWith(`${folder}/`) || path.startsWith(`${auditPath(folder)}/`)) return json(res, 403, { error: "Accès refusé à ce chemin Dropbox." });
      const data = await dropboxPost("files/get_temporary_link", token, { path });
      return json(res, 200, { url: data.link });
    }

    if (action === "logs") {
      const data = await getAuditLogs(token, folder);
      return json(res, 200, data);
    }

    const allEntries = await listAllFiles(token, folder);
    // Le dossier technique du journal ne doit jamais être compté comme archive documentaire.
    const files = allEntries
      .filter(entry => !(entry.path_lower || "").startsWith(`${auditPath(folder).toLowerCase()}/`))
      .map(mapDropboxFile);

    if (action === "stats") {
      const now = new Date();
      const year = String(now.getUTCFullYear());
      const byType = Object.fromEntries(["Note", "Lettre", "Lettre PR", "Lettre PM", "Autre"].map(t => [t, 0]));
      const byMonth = Array(12).fill(0), byYear = {}, byExtension = {}, nameCounts = {};
      let totalSize = 0, noExtension = 0;
      for (const file of files) {
        byType[file.type] = (byType[file.type] || 0) + 1;
        totalSize += file.size;
        byExtension[file.extension] = (byExtension[file.extension] || 0) + 1;
        if (file.extension === "Sans extension") noExtension++;
        const normalizedName = file.name.toLocaleLowerCase("fr");
        nameCounts[normalizedName] = (nameCounts[normalizedName] || 0) + 1;
        if (file.date) {
          const y = file.date.slice(0, 4);
          byYear[y] = (byYear[y] || 0) + 1;
          if (y === year) byMonth[Number(file.date.slice(5, 7)) - 1]++;
        }
      }
      const recent = [...files].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
      return json(res, 200, {
        source: "dropbox", folder, generatedAt: new Date().toISOString(),
        totalFiles: files.length, totalSize, currentYear: year,
        modifiedThisYear: files.filter(f => f.date.startsWith(year)).length,
        byType, byMonth, byYear, byExtension, noExtension,
        duplicateNameGroups: Object.values(nameCounts).filter(count => count > 1).length, recent
      });
    }

    if (action === "files") {
      files.sort((a, b) => b.date.localeCompare(a.date));
      return json(res, 200, { source: "dropbox", folder, count: files.length, files });
    }

    const type = String(req.query.type || ""), month = String(req.query.month || "");
    if ((!type && !month) || (type && month)) return json(res, 400, { error: "Choisissez un seul critère : type ou mois." });
    if (month && !/^(0[1-9]|1[0-2])$/.test(month)) return json(res, 400, { error: "Mois invalide." });
    const results = files.filter(file => {
      if (!file.date) return false;
      if (type) return file.type === type;
      return file.date.slice(5, 7) === month;
    }).sort((a, b) => b.date.localeCompare(a.date));
    return json(res, 200, { folder, count: results.length, files: results });
  } catch (error) {
    console.error("ARCHIVA Dropbox error:", error.message, error.dropbox || "");
    const status = error.status === 401 ? 502 : (error.status === 409 ? 502 : 502);
    let message = error.message || "Erreur de connexion à Dropbox.";
    if (error.status === 401) message = "Le jeton Dropbox est invalide ou expiré. Vérifiez le jeton et les autorisations dans Dropbox Developer Console.";
    if (error.status === 409) message = `Dropbox ne trouve pas le dossier demandé ou refuse l'opération : ${folder}. Vérifiez le chemin et les autorisations de l'application.`;
    if (String(error.message).includes("insufficient_scope")) message = "L'application Dropbox n'a pas toutes les autorisations nécessaires. Activez files.metadata.read, files.content.read et files.content.write, puis générez un nouveau jeton.";
    return json(res, status, { error: message, detail: error.message || "Erreur inconnue" });
  }
};
