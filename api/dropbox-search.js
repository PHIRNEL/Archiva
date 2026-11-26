// ARCHIVA - passerelle sécurisée vers Dropbox pour Vercel Functions.
// Variables Vercel requises : DROPBOX_ACCESS_TOKEN et DROPBOX_FOLDER_PATH (ex. /ARCHIVA).

const API = "https://api.dropboxapi.com/2";

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
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_summary || data.error?.error_summary || `Dropbox a répondu avec le statut ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function listAllFiles(token, folder) {
  let result = await dropboxPost("files/list_folder", token, {
    path: folder,
    recursive: true,
    include_deleted: false,
    include_non_downloadable_files: false,
    limit: 2000
  });
  const entries = [...(result.entries || [])];
  while (result.has_more && result.cursor) {
    result = await dropboxPost("files/list_folder/continue", token, { cursor: result.cursor });
    entries.push(...(result.entries || []));
    // Garde-fou pour éviter une réponse Vercel trop longue sur un dossier énorme.
    if (entries.length > 20000) throw new Error("Le dossier contient plus de 20 000 éléments. Divisez les archives en sous-dossiers.");
  }
  return entries.filter(item => item[".tag"] === "file");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return json(res, 405, { error: "Méthode non autorisée." });

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) return json(res, 500, { error: "Le jeton Dropbox n'est pas configuré dans les variables Vercel (DROPBOX_ACCESS_TOKEN)." });

  const folder = safeFolderPath(process.env.DROPBOX_FOLDER_PATH || "/ARCHIVA");
  const action = req.query.action || "search";

  try {
    if (action === "link") {
      const path = String(req.query.path || "");
      if (!path.startsWith(`${folder}/`)) return json(res, 403, { error: "Accès refusé à ce chemin Dropbox." });
      const data = await dropboxPost("files/get_temporary_link", token, { path });
      return json(res, 200, { url: data.link });
    }

    const type = String(req.query.type || "");
    const month = String(req.query.month || "");
    if ((!type && !month) || (type && month)) return json(res, 400, { error: "Choisissez un seul critère : type ou mois." });
    if (month && !/^(0[1-9]|1[0-2])$/.test(month)) return json(res, 400, { error: "Mois invalide." });

    const entries = await listAllFiles(token, folder);
    const files = entries.map(entry => {
      const modified = entry.server_modified || entry.client_modified;
      const date = modified ? modified.slice(0, 10) : "";
      return {
        name: entry.name,
        path: entry.path_display,
        type: inferType(entry),
        date,
        size: entry.size || 0
      };
    }).filter(file => {
      if (!file.date) return false;
      if (type) return file.type === type;
      return file.date.slice(5, 7) === month;
    }).sort((a, b) => b.date.localeCompare(a.date));

    return json(res, 200, { folder, count: files.length, files });
  } catch (error) {
    console.error("ARCHIVA Dropbox error:", error.message);
    const status = error.status === 401 ? 502 : (error.status >= 400 && error.status < 500 ? 400 : 502);
    let message = error.message || "Erreur de connexion à Dropbox.";
    if (error.status === 401) message = "Le jeton Dropbox est invalide ou expiré. Générez-en un nouveau et remplacez DROPBOX_ACCESS_TOKEN dans Vercel.";
    if (error.status === 409) message = `Dossier Dropbox introuvable ou inaccessible : ${folder}. Vérifiez DROPBOX_FOLDER_PATH et les autorisations de l'application.`;
    return json(res, status, { error: message });
  }
};
