/* ==========================================================================
   ROUTFLEET APP CORE LOGIC
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Inject keyframe animation for custom pulsing markers + marker label styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes markerPulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    .marker-label {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.85);
      color: #f8fafc;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 9px;
      font-weight: 700;
      line-height: 1.35;
      white-space: nowrap;
      padding: 3px 6px;
      border-radius: 4px;
      pointer-events: none;
      text-align: center;
      box-shadow: 0 2px 6px rgba(0,0,0,0.55);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .marker-label-sub {
      display: block;
      font-size: 8px;
      font-weight: 500;
      opacity: 0.75;
      margin-top: 1px;
    }
    .marker-label::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 4px solid transparent;
      border-top-color: rgba(15, 23, 42, 0.82);
    }
    body.light-theme .marker-label {
      background: rgba(255, 255, 255, 0.92);
      color: #0f172a;
      border-color: rgba(0,0,0,0.08);
    }
    body.light-theme .marker-label::after {
      border-top-color: rgba(255, 255, 255, 0.92);
    }
    .custom-map-marker {
      overflow: visible !important;
    }
  `;
  document.head.appendChild(style);

  // --------------------------------------------------------------------------
  // 1. Application State
  // --------------------------------------------------------------------------
  const state = {
    passengers: [],       // Loaded passenger list
    markers: {},          // Leaflet marker instances keyed by passenger id
    isGeocoding: false,   // Processing state
    cancelRequested: false, // Queue cancel flag
    theme: 'dark',        // Active theme
    currentActiveId: null, // Active passenger ID
    activeFilter: 'all',   // Active status filter ('all', 'success', 'partial', 'error')
    vehicles: [],         // Structured vehicle routes
    activeTab: 'passengers', // Active tab ('passengers', 'vehicles')
    vehicleRouteLayers: [] // Layer references for rendering VRP routes on map
  };

  // --------------------------------------------------------------------------
  // 2. DOM Elements
  // --------------------------------------------------------------------------
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('csv-file-input');
  const btnDownloadSample = document.getElementById('btn-download-sample');
  const progressContainer = document.getElementById('progress-container');
  const progressText = document.getElementById('progress-text');
  const progressPercent = document.getElementById('progress-percent');
  const progressBar = document.getElementById('progress-bar');
  const btnCancelGeocoding = document.getElementById('btn-cancel-geocoding');
  const passengersList = document.getElementById('passengers-list');
  const emptyState = document.getElementById('empty-state');
  const searchInput = document.getElementById('search-input');
  const countTotal = document.getElementById('count-total');
  const statsBadge = document.getElementById('stats-badge');
  const toastContainer = document.getElementById('toast-container');
  const filterGroup = document.getElementById('filter-group');
  const filterButtons = document.querySelectorAll('.filter-btn');

  // VRP DOM elements
  const btnOptimizeRoutes = document.getElementById('btn-optimize-routes');
  const btnTabVehicles = document.getElementById('btn-tab-vehicles');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const passengersTabContent = document.getElementById('passengers-tab-content');
  const vehiclesTabContent = document.getElementById('vehicles-tab-content');
  const vehiclesList = document.getElementById('vehicles-list');

  // Floating Map Overlays
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const themeIconLight = document.getElementById('theme-icon-light');
  const themeIconDark = document.getElementById('theme-icon-dark');
  const btnRecenter = document.getElementById('btn-recenter');
  const btnClear = document.getElementById('btn-clear');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnClearAllSidebar = document.getElementById('btn-clear-all-sidebar');

  // Confirmation Modal Elements
  const resetConfirmModal = document.getElementById('reset-confirm-modal');
  const resetConfirmCode = document.getElementById('reset-confirm-code');
  const resetCodeInput = document.getElementById('reset-code-input');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalConfirm = document.getElementById('btn-modal-confirm');

  // Cache Prefix
  const CACHE_PREFIX = 'routefleet_geocode_';

  // --------------------------------------------------------------------------
  // 3. Map Initialization (Leaflet)
  // --------------------------------------------------------------------------
  const defaultCenter = [-14.2350, -51.9253]; // Brazil Center
  const defaultZoom = 4;

  const map = L.map('map', {
    zoomControl: true
  }).setView(defaultCenter, defaultZoom);

  // Map Tile Layers
  const tiles = {
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    })
  };

  // Add default theme tiles (dark)
  tiles.dark.addTo(map);

  // Custom Icon Factory based on passenger status
  function getCustomMarkerIcon(status, labelData) {
    let color = 'var(--accent-color)'; // Default (pending/loading)
    if (status === 'success') color = 'var(--color-success)';
    if (status === 'cache') color = 'var(--color-info)';
    if (status === 'error') color = 'var(--color-danger)';

    const labelHtml = labelData
      ? `<div class="marker-label">${labelData.name}<span class="marker-label-sub">${labelData.sub}</span></div>`
      : '';


    return L.divIcon({
      className: 'custom-map-marker',
      html: `
        <div style="
          width: 16px;
          height: 16px;
          background-color: ${color};
          border: 2.5px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 2px 5px rgba(0,0,0,0.4);
          cursor: pointer;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          ${labelHtml}
          <div style="
            position: absolute;
            top: -2.5px;
            left: -2.5px;
            width: 16px;
            height: 16px;
            border: 2px solid ${color};
            border-radius: 50%;
            animation: markerPulse 1.8s infinite ease-out;
            opacity: 0.6;
            pointer-events: none;
          "></div>
        </div>
      `,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -10]
    });
  }

  // Custom Icon Factory for Origin/Destination route markers
  function getRouteMarkerIcon(type, status, labelData) {
    let color = 'var(--accent-color)'; // Default
    if (status === 'error') {
      color = 'var(--color-danger)';
    } else {
      color = type === 'origin' ? 'var(--color-info)' : 'var(--color-warning)';
    }

    const label = type === 'origin' ? 'O' : 'D';

    const labelHtml = labelData
      ? `<div class="marker-label">${labelData.name}<span class="marker-label-sub">${labelData.sub}</span></div>`
      : '';

    return L.divIcon({
      className: 'custom-map-marker',
      html: `
        <div style="
          width: 22px;
          height: 22px;
          background-color: ${color};
          border: 2px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 2px 5px rgba(0,0,0,0.4);
          cursor: pointer;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 800;
          color: #ffffff;
        ">
          ${label}
          ${labelHtml}
          <div style="
            position: absolute;
            top: -2px;
            left: -2px;
            width: 22px;
            height: 22px;
            border: 2px solid ${color};
            border-radius: 50%;
            animation: markerPulse 1.8s infinite ease-out;
            opacity: 0.6;
            pointer-events: none;
          "></div>
        </div>
      `,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -12]
    });
  }

  // --------------------------------------------------------------------------
  // 4. UI helper: Toasts Notification
  // --------------------------------------------------------------------------
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle-2';
    if (type === 'error') iconName = 'alert-triangle';

    toast.innerHTML = `
      <i data-lucide="${iconName}" class="toast-icon"></i>
      <span>${message}</span>
    `;

    toastContainer.appendChild(toast);
    lucide.createIcons(); // Initialize the lucide icon inside the toast

    // Auto remove toast after duration
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 4000);
  }

  // Initialize Lucide Icons initially
  lucide.createIcons();

  // --------------------------------------------------------------------------
  // 5. CSV Parsing & Upload Handlers
  // --------------------------------------------------------------------------

  // Click dropzone to open browser selection
  dropzone.addEventListener('click', () => {
    if (state.isGeocoding) {
      showToast('Aguarde o processamento atual finalizar ou cancele-o.', 'error');
      return;
    }
    fileInput.click();
  });

  // Drag over effects
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');

    if (state.isGeocoding) {
      showToast('Aguarde o processamento atual finalizar.', 'error');
      return;
    }

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleUploadedFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleUploadedFile(e.target.files[0]);
      e.target.value = ''; // Reset para permitir re-upload do mesmo arquivo
    }
  });

  // Helper to build a complete address string from components
  function buildAddress(street, number, neighborhood, city, stateCode) {
    const parts = [];

    let streetPart = (street || '').toString().trim();
    if (streetPart) {
      const num = (number || '').toString().trim();
      if (num && num.toLowerCase() !== 's/n' && num.toLowerCase() !== 'sn') {
        streetPart += `, ${num}`;
      } else if (num) {
        streetPart += ` - ${num}`;
      }
      parts.push(streetPart);
    }

    const neigh = (neighborhood || '').toString().trim();
    if (neigh) {
      parts.push(neigh);
    }

    const c = (city || '').toString().trim();
    const st = (stateCode || '').toString().trim();
    if (c && st) {
      parts.push(`${c} - ${st}`);
    } else {
      if (c) parts.push(c);
      if (st) parts.push(st);
    }

    return parts.join(', ');
  }

  // ─── Address abbreviation expansion & contraction maps ────────────────────
  const ABBREV_EXPAND = {
    // Logradouros
    '^r\.\s+': 'Rua ',
    '^r\s+': 'Rua ',
    '^av\.\s+': 'Avenida ',
    '^av\s+': 'Avenida ',
    '^rod\.\s+': 'Rodovia ',
    '^rod\s+': 'Rodovia ',
    '^al\.\s+': 'Alameda ',
    '^al\s+': 'Alameda ',
    '^trav\.\s+': 'Travessa ',
    '^trv\.\s+': 'Travessa ',
    '^pça\.\s+': 'Praça ',
    '^pça\s+': 'Praça ',
    '^est\.\s+': 'Estrada ',
    '^pc\.\s+': 'Praça ',
    '^vl\.\s+': 'Vila ',
    '^vl\s+': 'Vila ',
    '^tv\.\s+': 'Travessa ',
    '^tv\s+': 'Travessa ',
  };

  const ABBREV_CONTRACT = [
    { from: /^Avenida\s+/i, to: 'Av. ' },
    { from: /^Rodovia\s+/i, to: 'Rod. ' },
    { from: /^Alameda\s+/i, to: 'Al. ' },
    { from: /^Travessa\s+/i, to: 'Trav. ' },
    { from: /^Praça\s+/i, to: 'Pça. ' },
    { from: /^Estrada\s+/i, to: 'Est. ' },
    { from: /^Rua\s+/i, to: 'R. ' },
  ];

  // Common Brazilian typo/spelling variant corrections
  const SPELLING_CORRECTIONS = [
    { from: /\bWilly\b/gi, to: 'Willi' },
    { from: /\bDon\b/g, to: 'Dom' },
    { from: /\bFilhos\b/gi, to: 'Filho' },
    { from: /\bSaint\b/gi, to: 'São' },
    { from: /\bSta\.\s+/gi, to: 'Santa ' },
    { from: /\bSto\.\s+/gi, to: 'Santo ' },
    { from: /\bDr\.\s+/gi, to: 'Doutor ' },
    { from: /\bCel\.\s+/gi, to: 'Coronel ' },
    { from: /\bCap\.\s+/gi, to: 'Capitão ' },
    { from: /\bGal\.\s+/gi, to: 'General ' },
    { from: /\bPres\.\s+/gi, to: 'Presidente ' },
    { from: /\bProf\.\s+/gi, to: 'Professor ' },
    { from: /\bEng\.\s+/gi, to: 'Engenheiro ' },
    { from: /\bMaj\.\s+/gi, to: 'Major ' },
    { from: /\bTen\.\s+/gi, to: 'Tenente ' },
  ];

  // Strip diacritics/accents for plain-ASCII variant queries
  function removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Expand known street abbreviations at the start of a string
  function expandAbbreviations(str) {
    for (const [pattern, replacement] of Object.entries(ABBREV_EXPAND)) {
      const re = new RegExp(pattern, 'i');
      if (re.test(str)) {
        return str.replace(re, replacement);
      }
    }
    return str;
  }

  // Contract full street type words to abbreviations
  function contractAbbreviations(str) {
    for (const { from, to } of ABBREV_CONTRACT) {
      if (from.test(str)) {
        return str.replace(from, to);
      }
    }
    return str;
  }

  // Apply common spelling corrections
  function applySpellingCorrections(str) {
    let result = str;
    let changed = false;
    for (const { from, to } of SPELLING_CORRECTIONS) {
      const replaced = result.replace(from, to);
      if (replaced !== result) { changed = true; result = replaced; }
    }
    return { result, changed };
  }

  // Helper to clean up company names and number ranges from address strings to optimize Nominatim matching
  function cleanAddressText(addr) {
    if (!addr) return '';
    let clean = addr.trim();

    // 1. Remove company/facility prefix if present before the street keyword
    const streetPrefixPats = ['av\.', 'av\b', 'avenida\b', 'rua\b', 'r\.', 'r\b', 'rod\.', 'rod\b', 'rodovia\b', 'alameda\b', 'al\.', 'al\b', 'travessa\b', 'trav\.', 'trv\.', 'praça\b', 'praca\b', 'pça\.', 'pça\b', 'estrada\b', 'est\.', 'viela\b', 'servidão\b', 'servidao\b'];
    const prefixRegex = new RegExp(`^(.+?)\\s*(?:-\\s*|\\s+)\\b(${streetPrefixPats.join('|')})\\b`, 'i');

    const match = clean.match(prefixRegex);
    if (match) {
      const prefix = match[1].toLowerCase().trim();
      const hasStreetWord = streetPrefixPats.some(p => new RegExp(`^${p}`, 'i').test(prefix));
      if (!hasStreetWord) {
        const keywordIndex = clean.toLowerCase().indexOf(match[2].toLowerCase());
        if (keywordIndex > 0) {
          clean = clean.substring(keywordIndex).trim();
        }
      }
    }

    // 2. Clean number ranges: "6132/6344" -> "6132" or "6132-6344" -> "6132"
    clean = clean.replace(/(\d+)\s*[\/]\s*\d+/g, '$1');

    return clean;
  }

  // Generates fallback address formats to query if the primary address is not found in OpenStreetMap
  function generateAddressFallbacks(address) {
    const cleaned = cleanAddressText(address);
    const seen = new Set();
    const addUnique = (q) => { const t = q.trim(); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); queries.push(t); } };
    const queries = [];

    addUnique(cleaned);
    if (cleaned !== address) addUnique(address);

    const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) return queries;

    const streetPart = parts[0];
    const lastPart = parts[parts.length - 1]; // "City - State" or similar

    // ── A. Try expanding abbreviations in the street part ──────────────────
    const streetExpanded = expandAbbreviations(streetPart);
    if (streetExpanded !== streetPart) {
      const pExpanded = [...parts];
      pExpanded[0] = streetExpanded;
      addUnique(pExpanded.join(', '));
      addUnique(`${streetExpanded}, ${lastPart}`);
    }

    // ── B. Try contracting full words to abbreviations ─────────────────────
    const streetContracted = contractAbbreviations(streetPart);
    if (streetContracted !== streetPart) {
      const pContracted = [...parts];
      pContracted[0] = streetContracted;
      addUnique(pContracted.join(', '));
      addUnique(`${streetContracted}, ${lastPart}`);
    }

    // ── C. Remove the number ───────────────────────────────────────────────
    const numberIdx = parts.findIndex(p => /^\d+$/.test(p) || /^s\/n$/i.test(p));
    let partsNoNumber = [...parts];
    if (numberIdx !== -1) {
      partsNoNumber.splice(numberIdx, 1);
      if (partsNoNumber.length >= 2) addUnique(partsNoNumber.join(', '));
    }

    // ── D. Strip prepositions (dos, da, do, das, de, d') ──────────────────
    const baseStreet = streetExpanded !== streetPart ? streetExpanded : streetPart;
    let streetNoPrep = baseStreet
      .replace(/\b(dos|das|do|da|de|d')\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (streetNoPrep !== baseStreet) {
      const pNoPrep = [...parts];
      pNoPrep[0] = streetNoPrep;
      addUnique(pNoPrep.join(', '));
      addUnique(`${streetNoPrep}, ${lastPart}`);
      // Also try without number
      if (partsNoNumber.length >= 2) {
        const pNoPrepNoNum = [...partsNoNumber];
        pNoPrepNoNum[0] = streetNoPrep;
        addUnique(pNoPrepNoNum.join(', '));
      }
    }

    // ── E. Apply spelling corrections ────────────────────────────────────
    const { result: spellingFixed, changed: hasSpelling } = applySpellingCorrections(streetNoPrep);
    if (hasSpelling) {
      const pSpell = [...parts];
      pSpell[0] = spellingFixed;
      addUnique(pSpell.join(', '));
      addUnique(`${spellingFixed}, ${lastPart}`);
    }
    // Also apply corrections on original street
    const { result: spellOrig, changed: hasSpellOrig } = applySpellingCorrections(streetPart);
    if (hasSpellOrig) {
      const pSpellO = [...parts];
      pSpellO[0] = spellOrig;
      addUnique(pSpellO.join(', '));
    }

    // ── F. Remove middle names (for long person-named streets) ────────────
    const STREET_TYPE_RE = /^(av\.|av|avenida|rua|r\.|rod\.|rod|rodovia|alameda|al\.|al|travessa|trav\.|trv\.|praça|praca|pça\.|pça|estrada|est\.|viela|servidão|servidao|vila|vl\.)\s*/i;
    const prefixMatch = streetNoPrep.match(STREET_TYPE_RE);
    const streetPrefix = prefixMatch ? prefixMatch[0] : '';
    const nameOnly = streetNoPrep.replace(STREET_TYPE_RE, '');
    const nameWords = nameOnly.split(/\s+/).filter(Boolean);
    if (nameWords.length >= 3) {
      // Try first + last word only
      addUnique(`${streetPrefix}${nameWords[0]} ${nameWords[nameWords.length - 1]}, ${lastPart}`);
      // Try first two words
      addUnique(`${streetPrefix}${nameWords[0]} ${nameWords[1]}, ${lastPart}`);
    }

    // ── G. ASCII (no diacritics) fallback ────────────────────────────────
    const asciiCleaned = removeDiacritics(cleaned);
    if (asciiCleaned !== cleaned) addUnique(asciiCleaned);
    const asciiNoPrep = removeDiacritics(streetNoPrep ? `${streetNoPrep}, ${lastPart}` : '');
    if (asciiNoPrep && asciiNoPrep !== cleaned) addUnique(asciiNoPrep);

    // ── H. Final simple fallback "Street, City - State" ──────────────────
    if (streetPart !== lastPart) addUnique(`${streetPart}, ${lastPart}`);

    return queries;
  }

  // Main file processor supporting Excel and CSV formats
  function handleUploadedFile(file) {
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') {
        showToast('Biblioteca SheetJS (Excel) não foi carregada. Verifique sua conexão.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });
          processParsedData(jsonData);
        } catch (err) {
          showToast('Erro ao processar a planilha Excel.', 'error');
          console.error(err);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (fileName.endsWith('.csv')) {
      // Use SheetJS for CSV parsing if available, otherwise fallback to PapaParse
      if (typeof XLSX !== 'undefined') {
        const reader = new FileReader();
        reader.onload = function (e) {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });
            processParsedData(jsonData);
          } catch (err) {
            showToast('Erro ao processar o arquivo CSV via SheetJS.', 'error');
            console.error(err);
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (typeof Papa !== 'undefined') {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: function (results) {
            processParsedData(results.data);
          },
          error: function (err) {
            showToast('Erro ao ler o arquivo CSV. Verifique a formatação.', 'error');
            console.error(err);
          }
        });
      } else {
        showToast('Nenhuma biblioteca de leitura carregada. Verifique sua conexão.', 'error');
      }
    } else {
      showToast('Formato de arquivo não suportado. Use Excel (.xlsx, .xls) ou CSV.', 'error');
    }
  }

  // Extract keys and build passengers state
  function processParsedData(data) {
    if (data.length === 0) {
      showToast('O arquivo enviado está vazio.', 'error');
      return;
    }

    const firstRow = data[0];
    const columns = Object.keys(firstRow);

    const findCol = (possibleNames) => {
      return columns.find(col => possibleNames.includes(col.toLowerCase().trim()));
    };

    // Try to match Route columns
    const passengerNameCol = findCol(['nome passageiro', 'passageiro', 'nome', 'passenger', 'name']);
    const addrOrigCol = findCol(['endereco origem', 'endereço origem', 'origem endereco', 'origem endereço', 'address origin', 'origin address']);
    const numOrigCol = findCol(['nº origem', 'n origem', 'numero origem', 'número origem', 'num origem', 'origin number']);
    const bairroOrigCol = findCol(['bairro origem', 'origem bairro', 'neighborhood origin', 'origin neighborhood']);
    const munOrigCol = findCol(['municipio origem', 'município origem', 'cidade origem', 'city origin', 'origin city']);
    const ufOrigCol = findCol(['uf origem', 'estado origem', 'state origin', 'origin state']);

    const addrDestCol = findCol(['endereco destino', 'endereço destino', 'destino endereco', 'destino endereço', 'address destination', 'destination address']);
    const numDestCol = findCol(['nº destino', 'n destino', 'numero destino', 'número destino', 'num destino', 'destination number']);
    const bairroDestCol = findCol(['bairro destino', 'destino bairro', 'neighborhood destination', 'destination neighborhood']);
    const munDestCol = findCol(['municipio destino', 'município destino', 'cidade destino', 'city destination', 'destination city']);
    const ufDestCol = findCol(['uf destino', 'estado destino', 'state destination', 'destination state']);

    // Standard Single point column
    const simpleAddressCol = findCol(['endereco', 'endereço', 'address', 'local', 'localizacao', 'localização']);

    const isRouteMode = !!(addrOrigCol || addrDestCol);

    if (!passengerNameCol || (!isRouteMode && !simpleAddressCol)) {
      showToast('Colunas inválidas no arquivo carregado.', 'error');
      return;
    }

    // Reset previous dataset state (map clean, markers, list)
    clearAllData();

    const skipped = [];
    const validPassengers = [];

    data.forEach((row, idx) => {
      const name = row[passengerNameCol]?.toString().trim() || "";
      const rowNum = idx + 2; // Consideration for header row and 1-based indexing

      // Validação do Nome
      if (!name) {
        skipped.push({ row: rowNum, reason: 'Nome do Passageiro ausente' });
        return;
      }
      
      if (isRouteMode) {
        // Raw components for structured Nominatim queries
        const origStreet = (row[addrOrigCol] || '').toString().trim();
        const origNum    = (row[numOrigCol]  || '').toString().trim();
        const origNeigh  = (row[bairroOrigCol] || '').toString().trim();
        const origCity   = (row[munOrigCol]  || '').toString().trim();
        const origState  = (row[ufOrigCol]   || '').toString().trim();

        const destStreet = (row[addrDestCol] || '').toString().trim();
        const destNum    = (row[numDestCol]  || '').toString().trim();
        const destNeigh  = (row[bairroDestCol] || '').toString().trim();
        const destCity   = (row[munDestCol]  || '').toString().trim();
        const destState  = (row[ufDestCol]   || '').toString().trim();

        // Validação campos obrigatórios Route Mode
        const missing = [];
        if (!origStreet) missing.push('Endereço Origem');
        if (!origNum)    missing.push('Nº Origem');
        if (!origNeigh)  missing.push('Bairro Origem');
        if (!origCity)   missing.push('Municipio Origem');
        if (!origState)  missing.push('UF Origem');
        if (!destStreet) missing.push('Endereço Destino');
        if (!destNum)    missing.push('Nº Destino');
        if (!destNeigh)  missing.push('Bairro Destino');
        if (!destCity)   missing.push('Municipio Destino');
        if (!destState)  missing.push('UF Destino');

        if (missing.length > 0) {
          skipped.push({ row: rowNum, name: name, reason: `Campos obrigatórios vazios: ${missing.join(', ')}` });
          return;
        }

        const originAddress = buildAddress(origStreet, origNum, origNeigh, origCity, origState);
        const destAddress   = buildAddress(destStreet, destNum, destNeigh, destCity, destState);

        validPassengers.push({
          id: `p-${idx}-${Date.now()}`,
          name: name,
          mode: 'route',
          originAddress: originAddress,
          destAddress: destAddress,
          orig: { street: origStreet, num: origNum, neigh: origNeigh, city: origCity, state: origState },
          dest: { street: destStreet, num: destNum, neigh: destNeigh, city: destCity, state: destState },
          lat_origin: null,
          lng_origin: null,
          lat_dest: null,
          lng_dest: null,
          status: 'pending',
          status_origin: 'pending',
          status_dest: 'pending',
          source: null,
          _rawRow: row
        });
      } else {
        const address = row[simpleAddressCol]?.toString().trim() || '';
        if (!address) {
          skipped.push({ row: rowNum, name: name, reason: 'Endereço não identificado' });
          return;
        }
        validPassengers.push({
          id: `p-${idx}-${Date.now()}`,
          name: name,
          mode: 'single',
          address: address,
          lat: null,
          lng: null,
          status: 'pending',
          source: null,
          _rawRow: row
        });
      }
    });

    state.passengers = validPassengers;

    // Reportar linhas ignoradas
    if (skipped.length > 0) {
      console.warn('[RouteFleet] Linhas ignoradas na importação:', skipped);
      const totalSkipped = skipped.length;
      if (state.passengers.length === 0) {
        const first = skipped[0];
        showToast(`Falha: ${totalSkipped} linha(s) inválida(s). Ex: Linha ${first.row} - ${first.reason}`, 'error');
        return;
      } else {
        showToast(`${totalSkipped} linha(s) ignorada(s). Ex: Linha ${skipped[0].row} - ${skipped[0].reason}`, 'error');
      }
    }

    if (state.passengers.length === 0) {
      showToast('Nenhum passageiro com endereço válido encontrado.', 'error');
      return;
    }

    showToast(`${state.passengers.length} passageiros carregados. Iniciando geocodificação...`, 'success');

    // Update count displays
    countTotal.textContent = state.passengers.length;
    searchInput.disabled = false;
    filterGroup.classList.remove('disabled');
    btnRecenter.disabled = false;
    btnClear.disabled = false;

    // Render list initial status
    renderPassengersList();

    // Start geocoding queue
    startGeocodingQueue();
  }

  // --------------------------------------------------------------------------
  // 6. Geocoding Queue & rate limit handler
  // --------------------------------------------------------------------------
  // API rate limit helper to ensure we never query Nominatim faster than once per 1.2s
  let lastApiCallTime = 0;
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function rateLimitApi() {
    const now = Date.now();
    const elapsed = now - lastApiCallTime;
    if (elapsed < 1200) {
      await delay(1200 - elapsed);
    }
    lastApiCallTime = Date.now();
  }

  async function startGeocodingQueue() {
    state.isGeocoding = true;
    state.cancelRequested = false;

    progressContainer.classList.remove('hidden');
    dropzone.style.pointerEvents = 'none';
    dropzone.style.opacity = '0.6';

    const total = state.passengers.length;

    // Helper to fetch a single Nominatim URL and return coords or null
    async function fetchNominatim(url, expectedCity = null) {
      await rateLimitApi();
      try {
        const response = await fetch(url, {
          headers: {
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'User-Agent': 'RouteFleet-Passenger-Geocoder-Dashboard-App/1.0 (leonidas@routefleet.local)'
          }
        });
        if (response.ok) {
          const results = await response.json();
          if (results && results.length > 0) {
            const firstResult = results[0];

            // Validate municipality to avoid matching coordinates in a completely different city
            if (expectedCity) {
              const displayNorm = removeDiacritics(firstResult.display_name).toLowerCase().replace(/[^a-z0-9]/g, '');
              const expectedNorm = removeDiacritics(expectedCity).toLowerCase().replace(/[^a-z0-9]/g, '');
              if (!displayNorm.includes(expectedNorm)) {
                return { coords: null, reason: 'Divergência de município' };
              }
            }

            return {
              coords: {
                lat: parseFloat(firstResult.lat),
                lng: parseFloat(firstResult.lon),
                display_name: firstResult.display_name
              },
              reason: null
            };
          }
        }
      } catch (err) {
        console.error('Nominatim API error:', err);
      }
      return { coords: null, reason: 'Erro na API de mapas' };
    }

    // Build structured Nominatim query URLs from raw address components
    function buildStructuredUrls(components) {
      if (!components) return [];
      const { street, num, neigh, city, state } = components;
      if (!street || !city || !state) return [];

      const base = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br';

      // ── 1. Strip company/facility prefix from the street field ──────────────
      // e.g. "FORVIA - AV. RENATO MONTEIRO" → "AV. RENATO MONTEIRO"
      const STREET_PREFIX_RE = /^[^,]+?\s*[-–]\s*(?=(?:rua|r\.|av\.|avenida|rod\.|rodovia|alameda|al\.|travessa|trav\.|praça|praca|pça\.|estrada|est\.|viela|largo|beco|via\s|boulevard|quadra|qd\.)\s)/i;
      const streetClean = street.replace(STREET_PREFIX_RE, '').trim();

      // ── 2. Clean number ranges like "8132/6344" or "8132-6344" → "8132" ───
      const numClean = num ? num.replace(/(\d+)\s*[\/\-]\s*\d+/g, '$1').trim() : '';

      // Expand / contract abbreviations on the cleaned street
      const streetExpanded = expandAbbreviations(streetClean);
      const streetContracted = contractAbbreviations(streetClean);

      const makeUrl = (s, n, c, st, district) => {
        const cleanN = n && n.toLowerCase() !== 's/n' ? n.replace(/(\d+)\s*[\/\-]\s*\d+/g, '$1') : '';
        const streetQuery = cleanN ? `${s}, ${cleanN}` : s;
        let url = `${base}&street=${encodeURIComponent(streetQuery)}&city=${encodeURIComponent(c)}&state=${encodeURIComponent(st)}&country=Brazil`;
        if (district) url += `&district=${encodeURIComponent(district)}`;
        return url;
      };

      const urls = [];

      // Primary: expanded street + number + city + state
      urls.push(makeUrl(streetExpanded || streetClean, numClean, city, state));

      // With neighborhood
      if (neigh) urls.push(makeUrl(streetExpanded || streetClean, numClean, city, state, neigh));

      // Contracted form
      if (streetContracted !== streetClean) urls.push(makeUrl(streetContracted, numClean, city, state));

      // Original (before expansion)
      if (streetExpanded !== streetClean) urls.push(makeUrl(streetClean, numClean, city, state));

      // Without number (broader search)
      if (numClean) {
        urls.push(makeUrl(streetExpanded || streetClean, '', city, state));
      }

      // Spelling corrections
      const { result: spellStreet, changed } = applySpellingCorrections(streetExpanded || streetClean);
      if (changed) urls.push(makeUrl(spellStreet, numClean, city, state));

      // Strip prepositions (dos, da, do, das, de)
      const streetNoPrep = (streetExpanded || streetClean)
        .replace(/\b(dos|das|do|da|de|d')\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (streetNoPrep !== (streetExpanded || streetClean)) {
        urls.push(makeUrl(streetNoPrep, numClean, city, state));
      }

      return [...new Set(urls)];
    }

    // Returns true if the address string contains a recognizable street type prefix
    function hasStreetTypePrefix(addr) {
      // Comprehensive list of Brazilian logradouro types (full and abbreviated)
      const STREET_TYPES = [
        'rua', 'r\\.', '\\br\\b',
        'avenida', 'av\\.', '\\bav\\b',
        'rodovia', 'rod\\.', '\\brod\\b',
        'alameda', 'al\\.', '\\bal\\b',
        'travessa', 'trav\\.', 'trv\\.',
        'praça', 'praca', 'pça\\.', '\\bpça\\b',
        'estrada', 'est\\.',
        'viela',
        'servidão', 'servidao',
        'largo', 'lg\\.',
        'beco',
        'via',
        'boulevard', 'blvd\\.',
        'viaduto',
        'passagem',
        'distrito',
        'trecho',
        'setor',
        'quadra', '\\bqd\\b', '\\bq\\b',
        'condomínio', 'condominio', 'cond\\.',
        'vila', '\\bvl\\b'
      ];
      const pattern = new RegExp(`(?:^|\\s)(${STREET_TYPES.join('|')})(?:[\\s.,]|$)`, 'i');
      return pattern.test(addr.trim());
    }

    // Helper to get coordinates with local cache check and fallback logic
    async function getCoordsWithFallback(address, components) {
      if (!address) return { coords: null, reason: 'Endereço vazio' };

      // ── Validate street type ───────────────────────────────────────────────
      const streetToCheck = (components && components.street) ? components.street : address;
      if (!hasStreetTypePrefix(streetToCheck)) {
        return { coords: null, reason: 'Falta tipo de logradouro (Rua, Av, etc)' };
      }

      const expectedCity = (components && components.city) ? components.city : null;

      // Check original address cache
      const origCacheKey = CACHE_PREFIX + address.toLowerCase().trim();
      const origCached = localStorage.getItem(origCacheKey);
      if (origCached) {
        try {
          const coords = JSON.parse(origCached);
          if (coords && coords.display_name) {
            if (expectedCity) {
              const displayNorm = removeDiacritics(coords.display_name).toLowerCase().replace(/[^a-z0-9]/g, '');
              const expectedNorm = removeDiacritics(expectedCity).toLowerCase().replace(/[^a-z0-9]/g, '');
              if (displayNorm.includes(expectedNorm)) return { coords, reason: null };
            } else {
              return { coords, reason: null };
            }
          }
        } catch (e) { }
      }

      const queriesToTry = generateAddressFallbacks(address);
      const structuredUrls = buildStructuredUrls(components);
      let lastReason = 'Endereço não localizado no mapa';

      // 1. Try structured
      for (const url of structuredUrls) {
        const { coords, reason } = await fetchNominatim(url, expectedCity);
        if (coords) {
          localStorage.setItem(origCacheKey, JSON.stringify(coords));
          return { coords, reason: null };
        }
        if (reason) lastReason = reason;
      }

      // 2. Try fallbacks
      for (const query of queriesToTry) {
        const { coords, reason } = await fetchNominatim(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`,
          expectedCity
        );
        if (coords) {
          localStorage.setItem(origCacheKey, JSON.stringify(coords));
          return { coords, reason: null };
        }
        if (reason) lastReason = reason;
      }

      return { coords: null, reason: lastReason };
    }

    for (let i = 0; i < total; i++) {
      if (state.cancelRequested) {
        showToast('Processamento cancelado pelo usuário.', 'info');
        break;
      }

      const passenger = state.passengers[i];
      passenger.status = 'loading';
      updatePassengerItemUI(passenger);

      if (passenger.mode === 'route') {
        // 1. Geocode Origin Address
        if (passenger.originAddress) {
          updateProgressUI(i, total, `Geocodificando Origem de: "${passenger.name}"`);
          const { coords, reason } = await getCoordsWithFallback(passenger.originAddress, passenger.orig);
          if (coords) {
            passenger.lat_origin = coords.lat;
            passenger.lng_origin = coords.lng;
            passenger.status_origin = 'success';
            passenger.err_origin = null;
          } else {
            passenger.status_origin = 'error';
            passenger.err_origin = reason;
          }
        } else {
          passenger.status_origin = 'none';
        }

        if (state.cancelRequested) break;

        // 2. Geocode Destination Address
        if (passenger.destAddress) {
          updateProgressUI(i, total, `Geocodificando Destino de: "${passenger.name}"`);
          const { coords, reason } = await getCoordsWithFallback(passenger.destAddress, passenger.dest);
          if (coords) {
            passenger.lat_dest = coords.lat;
            passenger.lng_dest = coords.lng;
            passenger.status_dest = 'success';
            passenger.err_dest = null;
          } else {
            passenger.status_dest = 'error';
            passenger.err_dest = reason;
          }
        } else {
          passenger.status_dest = 'none';
        }

        // Aggregate overall status
        if (passenger.status_origin === 'success' && passenger.status_dest === 'success') {
          passenger.status = 'success';
        } else if (passenger.status_origin === 'success' || passenger.status_dest === 'success') {
          passenger.status = 'partial';
        } else {
          passenger.status = 'error';
        }
      } else {
        // Standard Single Point Mode
        updateProgressUI(i, total, `Geocodificando: "${passenger.name}"`);
        const { coords, reason } = await getCoordsWithFallback(passenger.address, null);
        if (coords) {
          passenger.lat = coords.lat;
          passenger.lng = coords.lng;
          passenger.status = 'success';
          passenger.err = null;
        } else {
          passenger.status = 'error';
          passenger.err = reason;
        }
      }

      addPassengerToMap(passenger);
      updatePassengerItemUI(passenger);
      updateStatsBadge();
    }

    // Queue Finished
    state.isGeocoding = false;
    progressContainer.classList.add('hidden');
    dropzone.style.pointerEvents = 'auto';
    dropzone.style.opacity = '1';

    fitMapBounds();
    updateStatsBadge();

    // Enable VRP button if there are successfully geocoded passengers
    const successfulCount = state.passengers.filter(p => p.status === 'success' || p.status === 'cache').length;
    if (successfulCount > 0) {
      btnOptimizeRoutes.classList.remove('disabled');
      btnOptimizeRoutes.disabled = false;
    }

    showToast('Processamento finalizado.', 'info');
  }

  // --------------------------------------------------------------------------
  // 7. Map Markers & Navigation Handlers
  // --------------------------------------------------------------------------
  function addPassengerToMap(passenger) {
    if (passenger.mode === 'route') {
      addRouteToMap(passenger);
    } else {
      addMarkerToMap(passenger);
    }
  }

  function addRouteToMap(passenger) {
    const layers = [];

    // Build label: full name on first line, neighborhood - city on second line
    function buildLabel(components, nameStr) {
      const name = (nameStr || '').trim();
      const neigh = (components && components.neigh) ? components.neigh.trim() : '';
      const city = (components && components.city) ? components.city.trim() : '';
      const sub = [neigh, city].filter(Boolean).join(' - ');
      return { name, sub };
    }

    // 1. Origin Marker
    if (passenger.lat_origin !== null && passenger.lng_origin !== null) {
      const originLabel = buildLabel(passenger.orig, passenger.name);
      const markerOrigin = L.marker([passenger.lat_origin, passenger.lng_origin], {
        icon: getRouteMarkerIcon('origin', passenger.status_origin, originLabel)
      });

      const popupContent = `
        <div class="map-popup">
          <div class="popup-title" style="color: var(--color-info); font-weight: bold;">Origem | ${passenger.name}</div>
          <div class="popup-address">
            <i data-lucide="home" class="popup-icon"></i>
            <span>${passenger.originAddress}</span>
          </div>
        </div>
      `;

      markerOrigin.bindPopup(popupContent);
      markerOrigin.addTo(map);
      markerOrigin.on('click', () => {
        focusPassengerItem(passenger.id, false);
      });
      markerOrigin.on('popupopen', () => {
        lucide.createIcons();
      });
      layers.push(markerOrigin);
    }

    // 2. Destination Marker
    if (passenger.lat_dest !== null && passenger.lng_dest !== null) {
      const destLabel = buildLabel(passenger.dest, passenger.name);
      const markerDest = L.marker([passenger.lat_dest, passenger.lng_dest], {
        icon: getRouteMarkerIcon('dest', passenger.status_dest, destLabel)
      });

      const popupContent = `
        <div class="map-popup">
          <div class="popup-title" style="color: var(--color-warning); font-weight: bold;">Destino | ${passenger.name}</div>
          <div class="popup-address">
            <i data-lucide="map-pin" class="popup-icon"></i>
            <span>${passenger.destAddress}</span>
          </div>
        </div>
      `;

      markerDest.bindPopup(popupContent);
      markerDest.addTo(map);
      markerDest.on('click', () => {
        focusPassengerItem(passenger.id, false);
      });
      markerDest.on('popupopen', () => {
        lucide.createIcons();
      });
      layers.push(markerDest);
    }

    // 3. Connection Polyline
    if (passenger.lat_origin !== null && passenger.lng_origin !== null &&
      passenger.lat_dest !== null && passenger.lng_dest !== null) {
      const polyline = L.polyline([
        [passenger.lat_origin, passenger.lng_origin],
        [passenger.lat_dest, passenger.lng_dest]
      ], {
        color: 'var(--accent-color)',
        weight: 3,
        dashArray: '5, 8',
        opacity: 0.8
      });

      polyline.addTo(map);
      polyline.on('click', () => {
        focusPassengerItem(passenger.id, true);
      });
      layers.push(polyline);
    }

    state.markers[passenger.id] = layers;
  }

  function addMarkerToMap(passenger) {
    if (passenger.lat === null || passenger.lng === null) return;

    // Build label: full name on top, city on second line
    const name = (passenger.name || '').trim();
    const addrParts = (passenger.address || '').split(',');
    const cityPart = addrParts.length > 1 ? addrParts[addrParts.length - 1].trim() : '';
    const labelData = { name, sub: cityPart };

    // Create marker
    const marker = L.marker([passenger.lat, passenger.lng], {
      icon: getCustomMarkerIcon(passenger.status, labelData)
    });

    // Create custom popup content
    const popupContent = `
      <div class="map-popup">
        <div class="popup-title">${passenger.name}</div>
        <div class="popup-address">
          <i data-lucide="map-pin" class="popup-icon"></i>
          <span>${passenger.address}</span>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    marker.addTo(map);

    // Save reference in state
    state.markers[passenger.id] = marker;

    // Focus list item on marker click
    marker.on('click', () => {
      focusPassengerItem(passenger.id, false);
    });

    // Refresh popup icons on open
    marker.on('popupopen', () => {
      lucide.createIcons();
    });
  }

  function fitMapBounds() {
    const points = [];
    state.passengers.forEach(p => {
      if (p.mode === 'route') {
        if (p.lat_origin !== null && p.lng_origin !== null) points.push([p.lat_origin, p.lng_origin]);
        if (p.lat_dest !== null && p.lng_dest !== null) points.push([p.lat_dest, p.lng_dest]);
      } else {
        if (p.lat !== null && p.lng !== null) points.push([p.lat, p.lng]);
      }
    });

    if (points.length === 0) return;

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds.pad(0.15), {
      animate: true,
      duration: 1.2
    });
  }

  // Focus a passenger in list & map
  function focusPassengerItem(id, panMap = true) {
    // Remove active styles from previous
    if (state.currentActiveId) {
      const prevElement = document.getElementById(state.currentActiveId);
      if (prevElement) prevElement.classList.remove('active');

      const prevLayers = state.markers[state.currentActiveId];
      if (prevLayers && Array.isArray(prevLayers)) {
        prevLayers.forEach(layer => {
          if (layer instanceof L.Polyline) {
            layer.setStyle({ color: 'var(--accent-color)', weight: 3 });
          }
        });
      }
    }

    state.currentActiveId = id;
    const element = document.getElementById(id);
    if (element) {
      element.classList.add('active');
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const layers = state.markers[id];
    if (layers) {
      if (Array.isArray(layers)) {
        layers.forEach(layer => {
          if (layer instanceof L.Polyline) {
            layer.setStyle({ color: 'var(--color-success)', weight: 5 });
          }
        });

        if (panMap) {
          const points = [];
          layers.forEach(layer => {
            if (layer instanceof L.Marker) {
              points.push(layer.getLatLng());
            }
          });
          if (points.length > 0) {
            const bounds = L.latLngBounds(points);
            map.fitBounds(bounds.pad(0.4), {
              animate: true,
              duration: 0.8
            });
          }
        }

        const markerToOpen = layers.find(layer => layer instanceof L.Marker);
        if (markerToOpen) {
          markerToOpen.openPopup();
        }
      } else {
        if (panMap) {
          map.setView(layers.getLatLng(), 15, {
            animate: true,
            duration: 0.8
          });
        }
        layers.openPopup();
      }
    }
  }

  // Geocodes a single passenger's addresses on-the-fly and updates their state, map markers, and UI card
  async function geocodePassengerSingle(passenger) {
    passenger.status = 'loading';

    // Reset coordinates for the point being re-geocoded to avoid legacy markers
    if (passenger.mode === 'route') {
      if (passenger.status_origin === 'pending') { passenger.lat_origin = null; passenger.lng_origin = null; }
      if (passenger.status_dest === 'pending') { passenger.lat_dest = null; passenger.lng_dest = null; }
    } else {
      passenger.lat = null;
      passenger.lng = null;
    }

    updatePassengerItemUI(passenger);

    // Clear old map layers for this passenger
    const oldLayers = state.markers[passenger.id];
    if (oldLayers) {
      if (Array.isArray(oldLayers)) {
        oldLayers.forEach(layer => map.removeLayer(layer));
      } else {
        map.removeLayer(oldLayers);
      }
      delete state.markers[passenger.id];
    }

    if (passenger.mode === 'route') {
      // 1. Geocode Origin
      if (passenger.originAddress) {
        passenger.status_origin = 'loading';
        const { coords, reason } = await getCoordsWithFallback(passenger.originAddress, passenger.orig);
        if (coords) {
          passenger.lat_origin = coords.lat;
          passenger.lng_origin = coords.lng;
          passenger.status_origin = 'success';
          passenger.err_origin = null;
        } else {
          passenger.status_origin = 'error';
          passenger.err_origin = reason;
        }
      } else {
        passenger.status_origin = 'none';
      }

      // 2. Geocode Destination
      if (passenger.destAddress) {
        passenger.status_dest = 'loading';
        const { coords, reason } = await getCoordsWithFallback(passenger.destAddress, passenger.dest);
        if (coords) {
          passenger.lat_dest = coords.lat;
          passenger.lng_dest = coords.lng;
          passenger.status_dest = 'success';
          passenger.err_dest = null;
        } else {
          passenger.status_dest = 'error';
          passenger.err_dest = reason;
        }
      } else {
        passenger.status_dest = 'none';
      }

      // Aggregate status
      if (passenger.status_origin === 'success' && passenger.status_dest === 'success') {
        passenger.status = 'success';
      } else if (passenger.status_origin === 'success' || passenger.status_dest === 'success') {
        passenger.status = 'partial';
      } else {
        passenger.status = 'error';
      }
    } else {
      // Single Point
      const { coords, reason } = await getCoordsWithFallback(passenger.address, null);
      if (coords) {
        passenger.lat = coords.lat;
        passenger.lng = coords.lng;
        passenger.status = 'success';
        passenger.err = null;
      } else {
        passenger.status = 'error';
        passenger.err = reason;
      }
    }

    // Render and add new markers/polyline
    addPassengerToMap(passenger);

    // Replace old card elements in list
    const oldCard = document.getElementById(passenger.id);
    if (oldCard) {
      const newCard = createPassengerCardElement(passenger);
      oldCard.replaceWith(newCard);
    }

    updateStatsBadge();

    // Enable/disable VRP buttons dynamically
    const successfulCount = state.passengers.filter(p => p.status === 'success' || p.status === 'cache').length;
    if (successfulCount > 0) {
      btnOptimizeRoutes.classList.remove('disabled');
      btnOptimizeRoutes.disabled = false;
    } else {
      btnOptimizeRoutes.classList.add('disabled');
      btnOptimizeRoutes.disabled = true;
      btnTabVehicles.disabled = true;
      state.vehicles = [];
      switchTab('passengers');
    }

    applyFilters();

    // Pan and zoom map to show newly found location(s)
    focusPassengerItem(passenger.id, true);

    showToast(`Endereço de ${passenger.name} atualizado e geocodificado!`, 'success');
  }

  // --------------------------------------------------------------------------
  // 8. Sidebar & List Rendering UI Engine
  // --------------------------------------------------------------------------
  function renderPassengersList() {
    passengersList.innerHTML = '';

    if (state.passengers.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    state.passengers.forEach(p => {
      const card = createPassengerCardElement(p);
      passengersList.appendChild(card);
    });

    // Initialize Lucide icons on generated elements
    lucide.createIcons();
  }

  function createPassengerCardElement(p) {
    const card = document.createElement('div');
    card.className = `passenger-card ${state.currentActiveId === p.id ? 'active' : ''}`;
    card.id = p.id;

    // Status text label mapping
    let statusText = 'Pendente';
    let badgeClass = 'badge-pending';
    if (p.status === 'loading') statusText = 'Processando...';
    if (p.status === 'success') { statusText = 'Encontrado'; badgeClass = 'badge-success'; }
    if (p.status === 'cache') { statusText = 'Do Cache'; badgeClass = 'badge-cache'; }
    if (p.status === 'partial') { statusText = 'Parcial'; badgeClass = 'badge-warning'; }
    if (p.status === 'error') { statusText = 'Não Encontrado'; badgeClass = 'badge-error'; }

    let addressHTML = '';
    if (p.mode === 'route') {
      // Per-address status dot helper
      const addrDot = (addrStatus) => {
        if (!addrStatus || addrStatus === 'pending' || addrStatus === 'loading') return '';
        let dotColor = '';
        let dotTitle = '';
        if (addrStatus === 'success') { dotColor = 'var(--color-success)'; dotTitle = 'Localizado'; }
        else if (addrStatus === 'error') { dotColor = 'var(--color-danger)'; dotTitle = 'Não encontrado — verifique o endereço'; }
        else if (addrStatus === 'none') { dotColor = 'var(--text-muted)'; dotTitle = 'Não informado'; }
        return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0;margin-left:4px;" title="${dotTitle}"></span>`;
      };

      const origErrorHint = (p.status_origin === 'error')
        ? `<div class="addr-error-hint"><i data-lucide="alert-triangle" style="width:11px;height:11px;"></i> ${p.err_origin || 'Endereço não localizado'}.</div>`
        : '';
      const destErrorHint = (p.status_dest === 'error')
        ? `<div class="addr-error-hint"><i data-lucide="alert-triangle" style="width:11px;height:11px;"></i> ${p.err_dest || 'Endereço não localizado'}.</div>`
        : '';

      addressHTML = `
        <div class="passenger-address-row" style="margin-bottom: 4px;" data-type="origin">
          <i data-lucide="home" class="address-icon style-origin" style="color: var(--color-info);"></i>
          <span class="address-text"><strong>Origem:</strong> <span class="val">${escapeHTML(p.originAddress || 'Não informada')}</span>${addrDot(p.status_origin)}</span>
          <button class="btn-edit-addr" title="Editar Origem"><i data-lucide="edit-3"></i></button>
        </div>
        ${origErrorHint}
        <div class="passenger-address-row" data-type="dest">
          <i data-lucide="map-pin" class="address-icon style-dest" style="color: var(--color-warning);"></i>
          <span class="address-text"><strong>Destino:</strong> <span class="val">${escapeHTML(p.destAddress || 'Não informado')}</span>${addrDot(p.status_dest)}</span>
          <button class="btn-edit-addr" title="Editar Destino"><i data-lucide="edit-3"></i></button>
        </div>
        ${destErrorHint}
      `;
    } else {
      const errorHint = (p.status === 'error')
        ? `<div class="addr-error-hint"><i data-lucide="alert-triangle" style="width:11px;height:11px;"></i> ${p.err || 'Endereço não localizado'}.</div>`
        : '';
      addressHTML = `
        <div class="passenger-address-row" data-type="single">
          <i data-lucide="map-pin" class="address-icon"></i>
          <span class="address-text"><span class="val">${escapeHTML(p.address)}</span></span>
          <button class="btn-edit-addr" title="Editar Endereço"><i data-lucide="edit-3"></i></button>
        </div>
        ${errorHint}
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <span class="passenger-name">${escapeHTML(p.name)}</span>
        <span class="status-indicator ${p.status}" title="${statusText}"></span>
      </div>
      ${addressHTML}
      <div class="passenger-badge-row">
        <span class="card-badge ${badgeClass}">${statusText}</span>
      </div>
    `;

    // Click handler to pan and zoom map
    card.addEventListener('click', () => {
      focusPassengerItem(p.id, true);
    });

    // Attach inline editor listeners
    const editBtns = card.querySelectorAll('.btn-edit-addr');
    editBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent card selection

        const row = btn.closest('.passenger-address-row');
        const type = row.dataset.type;
        const textSpan = row.querySelector('.address-text');
        const currentVal = type === 'origin' ? p.originAddress : (type === 'dest' ? p.destAddress : p.address);

        textSpan.style.display = 'none';
        btn.style.display = 'none';

        const editor = document.createElement('div');
        editor.className = 'address-inline-edit';
        editor.innerHTML = `
          <input type="text" class="address-inline-input" value="${escapeHTML(currentVal)}">
          <button class="btn-inline-save" title="Salvar"><i data-lucide="check"></i></button>
          <button class="btn-inline-cancel" title="Cancelar"><i data-lucide="x"></i></button>
        `;

        row.appendChild(editor);
        lucide.createIcons();

        const input = editor.querySelector('.address-inline-input');
        input.focus();
        input.select();

        editor.addEventListener('click', (evt) => evt.stopPropagation());

        const saveEdit = async () => {
          const newVal = input.value.trim();
          editor.remove();
          textSpan.style.display = '';
          btn.style.display = '';

          if (newVal && newVal !== currentVal) {
            if (type === 'origin') {
              p.originAddress = newVal;
              p.status_origin = 'pending';
            } else if (type === 'dest') {
              p.destAddress = newVal;
              p.status_dest = 'pending';
            } else {
              p.address = newVal;
            }
            await geocodePassengerSingle(p);
          }
        };

        editor.querySelector('.btn-inline-save').addEventListener('click', saveEdit);
        input.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') saveEdit();
          if (evt.key === 'Escape') {
            editor.remove();
            textSpan.style.display = '';
            btn.style.display = '';
          }
        });

        editor.querySelector('.btn-inline-cancel').addEventListener('click', () => {
          editor.remove();
          textSpan.style.display = '';
          btn.style.display = '';
        });
      });
    });

    return card;
  }

  // Update a single card interface state without full list refresh
  // Update a single card interface state without full list refresh
  function updatePassengerItemUI(p) {
    const card = document.getElementById(p.id);
    if (!card) return;

    const newCard = createPassengerCardElement(p);
    card.replaceWith(newCard);

    // Re-apply filters so the visibility of the new card is correct
    applyFilters();

    // Initialize Lucide icons on the new card
    lucide.createIcons();
    updateStatsBadge();
  }

  // Apply combined text and status filters
  function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();

    state.passengers.forEach(p => {
      const card = document.getElementById(p.id);
      if (!card) return;

      // 1. Check text query match
      let matchesText = false;
      if (p.mode === 'route') {
        matchesText = p.name.toLowerCase().includes(query) ||
          (p.originAddress && p.originAddress.toLowerCase().includes(query)) ||
          (p.destAddress && p.destAddress.toLowerCase().includes(query));
      } else {
        matchesText = p.name.toLowerCase().includes(query) ||
          (p.address && p.address.toLowerCase().includes(query));
      }

      // 2. Check status match
      let matchesStatus = false;
      if (state.activeFilter === 'all') {
        matchesStatus = true;
      } else if (state.activeFilter === 'success') {
        matchesStatus = (p.status === 'success' || p.status === 'cache');
      } else if (state.activeFilter === 'partial') {
        matchesStatus = (p.status === 'partial');
      } else if (state.activeFilter === 'loading') {
        matchesStatus = (p.status === 'loading' || p.status === 'pending');
      } else if (state.activeFilter === 'error') {
        matchesStatus = (p.status === 'error');
      }

      if (matchesText && matchesStatus) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });

    // Handle empty results state
    const visibleCards = passengersList.querySelectorAll('.passenger-card:not(.hidden)');
    if (visibleCards.length === 0 && state.passengers.length > 0) {
      if (!document.getElementById('no-search-results')) {
        const noResults = document.createElement('div');
        noResults.id = 'no-search-results';
        noResults.className = 'empty-state';
        noResults.innerHTML = `
          <i data-lucide="search-code" class="empty-icon"></i>
          <p>Nenhum resultado encontrado.</p>
          <span class="empty-sub">Tente alterar os termos ou o filtro selecionado.</span>
        `;
        passengersList.appendChild(noResults);
        lucide.createIcons();
      }
    } else {
      const noResults = document.getElementById('no-search-results');
      if (noResults) noResults.remove();
    }
  }

  // Search input listener
  searchInput.addEventListener('input', applyFilters);

  // Status Filter button click listeners
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (filterGroup.classList.contains('disabled')) return;

      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state.activeFilter = btn.dataset.filter;
      applyFilters();
    });
  });

  // UI Progress bar updater
  function updateProgressUI(currentIdx, total, label) {
    const percent = Math.round((currentIdx / total) * 100);
    progressText.textContent = label;
    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
  }

  // Badge status summary updater
  function updateStatsBadge() {
    const total = state.passengers.length;
    const resolved = state.passengers.filter(p => p.status === 'success' || p.status === 'cache').length;
    const partialCount = state.passengers.filter(p => p.status === 'partial').length;
    const errorCount = state.passengers.filter(p => p.status === 'error').length;

    statsBadge.textContent = `${resolved} / ${total} Mapeados`;

    // Update filter button labels with quantities
    filterButtons.forEach(btn => {
      const filter = btn.dataset.filter;
      if (filter === 'all') {
        btn.innerHTML = `Todos ${total > 0 ? `(${total})` : ''}`;
      } else if (filter === 'success') {
        btn.innerHTML = `Encontrados ${total > 0 ? `(${resolved})` : ''}`;
      } else if (filter === 'partial') {
        btn.innerHTML = `Parciais ${total > 0 ? `(${partialCount})` : ''}`;
      } else if (filter === 'loading') {
        const loadingCount = state.passengers.filter(p => p.status === 'loading' || p.status === 'pending').length;
        btn.innerHTML = `Processando ${total > 0 ? `(${loadingCount})` : ''}`;
      } else if (filter === 'error') {
        btn.innerHTML = `Erros ${total > 0 ? `(${errorCount})` : ''}`;
      }
    });
  }

  // Clean data helper
  function clearAllData() {
    // Remove markers
    Object.values(state.markers).forEach(m => {
      if (Array.isArray(m)) {
        m.forEach(layer => map.removeLayer(layer));
      } else {
        map.removeLayer(m);
      }
    });
    state.markers = {};
    state.passengers = [];
    state.currentActiveId = null;

    // Reset controls
    searchInput.value = '';
    searchInput.disabled = true;

    // Reset filters
    filterGroup.classList.add('disabled');
    filterButtons.forEach(b => b.classList.remove('active'));
    const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
    if (allBtn) allBtn.classList.add('active');
    state.activeFilter = 'all';

    btnRecenter.disabled = true;
    btnClear.disabled = true;

    // Reset VRP controls
    btnOptimizeRoutes.classList.add('disabled');
    btnOptimizeRoutes.disabled = true;
    btnTabVehicles.disabled = true;

    if (state.vehicleRouteLayers) {
      state.vehicleRouteLayers.forEach(layer => map.removeLayer(layer));
      state.vehicleRouteLayers = [];
    }
    state.vehicles = [];

    // Switch tab back to passengers
    switchTab('passengers');

    // Reset counts
    countTotal.textContent = '0';
    updateStatsBadge();

    // Reset list HTML
    renderPassengersList();

    // Reset map view
    map.setView(defaultCenter, defaultZoom);
  }

  // Cancel running geocoding handler
  btnCancelGeocoding.addEventListener('click', () => {
    state.cancelRequested = true;
  });

  // Recenter map trigger
  btnRecenter.addEventListener('click', () => {
    fitMapBounds();
  });

  // Confirmation Modal and Clean up actions
  let currentResetCode = '';

  function openResetModal() {
    currentResetCode = Math.floor(100000 + Math.random() * 900000).toString();
    resetConfirmCode.textContent = currentResetCode;
    resetCodeInput.value = '';
    btnModalConfirm.disabled = true;
    resetConfirmModal.classList.remove('hidden');
    setTimeout(() => resetCodeInput.focus(), 150);
  }

  function closeResetModal() {
    resetConfirmModal.classList.add('hidden');
  }

  resetCodeInput.addEventListener('input', () => {
    const val = resetCodeInput.value.trim();
    btnModalConfirm.disabled = (val !== currentResetCode);
  });

  btnModalCancel.addEventListener('click', closeResetModal);

  btnModalConfirm.addEventListener('click', () => {
    const val = resetCodeInput.value.trim();
    if (val === currentResetCode) {
      clearAllData();
      closeResetModal();
      showToast('Todos os passageiros, veículos e rotas foram zerados!', 'info');
    }
  });

  btnClear.addEventListener('click', openResetModal);

  if (btnClearAllSidebar) {
    btnClearAllSidebar.addEventListener('click', openResetModal);
  }

  // Escape HTML string utility
  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  // --------------------------------------------------------------------------
  // 9. Floating Overlay Controller (Theme Toggle)
  // --------------------------------------------------------------------------
  btnToggleTheme.addEventListener('click', () => {
    const body = document.body;

    if (body.classList.contains('dark-theme')) {
      // Switch to Light
      body.classList.remove('dark-theme');
      body.classList.add('light-theme');

      map.removeLayer(tiles.dark);
      tiles.light.addTo(map);

      themeIconLight.classList.remove('hidden');
      themeIconDark.classList.add('hidden');

      state.theme = 'light';
    } else {
      // Switch to Dark
      body.classList.remove('light-theme');
      body.classList.add('dark-theme');

      map.removeLayer(tiles.light);
      tiles.dark.addTo(map);

      themeIconLight.classList.add('hidden');
      themeIconDark.classList.remove('hidden');

      state.theme = 'dark';
    }

    // Re-render markers with status-matching colors to ensure variables reflect immediately
    state.passengers.forEach(p => {
      const layers = state.markers[p.id];
      if (layers) {
        if (Array.isArray(layers)) {
          let originIdx = 0;
          if (p.lat_origin !== null && p.lng_origin !== null) {
            layers[originIdx].setIcon(getRouteMarkerIcon('origin', p.status_origin));
            originIdx++;
          }
          if (p.lat_dest !== null && p.lng_dest !== null) {
            layers[originIdx].setIcon(getRouteMarkerIcon('dest', p.status_dest));
          }
        } else {
          if (p.lat !== null && p.lng !== null) {
            layers.setIcon(getCustomMarkerIcon(p.status));
          }
        }
      }
    });

    showToast(`Tema ${state.theme === 'dark' ? 'Escuro' : 'Claro'} ativado.`, 'info');
  });

  // --------------------------------------------------------------------------
  // 10. Sample CSV File Downloader
  // --------------------------------------------------------------------------
  btnDownloadSample.addEventListener('click', () => {
    const headers = [
      "Indentificador", "Nome Passageiro", "Matrícula", "Telefone", "Hora",
      "Endereço Origem", "Nº Origem", "Complemento Origem", "Bairro Origem", "Municipio Origem", "UF Origem", "CEP Origem",
      "Endereço Destino", "Nº Destino", "Complemento Destino", "Bairro Destino", "Municipio Destino", "UF Destino", "CEP Destino",
      "Solicitante", "Matrícula", "Centro de Custo", "Gerente", "Observação", "Motivo", "SV",
      "Tipo de Transporte", "Data", "Hora", "Motorista"
    ];

    const data = [
      headers, // Linha de cabeçalho
      [
        "ID001", "Carlos Silva", "12345", "(11) 98888-8888", "08:00",
        "Avenida Paulista", "1000", "Sala 201", "Bela Vista", "São Paulo", "SP", "01310-100",
        "Rua da Bahia", "1022", "", "Centro", "Belo Horizonte", "MG", "30160-011",
        "Solicitante Exemplo", "54321", "CC-99", "Gerente Silva", "Obs Teste", "Visita Técnica", "SV-2024",
        "Executivo", "27/05/2026", "17:30", "Motorista João"
      ]
    ];

    try {
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Passageiros");
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', 'routefleet_modelo_passageiros.xlsx');
      link.style.visibility = 'hidden';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast('Modelo Excel baixado com sucesso!', 'success');
    } catch (err) {
      showToast('Erro ao gerar a planilha Excel de exemplo.', 'error');
      console.error(err);
    }
  });

  // --------------------------------------------------------------------------
  // 11. Clear Geocoding Cache
  // --------------------------------------------------------------------------
  btnClearCache.addEventListener('click', () => {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    const count = keysToRemove.length;
    if (count > 0) {
      showToast(`Cache limpo! ${count} endereço(s) removido(s). Reimporte o arquivo para re-geocodificar.`, 'info');
    } else {
      showToast('Nenhum dado em cache para limpar.', 'info');
    }
  });

  // --------------------------------------------------------------------------
  // 12. Vehicle Routing Optimization (VRP) & Tabs Logic
  // --------------------------------------------------------------------------

  // Haversine distance calculator between coordinates in km
  function calculateDistance(lat1, lon1, lat2, lon2) {
    if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return 0;
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Capacitated Vehicle Routing Problem (CVRP) greedy optimizer with Local Search refinement
  function optimizeVehiclesLogistics() {
    const activePassengers = state.passengers.filter(p => p.status === 'success' || p.status === 'cache');
    if (activePassengers.length === 0) {
      showToast('Nenhum passageiro geocodificado com sucesso para roteirizar.', 'error');
      return;
    }

    // Determine mode dynamically based on shared origins vs shared destinations
    let depot = null;
    let isDropOff = true;

    const uniqueOrigins = new Set(activePassengers.filter(p => p.lat_origin !== null && p.lng_origin !== null).map(p => `${p.lat_origin.toFixed(5)},${p.lng_origin.toFixed(5)}`));
    const uniqueDests = new Set(activePassengers.filter(p => p.lat_dest !== null && p.lng_dest !== null).map(p => `${p.lat_dest.toFixed(5)},${p.lng_dest.toFixed(5)}`));

    const firstSuccessful = activePassengers.find(p => p.lat_origin !== null && p.lng_origin !== null);
    if (!firstSuccessful) {
      showToast('Não foi possível identificar a coordenada comum.', 'error');
      return;
    }

    if (uniqueOrigins.size === 1) {
      // Retirada (Drop-off): All passengers share the same origin coordinates
      depot = {
        lat: firstSuccessful.lat_origin,
        lng: firstSuccessful.lng_origin,
        address: firstSuccessful.originAddress || 'FORVIA',
        type: 'origin'
      };
      isDropOff = true;
    } else if (uniqueDests.size === 1) {
      // Colocada (Pick-up): All passengers share the same destination coordinates
      const firstDest = activePassengers.find(p => p.lat_dest !== null && p.lng_dest !== null);
      depot = {
        lat: firstDest.lat_dest,
        lng: firstDest.lng_dest,
        address: firstDest.destAddress || 'FORVIA',
        type: 'destination'
      };
      isDropOff = false;
    } else {
      // Fallback to origin depot
      depot = {
        lat: firstSuccessful.lat_origin,
        lng: firstSuccessful.lng_origin,
        address: firstSuccessful.originAddress || 'FORVIA',
        type: 'origin'
      };
      isDropOff = true;
    }

    // Helper to get the home coordinates (where the passenger lives)
    const getHomeCoords = (p) => isDropOff ? { lat: p.lat_dest, lng: p.lng_dest } : { lat: p.lat_origin, lng: p.lng_origin };

    // Helper to calculate total distance of a passenger sequence in their respective mode
    function calculateRouteDistance(passengers, depotCoords, isDrop) {
      let routeDistance = 0;
      if (isDrop) {
        let prevLat = depotCoords.lat;
        let prevLng = depotCoords.lng;
        passengers.forEach(p => {
          const home = getHomeCoords(p);
          routeDistance += calculateDistance(prevLat, prevLng, home.lat, home.lng);
          prevLat = home.lat;
          prevLng = home.lng;
        });
      } else {
        let prevLat = null;
        let prevLng = null;
        passengers.forEach(p => {
          const home = getHomeCoords(p);
          if (prevLat !== null) {
            routeDistance += calculateDistance(prevLat, prevLng, home.lat, home.lng);
          }
          prevLat = home.lat;
          prevLng = home.lng;
        });
        routeDistance += calculateDistance(prevLat, prevLng, depotCoords.lat, depotCoords.lng);
      }
      return routeDistance;
    }

    // Helper to optimally sequence a small group of up to 4 passengers
    function sequenceRoute(passengerGroup, depotCoords, isDrop) {
      if (isDrop) {
        const sequenced = [];
        let currentLat = depotCoords.lat;
        let currentLng = depotCoords.lng;
        let tempGroup = [...passengerGroup];

        while (tempGroup.length > 0) {
          let closestIdx = 0;
          let minDist = Infinity;
          for (let i = 0; i < tempGroup.length; i++) {
            const home = getHomeCoords(tempGroup[i]);
            const dist = calculateDistance(currentLat, currentLng, home.lat, home.lng);
            if (dist < minDist) {
              minDist = dist;
              closestIdx = i;
            }
          }
          const nextP = tempGroup.splice(closestIdx, 1)[0];
          sequenced.push(nextP);
          const nextHome = getHomeCoords(nextP);
          currentLat = nextHome.lat;
          currentLng = nextHome.lng;
        }
        return sequenced;
      } else {
        const sequenced = [];
        let tempGroup = [...passengerGroup];

        let startIdx = 0;
        let maxDist = -1;
        for (let i = 0; i < tempGroup.length; i++) {
          const home = getHomeCoords(tempGroup[i]);
          const dist = calculateDistance(depotCoords.lat, depotCoords.lng, home.lat, home.lng);
          if (dist > maxDist) {
            maxDist = dist;
            startIdx = i;
          }
        }

        let currentP = tempGroup.splice(startIdx, 1)[0];
        sequenced.push(currentP);
        let currentHome = getHomeCoords(currentP);

        while (tempGroup.length > 0) {
          let closestIdx = 0;
          let minDist = Infinity;
          for (let i = 0; i < tempGroup.length; i++) {
            const home = getHomeCoords(tempGroup[i]);
            const dist = calculateDistance(currentHome.lat, currentHome.lng, home.lat, home.lng);
            if (dist < minDist) {
              minDist = dist;
              closestIdx = i;
            }
          }
          currentP = tempGroup.splice(closestIdx, 1)[0];
          sequenced.push(currentP);
          currentHome = getHomeCoords(currentP);
        }
        return sequenced;
      }
    }

    let unassigned = [...activePassengers];
    const vehicles = [];
    let vehicleIdCounter = 1;

    // 1. Initial Greedy CVRP grouping using farthest seed and nearest neighbor
    while (unassigned.length > 0) {
      let vehiclePassengers = [];

      // Seed selection: farthest unassigned
      let seedIndex = 0;
      let maxDistance = -1;
      for (let i = 0; i < unassigned.length; i++) {
        const home = getHomeCoords(unassigned[i]);
        const dist = calculateDistance(depot.lat, depot.lng, home.lat, home.lng);
        if (dist > maxDistance) {
          maxDistance = dist;
          seedIndex = i;
        }
      }

      const seed = unassigned.splice(seedIndex, 1)[0];
      vehiclePassengers.push(seed);

      // Nearest neighbor grouping up to 4
      while (vehiclePassengers.length < 4 && unassigned.length > 0) {
        const lastPassenger = vehiclePassengers[vehiclePassengers.length - 1];
        const lastHome = getHomeCoords(lastPassenger);
        let closestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < unassigned.length; i++) {
          const nextHome = getHomeCoords(unassigned[i]);
          const dist = calculateDistance(lastHome.lat, lastHome.lng, nextHome.lat, nextHome.lng);
          if (dist < minDistance) {
            minDistance = dist;
            closestIndex = i;
          }
        }

        const nextPassenger = unassigned.splice(closestIndex, 1)[0];
        vehiclePassengers.push(nextPassenger);
      }

      // Sequence the initial vehicle group
      const sequencedGroup = sequenceRoute(vehiclePassengers, depot, isDropOff);
      const dist = calculateRouteDistance(sequencedGroup, depot, isDropOff);

      vehicles.push({
        id: `v-${vehicleIdCounter}`,
        name: `Veículo ${vehicleIdCounter}`,
        passengers: sequencedGroup,
        depot: depot,
        distance: parseFloat(dist.toFixed(1))
      });

      vehicleIdCounter++;
    }

    // 2. Global Route Optimization Refinement (Local Search Swapping / 2-Opt)
    // Iterates through all vehicles and tries to swap passenger assignments to globally minimize total routing distance.
    let improved = true;
    let iterationLimit = 150; // Safety cap

    while (improved && iterationLimit > 0) {
      improved = false;
      iterationLimit--;

      for (let i = 0; i < vehicles.length; i++) {
        for (let j = i + 1; j < vehicles.length; j++) {
          const v1 = vehicles[i];
          const v2 = vehicles[j];

          for (let p1Idx = 0; p1Idx < v1.passengers.length; p1Idx++) {
            for (let p2Idx = 0; p2Idx < v2.passengers.length; p2Idx++) {
              const p1 = v1.passengers[p1Idx];
              const p2 = v2.passengers[p2Idx];

              const currentV1Dist = v1.distance;
              const currentV2Dist = v2.distance;
              const currentTotal = currentV1Dist + currentV2Dist;

              // Simulate passenger swap
              const newV1Passengers = [...v1.passengers];
              const newV2Passengers = [...v2.passengers];
              newV1Passengers[p1Idx] = p2;
              newV2Passengers[p2Idx] = p1;

              // Re-sequence the simulated vehicles to find their optimal paths
              const seqV1 = sequenceRoute(newV1Passengers, depot, isDropOff);
              const seqV2 = sequenceRoute(newV2Passengers, depot, isDropOff);

              const swappedV1Dist = calculateRouteDistance(seqV1, depot, isDropOff);
              const swappedV2Dist = calculateRouteDistance(seqV2, depot, isDropOff);
              const swappedTotal = swappedV1Dist + swappedV2Dist;

              // If the swap improves total routing efficiency by more than 0.05km, commit!
              if (swappedTotal < currentTotal - 0.05) {
                v1.passengers = seqV1;
                v1.distance = parseFloat(swappedV1Dist.toFixed(1));

                v2.passengers = seqV2;
                v2.distance = parseFloat(swappedV2Dist.toFixed(1));

                improved = true;
                break;
              }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
    }

    state.vehicles = vehicles;
    showToast(`Logística gerada! ${vehicles.length} veículo(s) otimizado(s) criado(s).`, 'success');
  }

  // Render optimized vehicles list in sidebar with drag-and-drop support
  function renderVehiclesList() {
    vehiclesList.innerHTML = '';

    if (state.vehicles.length === 0) {
      vehiclesList.innerHTML = `
        <div class="empty-state">
          <i data-lucide="route" class="empty-icon"></i>
          <p>Logística não gerada.</p>
          <span class="empty-sub">Clique em "Gerar Logística de Rotas" para agrupar os passageiros em veículos.</span>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    // --- Drag state ---
    let dragPassengerId = null;
    let dragSourceVehicleId = null;

    const MAX_CAPACITY = 4;

    function getOverflowCount() {
      return state.vehicles.filter(v => v.passengers.length > MAX_CAPACITY).length;
    }

    function rebuildAll() {
      renderVehiclesList();
      // Re-focus the active vehicle if any
      if (state.currentActiveId) {
        const el = document.getElementById(state.currentActiveId);
        if (el) el.classList.add('active');
      }
    }

    // Export button (top of vehicles list)
    const exportBar = document.createElement('div');
    exportBar.className = 'vehicle-export-bar';
    exportBar.innerHTML = `
      <button id="btn-export-report" class="btn btn-accent btn-sm full-width" id="btn-export-report">
        <i data-lucide="file-spreadsheet"></i>
        Gerar Relatório Excel
      </button>
    `;
    vehiclesList.appendChild(exportBar);

    state.vehicles.forEach(vehicle => {
      const occupancy = vehicle.passengers.length;
      const isOverflow = occupancy > MAX_CAPACITY;
      const isFull = occupancy === MAX_CAPACITY;

      const card = document.createElement('div');
      card.className = `vehicle-card ${state.currentActiveId === vehicle.id ? 'active' : ''} ${isOverflow ? 'vehicle-overflow' : ''}`;
      card.id = vehicle.id;

      const occupancyText = `${occupancy}/${MAX_CAPACITY} lugares`;
      const isDropOff = vehicle.depot.type === 'origin';

      // Header
      const header = document.createElement('div');
      header.className = 'vehicle-header';
      header.innerHTML = `
        <span class="vehicle-title">
          <i data-lucide="truck"></i>
          ${escapeHTML(vehicle.name)}
        </span>
        <span class="vehicle-occupancy ${isFull ? 'full' : ''} ${isOverflow ? 'overflow' : ''}">${occupancyText}</span>
      `;
      card.appendChild(header);

      // Overflow warning
      if (isOverflow) {
        const warn = document.createElement('div');
        warn.className = 'vehicle-overflow-warn';
        warn.innerHTML = `<i data-lucide="alert-triangle"></i> Limite excedido! Máx. ${MAX_CAPACITY} passageiros.`;
        card.appendChild(warn);
      }

      // Depot stop (header stop)
      const depotStop = document.createElement('div');
      depotStop.className = 'vehicle-stops';
      if (isDropOff) {
        depotStop.innerHTML = `
          <div class="vehicle-stop-item">
            <span class="stop-badge stop-origin">O</span>
            <span class="stop-name" title="${vehicle.depot.address}">FORVIA (Retirada)</span>
          </div>
        `;
      }
      card.appendChild(depotStop);

      // Draggable passenger drop zone
      const dropZone = document.createElement('div');
      dropZone.className = 'vehicle-drop-zone';
      dropZone.dataset.vehicleId = vehicle.id;

      vehicle.passengers.forEach((p, idx) => {
        const chip = document.createElement('div');
        chip.className = 'passenger-chip';
        chip.draggable = true;
        chip.dataset.passengerId = p.id;
        chip.dataset.vehicleId = vehicle.id;

        const stopAddr = isDropOff ? p.destAddress : p.originAddress;
        chip.innerHTML = `
          <span class="chip-drag-handle"><i data-lucide="grip-vertical"></i></span>
          <span class="stop-badge chip-badge">${idx + 1}</span>
          <span class="chip-name" title="${p.name}">${escapeHTML(p.name)}</span>
          <span class="chip-addr" title="${stopAddr || ''}">${escapeHTML(stopAddr || '')}</span>
        `;

        // Drag start
        chip.addEventListener('dragstart', (e) => {
          dragPassengerId = p.id;
          dragSourceVehicleId = vehicle.id;
          chip.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('dragging');
          document.querySelectorAll('.vehicle-drop-zone').forEach(z => z.classList.remove('drag-over'));
        });

        dropZone.appendChild(chip);
      });

      // Drop zone events
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const targetVehicleId = dropZone.dataset.vehicleId;
        if (!dragPassengerId || targetVehicleId === dragSourceVehicleId) return;

        // Find passenger and move between vehicles
        const srcVehicle = state.vehicles.find(v => v.id === dragSourceVehicleId);
        const tgtVehicle = state.vehicles.find(v => v.id === targetVehicleId);
        if (!srcVehicle || !tgtVehicle) return;

        const pIdx = srcVehicle.passengers.findIndex(p => p.id === dragPassengerId);
        if (pIdx === -1) return;

        const [movedPassenger] = srcVehicle.passengers.splice(pIdx, 1);
        tgtVehicle.passengers.push(movedPassenger);

        // Remove empty vehicles
        state.vehicles = state.vehicles.filter(v => v.passengers.length > 0);
        // Re-number vehicle names
        state.vehicles.forEach((v, i) => { v.name = `Veículo ${i + 1}`; });

        dragPassengerId = null;
        dragSourceVehicleId = null;
        rebuildAll();
      });

      card.appendChild(dropZone);

      // Footer stop (destination depot for pick-up mode)
      if (!isDropOff) {
        const footerStop = document.createElement('div');
        footerStop.className = 'vehicle-stops';
        footerStop.innerHTML = `
          <div class="vehicle-stop-item">
            <span class="stop-badge stop-origin" style="background-color: var(--color-success);">D</span>
            <span class="stop-name" title="${vehicle.depot.address}">FORVIA (Colocada)</span>
          </div>
        `;
        card.appendChild(footerStop);
      }

      // Footer distance info
      const footer = document.createElement('div');
      footer.style.cssText = 'font-size:10px;color:var(--text-secondary);display:flex;justify-content:space-between;align-items:center;margin-top:4px;border-top:1px dashed var(--border-color);padding-top:6px;';
      footer.innerHTML = `
        <span class="vehicle-distance-info">Percurso total: <strong class="distance-val">${vehicle.distance} km</strong>${vehicle.duration ? ` (~${vehicle.duration} min)` : ''}</span>
        <span style="color:var(--accent-color);font-weight:700;">Ver Rota <i data-lucide="chevron-right" style="width:10px;height:10px;vertical-align:middle;"></i></span>
      `;
      card.appendChild(footer);

      card.addEventListener('click', (e) => {
        // Don't trigger if clicking a chip drag handle
        if (e.target.closest('.passenger-chip')) return;
        focusVehicleItem(vehicle.id);
      });

      vehiclesList.appendChild(card);
    });

    // "Add Vehicle" card button at the end
    const addCard = document.createElement('div');
    addCard.className = 'vehicle-card btn-add-vehicle-card';
    addCard.innerHTML = `
      <div class="add-vehicle-inner">
        <i data-lucide="plus-circle" class="add-vehicle-icon"></i>
        <span class="add-vehicle-text">Adicionar Veículo</span>
      </div>
    `;
    addCard.addEventListener('click', () => {
      let depot = null;
      if (state.vehicles.length > 0) {
        depot = state.vehicles[0].depot;
      } else {
        const activePassengers = state.passengers.filter(p => p.status === 'success' || p.status === 'cache');
        if (activePassengers.length > 0) {
          const firstSuccessful = activePassengers.find(p => p.lat_origin !== null && p.lng_origin !== null);
          if (firstSuccessful) {
            depot = {
              lat: firstSuccessful.lat_origin,
              lng: firstSuccessful.lng_origin,
              address: firstSuccessful.originAddress || 'FORVIA',
              type: 'origin'
            };
          }
        }
      }

      if (!depot) {
        showToast('Por favor, carregue e geolocalize os passageiros primeiro.', 'error');
        return;
      }

      const newId = `vehicle_${Date.now()}`;
      state.vehicles.push({
        id: newId,
        name: `Veículo ${state.vehicles.length + 1}`,
        passengers: [],
        depot: depot,
        distance: 0,
        duration: 0
      });

      rebuildAll();
      focusVehicleItem(newId);
      showToast('Novo veículo adicionado com sucesso!', 'success');
    });
    vehiclesList.appendChild(addCard);

    lucide.createIcons();

    // Wire up export button
    const btnExport = document.getElementById('btn-export-report');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const overflowCount = state.vehicles.filter(v => v.passengers.length > MAX_CAPACITY).length;
        if (overflowCount > 0) {
          showToast(`Não é possível gerar o relatório. ${overflowCount} veículo(s) com mais de ${MAX_CAPACITY} passageiros (marcados em vermelho).`, 'error');
          return;
        }
        exportVehiclesReport();
      });
    }
  }

  // Export Excel report: vehicle number + all original passenger data columns
  function exportVehiclesReport() {
    if (typeof XLSX === 'undefined') {
      showToast('Biblioteca SheetJS não carregada.', 'error');
      return;
    }

    const rows = [];

    state.vehicles.forEach((vehicle, vIdx) => {
      const vehicleNum = vIdx + 1;
      vehicle.passengers.forEach(p => {
        const baseRow = p._rawRow ? { ...p._rawRow } : {};
        // Prepend vehicle number
        const exportRow = {
          'Veículo': vehicleNum,
          'Nome Passageiro': p.name,
          ...baseRow
        };
        // Remove duplicate name key if present
        delete exportRow['nome passageiro'];
        delete exportRow['Nome Passageiro'.toLowerCase()];
        rows.push(exportRow);
      });
    });

    if (rows.length === 0) {
      showToast('Nenhum dado para exportar.', 'error');
      return;
    }

    try {
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Roteirização');

      // Column widths
      worksheet['!cols'] = [
        { wch: 8 },   // Veículo
        { wch: 28 },  // Nome Passageiro
        ...Object.keys(rows[0]).slice(2).map(() => ({ wch: 22 }))
      ];

      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `routefleet_roteirizacao_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('Relatório Excel gerado com sucesso!', 'success');
    } catch (err) {
      showToast('Erro ao gerar o relatório Excel.', 'error');
      console.error(err);
    }
  }

  // Focus a vehicle and trigger its route display
  function focusVehicleItem(id) {
    if (state.currentActiveId) {
      const prevElement = document.getElementById(state.currentActiveId);
      if (prevElement) prevElement.classList.remove('active');
    }

    state.currentActiveId = id;
    const element = document.getElementById(id);
    if (element) {
      element.classList.add('active');
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const vehicle = state.vehicles.find(v => v.id === id);
    if (vehicle) {
      drawVehicleRouteOnMap(vehicle);
    }
  }

  // Draw customized high-contrast routes and sequential markers on the map
  async function drawVehicleRouteOnMap(vehicle) {
    // Clear any previous vehicle route layers
    state.vehicleRouteLayers.forEach(layer => map.removeLayer(layer));
    state.vehicleRouteLayers = [];

    map.closePopup();

    const points = [];
    const isDropOff = vehicle.depot.type === 'origin';

    // 1. Draw Depot Marker
    const depotMarker = L.marker([vehicle.depot.lat, vehicle.depot.lng], {
      icon: L.divIcon({
        className: 'custom-map-marker',
        html: `
          <div style="
            width: 52px;
            height: 20px;
            background-color: ${isDropOff ? 'var(--color-info)' : 'var(--color-success)'};
            border: 2px solid #ffffff;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 8px;
            font-weight: 900;
            color: #ffffff;
          ">
            ${isDropOff ? 'DEPOT' : 'EMPRESA'}
          </div>
        `,
        iconSize: [52, 20],
        iconAnchor: [26, 10]
      })
    });
    depotMarker.bindPopup(`<strong>Ponto de ${isDropOff ? 'Retirada (Origem)' : 'Entrega (Destino)'}</strong><br>${vehicle.depot.address}`);
    depotMarker.addTo(map);
    state.vehicleRouteLayers.push(depotMarker);

    if (isDropOff) {
      // Retirada: Depot -> stops
      points.push([vehicle.depot.lat, vehicle.depot.lng]);

      vehicle.passengers.forEach((p, idx) => {
        if (p.lat_dest !== null && p.lng_dest !== null) {
          const destLatLng = [p.lat_dest, p.lng_dest];
          points.push(destLatLng);

          const seqMarker = L.marker(destLatLng, {
            icon: L.divIcon({
              className: 'custom-map-marker',
              html: `
                <div style="
                  width: 24px;
                  height: 24px;
                  background-color: var(--accent-color);
                  border: 2px solid #ffffff;
                  border-radius: 50%;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 11px;
                  font-weight: 800;
                  color: #ffffff;
                ">
                  ${idx + 1}
                </div>
              `,
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            })
          });

          seqMarker.bindPopup(`
            <strong>${idx + 1}ª Parada (Desembarque) | ${p.name}</strong><br>
            <span style="font-size: 11px; color: var(--text-secondary);">${p.destAddress}</span>
          `);
          seqMarker.addTo(map);
          state.vehicleRouteLayers.push(seqMarker);
        }
      });
    } else {
      // Colocada: stops -> Depot
      vehicle.passengers.forEach((p, idx) => {
        if (p.lat_origin !== null && p.lng_origin !== null) {
          const origLatLng = [p.lat_origin, p.lng_origin];
          points.push(origLatLng);

          const seqMarker = L.marker(origLatLng, {
            icon: L.divIcon({
              className: 'custom-map-marker',
              html: `
                <div style="
                  width: 24px;
                  height: 24px;
                  background-color: var(--accent-color);
                  border: 2px solid #ffffff;
                  border-radius: 50%;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 11px;
                  font-weight: 800;
                  color: #ffffff;
                ">
                  ${idx + 1}
                </div>
              `,
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            })
          });

          seqMarker.bindPopup(`
            <strong>${idx + 1}ª Parada (Embarque) | ${p.name}</strong><br>
            <span style="font-size: 11px; color: var(--text-secondary);">${p.originAddress}</span>
          `);
          seqMarker.addTo(map);
          state.vehicleRouteLayers.push(seqMarker);
        }
      });

      points.push([vehicle.depot.lat, vehicle.depot.lng]);
    }

    // 3. One-way route ends at the last passenger's destination (no return to depot)

    // 4. Draw fallback straight-line polyline (dashed)
    let fallbackPolyline = null;
    if (points.length >= 2) {
      fallbackPolyline = L.polyline(points, {
        color: 'var(--accent-color)',
        weight: 4,
        opacity: 0.7,
        dashArray: '6, 8'
      }).addTo(map);
      state.vehicleRouteLayers.push(fallbackPolyline);

      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds.pad(0.2), {
        animate: true,
        duration: 1.0
      });
    }

    // 5. Try fetching actual road path from OSRM to render GPS-like streets
    try {
      const osrmCoords = points.map(p => `${p[1]},${p[0]}`).join(';');
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson`);

      if (response.ok) {
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const roadPoints = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

          // Remove the fallback line
          if (fallbackPolyline) {
            map.removeLayer(fallbackPolyline);
            state.vehicleRouteLayers = state.vehicleRouteLayers.filter(l => l !== fallbackPolyline);
          }

          // Double-layer polyline for a stunning high-contrast GPS look (dark border shadow + accent color line)
          const shadowPolyline = L.polyline(roadPoints, {
            color: '#000000',
            weight: 8,
            opacity: 0.35,
            lineJoin: 'round'
          }).addTo(map);
          state.vehicleRouteLayers.push(shadowPolyline);

          const realRoutePolyline = L.polyline(roadPoints, {
            color: 'var(--accent-color)',
            weight: 5,
            opacity: 0.9,
            lineJoin: 'round'
          }).addTo(map);
          state.vehicleRouteLayers.push(realRoutePolyline);

          // Update distance and duration with real street values
          const realDistKm = parseFloat((route.distance / 1000).toFixed(1));
          const durationMins = Math.round(route.duration / 60);

          vehicle.distance = realDistKm;
          vehicle.duration = durationMins;

          // Update the card details in the DOM
          const cardElement = document.getElementById(vehicle.id);
          if (cardElement) {
            const infoSpan = cardElement.querySelector('.vehicle-distance-info');
            if (infoSpan) {
              infoSpan.innerHTML = `Percurso total: <strong class="distance-val">${realDistKm} km</strong> (~${durationMins} min)`;
            }
          }

          // Fit map bounds to the exact street coordinates
          const bounds = L.latLngBounds(roadPoints);
          map.fitBounds(bounds.pad(0.2), {
            animate: true,
            duration: 1.0
          });
        }
      }
    } catch (err) {
      console.warn('[RouteFleet] Falha ao obter rota por ruas via OSRM. Exibindo linha reta como fallback.', err);
    }
  }

  // Hide all passenger markers/lines from the map when in vehicles tab to keep the view clean
  function hideAllPassengerMapLayers() {
    Object.values(state.markers).forEach(m => {
      if (Array.isArray(m)) {
        m.forEach(layer => map.removeLayer(layer));
      } else {
        map.removeLayer(m);
      }
    });
  }

  // Restore all passenger markers/lines to the map when switching back to passengers tab
  function restoreAllPassengerMapLayers() {
    // Clear any vehicle route layers currently drawn
    state.vehicleRouteLayers.forEach(layer => map.removeLayer(layer));
    state.vehicleRouteLayers = [];

    state.passengers.forEach(p => {
      const m = state.markers[p.id];
      if (m) {
        if (Array.isArray(m)) {
          m.forEach(layer => layer.addTo(map));
        } else {
          m.addTo(map);
        }
      }
    });

    fitMapBounds();
  }

  // Handle Tab Switch Actions
  function switchTab(tab) {
    tabButtons.forEach(b => b.classList.remove('active'));

    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    state.activeTab = tab;

    if (tab === 'passengers') {
      passengersTabContent.classList.remove('hidden');
      vehiclesTabContent.classList.add('hidden');
      restoreAllPassengerMapLayers();
    } else {
      passengersTabContent.classList.add('hidden');
      vehiclesTabContent.classList.remove('hidden');
      hideAllPassengerMapLayers();
      renderVehiclesList();
    }
  }

  // Tab buttons click triggers
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Optimize button click trigger
  btnOptimizeRoutes.addEventListener('click', () => {
    if (btnOptimizeRoutes.classList.contains('disabled')) return;

    optimizeVehiclesLogistics();
    btnTabVehicles.disabled = false;
    switchTab('vehicles');

    if (state.vehicles.length > 0) {
      focusVehicleItem(state.vehicles[0].id);
    }
  });

});
