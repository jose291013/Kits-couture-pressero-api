<!-- START SCRIPT FRONT PAGE MES-KITS -->
<script>
(function () {
  if (!/\/page\/mes-kits\/?$/i.test(window.location.pathname)) return;


// === CONFIG FRONT ===
// Remplace par l'URL de ton serveur Render (sans slash final)
var KITS_API_BASE_URL = 'https://kits-couture-pressero-api-1.onrender.com';
// ====== PRESSEERO CONTEXT (par site) ======
var PRESSERO_ADMIN_URL = 'admin.ams.v6.pressero.com';       // admin host
var PRESSERO_SITE_DOMAIN = window.location.hostname;         // ex: decoration.ams.v6.pressero.com ou monsite.com
var PRESSERO_SITE_USER_ID = '031dfa6e-5328-44e7-bdc2-7de5c9605e9d'; // ton userId (temp en dur)

function getPresseroContext() {
  var adminUrl = String(PRESSERO_ADMIN_URL || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  var siteDomain = String(PRESSERO_SITE_DOMAIN || '').trim();
  var siteUserId = String(PRESSERO_SITE_USER_ID || '').trim();

  return {
    adminUrl: adminUrl,
    siteDomain: siteDomain,
    siteUserId: siteUserId
  };
}

// debug utile
window.KITS_PRESSERO_CONTEXT = getPresseroContext();

// Récupération de l’email client côté Pressero.
// Priorité : input caché > div#correo > variable globale
function getCurrentCustomerEmail() {
  // 1) input hidden (token Pressero)
  var el = document.getElementById('kitsCustomerEmail');
  var email = el ? String(el.value || '').trim() : '';

  // si le token n’a pas été remplacé, il ressemble à "###USERINFO,email###"
  if (email && email.indexOf('###') !== -1) email = '';

  // 2) fallback: div#correo (ancien pattern)
  if (!email) {
    var d = document.getElementById('correo');
    email = d ? String(d.textContent || d.innerText || '').trim() : '';
  }

  // 3) fallback: chercher une adresse email dans le HTML (souvent présent dans un champ caché / script)
  if (!email) {
    try {
      var html = document.documentElement ? document.documentElement.innerHTML : '';
      var match = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (match && match[0]) email = match[0];
    } catch (e) {}
  }

  email = String(email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) return null;
  return email;
}




    /* === Déplacer le bouton "Mes kits de couture" au-dessus du calculateur === */
    function repositionKitsButton() {
      try {
        var btnOpen = document.getElementById('openKitsModal');
        if (!btnOpen) return;

        // colonne du formulaire produit
        var productFormCol = document.querySelector('.col-md-6.product-form');
        // bloc du calculateur
        var pricingArea = document.getElementById('pricingArea');

        if (productFormCol && pricingArea) {
          // on insère le bouton juste avant le calculateur
          productFormCol.insertBefore(btnOpen, pricingArea);
        }
      } catch (e) {
        console.warn('[KITS] Impossible de repositionner le bouton Mes kits de couture', e);
      }
    }

    // on s'assure que le DOM est prêt
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', repositionKitsButton);
    } else {
      repositionKitsButton();
    }
    /* ====================================================================== */

    // ====== À partir d'ici : TON SCRIPT EXISTANT (sans nouveau "(function () {") ======
    var backdrop  = document.getElementById('kitsModalBackdrop');
    var btnSend   = document.getElementById('kitsSendBtn');
    var bottomSection    = document.getElementById('kitsBottomSection');
    var bottomGrid       = document.getElementById('kitsBottomGrid');
    var bottomToggle     = document.getElementById('kitsBottomToggle');
    var bottomToggleIcon = document.getElementById('kitsBottomToggleIcon');
    var uploadArea       = document.getElementById('kitsUploadArea');
    var uploadFilename   = document.getElementById('kitsUploadFilename');
    var uploadRemoveBtn  = document.getElementById('kitsUploadRemove');
    var errorBox         = document.getElementById('kitsError');

    var MIN_LIVRETS    = 10;
    var MIN_POCHETTES  = 10;

    function ensureTotalHTBlock() {
  var bottom = document.getElementById('kitsBottomSection');
  if (!bottom) return null;

  var el = document.getElementById('kitsTotalHT');
  if (!el) {
    el = document.createElement('div');
    el.id = 'kitsTotalHT';
    el.className = 'kc-total-ht';
    el.innerHTML = '<div>Total HT :</div><div class="kc-total-amount">0.00 €</div>';
    bottom.parentNode.insertBefore(el, bottom); // juste au-dessus “Options de fichiers…”
  }
  return el;
}

function setTotalHT(value) {
  var el = ensureTotalHTBlock();
  if (!el) return;
  var amt = el.querySelector('.kc-total-amount');
  if (amt) amt.textContent = (toNum(value) || 0).toFixed(2) + ' €';
}


    function ensureTotalHTBlock() {
  var bottom = document.getElementById('kitsBottomSection');
  if (!bottom) return null;

  var el = document.getElementById('kitsTotalHT');
  if (!el) {
    el = document.createElement('div');
    el.id = 'kitsTotalHT';
    el.className = 'kc-total-ht';
    el.innerHTML = '<div>Total HT :</div><div class="kc-total-amount">0.00 €</div>';
    bottom.parentNode.insertBefore(el, bottom); // ✅ juste au-dessus “Options de fichiers…”
  }
  return el;
}


    function isYesValue(val) {
      var s = (val || '').toString().trim().toLowerCase();
      return s === 'oui' || s === 'yes' || s === 'si' || s === 'sí';
    }

    function formatEuro(amount) {
      if (!isFinite(amount)) amount = 0;
      return amount.toFixed(2).replace('.', ',') + ' €';
    }

    function recalcRowTotal(row) {
  if (!row) return;

  // Totaux calculés par Pressero (si dispo)
  var totalLivret   = parseNumber(row.dataset.priceLivretTotal || '0');
  var totalPochette = parseNumber(row.dataset.pricePochetteTotal || '0');
  var totalPatron   = parseNumber(row.dataset.pricePatronTotal || '0');

  var hasPresseroTotals =
    (row.dataset.priceLivretTotal != null) ||
    (row.dataset.pricePochetteTotal != null) ||
    (row.dataset.pricePatronTotal != null);

  var total = 0;

  if (hasPresseroTotals) {
    total = totalLivret + totalPochette + totalPatron;
  } else {
    // fallback ancien mode
    var pLivret   = parseNumber(row.getAttribute('data-price-livret'));
    var pPochette = parseNumber(row.getAttribute('data-price-pochette'));
    var pPatron   = parseNumber(row.getAttribute('data-price-patron'));

    var qLivretInp   = row.querySelector('.kits-input-qte-component[data-component="livret"]');
    var qPochetteInp = row.querySelector('.kits-input-qte-component[data-component="pochette"]');
    var qPatronInp   = row.querySelector('.kits-input-qte-component[data-component="patron"]');

    var qLivret   = qLivretInp   ? parseNumber(qLivretInp.value)   : 0;
    var qPochette = qPochetteInp ? parseNumber(qPochetteInp.value) : 0;
    var qPatron   = qPatronInp   ? parseNumber(qPatronInp.value)   : 0;

    total = qLivret * pLivret + qPochette * pPochette + qPatron * pPatron;
  }

  // ✅ on stocke le total pour le grand total
  row.dataset.kitTotal = isNaN(total) ? '0' : total.toFixed(2);

  // ✅ si un jour tu ajoutes une cellule total, elle sera mise à jour
  var el = row.querySelector('.kc-price-total, .kits-row-total, .kc-row-total');
  if (el) el.textContent = formatEuro(total);
}

function highlightKitSearch(query) {
  query = String(query || '').trim().toLowerCase();

  document.querySelectorAll('tr[data-kit-row]').forEach(function (row) {
    var kitCell = row.querySelector('.kc-kit-name');
    if (!kitCell) return;

    var original = kitCell.getAttribute('data-orig') || kitCell.textContent || '';
    if (!kitCell.getAttribute('data-orig')) kitCell.setAttribute('data-orig', original);

    kitCell.innerHTML = original;
    if (!query) return;

    var low = original.toLowerCase();
    var idx = low.indexOf(query);
    if (idx === -1) return;

    var before = original.slice(0, idx);
    var match  = original.slice(idx, idx + query.length);
    var after  = original.slice(idx + query.length);

    kitCell.innerHTML = before + '<span class="kc-kit-highlight">' + match + '</span>' + after;
  });
}


    function recalcGrandTotal() {
      var total = 0;
      var kitRows = document.querySelectorAll('tr[data-kit-row]');
      kitRows.forEach(function (row) {
        total += parseNumber(row.dataset.kitTotal || '0');
      });
      setTotalHT(total);
      var totalSpan = document.querySelector('.kits-total-value');
      if (totalSpan) {
        totalSpan.textContent = formatEuro(total);
      }
    }

    function recalcAllTotals() {
      var kitRows = document.querySelectorAll('tr[data-kit-row]');
      kitRows.forEach(recalcRowTotal);
      recalcGrandTotal();
    }

    function initKitSearch() {
  // 1) retrouver l’input de recherche
  var searchInput =
    document.querySelector('#kitsSearchInput') ||
    document.querySelector('input[placeholder*="Rechercher un kit"]') ||
    document.querySelector('input[placeholder*="Rechercher"]');

  if (!searchInput) {
    console.warn('[SEARCH] input introuvable');
    return;
  }

  // éviter de binder 2 fois si la modale est réouverte
  if (searchInput.dataset.bound === '1') return;
  searchInput.dataset.bound = '1';

  // 2) listener
  searchInput.addEventListener('input', function () {
    highlightKitSearch(searchInput.value);
  });

  // 3) appliquer au chargement
  highlightKitSearch(searchInput.value);
}




function initRowBehavior(row) {
  var sameInput = row.querySelector('.kits-input-qte-identique');
  var componentInputs = row.querySelectorAll('.kits-input-qte-component');

  if (!sameInput || !componentInputs.length) return;

  // Qté identique → copie sur les 3 colonnes
  sameInput.addEventListener('input', function () {
    var val = sameInput.value;
    row.dataset.mode = 'linked';

    componentInputs.forEach(function (inp) {
      if (val !== '') inp.value = val;
    });

    recalcRowTotal(row);
    recalcGrandTotal();
    updatePackagingAndStickers(row);
    scheduleReprice();
     // la pochette change aussi
  });

  // Qtés individuelles → on passe en mode manuel
  componentInputs.forEach(function (inp) {
    inp.addEventListener('input', function () {
      row.dataset.mode = 'manual';
      sameInput.value = '';

      recalcRowTotal(row);
      recalcGrandTotal();

      if (inp.getAttribute('data-component') === 'pochette') {
        updatePackagingAndStickers(row);
    }
      scheduleReprice();
    });
  });

  // calcul initial
  recalcRowTotal(row);
  initPackagingAndStickersRow(row);
}

function initPackagingAndStickersRow(row) {
  var meSelect = row.querySelector('.kc-mepochette-select');
  var meQty    = row.querySelector('.kc-qty-mepochette');
  var stSelect = row.querySelector('.kc-stickers-select');
  var stQty    = row.querySelector('.kc-qty-stickers');

    if (meSelect) {
    meSelect.addEventListener('change', function () {
      // on repart sur les valeurs automatiques
      if (meQty) meQty.dataset.manual = '';
      if (stQty) stQty.dataset.manual = '';
      updatePackagingAndStickers(row);
      scheduleReprice();
    });
  }


  if (meQty) {
    meQty.addEventListener('input', function () {
      meQty.dataset.manual = '1';
      updatePackagingAndStickers(row);
      scheduleReprice();
    });
  }

  if (stSelect) {
  stSelect.addEventListener('change', function () {
    // l’utilisateur force Oui/Non pour les pastilles
    stSelect.dataset.manualChoice = '1';     // ✅ mémorise le choix
    if (stQty) stQty.dataset.manual = '';    // ✅ repasse qty en auto (sauf si l’utilisateur retape)
    updatePackagingAndStickers(row);
    scheduleReprice();
  });
}


  if (stQty) {
    stQty.addEventListener('input', function () {
      stQty.dataset.manual = '1';
      updatePackagingAndStickers(row);
      scheduleReprice();
    });
  }

  // premier calcul avec les valeurs par défaut
  updatePackagingAndStickers(row);
  scheduleReprice();
}

function updateStickersColumnVisibility() {
  var groups = document.querySelectorAll('.kc-option-stickers');
  var anyVisible = false;

  groups.forEach(function (g) {
    if (g.style.display !== 'none') {
      anyVisible = true;
    }
  });

  var th = document.querySelector('.kc-th-stickers');
  var cells = document.querySelectorAll('.kc-cell-stickers');

  if (!th || !cells.length) return;

  if (anyVisible) {
    th.style.display = '';
    cells.forEach(function (c) { c.style.display = ''; });
  } else {
    th.style.display = 'none';
    cells.forEach(function (c) { c.style.display = 'none'; });
  }
}



function updatePackagingAndStickers(row) {
  var pochetteInput = row.querySelector('.kits-input-qte-component[data-component="pochette"]');
  var pochetteQty = pochetteInput ? parseNumber(pochetteInput.value) : 0;

  var meGroup  = row.querySelector('.kc-option-mepochette');
  var meSelect = row.querySelector('.kc-mepochette-select');
  var meQty    = row.querySelector('.kc-qty-mepochette');

  var stGroup  = row.querySelector('.kc-option-stickers');
  var stSelect = row.querySelector('.kc-stickers-select');
  var stQty    = row.querySelector('.kc-qty-stickers');

  // 1) Aucune pochette => on cache tout
  if (!pochetteQty) {
    if (meGroup) { meGroup.style.display = 'none'; meGroup.classList.remove('has-qty'); }
    if (stGroup) { stGroup.style.display = 'none'; stGroup.classList.remove('has-qty'); }

    if (meQty) { meQty.value = ''; meQty.dataset.manual = ''; }
    if (stQty) { stQty.value = ''; stQty.dataset.manual = ''; }

    if (stSelect) { stSelect.value = 'Non'; stSelect.dataset.manualChoice = ''; }

    updateStickersColumnVisibility();
    return;
  }

  // 2) Pochettes > 0 => on montre Mise en pochette + Pastilles (toujours)
  if (meGroup) meGroup.style.display = 'flex';
  if (stGroup) stGroup.style.display = 'flex';

  var isMeYes = meSelect && isYesValue(meSelect.value);

  // --- Mise en pochette ---
  if (isMeYes) {
    if (meGroup) meGroup.classList.add('has-qty');
    if (meQty && !meQty.dataset.manual) meQty.value = pochetteQty; // défaut = toutes les pochettes
  } else {
    if (meGroup) meGroup.classList.remove('has-qty');
    if (meQty) { meQty.value = ''; meQty.dataset.manual = ''; } // pas de qty mise en pochette si "Non"
  }

  // --- Pastilles ---
  var stChoiceManual = stSelect && stSelect.dataset.manualChoice === '1';
  if (stSelect && !stChoiceManual) {
    // défaut: si pas de mise en pochette => Oui, sinon => Non (mais modifiable)
    stSelect.value = isMeYes ? 'Non' : 'Oui';
  }

  var isStYes = stSelect && isYesValue(stSelect.value);

  if (isStYes) {
    if (stGroup) stGroup.classList.add('has-qty');
    if (stQty && !stQty.dataset.manual) stQty.value = pochetteQty; // défaut = toutes les pochettes
  } else {
    if (stGroup) stGroup.classList.remove('has-qty');
    if (stQty) { stQty.value = ''; stQty.dataset.manual = ''; }
  }

  updateStickersColumnVisibility();
}

function buildKitsTableFromApiData(kits) {
  var tbody = document.getElementById('kitsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  kits.forEach(function (kit) {
    var tr = document.createElement('tr');
    tr.className = 'kc-kit-row';
    tr.setAttribute('data-kit-row', '1');
    tr.setAttribute('data-kit-id', kit.kitId || '');
    tr.setAttribute('data-price-livret', kit.priceLivret || 0);
    tr.setAttribute('data-price-pochette', kit.pricePochette || 0);
    tr.setAttribute('data-price-patron', kit.pricePatron || 0);
    tr.dataset.kitTotal = '0';
    tr.dataset.presseroLivretJson = kit.presseroLivretJson || '';
    tr.dataset.presseroPochetteJson = kit.presseroPochetteJson || '';
    tr.dataset.presseroPatronJson = kit.presseroPatronJson || '';
    
    var defaultLivret   = kit.defaultQtyLivret   || 0;
    var defaultPochette = kit.defaultQtyPochette || 0;
    var defaultPatron   = kit.defaultQtyPatron   || 0;

    var imgUrl = String(kit.imageUrl || '').trim();
var imgCell = '<td class="kc-kit-image"><div class="kc-image-placeholder"></div></td>';

if (/^https?:\/\//i.test(imgUrl)) {
  imgCell =
    '<td class="kc-kit-image">' +
      '<img class="kc-kit-thumb" src="' + imgUrl.replace(/"/g, '&quot;') + '" alt="">' +
    '</td>';
}
// ================== LIGHTBOX IMAGE KIT (click sur imagette) ==================
function ensureKitsImageLightbox() {
  // CSS une seule fois
  if (!document.getElementById('kitsImageLightboxStyle')) {
    var st = document.createElement('style');
    st.id = 'kitsImageLightboxStyle';
    st.textContent = `
      img.kc-kit-thumb { cursor: zoom-in; }
      #kitsImageLightbox {
        position: fixed; inset: 0;
        display: none; align-items: center; justify-content: center;
        padding: 24px;
        background: rgba(0,0,0,.65);
        z-index: 999999;
      }
      #kitsImageLightbox.is-open { display: flex; }
      #kitsImageLightbox .kits-imglb-inner {
        position: relative;
        max-width: min(1100px, 96vw);
        max-height: 92vh;
      }
      #kitsImageLightbox .kits-imglb-img {
        max-width: 96vw;
        max-height: 92vh;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 18px 40px rgba(0,0,0,.35);
        display: block;
      }
      #kitsImageLightbox .kits-imglb-close {
        position: absolute;
        top: -12px; right: -12px;
        width: 34px; height: 34px;
        border-radius: 999px;
        border: none;
        background: #fff;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        box-shadow: 0 6px 16px rgba(0,0,0,.25);
      }
    `;
    document.head.appendChild(st);
  }

  // DOM une seule fois
  var lb = document.getElementById('kitsImageLightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'kitsImageLightbox';
          lb.innerHTML = `
  <div class="kits-imglb-inner" role="dialog" aria-modal="true">
    <button type="button" class="kits-imglb-close" aria-label="Fermer">×</button>
    <div class="kits-imglb-title"></div>
    <img class="kits-imglb-img" alt="">
  </div>
`;

    document.body.appendChild(lb);

    lb.addEventListener('click', function (e) {
      if (e.target === lb || e.target.classList.contains('kits-imglb-close')) {
        lb.classList.remove('is-open');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') lb.classList.remove('is-open');
    });
  }

  return lb;
}

function openKitImageLightbox(src, alt, title) {
  if (!src) return;
  var lb = ensureKitsImageLightbox();

  var titleEl = lb.querySelector('.kits-imglb-title');
  if (titleEl) titleEl.textContent = title || '';

  var img = lb.querySelector('.kits-imglb-img');
  if (img) {
    img.src = src;
    img.alt = alt || '';
  }
  lb.classList.add('is-open');
}


// Event delegation (marche même si le tableau est re-rendu)
document.addEventListener('click', function (e) {
  var img = e.target && e.target.closest ? e.target.closest('img.kc-kit-thumb') : null;
  if (!img) return;

  // évite un éventuel click sur la ligne / autres handlers
  e.preventDefault();
  e.stopPropagation();

  var tr = img.closest('tr');
var kitName =
  (tr && tr.querySelector('.kc-kit-name') && tr.querySelector('.kc-kit-name').textContent || '').trim();

openKitImageLightbox(
  img.getAttribute('src'),
  img.getAttribute('alt') || '',
  kitName || 'Aperçu'
);

}, true);
// =====================================================================


tr.innerHTML =
  imgCell +
  '<td class="kc-kit-name">' + (kit.name || '') + '</td>' +
       '<td class="kc-cell-identique">' +
        '<input type="number" class="kc-qty-identique kits-input-qte-identique" min="0" step="1" value="' + defaultLivret + '">' +
      '</td>' +

      '<td class="kc-cell-qty kc-cell-livret">' +
        '<input type="number" class="kc-qty-livret kits-input-qte-component" data-component="livret" min="0" step="1" value="' + defaultLivret + '">' +
      '</td>' +
      '<td class="kc-cell-price kc-cell-livret">' +
        '<span class="kc-price-livret">' + formatEuro(kit.priceLivret || 0) + '</span>' +
      '</td>' +

      '<td class="kc-cell-qty kc-cell-pochette">' +
        '<input type="number" class="kc-qty-pochette kits-input-qte-component" data-component="pochette" min="0" step="1" value="' + defaultPochette + '">' +
      '</td>' +
      '<td class="kc-cell-price kc-cell-pochette">' +
        '<span class="kc-price-pochette">' + formatEuro(kit.pricePochette || 0) + '</span>' +
      '</td>' +

      '<td class="kc-cell-qty kc-cell-patron">' +
        '<input type="number" class="kc-qty-patron kits-input-qte-component" data-component="patron" min="0" step="1" value="' + defaultPatron + '">' +
      '</td>' +
      '<td class="kc-cell-price kc-cell-patron">' +
        '<span class="kc-price-patron">' + formatEuro(kit.pricePatron || 0) + '</span>' +
      '</td>' +

      '<td class="kc-cell-update">' +
        '<select class="kc-update-select">' +
          '<option value="Non">Non</option>' +
          '<option value="Oui">Oui</option>' +
        '</select>' +
      '</td>' +

      '<td class="kc-cell-mepochette">' +
        '<div class="kc-option-group kc-option-mepochette">' +
          '<select class="kc-mepochette-select">' +
            '<option value="Non">Non</option>' +
            '<option value="Oui">Oui</option>' +
          '</select>' +
          '<input type="number" class="kc-qty-mepochette" min="0" step="1" placeholder="Qté">' +
        '</div>' +
      '</td>' +

      '<td class="kc-cell-stickers">' +
        '<div class="kc-option-group kc-option-stickers">' +
          '<select class="kc-stickers-select">' +
            '<option value="Non">Non</option>' +
            '<option value="Oui">Oui</option>' +
          '</select>' +
          '<input type="number" class="kc-qty-stickers" min="0" step="1" placeholder="Qté">' +
        '</div>' +
      '</td>';

    tbody.appendChild(tr);
  });

  // Initialiser tous les comportements sur les nouvelles lignes
  var rows = tbody.querySelectorAll('tr[data-kit-row]');
  rows.forEach(function (row) {
    initRowBehavior(row);
  });

  updateBottomVisibility();
  recalcGrandTotal();
  scheduleReprice();
}

 var kitsLoaded = false;

function loadKitsFromApiOnce() {
  if (kitsLoaded) return;
  

  var email = getCurrentCustomerEmail();
  console.log('[KITS] email détecté =', email, 'hidden=', (document.getElementById('kitsCustomerEmail')?document.getElementById('kitsCustomerEmail').value:''));
  if (!email) {
    console.warn('[KITS] Email client introuvable, impossible d’appeler /kits');
    return;
  }
  kitsLoaded = true;

  var url = KITS_API_BASE_URL + '/kits?email=' + encodeURIComponent(email);

  fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (!data || !Array.isArray(data.kits)) {
        console.warn('[KITS] Réponse /kits inattendue', data);
        return;
      }
      buildKitsTableFromApiData(data.kits);
      initKitSearch();
    })
    .catch(function (err) {
      console.error('[KITS] Erreur lors de l’appel /kits :', err);
    });
}
       
        /* ---- Qté identique / manuel (lignes initiales) ---- */
var rows = document.querySelectorAll('tr[data-kit-row]');
rows.forEach(function (row) {
  initRowBehavior(row);
});
recalcGrandTotal();
Promise.resolve(updateAllPricesFromPressero())
  .catch(function(e){ console.error('[PRESSEERO] updateAllPricesFromPressero failed', e); });

function safeJsonParse(s) {
  try { return JSON.parse(s || ''); } catch(e) { return null; }
}

function toNum(v) {
  var n = parseFloat(String(v || '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Construit le tableau "quantities" dans l’ordre attendu par Pressero
function buildPresseroQuantitiesArray(presseroJson, kitCtx, globalCtx) {
  var order = Array.isArray(presseroJson.quantitiesOrder) ? presseroJson.quantitiesOrder : [];
  var plan = Array.isArray(presseroJson.quantitiesPlan) ? presseroJson.quantitiesPlan : [];
  var constants = presseroJson.constants || {};

  var byId = {};
  plan.forEach(function(p){ if (p && p.id) byId[p.id] = p; });

  return order.map(function(qId){
    var p = byId[qId];
    if (!p) return 0;

    var mode = String(p.mode || 'KIT').toUpperCase();

    if (mode === 'FIXED') return toNum(p.value);

    if (mode === 'KIT') return toNum(kitCtx[p.field]);

    if (mode === 'GLOBAL') return toNum(globalCtx[p.field]);

    if (mode === 'DERIVED') {
      var base = toNum(kitCtx[p.field]); // ex qtyPatron
      var k = toNum(constants[p.multiplierKey]); // ex m2PerPatronColor
      var f = (p.factor == null || p.factor === '') ? 1 : toNum(p.factor);
      return base * k * f;
    }
    return 0;
  });
}

async function fetchPresseroPrice(presseroJson, quantitiesArr) {
  var ctx = getPresseroContext();

if (!ctx.siteUserId) {
  throw new Error('siteUserId introuvable. Impossible de pricer.');
}

var payload = {
  adminUrl: ctx.adminUrl,
  siteDomain: ctx.siteDomain,
  siteUserId: ctx.siteUserId, // ✅ clé attendue par le serveur
  productId: presseroJson.productId,
  options: presseroJson.options || [],
  quantities: quantitiesArr
};

  var r = await fetch(KITS_API_BASE_URL + '/admin/pressero/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  // on lit toujours le JSON (utile pour debug même si erreur)
  var j = null;
  try { j = await r.json(); } catch (e) {}

  if (!r.ok) {
    throw new Error('HTTP ' + r.status + (j ? ' ' + JSON.stringify(j) : ''));
  }

  // ✅ unwrap
  if (j && j.raw) return j.raw;
  return j;
}


// Debounce pour éviter 200 appels pendant que l’utilisateur tape
var _priceTimer = null;
function scheduleReprice() {
  clearTimeout(_priceTimer);
  _priceTimer = setTimeout(updateAllPricesFromPressero, 350);
}

async function updateAllPricesFromPressero() {
  var rows = Array.from(document.querySelectorAll('.kc-kit-row'));
  if (!rows.length) return;

  // helpers selectors (compat)
  function readQty(tr, key) {
    // nouveau: .kits-input-qte-component[data-component="livret"]
    var el = tr.querySelector('.kits-input-qte-component[data-component="' + key + '"]');
    // ancien fallback: .kc-qty-livret / .kc-qty-pochette / .kc-qty-patron
    if (!el) el = tr.querySelector('.kc-qty-' + key);
    return toNum(el && el.value);
  }

  // 1) lire quantités par kit
  var kitsData = rows.map(function(tr){
    return {
      tr: tr,
      qtyLivret: readQty(tr, 'livret'),
      qtyPochette: readQty(tr, 'pochette'),
      qtyPatron: readQty(tr, 'patron'),

      // options “pochette”
      qtyMiseEnPochette: (function(){var el=tr.querySelector('.kc-qty-mepochette');return toNum(el?el.value:0);})(),
      qtyPastille: (function(){var el=tr.querySelector('.kc-qty-stickers');return toNum(el?el.value:0);})()
    };
  });

  function sumBy(arr, key) {
  return arr.reduce(function (s, k) { return s + (k[key] || 0); }, 0);
}

var sumLivret   = sumBy(kitsData, 'qtyLivret');
var sumPochette = sumBy(kitsData, 'qtyPochette');
var sumPatron   = sumBy(kitsData, 'qtyPatron');
var sumME       = sumBy(kitsData, 'qtyMiseEnPochette');
var sumPast     = sumBy(kitsData, 'qtyPastille');

// ✅ globalCtx complet + ALIAS attendus par les presets admin
var globalCtx = {
  // valeurs “normales”
  qtyLivret: sumLivret,
  qtyPochette: sumPochette,
  qtyPatron: sumPatron,
  qtyMiseEnPochette: sumME,
  qtyPastille: sumPast,

  // ✅ alias utilisés par les presets admin
  globalLivret: sumLivret,
  globalPochette: sumPochette,

  // compat ancien nom
  qtyMepochette: sumME,

  // m²
  m2Color: 0,
  m2BW: 0,
  m2Nb: 0
};




  // 3) calculer m² globaux si tes presets patrons utilisent GLOBAL=m2Color/m2BW
  kitsData.forEach(function(k){
    var pJson = safeJsonParse(k.tr.dataset.presseroPatronJson || '');
    if (!pJson || !pJson.constants) return;

    var isColor = /couleur/i.test(String(k.tr.getAttribute('data-impression-patron') || 'Couleur'));

    var cColor = toNum(pJson.constants.m2PerPatronColor);
    // compat: certaines fois tu as BW, d’autres NB
    var cBW = toNum(pJson.constants.m2PerPatronBW || pJson.constants.m2PerPatronNB);

    if (isColor) globalCtx.m2Color += k.qtyPatron * cColor;
    else globalCtx.m2BW += k.qtyPatron * cBW;
  });
  globalCtx.m2Nb = globalCtx.m2BW;

  // 4) pricing par kit
  for (var i=0; i<kitsData.length; i++) {
    var k = kitsData[i];
    var tr = k.tr;

    var kitCtx = {
      qtyLivret: k.qtyLivret,
      qtyPochette: k.qtyPochette,
      qtyPatron: k.qtyPatron,

      qtyMiseEnPochette: k.qtyMiseEnPochette,
      qtyPastille: k.qtyPastille,

      // compat ancien nom
      qtyMepochette: k.qtyMiseEnPochette
    };

    // LIVRET
    try {
      var livretJson = safeJsonParse(tr.dataset.presseroLivretJson || '');
      if (livretJson && livretJson.productId) {
        if (k.qtyLivret <= 0) {
          tr.dataset.priceLivretTotal = '0';
          tr.querySelector('.kc-price-livret') && (tr.querySelector('.kc-price-livret').textContent = '0.00 €');
        } else {
          var qArr = buildPresseroQuantitiesArray(livretJson, kitCtx, globalCtx);
          var price = await fetchPresseroPrice(livretJson, qArr);
          var total = toNum(price.Cost);
          tr.dataset.priceLivretTotal = String(total);
          tr.querySelector('.kc-price-livret') && (tr.querySelector('.kc-price-livret').textContent = total.toFixed(2) + ' €');
        }
      }
    } catch(e) {
      console.error('[PRESSEERO] livret pricing error', e);
    }

    // POCHETTE
    try {
      var pochetteJson = safeJsonParse(tr.dataset.presseroPochetteJson || '');
      if (pochetteJson && pochetteJson.productId) {
        if (k.qtyPochette <= 0) {
          tr.dataset.pricePochetteTotal = '0';
          tr.querySelector('.kc-price-pochette') && (tr.querySelector('.kc-price-pochette').textContent = '0.00 €');
        } else {
          var qArr2 = buildPresseroQuantitiesArray(pochetteJson, kitCtx, globalCtx);
          var price2 = await fetchPresseroPrice(pochetteJson, qArr2);
          var total2 = toNum(price2.Cost);
          tr.dataset.pricePochetteTotal = String(total2);
          tr.querySelector('.kc-price-pochette') && (tr.querySelector('.kc-price-pochette').textContent = total2.toFixed(2) + ' €');
        }
      }
    } catch(e) {
      console.error('[PRESSEERO] pochette pricing error', e);
    }

    // PATRON
    try {
      var patronJson = safeJsonParse(tr.dataset.presseroPatronJson || '');
      if (patronJson && patronJson.productId) {
        if (k.qtyPatron <= 0) {
          tr.dataset.pricePatronTotal = '0';
          tr.querySelector('.kc-price-patron') && (tr.querySelector('.kc-price-patron').textContent = '0.00 €');
        } else {
          var qArr3 = buildPresseroQuantitiesArray(patronJson, kitCtx, globalCtx);
          var price3 = await fetchPresseroPrice(patronJson, qArr3);
          var total3 = toNum(price3.Cost);
          tr.dataset.pricePatronTotal = String(total3);
          tr.querySelector('.kc-price-patron') && (tr.querySelector('.kc-price-patron').textContent = total3.toFixed(2) + ' €');
        }
      }
    } catch(e) {
      console.error('[PRESSEERO] patron pricing error', e);
    }

    // ✅ important : recalculer le total de ligne après MAJ dataset
    if (typeof recalcRowTotal === 'function') recalcRowTotal(tr);
  }

  if (typeof recalcGrandTotal === 'function') recalcGrandTotal();
}
        
    /* ---- helpers fichiers ---- */
    function hasAnyUploadedFile() {
  var zip = document.getElementById('kitsZipInput');
  return !!(zip && zip.files && zip.files[0]);
}
function buildProductionSummaryFromTable() {
  var rows = Array.from(document.querySelectorAll('tr[data-kit-row]'));
  var kits = {};

  function readQty(tr, key) {
    var el = tr.querySelector('.kits-input-qte-component[data-component="' + key + '"]');
    if (!el) el = tr.querySelector('.kc-qty-' + key);
    return toNum(el && el.value);
  }

  rows.forEach(function(tr){
    var kitName = (tr.querySelector('.kc-kit-name')?.textContent || '').trim();
    if (!kitName) kitName = 'Kit';

    var qLivret   = readQty(tr, 'livret');
    var qPochette = readQty(tr, 'pochette');
    var qPatron   = readQty(tr, 'patron');

    // si kit vide, on l’ignore
    if ((qLivret + qPochette + qPatron) <= 0) return;

    var qMe   = toNum(tr.querySelector('.kc-qty-mepochette')?.value);
    var qPast = toNum(tr.querySelector('.kc-qty-stickers')?.value);

    var updateSel = tr.querySelector('.kc-update-select');
    var updateYes = updateSel && isYesValue(updateSel.value);

    kits[kitName] = kits[kitName] || {
      livrets: 0,
      pochettes: 0,
      patrons: 0,
      misePochetteQty: 0,
      pastilleQty: 0,
      majFichier: 'NON'
    };

    kits[kitName].livrets += qLivret;
    kits[kitName].pochettes += qPochette;
    kits[kitName].patrons += qPatron;

    // spécifique pochette
    kits[kitName].misePochetteQty += qMe;
    kits[kitName].pastilleQty += qPast;

    // MAJ fichier : si au moins une ligne kit est OUI, on met OUI
    if (updateYes) kits[kitName].majFichier = 'OUI';
  });

  // totaux globaux (pour ton PDF)
  var totals = { livrets: 0, pochettes: 0, patrons: 0, misePochetteQty: 0, pastilleQty: 0 };
  Object.keys(kits).forEach(function(k){
    totals.livrets += kits[k].livrets || 0;
    totals.pochettes += kits[k].pochettes || 0;
    totals.patrons += kits[k].patrons || 0;
    totals.misePochetteQty += kits[k].misePochetteQty || 0;
    totals.pastilleQty += kits[k].pastilleQty || 0;
  });

  return { kits: kits, totals: totals };
}


function removeAllUploadedFiles() {
  var zip = document.getElementById('kitsZipInput');
  if (zip) zip.value = '';
  if (uploadFilename) uploadFilename.textContent = '';
  if (uploadRemoveBtn) uploadRemoveBtn.style.display = 'none';
  if (uploadArea) uploadArea.classList.remove('kits-box-upload-error');
}


    function updateUploadUiFromSlots() {
  // éléments UI
  var area = document.getElementById('kitsUploadArea');
  var name = document.getElementById('kitsUploadFilename');
  var remove = document.getElementById('kitsUploadRemove');

  // 1) ✅ priorité au ZIP input
  var zip = document.getElementById('kitsZipInput');
  var fzip = zip && zip.files && zip.files[0];

  if (fzip) {
    if (name) name.textContent = fzip.name;
    if (remove) remove.style.display = '';
    if (area) {
      area.classList.remove('kits-box-upload-error');
      area.classList.add('has-file');

      // effet plus visible + plus long
      area.classList.add('pulse');
      setTimeout(function () { area.classList.remove('pulse'); }, 1400);
    }
    return;
  }

  // 2) fallback legacy: slots Pressero (si jamais tu les réutilises un jour)
  if (!name) return;

  var inputs = document.querySelectorAll('input[type="file"][id^="fileUploads"]');
  var label = '';
  var hasFile = false;

  for (var i = 0; i < inputs.length; i++) {
    var files = inputs[i].files;
    if (files && files.length) {
      hasFile = true;
      label = files.length === 1 ? files[0].name : files.length + ' fichiers sélectionnés';
      break;
    }
  }

  if (hasFile) {
    name.textContent = label;
    if (remove) remove.style.display = '';
    if (area) area.classList.remove('kits-box-upload-error');
  } else {
    name.textContent = '';
    if (remove) remove.style.display = 'none';
  }
}

    function removeAllUploadedFiles() {
      var removeBtns = document.querySelectorAll('.btn-progress-remove');
      if (removeBtns.length) {
        removeBtns.forEach(function (btn) { btn.click(); });
        setTimeout(updateUploadUiFromSlots, 200);
        return;
      }

      var inputs = document.querySelectorAll('input[type="file"][id^="fileUploads"]');
      inputs.forEach(function (inp) {
        inp.value = '';
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      });
      updateUploadUiFromSlots();
    }

    
/* ---- helpers nouveaux ---- */
function initZipUploadUi() {
  var area = document.getElementById('kitsUploadArea');
  var input = document.getElementById('kitsZipInput');
  var name = document.getElementById('kitsUploadFilename');
  var remove = document.getElementById('kitsUploadRemove');

  if (!area || !input) {
    console.warn('[KITS] initZipUploadUi: #kitsUploadArea ou #kitsZipInput introuvable');
    return;
  }

  function setFile(f) {
    if (name) name.textContent = f ? f.name : '';
    if (remove) remove.style.display = f ? '' : 'none';
  }

  // click => ouvrir windows fichiers
  area.addEventListener('click', function () {
    input.click();
  });

  // changement via input
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    setFile(f);
  });

  // supprimer
  if (remove) {
    remove.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      setFile(null);
      remove.style.display = 'none';
    });
    remove.style.display = 'none';
  }

  // Drag & drop
  function prevent(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (evt) {
    area.addEventListener(evt, prevent, false);
  });

  area.addEventListener('dragenter', function () {
    area.classList.add('is-dragover');
  });

  area.addEventListener('dragleave', function () {
    area.classList.remove('is-dragover');
  });

  area.addEventListener('drop', function (e) {
    area.classList.remove('is-dragover');

    var dt = e.dataTransfer;
    var files = dt && dt.files ? dt.files : null;
    if (!files || !files.length) return;

    var f = files[0];

    // Optionnel: refuser si pas zip
    var okZip = /\.zip$/i.test(f.name);
    if (!okZip) {
      showError('<p>Veuillez déposer un fichier <strong>.zip</strong>.</p>');
      return;
    }

    // Affecte au input (si le navigateur le permet)
    // Chrome le permet via DataTransfer
    try {
      var dtx = new DataTransfer();
      dtx.items.add(f);
      input.files = dtx.files;
    } catch (err) {
      // fallback: on garde au moins l’affichage du nom
      console.warn('[KITS] DataTransfer non supporté, fallback', err);
    }

    setFile(f);
  });

  // état initial
  setFile(input.files && input.files[0]);
}



    
    /* ---- section Upload/Commentaire ---- */
function updateBottomVisibility() {
  var bottomSection = document.getElementById('kitsBottomSection');
  var uploadArea = document.getElementById('kitsUploadArea');
  if (!bottomSection) return;

  // On regarde toutes les colonnes "Mise à jour fichier"
  var selects = document.querySelectorAll('.kits-select-maj, .kc-update-select');
  var showUpload = false;

  selects.forEach(function (sel) {
    if (isYesValue(sel.value)) showUpload = true;
  });

  // Le bloc bas est toujours disponible
  bottomSection.classList.add('is-visible');

  if (showUpload) {
    if (uploadArea) {
      uploadArea.style.display = '';
      uploadArea.classList.remove('kits-box-upload-error');
    }
    // On ouvre la section et la grille pour que l'upload soit visible
    ensureBottomOpen();
  } else {
    if (uploadArea) {
      uploadArea.style.display = 'none';
      uploadArea.classList.remove('kits-box-upload-error');
    }
    // on nettoie les fichiers si plus aucune mise à jour n'est demandée
    removeAllUploadedFiles();
  }
}



// === Mise à jour de la visibilité de la zone Upload/Commentaire
// On écoute *toutes* les modifications sur les select de mise à jour,
// y compris ceux créés dynamiquement par l'API
document.addEventListener('change', function (e) {
  var t = e.target;
  if (t && t.matches('.kits-select-maj, .kc-update-select')) {
    updateBottomVisibility();
  }
}, true);

// état initial (en fonction des valeurs par défaut)
updateBottomVisibility();



    function getBottomDom() {
  return {
    bottomSection: document.getElementById('kitsBottomSection'),
    bottomGrid: document.getElementById('kitsBottomGrid'),
    bottomToggle: document.getElementById('kitsBottomToggle'),
    bottomToggleIcon: document.getElementById('kitsBottomToggleIcon'),
  };
}

function ensureBottomOpen() {
  var d = getBottomDom();
  if (!d.bottomSection || !d.bottomGrid) return;

  d.bottomSection.classList.add('is-visible');
  d.bottomGrid.classList.add('is-open');

  // 🔥 IMPORTANT: si un ancien script a mis display:none en inline, on l’annule ici
  d.bottomGrid.style.display = '';

  if (d.bottomToggleIcon) {
    d.bottomToggleIcon.classList.add('is-open');
    d.bottomToggleIcon.textContent = '▾';
  }
}

function initBottomToggle() {
  var d = getBottomDom();
  if (!d.bottomToggle || !d.bottomGrid) return;

  // évite doublon si init est appelée 2 fois
  if (d.bottomToggle.__kcBound) return;
  d.bottomToggle.__kcBound = true;

  d.bottomToggle.addEventListener('click', function () {
    // jamais de style.display ici
    d.bottomGrid.style.display = '';

    var open = d.bottomGrid.classList.toggle('is-open');

    if (d.bottomToggleIcon) {
      d.bottomToggleIcon.classList.toggle('is-open', open);
      d.bottomToggleIcon.textContent = open ? '▾' : '▸';
    }
  });
}


    /* ---- ZIP upload uniquement ---- */
function getZipInput() {
  return document.getElementById('kitsZipInput');
}

function getZipFile() {
  var inp = getZipInput();
  return (inp && inp.files && inp.files[0]) ? inp.files[0] : null;
}

function updateZipUi() {
  var f = getZipFile();
  var name = document.getElementById('kitsUploadFilename');
  var remove = document.getElementById('kitsUploadRemove');

  if (name) name.textContent = f ? f.name : '';
  if (remove) remove.style.display = f ? '' : 'none';
}

// ⚠️ si tu as encore un updateUploadUiFromSlots() qui “réinitialise” le nom,
// fais en sorte qu’il respecte le ZIP en priorité :
// ===== ZIP ONLY (une seule version) =====
function hasAnyUploadedFile() {
  var zip = getZipInput();
  return !!(zip && zip.files && zip.files[0]);
}

// Si ton code appelle encore "updateUploadUiFromSlots", on le garde
// mais on le mappe sur le ZIP (ZIP uniquement)
function updateUploadUiFromSlots() {
  updateZipUi();
}

function removeAllUploadedFiles() {
  var inp = getZipInput();
  if (inp) inp.value = '';
  updateZipUi();
}

function initZipUploadUi() {
  var area = document.getElementById('kitsUploadArea');
  var zip = getZipInput();

  if (!area || !zip) {
    console.warn('[KITS] ZIP UI: #kitsUploadArea ou #kitsZipInput introuvable');
    return;
  }

  // click => file picker
  area.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    zip.click();
  });

  // input change
  zip.addEventListener('change', function () {
    var f = zip.files && zip.files[0];
    if (f && !/\.zip$/i.test(f.name)) {
      zip.value = '';
      updateZipUi();
      showError('<p>Veuillez sélectionner un fichier <strong>.zip</strong>.</p>');
      return;
    }
    updateZipUi();
  });

  // drag hover
  function prevent(e) { e.preventDefault(); e.stopPropagation(); }

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (evt) {
    area.addEventListener(evt, prevent, false);
  });

  area.addEventListener('dragenter', function () {
    area.classList.add('is-dragover');
  });

  area.addEventListener('dragleave', function () {
    area.classList.remove('is-dragover');
  });

  // drop => assign file
  area.addEventListener('drop', function (e) {
    area.classList.remove('is-dragover');

    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;

    var f = files[0];
    if (!/\.zip$/i.test(f.name)) {
      showError('<p>Veuillez déposer un fichier <strong>.zip</strong>.</p>');
      return;
    }

    try {
      var dt = new DataTransfer();
      dt.items.add(f);
      zip.files = dt.files;
    } catch (err) {
      console.warn('[KITS] DataTransfer non supporté, fallback', err);
    }

    updateZipUi();
  });

  // remove button
  var removeBtn = document.getElementById('kitsUploadRemove');
  if (removeBtn) {
    removeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      removeAllUploadedFiles();
    });
  }

  // état initial
  updateZipUi();
}

