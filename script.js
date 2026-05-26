/* ==========================================================================
   ROUTFLEET APP CORE LOGIC
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Inject keyframe animation for custom pulsing markers
  const style = document.createElement('style');
  style.textContent = `
    @keyframes markerPulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(2.2); opacity: 0; }
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
    activeFilter: 'all'    // Active status filter ('all', 'success', 'partial', 'error')
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
  
  // Floating Map Overlays
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const themeIconLight = document.getElementById('theme-icon-light');
  const themeIconDark = document.getElementById('theme-icon-dark');
  const btnRecenter = document.getElementById('btn-recenter');
  const btnClear = document.getElementById('btn-clear');
  const btnClearCache = document.getElementById('btn-clear-cache');

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
  function getCustomMarkerIcon(status) {
    let color = 'var(--accent-color)'; // Default (pending/loading)
    if (status === 'success') color = 'var(--color-success)';
    if (status === 'cache') color = 'var(--color-info)';
    if (status === 'error') color = 'var(--color-danger)';

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
  function getRouteMarkerIcon(type, status) {
    let color = 'var(--accent-color)'; // Default
    if (status === 'error') {
      color = 'var(--color-danger)';
    } else {
      color = type === 'origin' ? 'var(--color-info)' : 'var(--color-warning)';
    }
    
    const label = type === 'origin' ? 'O' : 'D';
    
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
    { from: /^Avenida\s+/i,  to: 'Av. '  },
    { from: /^Rodovia\s+/i,  to: 'Rod. ' },
    { from: /^Alameda\s+/i,  to: 'Al. '  },
    { from: /^Travessa\s+/i, to: 'Trav. '},
    { from: /^Praça\s+/i,    to: 'Pça. ' },
    { from: /^Estrada\s+/i,  to: 'Est. ' },
    { from: /^Rua\s+/i,      to: 'R. '   },
  ];

  // Common Brazilian typo/spelling variant corrections
  const SPELLING_CORRECTIONS = [
    { from: /\bWilly\b/gi,     to: 'Willi'   },
    { from: /\bDon\b/g,        to: 'Dom'      },
    { from: /\bFilhos\b/gi,    to: 'Filho'    },
    { from: /\bSaint\b/gi,     to: 'São'      },
    { from: /\bSta\.\s+/gi,    to: 'Santa '   },
    { from: /\bSto\.\s+/gi,    to: 'Santo '   },
    { from: /\bDr\.\s+/gi,     to: 'Doutor '  },
    { from: /\bCel\.\s+/gi,    to: 'Coronel ' },
    { from: /\bCap\.\s+/gi,    to: 'Capitão ' },
    { from: /\bGal\.\s+/gi,    to: 'General ' },
    { from: /\bPres\.\s+/gi,   to: 'Presidente ' },
    { from: /\bProf\.\s+/gi,   to: 'Professor ' },
    { from: /\bEng\.\s+/gi,    to: 'Engenheiro ' },
    { from: /\bMaj\.\s+/gi,    to: 'Major '   },
    { from: /\bTen\.\s+/gi,    to: 'Tenente ' },
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
      reader.onload = function(e) {
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
        reader.onload = function(e) {
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
          complete: function(results) {
            processParsedData(results.data);
          },
          error: function(err) {
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

    // Map rows to application state objects
    state.passengers = data.map((row, idx) => {
      const name = row[passengerNameCol]?.trim() || `Passageiro ${idx + 1}`;
      
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

        const originAddress = buildAddress(origStreet, origNum, origNeigh, origCity, origState);
        const destAddress   = buildAddress(destStreet, destNum, destNeigh, destCity, destState);

        return {
          id: `p-${idx}-${Date.now()}`,
          name: name,
          mode: 'route',
          originAddress: originAddress,
          destAddress: destAddress,
          // Raw components for structured lookup
          orig: { street: origStreet, num: origNum, neigh: origNeigh, city: origCity, state: origState },
          dest: { street: destStreet, num: destNum, neigh: destNeigh, city: destCity, state: destState },
          lat_origin: null,
          lng_origin: null,
          lat_dest: null,
          lng_dest: null,
          status: 'pending',
          status_origin: 'pending',
          status_dest: 'pending',
          source: null
        };
      } else {
        const address = row[simpleAddressCol]?.trim() || '';
        return {
          id: `p-${idx}-${Date.now()}`,
          name: name,
          mode: 'single',
          address: address,
          lat: null,
          lng: null,
          status: 'pending',
          source: null
        };
      }
    }).filter(p => p.mode === 'route' ? (p.originAddress || p.destAddress) : p.address);

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
                console.warn(`[RouteFleet] Resultado rejeitado por divergência de município. Esperado: "${expectedCity}", Obtido: "${firstResult.display_name}"`);
                return null;
              }
            }

            return { 
              lat: parseFloat(firstResult.lat), 
              lng: parseFloat(firstResult.lon),
              display_name: firstResult.display_name
            };
          }
        }
      } catch (err) {
        console.error('Nominatim API error:', err);
      }
      return null;
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
      const streetExpanded  = expandAbbreviations(streetClean);
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
      if (!address) return null;

      // ── Validate street type ───────────────────────────────────────────────
      // If neither the full address string nor the street component contains a
      // recognizable logradouro type, reject immediately to avoid wrong matches.
      const streetToCheck = (components && components.street) ? components.street : address;
      if (!hasStreetTypePrefix(streetToCheck)) {
        console.warn(`[RouteFleet] Endereço rejeitado — sem tipo de logradouro (Rua, Av., etc.): "${address}"`);
        return null;
      }
      // ─────────────────────────────────────────────────────────────────────

      const expectedCity = (components && components.city) ? components.city : null;

      // Check original address cache first
      const origCacheKey = CACHE_PREFIX + address.toLowerCase().trim();
      const origCached = localStorage.getItem(origCacheKey);
      if (origCached) {
        try {
          const coords = JSON.parse(origCached);
          if (coords) {
            if (!coords.display_name) {
              // Old cache format without display_name -> remove to force fresh fetch and validation
              localStorage.removeItem(origCacheKey);
            } else if (expectedCity) {
              const displayNorm = removeDiacritics(coords.display_name).toLowerCase().replace(/[^a-z0-9]/g, '');
              const expectedNorm = removeDiacritics(expectedCity).toLowerCase().replace(/[^a-z0-9]/g, '');
              if (displayNorm.includes(expectedNorm)) {
                return coords;
              } else {
                console.warn(`[RouteFleet] Cache de origem rejeitado por divergência de município: "${expectedCity}" vs "${coords.display_name}"`);
                localStorage.removeItem(origCacheKey);
              }
            } else {
              return coords;
            }
          }
        } catch(e) {}
      }
      
      const queriesToTry = generateAddressFallbacks(address);
      const structuredUrls = buildStructuredUrls(components);

      // 1. First try structured queries (more precise)
      for (const url of structuredUrls) {
        const cacheKey = CACHE_PREFIX + 'struct_' + url.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(-80);
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const coords = JSON.parse(cachedData);
            if (coords) {
              if (!coords.display_name) {
                localStorage.removeItem(cacheKey);
              } else if (expectedCity) {
                const displayNorm = removeDiacritics(coords.display_name).toLowerCase().replace(/[^a-z0-9]/g, '');
                const expectedNorm = removeDiacritics(expectedCity).toLowerCase().replace(/[^a-z0-9]/g, '');
                if (displayNorm.includes(expectedNorm)) {
                  localStorage.setItem(origCacheKey, JSON.stringify(coords));
                  return coords;
                } else {
                  console.warn(`[RouteFleet] Cache estruturado rejeitado por divergência de município: "${expectedCity}" vs "${coords.display_name}"`);
                  localStorage.removeItem(cacheKey);
                }
              } else {
                localStorage.setItem(origCacheKey, JSON.stringify(coords));
                return coords;
              }
            }
          } catch(e) {}
        }
        const coords = await fetchNominatim(url, expectedCity);
        if (coords) {
          localStorage.setItem(cacheKey, JSON.stringify(coords));
          localStorage.setItem(origCacheKey, JSON.stringify(coords));
          return coords;
        }
      }

      // 2. Then try free-text fallback queries
      for (const query of queriesToTry) {
        const cacheKey = CACHE_PREFIX + query.toLowerCase().trim();
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const coords = JSON.parse(cachedData);
            if (coords) {
              if (!coords.display_name) {
                localStorage.removeItem(cacheKey);
              } else if (expectedCity) {
                const displayNorm = removeDiacritics(coords.display_name).toLowerCase().replace(/[^a-z0-9]/g, '');
                const expectedNorm = removeDiacritics(expectedCity).toLowerCase().replace(/[^a-z0-9]/g, '');
                if (displayNorm.includes(expectedNorm)) {
                  localStorage.setItem(origCacheKey, JSON.stringify(coords));
                  return coords;
                } else {
                  console.warn(`[RouteFleet] Cache livre rejeitado por divergência de município: "${expectedCity}" vs "${coords.display_name}"`);
                  localStorage.removeItem(cacheKey);
                }
              } else {
                localStorage.setItem(origCacheKey, JSON.stringify(coords));
                return coords;
              }
            }
          } catch (e) {
            console.error('Erro ao ler cache:', e);
          }
        }

        const coords = await fetchNominatim(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`,
          expectedCity
        );
        if (coords) {
          localStorage.setItem(cacheKey, JSON.stringify(coords));
          localStorage.setItem(origCacheKey, JSON.stringify(coords));
          return coords;
        }
      }
      return null;
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
          const coords = await getCoordsWithFallback(passenger.originAddress, passenger.orig);
          if (coords) {
            passenger.lat_origin = coords.lat;
            passenger.lng_origin = coords.lng;
            passenger.status_origin = 'success';
          } else {
            passenger.status_origin = 'error';
          }
        } else {
          passenger.status_origin = 'none';
        }

        if (state.cancelRequested) break;

        // 2. Geocode Destination Address
        if (passenger.destAddress) {
          updateProgressUI(i, total, `Geocodificando Destino de: "${passenger.name}"`);
          const coords = await getCoordsWithFallback(passenger.destAddress, passenger.dest);
          if (coords) {
            passenger.lat_dest = coords.lat;
            passenger.lng_dest = coords.lng;
            passenger.status_dest = 'success';
          } else {
            passenger.status_dest = 'error';
          }
        } else {
          passenger.status_dest = 'none';
        }

        // Aggregate overall status: Only succeed if BOTH points are successfully geocoded
        if (passenger.status_origin === 'success' && passenger.status_dest === 'success') {
          passenger.status = 'success';
        } else if (passenger.status_origin === 'success' || passenger.status_dest === 'success') {
          passenger.status = 'partial'; // One of the two failed
        } else {
          passenger.status = 'error'; // Both failed
        }
      } else {
        // Standard Single Point Mode
        updateProgressUI(i, total, `Geocodificando: "${passenger.name}"`);
        const coords = await getCoordsWithFallback(passenger.address, null);
        if (coords) {
          passenger.lat = coords.lat;
          passenger.lng = coords.lng;
          passenger.status = 'success';
        } else {
          passenger.status = 'error';
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

    // 1. Origin Marker
    if (passenger.lat_origin !== null && passenger.lng_origin !== null) {
      const markerOrigin = L.marker([passenger.lat_origin, passenger.lng_origin], {
        icon: getRouteMarkerIcon('origin', passenger.status_origin)
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
      const markerDest = L.marker([passenger.lat_dest, passenger.lng_dest], {
        icon: getRouteMarkerIcon('dest', passenger.status_dest)
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

    // Create marker
    const marker = L.marker([passenger.lat, passenger.lng], {
      icon: getCustomMarkerIcon(passenger.status)
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
        const coords = await getCoordsWithFallback(passenger.originAddress, passenger.orig);
        if (coords) {
          passenger.lat_origin = coords.lat;
          passenger.lng_origin = coords.lng;
          passenger.status_origin = 'success';
        } else {
          passenger.status_origin = 'error';
        }
      } else {
        passenger.status_origin = 'none';
      }
      
      // 2. Geocode Destination
      if (passenger.destAddress) {
        passenger.status_dest = 'loading';
        const coords = await getCoordsWithFallback(passenger.destAddress, passenger.dest);
        if (coords) {
          passenger.lat_dest = coords.lat;
          passenger.lng_dest = coords.lng;
          passenger.status_dest = 'success';
        } else {
          passenger.status_dest = 'error';
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
      const coords = await getCoordsWithFallback(passenger.address, null);
      if (coords) {
        passenger.lat = coords.lat;
        passenger.lng = coords.lng;
        passenger.status = 'success';
      } else {
        passenger.status = 'error';
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
        else if (addrStatus === 'error')  { dotColor = 'var(--color-danger)'; dotTitle = 'Não encontrado — verifique o endereço'; }
        else if (addrStatus === 'none')   { dotColor = 'var(--text-muted)'; dotTitle = 'Não informado'; }
        return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0;margin-left:4px;" title="${dotTitle}"></span>`;
      };

      const origErrorHint = (p.status_origin === 'error')
        ? `<div class="addr-error-hint"><i data-lucide="alert-triangle" style="width:11px;height:11px;"></i> Endereço não localizado no mapa. Clique em <i data-lucide="edit-3" style="width:11px;height:11px;"></i> para corrigir.</div>`
        : '';
      const destErrorHint = (p.status_dest === 'error')
        ? `<div class="addr-error-hint"><i data-lucide="alert-triangle" style="width:11px;height:11px;"></i> Endereço não localizado no mapa. Clique em <i data-lucide="edit-3" style="width:11px;height:11px;"></i> para corrigir.</div>`
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
      addressHTML = `
        <div class="passenger-address-row" data-type="single">
          <i data-lucide="map-pin" class="address-icon"></i>
          <span class="address-text"><span class="val">${escapeHTML(p.address)}</span></span>
          <button class="btn-edit-addr" title="Editar Endereço"><i data-lucide="edit-3"></i></button>
        </div>
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

  // Clear dashboard data trigger
  btnClear.addEventListener('click', () => {
    if (confirm('Tem certeza que deseja limpar todos os passageiros e marcadores carregados?')) {
      clearAllData();
      showToast('Dados limpos com sucesso.', 'info');
    }
  });

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
      "Nome Passageiro",
      "endereco origem",
      "nº origem",
      "bairro origem",
      "municipio origem",
      "uf origem",
      "endereco destino",
      "nº destino",
      "bairro destino",
      "municipio destino",
      "uf destino"
    ];

    const data = [
      {
        "Nome Passageiro": "Carlos Silva",
        "endereco origem": "Avenida Paulista",
        "nº origem": "1000",
        "bairro origem": "Bela Vista",
        "municipio origem": "São Paulo",
        "uf origem": "SP",
        "endereco destino": "Avenida Atlântica",
        "nº destino": "1702",
        "bairro destino": "Copacabana",
        "municipio destino": "Rio de Janeiro",
        "uf destino": "RJ"
      },
      {
        "Nome Passageiro": "Maria Oliveira",
        "endereco origem": "Rua da Bahia",
        "nº origem": "1022",
        "bairro origem": "Centro",
        "municipio origem": "Belo Horizonte",
        "uf origem": "MG",
        "endereco destino": "Praça da Sé",
        "nº destino": "S/N",
        "bairro destino": "Centro",
        "municipio destino": "São Paulo",
        "uf destino": "SP"
      },
      {
        "Nome Passageiro": "João Santos",
        "endereco origem": "Avenida Rebouças",
        "nº origem": "500",
        "bairro origem": "Pinheiros",
        "municipio origem": "São Paulo",
        "uf origem": "SP",
        "endereco destino": "Avenida Brigadeiro Luís Antônio",
        "nº destino": "2300",
        "bairro destino": "Jardim Paulista",
        "municipio destino": "São Paulo",
        "uf destino": "SP"
      },
      {
        "Nome Passageiro": "Ana Costa",
        "endereco origem": "Rua das Flores",
        "nº origem": "120",
        "bairro origem": "Centro",
        "municipio origem": "Curitiba",
        "uf origem": "PR",
        "endereco destino": "Avenida Manoel Ribas",
        "nº destino": "2000",
        "bairro destino": "Santa Felicidade",
        "municipio destino": "Curitiba",
        "uf destino": "PR"
      }
    ];

    try {
      const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
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

});
