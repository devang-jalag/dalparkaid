// DalParkAid Interactive Campus Map, Commuter Dispatch & Lot Simulator
// Redesigned around Jakob Nielsen's 10 Usability Heuristics (Proprietary scoring details abstracted)

(function () {
  // Internal scoring lookup tables (kept private inside closure, never exposed in UI)
  const _base = 55;
  const _dayAdj = [10, -3, -4, -5, -4, -1, 7];
  const _hourAdj = [
    22, 22, 22, 20, 18, 14,
    6, -2, -8, -12, -16, -18,
    -18, -18, -15, -12, -8, -2,
    4, 8, 12, 15, 17, 18
  ];
  const _ratingMap = { 1: 10, 2: 30, 3: 50, 4: 72, 5: 88 };
  const _calAdj = {
    TEACHING_DAY: 0,
    EXAM_PERIOD: 2,
    READING_WEEK: 16,
    UNIVERSITY_CLOSED: 32
  };

  // Heuristic #2: Match between system and real world (clear, human-friendly status labels)
  const STATUS_META = {
    EMPTY: { label: 'Plenty of Spots', short: 'Open', color: '#22C55E', bg: 'rgba(34,197,94,0.16)', border: '#22C55E' },
    NORMAL: { label: 'Good Availability', short: 'Good', color: '#84CC16', bg: 'rgba(132,204,22,0.16)', border: '#84CC16' },
    CROWDED: { label: 'Filling Up', short: 'Busy', color: '#F59E0B', bg: 'rgba(245,158,11,0.16)', border: '#F59E0B' },
    ALMOST_FULL: { label: 'Almost Full', short: 'Low', color: '#EF4444', bg: 'rgba(239,68,68,0.16)', border: '#EF4444' },
    FULL: { label: 'Lot Full', short: 'Full', color: '#FF2E2E', bg: 'rgba(255,46,46,0.20)', border: '#FF2E2E' }
  };

  const state = {
    hour: 10,
    weekday: 2,
    weatherType: 'CLEAR',
    weatherTempC: 11,
    weatherWindKmh: 18,
    academicDayType: 'TEACHING_DAY',
    campusFilter: 'all',
    permitFilter: 'GENERAL', // GENERAL, RESERVED, SHORT_TERM
    selectedLotId: 'studley-dalplex',
    activeCharacterId: null,
    lastReportHistory: [], // For Heuristic #3: Undo Last Report
    injectedReports: {
      'studley-chemistry': [{ rating: 1, ageMins: 6 }],
      'studley-biology': [{ rating: 4, ageMins: 9 }],
      'studley-dalplex': [{ rating: 3, ageMins: 14 }],
      'sexton-rosina-lot': [{ rating: 4, ageMins: 8 }]
    }
  };

  const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));

  // Security Fix V6: HTML entity encoding helper to prevent DOM-based XSS in innerHTML / Leaflet divIcon templates
  function escapeHTML(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Heuristic #1: Visibility of system status via non-intrusive toast feedback
  let toastTimeout = null;
  function showToast(message) {
    const el = document.getElementById('status-toast');
    const txt = document.getElementById('status-toast-text');
    if (!el || !txt) return;
    txt.textContent = message;
    el.classList.remove('hidden', 'opacity-0');
    el.classList.add('opacity-100');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.classList.add('opacity-0');
      setTimeout(() => el.classList.add('hidden'), 250);
    }, 3200);
  }

  function isEveningHour(hour) {
    // Official Dalhousie evening window starts after 4:30 PM (modeled at 17:00 on hourly slider) until 1:30 AM
    return hour >= 17 || hour < 6;
  }

  function isOvernightBanHour(hour) {
    // Official Dalhousie overnight parking ban: 1:30 AM to 6:00 AM
    return hour >= 2 && hour < 6;
  }

  function computeLotStatus(lot, customHour = state.hour) {
    const evening = isEveningHour(customHour);
    const physicalCapacity = Math.max(
      (lot.generalSpaces || 0) + (lot.reservedSpaces || 0) + (lot.shortTermSpaces || 0),
      (lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0)
    );

    const wAdj = state.weatherType === 'STORM' ? -12
      : state.weatherType === 'SNOW' ? -10
      : state.weatherType === 'RAIN' ? -8 : 0;

    const sizeAdj = physicalCapacity >= 120 ? 9 : physicalCapacity >= 80 ? 5 : physicalCapacity >= 40 ? 0 : -6;
    const seed = Math.round(((lot.coordinate.latitude * 1000) % 7) - 3);

    let score = clamp(
      Math.round(
        _base +
        (_hourAdj[customHour] ?? 0) +
        (_dayAdj[state.weekday] ?? 0) +
        wAdj +
        sizeAdj +
        (_calAdj[state.academicDayType] ?? 0) -
        6 +
        seed
      )
    );

    const reports = customHour === state.hour ? (state.injectedReports[lot.id] || []) : [];
    if (reports.length > 0) {
      const avgCrowd = reports.reduce((s, r) => s + (_ratingMap[r.rating] || 50), 0) / reports.length;
      score = clamp(Math.round(score * 0.45 + avgCrowd * 0.55));
    }

    const statusKey = score >= 80 ? 'EMPTY'
      : score >= 58 ? 'NORMAL'
      : score >= 36 ? 'CROWDED'
      : score >= 16 ? 'ALMOST_FULL' : 'FULL';

    const estOpenSpaces = Math.max(0, Math.round((score / 100) * physicalCapacity));

    // Heuristic #5: Error Prevention (Check if lot supports the user's selected permit at this hour)
    let permitCompatible = true;
    let permitWarning = null;

    if (isOvernightBanHour(customHour)) {
      permitCompatible = false;
      permitWarning = 'Overnight Restriction: No general parking permitted between 1:30 AM and 6:00 AM without a special overnight pass.';
    } else if (!evening) {
      if (state.permitFilter === 'GENERAL' && (lot.generalSpaces || 0) === 0 && lot.campus !== 'hrm-expansion') {
        permitCompatible = false;
        permitWarning = `Permit Notice: ${lot.name} has 0 daytime General Permit stalls (${lot.reservedSpaces} Reserved, ${lot.shortTermSpaces} Short-Term). General access opens after 4:30 PM.`;
      } else if (state.permitFilter === 'SHORT_TERM' && (lot.shortTermSpaces || 0) === 0 && lot.campus !== 'hrm-expansion') {
        permitCompatible = false;
        permitWarning = `Permit Notice: ${lot.name} does not offer daytime Short-Term hourly spaces.`;
      }
    }

    return {
      lot,
      score,
      statusKey,
      statusMeta: STATUS_META[statusKey],
      evening,
      physicalCapacity,
      estOpenSpaces,
      reportCount: reports.length,
      permitCompatible,
      permitWarning
    };
  }

  function getActiveLots() {
    let list = [...window.DAL_LOTS];
    if (state.campusFilter === 'hrm-expansion') {
      list = [...window.HRM_EXPANSION_LOTS];
    } else if (state.campusFilter !== 'all') {
      list = list.filter(l => l.campus === state.campusFilter);
    }
    return list;
  }

  // ============================================================================
  // 1. INTERACTIVE CAMPUS MAP (GOOGLE MAPS + OPENSTREETMAP FALLBACK)
  // ============================================================================
  let map = null;
  let markersLayer = null;
  let vehicleLayer = null;
  let activeVehicleMarker = null;
  let vehicleAnimFrame = null;
  let currentTileLayer = null;

  const tileProviders = {
    googleRoads: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: 'Google Maps'
    }),
    googleHybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: 'Google Maps'
    }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: 'OpenStreetMap'
    })
  };

  tileProviders.googleHybrid.on('tileerror', function () {
    if (currentTileLayer === tileProviders.googleHybrid) setMapTileStyle('osm');
  });
  tileProviders.googleRoads.on('tileerror', function () {
    if (currentTileLayer === tileProviders.googleRoads) setMapTileStyle('osm');
  });

  function setMapTileStyle(styleKey) {
    if (!map || !tileProviders[styleKey]) return;
    if (currentTileLayer) map.removeLayer(currentTileLayer);
    currentTileLayer = tileProviders[styleKey];
    currentTileLayer.addTo(map);

    document.querySelectorAll('.map-style-btn').forEach(btn => {
      const active = btn.dataset.style === styleKey;
      btn.className = `map-style-btn px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
        active ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
      }`;
    });
  }

  function initGeospatialMap() {
    const mapEl = document.getElementById('halifax-map');
    if (!mapEl || typeof L === 'undefined') return;

    map = L.map('halifax-map', {
      center: [44.6378, -63.5885],
      zoom: 15,
      zoomControl: false,
      attributionControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    currentTileLayer = tileProviders.googleRoads;
    currentTileLayer.addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    vehicleLayer = L.layerGroup().addTo(map);

    populateQuickLotSelect();
    renderMapMarkers();
    renderCharacterCards();
    updateSelectedLotHUD();
  }

  // Heuristic #6: Recognition rather than recall (Quick Jump Dropdown for all 28 lots)
  function populateQuickLotSelect() {
    const select = document.getElementById('quick-lot-select');
    if (!select) return;
    const allLots = [...window.DAL_LOTS, ...window.HRM_EXPANSION_LOTS];
    select.innerHTML = allLots.map(lot => {
      const tag = lot.campus === 'hrm-expansion' ? 'HRM' : lot.campus === 'sexton' ? 'Sexton' : 'Studley';
      return `<option value="${escapeHTML(lot.id)}" ${lot.id === state.selectedLotId ? 'selected' : ''}>${escapeHTML(tag)}: ${escapeHTML(lot.name)}</option>`;
    }).join('');
  }

  function selectLotById(lotId, fly = true) {
    state.selectedLotId = lotId;
    const allLots = [...window.DAL_LOTS, ...window.HRM_EXPANSION_LOTS];
    const lot = allLots.find(l => l.id === lotId);
    const select = document.getElementById('quick-lot-select');
    if (select) select.value = lotId;

    if (lot && map && fly) {
      map.flyTo([lot.coordinate.latitude, lot.coordinate.longitude], 16, { duration: 0.6 });
    }
    renderMapMarkers();
    updateSelectedLotHUD();
    if (lot) syncLotPhysicsToSelected(lot);
  }

  function renderMapMarkers() {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    const lots = getActiveLots();
    let totalOpen = 0;
    let totalCap = 0;

    lots.forEach(lot => {
      const t = computeLotStatus(lot);
      totalOpen += t.estOpenSpaces;
      totalCap += t.physicalCapacity;

      const isSelected = lot.id === state.selectedLotId;
      const size = isSelected ? 42 : 32;
      const dimClass = !t.permitCompatible ? 'opacity-55' : '';

      const html = `
        <div class="lot-pin-wrapper ${isSelected ? 'is-selected' : ''} ${dimClass}" style="width:${size}px;height:${size}px;">
          <div class="lot-pin-pulse" style="border-color:${escapeHTML(t.statusMeta.color)}; background:${escapeHTML(t.statusMeta.bg)}"></div>
          <div class="lot-pin-core" style="background:${escapeHTML(t.statusMeta.color)}; box-shadow: 0 0 12px ${escapeHTML(t.statusMeta.color)};">
            <span>${escapeHTML(t.estOpenSpaces)}</span>
          </div>
          ${isSelected ? `<div class="lot-pin-label">${escapeHTML(lot.name)}</div>` : ''}
        </div>
      `;

      const icon = L.divIcon({
        html,
        className: 'custom-geospatial-pin',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      const marker = L.marker([lot.coordinate.latitude, lot.coordinate.longitude], { icon });
      marker.on('click', () => {
        selectLotById(lot.id, false);
      });
      marker.addTo(markersLayer);
    });

    const openEl = document.getElementById('hud-total-open');
    const capEl = document.getElementById('hud-total-cap');
    const occEl = document.getElementById('hud-occupancy-pct');
    if (openEl) openEl.textContent = totalOpen.toLocaleString();
    if (capEl) capEl.textContent = totalCap.toLocaleString();
    if (occEl && totalCap > 0) {
      const occ = Math.round(((totalCap - totalOpen) / totalCap) * 100);
      occEl.textContent = `${occ}%`;
    }
  }

  // Heuristic #9: Help users recognize, diagnose, and recover from errors (Find nearest open compatible lot)
  function findNearestRecommendedLot(referenceLot) {
    const candidates = window.DAL_LOTS
      .filter(l => l.id !== referenceLot.id)
      .map(l => computeLotStatus(l))
      .filter(t => t.permitCompatible && t.estOpenSpaces >= 8);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const distA = Math.hypot(
        a.lot.coordinate.latitude - referenceLot.coordinate.latitude,
        a.lot.coordinate.longitude - referenceLot.coordinate.longitude
      );
      const distB = Math.hypot(
        b.lot.coordinate.latitude - referenceLot.coordinate.latitude,
        b.lot.coordinate.longitude - referenceLot.coordinate.longitude
      );
      return distA - distB;
    });

    return candidates[0];
  }

  function updateSelectedLotHUD() {
    const allLots = [...window.DAL_LOTS, ...window.HRM_EXPANSION_LOTS];
    const lot = allLots.find(l => l.id === state.selectedLotId) || window.DAL_LOTS[0];
    const t = computeLotStatus(lot);

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('selected-lot-name', lot.name);
    setTxt('selected-lot-address', lot.address);
    setTxt('selected-lot-campus', lot.campus === 'hrm-expansion' ? lot.halifaxZone : `${lot.campus.toUpperCase()} CAMPUS`);
    setTxt('selected-lot-open', `${t.estOpenSpaces} of ${t.physicalCapacity} stalls`);
    setTxt('selected-lot-general', `${lot.generalSpaces}`);
    setTxt('selected-lot-reserved', `${lot.reservedSpaces}`);
    setTxt('selected-lot-short', `${lot.shortTermSpaces}`);
    setTxt('selected-lot-evening', `${(lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0)}`);
    setTxt('selected-lot-reports-count', `${t.reportCount} recent check-in${t.reportCount === 1 ? '' : 's'}`);

    const badge = document.getElementById('selected-lot-status-badge');
    if (badge) {
      badge.textContent = t.statusMeta.label;
      badge.style.backgroundColor = t.statusMeta.bg;
      badge.style.color = t.statusMeta.color;
      badge.style.borderColor = t.statusMeta.border;
    }

    const scoreBar = document.getElementById('selected-lot-score-bar');
    if (scoreBar) {
      scoreBar.style.width = `${t.score}%`;
      scoreBar.style.backgroundColor = t.statusMeta.color;
    }

    // Heuristic #5 & #9: Permit Warning + 1-Click Recovery Action
    const alertBox = document.getElementById('lot-recovery-alert');
    const alertText = document.getElementById('lot-recovery-text');
    const alertBtn = document.getElementById('lot-recovery-btn');

    if (alertBox && alertText && alertBtn) {
      if (!t.permitCompatible || t.statusKey === 'FULL' || t.statusKey === 'ALMOST_FULL') {
        const rec = findNearestRecommendedLot(lot);
        alertBox.classList.remove('hidden');
        alertText.textContent = !t.permitCompatible
          ? t.permitWarning
          : `${lot.name} is currently ${t.statusMeta.label.toLowerCase()} (${t.estOpenSpaces} stalls estimated).`;

        if (rec) {
          alertBtn.classList.remove('hidden');
          alertBtn.textContent = `Switch to ${rec.lot.name} (${rec.estOpenSpaces} open stalls) →`;
          alertBtn.onclick = () => {
            selectLotById(rec.lot.id, true);
            showToast(`Switched to ${rec.lot.name} (${rec.estOpenSpaces} open stalls)`);
          };
        } else {
          alertBtn.classList.add('hidden');
        }
      } else {
        alertBox.classList.add('hidden');
      }
    }

    render24HourSparkline(lot);
  }

  function render24HourSparkline(lot) {
    const container = document.getElementById('lot-24h-bars');
    if (!container) return;

    let html = '';
    for (let h = 6; h <= 22; h++) {
      const t = computeLotStatus(lot, h);
      const isCurrent = h === state.hour;
      const heightPct = Math.max(12, t.score);
      const label = h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`;
      html += `
        <div onclick="window.DalSim.setHour(${h})" title="${label}: ~${t.estOpenSpaces} open stalls" class="cursor-pointer flex-1 flex flex-col items-center group">
          <div class="w-full h-14 bg-slate-900/90 rounded-md flex items-end p-0.5 border ${isCurrent ? 'border-amber-400' : 'border-slate-800/70'}">
            <div class="w-full rounded-sm transition-all duration-300" style="height:${heightPct}%; background:${t.statusMeta.color}; opacity:${isCurrent ? '1' : '0.65'}"></div>
          </div>
          <span class="text-[9px] font-mono mt-1 ${isCurrent ? 'text-amber-400 font-bold' : 'text-slate-500'}">${label}</span>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  // ============================================================================
  // 2. COMMUTER PERSONA DISPATCH & ROUTE PREVIEW
  // ============================================================================
  function getCharacterAvatarSVG(char) {
    const c = char.vehicleColor;
    return `
      <svg viewBox="0 0 64 64" class="w-11 h-11 rounded-xl bg-slate-900 border border-slate-700/80 p-1 shrink-0">
        <circle cx="32" cy="22" r="11" fill="${c}" opacity="0.9"/>
        <path d="M14 54 C14 40 50 40 50 54" fill="${c}" opacity="0.35" stroke="${c}" stroke-width="2.5"/>
        <circle cx="28" cy="21" r="1.8" fill="#0B1424"/>
        <circle cx="36" cy="21" r="1.8" fill="#0B1424"/>
        <path d="M28 26 Q32 29 36 26" stroke="#0B1424" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>
    `;
  }

  function renderCharacterCards() {
    const container = document.getElementById('character-cards-grid');
    if (!container) return;

    container.innerHTML = window.COMMUTER_CHARACTERS.map(char => {
      const isActive = char.id === state.activeCharacterId;
      return `
        <div onclick="window.DalSim.dispatchCharacter('${escapeHTML(char.id)}')"
             class="cursor-pointer p-4 rounded-2xl border transition-all duration-200 ${
               isActive
                 ? 'bg-slate-900/95 border-amber-400 shadow-lg shadow-amber-400/10'
                 : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
             }">
          <div class="flex items-center gap-3 mb-2.5">
            ${getCharacterAvatarSVG(char)}
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h4 class="font-bold text-sm text-white truncate">${escapeHTML(char.name)}</h4>
                <span class="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-slate-800 text-amber-300">${escapeHTML(char.schedule.split(' ')[0])}</span>
              </div>
              <p class="text-xs text-slate-400 truncate">${escapeHTML(char.role)}</p>
              <p class="text-[11px] text-slate-500 truncate">${escapeHTML(char.permit)}</p>
            </div>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed mb-3">"${escapeHTML(char.quote)}"</p>
          <div class="flex items-center justify-between pt-2 border-t border-slate-800/80">
            <span class="text-[11px] font-medium flex items-center gap-1.5" style="color:${escapeHTML(char.vehicleColor)}">
              <span class="w-2 h-2 rounded-full" style="background:${escapeHTML(char.vehicleColor)}"></span>
              ${escapeHTML(char.vehicleName)}
            </span>
            <span class="text-[11px] font-bold px-2.5 py-1 rounded-lg ${
              isActive ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'
            }">
              ${isActive ? 'Route Active' : 'Preview Commute →'}
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  function clearDispatchedRoute() {
    if (vehicleAnimFrame) cancelAnimationFrame(vehicleAnimFrame);
    if (vehicleLayer) vehicleLayer.clearLayers();
    state.activeCharacterId = null;
    renderCharacterCards();
    const clearBtn = document.getElementById('clear-route-btn');
    if (clearBtn) clearBtn.classList.add('hidden');
    const logEl = document.getElementById('dispatch-telemetry-log');
    if (logEl) {
      logEl.innerHTML = 'Select a commuter profile below to preview how DalParkAid routes drivers around full campus lots.';
    }
  }

  function dispatchCharacter(charId) {
    state.activeCharacterId = charId;
    renderCharacterCards();

    const char = window.COMMUTER_CHARACTERS.find(c => c.id === charId);
    if (!char || !map || !vehicleLayer) return;

    if (vehicleAnimFrame) cancelAnimationFrame(vehicleAnimFrame);
    vehicleLayer.clearLayers();

    const evaluated = char.preferredLots
      .map(id => window.DAL_LOTS.find(l => l.id === id))
      .filter(Boolean)
      .map(lot => computeLotStatus(lot));

    const primary = evaluated[0];
    const best = [...evaluated].sort((a, b) => b.score - a.score)[0];
    const rerouted = best && primary && best.lot.id !== primary.lot.id && primary.score < 55;

    const targetTelemetry = rerouted ? best : primary;
    if (!targetTelemetry) return;

    selectLotById(targetTelemetry.lot.id, false);

    const pathCoords = [
      char.startCoord,
      ...char.waypoints.slice(1, 3),
      [primary.lot.coordinate.latitude, primary.lot.coordinate.longitude]
    ];

    if (rerouted) {
      pathCoords.push([targetTelemetry.lot.coordinate.latitude, targetTelemetry.lot.coordinate.longitude]);
    }

    map.flyTo([targetTelemetry.lot.coordinate.latitude, targetTelemetry.lot.coordinate.longitude], 15, {
      duration: 0.8
    });

    L.polyline(pathCoords, {
      color: char.vehicleColor,
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.9
    }).addTo(vehicleLayer);

    if (rerouted) {
      const bypassIcon = L.divIcon({
        className: 'bypass-beacon',
        html: `<div class="px-2 py-0.5 rounded bg-rose-600 text-white font-mono text-[10px] font-bold shadow-lg whitespace-nowrap border border-rose-300">
          BYPASSED: ${escapeHTML(primary.lot.name.toUpperCase())} (${escapeHTML(primary.statusMeta.short.toUpperCase())})
        </div>`,
        iconSize: [160, 24],
        iconAnchor: [80, -18]
      });
      L.marker(
        [primary.lot.coordinate.latitude, primary.lot.coordinate.longitude],
        { icon: bypassIcon }
      ).addTo(vehicleLayer);
    }

    const clearBtn = document.getElementById('clear-route-btn');
    if (clearBtn) clearBtn.classList.remove('hidden');

    const logEl = document.getElementById('dispatch-telemetry-log');
    if (logEl) {
      logEl.innerHTML = rerouted
        ? `<span class="text-amber-400 font-bold">[Simulated Reroute]</span> ${escapeHTML(char.name)}'s first-choice lot (<strong>${escapeHTML(primary.lot.name)}</strong>) is ${escapeHTML(primary.statusMeta.label.toLowerCase())}. DalParkAid redirects the trip to <strong>${escapeHTML(targetTelemetry.lot.name)}</strong> (~${escapeHTML(targetTelemetry.estOpenSpaces)} open spaces).`
        : `<span class="text-emerald-400 font-bold">[Simulated Direct Arrival]</span> ${escapeHTML(char.name)}'s primary lot (<strong>${escapeHTML(targetTelemetry.lot.name)}</strong>) has good availability (~${escapeHTML(targetTelemetry.estOpenSpaces)} open spaces).`;
    }

    animateVehicleAlongPath(pathCoords, char);
  }

  function animateVehicleAlongPath(coords, char) {
    if (!coords || coords.length < 2) return;

    const vehicleHtml = `
      <div class="vehicle-marker-node" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
        <div class="vehicle-radar-cone" style="border-bottom-color:${char.vehicleColor}"></div>
        <svg viewBox="0 0 32 32" class="w-8 h-8 drop-shadow-lg">
          <rect x="8" y="4" width="16" height="24" rx="5" fill="${char.vehicleColor}" stroke="#0B1424" stroke-width="2"/>
          <rect x="10" y="8" width="12" height="6" rx="2" fill="#0B1424" opacity="0.85"/>
          <rect x="10" y="19" width="12" height="4" rx="1.5" fill="#0B1424" opacity="0.75"/>
          <circle cx="11" cy="5" r="1.5" fill="#FEF08A"/>
          <circle cx="21" cy="5" r="1.5" fill="#FEF08A"/>
        </svg>
      </div>
    `;

    const icon = L.divIcon({
      html: vehicleHtml,
      className: 'animated-car-icon',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    activeVehicleMarker = L.marker(coords[0], { icon, zIndexOffset: 1000 }).addTo(vehicleLayer);

    let segmentIndex = 0;
    let progress = 0;
    const speed = 0.014;

    function step() {
      if (!activeVehicleMarker) return;
      progress += speed;
      if (progress >= 1) {
        progress = 0;
        segmentIndex++;
        if (segmentIndex >= coords.length - 1) {
          segmentIndex = 0;
        }
      }

      const start = coords[segmentIndex];
      const end = coords[segmentIndex + 1];
      const lat = start[0] + (end[0] - start[0]) * progress;
      const lng = start[1] + (end[1] - start[1]) * progress;

      activeVehicleMarker.setLatLng([lat, lng]);
      vehicleAnimFrame = requestAnimationFrame(step);
    }

    vehicleAnimFrame = requestAnimationFrame(step);
  }

  // ============================================================================
  // 3. TOP-DOWN PARKING LOT STALL SIMULATOR CANVAS
  // ============================================================================
  const lotSim = {
    canvas: null,
    ctx: null,
    smartGateEnabled: true,
    stalls: [],
    cars: [],
    stats: {
      parkedCount: 0,
      reroutedSavedCount: 0,
      frustratedCirclingCount: 0
    },
    lotName: 'Dalplex Lot'
  };

  function initLotPhysicsCanvas() {
    const canvas = document.getElementById('lot-physics-canvas');
    if (!canvas) return;
    lotSim.canvas = canvas;
    lotSim.ctx = canvas.getContext('2d');

    buildStallGrid(0.65);

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      for (const stall of lotSim.stalls) {
        if (x >= stall.x && x <= stall.x + stall.w && y >= stall.y && y <= stall.y + stall.h) {
          stall.occupied = !stall.occupied;
          stall.carColor = stall.occupied ? pickRandomCarColor() : null;
          updateLotSimStatsUI();
          return;
        }
      }

      spawnLotVehicle();
    });

    setInterval(() => {
      if (lotSim.cars.length < 4) {
        spawnLotVehicle();
      }
    }, 2600);

    requestAnimationFrame(renderLotPhysicsLoop);
  }

  function pickRandomCarColor() {
    const palette = ['#F2C94C', '#38BDF8', '#22C55E', '#A855F7', '#F43F5E', '#E2E8F0', '#FB923C'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  function buildStallGrid(occupancyRatio = 0.65) {
    lotSim.stalls = [];
    lotSim.cars = [];
    const cols = 12;
    const stallW = 48;
    const stallH = 74;
    const startX = 110;
    const topRowY = 26;
    const bottomRowY = 220;

    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < cols; col++) {
        const occupied = Math.random() < occupancyRatio;
        lotSim.stalls.push({
          id: row * cols + col,
          row,
          col,
          x: startX + col * (stallW + 6),
          y: row === 0 ? topRowY : bottomRowY,
          w: stallW,
          h: stallH,
          occupied,
          reservedByCar: false,
          carColor: occupied ? pickRandomCarColor() : null,
          type: col < 2 ? 'RESERVED' : col > 9 ? 'SHORT_TERM' : 'GENERAL'
        });
      }
    }
    updateLotSimStatsUI();
  }

  function resetLotSim() {
    lotSim.stats.parkedCount = 0;
    lotSim.stats.reroutedSavedCount = 0;
    lotSim.stats.frustratedCirclingCount = 0;
    buildStallGrid(0.5);
    showToast('Lot simulator reset to 50% occupancy');
  }

  function syncLotPhysicsToSelected(lot) {
    if (!lot) return;
    const t = computeLotStatus(lot);
    lotSim.lotName = lot.name;
    const occRatio = clamp((100 - t.score) / 100, 0.1, 0.95);
    buildStallGrid(occRatio);
    const titleEl = document.getElementById('canvas-lot-title');
    if (titleEl) titleEl.textContent = `${lot.name} (${t.physicalCapacity} Total Stalls)`;
  }

  function spawnLotVehicle() {
    const openStalls = lotSim.stalls.filter(s => !s.occupied && !s.reservedByCar);
    const color = pickRandomCarColor();

    if (openStalls.length === 0 && lotSim.smartGateEnabled) {
      lotSim.stats.reroutedSavedCount++;
      lotSim.cars.push({
        x: 10,
        y: 145,
        vx: 3.4,
        vy: 0,
        color,
        state: 'INTERCEPTED_AT_GATE',
        targetStall: null,
        label: 'REROUTED TO OPEN LOT',
        alpha: 1
      });
      updateLotSimStatsUI();
      return;
    }

    let targetStall = null;
    if (openStalls.length > 0) {
      targetStall = openStalls[Math.floor(Math.random() * openStalls.length)];
      targetStall.reservedByCar = true;
    } else {
      lotSim.stats.frustratedCirclingCount++;
    }

    lotSim.cars.push({
      x: 10,
      y: 158,
      vx: 3.2,
      vy: 0,
      color,
      state: targetStall ? 'DRIVING_TO_STALL' : 'CIRCLING_FULL_LOT',
      targetStall,
      label: targetStall ? `STALL #${targetStall.id + 1}` : 'LOT FULL! CIRCLING...',
      alpha: 1
    });
    updateLotSimStatsUI();
  }

  function triggerLectureRushWave() {
    lotSim.stalls.forEach((s, idx) => {
      if (idx % 11 !== 0) {
        s.occupied = true;
        s.carColor = pickRandomCarColor();
      }
    });
    for (let i = 0; i < 6; i++) {
      setTimeout(() => spawnLotVehicle(), i * 320);
    }
    updateLotSimStatsUI();
    showToast('Simulated 9:25 AM lecture rush wave triggered');
  }

  function toggleSmartGate() {
    lotSim.smartGateEnabled = !lotSim.smartGateEnabled;
    const btn = document.getElementById('smart-gate-toggle-btn');
    if (btn) {
      btn.textContent = lotSim.smartGateEnabled
        ? 'Pre-Trip Rerouting: ON'
        : 'Pre-Trip Rerouting: OFF (Blind Arrival)';
      btn.className = lotSim.smartGateEnabled
        ? 'px-3.5 py-2 rounded-xl text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 transition'
        : 'px-3.5 py-2 rounded-xl text-xs font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 transition';
    }
    showToast(lotSim.smartGateEnabled ? 'Pre-trip rerouting enabled' : 'Pre-trip rerouting disabled (cars will enter full lot)');
  }

  function updateLotSimStatsUI() {
    const openCount = lotSim.stalls.filter(s => !s.occupied).length;
    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    setTxt('sim-open-stalls', `${openCount} / ${lotSim.stalls.length}`);
    setTxt('sim-rerouted-count', lotSim.stats.reroutedSavedCount);
    setTxt('sim-circling-count', lotSim.stats.frustratedCirclingCount);
  }

  function drawTopDownCar(ctx, x, y, w, h, color, isHorizontal = false, isFrustrated = false) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = isFrustrated ? '#EF4444' : '#0B1424';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    if (isHorizontal) {
      ctx.fillRect(x + w * 0.55, y + 4, w * 0.24, h - 8);
      ctx.fillRect(x + w * 0.15, y + 5, w * 0.18, h - 10);
      ctx.fillStyle = 'rgba(254, 240, 138, 0.35)';
      ctx.beginPath();
      ctx.moveTo(x + w, y + 4);
      ctx.lineTo(x + w + 24, y - 4);
      ctx.lineTo(x + w + 24, y + h + 4);
      ctx.lineTo(x + w, y + h - 4);
      ctx.fill();
    } else {
      ctx.fillRect(x + 5, y + 10, w - 10, h * 0.25);
      ctx.fillRect(x + 6, y + h * 0.62, w - 12, h * 0.18);
    }
    ctx.restore();
  }

  function renderLotPhysicsLoop() {
    const { ctx, canvas } = lotSim;
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#0B1322';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = lotSim.smartGateEnabled ? 'rgba(34, 197, 94, 0.10)' : 'rgba(239, 68, 68, 0.08)';
    ctx.fillRect(0, 108, 96, 104);
    ctx.strokeStyle = lotSim.smartGateEnabled ? '#22C55E' : '#EF4444';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(4, 110, 88, 100);
    ctx.setLineDash([]);

    ctx.fillStyle = lotSim.smartGateEnabled ? '#22C55E' : '#F87171';
    ctx.font = 'bold 9px JetBrains Mono, monospace';
    ctx.fillText(lotSim.smartGateEnabled ? 'DALPARKAID' : 'NO APP CHECK', 12, 130);
    ctx.fillText(lotSim.smartGateEnabled ? 'ROUTE CHECK' : 'BLIND ENTRY', 12, 142);

    ctx.strokeStyle = 'rgba(242, 201, 76, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 12]);
    ctx.beginPath();
    ctx.moveTo(95, 160);
    ctx.lineTo(765, 160);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const stall of lotSim.stalls) {
      ctx.strokeStyle = stall.type === 'RESERVED'
        ? 'rgba(56, 189, 248, 0.5)'
        : stall.type === 'SHORT_TERM'
          ? 'rgba(168, 85, 247, 0.5)'
          : 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(stall.x, stall.y, stall.w, stall.h);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(`#${stall.id + 1}`, stall.x + 6, stall.y + 14);

      if (stall.occupied) {
        drawTopDownCar(ctx, stall.x + 8, stall.y + 8, stall.w - 16, stall.h - 16, stall.carColor || '#F2C94C', false, false);
      } else {
        ctx.fillStyle = '#22C55E';
        ctx.beginPath();
        ctx.arc(stall.x + stall.w / 2, stall.y + stall.h / 2 + 6, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let i = lotSim.cars.length - 1; i >= 0; i--) {
      const car = lotSim.cars[i];

      if (car.state === 'INTERCEPTED_AT_GATE') {
        car.x += car.vx * 0.5;
        car.y -= 2.1;
        car.alpha -= 0.018;
        drawTopDownCar(ctx, car.x, car.y, 40, 22, car.color, true, false);

        ctx.fillStyle = '#22C55E';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText(car.label, car.x, Math.max(14, car.y - 6));

        if (car.alpha <= 0 || car.y < -20) {
          lotSim.cars.splice(i, 1);
        }
        continue;
      }

      if (car.state === 'DRIVING_TO_STALL' && car.targetStall) {
        const targetX = car.targetStall.x + 4;
        if (car.x < targetX) {
          car.x += car.vx;
          drawTopDownCar(ctx, car.x, car.y - 11, 42, 22, car.color, true, false);
          ctx.fillStyle = '#F2C94C';
          ctx.font = 'bold 9px JetBrains Mono, monospace';
          ctx.fillText(car.label, car.x, car.y - 16);
        } else {
          car.targetStall.occupied = true;
          car.targetStall.reservedByCar = false;
          car.targetStall.carColor = car.color;
          lotSim.stats.parkedCount++;
          lotSim.cars.splice(i, 1);
          updateLotSimStatsUI();
        }
        continue;
      }

      if (car.state === 'CIRCLING_FULL_LOT') {
        car.x += car.vx * 1.15;
        drawTopDownCar(ctx, car.x, car.y - 11, 42, 22, '#EF4444', true, true);
        ctx.fillStyle = '#F87171';
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText(car.label, car.x - 10, car.y - 16);

        if (car.x > canvas.width + 40) {
          lotSim.cars.splice(i, 1);
        }
      }
    }

    requestAnimationFrame(renderLotPhysicsLoop);
  }

  // ============================================================================
  // 4. OPEN-METEO LIVE HALIFAX WEATHER & COMMUNITY CHECK-INS
  // ============================================================================
  async function fetchLiveHalifaxWeather() {
    try {
      const res = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=44.6368&longitude=-63.5917&current=temperature_2m,weather_code,wind_speed_10m'
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.current) {
        state.weatherTempC = Math.round(data.current.temperature_2m);
        state.weatherWindKmh = Math.round(data.current.wind_speed_10m);
        const code = data.current.weather_code;
        if ([95, 96, 99].includes(code)) state.weatherType = 'STORM';
        else if ([71, 73, 75, 77, 85, 86].includes(code)) state.weatherType = 'SNOW';
        else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) state.weatherType = 'RAIN';
        else state.weatherType = 'CLEAR';

        updateWeatherUI();
        refreshAllViews();
      }
    } catch (_) {
      // Offline fallback remains active
    }
  }

  function updateWeatherUI() {
    const tempEl = document.getElementById('live-halifax-temp');
    const windEl = document.getElementById('live-halifax-wind');
    if (tempEl) tempEl.textContent = `Halifax: ${state.weatherTempC}°C`;
    if (windEl) windEl.textContent = `Wind: ${state.weatherWindKmh} km/h`;

    document.querySelectorAll('.weather-btn').forEach(btn => {
      const active = btn.dataset.weather === state.weatherType;
      btn.className = `weather-btn px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
        active
          ? 'bg-amber-400 text-slate-950 border-amber-400 font-bold'
          : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
      }`;
    });
  }

  function injectCrowdReport(rating) {
    const lotId = state.selectedLotId;
    if (!state.injectedReports[lotId]) {
      state.injectedReports[lotId] = [];
    }
    state.injectedReports[lotId].unshift({
      rating: Number(rating),
      ageMins: 1
    });
    state.lastReportHistory.push(lotId);

    const undoBtn = document.getElementById('undo-report-btn');
    if (undoBtn) undoBtn.classList.remove('hidden');

    const labels = { 1: 'Full', 2: 'Busy', 3: 'Moderate', 4: 'Open', 5: 'Empty' };
    showToast(`Logged "${labels[rating]}" check-in for selected lot`);
    refreshAllViews();
  }

  // Heuristic #3: User control and freedom (Undo last crowd check-in)
  function undoLastReport() {
    const lastLotId = state.lastReportHistory.pop();
    if (lastLotId && state.injectedReports[lastLotId] && state.injectedReports[lastLotId].length > 0) {
      state.injectedReports[lastLotId].shift();
      showToast('Undid last community check-in');
      refreshAllViews();
    }
    if (state.lastReportHistory.length === 0) {
      const undoBtn = document.getElementById('undo-report-btn');
      if (undoBtn) undoBtn.classList.add('hidden');
    }
  }

  // ============================================================================
  // 5. ILLUSTRATIVE COMMUTER SCENARIO CALCULATOR (WITH VERIFIED HRM $45 FINE)
  // ============================================================================
  function updateCommuterCalculator() {
    const daysPerWeek = Number(document.getElementById('calc-days')?.value || 4);
    const arrivalHour = Number(document.getElementById('calc-hour')?.value || 10);
    const ticketCount = Number(document.getElementById('calc-tickets')?.value || 1);

    const peakMultiplier = (arrivalHour >= 9 && arrivalHour <= 13) ? 1.25 : (arrivalHour >= 14 && arrivalHour <= 16) ? 0.9 : 0.4;
    const minsPerTrip = Math.round(12 * peakMultiplier);
    const weeksPerAcademicYear = 32; // Two 16-week terms (Fall + Winter)
    const totalTrips = daysPerWeek * weeksPerAcademicYear;

    const hoursSearching = Math.round((totalTrips * minsPerTrip) / 60);
    // Official HRM municipal parking violation fine is $45 ($40 if paid within 7 days)
    const hrmTicketFine = 45;
    const estFuelAndFines = Math.round((hoursSearching * 5.5) + (ticketCount * hrmTicketFine));
    const estCo2Kg = Math.round(hoursSearching * 3.8);

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    setTxt('calc-days-val', `${daysPerWeek} days/wk`);
    setTxt('calc-hour-val', `${arrivalHour}:00`);
    setTxt('calc-tickets-val', `${ticketCount} ticket${ticketCount === 1 ? '' : 's'}/yr`);
    setTxt('calc-hours-lost', `~${hoursSearching} hrs`);
    setTxt('calc-money-lost', `~$${estFuelAndFines}`);
    setTxt('calc-co2-lost', `~${estCo2Kg} kg`);
  }

  function refreshAllViews() {
    const hourLabel = state.hour === 0 ? '12:00 AM'
      : state.hour === 12 ? '12:00 PM'
      : state.hour > 12 ? `${state.hour - 12}:00 PM` : `${state.hour}:00 AM`;

    const ruleNote = isOvernightBanHour(state.hour)
      ? 'Overnight Ban Window (1:30 AM to 6:00 AM)'
      : isEveningHour(state.hour)
        ? 'Evening Period (After 4:30 PM: Reserved Stalls Open to Permits)'
        : 'Daytime Permit Period (6:00 AM to 4:30 PM)';

    const timeDisplay = document.getElementById('scrubber-time-display');
    if (timeDisplay) {
      timeDisplay.textContent = `${hourLabel} • ${ruleNote}`;
    }

    renderMapMarkers();
    updateSelectedLotHUD();
  }

  function resetAllFilters() {
    state.hour = 10;
    state.weatherType = 'CLEAR';
    state.academicDayType = 'TEACHING_DAY';
    state.campusFilter = 'all';
    state.permitFilter = 'GENERAL';
    clearDispatchedRoute();

    const slider = document.getElementById('hour-scrubber');
    if (slider) slider.value = 10;
    const calSel = document.getElementById('academic-day-select');
    if (calSel) calSel.value = 'TEACHING_DAY';
    const permSel = document.getElementById('permit-filter-select');
    if (permSel) permSel.value = 'GENERAL';

    window.DalSim.setCampusFilter('all');
    updateWeatherUI();
    refreshAllViews();
    showToast('Reset map filters to default daytime view');
  }

  window.DalSim = {
    setHour(h) {
      state.hour = Number(h);
      const slider = document.getElementById('hour-scrubber');
      if (slider) slider.value = state.hour;
      refreshAllViews();
    },
    setWeather(w) {
      state.weatherType = w;
      updateWeatherUI();
      refreshAllViews();
    },
    setAcademicDay(dayType) {
      state.academicDayType = dayType;
      refreshAllViews();
    },
    setPermitFilter(permit) {
      state.permitFilter = permit;
      refreshAllViews();
      showToast(`Filtered compatibility for ${permit.replace('_', ' ').toLowerCase()} permits`);
    },
    setCampusFilter(campus) {
      state.campusFilter = campus;
      document.querySelectorAll('.campus-filter-btn').forEach(btn => {
        const active = btn.dataset.campus === campus;
        btn.className = `campus-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
          active ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700'
        }`;
      });
      if (map) {
        if (campus === 'sexton') map.flyTo([44.6419, -63.5738], 16, { duration: 0.7 });
        else if (campus === 'studley') map.flyTo([44.6368, -63.5918], 15, { duration: 0.7 });
        else if (campus === 'hrm-expansion') map.flyTo([44.6435, -63.5830], 14, { duration: 0.7 });
        else map.flyTo([44.6385, -63.5865], 14, { duration: 0.7 });
      }
      refreshAllViews();
    },
    selectLotById,
    setMapTileStyle,
    locateUserNearestLot() {
      if (!navigator.geolocation) {
        showToast('Geolocation is not supported by this browser');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude, longitude } = pos.coords;
          if (map) {
            map.flyTo([latitude, longitude], 16);
            L.circleMarker([latitude, longitude], {
              radius: 8,
              color: '#38BDF8',
              fillColor: '#38BDF8',
              fillOpacity: 0.9
            }).addTo(map).bindPopup('Your Location').openPopup();
          }
          showToast('Centered map on your GPS coordinates');
        },
        () => {
          if (map) map.flyTo([44.6378, -63.5885], 16);
          showToast('Location permission declined; centered on Studley Campus');
        }
      );
    },
    dispatchCharacter,
    clearDispatchedRoute,
    injectCrowdReport,
    undoLastReport,
    triggerLectureRushWave,
    toggleSmartGate,
    spawnLotVehicle,
    resetLotSim,
    resetAllFilters,
    updateCommuterCalculator
  };

  window.addEventListener('DOMContentLoaded', () => {
    initGeospatialMap();
    initLotPhysicsCanvas();
    updateWeatherUI();
    updateCommuterCalculator();
    fetchLiveHalifaxWeather();
  });
})();
