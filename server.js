const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');


// ====== CONFIG ENV ======
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const GOOGLE_SHEETS_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

// ====== CONFIG PJM (auth dynamique) ======
const PJM_BASE_URL = process.env.PJM_BASE_URL || 'https://ams.printjobmanager.com/api';

// Ces variables doivent être définies dans Render
const PJM_USERNAME = process.env.PJM_USERNAME;
const PJM_PASSWORD = process.env.PJM_PASSWORD;

// ID du moteur PJM (Product / IntegrationId) pour les kits couture
const PJM_ENGINE_PRODUCT_ID =
  process.env.PJM_ENGINE_PRODUCT_ID || '6b58e620-e943-4785-be35-88285a3bd42a';

// Petit cache en mémoire pour le token PJM
let pjmTokenCache = {
  token: null,
  // timestamp en ms
  expiresAt: 0
};

// ====== CHECK ENV GOOGLE ======
if (!SPREADSHEET_ID) {
  console.error('❌ GOOGLE_SHEETS_SPREADSHEET_ID manquant dans les variables d’environnement.');
  process.exit(1);
}
if (!SERVICE_ACCOUNT_KEY) {
  console.error('❌ GOOGLE_SERVICE_ACCOUNT_KEY manquant dans les variables d’environnement.');
  process.exit(1);
}

// On parse le JSON du compte de service
let creds;
try {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;

  if (b64 && b64.trim()) {
    const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
    creds = JSON.parse(jsonStr);
  } else {
    creds = JSON.parse(SERVICE_ACCOUNT_KEY);
  }
} catch (err) {
  console.error('❌ Impossible de parser la clé Google (JSON/B64) :', err);
  process.exit(1);
}

// Certains hébergeurs stockent la clé privée avec les "\n" échappés
const privateKey =
  (creds.private_key || '').includes('\\n')
    ? creds.private_key.replace(/\\n/g, '\n')
    : creds.private_key;

// Auth Google
const auth = new google.auth.JWT(
  creds.client_email,
  null,
  privateKey,
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({ version: 'v4', auth });


// ====== EXPRESS APP ======
const app = express();
const upload = multer({ dest: '/tmp' });

// CORS : en dev on autorise tout, en prod tu pourras restreindre à ton domaine Pressero
app.use(cors());
app.use(express.json());

// ===================== HELPERS GOOGLE SHEETS =====================

// Crée l'onglet pour cet email s'il n'existe pas encore
async function ensureSheetExists(sheetName) {
  // 1) Récupérer la liste des onglets
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID
  });

  const already = (meta.data.sheets || []).find(
    (s) => s.properties && s.properties.title === sheetName
  );

  if (already) {
    // L'onglet existe déjà → rien à faire
    return;
  }

  console.log(`[KITS] Création de l’onglet "${sheetName}"`);

  // 2) Créer le nouvel onglet
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }
      ]
    }
  });

  // 3) Poser la ligne d'en-têtes (A1:S1)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1:V1`, // <-- A → V (22 colonnes)
    valueInputOption: 'RAW',
    requestBody: {
      values: [
        [
          'KitId', // A
          'KitName', // B
          'ImageURL', // C
          'DefaultQtyLivret', // D
          'DefaultQtyPochette', // E
          'DefaultQtyPatron', // F
          'NombrePagesLivret', // G
          'TypeLivret', // H
          'TypeImpressionCouverture', // I
          'TypeImpressionCorps', // J
          'PapierCouverture', // K
          'PapierCorps', // L
          'FormatFermeLivret', // M
          'Pochette', // N
          'MiseEnPochette', // O
          'PatronM2', // P
          'ImpressionPatron', // Q
          'Active', // R
          'PJMOptionsJSON', // S
          'PresseroLivretJSON',      // T
          'PresseroPochetteJSON',    // U
          'PresseroPatronJSON'       // V
        ]
      ]
    }
  });

  console.log(`[KITS] En-têtes initialisés pour "${sheetName}"`);
}