function setZipUploading(on) {
  var area = document.getElementById('kitsUploadArea');
  if (!area) return;
  area.classList.toggle('is-uploading', !!on);
}



    /* ---- erreurs (quantités + fichiers) ---- */
function parseNumber(value) {
  if (value == null) return 0;
  var v = String(value).trim().replace(',', '.');
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
  });
}

// ⚠️ IMPORTANT : ne pas “capturer” #kitsError trop tôt
// La modale peut être injectée après => on le re-cherche à chaque fois.
var errorBox = null;

function getErrorBox() {
  if (errorBox && document.body.contains(errorBox)) return errorBox;
  errorBox = document.getElementById('kitsError');

  // bind du bouton close une seule fois
  if (errorBox && errorBox.dataset.boundClose !== '1') {
    errorBox.dataset.boundClose = '1';
    errorBox.addEventListener('click', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('kits-error-close')) {
        errorBox.style.display = 'none';
      }
    });
  }
  return errorBox;
}

function clearError() {
  var box = getErrorBox();
  if (box) {
    box.innerHTML = '';
    box.style.display = 'none';
  }
  if (uploadArea) uploadArea.classList.remove('kits-box-upload-error');
}

function showError(html) {
  var box = getErrorBox();
  if (!box) {
    console.warn('[KITS] #kitsError introuvable (modale pas encore prête ?)');
    return;
  }

  box.innerHTML =
    '<div class="kits-error-header">' +
      '<span>Attention</span>' +
      '<button type="button" class="kits-error-close" aria-label="Fermer l’alerte">×</button>' +
    '</div>' +
    html;

  box.style.display = 'block';

  // optionnel: scroll doux pour être sûr que l’utilisateur le voit
  try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(e) {}
}

