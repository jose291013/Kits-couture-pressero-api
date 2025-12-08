const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

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
  creds = JSON.parse(SERVICE_ACCOUNT_KEY);
} catch (err) {
  console.error('❌ Impossible de parser GOOGLE_SERVICE_ACCOUNT_KEY comme JSON :', err);
  process.exit(1);
}

// Certains hébergeurs stockent la clé privée avec les "\n" échappés
const privateKey = creds.private_key.replace(/\\n/g, '\n');

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
    range: `'${sheetName}'!A1:S1`, // <-- A → S (19 colonnes)
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
          'PJMOptionsJSON' // S
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
function kitToRow(kit) {
  return [
    kit.kitId || '', // A - KitId
    kit.kitName || '', // B - KitName
    kit.imageUrl || '', // C - ImageURL
    kit.defaultQtyLivret || '', // D - DefaultQtyLivret
    kit.defaultQtyPochette || '', // E - DefaultQtyPochette
    kit.defaultQtyPatron || '', // F - DefaultQtyPatron
    kit.nombrePagesLivret || '', // G - NombrePagesLivret
    kit.typeLivret || '', // H - TypeLivret
    kit.typeImpressionCouverture || '', // I - TypeImpressionCouverture
    kit.typeImpressionCorps || '', // J - TypeImpressionCorps
    kit.papierCouverture || '', // K - PapierCouverture
    kit.papierCorps || '', // L - PapierCorps
    kit.formatFermeLivret || '', // M - FormatFermeLivret
    kit.pochette || '', // N - Pochette
    kit.miseEnPochette || '', // O - MiseEnPochette
    kit.patronM2 || '', // P - PatronM2
    kit.impressionPatron || '', // Q - ImpressionPatron
    kit.active ? 'Oui' : 'Non', // R - Active
    kit.pjmOptionsJson || '' // S - PJMOptionsJSON
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
    const range = `'${sheetName}'!A2:S`;

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
          pjmOptionsJson: row[18] || ''
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
    const range = `'${sheetName}'!A2:S`;
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
      pjmOptionsJson: body.pjmOptionsJson || body.PJMOptionsJSON || ''
    };

    const rowValues = [kitToRow(kit)];

    if (rowIndex) {
      // ---- UPDATE d'une ligne existante ----
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${sheetName}'!A${rowIndex}:S${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: rowValues
        }
      });
    } else {
      // ---- APPEND d'une nouvelle ligne ----
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${sheetName}'!A2:S`,
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
  const range = `'${sheetName}'!A2:S`;

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
          pjmOptionsJson
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