// Petite aide : conversion "1,2" -> nombre
function parseNumberFromSheet(value) {
  if (value == null) return 0;
  const v = String(value).trim().replace(',', '.');
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Mapping objet kit -> ligne Google Sheet (19 colonnes A..S)
// Mapping objet kit -> ligne Google Sheet (22 colonnes A:V)
// Mapping objet kit -> ligne Google Sheet (22 colonnes A:V)
function kitToRow(kit) {
  return [
    kit.kitId || '',                // A
    kit.kitName || '',              // B
    kit.imageUrl || '',             // C
    kit.defaultQtyLivret || '',      // D
    kit.defaultQtyPochette || '',    // E
    kit.defaultQtyPatron || '',      // F
    kit.nombrePagesLivret || '',     // G
    kit.typeLivret || '',           // H
    kit.typeImpressionCouverture || '', // I
    kit.typeImpressionCorps || '',      // J
    kit.papierCouverture || '',      // K
    kit.papierCorps || '',           // L
    kit.formatFermeLivret || '',     // M
    kit.pochette || '',              // N
    kit.miseEnPochette || '',        // O
    kit.patronM2 || '',              // P
    kit.impressionPatron || '',      // Q
    kit.active ? 'Oui' : 'Non',      // R
    kit.pjmOptionsJson || '',        // S
    kit.presseroLivretJson || '',    // T
    kit.presseroPochetteJson || '',  // U
    kit.presseroPatronJson || ''     // V
  ];
}



// ===================== HELPERS PJM (AUTH + APPEL) =====================

async function getPjmToken() {
  const now = Date.now();

  // Token encore valide ?
  if (pjmTokenCache.token && pjmTokenCache.expiresAt > now + 60_000) {
    return pjmTokenCache.token;
  }

  if (!PJM_BASE_URL || !PJM_USERNAME || !PJM_PASSWORD) {
    throw new Error('PJM credentials are not configured');
  }

  const url = `${PJM_BASE_URL}/public/authenticate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Username: PJM_USERNAME,
      Password: PJM_PASSWORD
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PJM authenticate HTTP ${res.status}: ${txt}`);
  }

  const data = await res.json();
  if (!data || !data.Token) {
    throw new Error('PJM authenticate: Token missing in response');
  }

  pjmTokenCache.token = data.Token;

  const durationMinutes = data.TokenDuration || 30;
  pjmTokenCache.expiresAt = now + durationMinutes * 60_000;

  return pjmTokenCache.token;
}

async function callPjmApi(path, body) {
  const token = await getPjmToken();
  const url = `${PJM_BASE_URL}${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body || {})
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PJM ${path} HTTP ${res.status}: ${txt}`);
  }

  return res.json();
}

// ===================== ROUTES ADMIN KITS =====================

// GET /admin/kits?email=xxx
// - Crée l’onglet pour cet email si besoin (avec les en-têtes)
// - Lit toutes les lignes et renvoie la liste des kits
app.get('/admin/kits', async (req, res) => {
  const rawEmail = (req.query.email || '').trim();
  const email = rawEmail.toLowerCase();

  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  try {
    const sheetName = email;
    await ensureSheetExists(sheetName);

    // A → S (19 colonnes)
    const range = `'${sheetName}'!A2:V`;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
      range
    });

    const rows = resp.data.values || [];

    const kits = rows
      .filter((r) => r && r.length > 0)
      .map((row, index) => {
        return {
          // Infos techniques
          rowIndex: index + 2, // ligne dans Google Sheet
          sheetName,

          // Mapping colonnes (ordre = header que tu as défini)
          kitId: row[0] || '',
          kitName: row[1] || '',
          imageUrl: row[2] || '',
          defaultQtyLivret: row[3] || '',
          defaultQtyPochette: row[4] || '',
          defaultQtyPatron: row[5] || '',
          nombrePagesLivret: row[6] || '',
          typeLivret: row[7] || '',
          typeImpressionCouv: row[8] || '',
          typeImpressionCorps: row[9] || '',
          papierCouverture: row[10] || '',
          papierCorps: row[11] || '',
          formatFermeLivret: row[12] || '',
          pochette: row[13] || '',
          miseEnPochette: row[14] || '',
          patronM2: row[15] || '',
          impressionPatron: row[16] || '',
          activeRaw: row[17] || '',
          pjmOptionsJson: row[18] || '',
          presseroLivretJson: row[19] || '',
presseroPochetteJson: row[20] || '',
presseroPatronJson: row[21] || ''

        };
      });

    return res.json({
      email,
      sheetName,
      count: kits.length,
      kits
    });
  } catch (err) {
    console.error('[ADMIN /admin/kits] Error:', err);
    return res.status(500).json({
      error: 'Internal error while reading kits',
      details: err.message
    });
  }
});