function checkMinQuantities() {
  var MIN_PAR_KIT = 10; // ✅ règle par ligne si qty > 0
  var rows = document.querySelectorAll('tr[data-kit-row]');

  // 1) règle par kit: min 10 sur livrets ET pochettes (si > 0)
  var perKitIssues = [];

  rows.forEach(function (row) {
    var kitName = (row.querySelector('.kc-kit-name')?.textContent || 'Kit').trim();

    var livretInput = row.querySelector('.kits-input-qte-component[data-component="livret"]');
    var pochetteInput = row.querySelector('.kits-input-qte-component[data-component="pochette"]');

    var qLiv = livretInput ? parseNumber(livretInput.value) : 0;
    var qPoc = pochetteInput ? parseNumber(pochetteInput.value) : 0;

    var issues = [];
    if (qLiv > 0 && qLiv < MIN_PAR_KIT) issues.push('livrets: ' + qLiv);
    if (qPoc > 0 && qPoc < MIN_PAR_KIT) issues.push('pochettes: ' + qPoc);

    if (issues.length) {
      row.classList.add('kits-row-min-error');
      perKitIssues.push('<li><strong>' + escapeHtml(kitName) + '</strong> — ' + issues.join(', ') + '</li>');
    } else {
      row.classList.remove('kits-row-min-error');
    }
  });

  if (perKitIssues.length) {
    showError(
      '<p><strong>Minimum ' + MIN_PAR_KIT + ' par kit</strong> (uniquement si la quantité est supérieure à 0).</p>' +
      '<ul style="margin:6px 0 0 18px;">' + perKitIssues.join('') + '</ul>'
    );
    return false;
  }

  // 2) totaux globaux (tes règles MIN_LIVRETS / MIN_POCHETTES)
  var totalLivrets = 0;
  var totalPochettes = 0;
  var totalPatrons = 0;

  rows.forEach(function (row) {
    var livretInput   = row.querySelector('.kits-input-qte-component[data-component="livret"]');
    var pochetteInput = row.querySelector('.kits-input-qte-component[data-component="pochette"]');
    var patronInput   = row.querySelector('.kits-input-qte-component[data-component="patron"]');

    if (livretInput)   totalLivrets   += parseNumber(livretInput.value);
    if (pochetteInput) totalPochettes += parseNumber(pochetteInput.value);
    if (patronInput)   totalPatrons   += parseNumber(patronInput.value);
  });

  // 3) si rien => bloquer + message
  if (totalLivrets <= 0 && totalPochettes <= 0 && totalPatrons <= 0) {
    showError('<p>Veuillez saisir une quantité pour au moins un produit (livret, pochette ou patron).</p>');
    return false;
  }

  // 4) minimums globaux UNIQUEMENT si le produit est commandé
  var missingLivrets   = (totalLivrets > 0)   ? Math.max(0, MIN_LIVRETS    - totalLivrets)   : 0;
  var missingPochettes = (totalPochettes > 0) ? Math.max(0, MIN_POCHETTES  - totalPochettes) : 0;

  if (missingLivrets > 0 || missingPochettes > 0) {
    var htmlParts = [];

    if (missingLivrets > 0) {
      htmlParts.push(
        '<p>Il vous manque <strong>' + missingLivrets + ' livret(s)</strong> ' +
        'pour atteindre la quantité minimum de <strong>' + MIN_LIVRETS + ' livret(s)</strong>.</p>'
      );
    }
    if (missingPochettes > 0) {
      htmlParts.push(
        '<p>Il vous manque <strong>' + missingPochettes + ' pochette(s)</strong> ' +
        'pour atteindre la quantité minimum de <strong>' + MIN_POCHETTES + ' pochette(s)</strong>.</p>'
      );
    }

    htmlParts.push('<p><strong>Note :</strong> vous pouvez commander uniquement livrets, ou uniquement pochettes, ou uniquement patrons.</p>');
    showError(htmlParts.join(''));
    return false;
  }

  return true;
}



   function hasUpdateRequest() {
  // idem : on accepte .kits-select-maj et .kc-update-select
  var selects = document.querySelectorAll('.kits-select-maj, .kc-update-select');
  var found = false;
  selects.forEach(function (sel) {
    if (isYesValue(sel.value)) found = true;
  });
  return found;
}

