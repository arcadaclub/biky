(function (global) {
  'use strict';

  /**
   * Vorwärts: nächster Schritt, sobald distAlong ≥ legEnds[i] − EPS (Snapping/Polylinie).
   */
  const NAV_STEP_END_EPS_M = 4;
  /**
   * Rückwärts: Schritt nur verlassen, wenn deutlich vor der vorigen Grenze (toter Band
   * zwischen Vor- und Rückschwelle verhindert L/R-Flattern bei GPS-Rauschen).
   */
  const NAV_STEP_RETREAT_EPS_M = 28;
  /**
   * Querabstand zur geplanten Linie größer → Neu-Routing prüfen (GPS, nicht Simulation).
   * Wird in `maybeEvaluateOffRouteReroute` adaptiv mit der Geschwindigkeit skaliert
   * (langsame Fahrer brauchen engere Toleranzen, schnelle weitere).
   */
  const NAV_OFF_ROUTE_THRESH_BASE_M = 60;
  const NAV_OFF_ROUTE_THRESH_MIN_M = 60;
  const NAV_OFF_ROUTE_THRESH_MAX_M = 180;
  /** Geschwindigkeitsfaktor (m je km/h, der zur Basis-Schwelle hinzukommt). */
  const NAV_OFF_ROUTE_THRESH_PER_KMH = 2.5;
  /** Maximale aufeinanderfolgende Messungen über Schwellwert, bevor neu geroutet wird. */
  const NAV_OFF_ROUTE_STREAK_MAX = 3;
  /** Cooldown zwischen Reroute-Anfragen — adaptiv (kürzer bei klar großem Off-Track). */
  const NAV_REROUTE_COOLDOWN_BASE_MS = 14000;
  const NAV_REROUTE_COOLDOWN_MIN_MS = 8000;
  /** Am Streifenende kein Umrouten mehr (letzte Meter). */
  const NAV_REROUTE_NEAR_END_M = 40;
  /** Zusätzlicher Zoom in „Karte Fahrtrichtung“ nach der Cover-Berechnung (Ränder, Kacheln, UI). */
  const NR_HEADING_OVERSCAN = 1.68;

  /**
   * OpenRouteService step.type (GeoJSON segments.steps), NICHT OSRM.
   * @see https://giscience.github.io/openrouteservice/v8.2.0/api-reference/endpoints/directions/instruction-types
   */
  const ORS_TYPE_ICON = {
    0: 'left',
    1: 'right',
    2: 'sharp-left',
    3: 'sharp-right',
    4: 'slight-left',
    5: 'slight-right',
    6: 'straight',
    7: 'roundabout',
    8: 'roundabout-exit',
    9: 'uturn',
    10: 'finish',
    11: 'depart',
    12: 'keep-left',
    13: 'keep-right',
  };

  const NAV_ICON_SVG = {
    // Modernisierte, konsistentere Pfeile (gleiche Keys, nur SVG-Design).
    // viewBox 0..96 bleibt, Klassen bleiben für CSS-Styling.
    straight:
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M48 82V22"/><path class="nav-icon-head" d="M30 40L48 22l18 18"/></svg>',
    left:
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M64 82V52c0-14-9-23-23-23H24"/><path class="nav-icon-head" d="M40 14L24 29l16 16"/></svg>',
    right:
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M32 82V52c0-14 9-23 23-23h17"/><path class="nav-icon-head" d="M56 14l16 15-16 16"/></svg>',
    'sharp-left':
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M68 82V58c0-20-12-32-32-32H24"/><path class="nav-icon-head" d="M40 14L23 26l17 18"/></svg>',
    'sharp-right':
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M28 82V58c0-20 12-32 32-32h12"/><path class="nav-icon-head" d="M56 14l17 12-17 18"/></svg>',
    'slight-left':
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M56 82V62c0-18-8-32-26-44"/><path class="nav-icon-head" d="M33 48l-3-30 30 7"/></svg>',
    'slight-right':
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M40 82V62c0-18 8-32 26-44"/><path class="nav-icon-head" d="M33 25l30-7-3 30"/></svg>',
    'keep-left':
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-ghost" d="M58 82V20"/><path class="nav-icon-route" d="M54 82V58c0-18-9-31-28-42"/><path class="nav-icon-head" d="M31 44l-5-29 29 9"/></svg>',
    'keep-right':
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-ghost" d="M38 82V20"/><path class="nav-icon-route" d="M42 82V58c0-18 9-31 28-42"/><path class="nav-icon-head" d="M36 24l29-9-5 29"/></svg>',
    uturn:
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M62 82V36c0-14-9-23-23-23S16 22 16 36v14"/><path class="nav-icon-head" d="M6 40l10 14 14-14"/></svg>',
    roundabout:
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M48 76a28 28 0 1 1 26-18"/><path class="nav-icon-head" d="M79 36l-1 22-19-10"/></svg>',
    'roundabout-exit':
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M40 76a24 24 0 1 1 28-28V22"/><path class="nav-icon-head" d="M50 38l18-16 18 16"/></svg>',
    depart:
      '<svg viewBox="0 0 96 96" aria-hidden="true"><circle class="nav-icon-dot" cx="48" cy="74" r="9"/><path class="nav-icon-route" d="M48 64V22"/><path class="nav-icon-head" d="M30 40L48 22l18 18"/></svg>',
    finish:
      '<svg viewBox="0 0 96 96" aria-hidden="true"><path class="nav-icon-route" d="M34 82V18"/><path class="nav-icon-flag" d="M35 20h34l-8 12 8 12H35z"/><circle class="nav-icon-dot" cx="34" cy="82" r="6"/></svg>',
  };

  /**
   * Kurztext für Sprachausgabe — gleiche Semantik wie Pfeil (type), nicht nur ORS-HTML.
   * ORS-Instruction-Strings weichen in Einzelfällen von type ab; TTS wirkte dann „links/rechts vertauscht“.
   */
  const ORS_MANEUVER_SPEECH_DE = {
    0: 'Biegen Sie nach links ab',
    1: 'Biegen Sie nach rechts ab',
    2: 'Scharf nach links abbiegen',
    3: 'Scharf nach rechts abbiegen',
    4: 'Leicht nach links abbiegen',
    5: 'Leicht nach rechts abbiegen',
    9: 'Bitte wenden',
    12: 'Halten Sie sich links',
    13: 'Halten Sie sich rechts',
  };

  /** iPhone / iPad / iPadOS-Chrome — u. a. für GPS-Polling; TTS läuft ausschließlich über Piper. */
  function nrNavIsIosTouch() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    if (/iPad|iPhone|iPod/i.test(ua)) {
      return true;
    }
    try {
      if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
        return true;
      }
    } catch (e) {
      /* ignorieren */
    }
    return false;
  }

  /** Kurs in Grad (0–360), Uhrzeigersinn von Norden — für GPS ohne coords.heading. */
  function bearingDeg(lat1, lng1, lat2, lng2) {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    return ((θ * 180) / Math.PI + 360) % 360;
  }

  function normalizeTurnDelta(delta) {
    let d = delta;
    while (d <= -180) {
      d += 360;
    }
    while (d > 180) {
      d -= 360;
    }
    return d;
  }

  function fallbackTurnMeta(delta) {
    const abs = Math.abs(delta);
    if (abs < 22) {
      return null;
    }
    if (abs >= 165) {
      return {
        type: 9,
        instruction: 'Bitte wenden',
      };
    }
    if (delta < 0) {
      if (abs >= 115) {
        return { type: 2, instruction: 'Scharf nach links abbiegen' };
      }
      if (abs >= 52) {
        return { type: 0, instruction: 'Links abbiegen' };
      }
      return { type: 12, instruction: 'Links halten' };
    }
    if (abs >= 115) {
      return { type: 3, instruction: 'Scharf nach rechts abbiegen' };
    }
    if (abs >= 52) {
      return { type: 1, instruction: 'Rechts abbiegen' };
    }
    return { type: 13, instruction: 'Rechts halten' };
  }

  function buildFallbackNavigationSteps(geometry, cumDist) {
    if (!Array.isArray(geometry) || geometry.length < 2 || !Array.isArray(cumDist) || cumDist.length !== geometry.length) {
      return [];
    }
    const steps = [
      {
        instruction: 'Dem Verlauf folgen',
        step_distance_m: 0,
        type: 11,
        way_start_index: 0,
        way_end_index: 0,
        street: '',
      },
    ];
    let lastTurnIndex = 0;
    let lastAcceptedDist = 0;
    for (let i = 1; i < geometry.length - 1; i++) {
      const prev = geometry[i - 1];
      const cur = geometry[i];
      const next = geometry[i + 1];
      const inBearing = bearingDeg(prev[0], prev[1], cur[0], cur[1]);
      const outBearing = bearingDeg(cur[0], cur[1], next[0], next[1]);
      const delta = normalizeTurnDelta(outBearing - inBearing);
      const meta = fallbackTurnMeta(delta);
      if (!meta) {
        continue;
      }
      const distSinceLast = cumDist[i] - lastAcceptedDist;
      if (distSinceLast < 35) {
        continue;
      }
      const upcomingDist = cumDist[i + 1] - cumDist[i];
      if (upcomingDist < 12) {
        continue;
      }
      steps.push({
        instruction: meta.instruction,
        step_distance_m: Math.max(0, cumDist[i] - cumDist[lastTurnIndex]),
        type: meta.type,
        way_start_index: i,
        way_end_index: i,
        street: '',
      });
      lastTurnIndex = i;
      lastAcceptedDist = cumDist[i];
    }
    const lastIndex = geometry.length - 1;
    steps.push({
      instruction: 'Ziel erreicht',
      step_distance_m: Math.max(0, cumDist[lastIndex] - cumDist[lastTurnIndex]),
      type: 10,
      way_start_index: lastIndex,
      way_end_index: lastIndex,
      street: '',
    });
    return steps;
  }

  function typeToIconKey(type) {
    const t = Number(type);
    return ORS_TYPE_ICON[t] != null ? ORS_TYPE_ICON[t] : 'straight';
  }

  function iconMarkupForType(type, arrived) {
    const key = arrived ? 'finish' : typeToIconKey(type);
    return NAV_ICON_SVG[key] || NAV_ICON_SVG.straight;
  }

  /**
   * ORS instruction types: 6 = Straight, 11 = Depart — für Sprache auslassen
   * (nur echte Richtungs-/Kreisel-/Ziel-Hinweise).
   * @see https://giscience.github.io/openrouteservice/v8.2.0/api-reference/endpoints/directions/instruction-types
   */
  function orsStepWarrantsSpeech(type) {
    const t = Number(type);
    if (Number.isNaN(t)) {
      return false;
    }
    return t === 0 || t === 1 || t === 2 || t === 3 || t === 4 || t === 5 || t === 7 || t === 8 || t === 9 || t === 12 || t === 13;
  }

  /** Grobe Distanz für Ansagen (weniger „Meter-genau“). */
  function roundSpeechMeters(d) {
    const m = Math.round(d);
    if (m >= 800) {
      return Math.round(m / 100) * 100;
    }
    if (m >= 150) {
      return Math.round(m / 50) * 50;
    }
    return Math.max(10, Math.round(m / 10) * 10);
  }

  function clampNumber(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function maneuverLeadSeconds(type) {
    const t = Number(type);
    if (t === 7 || t === 8 || t === 9) {
      return 18;
    }
    if (t === 2 || t === 3) {
      return 14;
    }
    if (t === 0 || t === 1 || t === 4 || t === 5 || t === 12 || t === 13) {
      return 11;
    }
    if (t === 10) {
      return 9;
    }
    return 12;
  }

  function maneuverSpeechWindows(state, speedMs) {
    const speed = clampNumber(
      typeof speedMs === 'number' && !Number.isNaN(speedMs) && speedMs > 0.4 ? speedMs : 4.6,
      2.2,
      13.5
    );
    const leadSec = maneuverLeadSeconds(state.type);
    const previewFar = clampNumber(speed * (leadSec * 1.25), 150, 500);
    const previewNear = clampNumber(speed * (leadSec * 0.78), 65, 185);
    const immediate = clampNumber(speed * 2.7, 16, 42);

    return {
      previewFar: Math.max(previewFar, previewNear + 55),
      previewNear: Math.max(previewNear, immediate + 28),
      immediate: immediate,
    };
  }

  function buildCumulativeDistances(geometry, Lref) {
    const d = [0];
    for (let i = 1; i < geometry.length; i++) {
      const a = Lref.latLng(geometry[i - 1][0], geometry[i - 1][1]);
      const b = Lref.latLng(geometry[i][0], geometry[i][1]);
      d.push(d[i - 1] + a.distanceTo(b));
    }
    return d;
  }

  function closestOnSegment(p, a, b, Lref) {
    const ax = a.lat;
    const ay = a.lng;
    const bx = b.lat;
    const by = b.lng;
    const px = p.lat;
    const py = p.lng;
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Lref.latLng(ax + t * abx, ay + t * aby);
  }

  function findBestRouteMatch(latlng, geometry, cumDist, Lref, fromIndex, toIndex) {
    let bestD = Infinity;
    let bestAlong = 0;
    let bestSegIndex = 0;
    const start = Math.max(0, fromIndex | 0);
    const end = Math.min(geometry.length - 2, toIndex | 0);
    for (let i = start; i <= end; i++) {
      const a = Lref.latLng(geometry[i][0], geometry[i][1]);
      const b = Lref.latLng(geometry[i + 1][0], geometry[i + 1][1]);
      const snap = closestOnSegment(latlng, a, b, Lref);
      const dx = latlng.distanceTo(snap);
      if (dx < bestD) {
        bestD = dx;
        const da = a.distanceTo(snap);
        bestAlong = cumDist[i] + da;
        bestSegIndex = i;
      }
    }
    return {
      distanceM: bestD,
      alongM: Math.max(0, bestAlong),
      segIndex: bestSegIndex,
    };
  }

  function distanceAlongRoute(latlng, geometry, cumDist, Lref, lastSegIndex) {
    const globalMatch = findBestRouteMatch(latlng, geometry, cumDist, Lref, 0, geometry.length - 2);
    if (typeof lastSegIndex !== 'number' || !Number.isFinite(lastSegIndex)) {
      return globalMatch;
    }
    const localMatch = findBestRouteMatch(latlng, geometry, cumDist, Lref, lastSegIndex - 30, lastSegIndex + 30);
    if (localMatch.distanceM <= 20 || localMatch.distanceM <= globalMatch.distanceM + 8) {
      return localMatch;
    }
    return globalMatch;
  }

  /**
   * Kleinster Abstand (m) vom Punkt zur Routen-Polylinie (Luftlinie zum nächsten Segment).
   */
  function crossTrackDistanceM(latlng, geometry, cumDist, Lref, lastSegIndex) {
    void cumDist;
    const match = distanceAlongRoute(latlng, geometry, cumDist, Lref, lastSegIndex);
    return Number.isFinite(match.distanceM) ? match.distanceM : 0;
  }

  function positionAtDistance(meters, geometry, cumDist, Lref) {
    const total = cumDist[cumDist.length - 1] || 0;
    if (meters <= 0) {
      return Lref.latLng(geometry[0][0], geometry[0][1]);
    }
    if (meters >= total) {
      const last = geometry.length - 1;
      return Lref.latLng(geometry[last][0], geometry[last][1]);
    }
    let i = 0;
    while (i < cumDist.length - 1 && cumDist[i + 1] < meters) {
      i++;
    }
    const segStart = cumDist[i];
    const segEnd = cumDist[i + 1];
    const t = segEnd > segStart ? (meters - segStart) / (segEnd - segStart) : 0;
    const a = Lref.latLng(geometry[i][0], geometry[i][1]);
    const b = Lref.latLng(geometry[i + 1][0], geometry[i + 1][1]);
    return Lref.latLng(a.lat + t * (b.lat - a.lat), a.lng + t * (b.lng - a.lng));
  }

  function computeStepTriggerDistances(steps, cumDist) {
    const total = cumDist[cumDist.length - 1] || 0;
    const triggers = [];
    let prevEndM = 0;
    let accEndM = 0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i] || {};
      let triggerM = 0;
      if (s.way_start_index != null && cumDist[s.way_start_index] != null && !Number.isNaN(cumDist[s.way_start_index])) {
        triggerM = Math.min(total, Math.max(0, cumDist[s.way_start_index]));
      } else if (i === 0) {
        triggerM = 0;
      } else {
        triggerM = prevEndM;
      }

      let endM = triggerM;
      if (s.way_end_index != null && cumDist[s.way_end_index] != null && !Number.isNaN(cumDist[s.way_end_index])) {
        endM = Math.min(total, Math.max(triggerM, cumDist[s.way_end_index]));
        accEndM = Math.max(accEndM, endM);
      } else {
        accEndM = Math.max(accEndM, triggerM + (s.step_distance_m || 0));
        endM = Math.min(total, accEndM);
      }

      triggers.push(Math.max(0, triggerM));
      prevEndM = Math.max(prevEndM, endM);
    }
    return triggers;
  }

  function directionTypeFromDelta(delta, fallbackType) {
    const abs = Math.abs(delta);
    const fallback = Number(fallbackType);
    if (abs < 18) {
      return fallback === 6 ? 6 : 6;
    }
    if (abs >= 165) {
      return 9;
    }
    if (delta < 0) {
      if (abs >= 120) {
        return 2;
      }
      if (abs >= 52) {
        return 0;
      }
      return abs >= 28 ? 12 : 4;
    }
    if (abs >= 120) {
      return 3;
    }
    if (abs >= 52) {
      return 1;
    }
    return abs >= 28 ? 13 : 5;
  }

  function deriveStepTypeFromGeometry(step, geometry, cumDist, Lref) {
    if (!step || !Array.isArray(geometry) || geometry.length < 3 || !Array.isArray(cumDist) || !Lref) {
      return step && step.type != null ? step.type : 0;
    }
    const rawType = Number(step.type);
    if (rawType === 7 || rawType === 8 || rawType === 10 || rawType === 11) {
      return rawType;
    }
    const startIdx = Number(step.way_start_index);
    if (!Number.isFinite(startIdx) || startIdx <= 0 || startIdx >= geometry.length - 1) {
      return rawType;
    }
    const turnAtM = cumDist[startIdx];
    if (!Number.isFinite(turnAtM)) {
      return rawType;
    }
    const pInA = positionAtDistance(Math.max(0, turnAtM - 18), geometry, cumDist, Lref);
    const pInB = positionAtDistance(Math.max(0, turnAtM - 4), geometry, cumDist, Lref);
    const pOutA = positionAtDistance(Math.min(cumDist[cumDist.length - 1] || turnAtM, turnAtM + 4), geometry, cumDist, Lref);
    const pOutB = positionAtDistance(Math.min(cumDist[cumDist.length - 1] || turnAtM, turnAtM + 18), geometry, cumDist, Lref);
    if (!pInA || !pInB || !pOutA || !pOutB) {
      return rawType;
    }
    if (pInA.distanceTo(pInB) < 2 || pOutA.distanceTo(pOutB) < 2) {
      return rawType;
    }
    const inBearing = bearingDeg(pInA.lat, pInA.lng, pInB.lat, pInB.lng);
    const outBearing = bearingDeg(pOutA.lat, pOutA.lng, pOutB.lat, pOutB.lng);
    const delta = shortestAngleDelta(inBearing, outBearing);
    return directionTypeFromDelta(delta, rawType);
  }

  function headingFromRoutePosition(alongMeters, geometry, cumDist, Lref) {
    if (!Array.isArray(geometry) || geometry.length < 2 || !Array.isArray(cumDist) || !Lref) {
      return null;
    }
    const total = cumDist[cumDist.length - 1] || 0;
    const here = Math.max(0, Math.min(total, alongMeters || 0));
    const ahead = Math.max(0, Math.min(total, here + 14));
    const behind = Math.max(0, Math.min(total, here - 8));
    const p1 = positionAtDistance(behind === here ? Math.max(0, here - 3) : behind, geometry, cumDist, Lref);
    const p2 = positionAtDistance(ahead === here ? Math.min(total, here + 3) : ahead, geometry, cumDist, Lref);
    if (!p1 || !p2) {
      return null;
    }
    const dist = p1.distanceTo(p2);
    if (!(dist > 1)) {
      return null;
    }
    return bearingDeg(p1.lat, p1.lng, p2.lat, p2.lng);
  }

  /**
   * Skalierung, damit ein um `rotationDeg` gedrehtes Rechteck den Viewport vollständig ausfüllt
   * (Axis-Aligned Bounding Box der Rotation).
   */
  function computeNrHeadingCoverScale(viewportWidthPx, viewportHeightPx, rotationDeg) {
    if (!(viewportWidthPx > 0) || !(viewportHeightPx > 0)) {
      return 1;
    }
    const rad = (Math.abs(rotationDeg) * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(rad));
    const absSin = Math.abs(Math.sin(rad));
    const aabbW = viewportWidthPx * absCos + viewportHeightPx * absSin;
    const aabbH = viewportWidthPx * absSin + viewportHeightPx * absCos;
    if (!(aabbW > 0) || !(aabbH > 0)) {
      return 1;
    }
    const cover = Math.max(viewportWidthPx / aabbW, viewportHeightPx / aabbH);
    return cover * NR_HEADING_OVERSCAN;
  }

  /**
   * Für "Karte Fahrtrichtung" soll die wahrgenommene Zoom-Stufe stabil bleiben.
   * Darum verwenden wir eine feste Cover-Skala (Maximalwert über 0..90°), statt pro Heading neu zu skalieren.
   * So bleiben in der Navigation effektiv nur die zwei Leaflet-Zoomstufen (far/near) sichtbar.
   */
  function computeMaxNrHeadingCoverScale(viewportWidthPx, viewportHeightPx) {
    if (!(viewportWidthPx > 0) || !(viewportHeightPx > 0)) {
      return 1;
    }
    let max = 1;
    // 0..90° reicht (symmetrisch); Schritt klein genug, um Worst-Case sicher zu treffen.
    for (let deg = 0; deg <= 90; deg += 3) {
      const v = computeNrHeadingCoverScale(viewportWidthPx, viewportHeightPx, deg);
      if (Number.isFinite(v) && v > max) {
        max = v;
      }
    }
    return max;
  }

  /**
   * Dämpft Cover-Skalen-Schwankungen (sonst wirkt jedes Heading-Jitter wie Zoom-Pingpong).
   * Nie unter dem aktuellen Mindest-Cover, schneller nach oben, träge nach unten.
   */
  function smoothNrHeadingCoverScale(prevSmoothed, rawCover) {
    if (!(Number.isFinite(rawCover) && rawCover > 0)) {
      return rawCover;
    }
    if (prevSmoothed == null || !Number.isFinite(prevSmoothed)) {
      return rawCover;
    }
    const needMore = rawCover > prevSmoothed + 0.002;
    const alpha = needMore ? 0.26 : 0.035;
    let next = prevSmoothed * (1 - alpha) + rawCover * alpha;
    if (rawCover > next) {
      next = rawCover;
    }
    return next;
  }

  /** Gleicher Winkel für rotate() und Cover-Skala; kürzester Weg, niedrige Follow-Rate gegen Zittern. */
  function smoothHeadingRotationForTransform(prevSmoothed, rawDeg) {
    if (!Number.isFinite(rawDeg)) {
      return prevSmoothed != null && Number.isFinite(prevSmoothed) ? prevSmoothed : 0;
    }
    if (prevSmoothed == null || !Number.isFinite(prevSmoothed)) {
      return rawDeg;
    }
    const delta = shortestAngleDelta(prevSmoothed, rawDeg);
    return prevSmoothed + delta * 0.16;
  }

  function shortestAngleDelta(fromDeg, toDeg) {
    let d = ((toDeg - fromDeg + 540) % 360) - 180;
    if (d <= -180) {
      d += 360;
    }
    return d;
  }

  function blendHeadingDegrees(prevDeg, nextDeg, factor) {
    if (!Number.isFinite(prevDeg)) {
      return nextDeg;
    }
    if (!Number.isFinite(nextDeg)) {
      return prevDeg;
    }
    const f = Math.max(0, Math.min(1, factor));
    return (prevDeg + shortestAngleDelta(prevDeg, nextDeg) * f + 360) % 360;
  }

  function computeRawNextStepIndex(distAlong, legEnds) {
    let nextIdx = 0;
    while (nextIdx < legEnds.length && distAlong >= legEnds[nextIdx] - NAV_STEP_END_EPS_M) {
      nextIdx++;
    }
    return nextIdx;
  }

  /**
   * @param {{ idx: number | null }} hystRef persistierter Schrittindex (mutiert .idx)
   */
  function computeNextStepIndexWithHysteresis(distAlong, legEnds, hystRef) {
    if (hystRef.idx == null || hystRef.idx < 0) {
      const fresh = computeRawNextStepIndex(distAlong, legEnds);
      hystRef.idx = fresh;
      return fresh;
    }
    let idx = hystRef.idx;
    while (idx < legEnds.length && distAlong >= legEnds[idx] - NAV_STEP_END_EPS_M) {
      idx++;
    }
    while (idx > 0 && distAlong < legEnds[idx - 1] - NAV_STEP_RETREAT_EPS_M) {
      idx--;
    }
    hystRef.idx = idx;
    return idx;
  }

  function resolveNavState(distAlong, steps, stepTriggers, routeTotal, hystRef) {
    const total = routeTotal || 0;
    if (steps.length === 0) {
      return {
        nextIdx: -1,
        distToManeuver: 0,
        arrived: true,
        text: 'Keine Abbiegehinweise.',
      };
    }
    const currentIdx = hystRef
      ? computeNextStepIndexWithHysteresis(distAlong, stepTriggers, hystRef)
      : computeRawNextStepIndex(distAlong, stepTriggers);

    const firstType = Number(steps[0] && steps[0].type);
    const startUpcomingIdx = !Number.isNaN(firstType) && firstType !== 11 ? 0 : 1;
    /**
     * `currentIdx` ist bereits der Index des nächsten relevanten Schritts, weil
     * `computeRawNextStepIndex()` alle bereits überschrittenen Leg-Enden zählt.
     * Beispiel mit ORS-Depart bei Index 0:
     * - legEnds[0] = 0
     * - wenige Meter nach Start => currentIdx = 1
     * - der nächste Hinweis ist also Schritt 1, nicht 2.
     */
    const nextIdx =
      distAlong <= 8 ? startUpcomingIdx : Math.max(startUpcomingIdx, currentIdx);

    if (nextIdx >= steps.length) {
      const routeRemaining = Math.max(0, total - distAlong);
      if (routeRemaining > NAV_STEP_END_EPS_M + 6) {
        return {
          nextIdx: steps.length - 1,
          distToManeuver: routeRemaining,
          arrived: false,
          text: 'Dem Verlauf folgen',
          type: 6,
          street: '',
        };
      }
      return {
        nextIdx: steps.length - 1,
        distToManeuver: 0,
        arrived: true,
        text: 'Ziel erreicht',
        type: 10,
        street: '',
      };
    }
    const maneuverPointM = stepTriggers[nextIdx] != null ? stepTriggers[nextIdx] : total;
    const distToManeuver = Math.max(0, maneuverPointM - distAlong);

    return {
      nextIdx: nextIdx,
      distToManeuver: distToManeuver,
      arrived: false,
      text: steps[nextIdx].instruction || 'Weiter',
      type: steps[nextIdx].type != null ? steps[nextIdx].type : 0,
      raw_type: steps[nextIdx].raw_type != null ? steps[nextIdx].raw_type : steps[nextIdx].type,
      street: steps[nextIdx].street || '',
    };
  }

  function fmtDistM(m) {
    if (m >= 1000) {
      return (m / 1000).toFixed(1).replace('.', ',') + ' km';
    }
    return Math.round(m) + ' m';
  }

  function fmtDrivenKm(m) {
    const km = Math.max(0, m || 0) / 1000;
    return km.toFixed(1).replace('.', ',') + ' km';
  }

  function fmtElapsedTime(ms) {
    const sec = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(sec / 3600);
    const min = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return h > 0 ? h + ':' + pad(min) + ':' + pad(s) : pad(min) + ':' + pad(s);
  }

  /**
   * Geschätzte Ankunftszeit als HH:MM. Für Tagesübergänge (>12h Restzeit) wird "—" geliefert,
   * weil ein konkreter Zeitpunkt dann kein nützliches Display ist (Pause/Rast/Tour-Ende).
   */
  function fmtEtaClock(remainingM, vEffMs) {
    if (!Number.isFinite(remainingM) || remainingM <= 5) {
      return '—';
    }
    if (!Number.isFinite(vEffMs) || vEffMs < 0.4) {
      return '—';
    }
    const remainingSec = remainingM / vEffMs;
    if (remainingSec > 12 * 3600) {
      return '—';
    }
    const eta = new Date(Date.now() + remainingSec * 1000);
    const pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return pad(eta.getHours()) + ':' + pad(eta.getMinutes());
  }

  function isEditableElement(el) {
    if (!el || el === document.body || el === document.documentElement) {
      return false;
    }
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'textarea') {
      return true;
    }
    if (tag === 'input') {
      const type = String(el.type || 'text').toLowerCase();
      return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(type);
    }
    return !!(el.isContentEditable || (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')));
  }

  function stripHtml(raw) {
    if (!raw || typeof raw !== 'string') {
      return '';
    }
    const d = document.createElement('div');
    d.innerHTML = raw;
    const t = d.textContent || d.innerText || '';
    return t.replace(/\s+/g, ' ').trim();
  }

  function trimStreetCandidateNoise(name) {
    let c = String(name || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!c) {
      return '';
    }
    c = c.replace(/\s+(ab|ein|an)\s*$/i, '').trim();
    c = c.replace(/\s+(abbiegen|einbiegen)\s*$/i, '').trim();
    return c.replace(/\s+/g, ' ').trim();
  }

  /**
   * ORS liefert den Wegenamen oft nur in der deutschsprachigen instruction („… auf Hauptstraße“),
   * nicht im Feld street/name — Heuristik wie serverseitig nr_ors_extract_street_from_plain_instruction.
   */
  function extractStreetFromPlainInstruction(plain) {
    const p = String(plain || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!p) {
      return '';
    }
    const patterns = [
      /\bauf\s+(?:(?:die|den|dem|der)\s+)?([^.,;]+?)(?:\.|,|;|$)/i,
      /\b(?:ab|ein)biegen\s+in\s+(?:(?:die|den|dem|der)\s+)?([^.,;]+?)(?:\.|,|;|$)/i,
      /\bin\s+(?:(?:die|den|dem|der)\s+)([^.,;]+?)(?:\s+(?:ein|ab)biegen)?(?:\.|,|;|$)/i,
      /\bauf\s+der\s+([^.,;\s]+(?:\s+[^.,;\s]+){0,5}?)\s+(?:weiter|weiterfahren|bleib|folgen)/i,
      /\bbleib(?:en)?\s+Sie\s+auf\s+(?:der|dem)\s+([^.,;]+?)(?:\.|,|;|$)/i,
      /\bonto\s+([^.,;]+?)(?:\.|,|;|$)/i,
      /\b(?:on|along)\s+the\s+([^.,;]+?)(?:\.|,|;|$)/i,
      /\b(?:Turn|Head)\s+[^.,]+?\s+onto\s+([^.,;]+?)(?:\.|,|;|$)/i,
    ];
    const junk = /^(links|rechts|geradeaus|demnächst)$/i;
    for (let i = 0; i < patterns.length; i++) {
      const m = p.match(patterns[i]);
      if (m && m[1]) {
        let c = trimStreetCandidateNoise(m[1].trim());
        const parts = c.split(/\s+und\s+/i);
        c = (parts[0] || c).trim();
        if (c && c.length <= 80 && !junk.test(c)) {
          return c;
        }
      }
    }
    return '';
  }

  function enrichNavigationSteps(steps) {
    if (!Array.isArray(steps)) {
      return [];
    }
    let prevEndIdx = 0;
    return steps.map(function (step, index) {
      if (!step || typeof step !== 'object') {
        return step;
      }
      let street = typeof step.street === 'string' ? step.street.trim() : '';
      if (!street && step.instruction) {
        const plainFull = stripHtml(step.instruction);
        street = extractStreetFromPlainInstruction(plainFull);
        if (!street) {
          street = extractStreetFromPlainInstruction(stripGermanDistanceLeadIn(plainFull));
        }
      }
      const prevStreet = typeof step.street === 'string' ? step.street.trim() : '';
      const nextStep = Object.assign({}, step);
      if (street && street !== prevStreet) {
        nextStep.street = street;
      }
      const endIdx = Number(nextStep.way_end_index);
      if (Number.isFinite(endIdx) && endIdx >= 0) {
        nextStep.way_end_index = endIdx;
      }
      const startIdx = Number(nextStep.way_start_index);
      if (Number.isFinite(startIdx) && startIdx >= 0) {
        nextStep.way_start_index = startIdx;
      } else if (index === 0) {
        nextStep.way_start_index = 0;
      } else {
        nextStep.way_start_index = prevEndIdx;
      }
      if (Number.isFinite(endIdx) && endIdx >= prevEndIdx) {
        prevEndIdx = endIdx;
      }
      return nextStep;
    });
  }

  function normalizeIntermediateFinishSteps(steps, coordCount) {
    if (!Array.isArray(steps) || !steps.length) {
      return [];
    }
    const maxIdx = Math.max(0, (coordCount || 0) - 1);
    return steps.map(function (step, index) {
      if (!step || typeof step !== 'object') {
        return step;
      }
      const endIdx = Number(step.way_end_index);
      const type = Number(step.type);
      const text = stripHtml(step.instruction || '');
      const isFinishLike = type === 10 || /^ziel\s+erreicht\.?$/i.test(text);
      const isIntermediate =
        isFinishLike &&
        ((Number.isFinite(endIdx) && endIdx < maxIdx) || (!Number.isFinite(endIdx) && index < steps.length - 1));
      if (!isIntermediate) {
        return step;
      }
      return Object.assign({}, step, {
        instruction: 'Dem Verlauf folgen',
        type: 6,
        raw_type: step.raw_type != null ? step.raw_type : step.type,
      });
    });
  }

  function normalizeSpeechCompare(raw) {
    return stripHtml(raw || '')
      .toLocaleLowerCase('de-DE')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeDisplayStreet(raw) {
    const street = stripHtml(raw || '').replace(/\s+/g, ' ').trim();
    if (!street || street.length > 80) {
      return '';
    }
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ0-9]/.test(street)) {
      return '';
    }
    return street;
  }

  function instructionContainsStreet(text, street) {
    const textNorm = normalizeSpeechCompare(text || '');
    const streetNorm = normalizeSpeechCompare(street || '');
    if (!textNorm || !streetNorm) {
      return false;
    }
    return textNorm.includes(streetNorm);
  }

  /**
   * Wenn kein Straßenname bekannt ist: hängendes „… auf“ / „… auf die“ ohne Ziel am Satzende entfernen
   * (ORS liefert manchmal „… abbiegen auf.“) — nicht vorgelesen/anzeigen.
   */
  function stripOrphanAufAtInstructionEnd(plain) {
    let s = String(plain || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) {
      return s;
    }
    let prev = '';
    let guard = 0;
    while (s !== prev && guard < 8) {
      prev = s;
      s = s
        .replace(/\s+auf\s+(?:die|den|dem|der)\s*[.,;:]*\s*$/i, '')
        .replace(/\s+auf\s*[.,;:]*\s*$/i, '')
        .replace(/\s+ab\s+auf\s*[.,;:]*\s*$/i, ' ab')
        .replace(/\s+abbiegen\s+auf\s*[.,;:]*\s*$/i, ' abbiegen')
        .replace(/\s+/g, ' ')
        .trim();
      guard += 1;
    }
    return s;
  }

  /**
   * Entfernt führende Distanz-/Zeit-Hinweise aus ORS-Text, damit nicht doppelt mit
   * „In Kürze: in X Metern …“ vorgelesen wird.
   */
  function stripGermanDistanceLeadIn(plain) {
    let s = String(plain || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) {
      return '';
    }
    const patterns = [
      /^In\s+[\d]{1,5}\s*(?:,\d+)?\s*(?:Kilometer|km)\b[,.]?\s*/i,
      /^In\s+etwa\s+[\d]{1,5}\s*(?:,\d+)?\s*(?:Kilometer|km)\b[,.]?\s*/i,
      /^In\s+[\d]{1,5}\s*(?:m(?:eter)?|Metern?)\b[,.]?\s*/i,
      /^In\s+etwa\s+[\d]{1,5}\s*(?:m(?:eter)?|Metern?)\b[,.]?\s*/i,
      /^Nach\s+[\d]{1,5}\s*(?:m(?:eter)?|Metern?)\b[,.]?\s*/i,
      /^Nach\s+etwa\s+[\d]{1,5}\s*(?:m(?:eter)?|Metern?)\b[,.]?\s*/i,
      /^Demnächst[,.]?\s*/i,
      /^Gleich[,.]?\s*/i,
    ];
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      patterns.forEach(function (re) {
        const n = s.replace(re, '').trim();
        if (n !== s) {
          s = n;
          changed = true;
        }
      });
      if (!changed) {
        break;
      }
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  /**
   * Klarer Abbiegetext mit Straßenname (ORS-type), wenn der Roh-String zu lang oder ohne Name ist.
   */
  function formatManeuverGerman(type, street) {
    const s = normalizeDisplayStreet(street);
    const auf = s ? ' auf ' + s : '';
    const t = Number(type);
    if (Number.isNaN(t)) {
      return '';
    }
    switch (t) {
      case 0:
        return 'Biegen Sie nach links ab' + auf;
      case 1:
        return 'Biegen Sie nach rechts ab' + auf;
      case 2:
        return 'Biegen Sie scharf nach links ab' + auf;
      case 3:
        return 'Biegen Sie scharf nach rechts ab' + auf;
      case 4:
        return 'Biegen Sie leicht nach links ab' + auf;
      case 5:
        return 'Biegen Sie leicht nach rechts ab' + auf;
      case 6:
        return s ? 'Fahren Sie weiter auf ' + s : 'Geradeaus weiter';
      case 7:
        return s ? 'Im Kreisverkehr Richtung ' + s : 'In den Kreisverkehr einfahren';
      case 8:
        return s ? 'Kreisverkehr verlassen in Richtung ' + s : 'Kreisverkehr verlassen';
      case 9:
        return 'Bitte wenden' + auf;
      case 12:
        return 'Halten Sie sich links' + auf;
      case 13:
        return 'Halten Sie sich rechts' + auf;
      default:
        if (ORS_MANEUVER_SPEECH_DE[t] != null) {
          return ORS_MANEUVER_SPEECH_DE[t] + auf;
        }
        return '';
    }
  }

  /**
   * Eine Zeile für UI + TTS: möglichst kurz, Straße eingebunden, ohne Distanz-Doppelungen.
   */
  function navManeuverPrimaryText(state) {
    const raw = stripHtml(state && state.text ? state.text : '')
      .replace(/\s+/g, ' ')
      .trim();
    const rawCore = stripGermanDistanceLeadIn(raw);
    const street = normalizeDisplayStreet(state && state.street ? state.street : '');
    const hasNamedStreet = !!street;
    const rawType = Number(state && state.raw_type);
    const type = Number(state && state.type);
    const preferTypedText =
      Number.isFinite(rawType) &&
      Number.isFinite(type) &&
      rawType !== type &&
      rawType !== 7 &&
      rawType !== 8 &&
      rawType !== 10 &&
      rawType !== 11;

    function finishNavPhrase(t) {
      const out = String(t || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!hasNamedStreet) {
        return stripOrphanAufAtInstructionEnd(out);
      }
      return out;
    }

    if (!preferTypedText && rawCore && rawCore !== 'Weiter') {
      const streetIn = street && instructionContainsStreet(rawCore, street);
      const compact = rawCore.length <= 96;
      if (streetIn || compact) {
        return finishNavPhrase(rawCore);
      }
      const typed = formatManeuverGerman(state.type, street);
      if (typed) {
        return finishNavPhrase(typed);
      }
      return finishNavPhrase(rawCore);
    }
    const typedFallback = formatManeuverGerman(state.type, street);
    if (typedFallback) {
      return finishNavPhrase(typedFallback);
    }
    const t = Number(state.type);
    if (!Number.isNaN(t) && ORS_MANEUVER_SPEECH_DE[t] != null) {
      return finishNavPhrase(ORS_MANEUVER_SPEECH_DE[t]);
    }
    return finishNavPhrase(rawCore || '');
  }

  function formatDisplayNav(state) {
    const street = normalizeDisplayStreet(state && state.street ? state.street : '');
    let text = navManeuverPrimaryText(state || {});
    if (!text) {
      text = state && state.arrived ? 'Ziel erreicht' : 'Dem Verlauf folgen';
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!street) {
      text = stripOrphanAufAtInstructionEnd(text);
    }

    let streetLine = '';
    if (street && !instructionContainsStreet(text, street)) {
      streetLine = 'auf ' + street;
    }

    return {
      text: text,
      streetLine: streetLine,
    };
  }

  function speechStreetSuffix(instr, streetRaw) {
    const street = stripHtml(streetRaw || '');
    if (!street || street.length > 64) {
      return '';
    }
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ0-9]/.test(street)) {
      return '';
    }
    const instrNorm = normalizeSpeechCompare(instr);
    const streetNorm = normalizeSpeechCompare(street);
    if (!streetNorm) {
      return '';
    }
    if (instrNorm.includes(streetNorm)) {
      return '';
    }
    return ' auf ' + street;
  }

  /**
   * @param {{ text?: string, type?: number, street?: string }} state
   */
  function speechPrimaryInstruction(state) {
    return navManeuverPrimaryText(state || {});
  }

  /**
   * Eine Vorhersage pro ORS-Manöver: Distanz grob + Weisung (keine Polylinien-Mikrohinweise).
   */
  function formatNavSpeechPreview(state) {
    if (state.arrived) {
      if (state.text === 'Keine Abbiegehinweise.') {
        return '';
      }
      return 'Ziel erreicht. Navigation beenden, wenn Sie angekommen sind.';
    }
    const instr = speechPrimaryInstruction(state);
    const dRaw = Math.round(state.distToManeuver);
    const tail = speechStreetSuffix(instr, state.street || '');
    if (!instr) {
      return dRaw >= 50 ? 'Demnächst in etwa ' + roundSpeechMeters(dRaw) + ' Metern weiter' + tail + '.' : '';
    }
    const d = roundSpeechMeters(dRaw);
    if (dRaw >= 900) {
      const km = (dRaw / 1000).toFixed(1).replace('.', ',');
      return 'In Kürze: In ungefähr ' + km + ' Kilometern ' + instr + tail + '.';
    }
    if (dRaw >= 140) {
      return 'In Kürze: In etwa ' + d + ' Metern ' + instr + tail + '.';
    }
    if (dRaw >= 35) {
      return 'Gleich, in etwa ' + d + ' Metern: ' + instr + tail + '.';
    }
    return 'Jetzt: ' + instr + tail + '.';
  }

  function formatNavSpeechByStage(state, stage) {
    if (state.arrived) {
      return formatNavSpeechPreview(state);
    }
    const instr = speechPrimaryInstruction(state);
    const dRaw = Math.round(state.distToManeuver);
    const d = roundSpeechMeters(dRaw);
    const tail = speechStreetSuffix(instr, state.street || '');
    if (!instr) {
      return '';
    }
    if (stage === 'far') {
      if (dRaw >= 900) {
        const km = (dRaw / 1000).toFixed(1).replace('.', ',');
        return 'In ' + km + ' Kilometern ' + instr + tail + '.';
      }
      return 'In ' + d + ' Metern ' + instr + tail + '.';
    }
    if (stage === 'near') {
      return 'Gleich ' + instr + '.';
    }
    return instr + '.';
  }

  const NAV_SHEET_POS_STORAGE_KEY = 'nr-nav-sheet-pos';
  const NAV_SHEET_DRAG_MARGIN_PX = 8;

  /**
   * @returns {{ nx: number, ny: number } | null}
   */
  function readNavSheetPlacementPrefs() {
    try {
      const raw = localStorage.getItem(NAV_SHEET_POS_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const o = JSON.parse(raw);
      if (!o || typeof o.nx !== 'number' || typeof o.ny !== 'number') {
        return null;
      }
      if (!Number.isFinite(o.nx) || !Number.isFinite(o.ny)) {
        return null;
      }
      return { nx: o.nx, ny: o.ny };
    } catch (e) {
      return null;
    }
  }

  function writeNavSheetPlacementPrefs(nx, ny) {
    try {
      localStorage.setItem(NAV_SHEET_POS_STORAGE_KEY, JSON.stringify({ nx: nx, ny: ny }));
    } catch (e) {
      /* Quota / privates Fenster */
    }
  }

  function clearNavSheetPlacementPrefs() {
    try {
      localStorage.removeItem(NAV_SHEET_POS_STORAGE_KEY);
    } catch (e) {
      /* ignorieren */
    }
  }

  const Nav = {
    map: null,
    Lref: null,
    geometry: null,
    cumDist: null,
    steps: [],
    legEnds: [],
    simTimer: null,
    gpsWatch: null,
    /** iOS: zusätzliches getCurrentPosition-Polling, watchPosition liefert dort oft spärlich. */
    gpsPollTimer: null,
    _lastGpsForHeading: null,
    _gpsFailLogAtMs: 0,
    _gpsVisibilityListener: null,
    _wakeLockSentinel: null,
    _wakeLockBound: false,
    _wakeLockRetryTimer: null,
    simDistance: 0,
    simActive: false,
    navMarker: null,
    _lastLatLng: null,
    _eventZoomRestoreTimer: null,
    _eventZoomPrevZoom: null,
    _eventZoomActive: false,
    _eventZoomTargetZoom: null,
    /** Nur 2 Zoomstufen in der Navigation: weit und nah (nur für Norden-oben). */
    _navZoomFar: 16.8,
    _navZoomNear: 17.5,
    /** Merkt, für welchen Step zuletzt auf "nah" gezoomt wurde (verhindert Doppel-Zoom). */
    _navZoomNearStepKey: null,
    /** Timer für verzögertes Zurück-Zoomen nach Manöver. */
    _navZoomOutTimer: null,
    /** Solange true: kein setView/panBy in syncMapUnderPosition — sonst bricht Leaflet flyTo sofort ab. */
    _eventZoomFlight: false,
    /** Ende eines flyTo-Zooms per Zeitfenster (moveend/panBy triggert hier zu früh/zu oft). */
    _navFlyToFinishTimer: null,
    _maneuverOverlayHideTimer: null,
    _maneuverOverlayStepKey: null,
    // Until which along-meter the maneuver overlay stays visible.
    _maneuverOverlayHideAfterAlongM: null,
    /** Beim Nav-Start einmalig nah an die Route zoomen und dann nicht mehr automatisch ändern. */
    _navStartZoom: 18,
    _navStartZoomApplied: false,
    /** Nach Nav-Open kurz kein panBy (Layout/Leaflet-size stabilisieren). */
    _navSuppressPanUntilMs: 0,
    /** Rate-Limit für automatisches Rauszoomen nach Ereignissen. */
    _lastAutoZoomOutAtMs: 0,
    _navStartedAtMs: null,
    /** iOS: Fokus-Guard gegen "Shake to undo" Systemdialoge. */
    _navFocusGuardIv: null,
    voiceEnabled: true,
    /** Separate Option: Fitness-Sterne/Bonuspunkte per Sprache ansagen */
    fitnessVoiceEnabled: true,
    voiceVolume: 1,
    /** Nur wenn true: Navi darf sprechen (z.B. nach „Los geht’s“). */
    _speechArmed: true,
    mapHeadingUp: false,
    _welcomeSpokenThisNav: false,
    _welcomeRetryCount: 0,
    /** Wiederholter Wettertext aus navigation.open (Dialog kann Ton gestoppt haben); pro Session zuruecksetzen. */
    _weatherSpokenThisNav: false,
    /** Nach Begrüßung kurz keine weiteren Ansagen (sonst cancel() -> „stumm“). */
    _speechSuppressUntilMs: 0,
    /** verhindert Doppelansagen für denselben Navigations-Schritt */
    _lastSpeechStepKey: null,
    _lastSpeechAtMs: 0,
    _milestonesDone: /** @type {Record<string, boolean>} */ ({}),
    /** zuletzt angewendete Kartenrotation (Norden oben = 0) */
    _lastAppliedRotationDeg: 0,
    /** geglättete CSS-Cover-Skala in Fahrtrichtung (roher Wert schwankt mit Heading) */
    _nrHeadingCoverScaleSmoothed: null,
    /** feste Cover-Skala in Fahrtrichtung (stabilisiert wahrgenommenen Zoom) */
    _nrHeadingCoverScaleFixed: null,
    _nrHeadingCoverScaleFixedW: null,
    _nrHeadingCoverScaleFixedH: null,
    /** geglätteter Rotationswinkel für Transform (gemeinsam mit Cover-Berechnung) */
    _nrHeadingRotSmoothed: null,
    /**
     * In Fahrtrichtung: stabile Leaflet-Zoomstufe für setView, damit getZoom()-Rauschen kein Pingpong erzeugt.
     * Manuelles Zoomen: Update nur bei |Δzoom| > Schwelle.
     */
    _navHeadingPinZoom: null,
    /** Schrittindex mit Vor-/Rückschwelle gegen Grenz-Flattern (nur .idx nutzen) */
    _navStepHysteresis: { idx: null },
    _ttsReadyListenerBound: false,
    /** Piper-Modul (ESM) kann nach Nav.init laden — kurz pollen, bis prepareNavTts möglich ist. */
    _ttsPreparePollIv: null,
    _lastSpeedMs: 0,
    _filteredHeadingDeg: null,
    _lastAlongMeters: null,
    _maxAlongMeters: null,
    _lastSnapSegIndex: null,
    _debugSessionId: null,
    _debugQueue: [],
    _debugFlushTimer: null,
    _debugFlushInFlight: false,
    _lastDebugAtMs: 0,
    _lastDebugStepKey: null,
    _navSheetDragState: null,
    _navSheetPlacementBound: false,
    _navSheetResizeTimer: null,
    _initialStartPromptDone: false,
    _rerouteInFlight: false,
    _lastRerouteMs: 0,
    _offRouteStreak: 0,
    _temporaryRejoinMeta: null,
    _temporaryRejoinHandled: false,
    /**
     * Position (Streckenmeter) des zuletzt tatsächlich passierten Manöver-Schritts.
     * Wird beim Off-Route-Reroute als unterer Vorwärts-Anker mitgesendet, damit niemals
     * auf bereits hinter sich gelassene Abbiegungen zurück geroutet wird (Rundkurs!).
     */
    _lastPassedManeuverAlongM: 0,
    /** Index in `this.steps` des zuletzt passierten Manöver-Schritts (oder -1, falls noch keiner). */
    _lastPassedManeuverIndex: -1,
    /** Höchster bisher gesehener `nextIdx`, um Übergänge zwischen Schritten zu erkennen. */
    _maxObservedNextIdx: -1,
    /**
     * Insgesamt zurückgelegte Strecke (Meter) seit „Los geht’s“. Wird durch positive
     * Along-Differenzen pro Update aufsummiert und überlebt Reroute/Rückführungs-Wechsel.
     * Reset nur bei `open()` (neue Tour), nicht bei `setRouteData()` (Routen-Austausch).
     */
    _distanceTraveledM: 0,
    /**
     * Wenn true, soll der nächste `open()`-Aufruf KEINE Tour-Counter zurücksetzen
     * (Strecke, Zeit, Fitnesspunkte, Welcome/Milestones). Wird beim „Zurück zum Start“
     * gesetzt: die Heimroute ist eine Fortsetzung der laufenden Tour, kein Neustart.
     */
    _continueTourOnNextOpen: false,
    _feedbackAfterClose: false,
    _simJumpKeyListenerBound: false,
    _fitnessLastAlongM: null,
    _fitnessAccumulatedM: 0,
    _fitnessAwardedThisNav: 0,
    /** true, sobald ein erstes Along-Sample für diese Navigation verarbeitet wurde (verhindert "Start-Offset" nach Reroutes). */
    _fitnessPrimed: false,

    /**
     * Nur true bei geöffneter Navigation (body.nav-mode). Dient u. a. dazu, dass nach „Beenden“
     * kein Web-Speech-Fallback mehr aus verzögerten Piper-Promises spricht.
     */
    isNavActive: function () {
      return typeof document !== 'undefined' && document.body.classList.contains('nav-mode');
    },

    notifyRerouteFinished: function () {
      this._rerouteInFlight = false;
      this._lastRerouteMs = Date.now();
      this._offRouteStreak = 0;
    },

    acquireNavWakeLock: async function () {
      if (!this.isNavActive() || typeof navigator === 'undefined' || !navigator.wakeLock) {
        return false;
      }
      if (document.visibilityState && document.visibilityState !== 'visible') {
        return false;
      }
      if (this._wakeLockSentinel) {
        return true;
      }
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        this._wakeLockSentinel = sentinel;
        sentinel.addEventListener('release', function () {
          if (Nav._wakeLockSentinel === sentinel) {
            Nav._wakeLockSentinel = null;
          }
          if (Nav.isNavActive() && (!document.visibilityState || document.visibilityState === 'visible')) {
            Nav.scheduleNavWakeLockRetry(1200);
          }
        });
        this.queueDebugLog('wake_lock_acquired', {}, false);
        return true;
      } catch (err) {
        this._wakeLockSentinel = null;
        this.queueDebugLog(
          'wake_lock_failed',
          {
            message: err && err.message ? String(err.message) : String(err || ''),
          },
          false
        );
        this.scheduleNavWakeLockRetry(5000);
        return false;
      }
    },

    scheduleNavWakeLockRetry: function (delayMs) {
      if (this._wakeLockRetryTimer != null || !this.isNavActive()) {
        return;
      }
      const self = this;
      this._wakeLockRetryTimer = window.setTimeout(function () {
        self._wakeLockRetryTimer = null;
        void self.acquireNavWakeLock();
      }, Math.max(500, delayMs || 1500));
    },

    bindNavWakeLockLifecycle: function () {
      if (this._wakeLockBound) {
        return;
      }
      const self = this;
      const reacquire = function () {
        if (!self.isNavActive()) {
          return;
        }
        if (document.visibilityState && document.visibilityState !== 'visible') {
          return;
        }
        void self.acquireNavWakeLock();
      };
      document.addEventListener('visibilitychange', reacquire);
      window.addEventListener('focus', reacquire);
      window.addEventListener('pageshow', reacquire);
      this._wakeLockBound = true;
    },

    releaseNavWakeLock: function () {
      if (this._wakeLockRetryTimer != null) {
        window.clearTimeout(this._wakeLockRetryTimer);
        this._wakeLockRetryTimer = null;
      }
      const sentinel = this._wakeLockSentinel;
      this._wakeLockSentinel = null;
      if (sentinel && typeof sentinel.release === 'function') {
        sentinel.release().catch(function () {});
      }
    },

    requestReturnToStart: function (buttonEl) {
      if (!this.geometry || this.geometry.length < 2 || !this.Lref || !this.isNavActive()) {
        return;
      }
      const self = this;
      const originalLabel = buttonEl ? buttonEl.textContent : '';
      const startPoint = [Number(this.geometry[0][0]), Number(this.geometry[0][1])];

      function setBusy(busy) {
        if (!buttonEl) {
          return;
        }
        buttonEl.disabled = !!busy;
        buttonEl.textContent = busy ? 'GPS ...' : originalLabel || 'Zurück';
      }

      function dispatchReturn(latlng) {
        if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) {
          return;
        }
        document.dispatchEvent(
          new CustomEvent('nr-nav-return-start', {
            detail: {
              lat: latlng.lat,
              lng: latlng.lng,
              start: startPoint,
            },
          })
        );
      }

      setBusy(true);
      if (this.simActive && this._lastLatLng) {
        dispatchReturn(this._lastLatLng);
        setBusy(false);
        return;
      }
      const NRG = typeof window !== 'undefined' ? window.NRGeo : null;
      const getPosOnce =
        NRG && typeof NRG.getCurrentPosition === 'function'
          ? NRG.getCurrentPosition.bind(NRG)
          : navigator.geolocation
            ? navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
            : null;
      if (!getPosOnce) {
        if (this._lastLatLng) {
          dispatchReturn(this._lastLatLng);
        } else {
          alert('Aktueller GPS-Standort ist nicht verfügbar.');
        }
        setBusy(false);
        return;
      }
      getPosOnce(
        function (pos) {
          const latlng = self.Lref.latLng(pos.coords.latitude, pos.coords.longitude);
          dispatchReturn(latlng);
          setBusy(false);
        },
        function () {
          if (self._lastLatLng) {
            dispatchReturn(self._lastLatLng);
          } else {
            alert('Aktueller GPS-Standort konnte nicht ermittelt werden.');
          }
          setBusy(false);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15000,
        }
      );
    },

    navDebugApiUrl: function () {
      const base = typeof window.NR_BASE === 'string' ? window.NR_BASE.replace(/\/$/, '') : '';
      return (base ? base + '/' : '') + 'api/nav_debug_log.php';
    },

    isDebugLoggingEnabled: function () {
      return !!window.NR_NAV_DEBUG_LOG_ENABLED;
    },

    ensureDebugSessionId: function () {
      if (this._debugSessionId) {
        return this._debugSessionId;
      }
      const rnd = Math.random().toString(36).slice(2, 8);
      this._debugSessionId = 'nav-' + Date.now().toString(36) + '-' + rnd;
      return this._debugSessionId;
    },

    queueDebugLog: function (eventName, data, forceFlush) {
      if (!eventName || !this.isDebugLoggingEnabled()) {
        return;
      }
      this.ensureDebugSessionId();
      this._debugQueue.push({
        ts: new Date().toISOString(),
        event: String(eventName),
        data: data && typeof data === 'object' ? data : { value: data },
      });
      if (this._debugQueue.length > 200) {
        this._debugQueue.splice(0, this._debugQueue.length - 200);
      }
      if (forceFlush || this._debugQueue.length >= 20) {
        this.flushDebugLogQueue();
        return;
      }
      if (this._debugFlushTimer != null) {
        return;
      }
      const self = this;
      this._debugFlushTimer = window.setTimeout(function () {
        self._debugFlushTimer = null;
        self.flushDebugLogQueue();
      }, 2500);
    },

    flushDebugLogQueue: function () {
      if (!this.isDebugLoggingEnabled()) {
        this._debugQueue = [];
        if (this._debugFlushTimer != null) {
          window.clearTimeout(this._debugFlushTimer);
          this._debugFlushTimer = null;
        }
        return;
      }
      if (this._debugFlushInFlight || !this._debugQueue.length) {
        return;
      }
      if (this._debugFlushTimer != null) {
        window.clearTimeout(this._debugFlushTimer);
        this._debugFlushTimer = null;
      }
      const batch = this._debugQueue.splice(0, 40);
      if (!batch.length) {
        return;
      }
      this._debugFlushInFlight = true;
      const self = this;
      fetch(this.navDebugApiUrl(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.NR_CSRF || '',
        },
        body: JSON.stringify({
          session_id: this.ensureDebugSessionId(),
          entries: batch,
        }),
      })
        .catch(function () {
          self._debugQueue = batch.concat(self._debugQueue).slice(-200);
        })
        .finally(function () {
          self._debugFlushInFlight = false;
          if (self._debugQueue.length && self._debugFlushTimer == null) {
            self._debugFlushTimer = window.setTimeout(function () {
              self._debugFlushTimer = null;
              self.flushDebugLogQueue();
            }, 1200);
          }
        });
    },

    getStableHeadingForDisplay: function (rawHeadingDeg, speedMs, isSim, along) {
      const simHeading = isSim
        ? headingFromRoutePosition(along, this.geometry, this.cumDist, this.Lref)
        : null;
      const baseHeading = Number.isFinite(rawHeadingDeg) ? rawHeadingDeg : simHeading;
      if (!Number.isFinite(baseHeading)) {
        return this._filteredHeadingDeg;
      }
      if (isSim) {
        this._filteredHeadingDeg = blendHeadingDegrees(this._filteredHeadingDeg, baseHeading, 0.28);
        return this._filteredHeadingDeg;
      }
      const speed = Number.isFinite(speedMs) ? speedMs : 0;
      if (speed < 1.6) {
        return this._filteredHeadingDeg;
      }
      const prev = this._filteredHeadingDeg;
      const delta = prev == null ? 180 : Math.abs(shortestAngleDelta(prev, baseHeading));
      if (speed < 3.2 && delta < 10) {
        return prev == null ? baseHeading : prev;
      }
      const factor = speed >= 6 ? 0.34 : speed >= 4 ? 0.24 : 0.16;
      this._filteredHeadingDeg = blendHeadingDegrees(prev, baseHeading, factor);
      return this._filteredHeadingDeg;
    },

    /**
     * GPS weicht von der Linie ab → Event an die App, die neu routet (adaptiver Cooldown +
     * geschwindigkeitsabhängige Schwellwerte + Serien-Stabilität).
     *
     * Adaptive Logik:
     * - Cross-Track-Schwelle wächst mit Geschwindigkeit: ein Rennradfahrer hat mehr seitlichen
     *   Versatz auf der Linie als ein Wanderer; gemessenes Off-Route ist erst dann ein echtes Off.
     * - Streak: bei sehr klarem Off-Track (>2× Schwelle) wird sofort getriggert; bei knapp drüber
     *   warten wir noch auf Bestätigung — verhindert false-positives bei GPS-Jitter.
     * - Cooldown: bei großem Off-Track früher wieder triggerbar (User soll nicht 14 s lang in
     *   die falsche Richtung fahren), bei kleinem Off-Track normal.
     */
    maybeEvaluateOffRouteReroute: function (latlng, along, isSim) {
      if (isSim || !this.geometry || !this.cumDist || !this.Lref || !latlng) {
        return;
      }
      if (!this.isNavActive() || this._rerouteInFlight) {
        return;
      }
      const total = this.cumDist[this.cumDist.length - 1] || 0;
      const forwardAlong = Math.max(
        0,
        Math.min(
          total,
          Math.max(along || 0, this._maxAlongMeters || 0, this._lastPassedManeuverAlongM || 0)
        )
      );
      if (forwardAlong >= Math.max(0, total - NAV_REROUTE_NEAR_END_M)) {
        this._offRouteStreak = 0;
        return;
      }

      const x = crossTrackDistanceM(latlng, this.geometry, this.cumDist, this.Lref, this._lastSnapSegIndex);
      const speedKmh = Math.max(0, (Number(this._lastSpeedMs) || 0) * 3.6);
      const threshM = clampNumber(
        NAV_OFF_ROUTE_THRESH_BASE_M + speedKmh * NAV_OFF_ROUTE_THRESH_PER_KMH,
        NAV_OFF_ROUTE_THRESH_MIN_M,
        NAV_OFF_ROUTE_THRESH_MAX_M
      );

      if (x <= threshM) {
        this._offRouteStreak = 0;
        return;
      }

      this._offRouteStreak = Math.min(NAV_OFF_ROUTE_STREAK_MAX, (this._offRouteStreak || 0) + 1);

      // Streak-Anforderung adaptiv: x ≥ 2,2× threshM → 1 Messung reicht (klares Off);
      // x ≥ 1,5× threshM → 2 Messungen; sonst 3 Messungen warten.
      let requiredStreak;
      if (x >= threshM * 2.2) {
        requiredStreak = 1;
      } else if (x >= threshM * 1.5) {
        requiredStreak = 2;
      } else {
        requiredStreak = 3;
      }
      if (this._offRouteStreak < requiredStreak) {
        return;
      }

      // Cooldown adaptiv: bei klar großem Off (>2× Schwelle) auf Minimum reduzieren.
      const cooldownMs =
        x >= threshM * 2.0 ? NAV_REROUTE_COOLDOWN_MIN_MS : NAV_REROUTE_COOLDOWN_BASE_MS;
      if (Date.now() - this._lastRerouteMs < cooldownMs) {
        return;
      }

      this._rerouteInFlight = true;
      this._offRouteStreak = 0;
      const lastManeuverAlongM = Number.isFinite(this._lastPassedManeuverAlongM)
        ? Math.max(0, Math.min(total, this._lastPassedManeuverAlongM))
        : 0;
      const lastManeuverIndex = Number.isFinite(this._lastPassedManeuverIndex) ? this._lastPassedManeuverIndex : -1;
      this.queueDebugLog(
        'reroute_request',
        {
          along_m: Math.round(forwardAlong),
          cross_track_m: Math.round(x),
          thresh_m: Math.round(threshM),
          speed_kmh: Math.round(speedKmh),
          required_streak: requiredStreak,
          cooldown_ms: cooldownMs,
          last_maneuver_along_m: Math.round(lastManeuverAlongM),
          last_maneuver_index: lastManeuverIndex,
          lat: Math.round(latlng.lat * 100000) / 100000,
          lng: Math.round(latlng.lng * 100000) / 100000,
        },
        true
      );
      document.dispatchEvent(
        new CustomEvent('nr-nav-request-reroute', {
          detail: {
            lat: latlng.lat,
            lng: latlng.lng,
            crossTrackM: Math.round(x),
            alongM: Math.round(forwardAlong),
            speedKmh: Math.round(speedKmh),
            lastManeuverAlongM: Math.round(lastManeuverAlongM),
            lastManeuverIndex: lastManeuverIndex,
          },
        })
      );
    },

    cancelLegacySpeechSynthesis: function () {
      if (typeof window.speechSynthesis === 'undefined') {
        return;
      }
      try {
        window.speechSynthesis.cancel();
      } catch (err) {
        /* ignorieren */
      }
    },

    /**
     * Piper-Audio aus Nutzerinteraktion „anstoßen“ (iOS Safari Autoplay).
     */
    primeNavAudioAndSpeech: function () {
      if (window.NRPiperTTS && typeof window.NRPiperTTS.primeAudioPlayback === 'function') {
        window.NRPiperTTS.primeAudioPlayback();
      }
    },

    formatVoiceVolumeLabel: function () {
      return Math.round(this.voiceVolume * 100) + ' %';
    },

    syncVoiceVolumeUi: function () {
      const slider = document.getElementById('nav-voice-volume');
      const out = document.getElementById('nav-voice-volume-label');
      const toggle = document.getElementById('nav-volume-toggle');
      const pct = Math.round(this.voiceVolume * 100);
      if (slider) {
        slider.value = String(pct);
        slider.setAttribute('aria-valuenow', String(pct));
      }
      if (out) {
        out.textContent = this.formatVoiceVolumeLabel();
      }
      if (toggle) {
        toggle.textContent = 'Lautstärke ' + pct + ' %';
      }
    },

    applyVoiceVolume: function () {
      if (window.NRPiperTTS && typeof window.NRPiperTTS.setVolume === 'function') {
        window.NRPiperTTS.setVolume(this.voiceVolume);
      }
    },

    applyMapOrientationUi: function () {
      const box = document.getElementById('nav-map-heading-on');
      if (box) {
        box.checked = !!this.mapHeadingUp;
      }
      try {
        document.body.classList.toggle('nav-heading-up', !!this.mapHeadingUp);
      } catch (e0) {
        /* ignore */
      }
      // Norden-oben ist fest: Floating-Placement immer zurücksetzen.
      if (!this.mapHeadingUp) {
        try {
          clearNavSheetPlacementPrefs();
        } catch (e1) {
          /* ignore */
        }
        this.clearNavSheetUserPlacement(document.querySelector('#nav-sheet .nav-sheet-inner'));
      }
    },

    refreshMapViewportForHeadingMode: function () {
      const self = this;
      if (!this.map) {
        return;
      }
      window.requestAnimationFrame(function () {
        if (!self.map) {
          return;
        }
        self.map.invalidateSize(false);
        if (self._lastLatLng && self.isNavActive()) {
          self.updateFromLatLng(self._lastLatLng);
        } else {
          self.applyLeafletRotation(0);
        }
        self.refreshTileLayers();
      });
    },

    refreshTileLayers: function () {
      if (!this.map || typeof this.map.eachLayer !== 'function') {
        return;
      }
      this.map.eachLayer(function (layer) {
        if (layer && typeof layer.redraw === 'function' && layer.getTileUrl) {
          layer.redraw();
        }
      });
    },

    blurActiveEditableForNavigation: function () {
      if (typeof document === 'undefined') {
        return;
      }
      const active = document.activeElement;
      if (isEditableElement(active) && typeof active.blur === 'function') {
        active.blur();
      }
    },

    focusNavigationSurface: function () {
      const sheetInner = document.querySelector('#nav-sheet .nav-sheet-inner');
      if (!sheetInner || typeof sheetInner.focus !== 'function') {
        return;
      }
      try {
        sheetInner.focus({ preventScroll: true });
      } catch (err) {
        sheetInner.focus();
      }
    },

    syncNavSheetMetrics: function () {
      this.syncNavSettingsPanelPlacement();
    },

    clearNavSheetUserPlacement: function (innerEl) {
      const inner = innerEl || document.querySelector('#nav-sheet .nav-sheet-inner');
      if (!inner) {
        return;
      }
      inner.classList.remove('nav-sheet-inner--floating');
      inner.style.position = '';
      inner.style.left = '';
      inner.style.top = '';
      inner.style.right = '';
      inner.style.bottom = '';
      inner.style.transform = '';
      inner.style.width = '';
      inner.style.maxWidth = '';
    },

    setNavSheetFloatingPixels: function (inner, left, top) {
      if (!inner) {
        return;
      }
      const sheet = document.getElementById('nav-sheet');
      const cw = sheet && sheet.clientWidth ? sheet.clientWidth : window.innerWidth;
      const targetW = Math.min(520, Math.max(200, cw));
      inner.classList.add('nav-sheet-inner--floating');
      inner.style.position = 'absolute';
      inner.style.left = Math.round(left) + 'px';
      inner.style.top = Math.round(top) + 'px';
      inner.style.right = 'auto';
      inner.style.bottom = 'auto';
      inner.style.transform = 'none';
      inner.style.width = targetW + 'px';
      inner.style.maxWidth = 'none';
    },

    persistNavSheetRect: function (inner) {
      if (!inner) {
        return;
      }
      const r = inner.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      if (w < 32 || h < 32) {
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nx = r.left / Math.max(1, vw - w);
      const ny = r.top / Math.max(1, vh - h);
      writeNavSheetPlacementPrefs(nx, ny);
    },

    applyNavSheetPlacementFromPreferences: function () {
      const inner = document.querySelector('#nav-sheet .nav-sheet-inner');
      const sheet = document.getElementById('nav-sheet');
      if (!inner || !sheet || sheet.hidden) {
        return;
      }
      const prefs = readNavSheetPlacementPrefs();
      if (!prefs) {
        this.clearNavSheetUserPlacement(inner);
        return;
      }
      const cw = sheet.clientWidth ? sheet.clientWidth : window.innerWidth;
      const w = Math.min(520, Math.max(200, cw));
      const rect = inner.getBoundingClientRect();
      const h = Math.ceil(rect.height) || inner.offsetHeight || 120;
      if (h < 40) {
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = prefs.nx * Math.max(1, vw - w);
      let top = prefs.ny * Math.max(1, vh - h);
      // Floating darf auch über den Viewport hinaus – z.B. um mehr Karte zu sehen.
      // Clamp nur weich, damit es nicht komplett "verloren" geht.
      const allow = 160;
      left = Math.min(Math.max(left, -allow), vw - w + allow);
      top = Math.min(Math.max(top, -allow), vh - h + allow);
      this.setNavSheetFloatingPixels(inner, left, top);
    },

    syncNavSettingsPanelPlacement: function () {
      const inner = document.querySelector('#nav-sheet .nav-sheet-inner');
      const panel = document.getElementById('nav-settings-panel');
      if (!inner || !panel || panel.hidden) {
        return;
      }
      const ir = inner.getBoundingClientRect();
      const ph = Math.max(
        panel.offsetHeight || 0,
        panel.getBoundingClientRect().height || 0,
        120
      );
      const gap = 10;
      const vh = window.innerHeight;
      let top = ir.top - gap - ph;
      if (top < NAV_SHEET_DRAG_MARGIN_PX) {
        top = ir.bottom + gap;
      }
      const maxTop = vh - ph - NAV_SHEET_DRAG_MARGIN_PX;
      if (top > maxTop) {
        top = Math.max(NAV_SHEET_DRAG_MARGIN_PX, maxTop);
      }
      panel.style.left = Math.round(ir.left) + 'px';
      panel.style.width = ir.width + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.top = Math.round(top) + 'px';
    },

    bindNavSheetPlacement: function () {
      if (this._navSheetPlacementBound) {
        return;
      }
      this._navSheetPlacementBound = true;
      const self = this;
      const handle = document.getElementById('nav-sheet-drag-handle');
      if (!handle || typeof handle.addEventListener !== 'function') {
        return;
      }
      let lastDragLenSq = 0;
      handle.addEventListener(
        'pointerdown',
        function (ev) {
          if (ev.pointerType === 'mouse' && ev.button !== 0) {
            return;
          }
          const inner = document.querySelector('#nav-sheet .nav-sheet-inner');
          if (!inner || document.getElementById('nav-sheet').hidden) {
            return;
          }
          lastDragLenSq = 0;
          try {
            handle.setPointerCapture(ev.pointerId);
          } catch (err) {
            /* ältere Browser */
          }
          const r = inner.getBoundingClientRect();
          self._navSheetDragState = {
            id: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            origLeft: r.left,
            origTop: r.top,
            origW: r.width,
            origH: r.height,
          };
          ev.preventDefault();
        },
        { passive: false }
      );
      handle.addEventListener('pointermove', function (ev) {
        const st = self._navSheetDragState;
        if (!st || ev.pointerId !== st.id) {
          return;
        }
        const dx = ev.clientX - st.startX;
        const dy = ev.clientY - st.startY;
        lastDragLenSq = dx * dx + dy * dy;
        const inner = document.querySelector('#nav-sheet .nav-sheet-inner');
        if (!inner) {
          return;
        }
        let left = st.origLeft + dx;
        let top = st.origTop + dy;
        const w = st.origW;
        const h = st.origH;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Floating darf über den Viewport hinaus gezogen werden.
        const allow = 160;
        left = Math.min(Math.max(left, -allow), vw - w + allow);
        top = Math.min(Math.max(top, -allow), vh - h + allow);
        self.setNavSheetFloatingPixels(inner, left, top);
        self.syncNavSheetMetrics();
      });
      function endDrag(ev) {
        const st = self._navSheetDragState;
        if (!st || ev.pointerId !== st.id) {
          return;
        }
        self._navSheetDragState = null;
        try {
          handle.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* ignorieren */
        }
        const inner = document.querySelector('#nav-sheet .nav-sheet-inner');
        if (inner && lastDragLenSq > 36) {
          self.persistNavSheetRect(inner);
        }
        self.syncNavSheetMetrics();
        self.syncNavSettingsPanelPlacement();
      }
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
      handle.addEventListener('dblclick', function () {
        clearNavSheetPlacementPrefs();
        const inner = document.querySelector('#nav-sheet .nav-sheet-inner');
        self.clearNavSheetUserPlacement(inner);
        self.syncNavSheetMetrics();
        self.syncNavSettingsPanelPlacement();
      });
      window.addEventListener('resize', function () {
        window.clearTimeout(self._navSheetResizeTimer);
        self._navSheetResizeTimer = window.setTimeout(function () {
          if (!document.body.classList.contains('nav-mode')) {
            return;
          }
          self.applyNavSheetPlacementFromPreferences();
          self.syncNavSheetMetrics();
        }, 140);
      });
    },

    schedulePrepareNavTts: function () {
      try {
        const engine = localStorage.getItem('nr_tts_engine') || '';
        if (engine && engine !== 'piper') {
          return;
        }
      } catch (eEngine) {
        /* ignore */
      }
      if (!this.voiceEnabled) {
        return;
      }
      if (this._ttsPreparePollIv != null) {
        window.clearInterval(this._ttsPreparePollIv);
        this._ttsPreparePollIv = null;
      }
      if (window.NRPiperTTS && typeof window.NRPiperTTS.prepareNavTts === 'function') {
        const self = this;
        void window.NRPiperTTS
          .prepareNavTts()
          .then(function (ok) {
            self.queueDebugLog(
              ok ? 'speech_piper_prepare_ok' : 'speech_piper_prepare_failed',
              { ok: !!ok },
              !ok
            );
          })
          .catch(function (err) {
            self.queueDebugLog(
              'speech_piper_prepare_error',
              { error: err && err.message ? String(err.message) : 'prepare_failed' },
              true
            );
          });
        return;
      }
      this.queueDebugLog(
        'speech_piper_prepare_wait',
        {
          reason: 'piper_not_ready',
          has_piper: !!window.NRPiperTTS,
          has_prepare: !!(window.NRPiperTTS && typeof window.NRPiperTTS.prepareNavTts === 'function'),
        },
        false
      );
      if (!this._ttsReadyListenerBound) {
        const self = this;
        this._ttsReadyListenerBound = true;
        window.addEventListener(
          'nr-piper-tts-ready',
          function () {
            self._ttsReadyListenerBound = false;
            self.queueDebugLog('speech_piper_ready', { source: 'ready_event' }, false);
            self.schedulePrepareNavTts();
          },
          { once: true }
        );
      }
      const self = this;
      let tries = 0;
      this._ttsPreparePollIv = window.setInterval(function () {
        tries++;
        if (window.NRPiperTTS && typeof window.NRPiperTTS.prepareNavTts === 'function') {
          window.clearInterval(self._ttsPreparePollIv);
          self._ttsPreparePollIv = null;
          self.schedulePrepareNavTts();
          return;
        }
        if (tries >= 50) {
          window.clearInterval(self._ttsPreparePollIv);
          self._ttsPreparePollIv = null;
        }
      }, 200);
    },

    _formatWeatherReportDe: function (w) {
      const parts = [];
      const temp = w && Number.isFinite(Number(w.temperature)) ? Math.round(Number(w.temperature)) : null;
      const condRaw = w && w.condition ? String(w.condition) : '';
      const k = condRaw.trim().toLowerCase();
      const cond = k === 'dry' ? 'trocken' : condRaw;
      const wind = w && Number.isFinite(Number(w.wind_speed)) ? Math.round(Number(w.wind_speed)) : null;
      const prec = w && Number.isFinite(Number(w.precipitation)) ? Number(w.precipitation) : null;
      if (cond) {
        parts.push(cond);
      }
      if (temp != null) {
        parts.push(temp + ' Grad');
      }
      if (wind != null) {
        parts.push('Wind ' + wind + ' km/h');
      }
      if (prec != null) {
        const mm = prec.toFixed(1).replace('.', ',');
        parts.push('Niederschlag ' + mm + ' Millimeter');
      }
      if (!parts.length) {
        return '';
      }
      return 'Wetter am Startpunkt: ' + parts.join(', ') + '.';
    },

    _fetchBrightskyWeather: async function (lat, lon) {
      const ymd = new Date().toISOString().slice(0, 10);
      const base = typeof window.NR_BASE === 'string' ? window.NR_BASE.replace(/\/$/, '') : '';
      const url =
        (base ? base + '/' : '/') +
        'api/weather.php?lat=' +
        encodeURIComponent(String(lat)) +
        '&lon=' +
        encodeURIComponent(String(lon)) +
        '&date=' +
        encodeURIComponent(ymd);
      const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error('brightsky_fetch_failed_' + res.status);
      }
      const wrapper = await res.json();
      const data = wrapper && wrapper.ok && wrapper.data ? wrapper.data : null;
      const arr = data && Array.isArray(data.weather) ? data.weather : [];
      if (!arr.length) {
        return null;
      }
      const nowMs = Date.now();
      let best = arr[0];
      let bestDist = Infinity;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        const ts = it && (it.timestamp || it.datetime || it.time) ? String(it.timestamp || it.datetime || it.time) : '';
        const tMs = ts ? Date.parse(ts) : NaN;
        const d = Number.isFinite(tMs) ? Math.abs(tMs - nowMs) : Infinity;
        if (d < bestDist) {
          bestDist = d;
          best = it;
        }
      }
      return best || null;
    },

    speakWeatherForNavigation: function (startLatLng) {
      if (this._weatherSpokenThisNav || !this.voiceEnabled || !this.isNavActive()) {
        return;
      }
      const engine = this._getTtsEngine();

      const ll = startLatLng || this._lastLatLng;
      if (!ll || !Number.isFinite(Number(ll.lat)) || !Number.isFinite(Number(ll.lng))) {
        this._weatherSpokenThisNav = true;
        return;
      }
      this._weatherSpokenThisNav = true;
      const self = this;
      const run = function () {
        void self
          ._fetchBrightskyWeather(Number(ll.lat), Number(ll.lng))
          .then(function (w) {
            const phrase = self._formatWeatherReportDe(w);
            if (!phrase) {
              return;
            }
            // Nicht in die Welcome-Ansage reinsprechen.
            const delay = self._speechSuppressUntilMs && Date.now() < self._speechSuppressUntilMs ? self._speechSuppressUntilMs - Date.now() + 250 : 0;
            window.setTimeout(function () {
              if (!self.isNavActive()) return;
              self.queueDebugLog('speech_trigger', { stage: 'weather', text: phrase }, false);
              if (engine === 'system') {
                self._speakSystem(phrase);
              } else {
                self.speakNavText(phrase, 'mile');
              }
            }, Math.max(0, Math.min(4000, delay)));
          })
          .catch(function (err) {
            self.queueDebugLog(
              'weather_fetch_failed',
              { error: err && err.message ? String(err.message) : 'fetch_failed' },
              false
            );
          });
      };
      run();
    },

    _getTtsEngine: function () {
      try {
        const cfg = window.NR_USER_SETTINGS && typeof window.NR_USER_SETTINGS === 'object' ? window.NR_USER_SETTINGS : null;
        const e = cfg && typeof cfg.ttsEngine === 'string' ? String(cfg.ttsEngine).toLowerCase() : '';
        if (e === 'system') return 'system';
        if (e === 'piper') return 'piper';
      } catch (e0) {
        /* ignore */
      }
      try {
        const e = localStorage.getItem('nr_tts_engine');
        if (e === 'system') return 'system';
        return 'piper';
      } catch (e0) {
        return 'piper';
      }
    },

    _speakSystem: function (text) {
      if (!text || !this._speechArmed || typeof window.speechSynthesis === 'undefined') {
        return false;
      }
      try {
        const u = new SpeechSynthesisUtterance(String(text));
        u.lang = 'de-DE';
        u.volume = Math.max(0, Math.min(1, Number(this.voiceVolume) || 1));
        u.rate = 0.96;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        return true;
      } catch (e) {
        return false;
      }
    },

    _resolveUserDisplayNameForWelcome: function () {
      try {
        const el = document.getElementById('panel-user-name');
        const name = el && el.textContent ? String(el.textContent).trim() : '';
        if (name) {
          return name;
        }
      } catch (e) {
        /* ignorieren */
      }
      try {
        const u = window.NR_USER && typeof window.NR_USER === 'object' ? window.NR_USER : null;
        const dn = u && u.display_name ? String(u.display_name).trim() : '';
        if (dn) {
          return dn;
        }
        const em = u && u.email ? String(u.email).trim() : '';
        if (em) {
          return em.split('@')[0] || em;
        }
      } catch (e2) {
        /* ignorieren */
      }
      return '';
    },

    speakWelcomeForNavigation: function () {
      // Wenn bereits eine Page-Load Begrüßung gesprochen/angestoßen wurde, nicht nochmal begrüßen.
      if (window.__nrPiperPageGreetDone || window.__nrAnyWelcomeDone) {
        this._welcomeSpokenThisNav = true;
        return;
      }
      if (!this._speechArmed || this._welcomeSpokenThisNav || !this.voiceEnabled || !this.isNavActive()) {
        return;
      }
      const piper = window.NRPiperTTS;
      if (!piper || typeof piper.speak !== 'function') {
        this._welcomeRetryCount = (this._welcomeRetryCount || 0) + 1;
        if (this._welcomeRetryCount <= 6) {
          const self = this;
          window.setTimeout(function () {
            self.speakWelcomeForNavigation();
          }, 450);
        }
        return;
      }
      this._welcomeRetryCount = 0;
      this._welcomeSpokenThisNav = true;
      window.__nrAnyWelcomeDone = true;
      this._speechSuppressUntilMs = Date.now() + 2800;
      const name = this._resolveUserDisplayNameForWelcome();
      const hello = name ? 'Hallo ' + name + '!' : 'Hallo!';
      const phrase =
        hello +
        ' Schön, dass du wieder unterwegs bist. Ich wünsche dir eine tolle Tour — los geht’s.';
      this.queueDebugLog('speech_trigger', { stage: 'welcome', text: phrase }, true);
      // Nicht als 'step' sprechen, damit nachfolgende Step-Ansagen nicht sofort canceln.
      this.speakNavText(phrase, 'mile');
    },

    /**
     * @param {'step' | 'mile' | 'curve' | 'fitness'} kind
     */
    speakNavText: function (text, kind) {
      if (!text || !this._speechArmed || !this.voiceEnabled || !this.isNavActive()) {
        return;
      }
      const engine = this._getTtsEngine();
      if (engine === 'system') {
        this.queueDebugLog('speech_engine_selected', { kind: kind, engine: 'system' }, false);
        this._speakSystem(text);
        return;
      }
      const piper = window.NRPiperTTS;
      const hasPiper = piper && typeof piper.speak === 'function';
      this.queueDebugLog(
        'speech_engine_probe',
        {
          kind: kind,
          has_piper: !!hasPiper,
          has_web: false,
          allow_web_fallback: false,
          piper_ready: !!(window.NRPiperTTS && typeof window.NRPiperTTS.prepareNavTts === 'function'),
        },
        false
      );
      if (!hasPiper) {
        this.queueDebugLog(
          'speech_engine_selected',
          { kind: kind, engine: 'system', reason: 'piper_unavailable_fallback' },
          true
        );
        // Fallback: wenn Piper (noch) nicht bereit ist, nicht stumm bleiben.
        this._speakSystem(text);
        return;
      }

      const now = Date.now();
      const gap =
        kind === 'step' ? 0 : kind === 'mile' ? 2200 : kind === 'fitness' ? 420 : 2350;
      if (kind !== 'step' && now - this._lastSpeechAtMs < gap) {
        return;
      }
      this._lastSpeechAtMs = now;

      // iOS/Safari: autoplay / suspended context. Auch auf Desktop harmlos.
      this.primeNavAudioAndSpeech();
      this.cancelLegacySpeechSynthesis();
      if (kind === 'step') {
        if (window.NRPiperTTS && typeof window.NRPiperTTS.cancelSpeech === 'function') {
          window.NRPiperTTS.cancelSpeech();
        } else if (typeof piper.cancel === 'function') {
          piper.cancel();
        }
      }

      const self = this;
      const speakPiperAttempt = function (attempt) {
        self.queueDebugLog(
          'speech_piper_request',
          { kind: kind, text: text, volume: self.voiceVolume, attempt: attempt },
          false
        );
        return piper.speak(text, { kind: kind, volume: self.voiceVolume }).then(function (usedPiper) {
          const ok = !!usedPiper;
          self.queueDebugLog(
            'speech_piper_result',
            { kind: kind, text: text, volume: self.voiceVolume, used_piper: ok, attempt: attempt },
            !ok
          );
          return ok;
        });
      };

      self.queueDebugLog('speech_engine_selected', { kind: kind, engine: 'piper' }, false);
      speakPiperAttempt(1)
        .then(function (usedPiper) {
          if (usedPiper || !self.isNavActive()) {
            return;
          }
          // Häufigste Ursache: Audio-Policy / blockiertes play(). Einmal primen + Retry.
          self.primeNavAudioAndSpeech();
          window.setTimeout(function () {
            if (!self.isNavActive()) {
              return;
            }
            speakPiperAttempt(2)
              .then(function (ok2) {
                if (!ok2 && self.isNavActive()) {
                  self.schedulePrepareNavTts();
                  self.queueDebugLog(
                    'speech_engine_selected',
                    { kind: kind, engine: 'system', reason: 'piper_returned_false_fallback' },
                    true
                  );
                  self._speakSystem(text);
                }
              })
              .catch(function (err2) {
                self.queueDebugLog(
                  'speech_piper_error',
                  {
                    kind: kind,
                    text: text,
                    volume: self.voiceVolume,
                    error: err2 && err2.message ? String(err2.message) : 'piper_failed',
                    attempt: 2,
                  },
                  true
                );
                self.schedulePrepareNavTts();
              });
          }, 120);
        })
        .catch(function (err) {
          self.queueDebugLog(
            'speech_piper_error',
            {
              kind: kind,
              text: text,
              volume: self.voiceVolume,
              error: err && err.message ? String(err.message) : 'piper_failed',
              attempt: 1,
            },
            true
          );
          self.schedulePrepareNavTts();
          if (self.isNavActive()) {
            self.queueDebugLog(
              'speech_engine_selected',
              { kind: kind, engine: 'system', reason: 'piper_error_fallback' },
              true
            );
            self._speakSystem(text);
          }
        });
    },

    speakFitnessPoint: function (delta) {
      // Fitness-Ansagen müssen strikt über den Schalter laufen.
      if (!this.fitnessVoiceEnabled || !this.voiceEnabled) {
        return;
      }
      const count = Number.isFinite(Number(delta)) ? Math.max(1, Math.floor(Number(delta))) : 1;
      const pointsWord = count === 1 ? 'Fitnesspunkt' : 'Fitnesspunkte';
      const totalThisRide = Number.isFinite(Number(this._fitnessAwardedThisNav))
        ? Math.max(0, Math.floor(Number(this._fitnessAwardedThisNav)))
        : null;
      const phrase =
        totalThisRide != null && totalThisRide > 0
          ? count === 1
            ? 'Wieder ein Kilometer. Auf dieser Strecke nun insgesamt ' + totalThisRide + ' Kilometer. Sie erhalten einen ' + pointsWord + '.'
            : 'Schon ' + count + ' Kilometer. Auf dieser Strecke nun insgesamt ' + totalThisRide + ' Kilometer. Sie erhalten ' + count + ' ' + pointsWord + '.'
          : count === 1
            ? 'Wieder ein Kilometer. Sie erhalten einen ' + pointsWord + '.'
            : 'Schon ' + count + ' Kilometer. Sie erhalten ' + count + ' ' + pointsWord + '.';
      this.speakNavText(phrase, 'fitness');
    },

    maybeAwardFitnessPoints: function (along, isSim, navSpeechTriggered, speedMs) {
      if (!this.isNavActive() || !Number.isFinite(along)) {
        return;
      }
      if (this._fitnessLastAlongM == null || !Number.isFinite(this._fitnessLastAlongM)) {
        // Erstes Sample der Session: die bereits zurückgelegten Meter nicht "verlieren",
        // sonst kommt die Kilometer-Gutschrift dauerhaft zu spät (typisch ~1 GPS-Update ≈ 50–150 m).
        // Nach Reroutes wird _fitnessLastAlongM ebenfalls auf null gesetzt, _fitnessPrimed bleibt dann true
        // und wir zählen hier bewusst keinen Offset an.
        this._fitnessLastAlongM = along;
        if (!this._fitnessPrimed) {
          const initial = Math.max(0, Math.floor(Number(along) || 0));
          // Sicherheitsgurt: Start sollte nahe 0 sein — große Offsets nicht auf Punkte anrechnen.
          if (initial > 0 && initial <= 250) {
            this._fitnessAccumulatedM += initial;
          }
          this._fitnessPrimed = true;
        }
      }
      const deltaM = along - this._fitnessLastAlongM;
      this._fitnessLastAlongM = along;
      if (deltaM <= 0) {
        return;
      }
      // Nur "echte" Bewegung zählt (GPS-Jitter soll keine Punkte erzeugen).
      // Simulation zählt immer.
      if (!isSim) {
        const s = typeof speedMs === 'number' && Number.isFinite(speedMs) ? speedMs : 0;
        if (s < 0.8) {
          return;
        }
      }
      this._fitnessAccumulatedM += deltaM;
      let due = 0;
      while (this._fitnessAccumulatedM >= 1000) {
        due++;
        this._fitnessAccumulatedM -= 1000;
      }
      if (due <= 0) {
        return;
      }
      this._fitnessAwardedThisNav += due;
      try {
        document.dispatchEvent(
          new CustomEvent('nr-nav-fitness-point', {
            detail: {
              delta: due,
              kilometer: this._fitnessAwardedThisNav,
              awarded_this_navigation: this._fitnessAwardedThisNav,
            },
          })
        );
      } catch (err) {
        /* ignorieren */
      }
      const self = this;
      if (!this.fitnessVoiceEnabled) {
        return;
      }
      if (navSpeechTriggered) {
        window.setTimeout(function () {
          self.speakFitnessPoint(due);
        }, 2200);
      } else {
        this.speakFitnessPoint(due);
      }
    },

    maybeSpeakNavigation: function (state, along, speedMs) {
      void along;
      if (!this._speechArmed || !this.voiceEnabled || !this.isNavActive()) {
        return false;
      }
      const engine = this._getTtsEngine();
      const voiceAvailable =
        engine === 'system'
          ? typeof window.speechSynthesis !== 'undefined'
          : window.NRPiperTTS && typeof window.NRPiperTTS.speak === 'function';
      if (!voiceAvailable) {
        return false;
      }
      if (Date.now() < (this._speechSuppressUntilMs || 0)) {
        return false;
      }

      const windows = maneuverSpeechWindows(state, speedMs);

      const stepKey = state.arrived ? 'arrived' : String(state.nextIdx != null ? state.nextIdx : -1);

      if (stepKey !== this._lastSpeechStepKey) {
        // Zoom wird ausschließlich durch Manöver-Trigger gesteuert (nah/normal).
        // Kein zusätzlicher Zoom-Reset bei Step-Wechsel, damit Follow nicht "extra" zoomt.
        this.queueDebugLog(
          'nav_step_change',
          {
            step_key: stepKey,
            along_m: Math.round(along),
            next_idx: state.nextIdx,
            dist_to_maneuver_m: Math.round(state.distToManeuver),
            type: state.type,
            raw_type: state.raw_type,
            arrived: !!state.arrived,
          },
          true
        );
        this._lastSpeechStepKey = stepKey;
        this._milestonesDone = {};

        if (state.arrived) {
          const phrase = formatNavSpeechPreview(state);
          if (phrase) {
            this.speakNavText(phrase, 'step');
            return true;
          }
          return false;
        }

        if (!this._initialStartPromptDone && along <= 12 && orsStepWarrantsSpeech(state.type)) {
          this._initialStartPromptDone = true;
          const startPhrase = formatNavSpeechByStage(state, 'far');
          if (startPhrase) {
            this.queueDebugLog(
              'speech_trigger',
              {
                stage: 'start',
                next_idx: state.nextIdx,
                dist_to_maneuver_m: Math.round(state.distToManeuver),
                type: state.type,
                text: startPhrase,
              },
              true
            );
            this.speakNavText(startPhrase, 'step');
            return true;
          }
          return false;
        }

        if (orsStepWarrantsSpeech(state.type) && state.distToManeuver <= windows.immediate) {
          const immediatePhrase = formatNavSpeechByStage(state, 'now');
          if (immediatePhrase) {
            this.queueDebugLog(
              'speech_trigger',
              {
                stage: 'immediate',
                next_idx: state.nextIdx,
                dist_to_maneuver_m: Math.round(state.distToManeuver),
                type: state.type,
                text: immediatePhrase,
              },
              true
            );
            this.speakNavText(immediatePhrase, 'step');
            this.pulseEventZoom('now', state, stepKey, { alongM: along, distToManeuverM: d });
            this._milestonesDone.far = true;
            this._milestonesDone.near = true;
            this._milestonesDone.now = true;
            return true;
          }
        }
        return false;
      }

      if (state.arrived) {
        return false;
      }

      if (!orsStepWarrantsSpeech(state.type)) {
        return false;
      }

      const d = Math.round(state.distToManeuver);
      // Leicht früher ranzoomen als "immediate", aber ohne den "near"-Trigger zu nutzen.
      // Idee: kurz vor dem eigentlichen Abbiegen mehr Kontext anzeigen, ohne zu früh zu nerven.
      const approachWindowM = Math.min(windows.previewNear, windows.immediate + 40);
      if (!this._milestonesDone.approach_zoom && d <= approachWindowM && d > windows.immediate) {
        this._milestonesDone.approach_zoom = true;
        this.pulseEventZoom('approach', state, stepKey, { alongM: along, distToManeuverM: d });
      }
      if (!this._milestonesDone.far && d <= windows.previewFar && d > windows.previewNear) {
        this._milestonesDone.far = true;
        const farPhrase = formatNavSpeechByStage(state, 'far');
        if (farPhrase) {
          this.queueDebugLog(
            'speech_trigger',
            {
              stage: 'far',
              next_idx: state.nextIdx,
              dist_to_maneuver_m: d,
              type: state.type,
              text: farPhrase,
            },
            true
          );
          this.speakNavText(farPhrase, 'mile');
          return true;
        }
        return false;
      }

      if (!this._milestonesDone.near && d <= windows.previewNear && d > windows.immediate) {
        this._milestonesDone.far = true;
        this._milestonesDone.near = true;
        const nearPhrase = formatNavSpeechByStage(state, 'near');
        if (nearPhrase) {
          this.queueDebugLog(
            'speech_trigger',
            {
              stage: 'near',
              next_idx: state.nextIdx,
              dist_to_maneuver_m: d,
              type: state.type,
              text: nearPhrase,
            },
            true
          );
          this.speakNavText(nearPhrase, 'curve');
          return true;
        }
        return false;
      }

      if (!this._milestonesDone.now && d <= windows.immediate) {
        this._milestonesDone.far = true;
        this._milestonesDone.near = true;
        this._milestonesDone.now = true;
        const nowPhrase = formatNavSpeechByStage(state, 'now');
        if (nowPhrase) {
          this.queueDebugLog(
            'speech_trigger',
            {
              stage: 'now',
              next_idx: state.nextIdx,
              dist_to_maneuver_m: d,
              type: state.type,
              text: nowPhrase,
            },
            true
          );
          this.speakNavText(nowPhrase, 'step');
          this.pulseEventZoom('now', state, stepKey, { alongM: along, distToManeuverM: d });
          return true;
        }
      }
      return false;
    },

    _cancelNavFlyToFinishTimer: function () {
      if (this._navFlyToFinishTimer != null) {
        window.clearTimeout(this._navFlyToFinishTimer);
        this._navFlyToFinishTimer = null;
      }
      this._eventZoomFlight = false;
    },

    /**
     * Zoom/Center-Animation per Leaflet flyTo — Navigation darf währenddessen nicht nachziehen (syncMapUnderPosition).
     *
     * @param {object} latlng Leaflet LatLng
     * @param {number} zoom Ziel-Zoom
     * @param {number} durationSec Leaflet-Dauer (Sekunden)
     * @param {function(): void} [done]
     */
    _beginNavFlyTo: function (latlng, zoom, durationSec, done) {
      const self = this;
      const m = this.map;
      if (!m || !latlng) {
        if (typeof done === 'function') {
          done();
        }
        return;
      }

      this._cancelNavFlyToFinishTimer();
      if (typeof m.stop === 'function') {
        try {
          m.stop();
        } catch (e) {
          /* ignore */
        }
      }

      const finish = function () {
        self._cancelNavFlyToFinishTimer();
        if (typeof done === 'function') {
          done();
        }
      };

      const durMs = Math.round(Math.max(0.18, durationSec) * 1000) + 420;
      this._eventZoomFlight = true;
      this._navFlyToFinishTimer = window.setTimeout(function () {
        self._navFlyToFinishTimer = null;
        self._eventZoomFlight = false;
        if (typeof done === 'function') {
          done();
        }
      }, durMs);

      // Zoom sofort setzen, damit die Karte direkt "nah" sichtbar ist.
      // Danach flyTo nur noch für weiches Zentrieren (Zoom bleibt gleich).
      try {
        if (typeof m.getZoom === 'function' && typeof m.setZoom === 'function') {
          const cz = Number(m.getZoom());
          if (Number.isFinite(cz) && Math.abs(cz - zoom) >= 0.2) {
            m.setZoom(zoom, { animate: false });
          }
        }
      } catch (e0) {
        /* ignore */
      }

      try {
        if (typeof m.flyTo === 'function') {
          m.flyTo(latlng, zoom, { animate: true, duration: durationSec });
          return;
        }
      } catch (e) {
        finish();
        return;
      }

      try {
        if (typeof m.setView === 'function') {
          m.setView(latlng, zoom, { animate: false });
        }
      } catch (e2) {
        /* ignore */
      }
      finish();
    },

    /**
     * @param {'approach'|'now'} kind
     * @param {any} state
     * @param {string|null} stepKey
     * @param {{ alongM?: number, distToManeuverM?: number }} [meta]
     */
    pulseEventZoom: function (kind, state, stepKey, meta) {
      if (!this.map || !this._lastLatLng || !this.isNavActive()) {
        return;
      }
      if (state && state.arrived) {
        this.hideManeuverOverlay();
        return;
      }
      const t = Number(state && state.type);
      if (Number.isNaN(t) || t === 6) {
        this.hideManeuverOverlay();
        return;
      }

      // Nur Overlay anzeigen – kein Auto-Heranzoomen.
      try {
        const wrap = document.getElementById('nav-maneuver-overlay');
        const icon = document.getElementById('nav-maneuver-overlay-icon');
        if (wrap && icon) {
          wrap.hidden = false;
          wrap.setAttribute('aria-hidden', 'false');
          icon.innerHTML = iconMarkupForType(state.type, false);
          icon.setAttribute('data-maneuver', typeToIconKey(state.type));
          const sk = stepKey != null ? String(stepKey) : null;
          this._maneuverOverlayStepKey = sk;
          // Hide-Position wird zentral in updateFromLatLng berechnet (route-based),
          // damit das Overlay nicht durch Hysterese/Step-Wechsel zu früh verschwindet.
          if (this._maneuverOverlayHideTimer) {
            window.clearTimeout(this._maneuverOverlayHideTimer);
            this._maneuverOverlayHideTimer = null;
          }
        }
      } catch (e0) {
        /* ignore */
      }
    },

    hideManeuverOverlay: function () {
      try {
        const wrap = document.getElementById('nav-maneuver-overlay');
        if (wrap) {
          wrap.hidden = true;
          wrap.setAttribute('aria-hidden', 'true');
        }
      } catch (e0) {
        /* ignore */
      }
      this._maneuverOverlayStepKey = null;
      this._maneuverOverlayHideAfterAlongM = null;
      if (this._maneuverOverlayHideTimer) {
        window.clearTimeout(this._maneuverOverlayHideTimer);
        this._maneuverOverlayHideTimer = null;
      }
    },

    maybeAutoZoomOutForLongStretch: function (state) {
      if (!this.map || !this._lastLatLng || !this.isNavActive()) {
        return;
      }
      if (this.mapHeadingUp) {
        return;
      }
      if (this._eventZoomActive || this._eventZoomFlight) {
        return;
      }
      if (!state || state.arrived) {
        return;
      }
      const d = Math.round(Number(state.distToManeuver));
      if (!Number.isFinite(d) || d < 700) {
        return;
      }
      const m = this.map;
      const currentZoom = typeof m.getZoom === 'function' ? Number(m.getZoom()) : 0;
      if (!Number.isFinite(currentZoom) || currentZoom <= this._navZoomFar + 0.05) {
        return;
      }
      const nowMs = Date.now();
      if (nowMs - (this._lastAutoZoomOutAtMs || 0) < 6500) {
        return;
      }
      this._lastAutoZoomOutAtMs = nowMs;
      this._beginNavFlyTo(this._lastLatLng, this._navZoomFar, 0.85);
    },

    ensureNavZoomFar: function (opts) {
      if (!this.map || !this._lastLatLng || !this.isNavActive()) {
        return;
      }
      // In Fahrtrichtung (heading-up) kein Auto-Zoom: dort soll der Nutzer-Zoom stabil bleiben.
      if (this.mapHeadingUp) {
        return;
      }
      if (this._eventZoomFlight) {
        return;
      }
      if (this._navZoomOutTimer) {
        window.clearTimeout(this._navZoomOutTimer);
        this._navZoomOutTimer = null;
      }
      if (this._eventZoomRestoreTimer) {
        window.clearTimeout(this._eventZoomRestoreTimer);
        this._eventZoomRestoreTimer = null;
      }
      this._eventZoomActive = false;
      this._eventZoomPrevZoom = null;
      this._eventZoomTargetZoom = null;
      this._navZoomNearStepKey = null;
      const delayMs = opts && typeof opts.delayMs === 'number' && Number.isFinite(opts.delayMs) ? opts.delayMs : 0;
      const self = this;

      // Overlay schließen, sobald wieder rausgezoomt wird.
      try {
        const wrap = document.getElementById('nav-maneuver-overlay');
        if (wrap) {
          wrap.hidden = true;
          wrap.setAttribute('aria-hidden', 'true');
        }
      } catch (e0) {
        /* ignore */
      }
      if (this._maneuverOverlayHideTimer) {
        window.clearTimeout(this._maneuverOverlayHideTimer);
        this._maneuverOverlayHideTimer = null;
      }

      if (delayMs > 0) {
        this._navZoomOutTimer = window.setTimeout(function () {
          self._navZoomOutTimer = null;
          self._beginNavFlyTo(self._lastLatLng, self._navZoomFar, 0.85);
        }, Math.round(delayMs));
        return;
      }
      this._beginNavFlyTo(this._lastLatLng, this._navZoomFar, 0.85);
    },

    /**
     * Karte unter dem Positionspunkt verschieben (Punkt bleibt in der Mitte /
     * leicht oberhalb des Navigations-Bottom-Sheets), ohne Animations-Nachlauf.
     */
    /**
     * @param {object} latlng Leaflet LatLng
     * @param {{ preferUpperHalf?: boolean }} [opts]
     */
    syncMapUnderPosition: function (latlng, opts) {
      if (!this.map || !this.Lref) {
        return;
      }
      if (this._eventZoomFlight) {
        return;
      }
      const m = this.map;
      let z;
      if (this._eventZoomActive && this._eventZoomTargetZoom != null) {
        z = Number(this._eventZoomTargetZoom);
      } else {
        this._navHeadingPinZoom = null;
        const gz = typeof m.getZoom === 'function' ? Number(m.getZoom()) : NaN;
        z = Number.isFinite(gz) ? gz : 16;
      }
      m.setView(latlng, z, { animate: false });

      // Marker soll im "sichtbaren" Kartenausschnitt landen (ohne überlagernde UI).
      // Wichtig: panBy bewegt die Karte, der Marker bewegt sich visuell in Gegenrichtung.
      // Um Drift/Jitter zu vermeiden, berechnen wir das Ziel als Pixelposition und panen nur,
      // wenn der Marker davon abweicht (Deadband).
      let desiredOffsetX = 0;
      let desiredOffsetY = 0;
      try {
        const container = typeof m.getContainer === 'function' ? m.getContainer() : null;
        const mapRect = container && typeof container.getBoundingClientRect === 'function' ? container.getBoundingClientRect() : null;
        const maneuverOverlay =
          typeof document !== 'undefined' ? document.getElementById('nav-maneuver-overlay') : null;
        const maneuverRect =
          maneuverOverlay && !maneuverOverlay.hidden && typeof maneuverOverlay.getBoundingClientRect === 'function'
            ? maneuverOverlay.getBoundingClientRect()
            : null;
        const sheet = typeof document !== 'undefined' ? document.getElementById('nav-sheet') : null;
        const sheetInner = sheet ? sheet.querySelector('.nav-sheet-inner') : null;
        const sheetRect =
          sheet && !sheet.hidden && sheetInner && typeof sheetInner.getBoundingClientRect === 'function'
            ? sheetInner.getBoundingClientRect()
            : null;
        if (mapRect && sheetRect) {
          // Intersection von Karte und Panel bestimmen.
          const ix0 = Math.max(mapRect.left, sheetRect.left);
          const ix1 = Math.min(mapRect.right, sheetRect.right);
          const iy0 = Math.max(mapRect.top, sheetRect.top);
          const iy1 = Math.min(mapRect.bottom, sheetRect.bottom);
          const iw = Math.max(0, ix1 - ix0);
          const ih = Math.max(0, iy1 - iy0);

          // Nur dann offsetten, wenn das Panel die Karte tatsächlich überdeckt.
          // Split-Layout kann durch Rundung 1–2px "überlappen" → ignorieren.
          if (iw > 8 && ih > 8) {
            // Overlaps nur zählen, wenn die Intersection den jeweiligen Rand berührt.
            const overlapBottom = Math.abs(iy1 - mapRect.bottom) < 0.5 ? ih : 0;
            const overlapTop = Math.abs(iy0 - mapRect.top) < 0.5 ? ih : 0;
            const overlapLeft = Math.abs(ix0 - mapRect.left) < 0.5 ? iw : 0;
            const overlapRight = Math.abs(ix1 - mapRect.right) < 0.5 ? iw : 0;

            // Sichtbares Zentrum verschiebt sich in Richtung "mehr freier Raum".
            // Marker soll sich in diese Richtung bewegen.
            desiredOffsetX += Math.round((overlapLeft - overlapRight) / 2);
            desiredOffsetY += Math.round((overlapTop - overlapBottom) / 2);
          }

          // Simulation: Marker soll nicht "mittig" liegen, sondern in der Mitte der oberen Hälfte
          // des sichtbaren Kartenausschnitts (mehr Vorschau nach vorn).
          const preferUpper = !!(opts && opts.preferUpperHalf);
          if (preferUpper) {
            // Für Simulation: wir nutzen, falls Panel die Karte überdeckt, den überdeckten Boden als Abzug.
            // Wenn es keine Überdeckung gibt (Split-Layout), bleibt overlapBottom 0.
            const overlapBottomEff = Math.max(0, mapRect.bottom - sheetRect.top);
            const visibleTop = mapRect.top;
            const visibleBottom = mapRect.bottom - overlapBottomEff;
            const visibleH = Math.max(0, visibleBottom - visibleTop);
            if (visibleH > 0) {
              // Marker nach oben (mehr "Vorschau" nach vorn): Mittelpunkt -> Mitte obere Hälfte.
              desiredOffsetY -= Math.round(visibleH * 0.25);
            }
          }
        } else if (mapRect) {
          // Kein Sheet messbar: trotzdem Simulation-Offset anwenden.
          const preferUpper = !!(opts && opts.preferUpperHalf);
          if (preferUpper) {
            desiredOffsetY -= Math.round(Math.max(0, mapRect.height) * 0.25);
          }
        }

        // Abbiege-Overlay liegt oben rechts und soll die Positionsanzeige nicht beeinflussen.
      } catch (e0) {
        desiredOffsetX = 0;
        desiredOffsetY = 0;
      }
      // Zielpixelposition aus Offset ableiten und nur bei Abweichung panen (verhindert "Nachschieben").
      try {
        if (Date.now() < (this._navSuppressPanUntilMs || 0)) {
          return;
        }
        const size = typeof m.getSize === 'function' ? m.getSize() : null;
        const cur = typeof m.latLngToContainerPoint === 'function' ? m.latLngToContainerPoint(latlng) : null;
        if (size && cur && typeof cur.x === 'number' && typeof cur.y === 'number') {
          const clamp = function (v, maxAbs) {
            const n = Number(v) || 0;
            return Math.max(-maxAbs, Math.min(maxAbs, n));
          };
          const offX = clamp(desiredOffsetX, 240);
          const offY = clamp(desiredOffsetY, 240);
          const targetX = size.x / 2 + offX;
          const targetY = size.y / 2 + offY;
          const dx = Math.round(cur.x - targetX);
          const dy = Math.round(cur.y - targetY);
          // Deadband: 2px Toleranz gegen Subpixel-Jitter.
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            m.panBy(this.Lref.point(dx, dy), { animate: false });
          }
        }
      } catch (ePan) {
        /* ignore */
      }
    },

    /**
     * Fahrtrichtung oben: Rotation nur am Leaflet-Container innerhalb #nr-map-viewport.
     * mapPane bleibt unverändert (vermeidet Konflikt mit Leaflets translate3d auf den Kacheln).
     */
    applyLeafletRotation: function (deg) {
      const map = this.map;
      const Ldom = this.Lref && this.Lref.DomUtil;
      if (!map || !Ldom) {
        return;
      }
      const n = Number(deg);
      const rotRaw = Number.isFinite(n) ? n : 0;
      const useHeading =
        !!this.mapHeadingUp && this.isNavActive() && Math.abs(rotRaw) > 0.05;

      const container = map.getContainer && map.getContainer();
      const viewport = typeof document !== 'undefined' ? document.getElementById('nr-map-viewport') : null;

      if (!useHeading) {
        this._nrHeadingCoverScaleSmoothed = null;
        this._nrHeadingCoverScaleFixed = null;
        this._nrHeadingCoverScaleFixedW = null;
        this._nrHeadingCoverScaleFixedH = null;
        this._nrHeadingRotSmoothed = null;
        this._navHeadingPinZoom = null;
        if (container && container.style) {
          container.style.transform = '';
          container.style.transformOrigin = '';
          container.style.willChange = '';
        }
        if (viewport) {
          viewport.classList.remove('nr-map-viewport--heading');
        }
        const pane = map.getPane && map.getPane('mapPane');
        if (pane) {
          const pos = Ldom.getPosition(pane);
          const px = pos && typeof pos.x === 'number' ? pos.x : 0;
          const py = pos && typeof pos.y === 'number' ? pos.y : 0;
          Ldom.setPosition(pane, this.Lref.point(px, py));
        }
        return;
      }

      if (!container || !container.style) {
        return;
      }

      let w = viewport ? viewport.clientWidth : 0;
      let h = viewport ? viewport.clientHeight : 0;
      if (!(w > 0) || !(h > 0)) {
        const size = typeof map.getSize === 'function' ? map.getSize() : null;
        w = size && size.x > 0 ? size.x : 0;
        h = size && size.y > 0 ? size.y : 0;
      }
      if (!(w > 0) || !(h > 0)) {
        this._nrHeadingCoverScaleSmoothed = null;
        this._nrHeadingCoverScaleFixed = null;
        this._nrHeadingCoverScaleFixedW = null;
        this._nrHeadingCoverScaleFixedH = null;
        this._nrHeadingRotSmoothed = null;
        if (container.style) {
          container.style.transform = '';
          container.style.transformOrigin = '';
          container.style.willChange = '';
        }
        if (viewport) {
          viewport.classList.remove('nr-map-viewport--heading');
        }
        return;
      }

      const rotSmooth = smoothHeadingRotationForTransform(this._nrHeadingRotSmoothed, rotRaw);
      this._nrHeadingRotSmoothed = rotSmooth;
      if (
        this._nrHeadingCoverScaleFixed == null ||
        this._nrHeadingCoverScaleFixedW !== w ||
        this._nrHeadingCoverScaleFixedH !== h
      ) {
        this._nrHeadingCoverScaleFixed = computeMaxNrHeadingCoverScale(w, h);
        this._nrHeadingCoverScaleFixedW = w;
        this._nrHeadingCoverScaleFixedH = h;
      }
      const scale = this._nrHeadingCoverScaleFixed;
      container.style.transformOrigin = '50% 50%';
      container.style.transform = 'rotate(' + rotSmooth + 'deg) scale(' + scale + ')';
      container.style.willChange = 'transform';
      if (viewport) {
        viewport.classList.add('nr-map-viewport--heading');
      }
    },

    init: function (mapInstance) {
      this.map = mapInstance;
      this.Lref = typeof L !== 'undefined' ? L : null;
      if (!this.Lref) {
        return;
      }
      const self = this;
      this.bindNavWakeLockLifecycle();
      this.bindNavSheetPlacement();
      const sheet = document.getElementById('nav-sheet');
      if (sheet) {
        sheet.addEventListener(
          'touchstart',
          function () {
            self.blurActiveEditableForNavigation();
            self.primeNavAudioAndSpeech();
          },
          { passive: true }
        );
      }
      document.addEventListener(
        'focusin',
        function (ev) {
          if (!document.body.classList.contains('nav-mode')) {
            return;
          }
          const target = ev.target;
          if (isEditableElement(target)) {
            window.setTimeout(function () {
              self.blurActiveEditableForNavigation();
              self.focusNavigationSurface();
            }, 0);
          }
        },
        true
      );
      const btnClose = document.getElementById('nav-close');
      const btnReturnStart = document.getElementById('nav-return-start');
      const btnStart = document.getElementById('btn-nav-start');
      const simOn = document.getElementById('nav-sim-on');
      const simControls = document.getElementById('nav-sim-controls');
      const simKmh = document.getElementById('nav-sim-kmh');
      const simPrev = document.getElementById('nav-sim-prev');
      const simNext = document.getElementById('nav-sim-next');
      const mapHeadingBox = document.getElementById('nav-map-heading-on');
      if (mapHeadingBox) {
        try {
          self.mapHeadingUp = localStorage.getItem('nr_nav_map_heading') === '1';
        } catch (err0) {
          self.mapHeadingUp = false;
        }
        mapHeadingBox.checked = !!self.mapHeadingUp;
        mapHeadingBox.addEventListener('change', function () {
          self.mapHeadingUp = !!mapHeadingBox.checked;
          try {
            localStorage.setItem('nr_nav_map_heading', self.mapHeadingUp ? '1' : '0');
          } catch (errH) {
            /* Private Mode */
          }
          self.refreshMapViewportForHeadingMode();
          if (self._lastLatLng && self.isNavActive()) {
            self.updateFromLatLng(self._lastLatLng);
          }
        });
      } else {
        self.mapHeadingUp = false;
      }

      if (btnClose) {
        btnClose.addEventListener('click', function () {
          self._feedbackAfterClose = true;
          self.close();
        });
      }
      if (btnReturnStart) {
        btnReturnStart.addEventListener('click', function () {
          self.requestReturnToStart(btnReturnStart);
        });
      }
      if (btnStart) {
        btnStart.addEventListener('click', function () {
          self.open();
        });
      }
      if (simOn) {
        simOn.addEventListener('change', function () {
          self.toggleSimMode();
          if (simControls) {
            simControls.hidden = !simOn.checked;
          }
        });
        if (simControls) {
          simControls.hidden = !simOn.checked;
        }
      }
      if (simKmh) {
        simKmh.addEventListener('change', function () {
          if (self.simActive) {
            self.restartSimTimer();
          }
        });
      }
      if (simPrev) {
        simPrev.addEventListener('click', function () {
          self.jumpSimulationToManeuver(-1);
        });
      }
      if (simNext) {
        simNext.addEventListener('click', function () {
          self.jumpSimulationToManeuver(+1);
        });
      }

      if (!self._simJumpKeyListenerBound) {
        self._simJumpKeyListenerBound = true;
        document.addEventListener('keydown', function (ev) {
          if (!document.body.classList.contains('nav-mode') || !self.simActive) {
            return;
          }
          if (ev.defaultPrevented) {
            return;
          }
          if (isEditableElement(ev.target)) {
            return;
          }
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
            ev.preventDefault();
            self.jumpSimulationToManeuver(+1);
            return;
          }
          if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            self.jumpSimulationToManeuver(-1);
          }
        });
      }

      const voiceBox = document.getElementById('nav-voice-on');
      const voiceVolumeRow = document.getElementById('nav-volume-popover');
      const voiceVolumeToggle = document.getElementById('nav-volume-toggle');
      const voiceVolume = document.getElementById('nav-voice-volume');
      const navSettingsToggle = document.getElementById('nav-settings-toggle');
      const navSettingsPanel = document.getElementById('nav-settings-panel');
      const navSettingsClose = document.getElementById('nav-settings-close');
      const navTurnBlock = document.querySelector('#nav-sheet .nav-turn-block');
      const navSheetInner = document.querySelector('#nav-sheet .nav-sheet-inner');
      const settingsHome = {
        parent: navSettingsPanel ? navSettingsPanel.parentNode : null,
        nextSibling: navSettingsPanel ? navSettingsPanel.nextSibling : null,
      };
      let settingsOutsideClickBound = false;
      function setSettingsPanelOpen(open) {
        if (!navSettingsPanel || !navSettingsToggle) {
          return;
        }
        const on = !!open;
        if (navTurnBlock) {
          navTurnBlock.hidden = on;
        }
        if (navSheetInner) {
          navSheetInner.classList.toggle('nav-sheet-inner--settings-open', on);
        }
        navSettingsPanel.hidden = !on;
        navSettingsPanel.setAttribute('aria-hidden', on ? 'false' : 'true');
        navSettingsToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
        if (on) {
          window.setTimeout(function () {
            // Settings sollen das Nav-Panel ersetzen (inline), nicht darüber schweben.
            try {
              navSettingsPanel.classList.add('nav-settings-panel--inline');
            } catch (e0) {
              /* ignore */
            }
            // In der DOM-Struktur in das Navigationspanel verschieben, damit es wirklich "an der Stelle" erscheint.
            try {
              if (navSheetInner && navSettingsPanel.parentNode !== navSheetInner) {
                navSheetInner.appendChild(navSettingsPanel);
              }
            } catch (eMove) {
              /* ignore */
            }
            if (voiceVolumeToggle && typeof voiceVolumeToggle.focus === 'function') {
              try {
                voiceVolumeToggle.focus({ preventScroll: true });
              } catch (err) {
                voiceVolumeToggle.focus();
              }
            }
          }, 0);
          if (!settingsOutsideClickBound) {
            settingsOutsideClickBound = true;
            document.addEventListener('mousedown', function (ev) {
              if (!navSettingsPanel || navSettingsPanel.hidden) {
                return;
              }
              const t = ev.target;
              if (t === navSettingsToggle || (navSettingsToggle && navSettingsToggle.contains(t))) {
                return;
              }
              if (navSettingsPanel && (t === navSettingsPanel || navSettingsPanel.contains(t))) {
                return;
              }
              setSettingsPanelOpen(false);
            });
          }
        } else {
          try {
            navSettingsPanel.classList.remove('nav-settings-panel--inline');
          } catch (e1) {
            /* ignore */
          }
          // Zurück an die ursprüngliche Stelle im DOM.
          try {
            if (settingsHome.parent) {
              if (settingsHome.nextSibling) {
                settingsHome.parent.insertBefore(navSettingsPanel, settingsHome.nextSibling);
              } else {
                settingsHome.parent.appendChild(navSettingsPanel);
              }
            }
          } catch (eBack) {
            /* ignore */
          }
        }
      }
      function setVolumeRowOpen(open) {
        if (!voiceVolumeRow || !voiceVolumeToggle) {
          return;
        }
        const on = !!open;
        voiceVolumeRow.hidden = !on;
        voiceVolumeToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
      }
      if (navSettingsToggle) {
        setSettingsPanelOpen(false);
        navSettingsToggle.addEventListener('click', function () {
          const isOpen = !!(navSettingsPanel && !navSettingsPanel.hidden);
          setSettingsPanelOpen(!isOpen);
        });
      }
      if (navSettingsClose) {
        navSettingsClose.addEventListener('click', function () {
          setSettingsPanelOpen(false);
          if (navSettingsToggle && typeof navSettingsToggle.focus === 'function') {
            try {
              navSettingsToggle.focus({ preventScroll: true });
            } catch (err) {
              navSettingsToggle.focus();
            }
          }
        });
      }
      if (voiceVolumeToggle) {
        // Startzustand explizit geschlossen (falls CSS/Browser hidden anders interpretiert).
        setVolumeRowOpen(false);
        voiceVolumeToggle.addEventListener('click', function () {
          const isOpen = !!(voiceVolumeRow && !voiceVolumeRow.hidden);
          setVolumeRowOpen(!isOpen);
        });
      }
      if (voiceBox) {
        try {
          voiceBox.checked = localStorage.getItem('nr_nav_voice') !== '0';
        } catch (err) {
          voiceBox.checked = true;
        }
        self.voiceEnabled = voiceBox.checked;
        if (!voiceBox.checked) {
          setVolumeRowOpen(false);
        }
        voiceBox.addEventListener('change', function () {
          self.voiceEnabled = voiceBox.checked;
          try {
            localStorage.setItem('nr_nav_voice', voiceBox.checked ? '1' : '0');
          } catch (err2) {
            /* Private Mode */
          }
          if (!voiceBox.checked) {
            setVolumeRowOpen(false);
            if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
              window.NRPiperTTS.cancel();
            }
            self.cancelLegacySpeechSynthesis();
          } else {
            self._lastSpeechStepKey = null;
            self._lastSpeechAtMs = 0;
            self._milestonesDone = {};
            self.schedulePrepareNavTts();
            if (self._lastLatLng) {
              self.updateFromLatLng(self._lastLatLng);
            }
          }
        });
      }

      if (voiceVolume) {
        try {
          const stored = parseInt(localStorage.getItem('nr_nav_voice_volume') || '', 10);
          if (Number.isFinite(stored)) {
            self.voiceVolume = Math.max(0, Math.min(1, stored / 100));
          }
        } catch (err4) {
          self.voiceVolume = 1;
        }
        self.syncVoiceVolumeUi();
        self.applyVoiceVolume();
        voiceVolume.addEventListener('input', function () {
          const raw = parseInt(voiceVolume.value || '100', 10);
          const safe = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 100;
          self.voiceVolume = safe / 100;
          self.syncVoiceVolumeUi();
          self.applyVoiceVolume();
          try {
            localStorage.setItem('nr_nav_voice_volume', String(safe));
          } catch (err5) {
            /* ignorieren */
          }
        });
      }

      if (self._gpsVisibilityListener === null) {
        self._gpsVisibilityListener = function () {
          if (document.visibilityState !== 'visible') {
            return;
          }
          if (!document.body.classList.contains('nav-mode') || self.simActive) {
            return;
          }
          self.startGpsTracking();
        };
        document.addEventListener('visibilitychange', self._gpsVisibilityListener);
      }

      self.schedulePrepareNavTts();
    },

    /**
     * Springt im GPS-Sim-Modus zwischen Manövern.
     * Pfeil rechts/unten = nächstes Manöver, links/oben = vorheriges.
     */
    jumpSimulationToManeuver: function (delta) {
      if (!this.simActive || !this.geometry || !this.cumDist || !this.Lref) {
        return;
      }
      const legEnds = Array.isArray(this.legEnds) ? this.legEnds : [];
      const steps = Array.isArray(this.steps) ? this.steps : [];
      if (legEnds.length === 0 || steps.length === 0) {
        return;
      }
      const d = Number(delta);
      if (!Number.isFinite(d) || d === 0) {
        return;
      }
      const total = this.cumDist[this.cumDist.length - 1] || 0;
      const along = Math.max(0, Math.min(total, this.simDistance || 0));
      const st = resolveNavState(along, steps, legEnds, total, null);
      const nextIdx = Number.isFinite(st.nextIdx) ? st.nextIdx : 0;

      // nextIdx ist der Index des NÄCHSTEN Manövers für die aktuelle Position.
      // Daher: "nächstes" = nextIdx + 1, "vorher" = nextIdx - 1.
      const idx = Math.max(0, Math.min(legEnds.length - 1, nextIdx + (d > 0 ? 1 : -1)));
      const triggerM = legEnds[idx] != null ? Number(legEnds[idx]) : along;
      const preM = d > 0 ? 28 : 46;
      const nextAlong = Math.max(0, Math.min(total, triggerM - preM));
      this.simDistance = nextAlong;
      const pos = positionAtDistance(this.simDistance, this.geometry, this.cumDist, this.Lref);
      if (pos) {
        this.updateFromLatLng(pos, { alongMeters: this.simDistance });
      }
    },

    setRouteData: function (data) {
      if (!this.Lref || !data || !data.geometry || data.geometry.length < 2) {
        this.geometry = null;
        this.steps = [];
        this._lastLatLng = null;
        this._lastAlongMeters = null;
        this._maxAlongMeters = null;
        this._lastSnapSegIndex = null;
        this._temporaryRejoinMeta = null;
        this._temporaryRejoinHandled = false;
        this._lastPassedManeuverAlongM = 0;
        this._lastPassedManeuverIndex = -1;
        this._maxObservedNextIdx = -1;
        this._navStepHysteresis.idx = null;
        this._lastSpeechStepKey = null;
        this._lastSpeechAtMs = 0;
        this._milestonesDone = {};
        this._initialStartPromptDone = false;
        this._fitnessLastAlongM = null;
        this._fitnessAccumulatedM = 0;
        this._fitnessAwardedThisNav = 0;
        this._fitnessPrimed = false;
        return;
      }
      this.geometry = data.geometry;
      this.cumDist = buildCumulativeDistances(data.geometry, this.Lref);
      // ORS-Schätzung als ETA-Basis: distance ist in km, duration in Sekunden. Wenn vorhanden,
      // ergibt sich daraus eine plausible Durchschnittsgeschwindigkeit (cycling-typisch
      // 12-22 km/h) — dient als Fallback, wenn live noch keine Bewegung vorliegt.
      const distanceKm = Number(data && data.distance);
      const durationSec = Number(data && data.duration);
      if (Number.isFinite(distanceKm) && distanceKm > 0.05 && Number.isFinite(durationSec) && durationSec > 30) {
        this._routeAvgSpeedMs = (distanceKm * 1000) / durationSec;
      } else {
        this._routeAvgSpeedMs = null;
      }
      // Rundkurs erkennen — entweder über roundtrip_mode oder geometrische Nähe Start↔Ende.
      // Wichtig für die ETA: bei Rundkursen kann der initiale Snap fälschlich auf den
      // Endpunkt der Polyline landen (Start≈Ende geometrisch identisch), wodurch alongM
      // sofort ≈ total wäre. Wird in updateFromLatLng abgefangen.
      const rtMode = data && typeof data.roundtrip_mode === 'string' ? data.roundtrip_mode : '';
      const isLoopMode = rtMode === 'circle_loop' || rtMode === 'waypoints_loop';
      let geometricallyClosed = false;
      const g = data.geometry;
      if (g.length >= 2) {
        const start = g[0];
        const end = g[g.length - 1];
        if (Array.isArray(start) && Array.isArray(end)) {
          const dStartEnd = this.Lref.distance(
            { lat: Number(start[0]), lng: Number(start[1]) },
            { lat: Number(end[0]), lng: Number(end[1]) }
          );
          geometricallyClosed = Number.isFinite(dStartEnd) && dStartEnd < 30;
        }
      }
      const tempRejoin = !!(data && (data._nrTemporaryRejoin || data._nrReturnToStart));
      this._isRoundtripRoute = !tempRejoin && (isLoopMode || geometricallyClosed);
      if (this.isNavActive()) {
        // Bei Umleitungen/Route-Restore springt die Along-Meter-Skala. Teilkilometer bleiben, nur Referenz neu setzen.
        this._fitnessLastAlongM = null;
      }
      this._lastLatLng = null;
      this._lastAlongMeters = null;
      this._maxAlongMeters = null;
      this._lastSnapSegIndex = null;
      this._temporaryRejoinMeta = data._nrTemporaryRejoin || null;
      this._temporaryRejoinHandled = false;
      // „Zurück zum Start“ ist eine Fortsetzung der laufenden Tour: der nachfolgende
      // `open()`-Aufruf darf weder Strecke, Zeit, Fitness noch Welcome/Milestones zurücksetzen.
      if (this.isNavActive() && data._nrReturnToStart === true) {
        this._continueTourOnNextOpen = true;
      }
      // Manöver-Tracking neu starten: bei der Originalroute beginnt die Suche bei 0,
      // bei einer temporären Rückführungs-Route ebenfalls (sie hat ihre eigene Step-Skala).
      this._lastPassedManeuverAlongM = 0;
      this._lastPassedManeuverIndex = -1;
      this._maxObservedNextIdx = -1;
      const nav = data.navigation && data.navigation.steps ? data.navigation.steps : [];
      const baseSteps =
        Array.isArray(nav) && nav.length ? nav : buildFallbackNavigationSteps(data.geometry, this.cumDist);
      this.steps = normalizeIntermediateFinishSteps(enrichNavigationSteps(baseSteps), data.geometry.length).map(
        function (step) {
          const correctedType = deriveStepTypeFromGeometry(step, data.geometry, this.cumDist, this.Lref);
          return Object.assign({}, step, {
            raw_type: step.type != null ? step.type : correctedType,
            type: correctedType,
          });
        }.bind(this)
      );
      this.legEnds = computeStepTriggerDistances(this.steps, this.cumDist);
      this._navStepHysteresis.idx = null;
      this._lastSpeechStepKey = null;
      this._lastSpeechAtMs = 0;
      this._milestonesDone = {};
      this._lastDebugAtMs = 0;
      this._lastDebugStepKey = null;
      this._initialStartPromptDone = false;
      this.queueDebugLog(
        'route_loaded',
        {
          points: this.geometry.length,
          steps: this.steps.length,
          total_m: Math.round(this.cumDist[this.cumDist.length - 1] || 0),
        },
        true
      );
      this.schedulePrepareNavTts();
    },

    open: function () {
      if (!this.geometry || !this.cumDist) {
        return;
      }
      this._navStartZoomApplied = false;
      this._navSuppressPanUntilMs = Date.now() + 900;
      this._weatherSpokenThisNav = false;
      const navSelf = this;
      this.blurActiveEditableForNavigation();
      this._lastLatLng = null;
      this.primeNavAudioAndSpeech();
      const sheet = document.getElementById('nav-sheet');
      if (sheet) {
        sheet.hidden = false;
        sheet.setAttribute('aria-hidden', 'false');
      }
      document.body.classList.add('nav-mode');
      // iOS/Safari: Während Layoutwechsel/Navigationstart kann der Fokus in Eingabefeldern hängen bleiben
      // → Shake-to-Undo Dialog. Wir erzwingen kurzzeitig Blur + Fokus auf die Nav-Oberfläche.
      if (this._navFocusGuardIv != null) {
        window.clearInterval(this._navFocusGuardIv);
        this._navFocusGuardIv = null;
      }
      // Norden-oben: fixes Split-Layout, keine gespeicherten Floating-Positionen anwenden.
      if (this.mapHeadingUp) {
        this.applyNavSheetPlacementFromPreferences();
      } else {
        try {
          clearNavSheetPlacementPrefs();
        } catch (e0) {
          /* ignore */
        }
        this.clearNavSheetUserPlacement(document.querySelector('#nav-sheet .nav-sheet-inner'));
      }
      this.syncNavSheetMetrics();
      window.setTimeout(
        function () {
          if (navSelf.mapHeadingUp) {
            navSelf.applyNavSheetPlacementFromPreferences();
          } else {
            try {
              clearNavSheetPlacementPrefs();
            } catch (e0) {
              /* ignore */
            }
            navSelf.clearNavSheetUserPlacement(document.querySelector('#nav-sheet .nav-sheet-inner'));
          }
          navSelf.syncNavSheetMetrics();
          navSelf.syncNavSettingsPanelPlacement();
        },
        0
      );
      window.requestAnimationFrame(function () {
        if (navSelf.mapHeadingUp) {
          navSelf.applyNavSheetPlacementFromPreferences();
        } else {
          try {
            clearNavSheetPlacementPrefs();
          } catch (e0) {
            /* ignore */
          }
          navSelf.clearNavSheetUserPlacement(document.querySelector('#nav-sheet .nav-sheet-inner'));
        }
        navSelf.syncNavSheetMetrics();
      });
      this.focusNavigationSurface();
      try {
        const self = this;
        const until = Date.now() + 1400;
        this._navFocusGuardIv = window.setInterval(function () {
          if (!document.body.classList.contains('nav-mode') || Date.now() > until) {
            window.clearInterval(self._navFocusGuardIv);
            self._navFocusGuardIv = null;
            return;
          }
          self.blurActiveEditableForNavigation();
          self.focusNavigationSurface();
        }, 220);
      } catch (e0) {
        /* ignore */
      }
      void this.acquireNavWakeLock();
      // Bei „Zurück zum Start“ ist die Tour eine Fortsetzung — Tour-Counter nicht zurücksetzen.
      const continueTour = !!this._continueTourOnNextOpen;
      this._continueTourOnNextOpen = false;
      if (!continueTour) {
        this._navStartedAtMs = Date.now();
      }
      this.ensureDebugSessionId();
      this._lastRerouteMs = Date.now();
      this.applyMapOrientationUi();
      if (this.map) {
        this.map.invalidateSize(false);
      }
      this.applyLeafletRotation(0);
      this._lastSpeechStepKey = null;
      this._lastSpeechAtMs = 0;
      if (!continueTour) {
        this._milestonesDone = {};
        this._initialStartPromptDone = false;
        this._welcomeSpokenThisNav = false;
        this._welcomeRetryCount = 0;
      }
      this._speechSuppressUntilMs = 0;
      this._navStepHysteresis.idx = null;
      this._filteredHeadingDeg = null;
      this._lastAlongMeters = null;
      this._maxAlongMeters = null;
      this._lastSnapSegIndex = null;
      this._lastDebugAtMs = 0;
      this._lastDebugStepKey = null;
      this.cancelLegacySpeechSynthesis();
      this.simDistance = 0;
      if (!continueTour) {
        this._fitnessLastAlongM = null;
        this._fitnessAccumulatedM = 0;
        this._fitnessAwardedThisNav = 0;
        this._fitnessPrimed = false;
        // Tour-Zähler nur beim Tour-Start zurücksetzen — bei Reroute/Rückführung läuft er weiter.
        this._distanceTraveledM = 0;
      }
      this.queueDebugLog(
        'nav_open',
        {
          sim: !!(document.getElementById('nav-sim-on') && document.getElementById('nav-sim-on').checked),
          voice: !!this.voiceEnabled,
          volume: this.voiceVolume,
          heading_mode: !!this.mapHeadingUp,
        },
        true
      );
      if (this.map) {
        window.setTimeout(function () {
          navSelf.map.invalidateSize();
          window.setTimeout(function () {
            if (!document.body.classList.contains('nav-mode')) {
              return;
            }
            if (navSelf.simActive && navSelf.geometry && navSelf.cumDist) {
              const pos = positionAtDistance(
                navSelf.simDistance,
                navSelf.geometry,
                navSelf.cumDist,
                navSelf.Lref
              );
              navSelf.updateFromLatLng(pos, { alongMeters: navSelf.simDistance });
            } else if (navSelf.geometry && navSelf.geometry.length >= 2) {
              const g0 = navSelf.geometry[0];
              const ll0 = navSelf.Lref.latLng(g0[0], g0[1]);
              navSelf.syncMapUnderPosition(ll0);
            }
            navSelf.refreshTileLayers();
          }, 90);
        }, 200);
      }

      // Piper früh anstoßen; Begrüßung kann bei ESM-Ladeverzögerung nachziehen.
      this.schedulePrepareNavTts();
      this.applyVoiceVolume();
      // Wetterbericht vom Startpunkt (einmalig) ansagen.
      try {
        if (this.geometry && this.geometry.length >= 1) {
          const g0w = this.geometry[0];
          const llw = this.Lref.latLng(g0w[0], g0w[1]);
          this.speakWeatherForNavigation(llw);
        }
      } catch (eW) {
        /* ignore */
      }
      const simOn = document.getElementById('nav-sim-on');
      window.setTimeout(
        function () {
          navSelf.speakWelcomeForNavigation();
        },
        320
      );
      if (simOn && simOn.checked) {
        this.startSimulation();
      } else {
        this.startGpsTracking();
        const startLl = this.Lref.latLng(this.geometry[0][0], this.geometry[0][1]);
        this.updateFromLatLng(startLl);
      }
    },

    close: function () {
      this.stopSimulation();
      this.stopGpsTracking();
      if (this._navFocusGuardIv != null) {
        window.clearInterval(this._navFocusGuardIv);
        this._navFocusGuardIv = null;
      }
      if (this._eventZoomRestoreTimer != null) {
        window.clearTimeout(this._eventZoomRestoreTimer);
        this._eventZoomRestoreTimer = null;
      }
      this._cancelNavFlyToFinishTimer();
      this._eventZoomActive = false;
      this._eventZoomPrevZoom = null;
      this._eventZoomTargetZoom = null;
      if (this.map && typeof this.map.stop === 'function') {
        try {
          this.map.stop();
        } catch (e) {
          /* ignore */
        }
      }
      this.queueDebugLog('nav_close', {}, true);
      if (this._ttsPreparePollIv != null) {
        window.clearInterval(this._ttsPreparePollIv);
        this._ttsPreparePollIv = null;
      }
      this._lastLatLng = null;
      this._navStartedAtMs = null;
      document.body.classList.remove('nav-mode');
      this.releaseNavWakeLock();
      this._rerouteInFlight = false;
      this._offRouteStreak = 0;
      this._lastPassedManeuverAlongM = 0;
      this._lastPassedManeuverIndex = -1;
      this._maxObservedNextIdx = -1;
      if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
        window.NRPiperTTS.cancel();
      }
      const sheet = document.getElementById('nav-sheet');
      if (sheet) {
        sheet.hidden = true;
        sheet.setAttribute('aria-hidden', 'true');
      }
      const settingsPanel = document.getElementById('nav-settings-panel');
      const settingsToggle = document.getElementById('nav-settings-toggle');
      if (settingsPanel) {
        settingsPanel.hidden = true;
        settingsPanel.setAttribute('aria-hidden', 'true');
      }
      if (settingsToggle) {
        settingsToggle.setAttribute('aria-expanded', 'false');
      }
      if (this.map) {
        this.map.invalidateSize(false);
      }
      this.applyLeafletRotation(0);
      this._lastSpeechStepKey = null;
      this._lastSpeechAtMs = 0;
      this._milestonesDone = {};
      this._initialStartPromptDone = false;
      this._navStepHysteresis.idx = null;
      this._filteredHeadingDeg = null;
      this._lastAlongMeters = null;
      this._maxAlongMeters = null;
      this._lastSnapSegIndex = null;
      this._lastDebugAtMs = 0;
      this._lastDebugStepKey = null;
      this._fitnessLastAlongM = null;
      this._fitnessAccumulatedM = 0;
      this._fitnessAwardedThisNav = 0;
      this._fitnessPrimed = false;
      this.flushDebugLogQueue();
      if (typeof window.speechSynthesis !== 'undefined') {
        this.cancelLegacySpeechSynthesis();
        window.requestAnimationFrame(function () {
          try {
            if (typeof window.speechSynthesis !== 'undefined') {
              window.speechSynthesis.cancel();
            }
          } catch (e2) {
            /* ignorieren */
          }
        });
      }
      if (this.navMarker && this.map) {
        this.map.removeLayer(this.navMarker);
        this.navMarker = null;
      }
      this._lastAppliedRotationDeg = 0;
      this._nrHeadingCoverScaleSmoothed = null;
      this._nrHeadingCoverScaleFixed = null;
      this._nrHeadingCoverScaleFixedW = null;
      this._nrHeadingCoverScaleFixedH = null;
      this._nrHeadingRotSmoothed = null;
      this._navHeadingPinZoom = null;
      if (this.map) {
        window.setTimeout(
          function () {
            this.invalidateSize();
          }.bind(this.map),
          180
        );
      }
      if (this._feedbackAfterClose) {
        this._feedbackAfterClose = false;
        document.dispatchEvent(new CustomEvent('nr-nav-ended'));
      }
    },

    toggleSimMode: function () {
      const simOn = document.getElementById('nav-sim-on');
      const simControls = document.getElementById('nav-sim-controls');
      if (!simOn) return;
      if (simOn.checked) {
        this.stopGpsTracking();
        this.simDistance = 0;
        this.startSimulation();
        if (simControls) {
          simControls.hidden = false;
        }
      } else {
        this.stopSimulation();
        this._navStepHysteresis.idx = null;
        this.startGpsTracking();
        if (simControls) {
          simControls.hidden = true;
        }
      }
    },

    startSimulation: function () {
      const self = this;
      this.stopSimulation();
      this._navStepHysteresis.idx = null;
      this.simActive = true;
      this.simDistance = 0;
      this.queueDebugLog('sim_start', { speed_ms: this.getSimSpeedMs() }, true);
      const pos0 = positionAtDistance(0, this.geometry, this.cumDist, this.Lref);
      this.updateFromLatLng(pos0, { alongMeters: 0 });
      const speedMs = this.getSimSpeedMs();
      this.simTimer = window.setInterval(function () {
        const total = self.cumDist[self.cumDist.length - 1] || 0;
        self.simDistance += speedMs * 0.05;
        if (self.simDistance >= total) {
          self.simDistance = total;
          const endPos = positionAtDistance(self.simDistance, self.geometry, self.cumDist, self.Lref);
          self.updateFromLatLng(endPos, { alongMeters: self.simDistance });
          self.stopSimulation();
          return;
        }
        const pos = positionAtDistance(self.simDistance, self.geometry, self.cumDist, self.Lref);
        self.updateFromLatLng(pos, { alongMeters: self.simDistance });
      }, 50);
    },

    restartSimTimer: function () {
      if (!this.simActive) return;
      // Nur Tempo ändern – Simulation soll nicht "von vorne" beginnen.
      if (this.simTimer != null) {
        window.clearInterval(this.simTimer);
        this.simTimer = null;
      }
      const self = this;
      const speedMs = this.getSimSpeedMs();
      this.queueDebugLog('sim_speed_change', { speed_ms: speedMs }, false);
      this.simTimer = window.setInterval(function () {
        if (!self.simActive || !self.geometry || !self.cumDist || !self.Lref) {
          return;
        }
        const total = self.cumDist[self.cumDist.length - 1] || 0;
        const cur = Number(self.simDistance);
        self.simDistance = Number.isFinite(cur) ? cur : 0;
        self.simDistance += speedMs * 0.05;
        if (self.simDistance >= total) {
          self.simDistance = total;
          const endPos = positionAtDistance(self.simDistance, self.geometry, self.cumDist, self.Lref);
          self.updateFromLatLng(endPos, { alongMeters: self.simDistance });
          self.stopSimulation();
          return;
        }
        const pos = positionAtDistance(self.simDistance, self.geometry, self.cumDist, self.Lref);
        self.updateFromLatLng(pos, { alongMeters: self.simDistance });
      }, 50);
    },

    getSimSpeedMs: function () {
      const sel = document.getElementById('nav-sim-kmh');
      let kmh = sel ? parseFloat(sel.value) : 18;
      if (Number.isNaN(kmh) || kmh < 1) {
        kmh = 18;
      }
      return kmh / 3.6;
    },

    stopSimulation: function () {
      if (this.simTimer != null) {
        window.clearInterval(this.simTimer);
        this.simTimer = null;
      }
      this.simActive = false;
      const simControls = document.getElementById('nav-sim-controls');
      if (simControls) {
        simControls.hidden = true;
      }
    },

    startGpsTracking: function () {
      const self = this;
      this.stopGpsTracking();
      if (!navigator.geolocation) return;

      const geoOpts = {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000,
      };

      const throttledGeoFail = function (err) {
        const now = Date.now();
        if (now - self._gpsFailLogAtMs < 25000) {
          return;
        }
        self._gpsFailLogAtMs = now;
        self.queueDebugLog(
          'gps_error',
          {
            code: err && typeof err.code !== 'undefined' ? err.code : null,
            message: err && err.message ? String(err.message) : '',
          },
          true
        );
        try {
          const msg =
            typeof window !== 'undefined' &&
            window.NRGeo &&
            typeof window.NRGeo.userMessage === 'function'
              ? window.NRGeo.userMessage(err)
              : String(err && err.code);
          console.warn('[NRNav] Geolocation', err && err.code, err && err.message, msg);
        } catch (e) {
          /* ignorieren */
        }
      };

      const NRG = typeof window !== 'undefined' ? window.NRGeo : null;
      if (NRG && typeof NRG.isSecureContext === 'function' && !NRG.isSecureContext()) {
        throttledGeoFail({ code: 0, message: 'insecure' });
        return;
      }

      function getPosOnce(successCb, failCb, opts) {
        if (NRG && typeof NRG.getCurrentPosition === 'function') {
          NRG.getCurrentPosition(successCb, failCb, opts);
        } else {
          navigator.geolocation.getCurrentPosition(successCb, failCb, opts);
        }
      }

      const geoRead = function (pos) {
        if (!document.body.classList.contains('nav-mode')) {
          return;
        }
        const ll = self.Lref.latLng(pos.coords.latitude, pos.coords.longitude);
        const sp =
          typeof pos.coords.speed === 'number' && !Number.isNaN(pos.coords.speed)
            ? pos.coords.speed
            : 0;
        const h = pos.coords.heading;
        let headingDeg = null;
        if (typeof h === 'number' && !Number.isNaN(h) && h >= 0 && h <= 360) {
          headingDeg = h;
        }
        if (headingDeg == null && sp > 0.5 && self._lastGpsForHeading) {
          const prev = self._lastGpsForHeading;
          const dt = Date.now() - prev.tMs;
          if (dt > 200 && dt < 30000) {
            const d = prev.latLng.distanceTo(ll);
            if (d > 2) {
              headingDeg = bearingDeg(prev.latLng.lat, prev.latLng.lng, ll.lat, ll.lng);
            }
          }
        }
        self.updateFromLatLng(ll, { headingDeg: headingDeg, speedMs: sp });
        self._lastGpsForHeading = { latLng: ll, tMs: Date.now() };
      };

      self._gpsFailLogAtMs = 0;
      self.queueDebugLog('gps_tracking_start', { sim: false }, true);
      getPosOnce(geoRead, throttledGeoFail, geoOpts);
      self.gpsWatch = navigator.geolocation.watchPosition(geoRead, throttledGeoFail, geoOpts);

      if (nrNavIsIosTouch()) {
        self.gpsPollTimer = window.setInterval(function () {
          if (!document.body.classList.contains('nav-mode') || self.simActive) {
            return;
          }
          getPosOnce(geoRead, function () {}, geoOpts);
        }, 2000);
      }
    },

    stopGpsTracking: function () {
      if (this.gpsPollTimer != null) {
        window.clearInterval(this.gpsPollTimer);
        this.gpsPollTimer = null;
      }
      this._lastGpsForHeading = null;
      if (this.gpsWatch != null) {
        navigator.geolocation.clearWatch(this.gpsWatch);
        this.gpsWatch = null;
      }
    },

    /**
     * @param {object} latlng Leaflet LatLng
     * @param {{ alongMeters?: number, headingDeg?: number|null, speedMs?: number }} [opts]
     *   Simulation: alongMeters; GPS: optional headingDeg/speedMs für Kursmarke
     */
    updateFromLatLng: function (latlng, opts) {
      if (!this.geometry || !this.cumDist || !this.Lref) return;
      if (!this.isNavActive()) {
        return;
      }

      const totalRoute = this.cumDist[this.cumDist.length - 1] || 0;
      let along;
      const isSim =
        opts && typeof opts.alongMeters === 'number' && !Number.isNaN(opts.alongMeters);
      const speedMs =
        opts && typeof opts.speedMs === 'number' && !Number.isNaN(opts.speedMs)
          ? opts.speedMs
          : isSim
            ? this.getSimSpeedMs()
            : this._lastSpeedMs;
      let routeMatch = null;
      if (isSim) {
        along = Math.min(Math.max(0, opts.alongMeters), totalRoute);
        this._lastSnapSegIndex = null;
      } else {
        routeMatch = distanceAlongRoute(
          latlng,
          this.geometry,
          this.cumDist,
          this.Lref,
          this._lastSnapSegIndex
        );
        along = routeMatch.alongM;
        this._lastSnapSegIndex = routeMatch.segIndex;
        if (this._lastAlongMeters != null && Number.isFinite(this._lastAlongMeters)) {
          const backwardM = this._lastAlongMeters - along;
          const crossTrackM = routeMatch.distanceM;
          const speed = Number.isFinite(speedMs) ? speedMs : 0;
          if (backwardM > 18 && crossTrackM < 16 && speed > 1.2) {
            along = this._lastAlongMeters;
          } else if (backwardM > 8 && crossTrackM < 10 && speed > 2.4) {
            along = this._lastAlongMeters - 4;
          }
        }
      }
      // Tour-Zähler: nur positive Along-Differenzen aufaddieren. Bei Routen-Wechseln
      // (Reroute/Rückführung) ist `_lastAlongMeters` zuvor auf null gesetzt worden, sodass
      // der erste Sprung auf die neue Polyline NICHT als gefahrene Strecke verbucht wird.
      if (
        Number.isFinite(along) &&
        this._lastAlongMeters != null &&
        Number.isFinite(this._lastAlongMeters)
      ) {
        const delta = along - this._lastAlongMeters;
        if (delta > 0) {
          this._distanceTraveledM = (this._distanceTraveledM || 0) + delta;
        }
      }
      this._lastAlongMeters = along;
      this._maxAlongMeters = Math.max(this._maxAlongMeters || 0, along || 0);
      const state = resolveNavState(
        along,
        this.steps,
        this.legEnds,
        this.cumDist[this.cumDist.length - 1] || 0,
        this._navStepHysteresis
      );
      // Letzte tatsächlich passierte Abbiege-Position merken: dient als unterer Vorwärts-Anker
      // für Off-Route-Reroute, damit niemals zurück hinter einen bereits passierten Wegpunkt geroutet wird.
      const observedNextIdx = Number.isFinite(Number(state && state.nextIdx)) ? Number(state.nextIdx) : -1;
      if (observedNextIdx > this._maxObservedNextIdx) {
        this._maxObservedNextIdx = observedNextIdx;
        const passedIdx = observedNextIdx - 1;
        if (Array.isArray(this.legEnds) && passedIdx >= 0 && passedIdx < this.legEnds.length) {
          const passedAlong = Number(this.legEnds[passedIdx]);
          if (Number.isFinite(passedAlong) && passedAlong > (this._lastPassedManeuverAlongM || 0)) {
            this._lastPassedManeuverAlongM = passedAlong;
            this._lastPassedManeuverIndex = passedIdx;
          }
        }
      }
      // Abbiege-Overlay auf der Karte:
      // - sichtbar ab 50 m VOR dem Manöver
      // - ausblenden ab hideAfterM NACH dem Manöver (gemessen ab dem Abbiegepunkt)
      // Das ist unabhängig von TTS-Ansagen/Timing und funktioniert für GPS & Simulation.
      try {
        const currentStepKey = state && state.arrived ? 'arrived' : String(state && state.nextIdx != null ? state.nextIdx : -1);
        const distM = Number(state && state.distToManeuver);
        const type = Number(state && state.type);
        const isValid = Number.isFinite(distM) && distM >= 0 && !Number.isNaN(type) && type !== 6 && !state.arrived;

        // Wenn das Overlay bereits aktiv ist, soll es NICHT durch step/type-Transitions sofort verschwinden.
        // (Nach dem Abbiegen wird der "next step" oft zu "follow" (type 6) oder springt weiter.)
        // Stattdessen zählen wir ausschließlich bis zur gespeicherten Along-Schwelle.
        const hideAt = this._maneuverOverlayHideAfterAlongM;
        if (hideAt != null && Number.isFinite(Number(hideAt))) {
          if (along >= Number(hideAt)) {
            this.hideManeuverOverlay();
          }
          // Solange wir die Schwelle nicht erreicht haben: Overlay stehen lassen.
        } else if (!isValid) {
          this.hideManeuverOverlay();
        } else {
          // Manöverpunkt als feste Route-Position bestimmen.
          // ORS/Leaflet-Nav: das Abbiegen liegt typischerweise am Schritt-Ende (way_end_index),
          // nicht am Start. Daher primär way_end_index nutzen.
          const steps = Array.isArray(this.steps) ? this.steps : [];
          const cumDist = Array.isArray(this.cumDist) ? this.cumDist : [];
          const legEnds = Array.isArray(this.legEnds) ? this.legEnds : [];
          const idx = state && state.nextIdx != null ? Number(state.nextIdx) : NaN;

          let maneuverPosAlongM = null;
          if (Number.isFinite(idx) && steps[idx]) {
            const s = steps[idx] || {};
            const endIdx = Number(s.way_end_index);
            const startIdx = Number(s.way_start_index);
            if (Number.isFinite(endIdx) && cumDist[endIdx] != null && Number.isFinite(Number(cumDist[endIdx]))) {
              maneuverPosAlongM = Number(cumDist[endIdx]);
            } else if (Number.isFinite(startIdx) && cumDist[startIdx] != null && Number.isFinite(Number(cumDist[startIdx]))) {
              maneuverPosAlongM = Number(cumDist[startIdx]);
            }
          }
          if (maneuverPosAlongM == null && Number.isFinite(idx) && legEnds[idx] != null && Number.isFinite(Number(legEnds[idx]))) {
            maneuverPosAlongM = Number(legEnds[idx]);
          }
          if (maneuverPosAlongM == null) {
            maneuverPosAlongM = along + distM;
          }

          const showWindowM = 50;
          // Nachlauf nach dem Abbiegepunkt: Overlay bleibt noch ca. 20 m sichtbar, damit
          // der User die Bestätigung sieht ("ich bin korrekt abgebogen") und es kurz danach
          // wieder verschwindet, bevor es im Weg ist.
          const hideAfterM = 20;
          const distToManeuverM = maneuverPosAlongM - along;

          if (distToManeuverM <= showWindowM && distToManeuverM >= 0) {
            this.pulseEventZoom('now', state, currentStepKey, { alongM: along, distToManeuverM: Math.max(0, distToManeuverM) });
            this._maneuverOverlayHideAfterAlongM = Math.round(maneuverPosAlongM + hideAfterM);
          }
        }
      } catch (e0) {
        /* ignore */
      }
      let headingDeg =
        opts && typeof opts.headingDeg === 'number' && !Number.isNaN(opts.headingDeg)
          ? opts.headingDeg
          : null;
      headingDeg = this.getStableHeadingForDisplay(headingDeg, speedMs, isSim, along);

      this._lastLatLng = latlng;

      const statDistance = document.getElementById('nav-stat-distance');
      const statTime = document.getElementById('nav-stat-time');
      const statEta = document.getElementById('nav-stat-eta');
      const nextDist = document.getElementById('nav-next-dist');
      const arrow = document.getElementById('nav-arrow');
      const text = document.getElementById('nav-text');
      const street = document.getElementById('nav-street');

      if (statDistance) {
        statDistance.textContent = fmtDrivenKm(this._distanceTraveledM || 0);
      }
      if (statTime) {
        statTime.textContent = fmtElapsedTime(Date.now() - (this._navStartedAtMs || Date.now()));
      }
      if (statEta) {
        if (state.arrived) {
          statEta.textContent = '—';
        } else {
          const totalRouteM = this.cumDist[this.cumDist.length - 1] || 0;
          const traveledM = this._distanceTraveledM || 0;

          // Fortschritt für die ETA bestimmen. Bei Rundkursen ist Start ≈ Ende geometrisch
          // identisch — der initiale (globale) Snap kann fälschlich auf den Endpunkt der
          // Polyline landen. Erst wenn echte Bewegung vorliegt (>80 m gefahren), vertrauen
          // wir dem Snap. Davor: kompletter Rundkurs steht noch bevor.
          let progressM;
          if (this._isRoundtripRoute && traveledM < 80) {
            progressM = 0;
          } else {
            // Monoton steigender Fortschritt: max(snap, höchster bisheriger, letzte Abbiegung)
            // — verhindert ETA-Sprünge zurück bei kurzfristigem Snap-Wackeln.
            progressM = Math.max(
              along || 0,
              this._maxAlongMeters || 0,
              this._lastPassedManeuverAlongM || 0
            );
          }
          const remainingM = Math.max(0, totalRouteM - progressM);

          const elapsedMs = Date.now() - (this._navStartedAtMs || Date.now());
          // Mischung aus ORS-Routenschnitt und live gefahrenem Schnitt:
          //  - vor 30 s und unter 100 m: ORS-Schätzung (Live noch zu rauschig).
          //  - danach: 60 % live + 40 % ORS, damit Unterschiede zur ORS-Schätzung
          //    (Pause, Steigung, Gegenwind) realistisch ins ETA durchschlagen.
          let vEff = this._routeAvgSpeedMs || null;
          if (traveledM > 100 && elapsedMs > 30000) {
            const vTraveled = traveledM / (elapsedMs / 1000);
            if (vTraveled > 0.4) {
              vEff = this._routeAvgSpeedMs ? 0.6 * vTraveled + 0.4 * this._routeAvgSpeedMs : vTraveled;
            }
          }
          // Untergrenze 1,5 m/s (5,4 km/h, langsame Fahrradtour). Verhindert ETA = absurd weit
          // in der Zukunft, wenn der User gerade Pause macht und vTraveled gegen 0 fällt.
          if (Number.isFinite(vEff) && vEff > 0) {
            vEff = Math.max(1.5, vEff);
          }
          statEta.textContent = fmtEtaClock(remainingM, vEff);
        }
      }
      if (nextDist) {
        nextDist.textContent = state.arrived ? '—' : fmtDistM(state.distToManeuver);
      }
      if (arrow) {
        arrow.innerHTML = iconMarkupForType(state.type, state.arrived);
        arrow.setAttribute('data-maneuver', state.arrived ? 'finish' : typeToIconKey(state.type));
      }
      const displayNav = formatDisplayNav(state);
      if (text) {
        text.textContent = displayNav.text || '–';
      }
      if (street) {
        if (displayNav.streetLine) {
          street.textContent = displayNav.streetLine;
          street.removeAttribute('hidden');
        } else {
          street.textContent = '';
          street.setAttribute('hidden', 'hidden');
        }
      }

      this._lastSpeedMs =
        typeof speedMs === 'number' && !Number.isNaN(speedMs) && speedMs > 0 ? speedMs : this._lastSpeedMs;

      const navSpeechTriggered = this.maybeSpeakNavigation(state, along, speedMs);
      this.maybeAwardFitnessPoints(along, isSim, !!navSpeechTriggered, speedMs);
      // Kein Auto-Zoom außerhalb von Manöver-Triggern (nur 2 Zoomstufen).
      this.maybeEvaluateOffRouteReroute(latlng, along, isSim);
      if (
        !isSim &&
        this._temporaryRejoinMeta &&
        !this._temporaryRejoinHandled &&
        (state.arrived || state.distToManeuver <= 14)
      ) {
        this._temporaryRejoinHandled = true;
        this.queueDebugLog(
          'reroute_rejoin_reached',
          {
            target_along_m:
              this._temporaryRejoinMeta.targetAlongM != null ? Math.round(this._temporaryRejoinMeta.targetAlongM) : null,
            target_index: this._temporaryRejoinMeta.targetIndex != null ? this._temporaryRejoinMeta.targetIndex : null,
          },
          true
        );
        document.dispatchEvent(
          new CustomEvent('nr-nav-reroute-rejoin-reached', {
            detail: Object.assign({}, this._temporaryRejoinMeta),
          })
        );
      }
      if (!isSim) {
        const nowMs = Date.now();
        const debugStepKey = state.arrived ? 'arrived' : String(state.nextIdx != null ? state.nextIdx : -1);
        const crossTrackM = routeMatch && Number.isFinite(routeMatch.distanceM) ? routeMatch.distanceM : null;
        if (debugStepKey !== this._lastDebugStepKey || nowMs - this._lastDebugAtMs >= 1500) {
          this._lastDebugStepKey = debugStepKey;
          this._lastDebugAtMs = nowMs;
          this.queueDebugLog(
            'gps_update',
            {
              lat: Math.round(latlng.lat * 100000) / 100000,
              lng: Math.round(latlng.lng * 100000) / 100000,
              along_m: Math.round(along),
              next_idx: state.nextIdx,
              dist_to_maneuver_m: Math.round(state.distToManeuver),
              cross_track_m: crossTrackM == null ? null : Math.round(crossTrackM),
              seg_index: this._lastSnapSegIndex,
              speed_ms: Number.isFinite(speedMs) ? Math.round(speedMs * 100) / 100 : null,
              heading_deg: headingDeg == null ? null : Math.round(headingDeg),
              type: state.type,
              raw_type: state.raw_type,
              arrived: !!state.arrived,
              text: String(displayNav.text || ''),
            },
            false
          );
        }
      }

      if (!this.navMarker) {
        const icon = this.Lref.divIcon({
          className: 'nav-pos-marker',
          iconSize: [22, 22],
          html:
            '<div class="nav-pos-dot"><span class="nav-pos-head-wedge" aria-hidden="true"></span></div>',
        });
        this.navMarker = this.Lref.marker(latlng, { icon: icon, zIndexOffset: 2000 }).addTo(this.map);
      } else {
        this.navMarker.setLatLng(latlng);
      }

      const markerEl =
        this.navMarker && typeof this.navMarker.getElement === 'function'
          ? this.navMarker.getElement()
          : null;
      const dotEl = markerEl ? markerEl.querySelector('.nav-pos-dot') : null;
      if (dotEl) {
        if (isSim || this.mapHeadingUp) {
          dotEl.style.transform = '';
        } else {
          dotEl.style.transform = headingDeg != null ? 'rotate(' + headingDeg + 'deg)' : '';
        }
      }

      // Start-Zoom erst beim ersten echten Fix anwenden (nach Layout-Switch).
      if (!this._navStartZoomApplied && this.isNavActive() && this.map && typeof this.map.setZoom === 'function') {
        try {
          const z0 = Number(this._navStartZoom);
          if (Number.isFinite(z0) && z0 > 0) {
            this.map.setZoom(z0, { animate: false });
          }
        } catch (e0) {
          /* ignore */
        }
        this._navStartZoomApplied = true;
      }

      // In der Navigation soll die Position stabil im sichtbaren Kartenausschnitt bleiben.
      // Keine zusätzliche "Upper-half"-Verschiebung bei Simulation/GPS.
      this.syncMapUnderPosition(latlng, { preferUpperHalf: false });
      let mapRotationDeg = 0;
      if (this.mapHeadingUp) {
        let h = headingDeg;
        if (!Number.isFinite(h) && this.geometry && this.cumDist && this.Lref) {
          h = headingFromRoutePosition(along, this.geometry, this.cumDist, this.Lref);
        }
        if (Number.isFinite(h)) {
          mapRotationDeg = -h;
        }
      }
      this._lastAppliedRotationDeg = mapRotationDeg;
      this.applyLeafletRotation(mapRotationDeg);
    },

    /**
     * Steuerung: vor „Los geht’s“ stumm schalten, danach freigeben.
     * @param {boolean} armed
     */
    setSpeechArmed: function (armed) {
      this._speechArmed = !!armed;
    },
  };

  global.NRNavigation = Nav;
})(window);