// ===================== ADMIN - SAUVEGARDE D'UN KIT =====================
app.post('/admin/kits/save', express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const rawEmail = (body.email || '').trim();
    const email = rawEmail.toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    const sheetName = email;

    // On s'assure que l'onglet existe (avec les bons en-têtes)
    await ensureSheetExists(sheetName);

    const rawKitId = (body.kitId || '').trim();
    const generatedKitId = 'KIT-' + Date.now();
    const finalKitId = rawKitId || generatedKitId;

    // On lit les lignes existantes
    const range = `'${sheetName}'!A2:V`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range
    });
    const rows = response.data.values || [];

    // On cherche si une ligne a déjà ce KitId
    let rowIndex = null;
    rows.forEach((row, idx) => {
      if (row && row[0] && row[0].toString().trim() === finalKitId) {
        rowIndex = idx + 2; // +2 car le premier data row est A2
      }
    });

    // On construit l'objet kit à partir du body
    const kit = {
      kitId: finalKitId,
      kitName: body.kitName || '',
      imageUrl: body.imageUrl || '',
      defaultQtyLivret: body.defaultQtyLivret || '',
      defaultQtyPochette: body.defaultQtyPochette || '',
      defaultQtyPatron: body.defaultQtyPatron || '',
      nombrePagesLivret: body.nombrePagesLivret || '',
      typeLivret: body.typeLivret || '',
      typeImpressionCouverture: body.typeImpressionCouverture || '',
      typeImpressionCorps: body.typeImpressionCorps || '',
      papierCouverture: body.papierCouverture || '',
      papierCorps: body.papierCorps || '',
      formatFermeLivret: body.formatFermeLivret || '',
      pochette: body.pochette || '',
      miseEnPochette: body.miseEnPochette || '',
      patronM2: body.patronM2 || '',
      impressionPatron: body.impressionPatron || '',
      active:
        body.active === true ||
        body.active === 'true' ||
        body.active === 'Oui',
      pjmOptionsJson: body.pjmOptionsJson || body.PJMOptionsJSON || '',
presseroLivretJson: body.presseroLivretJson || body.PresseroLivretJSON || '',
presseroPochetteJson: body.presseroPochetteJson || body.PresseroPochetteJSON || '',
presseroPatronJson: body.presseroPatronJson || body.PresseroPatronJSON || ''


    };

    const rowValues = [kitToRow(kit)];

    if (rowIndex) {
      // ---- UPDATE d'une ligne existante ----
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${sheetName}'!A${rowIndex}:V${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: rowValues
        }
      });
    } else {
      // ---- APPEND d'une nouvelle ligne ----
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${sheetName}'!A2:V`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rowValues
        }
      });
    }

    return res.json({
      ok: true,
      email,
      kitId: finalKitId
    });
  } catch (err) {
    console.error('[ADMIN /admin/kits/save] Error:', err);
    return res.status(500).json({
      error: 'Error saving kit',
      details: err.message || String(err)
    });
  }
});

// ===================== ADMIN - OPTIONS PJM POUR UN MOTEUR =====================
// GET /admin/pjm/options?engineId=...
// - Récupère la liste des options pour un moteur PJM
app.get('/admin/pjm/options', async (req, res) => {
  try {
    const engineId = (req.query.engineId || PJM_ENGINE_PRODUCT_ID || '').trim();
    if (!engineId) {
      return res.status(400).json({ error: 'Missing engineId' });
    }

    const payload = {
      Operation: 'options',
      Product: engineId,
      Options: [] // aucune sélection initiale => on veut juste la structure
    };

    const data = await callPjmApi('/public/engine', payload);

    return res.json({
      ok: true,
      engineId,
      raw: data,
      options: data.Options || data.options || []
    });
  } catch (err) {
    console.error('[ADMIN /admin/pjm/options] Error:', err);
    return res.status(500).json({
      error: 'Error loading PJM options',
      details: err.message || String(err)
    });
  }
});