function computeGlobalCtxFromTable() {
  var rows = Array.from(document.querySelectorAll('tr[data-kit-row]'));

  function readQty(tr, key) {
    // nouveau: .kits-input-qte-component[data-component="livret"]
    var el = tr.querySelector('.kits-input-qte-component[data-component="' + key + '"]');
    // fallback ancien: .kc-qty-livret / .kc-qty-pochette / .kc-qty-patron
    if (!el) el = tr.querySelector('.kc-qty-' + key);
    return toNum(el && el.value);
  }

  var globalCtx = {
    qtyLivret: 0,
    qtyPochette: 0,
    qtyPatron: 0,

    // ✅ champs “pochette” dans le même moteur
    qtyMiseEnPochette: 0,
    qtyPastille: 0,

    // ✅ alias utilisés par certains presets admin
    globalLivret: 0,
    globalPochette: 0,
    qtyMepochette: 0, // compat ancien nom

    // patrons m² (si tes presets patrons utilisent GLOBAL=m2Color/m2BW)
    m2Color: 0,
    m2BW: 0,
    m2Nb: 0
  };

  rows.forEach(function (tr) {
    var qLivret   = readQty(tr, 'livret');
    var qPochette = readQty(tr, 'pochette');
    var qPatron   = readQty(tr, 'patron');

    var qMe       = toNum(tr.querySelector('.kc-qty-mepochette')?.value);
    var qPastille = toNum(tr.querySelector('.kc-qty-stickers')?.value);

    globalCtx.qtyLivret += qLivret;
    globalCtx.qtyPochette += qPochette;
    globalCtx.qtyPatron += qPatron;

    globalCtx.qtyMiseEnPochette += qMe;
    globalCtx.qtyPastille += qPastille;

    // alias
    globalCtx.qtyMepochette += qMe;

    // m² patrons (si besoin)
    var patronJson = safeJsonParse(tr.dataset.presseroPatronJson || '');
    if (patronJson && patronJson.constants) {
      var isColor = /couleur/i.test(String(tr.getAttribute('data-impression-patron') || 'Couleur'));
      if (isColor) globalCtx.m2Color += qPatron * toNum(patronJson.constants.m2PerPatronColor);
      else globalCtx.m2BW += qPatron * toNum(patronJson.constants.m2PerPatronBW || patronJson.constants.m2PerPatronNB);
    }
  });

  globalCtx.m2Nb = globalCtx.m2BW;

  // alias “global”
  globalCtx.globalLivret = globalCtx.qtyLivret;
  globalCtx.globalPochette = globalCtx.qtyPochette;

  return globalCtx;
}



