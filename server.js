const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

// ====== CONFIG ENV ======
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

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

// Crée l'onglet pour cet email s'il n'existe pas encore
async function ensureSheetExists(sheetName) {
  // 1) Récupérer la liste des onglets
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID
  });

  const already = (meta.data.sheets || []).find(s =>
    s.properties && s.properties.title === sheetName
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

  // 3) Poser la ligne d'en-têtes (A1:J1)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1:J1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        'KitId',               // A
        'KitName',             // B
        'ImageUrl',            // C
        'DefaultQtyLivret',    // D
        'DefaultQtyPochette',  // E
        'DefaultQtyPatron',    // F
        'PriceLivret',         // G
        'PricePochette',       // H
        'PricePatron',         // I
        'Active'               // J (Oui/Non)
      ]]
    }
  });

  console.log(`[KITS] En-têtes initialisés pour "${sheetName}"`);
}


// Petite aide : convertion "1,2" -> nombre
function parseNumberFromSheet(value) {
  if (value == null) return 0;
  const v = String(value).trim().replace(',', '.');
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Endpoint de test
app.get('/health', (req, res) => {
  res.json({ status: 'ok', spreadsheetId: SPREADSHEET_ID });
});

// GET /kits?email=...
app.get('/kits', async (req, res) => {
  const email = (req.query.email || '').trim();
  if (!email) {
    return res.status(400).json({ error: 'Missing email query parameter' });
  }

  // Hypothèse actuelle : le nom de l’onglet = l’email du client
  // (ex : onglet "client1@test.com"). On pourra faire un mapping plus tard.
  const sheetName = email;

  // Plage : en-têtes en ligne 1, data à partir de A2:J (KitId .. Active)
  const range = `'${sheetName}'!A2:J`;

  try {
    // Crée l'onglet + en-têtes s'il n'existe pas encore
    await ensureSheetExists(sheetName);

    // Puis on lit les lignes de données
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range
    });

    const rows = response.data.values || [];

    // Map chaque ligne -> objet
    const kits = rows
      .filter(row => row && row.length > 0)
      .map(row => {
        const kitId             = row[0] || '';
        const kitName           = row[1] || '';
        const imageUrl          = row[2] || '';
        const defaultQtyLivret  = parseNumberFromSheet(row[3]);
        const defaultQtyPochette= parseNumberFromSheet(row[4]);
        const defaultQtyPatron  = parseNumberFromSheet(row[5]);
        const priceLivret       = parseNumberFromSheet(row[6]);
        const pricePochette     = parseNumberFromSheet(row[7]);
        const pricePatron       = parseNumberFromSheet(row[8]);
        const activeRaw         = (row[9] || '').toString().trim().toLowerCase();

        const isActive = ['oui', 'yes', 'si', 'sí', '1', 'true'].includes(activeRaw);

        return {
          kitId,
          name: kitName,
          imageUrl,
          defaultQtyLivret,
          defaultQtyPochette,
          defaultQtyPatron,
          priceLivret,
          pricePochette,
          pricePatron,
          active: isActive
        };
      })
      .filter(kit => kit.active); // on ne renvoie que les kits actifs

    res.json({
      email,
      sheetName,
      count: kits.length,
      kits
    });
  } catch (err) {
    console.error('❌ Erreur lors de la lecture du sheet pour', sheetName, err.message);

    
    res.status(500).json({
      error: 'Error reading Google Sheet',
      details: err.message || String(err)
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ kits-couture-api listening on port ${PORT}`);
});