/**
 * Transforme les selections (optionId, key, value, label) venant du front
 * en tableau Options pour l'API PJM.
 *
 * On envoie le même format que sur le projet "PJM + IA" :
 *   Options: [ { Key: optionId, Value: value }, ... ]
 * où "Key" = Id de l’option PJM.
 */
function buildPjmOptionsFromSelections(selections) {
  if (!Array.isArray(selections)) return [];

  const optionsArray = [];

  selections.forEach((sel) => {
    if (!sel || !sel.optionId) return;

    const optId = String(sel.optionId).trim();
    const val = sel.value;

    if (val === undefined || val === null || String(val).trim() === '') {
      return; // on n’envoie pas les champs vides
    }

    optionsArray.push({
      Key: optId, // Id de l’option PJM
      Value: String(val) // valeur choisie (souvent un GUID)
    });
  });

  return optionsArray;
}

// ===================== ADMIN - OPTIONS + PRIX PJM =====================
// Body: { engineId?: string, selections?: [ { optionId, key, value, label } ] }
app.post('/admin/pjm/optionsandprice', async (req, res) => {
  try {
    const selections = Array.isArray(req.body.selections)
      ? req.body.selections
      : [];

    const engineId = PJM_ENGINE_PRODUCT_ID;
    if (!engineId) {
      return res
        .status(500)
        .json({ error: 'PJM_ENGINE_PRODUCT_ID manquant côté serveur' });
    }

    // 👉 construction des options pour PJM
    const optionsForPjm = buildPjmOptionsFromSelections(selections);

    const enginePayload = {
      Operation: 'optionsandprice',
      Product: engineId,
      Options: optionsForPjm
    };

    console.log('[PJM] Payload envoyé à /public/engine :', enginePayload);

    // 🔹 on utilise le helper générique
    const data = await callPjmApi('/public/engine', enginePayload);

    return res.json({
      price: data.Price ?? null,
      weight: data.Weight ?? null,
      options: data.Options || [],
      raw: data
    });
  } catch (err) {
    console.error('[PJM] Erreur /admin/pjm/optionsandprice', err);
    return res.status(500).json({
      error: 'Erreur interne',
      details: err.message
    });
  }
});

// ====== Pressero helpers ======

function normalizeHost(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.host;
  } catch {
    // si c’est déjà un host ou une URL “sans protocole”
    return s
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')     // coupe tout après le host
      .replace(/\/+$/, '');
  }
}

// ✅ UNE SEULE déclaration
const presseroTokenCache = new Map(); // key: host => { token, expiresAt }

function normalizeSiteDomain(siteDomain) {
  if (!siteDomain) return '';
  let raw = String(siteDomain).trim();
  raw = raw.replace(/^https?:\/\//i, '');
  raw = raw.replace(/\/.*$/, '');
  return raw;
}

async function getPresseroToken(adminUrl) {
  const host = normalizeHost(adminUrl);
  if (!host) throw new Error('adminUrl manquant');

  const now = Date.now();
  const cached = presseroTokenCache.get(host);
  if (cached && cached.token && cached.expiresAt > now + 60_000) return cached.token;

  const username = process.env.PRESSERO_ADMIN_USER;
  const password = process.env.PRESSERO_ADMIN_PASSWORD;
  const subscriberId = process.env.PRESSERO_SUBSCRIBER_ID;
  const consumerId = process.env.PRESSERO_CONSUMER_ID;

  if (!username || !password || !subscriberId || !consumerId) {
    throw new Error('Pressero credentials (env) manquants');
  }

  const url = `https://${host}/api/v2/Authentication`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
  UserName: username,
  Password: password,
  SubscriberID: subscriberId,
  ConsumerID: consumerId
})
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Pressero Authentication HTTP ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const token = data && (data.Token || data.token);
  if (!token) throw new Error('Token Pressero manquant dans la réponse');

  const durationMin = Number(data.TokenDuration || data.tokenDuration || 25);
  presseroTokenCache.set(host, {
    token,
    expiresAt: now + (isFinite(durationMin) ? durationMin : 25) * 60_000
  });

  return token;
}