async function addBundleForRow(cartId, tr, kitName, notesCommon) {
  var ctx = getPresseroContext();

  function readQty(tr, key) {
    var el = tr.querySelector('.kits-input-qte-component[data-component="' + key + '"]');
    if (!el) el = tr.querySelector('.kc-qty-' + key);
    return toNum(el && el.value);
  }

  // ✅ quantités principales
  var qtyLivret   = readQty(tr, 'livret');
  var qtyPochette = readQty(tr, 'pochette');
  var qtyPatron   = readQty(tr, 'patron');

  // ✅ options pochette (même moteur)
  var qtyMiseEnPochette = toNum(tr.querySelector('.kc-qty-mepochette')?.value);
  var qtyPastille       = toNum(tr.querySelector('.kc-qty-stickers')?.value);

  // ✅ kitCtx: DOIT matcher les keys utilisées dans quantitiesPlan (admin presets)
  var kitCtx = {
    qtyLivret: qtyLivret,
    qtyPochette: qtyPochette,
    qtyPatron: qtyPatron,

    qtyMiseEnPochette: qtyMiseEnPochette,
    qtyPastille: qtyPastille,

    // compat ancien nom
    qtyMepochette: qtyMiseEnPochette
  };

  // ✅ globalCtx recalculé “comme le pricing”
  var globalCtx = computeGlobalCtxFromTable();

  var items = [];

  // LIVRET
  if (qtyLivret > 0) {
    var liv = safeJsonParse(tr.dataset.presseroLivretJson || '');
    if (liv && liv.productId) {
      var qArr = buildPresseroQuantitiesArray(liv, kitCtx, globalCtx);
      items.push({
        kind: 'livret',
        itemBody: {
          ProductId: liv.productId,
          PricingParameters: { Quantities: qArr, Options: liv.options || [] },
          ItemName: kitName + ' — Livret',
          Notes: notesCommon
        }
      });
    }
  }

  // POCHETTE (inclut Mise en pochette + Pastilles via Quantities)
  if (qtyPochette > 0) {
    var poc = safeJsonParse(tr.dataset.presseroPochetteJson || '');
    if (poc && poc.productId) {
      var qArr2 = buildPresseroQuantitiesArray(poc, kitCtx, globalCtx);
      items.push({
        kind: 'pochette',
        itemBody: {
          ProductId: poc.productId,
          PricingParameters: { Quantities: qArr2, Options: poc.options || [] },
          ItemName: kitName + ' — Pochette',
          Notes: notesCommon
        }
      });
    }
  }

  // PATRON
  if (qtyPatron > 0) {
    var pat = safeJsonParse(tr.dataset.presseroPatronJson || '');
    if (pat && pat.productId) {
      var qArr3 = buildPresseroQuantitiesArray(pat, kitCtx, globalCtx);
      items.push({
        kind: 'patron',
        itemBody: {
          ProductId: pat.productId,
          PricingParameters: { Quantities: qArr3, Options: pat.options || [] },
          ItemName: kitName + ' — Patron',
          Notes: notesCommon
        }
      });
    }
  }

  if (!items.length) return null;

  var payload = {
    adminUrl: ctx.adminUrl,
    siteDomain: ctx.siteDomain,
    siteUserId: ctx.siteUserId,
    cartId: cartId,
    items: items
  };

  var r = await fetch(KITS_API_BASE_URL + '/admin/pressero/cart/add-bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  var j = await r.json();
  if (!r.ok || !j.ok) throw new Error('add-bundle failed: ' + JSON.stringify(j));
  console.log('[ZIP] upload response =', j);


  // hostItemId = livret > pochette > patron (côté serveur)
    // hostItemId = livret > pochette > patron (côté serveur)
  tr.dataset.cartHostItemId = j.hostItemId || '';
  tr.dataset.cartId = j.cartId || cartId;

  // ✅ NOUVEAU : premier item du bundle (ordre = items[] envoyés)
  var first = '';
  if (j && Array.isArray(j.added)) {
    var found = j.added.find(function(x){ return x && x.itemId; });
    if (found) first = found.itemId;
  }
  if (!first) first = j.hostItemId || '';

  j.firstItemId = first;
  tr.dataset.cartFirstItemId = first;

  return j;

}

async function checkZipOnItem(itemId) {
  var ctx = getPresseroContext();

  var r = await fetch(KITS_API_BASE_URL + '/admin/pressero/cart/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adminUrl: ctx.adminUrl,
      siteDomain: ctx.siteDomain,
      siteUserId: ctx.siteUserId
    })
  });

  var j = await r.json();
  if (!r.ok || !j.ok) throw new Error('cart/get failed: ' + JSON.stringify(j));

  var cart = j.raw;
  var item = (cart.Items || []).find(function(x){
    return String(x.ItemId) === String(itemId);
  });

  if (!item) throw new Error('Item not found in cart: ' + itemId);

  var zip = (item.Uploads || []).find(function(u){
    return ((u && u.Name) ? String(u.Name).toLowerCase() : '').endsWith('.zip');
  });

  return {
    hasZip: !!zip,
    zipName: zip ? zip.Name : null,
    zipUrl: zip ? zip.Url : null,
    uploads: item.Uploads || []
  };
}



