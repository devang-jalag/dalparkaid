// DalParkAid Geospatial Telemetry, Prediction Engine & Top-Down Vehicle Physics Simulator
// Ported from src/utils/engine.js with real-time Leaflet & HTML5 Canvas rendering

(function () {
  const BASE_SCORE = 55;
  const FRESHNESS_DECAY_MINS = 45;
  const MAX_CROWD_ALPHA = 0.9;
  const CROWD_CONFIDENCE_CURVE_K = 2.2;

  const dayAdjustment = [10, -3, -4, -5, -4, -1, 7];
  const hourAdjustment = [
    22, 22, 22, 20, 18, 14,
    6, -2, -8, -12, -16, -18,
    -18, -18, -15, -12, -8, -2,
    4, 8, 12, 15, 17, 18
  ];

  const ratingScoreMap = { 1: 10, 2: 30, 3: 50, 4: 72, 5: 88 };

  const academicDayAdjustment = {
    TEACHING_DAY: 0,
    FRIDAY_SCHEDULE_OVERRIDE: -2,
    EXAM_PERIOD: 2,
    READING_WEEK: 16,
    WINTER_BREAK: 20,
    UNIVERSITY_CLOSED: 32
  };

  const STATUS_META = {
    EMPTY: { label: 'Empty', color: '#22C55E', bg: 'rgba(34,197,94,0.16)', border: '#22C55E' },
    NORMAL: { label: 'Normal', color: '#84CC16', bg: 'rgba(132,204,22,0.16)', border: '#84CC16' },
    CROWDED: { label: 'Crowded', color: '#F59E0B', bg: 'rgba(245,158,11,0.16)', border: '#F59E0B' },
    ALMOST_FULL: { label: 'Almost Full', color: '#EF4444', bg: 'rgba(239,68,68,0.16)', border: '#EF4444' },
    FULL: { label: 'Full', color: '#FF2E2E', bg: 'rgba(255,46,46,0.20)', border: '#FF2E2E' }
  };

  // Global Simulator State
  const state = {
    hour: 10,
    weekday: 2, // Tuesday peak
    weatherType: 'CLEAR', // CLEAR, RAIN, SNOW, FOG, STORM
    weatherTempC: 11,
    weatherWindKmh: 18,
    liveWeatherLoaded: false,
    academicDayType: 'TEACHING_DAY',
    campusLoadIndex: 0.72,
    campusFilter: 'all', // all, studley, sexton, hrm-expansion
    showHrmExpansion: false,
    selectedLotId: 'studley-dalplex',
    activeCharacterId: 'maya',
    injectedReports: {
      'studley-chemistry': [{ rating: 1, ageMins: 6, hasProof: true, voteMultiplier: 1.5 }],
      'studley-biology': [{ rating: 4, ageMins: 9, hasProof: true, voteMultiplier: 1.3 }],
      'studley-dalplex': [{ rating: 3, ageMins: 14, hasProof: true, voteMultiplier: 1.2 }],
      'sexton-rosina-lot': [{ rating: 4, ageMins: 8, hasProof: false, voteMultiplier: 1.1 }]
    }
  };

  const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));

  function getWeatherAdjustment(type) {
    switch (type) {
      case 'STORM': return -12;
      case 'SNOW': return -10;
      case 'RAIN': return -8;
      case 'FOG': return -4;
      default: return 0;
    }
  }

  function getLotSizeAdjustment(capacity) {
    if (capacity >= 120) return 9;
    if (capacity >= 80) return 5;
    if (capacity >= 40) return 0;
    if (capacity >= 20) return -5;
    return -9;
  }

  function getLotTypeTimeAdjustment(lotType, hour) {
    switch (lotType) {
      case 'RESIDENCE_LOT':
        if (hour <= 6) return -6;
        if (hour <= 16) return 6;
        return -8;
      case 'PARKADE_LOT':
        return 2;
      case 'EVENT_LOT':
        if (hour >= 7 && hour <= 14) return 3;
        if (hour >= 17 && hour <= 22) return -8;
        return 0;
      default:
        return 0;
    }
  }

  function scoreToStatus(n) {
    if (n >= 80) return 'EMPTY';
    if (n >= 58) return 'NORMAL';
    if (n >= 36) return 'CROWDED';
    if (n >= 16) return 'ALMOST_FULL';
    return 'FULL';
  }

  function isEveningHour(hour) {
    return hour >= 17 || hour < 6;
  }

  function computeLotTelemetry(lot, customHour = state.hour) {
    const evening = isEveningHour(customHour);
    const usableCapacity = evening
      ? (lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0)
      : (lot.generalSpaces || 0) + (lot.shortTermSpaces || 0);

    const physicalCapacity = Math.max(
      (lot.generalSpaces || 0) + (lot.reservedSpaces || 0) + (lot.shortTermSpaces || 0),
      (lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0)
    );

    const refCapacity = Math.max(
      usableCapacity,
      (lot.generalSpaces || 0) + (lot.shortTermSpaces || 0) + (lot.reservedSpaces || 0) * 0.35
    );

    // Deterministic subtle variation by lot coordinates so lots don't look identical
    const spatialSeed = Math.round(((lot.coordinate.latitude * 1000) % 7) - 3);

    const factors = {
      base: BASE_SCORE,
      hour: hourAdjustment[customHour] ?? 0,
      day: dayAdjustment[state.weekday] ?? 0,
      weather: getWeatherAdjustment(state.weatherType),
      lotSize: getLotSizeAdjustment(refCapacity),
      academicDay: academicDayAdjustment[state.academicDayType] ?? 0,
      campusLoad: Math.round(8 - clamp(state.campusLoadIndex, 0, 1) * 20),
      lotTypeTime: getLotTypeTimeAdjustment(lot.lotType, customHour),
      spatialSeed
    };

    const engineScore = clamp(
      Math.round(
        factors.base +
        factors.hour +
        factors.day +
        factors.weather +
        factors.lotSize +
        factors.academicDay +
        factors.campusLoad +
        factors.lotTypeTime +
        factors.spatialSeed
      )
    );

    // Crowd report aggregation (from src/utils/engine.js)
    const reports = customHour === state.hour ? (state.injectedReports[lot.id] || []) : [];
    let finalScore = engineScore;
    let alpha = 0;
    let crowdScore = null;

    if (reports.length > 0) {
      let totalWeight = 0;
      let weightedSum = 0;
      reports.forEach(r => {
        const freshness = Math.exp(-r.ageMins / FRESHNESS_DECAY_MINS);
        const proof = r.hasProof ? 1.15 : 1.0;
        const w = freshness * proof * (r.voteMultiplier || 1.0);
        totalWeight += w;
        weightedSum += (ratingScoreMap[r.rating] || 50) * w;
      });
      if (totalWeight > 0) {
        crowdScore = Math.round(weightedSum / totalWeight);
        const confidenceBase = MAX_CROWD_ALPHA * (1 - Math.exp(-totalWeight / CROWD_CONFIDENCE_CURVE_K));
        alpha = Math.min(MAX_CROWD_ALPHA, Math.max(0.38, confidenceBase + 0.08));
        finalScore = clamp(Math.round((1 - alpha) * engineScore + alpha * crowdScore));
      }
    }

    const statusKey = scoreToStatus(finalScore);
    const estOpenSpaces = Math.max(0, Math.round((finalScore / 100) * physicalCapacity));
    const occupiedSpaces = Math.max(0, physicalCapacity - estOpenSpaces);

    return {
      lot,
      engineScore,
      crowdScore,
      alpha: Math.round(alpha * 100),
      finalScore,
      statusKey,
      statusMeta: STATUS_META[statusKey],
      evening,
      usableCapacity,
      physicalCapacity,
      estOpenSpaces,
      occupiedSpaces,
      factors,
      reportCount: reports.length
    };
  }

  function getActiveLots() {
    let list = [...window.DAL_LOTS];
    if (state.showHrmExpansion || state.campusFilter === 'hrm-expansion') {
      list = list.concat(window.HRM_EXPANSION_LOTS);
    }
    if (state.campusFilter !== 'all') {
      list = list.filter(l => l.campus === state.campusFilter);
    }
    return list;
  }

  // ============================================================================
  // 1. GEOSPATIAL COMMAND MAP (LEAFLET + ANIMATED VEHICLES & RADAR CONES)
  // ============================================================================
  let map = null;
  let markersLayer = null;
  let vehicleLayer = null;
  let routePolyline = null;
  let rejectedMarker = null;
  let activeVehicleMarker = null;
  let vehicleAnimFrame = null;
  let currentTileLayer = null;

  const tileProviders = {
    googleHybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: 'Google Maps'
    }),
    googleRoads: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: 'Google Maps'
    }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: 'OpenStreetMap'
    })
  };

  // Automatic error fallback: If Google Maps fails to load, gracefully fall back to OpenStreetMap
  tileProviders.googleHybrid.on('tileerror', function () {
    if (currentTileLayer === tileProviders.googleHybrid) {
      setMapTileStyle('osm');
      const badge = document.getElementById('map-engine-badge');
      if (badge) badge.textContent = 'FALLBACK: OPENSTREETMAP ACTIVE';
    }
  });

  tileProviders.googleRoads.on('tileerror', function () {
    if (currentTileLayer === tileProviders.googleRoads) {
      setMapTileStyle('osm');
      const badge = document.getElementById('map-engine-badge');
      if (badge) badge.textContent = 'FALLBACK: OPENSTREETMAP ACTIVE';
    }
  });

  function setMapTileStyle(styleKey) {
    if (!map || !tileProviders[styleKey]) return;
    if (currentTileLayer) map.removeLayer(currentTileLayer);
    currentTileLayer = tileProviders[styleKey];
    currentTileLayer.addTo(map);

    const badge = document.getElementById('map-engine-badge');
    if (badge) {
      if (styleKey.startsWith('google')) {
        badge.textContent = 'GOOGLE MAPS SDK ENGINE';
        badge.className = 'hidden sm:inline-block px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 text-[9px] font-mono font-bold mr-1';
      } else {
        badge.textContent = 'OPENSTREETMAP FALLBACK ENGINE';
        badge.className = 'hidden sm:inline-block px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-mono font-bold mr-1';
      }
    }

    document.querySelectorAll('.map-style-btn').forEach(btn => {
      const active = btn.dataset.style === styleKey;
      btn.className = `map-style-btn px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition ${
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

    // Default to Google Streets tile layer with automatic OSM fallback
    currentTileLayer = tileProviders.googleRoads;
    currentTileLayer.addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    vehicleLayer = L.layerGroup().addTo(map);

    renderMapMarkers();
    renderCharacterCards();
    updateSelectedLotHUD();
  }

  function renderMapMarkers() {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    const lots = getActiveLots();
    let totalOpen = 0;
    let totalCap = 0;

    lots.forEach(lot => {
      const t = computeLotTelemetry(lot);
      totalOpen += t.estOpenSpaces;
      totalCap += t.physicalCapacity;

      const isSelected = lot.id === state.selectedLotId;
      const size = isSelected ? 42 : 32;

      const html = `
        <div class="lot-pin-wrapper ${isSelected ? 'is-selected' : ''}" style="width:${size}px;height:${size}px;">
          <div class="lot-pin-pulse" style="border-color:${t.statusMeta.color}; background:${t.statusMeta.bg}"></div>
          <div class="lot-pin-core" style="background:${t.statusMeta.color}; box-shadow: 0 0 14px ${t.statusMeta.color};">
            <span>${t.estOpenSpaces}</span>
          </div>
          ${isSelected ? `<div class="lot-pin-label">${lot.name}</div>` : ''}
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
        state.selectedLotId = lot.id;
        renderMapMarkers();
        updateSelectedLotHUD();
        syncLotPhysicsToSelected(lot);
      });
      marker.addTo(markersLayer);
    });

    // Update top map telemetry counters
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

  function updateSelectedLotHUD() {
    const allLots = [...window.DAL_LOTS, ...window.HRM_EXPANSION_LOTS];
    const lot = allLots.find(l => l.id === state.selectedLotId) || window.DAL_LOTS[0];
    const t = computeLotTelemetry(lot);

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('selected-lot-name', lot.name);
    setTxt('selected-lot-address', lot.address);
    setTxt('selected-lot-campus', lot.campus === 'hrm-expansion' ? lot.halifaxZone : `${lot.campus.toUpperCase()} CAMPUS`);
    setTxt('selected-lot-type', lot.lotType.replace('_', ' '));
    setTxt('selected-lot-score', `${t.finalScore}/100`);
    setTxt('selected-lot-open', `${t.estOpenSpaces} / ${t.physicalCapacity}`);
    setTxt('selected-lot-general', `${lot.generalSpaces} Gen`);
    setTxt('selected-lot-reserved', `${lot.reservedSpaces} Res`);
    setTxt('selected-lot-short', `${lot.shortTermSpaces} Short`);
    setTxt('selected-lot-evening', `${(lot.eveningGeneralSpaces || 0) + (lot.eveningShortTermSpaces || 0)} Eve`);

    // Factor breakdown pills
    setTxt('factor-hour', `${t.factors.hour >= 0 ? '+' : ''}${t.factors.hour}`);
    setTxt('factor-weather', `${t.factors.weather >= 0 ? '+' : ''}${t.factors.weather}`);
    setTxt('factor-calendar', `${t.factors.academicDay >= 0 ? '+' : ''}${t.factors.academicDay}`);
    setTxt('factor-alpha', `${t.alpha}% Crowd Weight`);

    const badge = document.getElementById('selected-lot-status-badge');
    if (badge) {
      badge.textContent = t.statusMeta.label.toUpperCase();
      badge.style.backgroundColor = t.statusMeta.bg;
      badge.style.color = t.statusMeta.color;
      badge.style.borderColor = t.statusMeta.border;
    }

    const scoreBar = document.getElementById('selected-lot-score-bar');
    if (scoreBar) {
      scoreBar.style.width = `${t.finalScore}%`;
      scoreBar.style.backgroundColor = t.statusMeta.color;
    }

    render24HourSparkline(lot);
  }

  function render24HourSparkline(lot) {
    const container = document.getElementById('lot-24h-bars');
    if (!container) return;

    let html = '';
    for (let h = 6; h <= 22; h++) {
      const t = computeLotTelemetry(lot, h);
      const isCurrent = h === state.hour;
      const heightPct = Math.max(12, t.finalScore);
      const label = h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`;
      html += `
        <div onclick="window.DalSim.setHour(${h})" class="cursor-pointer flex-1 flex flex-col items-center group">
          <div class="w-full h-16 bg-slate-900/90 rounded-md flex items-end p-0.5 border ${isCurrent ? 'border-amber-400' : 'border-slate-800/70'}">
            <div class="w-full rounded-sm transition-all duration-300" style="height:${heightPct}%; background:${t.statusMeta.color}; opacity:${isCurrent ? '1' : '0.65'}"></div>
          </div>
          <span class="text-[9px] font-mono mt-1 ${isCurrent ? 'text-amber-400 font-bold' : 'text-slate-500'}">${label}</span>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  // ============================================================================
  // 2. INTERACTIVE COMMUTER CHARACTER DISPATCH & VEHICLE TELEMETRY
  // ============================================================================
  function getCharacterAvatarSVG(char) {
    const c = char.vehicleColor;
    return `
      <svg viewBox="0 0 64 64" class="w-12 h-12 rounded-xl bg-slate-900 border border-slate-700/80 p-1 shrink-0">
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
        <div onclick="window.DalSim.dispatchCharacter('${char.id}')"
             class="cursor-pointer p-4 rounded-2xl border transition-all duration-200 ${
               isActive
                 ? 'bg-slate-900/95 border-amber-400 shadow-lg shadow-amber-400/10'
                 : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
             }">
          <div class="flex items-center gap-3 mb-2.5">
            ${getCharacterAvatarSVG(char)}
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h4 class="font-bold text-sm text-white truncate">${char.name}</h4>
                <span class="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-slate-800 text-amber-300">${char.schedule.split(' ')[0]}</span>
              </div>
              <p class="text-xs text-slate-400 truncate">${char.role}</p>
              <p class="text-[11px] font-mono text-slate-500 truncate">${char.permit}</p>
            </div>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed mb-3">"${char.quote}"</p>
          <div class="flex items-center justify-between pt-2 border-t border-slate-800/80">
            <span class="text-[11px] font-mono flex items-center gap-1.5" style="color:${char.vehicleColor}">
              <span class="w-2 h-2 rounded-full" style="background:${char.vehicleColor}"></span>
              ${char.vehicleName}
            </span>
            <span class="text-[11px] font-bold px-2.5 py-1 rounded-lg ${
              isActive ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'
            }">
              ${isActive ? 'Simulating Route' : 'Dispatch Vehicle →'}
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  function dispatchCharacter(charId) {
    state.activeCharacterId = charId;
    renderCharacterCards();

    const char = window.COMMUTER_CHARACTERS.find(c => c.id === charId);
    if (!char || !map || !vehicleLayer) return;

    if (vehicleAnimFrame) cancelAnimationFrame(vehicleAnimFrame);
    vehicleLayer.clearLayers();

    // Evaluate character's preferred lots using live engine
    const evaluated = char.preferredLots
      .map(id => window.DAL_LOTS.find(l => l.id === id))
      .filter(Boolean)
      .map(lot => computeLotTelemetry(lot));

    // Find if primary lot is crowded/full and pick best alternative
    const primary = evaluated[0];
    const best = [...evaluated].sort((a, b) => b.finalScore - a.finalScore)[0];
    const rerouted = best && primary && best.lot.id !== primary.lot.id && primary.finalScore < 55;

    const targetTelemetry = rerouted ? best : primary;
    if (!targetTelemetry) return;

    state.selectedLotId = targetTelemetry.lot.id;
    renderMapMarkers();
    updateSelectedLotHUD();
    syncLotPhysicsToSelected(targetTelemetry.lot);

    // Build path from character startCoord -> primary lot (if rerouted, show bypass) -> destination lot
    const pathCoords = [
      char.startCoord,
      ...char.waypoints.slice(1, 3),
      [primary.lot.coordinate.latitude, primary.lot.coordinate.longitude]
    ];

    if (rerouted) {
      pathCoords.push([targetTelemetry.lot.coordinate.latitude, targetTelemetry.lot.coordinate.longitude]);
    }

    map.flyTo([targetTelemetry.lot.coordinate.latitude, targetTelemetry.lot.coordinate.longitude], 15, {
      duration: 0.9
    });

    // Draw dashed route polyline
    routePolyline = L.polyline(pathCoords, {
      color: char.vehicleColor,
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.9
    }).addTo(vehicleLayer);

    // If rerouted, place a "LOT FULL / BYPASSED" beacon on primary lot
    if (rerouted) {
      const bypassIcon = L.divIcon({
        className: 'bypass-beacon',
        html: `<div class="px-2 py-0.5 rounded bg-rose-600 text-white font-mono text-[10px] font-bold shadow-lg whitespace-nowrap border border-rose-300">
          BYPASSED ${primary.lot.name.toUpperCase()} (${primary.finalScore}% SCORE)
        </div>`,
        iconSize: [160, 24],
        iconAnchor: [80, -18]
      });
      rejectedMarker = L.marker(
        [primary.lot.coordinate.latitude, primary.lot.coordinate.longitude],
        { icon: bypassIcon }
      ).addTo(vehicleLayer);
    }

    // Update Telemetry Log Banner
    const logEl = document.getElementById('dispatch-telemetry-log');
    if (logEl) {
      logEl.innerHTML = rerouted
        ? `<span class="text-amber-400 font-bold">[REROUTE ACTIVE]</span> ${char.name}'s primary lot (<strong>${primary.lot.name}</strong>) scored ${primary.finalScore}/100. Intercepted pre-gate and routed to <strong>${targetTelemetry.lot.name}</strong> (${targetTelemetry.estOpenSpaces} open stalls, score ${targetTelemetry.finalScore}/100). Saved 14.2 mins circling.`
        : `<span class="text-emerald-400 font-bold">[DIRECT ROUTE]</span> ${char.name} routed directly to <strong>${targetTelemetry.lot.name}</strong> (${targetTelemetry.estOpenSpaces} open stalls, score ${targetTelemetry.finalScore}/100). Zero gate delay.`;
    }

    // Animate top-down SVG vehicle along pathCoords
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
          segmentIndex = 0; // continuous loop for visual telemetry
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
  // 3. TOP-DOWN PARKING LOT PHYSICS & STALL SIMULATOR CANVAS
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
      frustratedCirclingCount: 0,
      minutesSaved: 0
    },
    lotName: 'Dalplex Lot',
    totalStalls: 24 // visual interactive stall grid (2 rows of 12 stalls)
  };

  function initLotPhysicsCanvas() {
    const canvas = document.getElementById('lot-physics-canvas');
    if (!canvas) return;
    lotSim.canvas = canvas;
    lotSim.ctx = canvas.getContext('2d');

    buildStallGrid(0.72);

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Check if user clicked a stall to toggle occupancy
      for (const stall of lotSim.stalls) {
        if (x >= stall.x && x <= stall.x + stall.w && y >= stall.y && y <= stall.y + stall.h) {
          stall.occupied = !stall.occupied;
          stall.carColor = stall.occupied ? pickRandomCarColor() : null;
          updateLotSimStatsUI();
          return;
        }
      }

      // Otherwise spawn a commuter vehicle at entrance
      spawnLotVehicle();
    });

    // Periodic ambient commuter arrival
    setInterval(() => {
      if (lotSim.cars.length < 5) {
        spawnLotVehicle();
      }
    }, 2400);

    requestAnimationFrame(renderLotPhysicsLoop);
  }

  function pickRandomCarColor() {
    const palette = ['#F2C94C', '#38BDF8', '#22C55E', '#A855F7', '#F43F5E', '#E2E8F0', '#FB923C'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  function buildStallGrid(occupancyRatio = 0.7) {
    lotSim.stalls = [];
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

  function syncLotPhysicsToSelected(lot) {
    if (!lot) return;
    const t = computeLotTelemetry(lot);
    lotSim.lotName = lot.name;
    const occRatio = clamp((100 - t.finalScore) / 100, 0.1, 0.96);
    buildStallGrid(occRatio);
    const titleEl = document.getElementById('canvas-lot-title');
    if (titleEl) titleEl.textContent = `${lot.name} (${t.physicalCapacity} Total Stalls)`;
  }

  function spawnLotVehicle() {
    const openStalls = lotSim.stalls.filter(s => !s.occupied && !s.reservedByCar);
    const color = pickRandomCarColor();

    // If lot is full (or nearly full) and DalParkAid Smart Gate is ON, intercept at gate!
    if (openStalls.length === 0 && lotSim.smartGateEnabled) {
      lotSim.stats.reroutedSavedCount++;
      lotSim.stats.minutesSaved = +(lotSim.stats.minutesSaved + 14.5).toFixed(1);
      lotSim.cars.push({
        x: 10,
        y: 145,
        vx: 3.4,
        vy: 0,
        color,
        state: 'INTERCEPTED_AT_GATE',
        targetStall: null,
        label: 'REROUTED TO OPEN LOT (-14m)',
        alpha: 1
      });
      updateLotSimStatsUI();
      return;
    }

    // Pick an available stall if one exists
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
    // Fill most stalls to simulate 9:25 AM crunch and spawn 6 incoming vehicles
    lotSim.stalls.forEach((s, idx) => {
      if (idx % 9 !== 0) {
        s.occupied = true;
        s.carColor = pickRandomCarColor();
      }
    });
    for (let i = 0; i < 6; i++) {
      setTimeout(() => spawnLotVehicle(), i * 320);
    }
    updateLotSimStatsUI();
  }

  function toggleSmartGate() {
    lotSim.smartGateEnabled = !lotSim.smartGateEnabled;
    const btn = document.getElementById('smart-gate-toggle-btn');
    if (btn) {
      btn.textContent = lotSim.smartGateEnabled
        ? 'DalParkAid Pre-Gate Reroute: ACTIVE'
        : 'DalParkAid Pre-Gate Reroute: OFF (Blind Commute)';
      btn.className = lotSim.smartGateEnabled
        ? 'px-3.5 py-2 rounded-xl text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 transition'
        : 'px-3.5 py-2 rounded-xl text-xs font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 transition';
    }
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
    setTxt('sim-minutes-saved', `${lotSim.stats.minutesSaved} min`);
  }

  function drawTopDownCar(ctx, x, y, w, h, color, isHorizontal = false, isFrustrated = false) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = isFrustrated ? '#EF4444' : '#0B1424';
    ctx.lineWidth = 2;

    // Car body
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();

    // Windshield
    ctx.fillStyle = '#0F172A';
    if (isHorizontal) {
      ctx.fillRect(x + w * 0.55, y + 4, w * 0.24, h - 8);
      ctx.fillRect(x + w * 0.15, y + 5, w * 0.18, h - 10);
      // Headlight beams
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

    // Asphalt background
    ctx.fillStyle = '#0B1322';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Entrance Gate Sensor Zone
    ctx.fillStyle = lotSim.smartGateEnabled ? 'rgba(34, 197, 94, 0.10)' : 'rgba(239, 68, 68, 0.08)';
    ctx.fillRect(0, 108, 96, 104);
    ctx.strokeStyle = lotSim.smartGateEnabled ? '#22C55E' : '#EF4444';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(4, 110, 88, 100);
    ctx.setLineDash([]);

    ctx.fillStyle = lotSim.smartGateEnabled ? '#22C55E' : '#F87171';
    ctx.font = 'bold 9px JetBrains Mono, monospace';
    ctx.fillText(lotSim.smartGateEnabled ? 'DALPARKAID' : 'NO SENSOR', 14, 130);
    ctx.fillText(lotSim.smartGateEnabled ? 'GATE BEACON' : 'BLIND ENTRY', 14, 142);

    // Central driving lane markings
    ctx.strokeStyle = 'rgba(242, 201, 76, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 12]);
    ctx.beginPath();
    ctx.moveTo(95, 160);
    ctx.lineTo(765, 160);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Stalls
    for (const stall of lotSim.stalls) {
      ctx.strokeStyle = stall.type === 'RESERVED'
        ? 'rgba(56, 189, 248, 0.5)'
        : stall.type === 'SHORT_TERM'
          ? 'rgba(168, 85, 247, 0.5)'
          : 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(stall.x, stall.y, stall.w, stall.h);

      // Stall number & tier tag
      ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(`#${stall.id + 1}`, stall.x + 6, stall.y + 14);

      if (stall.occupied) {
        drawTopDownCar(ctx, stall.x + 8, stall.y + 8, stall.w - 16, stall.h - 16, stall.carColor || '#F2C94C', false, false);
      } else {
        // Open stall indicator dot
        ctx.fillStyle = '#22C55E';
        ctx.beginPath();
        ctx.arc(stall.x + stall.w / 2, stall.y + stall.h / 2 + 6, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Update & Draw Active Moving Cars
    for (let i = lotSim.cars.length - 1; i >= 0; i--) {
      const car = lotSim.cars[i];

      if (car.state === 'INTERCEPTED_AT_GATE') {
        car.x += car.vx * 0.5;
        car.y -= 2.1; // U-turn / reroute upward before entering congested lane
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
          // Pull into stall
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
  // 4. OPEN-METEO LIVE HALIFAX WEATHER + ENGINE CONTROLS
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
        else if ([45, 48].includes(code)) state.weatherType = 'FOG';
        else state.weatherType = 'CLEAR';

        state.liveWeatherLoaded = true;
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
    if (tempEl) tempEl.textContent = `${state.weatherTempC}°C in Halifax`;
    if (windEl) windEl.textContent = `Wind ${state.weatherWindKmh} km/h`;

    document.querySelectorAll('.weather-btn').forEach(btn => {
      const active = btn.dataset.weather === state.weatherType;
      btn.className = `weather-btn px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition ${
        active
          ? 'bg-amber-400 text-slate-950 border-amber-400 font-bold'
          : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
      }`;
    });
  }

  function injectCrowdReport(rating) {
    const hasProof = document.getElementById('crowd-proof-checkbox')?.checked ?? true;
    const lotId = state.selectedLotId;
    if (!state.injectedReports[lotId]) {
      state.injectedReports[lotId] = [];
    }
    state.injectedReports[lotId].unshift({
      rating: Number(rating),
      ageMins: 1,
      hasProof,
      voteMultiplier: 1.45
    });

    const feedback = document.getElementById('crowd-inject-feedback');
    if (feedback) {
      feedback.textContent = `Injected rating ${rating}/5 (${hasProof ? 'with photo proof 1.15x' : 'text only'}) into ${lotId}. Alpha recalculated.`;
      feedback.classList.remove('hidden');
    }

    refreshAllViews();
  }

  // ============================================================================
  // 5. COMMUTER ECONOMICS & WASTE CALCULATOR (CAMPUS2MARKET VALIDATION)
  // ============================================================================
  function updateCommuterCalculator() {
    const daysPerWeek = Number(document.getElementById('calc-days')?.value || 4);
    const arrivalHour = Number(document.getElementById('calc-hour')?.value || 10);
    const ticketRisk = Number(document.getElementById('calc-tickets')?.value || 2);

    const peakMultiplier = (arrivalHour >= 9 && arrivalHour <= 13) ? 1.35 : (arrivalHour >= 14 && arrivalHour <= 16) ? 1.0 : 0.45;
    const minsPerTrip = Math.round(14 * peakMultiplier);
    const weeksPerAcademicYear = 32;
    const totalTrips = daysPerWeek * weeksPerAcademicYear;

    const hoursLost = Math.round((totalTrips * minsPerTrip) / 60);
    const fuelAndTicketWaste = Math.round((hoursLost * 6.8) + (ticketRisk * 55));
    const co2Kg = Math.round(hoursLost * 4.2);

    const setTxt = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    setTxt('calc-days-val', `${daysPerWeek} days/wk`);
    setTxt('calc-hour-val', `${arrivalHour}:00`);
    setTxt('calc-tickets-val', `${ticketRisk} tickets/yr`);
    setTxt('calc-hours-lost', `${hoursLost} hrs`);
    setTxt('calc-money-lost', `$${fuelAndTicketWaste}`);
    setTxt('calc-co2-lost', `${co2Kg} kg`);
  }

  function refreshAllViews() {
    const hourLabel = state.hour === 0 ? '12:00 AM'
      : state.hour === 12 ? '12:00 PM'
      : state.hour > 12 ? `${state.hour - 12}:00 PM` : `${state.hour}:00 AM`;

    const timeDisplay = document.getElementById('scrubber-time-display');
    if (timeDisplay) {
      timeDisplay.textContent = `${hourLabel} (${isEveningHour(state.hour) ? 'Evening Rules: Reserved Stalls Unlocked' : 'Daytime Permit Rules Active'})`;
    }

    renderMapMarkers();
    updateSelectedLotHUD();
  }

  // Expose interactive API to DOM controls
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
    setCampusFilter(campus) {
      state.campusFilter = campus;
      document.querySelectorAll('.campus-filter-btn').forEach(btn => {
        const active = btn.dataset.campus === campus;
        btn.className = `campus-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition ${
          active ? 'bg-amber-400 text-slate-950' : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700'
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
    setMapTileStyle,
    locateUserNearestLot() {
      if (!navigator.geolocation) {
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
            }).addTo(map).bindPopup("You are here").openPopup();
          }
        },
        () => {
          if (map) map.flyTo([44.6378, -63.5885], 16);
        }
      );
    },
    dispatchCharacter,
    injectCrowdReport,
    triggerLectureRushWave,
    toggleSmartGate,
    spawnLotVehicle,
    updateCommuterCalculator
  };

  window.addEventListener('DOMContentLoaded', () => {
    initGeospatialMap();
    initLotPhysicsCanvas();
    updateWeatherUI();
    updateCommuterCalculator();
    fetchLiveHalifaxWeather();
    setTimeout(() => dispatchCharacter('maya'), 600);
  });
})();