/**
 * ✅ Supporte 2 signatures :
 *  - callPressero({ adminUrl, path, method, body, query, headers, forceAuth })
 *  - callPressero(adminUrl, path, method, body, query, headers, forceAuth)
 */
async function callPressero(adminUrlOrOpts, pathArg, methodArg = 'GET', bodyArg = null, queryArg = {}, headersArg = {}, forceAuthArg = false) {
  // ✅ Supporte: callPressero({ ... }) ET callPressero(adminUrl, path, method, body, query, headers, forceAuth)
  const opts =
    adminUrlOrOpts && typeof adminUrlOrOpts === 'object'
      ? adminUrlOrOpts
      : {
          adminUrl: adminUrlOrOpts,
          path: pathArg,
          method: methodArg,
          body: bodyArg,
          query: queryArg,
          headers: headersArg,
          forceAuth: forceAuthArg
        };

  const {
    adminUrl,
    path,
    method = 'GET',
    query = {},
    body = null,
    headers = {},
    forceAuth = false
  } = opts;

  if (!adminUrl) throw new Error('adminUrl manquant');
  if (!path) throw new Error('path manquant');

  const host = normalizeHost(adminUrl);
  if (!host) throw new Error('adminUrl invalide');

  const qs = new URLSearchParams(query || {}).toString();
  const url = `https://${host}${path}${qs ? (path.includes('?') ? `&${qs}` : `?${qs}`) : ''}`;

  const h = { Accept: 'application/json', ...headers };

  let requestBody;
  let extraHeaders = {};

  // Support FormData (form-data lib)
  if (body != null && typeof body.getHeaders === 'function') {
    requestBody = body;
    extraHeaders = body.getHeaders();
  } else if (body != null) {
    h['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const shouldUseAuth = true;

  let token = null;
  if (shouldUseAuth) {
    try {
      token = await getPresseroToken(adminUrl);
    } catch (e) {
      console.warn('[PRESSEERO] token unavailable:', e.message);
    }
  }

  const doFetch = async (useAuth) => {
    const hh = { ...h, ...extraHeaders };
    if (useAuth && token) {
  const authVal =
    token.startsWith('token ') || token.startsWith('Bearer ')
      ? token
      : `token ${token}`;

  hh.Authorization = authVal;
}

    return fetch(url, { method, headers: hh, body: requestBody });
  };

  let res = await doFetch(shouldUseAuth);

  // Si auth -> 401, retry sans Authorization
  if (shouldUseAuth && res.status === 401) {
    console.warn('[PRESSEERO] 401 with auth, retrying without Authorization:', url);
    res = await doFetch(false);
  }

  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) {
    const err = new Error(`Pressero API error ${res.status}`);
    err.status = res.status;
    err.payload = data || { raw: text };
    throw err;
  }

  return data;
}


// ===================== ADMIN - OPTIONS PRESSERO =====================
app.post('/admin/pressero/options', async (req, res) => {
  try {
    const { adminUrl, siteDomain, siteUserId, productId } = req.body || {};

    if (!adminUrl || !siteDomain || !siteUserId || !productId) {
      return res.status(400).json({ error: 'adminUrl/siteDomain/siteUserId/productId requis' });
    }

    const sd = normalizeSiteDomain(siteDomain);

    const path = `/api/cart/${sd}/product/${productId}/options/?userId=${encodeURIComponent(siteUserId)}`;

    const data = await callPressero(adminUrl, path, 'POST', {
      Quantities: [],
      Options: [],
      SelectedUOM: null
    });

    return res.json({ ok: true, raw: data });
  } catch (err) {
    return res.status(500).json({ error: 'Error loading Pressero options', details: err.message });
  }
});

// ===================== ADMIN - PRIX PRESSERO =====================
app.post('/admin/pressero/price', async (req, res) => {
  try {
    const { adminUrl, siteDomain, siteUserId, productId, quantities, options, selectedUom } = req.body || {};

    if (!adminUrl || !siteDomain || !siteUserId || !productId) {
      return res.status(400).json({ error: 'adminUrl/siteDomain/siteUserId/productId requis' });
    }

    const sd = normalizeSiteDomain(siteDomain);

    const path = `/api/cart/${sd}/product/${productId}/price?userId=${encodeURIComponent(siteUserId)}`;

    const data = await callPressero(adminUrl, path, 'POST', {
      Quantities: Array.isArray(quantities) ? quantities : [],
      Options: Array.isArray(options) ? options : [],
      SelectedUOM: selectedUom ?? null
    });

    return res.json({ ok: true, raw: data });
  } catch (err) {
    return res.status(500).json({ error: 'Error loading Pressero price', details: err.message });
  }
});

function pickHostKind(items) {
  // ordre imposé : livret > pochette > patron
  const order = ['livret', 'pochette', 'patron'];
  for (const k of order) {
    const found = items.find(x => (x.kind || '').toLowerCase() === k);
    if (found) return found;
  }
  return items[0] || null;
}

// 1) GET CART (proxy)
app.post('/admin/pressero/cart/get', async (req, res) => {
  try {
    const { adminUrl, siteDomain, siteUserId } = req.body || {};
    const sd = normalizeSiteDomain(siteDomain);

    if (!adminUrl || !sd || !siteUserId) {
      return res.status(400).json({ ok: false, error: 'adminUrl/siteDomain/siteUserId required' });
    }

    const raw = await callPressero(
      adminUrl,
      `/api/cart/${encodeURIComponent(sd)}/?userId=${encodeURIComponent(siteUserId)}`,
      'GET'
    );

    return res.json({ ok: true, raw });
  } catch (e) {
    console.error('[CART/get] error', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e), payload: e?.payload || null });
  }
});