async function uploadZipOnce(cartId, hostItemId, file) {
  var ctx = getPresseroContext();

  var fd = new FormData();
  fd.append('adminUrl', ctx.adminUrl);
  fd.append('siteDomain', ctx.siteDomain);
  fd.append('siteUserId', ctx.siteUserId);
  fd.append('cartId', cartId);
  fd.append('cartItemId', hostItemId);
  fd.append('file', file);

  var r = await fetch(KITS_API_BASE_URL + '/admin/pressero/cart/item-file', {
    method: 'POST',
    body: fd
  });

  var j = await r.json();
  if (!r.ok || !j.ok) throw new Error('upload zip failed: ' + JSON.stringify(j));
  return j;
}
async function uploadFileOnce(cartId, cartItemId, blobOrFile, filename) {
  var ctx = getPresseroContext();

  var fd = new FormData();
  fd.append('adminUrl', ctx.adminUrl);
  fd.append('siteDomain', ctx.siteDomain);
  fd.append('siteUserId', ctx.siteUserId);
  fd.append('cartId', cartId);
  fd.append('cartItemId', cartItemId);

  // ✅ permet d’uploader un Blob en lui donnant un nom de fichier
  fd.append('file', blobOrFile, filename || (blobOrFile && blobOrFile.name) || 'file.bin');

  var r = await fetch(KITS_API_BASE_URL + '/admin/pressero/cart/item-file', {
    method: 'POST',
    body: fd
  });

  var j = await r.json();
  if (!r.ok || !j.ok) throw new Error('upload file failed: ' + JSON.stringify(j));
  return j;
}