// 2) ADD ONE ITEM (proxy)
app.post('/admin/pressero/cart/add-item', async (req, res) => {
  try {
    const { adminUrl, siteDomain, siteUserId, cartId, itemBody } = req.body || {};
    const sd = normalizeSiteDomain(siteDomain);

    if (!adminUrl || !sd || !siteUserId || !itemBody) {
      return res.status(400).json({ ok: false, error: 'adminUrl/siteDomain/siteUserId/itemBody required' });
    }

    let cid = cartId;
    if (!cid) {
      const cart = await callPressero(
        adminUrl,
        `/api/cart/${encodeURIComponent(sd)}/?userId=${encodeURIComponent(siteUserId)}`,
        'GET'
      );
      cid = cart?.Id;
    }

    if (!cid) {
      return res.status(400).json({ ok: false, error: 'Unable to resolve cartId' });
    }

    const raw = await callPressero(
      adminUrl,
      `/api/cart/${encodeURIComponent(sd)}/${encodeURIComponent(cid)}/item/?userId=${encodeURIComponent(siteUserId)}`,
      'POST',
      itemBody
    );

    // On tente d’extraire un itemId (selon réponse Pressero)
    const itemId = raw?.ItemId || raw?.itemId || raw?.Id || raw?.id || null;

    return res.json({ ok: true, cartId: cid, itemId, raw });
  } catch (e) {
    console.error('[CART/add-item] error', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e), payload: e?.payload || null });
  }
});

// 3) ADD BUNDLE (3 items) + renvoie hostItemId selon règle livret>pochette>patron
app.post('/admin/pressero/cart/add-bundle', async (req, res) => {
  try {
    const { adminUrl, siteDomain, siteUserId, cartId, items } = req.body || {};
    const sd = normalizeSiteDomain(siteDomain);

    if (!adminUrl || !sd || !siteUserId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'adminUrl/siteDomain/siteUserId/items[] required' });
    }

    // resolve cartId
    let cid = cartId;
    if (!cid) {
      const cart = await callPressero(
        adminUrl,
        `/api/cart/${encodeURIComponent(sd)}/?userId=${encodeURIComponent(siteUserId)}`,
        'GET'
      );
      cid = cart?.Id;
    }

    if (!cid) {
      return res.status(400).json({ ok: false, error: 'Unable to resolve cartId' });
    }

    const added = [];
    for (const it of items) {
      if (!it || !it.itemBody) continue;

      let raw = null;

try {
  raw = await callPressero(
    adminUrl,
    `/api/cart/${encodeURIComponent(sd)}/${encodeURIComponent(cid)}/item/?userId=${encodeURIComponent(siteUserId)}`,
    'POST',
    it.itemBody
  );
} catch (e) {
  // ✅ Cas Pressero: 400 mais item créé + warning
  if (e?.status === 400 && e?.payload?.Message === 'ReOrderFullSuccess_PriceWarning') {
    raw = e.payload;
    raw.__warning = 'ReOrderFullSuccess_PriceWarning';
  } else {
    throw e;
  }
}

// Essayer de récupérer l'ItemId depuis la réponse
// Essayer de récupérer l'ItemId depuis la réponse
let itemId = raw?.ItemId || raw?.itemId || null;

// ⚠️ Certains retours Pressero donnent un "Id" qui est le cartId, pas l'itemId.
// Donc si itemId est vide, on le résout via un GET cart.
if (!itemId) {
  const cartAfter = await callPressero(
    adminUrl,
    `/api/cart/${encodeURIComponent(sd)}/?userId=${encodeURIComponent(siteUserId)}`,
    'GET'
  );

  const productId = it?.itemBody?.ProductId || it?.itemBody?.productId;
  const itemName = it?.itemBody?.ItemName || it?.itemBody?.itemName;

  const found = (cartAfter?.Items || [])
    .slice()
    .reverse()
    .find(x =>
      String(x.ProductId || '').toLowerCase() === String(productId || '').toLowerCase() &&
      (!itemName || String(x.ItemName || '') === String(itemName))
    );

  // selon structure, l'id peut être ItemId ou Id
  itemId = found?.ItemId || found?.Id || null;
}


added.push({ kind: it.kind || '', itemId, raw });

    }

    const host = pickHostKind(added.filter(x => x.itemId));
    const hostItemId = host ? host.itemId : null;

    return res.json({ ok: true, cartId: cid, added, hostItemId });
  } catch (e) {
    console.error('[CART/add-bundle] error', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e), payload: e?.payload || null });
  }
});

// 4) SET ITEM FILE (upload ZIP) -> l’attache à l’item hôte
// Front envoie multipart/form-data : fields adminUrl/siteDomain/siteUserId/cartId/cartItemId + file
app.post('/admin/pressero/cart/item-file', upload.single('file'), async (req, res) => {
  try {
    const { adminUrl, siteDomain, siteUserId, cartId, cartItemId } = req.body || {};
    const sd = normalizeSiteDomain(siteDomain);

    if (!adminUrl || !sd || !siteUserId || !cartId || !cartItemId) {
      return res.status(400).json({ ok: false, error: 'adminUrl/siteDomain/siteUserId/cartId/cartItemId required' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'file is required (multipart field name = file)' });
    }

    const filename = req.file.originalname || 'upload.zip';
    const mimetype = req.file.mimetype || 'application/zip';

    // Pressero "Set Item Files" (Postman) est bien /file + form-data.
    // On envoie à la fois "file" et "files" pour couvrir les variantes.
    const form = new FormData();
    form.append('file', fs.createReadStream(req.file.path), { filename, contentType: mimetype });
    form.append('files', fs.createReadStream(req.file.path), { filename, contentType: mimetype });

    const base =
      `/api/cart/${encodeURIComponent(sd)}/${encodeURIComponent(cartId)}` +
      `/item/${encodeURIComponent(cartItemId)}/file`;

    const query = {
      userId: siteUserId,
      fileName: filename // certains environnements le demandent implicitement
    };

    let raw;
    try {
      // essai 1: /file/
      raw = await callPressero({
        adminUrl,
        path: `${base}/`,
        method: 'PUT',
        body: form,
        query,
        forceAuth: true // ✅ upload fichier souvent protégé
      });
    } catch (e) {
      // essai 2: /file
      if (e && e.status === 404) {
        raw = await callPressero({
          adminUrl,
          path: base,
          method: 'PUT',
          body: form,
          query,
          forceAuth: true
        });
      } else {
        throw e;
      }
    } finally {
      // cleanup fichier temporaire multer
      try { fs.unlinkSync(req.file.path); } catch {}
    }

    return res.json({ ok: true, raw });
  } catch (e) {
    console.error('[CART/item-file] error', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e), payload: e?.payload || null });
  }
});