function initSendToCartButton() {
  // ✅ accepte les 2 IDs (ancien + nouveau)
  var btn =
    document.getElementById('kitsSendBtn') ||
    document.getElementById('kitsSendToOrder');

  if (!btn) return;

  // évite double-binding
  if (btn.dataset.boundCart === '1') return;
  btn.dataset.boundCart = '1';

  btn.addEventListener('click', async function (e) {
    e.preventDefault();

    clearError();

    if (!checkMinQuantities()) return;
    if (!checkFilesIfNeeded()) return;

    btn.disabled = true;
    var oldText = btn.textContent;
    btn.textContent = 'Ajout au panier…';

    try {
      // 1) get cart
      var ctx = getPresseroContext();

      var cartRes = await fetch(KITS_API_BASE_URL + '/admin/pressero/cart/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUrl: ctx.adminUrl, siteDomain: ctx.siteDomain, siteUserId: ctx.siteUserId })
      });

      var cartJson = await cartRes.json();
      if (!cartRes.ok || !cartJson.ok) {
        throw new Error('cart/get failed: ' + JSON.stringify(cartJson));
      }

      var cartId = cartJson.raw && cartJson.raw.Id ? cartJson.raw.Id : null;
      if (!cartId) throw new Error('cartId introuvable');

      // 2) add bundles
            var rows = Array.from(document.querySelectorAll('tr[data-kit-row]'));
      var comment = (document.getElementById('kitsComment')?.value || '').trim();

      var zipFile = getZipFile ? getZipFile() : null;
      var zipName = zipFile ? zipFile.name : '';

      var hasUpdate = hasUpdateRequest();
      var firstHostItemId = null;
      var updatesSummary = [];
      var firstItemForPdf = null; // ✅ premier item ajouté (peu importe MAJ fichier)


      for (var i = 0; i < rows.length; i++) {
        var tr = rows[i];

        var kitName =
          (tr.querySelector('.kc-kit-name')?.textContent || 'Kit').trim();

        var updateSel = tr.querySelector('.kc-update-select');
        var updateYes = updateSel && isYesValue(updateSel.value);

        var notes = 'Kit: ' + kitName + ' | MAJ fichier: ' + (updateYes ? 'OUI' : 'NON');
        if (updateYes && zipName) notes += ' | Fichier chargé : "' + zipName + '"';
        if (comment) notes += ' | Commentaire: ' + comment;


        var bundle = await addBundleForRow(cartId, tr, kitName, notes);
        if (bundle && !firstItemForPdf) {
  var idPdf = bundle.firstItemId || bundle.hostItemId || '';
  if (idPdf) firstItemForPdf = idPdf;
}


        if (updateYes && bundle && !firstHostItemId) {
  var id = bundle.firstItemId || bundle.hostItemId || '';
  if (id) firstHostItemId = id;
}

        if (updateYes) updatesSummary.push(kitName);
      }
      // ✅ Générer + injecter le PDF résumé production (une seule fois, après avoir ajouté tous les items)
if (firstItemForPdf) {
  var summary = buildProductionSummaryFromTable();

  // si aucun kit détecté, on n’uploade rien
  if (summary && summary.kits && Object.keys(summary.kits).length) {
    var email = getCurrentCustomerEmail() || '';

    var pdfRes = await fetch(KITS_API_BASE_URL + '/admin/pressero/summary-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kits: summary.kits,
        totals: summary.totals,
        orderInfo: {
          orderNumber: 'N/A',
          customerName: email || 'N/A',
          date: new Date().toLocaleDateString('fr-FR')
        }
      })
    });

    if (!pdfRes.ok) {
      var txt = '';
      try { txt = await pdfRes.text(); } catch(e) {}
      throw new Error('summary-pdf failed HTTP ' + pdfRes.status + (txt ? ' ' + txt : ''));
    }

    var pdfBlob = await pdfRes.blob();

    // upload sur le 1er item ajouté au panier
    await uploadFileOnce(cartId, firstItemForPdf, pdfBlob, 'resume-production.pdf');
  }
}


      // 3) upload ZIP (une seule fois sur l’item hôte)
      if (hasUpdate) {
        var f = document.getElementById('kitsZipInput')?.files?.[0];
        if (!f) throw new Error('ZIP manquant');
        if (!firstHostItemId) throw new Error('Impossible de déterminer l’item hôte (aucun item ajouté).');

        console.log('[ZIP] upload sur item =', firstHostItemId);

        await uploadZipOnce(cartId, firstHostItemId, f);

        var check = await checkZipOnItem(firstHostItemId);
        if (!check.hasZip) {
  throw new Error("Le ZIP n'apparaît pas dans Uploads de l'item après upload.");
}
        console.log('[ZIP] attached ?', check.hasZip, 'name=', check.zipName, 'url=', check.zipUrl);


      }

      // 4) rediriger vers le panier
      window.location.href = '/cart';

    } catch (err) {
      console.error('[CART] send failed', err);
      showError('<p>Erreur lors de l’ajout au panier :<br><strong>' + String(err.message || err) + '</strong></p>');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });
}