// ===================== HEALTHCHECK =====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', spreadsheetId: SPREADSHEET_ID });
});

// ===================== FRONT /kits POUR LA MODALE CLIENT =====================
// GET /kits?email=...
app.get('/kits', async (req, res) => {
  const email = (req.query.email || '').trim();
  if (!email) {
    return res.status(400).json({ error: 'Missing email query parameter' });
  }

  const sheetName = email;
  const range = `'${sheetName}'!A2:V`;

  try {
    await ensureSheetExists(sheetName);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range
    });

    const rows = response.data.values || [];

    const kits = rows
      .filter((row) => row && row.length > 0)
      .map((row) => {
        const [
          kitId,
          kitName,
          imageUrl,
          defaultQtyLivretRaw,
          defaultQtyPochetteRaw,
          defaultQtyPatronRaw,
          nombrePagesLivret,
          typeLivret,
          typeImpressionCouverture,
          typeImpressionCorps,
          papierCouverture,
          papierCorps,
          formatFermeLivret,
          pochette,
          miseEnPochette,
          patronM2,
          impressionPatron,
          activeFlag,
          pjmOptionsJson,
          presseroLivretJson,
          presseroPochetteJson,
          presseroPatronJson
        ] = row;

        const defaultQtyLivret = parseNumberFromSheet(defaultQtyLivretRaw);
        const defaultQtyPochette = parseNumberFromSheet(defaultQtyPochetteRaw);
        const defaultQtyPatron = parseNumberFromSheet(defaultQtyPatronRaw);

        const activeRaw = (activeFlag || '')
          .toString()
          .trim()
          .toLowerCase();
        const isActive = !['non', 'no', '0', 'false'].includes(activeRaw);

        let pjmOptions = null;
        if (pjmOptionsJson && typeof pjmOptionsJson === 'string') {
          try {
            pjmOptions = JSON.parse(pjmOptionsJson);
          } catch (e) {
            console.warn(
              '[KITS] PJMOptionsJSON invalide pour le kit',
              kitId,
              e.message
            );
          }
        }

        return {
          kitId: kitId || '',
          name: kitName || '',
          imageUrl: imageUrl || '',
          defaultQtyLivret,
          defaultQtyPochette,
          defaultQtyPatron,
          presseroLivretJson: presseroLivretJson || '',
          presseroPochetteJson: presseroPochetteJson || '',
          presseroPatronJson: presseroPatronJson || '',
          

          // Placeholders pour l’UI (prix calculés plus tard si besoin)
          priceLivret: 0,
          pricePochette: 0,
          pricePatron: 0,

          active: isActive,

          config: {
            nombrePagesLivret: nombrePagesLivret || '',
            typeLivret: typeLivret || '',
            typeImpressionCouverture: typeImpressionCouverture || '',
            typeImpressionCorps: typeImpressionCorps || '',
            papierCouverture: papierCouverture || '',
            papierCorps: papierCorps || '',
            formatFermeLivret: formatFermeLivret || '',
            pochette: pochette || '',
            miseEnPochette: miseEnPochette || '',
            patronM2: patronM2 || '',
            impressionPatron: impressionPatron || ''
          },
          

          pjmOptions
        };
      })
      .filter((kit) => kit.active);

    return res.json({
      email,
      sheetName,
      count: kits.length,
      kits
    });
  } catch (err) {
    console.error(
      '❌ Erreur lors de la lecture du sheet pour',
      sheetName,
      err.message
    );

    return res.status(500).json({
      error: 'Error reading Google Sheet',
      details: err.message || String(err)
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ kits-couture-api listening on port ${PORT}`);
});