// ==== BOOT UNIQUE (page) ====

function waitForCustomerEmail(maxMs, cb) {
  var t0 = Date.now();

  (function tick(){
    var email = getCurrentCustomerEmail();
    if (email) return cb(null, email);

    if (Date.now() - t0 > maxMs) return cb(new Error('timeout email'), '');
    setTimeout(tick, 120);
  })();
}

function bootKitsPage() {
  // init UI (si ces fonctions existent dans ton script)
  if (typeof initBottomToggle === 'function') initBottomToggle();
  if (typeof initZipUploadUi === 'function') initZipUploadUi();
  if (typeof initSendToCartButton === 'function') initSendToCartButton();

  // attendre que Pressero ait bien injecté le header (#correo)
  waitForCustomerEmail(4000, function(err, email){
    if (err) {
      console.warn('[KITS] Email introuvable après attente, arrêt.');
      return;
    }
    console.log('[KITS] Email détecté:', email);
    loadKitsFromApiOnce(); // ton loader actuel
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootKitsPage);
} else {
  bootKitsPage();
}




    function checkFilesIfNeeded() {
  if (!hasUpdateRequest()) return true;

  var f = getZipFile();
  if (!f) {
    showError("Vous avez demandé des mises à jour de fichiers mais aucun fichier n'a été chargé.");
    // optionnel: focus / ouvrir le panneau
    return false;
  }

  // zip only (tu m’as confirmé zip uniquement)
  if (!/\.zip$/i.test(f.name || '')) {
    showError("Veuillez charger un fichier .zip uniquement.");
    return false;
  }

  return true;
}


    
    updateUploadUiFromSlots();

    
})();
</script>

<!-- END SCRIPT FRONT PAGE MES-KITS -->