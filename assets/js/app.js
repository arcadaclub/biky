(function () {
  'use strict';

  const CSRF = window.NR_CSRF || '';
  const BASE = typeof window.NR_BASE === 'string' ? window.NR_BASE.replace(/\/$/, '') : '';
  const AUTH_NOTICE = typeof window.NR_AUTH_NOTICE === 'string' ? window.NR_AUTH_NOTICE : '';
  const WP_AUTH = window.NR_WP_AUTH === true;
  const AUTH_DIALOG_COPY_LOGIN_WP =
    'Melden Sie sich mit dem gleichen Benutzernamen bzw. der E-Mail und dem Passwort wie auf der Club-Website (WordPress) an.';
  const AUTH_DIALOG_COPY_LOGIN_LOCAL = 'Mit Ihrem Konto können Sie Routen berechnen, speichern und exportieren.';

  function apiUrl(path) {
    const p = path.replace(/^\//, '');
    if (!BASE) return p;
    return BASE + '/' + p;
  }

  function applyAuthRequiredFromJson(data) {
    if (data && data.auth_required) {
      clearUserScopedClientState();
      state.currentUser = null;
      setAuthRegisterMode(false);
      refreshRouteButton();
    }
  }

  async function fetchJson(url, options) {
    const headers = Object.assign(
      {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF,
      },
      options && options.headers ? options.headers : {}
    );
    const res = await fetch(url, Object.assign({}, options, { headers, credentials: 'same-origin' }));
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Ungültige Server-Antwort');
    }
    if (!res.ok) {
      applyAuthRequiredFromJson(data);
      throw new Error(data.error || res.statusText || 'Anfrage fehlgeschlagen');
    }
    return data;
  }

  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    const ms = Number.isFinite(Number(timeoutMs)) ? Math.max(1000, Number(timeoutMs)) : 60000;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const id = window.setTimeout(function () {
      if (ctrl) {
        try {
          ctrl.abort();
        } catch (e0) {
          /* ignore */
        }
      }
    }, ms);
    try {
      const opts = Object.assign({}, options || {});
      if (ctrl) {
        opts.signal = ctrl.signal;
      }
      return await fetchJson(url, opts);
    } catch (e) {
      const msg = e && e.name === 'AbortError' ? 'Timeout: Server antwortet nicht rechtzeitig.' : e && e.message ? e.message : String(e);
      throw new Error(msg);
    } finally {
      window.clearTimeout(id);
    }
  }

  async function fetchGetJson(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Ungültige Server-Antwort');
    }
    if (!res.ok) {
      applyAuthRequiredFromJson(data);
      throw new Error(data.error || res.statusText || 'Anfrage fehlgeschlagen');
    }
    return data;
  }

  function nrGeoAlert(err) {
    if (typeof window.NRGeo !== 'undefined' && window.NRGeo && typeof window.NRGeo.userMessage === 'function') {
      alert(window.NRGeo.userMessage(err));
      return;
    }
    alert('Position konnte nicht ermittelt werden (Berechtigung oder HTTPS prüfen).');
  }

  function nrGeoGetCurrentPosition(success, fail, opts) {
    if (typeof window.NRGeo !== 'undefined' && window.NRGeo && typeof window.NRGeo.getCurrentPosition === 'function') {
      window.NRGeo.getCurrentPosition(success, fail, opts);
      return;
    }
    if (!navigator.geolocation) {
      if (fail) {
        fail(null);
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(
      success,
      fail,
      opts || { enableHighAccuracy: true, maximumAge: 0, timeout: 28000 }
    );
  }

  const mapEl = document.getElementById('map');
  const mapWrap = document.getElementById('map-wrap');
  const btnBrandReload = document.getElementById('btn-brand-reload');
  const piperMapProgressWrap = document.getElementById('nr-piper-map-progress');
  const piperMapProgressFill = document.getElementById('nr-piper-map-progress-fill');
  const pointStatus = document.getElementById('point-status');
  const routeError = document.getElementById('route-error');
  const routeInfo = document.getElementById('route-info');
  const statsSection = document.getElementById('stats-section');
  const routeBusyOverlay = document.getElementById('route-busy-overlay');
  const routeBusyVisual = document.getElementById('route-busy-visual');
  const routeBusyTitle = document.getElementById('route-busy-title');
  const routeBusyDetail = document.getElementById('route-busy-detail');
  const routeProgressTrack = document.getElementById('route-progress-track');
  const routeProgressBar = document.getElementById('route-progress-bar');
  const routeBusyActions = document.getElementById('route-busy-actions');
  const routeBusyClose = document.getElementById('route-busy-close');
  const routeBusyNavStart = document.getElementById('route-busy-nav-start');
  const surfaceLegend = document.getElementById('surface-legend');
  const authDialog = document.getElementById('auth-dialog');
  const kontoDialog = document.getElementById('konto-dialog');
  const btnKonto = document.getElementById('btn-konto');
  const kontoDialogClose = document.getElementById('konto-dialog-close');
  const kontoDialogCloseBtn = document.getElementById('konto-dialog-close-btn');
  const authGuest = document.getElementById('auth-guest');
  const authUserBox = document.getElementById('auth-user');
  const authUserLabel = document.getElementById('auth-user-label');
  const panelUserSummary = document.getElementById('panel-user-summary');
  const panelUserName = document.getElementById('panel-user-name');
  const panelFitnessPoints = document.getElementById('panel-fitness-points');
  const topBarUserMeta = document.getElementById('top-bar-user-meta');
  const topBarUserName = document.getElementById('top-bar-user-name');
  const topBarFitnessPoints = document.getElementById('top-bar-fitness-points');
  const authPanelMessage = document.getElementById('auth-panel-message');
  const authDialogTitle = document.getElementById('auth-dialog-title');
  const authDialogCopy = document.getElementById('auth-dialog-copy');
  const authMessage = document.getElementById('auth-message');
  const authDisplayNameWrap = document.getElementById('auth-display-name-wrap');
  const authDisplayName = document.getElementById('auth-display-name');
  const messageDialog = document.getElementById('nr-message-dialog');
  const messageTitle = document.getElementById('nr-message-title');
  const messageText = document.getElementById('nr-message-text');
  const messageOk = document.getElementById('nr-message-ok');
  const waypointsClearDialog = document.getElementById('nr-waypoints-clear-dialog');
  const waypointsClearText = document.getElementById('nr-waypoints-clear-text');
  const waypointsClearCancel = document.getElementById('nr-waypoints-clear-cancel');
  const waypointsClearConfirm = document.getElementById('nr-waypoints-clear-confirm');
  const waypointDeletePopover = document.getElementById('nr-waypoint-delete-popover');
  const waypointDeletePopoverTitle = waypointDeletePopover
    ? waypointDeletePopover.querySelector('.nr-waypoint-delete-popover-title')
    : null;
  const waypointDeletePopoverCancel = document.getElementById('nr-waypoint-delete-popover-cancel');
  const waypointDeletePopoverConfirm = document.getElementById('nr-waypoint-delete-popover-confirm');
  const changelogDialog = document.getElementById('changelog-dialog');
  const changelogOpen = document.getElementById('btn-changelog');
  const changelogClose = document.getElementById('changelog-close');
  const settingsDialog = document.getElementById('settings-dialog');
  const settingsOpen = document.getElementById('btn-settings');
  const settingsClose = document.getElementById('settings-close');
  const settingsVoiceEnabled = document.getElementById('settings-voice-enabled');
  const settingsFitnessVoiceEnabled = document.getElementById('settings-fitness-voice-enabled');
  const btnAddressbookStart = document.getElementById('btn-addressbook-start');
  const btnAddressbookGoal = document.getElementById('btn-addressbook-goal');
  const btnAddressbookSaveStart = document.getElementById('btn-addressbook-save-start');
  const btnAddressbookSaveGoal = document.getElementById('btn-addressbook-save-goal');
  const addressbookDialog = document.getElementById('addressbook-dialog');
  const addressbookClose = document.getElementById('addressbook-close');
  const addressbookList = document.getElementById('addressbook-list');
  const addressbookEmpty = document.getElementById('addressbook-empty');
  const addressbookDeleteDialog = document.getElementById('addressbook-delete-dialog');
  const addressbookDeleteText = document.getElementById('addressbook-delete-text');
  const addressbookDeleteCancel = document.getElementById('addressbook-delete-cancel');
  const addressbookDeleteConfirm = document.getElementById('addressbook-delete-confirm');
  const addressbookRenameDialog = document.getElementById('addressbook-rename-dialog');
  const addressbookRenameInput = document.getElementById('addressbook-rename-input');
  const addressbookRenameCancel = document.getElementById('addressbook-rename-cancel');
  const addressbookRenameConfirm = document.getElementById('addressbook-rename-confirm');
  const wakeLockToggle = document.getElementById('wake-lock-toggle');
  const authRegisterApiWrap = document.getElementById('auth-register-api-wrap');
  const authRegisterApiKey = document.getElementById('auth-register-api-key');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');
  const btnAuthToggleRegister = document.getElementById('btn-auth-toggle-register');
  const btnAuthLogin = document.getElementById('btn-auth-login');
  const btnAuthRegister = document.getElementById('btn-auth-register');
  const btnAuthForgot = document.getElementById('btn-auth-forgot');
  const orsApiKeyInput = document.getElementById('ors-api-key');
  const btnOrsApiKeySave = document.getElementById('btn-ors-api-key-save');
  const navDebugLogEnabledInput = document.getElementById('nav-debug-log-enabled');
  function nrHasEffectiveOrsApiKey() {
    const userKey = orsApiKeyInput ? String(orsApiKeyInput.value || '').trim() : '';
    if (userKey !== '') {
      return true;
    }
    return window.NR_ORS_SERVER_KEY_CONFIGURED === true;
  }
  const btnSavedRoutesManage = document.getElementById('btn-saved-routes-manage');
  const profileCurrentValue = document.getElementById('profile-current-value');
  const profileDialog = document.getElementById('profile-dialog');
  const profileDialogClose = document.getElementById('profile-dialog-close');
  const savedRoutesManageDialog = document.getElementById('saved-routes-manage-dialog');
  const savedRoutesManageClose = document.getElementById('saved-routes-manage-close');
  const savedRouteTitle = document.getElementById('saved-route-title');
  const savedRoutesList = document.getElementById('saved-routes-list');
  const savedRoutesMessage = document.getElementById('saved-routes-message');
  const savedRouteDeleteDialog = document.getElementById('saved-route-delete-dialog');
  const savedRouteDeleteText = document.getElementById('saved-route-delete-text');
  const savedRouteDeleteCancel = document.getElementById('saved-route-delete-cancel');
  const savedRouteDeleteConfirm = document.getElementById('saved-route-delete-confirm');
  const savedRouteRenameDialog = document.getElementById('saved-route-rename-dialog');
  const savedRouteRenameInput = document.getElementById('saved-route-rename-input');
  const savedRouteRenameCancel = document.getElementById('saved-route-rename-cancel');
  const savedRouteRenameConfirm = document.getElementById('saved-route-rename-confirm');
  const navFeedbackDialog = document.getElementById('nav-feedback-dialog');
  const navFeedbackName = document.getElementById('nav-feedback-name');
  const navFeedbackEmail = document.getElementById('nav-feedback-email');
  const navFeedbackMessage = document.getElementById('nav-feedback-message');
  const navFeedbackStatus = document.getElementById('nav-feedback-status');
  const navFeedbackSkip = document.getElementById('nav-feedback-skip');
  const navFeedbackSubmit = document.getElementById('nav-feedback-submit');
  const btnPanelFeedback = document.getElementById('btn-panel-feedback');
  /** @type {number|string|null} */
  let savedRouteDeletePendingId = null;
  /** @type {number|null} */
  let addressbookDeletePendingId = null;
  let addressbookDeletePendingTitle = '';
  /** @type {number|null} */
  let addressbookRenamePendingId = null;
  let savedRouteRenamePending = null;
  let routeBusyCloseHandler = null;
  let routeBusyNavStartHandler = null;
  let savedRoutesManageCloseOnOutsideClickBound = false;

  if (btnBrandReload) {
    btnBrandReload.addEventListener('click', function () {
      // "Hard reload": Cache-Bust Query setzen (funktioniert zuverlässig auch wenn reload(true) deprecated ist).
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('__nr_reload', String(Date.now()));
        window.location.replace(u.toString());
      } catch (e) {
        window.location.reload();
      }
    });
  }

  function openSavedRoutesManageDialog() {
    if (!savedRoutesManageDialog) {
      return;
    }
    savedRoutesManageDialog.hidden = false;
    savedRoutesManageDialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('saved-routes-manage-open');
    if (savedRouteTitle) {
      const rd = state && state.lastRoute ? state.lastRoute : null;
      savedRouteTitle.value = buildSavedRouteTitleSuggestion(rd) || '';
    }
    window.setTimeout(function () {
      if (savedRouteTitle) {
        savedRouteTitle.focus();
      } else if (savedRoutesManageClose) {
        savedRoutesManageClose.focus();
      }
    }, 0);
    if (state.currentUser) {
      void loadSavedRoutes();
    } else {
      setHintMessage(savedRoutesMessage, 'Zum Verwalten bitte anmelden.');
    }
    if (!savedRoutesManageCloseOnOutsideClickBound) {
      savedRoutesManageCloseOnOutsideClickBound = true;
      savedRoutesManageDialog.addEventListener('mousedown', function (ev) {
        if (ev.target === savedRoutesManageDialog) {
          closeSavedRoutesManageDialog();
        }
      });
    }
  }

  function closeSavedRoutesManageDialog() {
    if (!savedRoutesManageDialog) {
      return;
    }
    savedRoutesManageDialog.hidden = true;
    savedRoutesManageDialog.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('saved-routes-manage-open');
  }

  function openSavedRouteDeleteConfirm(routeId, routeTitle) {
    savedRouteDeletePendingId = routeId;
    if (savedRouteDeleteText) {
      const name = routeTitle && String(routeTitle).trim() ? String(routeTitle).trim() : 'Ohne Titel';
      savedRouteDeleteText.textContent =
        'Die gespeicherte Route „' + name + '“ wird vom Server gelöscht und kann nicht wiederhergestellt werden. Wirklich löschen?';
    }
    if (savedRouteDeleteDialog) {
      savedRouteDeleteDialog.hidden = false;
      savedRouteDeleteDialog.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('saved-route-delete-open');
    if (savedRouteDeleteConfirm) {
      window.setTimeout(function () {
        savedRouteDeleteConfirm.focus();
      }, 0);
    }
  }

  if (routeBusyClose) {
    routeBusyClose.addEventListener('click', function () {
      if (routeBusyCloseHandler) {
        routeBusyCloseHandler();
        return;
      }
      hideRouteBusyOverlay();
    });
  }
  if (routeBusyNavStart) {
    routeBusyNavStart.addEventListener('click', function (ev) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (e) {
        /* ignore */
      }
      if (!nrRequireOrsApiKeyOrExplain()) {
        return;
      }
      if (routeBusyNavStartHandler) {
        routeBusyNavStartHandler(ev);
      }
    });
  }

  function closeSavedRouteDeleteConfirm() {
    savedRouteDeletePendingId = null;
    if (savedRouteDeleteDialog) {
      savedRouteDeleteDialog.hidden = true;
      savedRouteDeleteDialog.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('saved-route-delete-open');
  }

  function openSavedRouteRenameDialog(routeId, routeTitle) {
    savedRouteRenamePending = {
      id: routeId,
      title: routeTitle || '',
    };
    if (savedRouteRenameInput) {
      savedRouteRenameInput.value = routeTitle || '';
    }
    if (savedRouteRenameDialog) {
      savedRouteRenameDialog.hidden = false;
      savedRouteRenameDialog.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('saved-route-delete-open');
    if (savedRouteRenameInput) {
      window.setTimeout(function () {
        savedRouteRenameInput.focus();
        savedRouteRenameInput.select();
      }, 0);
    }
  }

  function closeSavedRouteRenameDialog() {
    savedRouteRenamePending = null;
    if (savedRouteRenameDialog) {
      savedRouteRenameDialog.hidden = true;
      savedRouteRenameDialog.setAttribute('aria-hidden', 'true');
    }
    if (savedRouteRenameInput) {
      savedRouteRenameInput.value = '';
    }
    document.body.classList.remove('saved-route-delete-open');
  }

  function openNavFeedbackDialog() {
    if (!navFeedbackDialog) {
      return;
    }
    if (state.currentUser) {
      if (navFeedbackName) {
        navFeedbackName.value = state.currentUser.display_name || '';
      }
      if (navFeedbackEmail) {
        navFeedbackEmail.value = state.currentUser.email || '';
      }
    }
    if (navFeedbackMessage) {
      navFeedbackMessage.value = '';
    }
    if (navFeedbackStatus) {
      navFeedbackStatus.textContent = '';
      navFeedbackStatus.hidden = true;
    }
    navFeedbackDialog.hidden = false;
    navFeedbackDialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('nav-feedback-open');
    window.setTimeout(function () {
      if (navFeedbackMessage) {
        navFeedbackMessage.focus();
      } else if (navFeedbackName) {
        navFeedbackName.focus();
      }
    }, 0);
  }

  function closeNavFeedbackDialog() {
    if (navFeedbackDialog) {
      navFeedbackDialog.hidden = true;
      navFeedbackDialog.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('nav-feedback-open');
  }

  const map = L.map(mapEl, { zoomControl: true }).setView([53.55, 9.99], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    // Etwas mehr Tile-Buffer, damit Zoom/`flyTo` nicht sichtbar "nachlädt"/flackert.
    keepBuffer: 14,
    // Weniger aggressive Tile-Updates während Zoom reduziert Flackern merklich.
    updateWhenIdle: true,
    updateWhenZooming: false,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  let startMarker = null;
  let goalMarker = null;
  const viaMarkers = [];
  /** @type {L.Marker[]} */
  const rtWaypointMarkers = [];
  let routeLine = null;
  let userMarker = null;
  let watchId = null;
  let noExitLayerGroup = null;
  let surfaceLayerGroup = null;
  let noExitMoveTimer = null;
  let routeBusyNarrationTimer = null;

  const state = {
    start: null,
    goal: null,
    vias: [],
    lastRoute: null,
    /** @type {array|null} zuletzt berechnete Rundkurs-Varianten (volle Route-Payloads) */
    roundtripVariants: null,
    /** @type {L.LatLng[]} Entwurf Wegpunkte für Rundkurs-Modus „Wegpunkte“ (max. 10) */
    rtWaypoints: [],
    /** Klick auf Route: Teilstrecke per Alternativrouting ersetzen */
    /** OpenStreetMap noexit (Weg oder Knoten) als rote Overlays */
    noExitHighlightActive: false,
    surfaceViewActive: false,
    navRerouteSession: null,
    currentUser:
      window.NR_USER && typeof window.NR_USER === 'object' && window.NR_USER.id
        ? window.NR_USER
        : null,
    /** Route-Busy Overlay: wenn true, nur "Abbrechen" anzeigen (kein Nav-Start). */
    _nrRouteBusyCancelOnly: false,
  };

  const NOEXIT_MIN_ZOOM = 12;
  const ROUTE_REMOVE_MAX_CLICK_M = 58;
  const ROUTE_REMOVE_MAX_CLICK_EDIT_M = 88;
  const ROUTE_REMOVE_VERTEX_HALFSPAN = 6;
  const SURFACE_STYLE_CATALOG = {
    asphalt: { color: '#4ca0ff', label: 'Asphalt / Beton' },
    natural: { color: '#5ac878', label: 'Natur / Waldweg' },
    compact: { color: '#d7b36a', label: 'Befestigt / gemischt' },
    unknown: { color: '#c7d0c9', label: 'Unklar' },
  };

  function rebuildRoutePolylineForMode() {
    if (!routeLine || !state.lastRoute) {
      return;
    }
    const latlngs = routeLine.getLatLngs();
    map.removeLayer(routeLine);
    routeLine = L.polyline(latlngs, {
      color: '#3d8b5c',
      weight: 5,
      opacity: 0.92,
      bubblingMouseEvents: true,
    }).addTo(map);
  }

  function attachRoutePolylineFromLatLngs(latlngs) {
    routeLine = L.polyline(latlngs, {
      color: '#3d8b5c',
      weight: 5,
      opacity: 0.92,
      bubblingMouseEvents: true,
    }).addTo(map);
  }

  function setRouteRemoveMode() {
    return;
  }

  function toggleRouteRemoveMode() {
    return;
  }

  function clearNoExitHighlightLayer() {
    if (noExitLayerGroup) {
      if (typeof noExitLayerGroup.clearLayers === 'function') {
        noExitLayerGroup.clearLayers();
      }
      map.removeLayer(noExitLayerGroup);
      noExitLayerGroup = null;
    }
  }

  function clearSurfaceLayer() {
    if (surfaceLayerGroup) {
      if (typeof surfaceLayerGroup.clearLayers === 'function') {
        surfaceLayerGroup.clearLayers();
      }
      map.removeLayer(surfaceLayerGroup);
      surfaceLayerGroup = null;
    }
    if (surfaceLegend) {
      surfaceLegend.innerHTML = '';
      surfaceLegend.hidden = true;
      surfaceLegend.setAttribute('aria-hidden', 'true');
    }
  }

  function routeHasSurfaceSegments(data) {
    return !!(
      data &&
      Array.isArray(data.geometry) &&
      data.geometry.length >= 2 &&
      Array.isArray(data.surface_segments) &&
      data.surface_segments.length
    );
  }

  function hasRouteGeometryOnMap() {
    const g = state.lastRoute && state.lastRoute.geometry;
    return Array.isArray(g) && g.length >= 2;
  }

  /** Wegarten / Sackgassen-FABs nur bei angezeigter Route (state.lastRoute mit Linie). */
  function syncMapRouteFabToolbar() {
    const hasRoute = hasRouteGeometryOnMap();
    const btnNo = document.getElementById('btn-map-noexit');
    if (btnNo) {
      btnNo.hidden = !hasRoute;
    }
    if (!hasRoute && state.noExitHighlightActive) {
      setNoExitHighlightMode(false);
    }
    updateNoExitClearButton();
    updateSurfaceButton();
  }

  function surfaceKindFromValue(value) {
    const v = Number(value);
    // ORS surface extra (0–18), vgl. ORS-Doku „Extra Info → surface“
    if ([1, 3, 4, 5, 6, 14].includes(v)) {
      return 'asphalt';
    }
    if ([2, 9, 10, 11, 12, 13, 15, 16, 17, 18].includes(v)) {
      return 'natural';
    }
    if (v === 0) {
      return 'unknown';
    }
    if (Number.isFinite(v)) {
      return 'compact';
    }
    return 'unknown';
  }

  function updateSurfaceButton() {
    const btn = document.getElementById('btn-map-surface');
    if (!btn) {
      return;
    }
    const canShow = hasRouteGeometryOnMap() && routeHasSurfaceSegments(state.lastRoute);
    btn.hidden = !canShow;
    btn.disabled = !canShow;
    btn.setAttribute('aria-pressed', state.surfaceViewActive ? 'true' : 'false');
    btn.classList.toggle('is-active', state.surfaceViewActive);
    if (!canShow) {
      btn.title = 'Wegarten erst nach einer passenden Route verfügbar';
      btn.setAttribute('aria-label', 'Wegarten erst nach einer passenden Route verfügbar');
      return;
    }
    btn.title = state.surfaceViewActive ? 'Wegarten ausblenden' : 'Wegarten der aktuellen Route anzeigen';
    btn.setAttribute(
      'aria-label',
      state.surfaceViewActive ? 'Wegarten der aktuellen Route ausblenden' : 'Wegarten der aktuellen Route anzeigen'
    );
  }

  function renderSurfaceLegend(kinds) {
    if (!surfaceLegend) {
      return;
    }
    if (!Array.isArray(kinds) || !kinds.length) {
      surfaceLegend.innerHTML = '';
      surfaceLegend.hidden = true;
      surfaceLegend.setAttribute('aria-hidden', 'true');
      return;
    }
    const title = document.createElement('p');
    title.className = 'surface-legend-title';
    title.textContent = 'Wegarten';
    const items = document.createElement('div');
    items.className = 'surface-legend-items';
    kinds.forEach(function (kind) {
      const meta = SURFACE_STYLE_CATALOG[kind];
      if (!meta) {
        return;
      }
      const row = document.createElement('div');
      row.className = 'surface-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'surface-legend-swatch';
      swatch.style.background = meta.color;
      const label = document.createElement('span');
      label.textContent = meta.label;
      row.appendChild(swatch);
      row.appendChild(label);
      items.appendChild(row);
    });
    surfaceLegend.innerHTML = '';
    surfaceLegend.appendChild(title);
    surfaceLegend.appendChild(items);
    surfaceLegend.hidden = false;
    surfaceLegend.setAttribute('aria-hidden', 'false');
  }

  function renderSurfaceOverlay(data) {
    clearSurfaceLayer();
    if (!routeHasSurfaceSegments(data)) {
      return;
    }
    surfaceLayerGroup = L.layerGroup();
    const usedKinds = [];
    data.surface_segments.forEach(function (segment) {
      if (!segment || typeof segment !== 'object') {
        return;
      }
      const from = Math.max(0, Number(segment.from_index) || 0);
      const to = Math.min(data.geometry.length - 1, Number(segment.to_index) || 0);
      if (to <= from) {
        return;
      }
      const coords = data.geometry.slice(from, to + 1);
      if (coords.length < 2) {
        return;
      }
      const kind = surfaceKindFromValue(segment.surface_value);
      const meta = SURFACE_STYLE_CATALOG[kind] || SURFACE_STYLE_CATALOG.unknown;
      if (!usedKinds.includes(kind)) {
        usedKinds.push(kind);
      }
      L.polyline(
        coords.map(function (p) {
          return L.latLng(p[0], p[1]);
        }),
        {
          color: meta.color,
          weight: 7,
          opacity: 0.96,
          lineCap: 'round',
          lineJoin: 'round',
        }
      ).addTo(surfaceLayerGroup);
    });
    surfaceLayerGroup.addTo(map);
    renderSurfaceLegend(usedKinds);
  }

  function setSurfaceViewMode(on) {
    state.surfaceViewActive = !!on;
    updateSurfaceButton();
    if (!state.surfaceViewActive) {
      clearSurfaceLayer();
      return;
    }
    if (!routeHasSurfaceSegments(state.lastRoute)) {
      state.surfaceViewActive = false;
      updateSurfaceButton();
      clearSurfaceLayer();
      return;
    }
    renderSurfaceOverlay(state.lastRoute);
  }

  /** Gleiche Idee wie nr_rt_sample_polyline_with_distance (route_roundtrip.php). */
  function nrSamplePolylineWithDistance(geometry, stepM) {
    if (!geometry || geometry.length === 0) {
      return [];
    }
    const samples = [[geometry[0][0], geometry[0][1], 0]];
    let covered = 0;
    let target = 0;
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1];
      const b = geometry[i];
      const segM = map.distance(L.latLng(a[0], a[1]), L.latLng(b[0], b[1]));
      if (segM <= 0.01) {
        continue;
      }
      while (target + stepM <= covered + segM) {
        target += stepM;
        const t = (target - covered) / segM;
        samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, target]);
      }
      covered += segM;
    }
    return samples;
  }

  /**
   * Sackgassen-Erkennung (single-pass): Hin-und-zurück-Äste, die räumlich gespiegelt verlaufen.
   * Schwellwerte skalieren mit Routenlänge — bei 30-km-Touren dürfen Stiche länger sein als bei 5 km.
   * Spatial-Hash-Grid macht den Return-Lookup O(N) statt O(N²).
   */
  const NR_OUT_AND_BACK_CONFIG = {
    stepM: 14,
    minPathDelta: 70,
    pathDeltaFraction: 0.18,
    pathDeltaMin: 800,
    pathDeltaMax: 3200,
    maxReturnDist: 42,
    minAway: 30,
    awayFraction: 0.045,
    awayCapMin: 320,
    awayCapMax: 1100,
    minMirrorSamples: 4,
    avgMirrorDistMax: 20,
    maxMirrorDistMax: 36,
    clusterPathM: 54,
  };

  function nrClampNum(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Räumlicher Hash-Grid: O(1)-Lookup von Samples in einer Umgebung statt O(N²).
   * Zellengröße ≈ Suchradius × 2,5 → eine 1-Zellen-Reach-Suche deckt den Suchradius ab.
   */
  function nrBuildSpatialGrid(samples, cellM) {
    const safeCellM = Math.max(8, cellM);
    if (!samples || samples.length === 0) {
      return {
        cells: new Map(),
        cellLatDeg: safeCellM / 111320,
        cellLonDeg: safeCellM / 111320,
        latPerDeg: 111320,
        lonPerDeg: 111320,
      };
    }
    const refLat = samples[0][0];
    const latPerDeg = 111320;
    const lonPerDeg = Math.max(1, 111320 * Math.cos((refLat * Math.PI) / 180));
    const cellLatDeg = Math.max(1e-7, safeCellM / latPerDeg);
    const cellLonDeg = Math.max(1e-7, safeCellM / lonPerDeg);
    const cells = new Map();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const cx = Math.floor(s[1] / cellLonDeg);
      const cy = Math.floor(s[0] / cellLatDeg);
      const key = cx + ':' + cy;
      const bucket = cells.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        cells.set(key, [i]);
      }
    }
    return { cells: cells, cellLatDeg: cellLatDeg, cellLonDeg: cellLonDeg, latPerDeg: latPerDeg, lonPerDeg: lonPerDeg };
  }

  function nrQueryGridWithin(grid, lat, lon, maxM) {
    if (!grid.cells || grid.cells.size === 0) {
      return [];
    }
    const cx = Math.floor(lon / grid.cellLonDeg);
    const cy = Math.floor(lat / grid.cellLatDeg);
    const reachY = Math.max(1, Math.ceil(maxM / Math.max(1, grid.cellLatDeg * grid.latPerDeg)));
    const reachX = Math.max(1, Math.ceil(maxM / Math.max(1, grid.cellLonDeg * grid.lonPerDeg)));
    const out = [];
    for (let dy = -reachY; dy <= reachY; dy++) {
      for (let dx = -reachX; dx <= reachX; dx++) {
        const bucket = grid.cells.get(cx + dx + ':' + (cy + dy));
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            out.push(bucket[i]);
          }
        }
      }
    }
    return out;
  }

  function nrMirrorOverlapStats(samples, i, j) {
    const half = Math.floor((j - i) / 2);
    if (half < 2) {
      return null;
    }
    let count = 0;
    let sum = 0;
    let maxDist = 0;
    for (let t = 1; t <= half; t++) {
      const left = samples[i + t];
      const right = samples[j - t];
      if (!left || !right) {
        break;
      }
      const d = map.distance(L.latLng(left[0], left[1]), L.latLng(right[0], right[1]));
      sum += d;
      if (d > maxDist) {
        maxDist = d;
      }
      count++;
    }
    if (count === 0) {
      return null;
    }
    return { count: count, avgDist: sum / count, maxDist: maxDist };
  }

  function nrFindOutAndBackSegmentsSinglePass(geometry, cfg) {
    const samples = nrSamplePolylineWithDistance(geometry, cfg.stepM);
    const count = samples.length;
    if (count < cfg.minMirrorSamples + 3) {
      return [];
    }

    const totalLengthM = samples[count - 1][2];
    const maxAwayCap = nrClampNum(cfg.awayFraction * totalLengthM, cfg.awayCapMin, cfg.awayCapMax);
    const maxPathDelta = nrClampNum(cfg.pathDeltaFraction * totalLengthM, cfg.pathDeltaMin, cfg.pathDeltaMax);
    const grid = nrBuildSpatialGrid(samples, cfg.maxReturnDist * 2.5);
    const segments = [];

    let i = 0;
    while (i < count) {
      const anchor = samples[i];
      const neighbors = nrQueryGridWithin(grid, anchor[0], anchor[1], cfg.maxReturnDist);
      neighbors.sort(function (a, b) {
        return a - b;
      });

      let candidate = null;
      for (let n = 0; n < neighbors.length; n++) {
        const j = neighbors[n];
        if (j <= i) {
          continue;
        }
        const pathDelta = samples[j][2] - anchor[2];
        if (pathDelta < cfg.minPathDelta) {
          continue;
        }
        if (pathDelta > maxPathDelta) {
          break;
        }
        const returnDist = map.distance(
          L.latLng(anchor[0], anchor[1]),
          L.latLng(samples[j][0], samples[j][1])
        );
        if (returnDist > cfg.maxReturnDist) {
          continue;
        }
        let maxAway = 0;
        for (let k = i + 1; k < j; k++) {
          const away = map.distance(
            L.latLng(anchor[0], anchor[1]),
            L.latLng(samples[k][0], samples[k][1])
          );
          if (away > maxAway) {
            maxAway = away;
          }
        }
        if (maxAway < cfg.minAway || maxAway > maxAwayCap) {
          continue;
        }
        const overlap = nrMirrorOverlapStats(samples, i, j);
        if (
          !overlap ||
          overlap.count < cfg.minMirrorSamples ||
          overlap.avgDist > cfg.avgMirrorDistMax ||
          overlap.maxDist > cfg.maxMirrorDistMax
        ) {
          continue;
        }
        candidate = {
          start_path_m: anchor[2],
          end_path_m: samples[j][2],
          path_delta_m: pathDelta,
          return_dist_m: returnDist,
          max_away_m: maxAway,
          overlap_count: overlap.count,
          avg_mirror_dist_m: overlap.avgDist,
          max_mirror_dist_m: overlap.maxDist,
          next_i: j,
        };
        break;
      }

      if (candidate) {
        segments.push({
          start_path_m: candidate.start_path_m,
          end_path_m: candidate.end_path_m,
          path_delta_m: candidate.path_delta_m,
          return_dist_m: candidate.return_dist_m,
          max_away_m: candidate.max_away_m,
          overlap_count: candidate.overlap_count,
          avg_mirror_dist_m: candidate.avg_mirror_dist_m,
          max_mirror_dist_m: candidate.max_mirror_dist_m,
        });
        i = candidate.next_i + 1;
        continue;
      }
      i++;
    }

    return segments;
  }

  function mergeOutAndBackSegments(segments, clusterPathM) {
    if (!segments.length) {
      return [];
    }
    const enriched = segments.map(function (s) {
      return {
        start_path_m: s.start_path_m,
        end_path_m: s.end_path_m,
        max_away_m: s.max_away_m,
        return_dist_m: s.return_dist_m,
        avg_mirror_dist_m: s.avg_mirror_dist_m,
        max_mirror_dist_m: s.max_mirror_dist_m,
        mid: (s.start_path_m + s.end_path_m) / 2,
      };
    });
    enriched.sort(function (a, b) {
      if (a.start_path_m !== b.start_path_m) {
        return a.start_path_m - b.start_path_m;
      }
      return a.end_path_m - b.end_path_m;
    });
    const out = [];
    let cur = {
      start_path_m: enriched[0].start_path_m,
      end_path_m: enriched[0].end_path_m,
      max_away_m: enriched[0].max_away_m,
      return_dist_m: enriched[0].return_dist_m,
      avg_mirror_dist_m: enriched[0].avg_mirror_dist_m,
      max_mirror_dist_m: enriched[0].max_mirror_dist_m,
      mid: enriched[0].mid,
    };
    for (let i = 1; i < enriched.length; i++) {
      const s = enriched[i];
      if (s.start_path_m <= cur.end_path_m + clusterPathM || Math.abs(s.mid - cur.mid) < clusterPathM) {
        cur.start_path_m = Math.min(cur.start_path_m, s.start_path_m);
        cur.end_path_m = Math.max(cur.end_path_m, s.end_path_m);
        cur.max_away_m = Math.max(cur.max_away_m, s.max_away_m);
        cur.return_dist_m = Math.min(cur.return_dist_m, s.return_dist_m);
        cur.avg_mirror_dist_m = Math.min(cur.avg_mirror_dist_m, s.avg_mirror_dist_m);
        cur.max_mirror_dist_m = Math.min(cur.max_mirror_dist_m, s.max_mirror_dist_m);
        cur.mid = (cur.start_path_m + cur.end_path_m) / 2;
      } else {
        out.push({
          start_path_m: cur.start_path_m,
          end_path_m: cur.end_path_m,
          path_delta_m: cur.end_path_m - cur.start_path_m,
          max_away_m: cur.max_away_m,
          return_dist_m: cur.return_dist_m,
          avg_mirror_dist_m: cur.avg_mirror_dist_m,
          max_mirror_dist_m: cur.max_mirror_dist_m,
        });
        cur = {
          start_path_m: s.start_path_m,
          end_path_m: s.end_path_m,
          max_away_m: s.max_away_m,
          return_dist_m: s.return_dist_m,
          avg_mirror_dist_m: s.avg_mirror_dist_m,
          max_mirror_dist_m: s.max_mirror_dist_m,
          mid: s.mid,
        };
      }
    }
    out.push({
      start_path_m: cur.start_path_m,
      end_path_m: cur.end_path_m,
      path_delta_m: cur.end_path_m - cur.start_path_m,
      max_away_m: cur.max_away_m,
      return_dist_m: cur.return_dist_m,
      avg_mirror_dist_m: cur.avg_mirror_dist_m,
      max_mirror_dist_m: cur.max_mirror_dist_m,
    });
    return out;
  }

  function nrFindReliableNoExitSegments(geometry) {
    const segments = nrFindOutAndBackSegmentsSinglePass(geometry, NR_OUT_AND_BACK_CONFIG);
    return mergeOutAndBackSegments(segments, NR_OUT_AND_BACK_CONFIG.clusterPathM);
  }

  function nrGeometrySliceByPathMeters(geometry, cumDist, fromM, toM) {
    if (fromM > toM || !geometry || geometry.length < 2 || cumDist.length !== geometry.length) {
      return [];
    }
    let iStart = -1;
    for (let i = 0; i < geometry.length; i++) {
      if (cumDist[i] >= fromM) {
        iStart = i;
        break;
      }
    }
    let iEnd = -1;
    for (let i = geometry.length - 1; i >= 0; i--) {
      if (cumDist[i] <= toM) {
        iEnd = i;
        break;
      }
    }
    if (iStart < 0 || iEnd < 0 || iStart > iEnd) {
      return [];
    }
    return geometry.slice(iStart, iEnd + 1);
  }

  function nrFindVertexIndexAtOrAfterPath(cumDist, pathM) {
    for (let i = 0; i < cumDist.length; i++) {
      if (cumDist[i] >= pathM) {
        return i;
      }
    }
    return cumDist.length - 1;
  }

  function nrFindVertexIndexAtOrBeforePath(cumDist, pathM) {
    for (let i = cumDist.length - 1; i >= 0; i--) {
      if (cumDist[i] <= pathM) {
        return i;
      }
    }
    return 0;
  }

  /**
   * Ursprünglicher Geometrie-Vertex → Index in bereinigter Geometrie (nach Schnitt + Deduplizierung).
   *
   * @param {number} origW
   * @param {number[]} origIndexPerCleanedVertex
   * @returns {number|null}
   */
  function mapOrigWayEndToCleanedVertex(origW, origIndexPerCleanedVertex) {
    const n = origIndexPerCleanedVertex.length;
    if (!Array.isArray(origIndexPerCleanedVertex) || n < 2) {
      return null;
    }
    const w = Math.round(Number(origW));
    if (!Number.isFinite(w)) {
      return null;
    }
    let best = -1;
    for (let i = 0; i < n; i++) {
      const o = origIndexPerCleanedVertex[i];
      if (o <= w) {
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  function clientStripHtmlNav(raw) {
    if (!raw || typeof raw !== 'string') {
      return '';
    }
    const d = document.createElement('div');
    d.innerHTML = raw;
    const t = d.textContent || d.innerText || '';
    return t.replace(/\s+/g, ' ').trim();
  }

  /**
   * Fallback: ORS-Rohschritte (instructions) → gleiches Schrittformat wie navigation.steps, mit remap der way_points.
   */
  function clientNavStepsFromRawOrsInstructions(rawList, origIndexPerCleanedVertex) {
    if (!Array.isArray(rawList) || !rawList.length) {
      return [];
    }
    const out = [];
    rawList.forEach(function (step) {
      if (!step || typeof step !== 'object') {
        return;
      }
      const wp = step.way_points || step.wayPoints;
      let wStart = null;
      let wEnd = null;
      if (Array.isArray(wp) && wp.length >= 2) {
        const rawStart = Math.round(Number(wp[0]));
        if (Number.isFinite(rawStart)) {
          wStart = mapOrigWayEndToCleanedVertex(rawStart, origIndexPerCleanedVertex);
        }
        const rawEnd = Math.round(Number(wp[1]));
        if (Number.isFinite(rawEnd)) {
          wEnd = mapOrigWayEndToCleanedVertex(rawEnd, origIndexPerCleanedVertex);
        }
      }
      let street = '';
      ['name', 'street_name', 'way_name', 'wayName', 'streetName'].forEach(function (key) {
        if (street) {
          return;
        }
        const v = step[key];
        if (typeof v === 'string') {
          const c = v.trim();
          if (c && c.toLowerCase() !== 'null' && !/^unnamed$/i.test(c)) {
            street = c.length > 120 ? c.substring(0, 120) : c;
          }
        }
      });
      const instr = typeof step.instruction === 'string' ? step.instruction : '';
      if (!street && instr) {
        const plain = clientStripHtmlNav(instr);
        const m = plain.match(/\bauf\s+(?:(?:die|den|dem|der)\s+)?([^.,;]+?)(?:\.|,|;|$)/i);
        if (m && m[1]) {
          street = m[1]
            .trim()
            .replace(/\s+(ab|ein|an)\s*$/i, '')
            .replace(/\s+(abbiegen|einbiegen)\s*$/i, '')
            .trim();
          if (street.length > 80) {
            street = '';
          }
        }
      }
      out.push({
        instruction: instr,
        step_distance_m: typeof step.distance === 'number' ? step.distance : 0,
        type: typeof step.type === 'number' ? step.type : 0,
        way_start_index: wStart,
        way_end_index: wEnd,
        street: street,
      });
    });
    return out;
  }

  /**
   * Schritte mit monoton nicht fallendem way_end_index (Rückschritte entfernen); null way_end_index bleiben erhalten.
   *
   * @param {Array<{ way_end_index?: number|null }>} mapped
   */
  function dedupeNavStepsProgressiveWayEnd(mapped) {
    const deduped = [];
    let lastEnd = -1;
    mapped.forEach(function (s) {
      if (!s || typeof s !== 'object') {
        return;
      }
      if (s.way_end_index == null || Number.isNaN(Number(s.way_end_index))) {
        deduped.push(s);
        return;
      }
      const e = Number(s.way_end_index);
      if (e < lastEnd) {
        return;
      }
      deduped.push(s);
      lastEnd = e;
    });
    return deduped;
  }

  /**
   * way_end_index (bezogen auf die Geometrie vor Sackgassen-Schnitt) auf neue Vertex-Indizes abbilden.
   * Berücksichtigt Vertex-Löschungen und die anschließende Deduplizierung naher Punkte.
   *
   * @param {Array<{ way_start_index?: number, way_end_index?: number, instruction?: string, step_distance_m?: number, type?: number, street?: string }>} steps
   * @param {number[]} origIndexPerCleanedVertex ursprünglicher Geometrie-Index je Punkt in `cleaned`
   */
  function remapNavigationStepsToCleanedGeometry(steps, origIndexPerCleanedVertex) {
    if (!Array.isArray(steps) || !steps.length || !Array.isArray(origIndexPerCleanedVertex)) {
      return [];
    }
    const n = origIndexPerCleanedVertex.length;
    if (n < 2) {
      return [];
    }

    const mapped = [];
    steps.forEach(function (s) {
      if (!s || typeof s !== 'object') {
        return;
      }
      if (s.way_end_index == null || Number.isNaN(Number(s.way_end_index))) {
        let startOnly = null;
        if (s.way_start_index != null && !Number.isNaN(Number(s.way_start_index))) {
          startOnly = mapOrigWayEndToCleanedVertex(s.way_start_index, origIndexPerCleanedVertex);
        }
        mapped.push(Object.assign({}, s, startOnly === null ? {} : { way_start_index: startOnly }));
        return;
      }
      const cp = mapOrigWayEndToCleanedVertex(s.way_end_index, origIndexPerCleanedVertex);
      if (cp === null) {
        return;
      }
      let sp = null;
      if (s.way_start_index != null && !Number.isNaN(Number(s.way_start_index))) {
        sp = mapOrigWayEndToCleanedVertex(s.way_start_index, origIndexPerCleanedVertex);
      }
      mapped.push(Object.assign({}, s, sp === null ? { way_end_index: cp } : { way_start_index: sp, way_end_index: cp }));
    });

    return dedupeNavStepsProgressiveWayEnd(mapped);
  }

  function removeDeadEndSegmentsFromGeometry(data, segments) {
    const geom = data && Array.isArray(data.geometry) ? data.geometry : null;
    if (!geom || geom.length < 6 || !segments || !segments.length) {
      return null;
    }
    const cum = cumulativeDistances(geom);
    const ranges = [];
    segments.forEach(function (segment) {
      let lo = nrFindVertexIndexAtOrAfterPath(cum, segment.start_path_m);
      let hi = nrFindVertexIndexAtOrBeforePath(cum, segment.end_path_m);
      lo = Math.max(1, lo);
      hi = Math.min(geom.length - 2, hi);
      if (hi > lo) {
        ranges.push({ lo: lo, hi: hi });
      }
    });
    if (!ranges.length) {
      return null;
    }
    ranges.sort(function (a, b) {
      if (a.lo !== b.lo) {
        return a.lo - b.lo;
      }
      return a.hi - b.hi;
    });
    const mergedRanges = [];
    ranges.forEach(function (range) {
      const last = mergedRanges[mergedRanges.length - 1];
      if (!last || range.lo > last.hi + 1) {
        mergedRanges.push({ lo: range.lo, hi: range.hi });
        return;
      }
      last.hi = Math.max(last.hi, range.hi);
    });
    let removedM = 0;
    mergedRanges.forEach(function (range) {
      removedM += Math.max(0, cum[range.hi] - cum[range.lo]);
    });
    let merged = geom.slice();
    let mergedOrigIdx = geom.map(function (_pt, i) {
      return i;
    });
    mergedRanges
      .slice()
      .sort(function (a, b) {
        return b.lo - a.lo;
      })
      .forEach(function (range) {
        merged = merged.slice(0, range.lo).concat(merged.slice(range.hi + 1));
        mergedOrigIdx = mergedOrigIdx.slice(0, range.lo).concat(mergedOrigIdx.slice(range.hi + 1));
      });
    const cleaned = [];
    const origIndexPerCleanedVertex = [];
    merged.forEach(function (pt, j) {
      const origI = mergedOrigIdx[j];
      if (!cleaned.length || !coordNearM(cleaned[cleaned.length - 1], pt, 2.5)) {
        cleaned.push(pt);
        origIndexPerCleanedVertex.push(origI);
      } else {
        origIndexPerCleanedVertex[cleaned.length - 1] = Math.max(
          origIndexPerCleanedVertex[cleaned.length - 1],
          origI
        );
      }
    });
    if (cleaned.length < 3) {
      return null;
    }
    const oldDist = typeof data.distance === 'number' ? data.distance : cum[cum.length - 1] / 1000;
    const removedKm = removedM / 1000;
    const newDist = Math.max(0.05, oldDist - removedKm);
    const oldDur = typeof data.duration === 'number' ? data.duration : 1;
    const newDur = Math.max(1, Math.round(oldDur * (newDist / Math.max(oldDist, 0.05))));
    const oldSteps = data.navigation && Array.isArray(data.navigation.steps) ? data.navigation.steps : [];
    let newSteps = remapNavigationStepsToCleanedGeometry(oldSteps, origIndexPerCleanedVertex);
    if (
      !newSteps.length &&
      data.instructions &&
      Array.isArray(data.instructions) &&
      data.instructions.length
    ) {
      newSteps = dedupeNavStepsProgressiveWayEnd(
        clientNavStepsFromRawOrsInstructions(data.instructions, origIndexPerCleanedVertex)
      );
    }
    return Object.assign({}, data, {
      geometry: cleaned,
      distance: Math.round(newDist * 100) / 100,
      duration: newDur,
      instructions: [],
      navigation: { steps: newSteps },
      route_segment_edited: true,
      dead_end_segments_removed: mergedRanges.length,
    });
  }

  function sampleLoopWaypointsBearingDeg(a, b) {
    const lat1 = (a[0] * Math.PI) / 180;
    const lat2 = (b[0] * Math.PI) / 180;
    const dLng = ((b[1] - a[1]) * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function sampleLoopWaypointsAngleDelta(a, b) {
    let d = b - a;
    while (d <= -180) {
      d += 360;
    }
    while (d > 180) {
      d -= 360;
    }
    return d;
  }

  function sampleLoopWaypointsFromGeometry(geometry, maxPoints) {
    if (!Array.isArray(geometry) || geometry.length < 3) {
      return [];
    }
    const maxUserPoints = Math.max(3, Math.min(10, maxPoints || 8));
    const cum = cumulativeDistances(geometry);
    const total = cum[cum.length - 1] || 0;
    if (total <= 0) {
      return [];
    }
    const indexedScores = [];
    for (let i = 1; i < geometry.length - 1; i++) {
      const prev = geometry[i - 1];
      const cur = geometry[i];
      const next = geometry[i + 1];
      const inBearing = sampleLoopWaypointsBearingDeg(prev, cur);
      const outBearing = sampleLoopWaypointsBearingDeg(cur, next);
      const delta = Math.abs(sampleLoopWaypointsAngleDelta(inBearing, outBearing));
      if (delta < 24) {
        continue;
      }
      if (cum[i] < 60 || cum[i] > total - 60) {
        continue;
      }
      indexedScores.push({ idx: i, score: delta });
    }
    indexedScores.sort(function (a, b) {
      return b.score - a.score;
    });

    const picked = [0];
    const minSpacingM = Math.max(55, total / 18);
    indexedScores.forEach(function (entry) {
      if (picked.length >= maxUserPoints) {
        return;
      }
      const idx = entry.idx;
      const tooClose = picked.some(function (existingIdx) {
        return Math.abs(cum[existingIdx] - cum[idx]) < minSpacingM;
      });
      if (!tooClose) {
        picked.push(idx);
      }
    });

    const targetCount = Math.max(3, Math.min(maxUserPoints, Math.max(3, Math.floor(total / 900) + 3)));
    for (let i = 1; i < targetCount && picked.length < maxUserPoints; i++) {
      const targetM = (total * i) / targetCount;
      let bestIdx = geometry.length - 1;
      for (let j = 1; j < cum.length; j++) {
        if (cum[j] >= targetM) {
          bestIdx = j;
          break;
        }
      }
      if (bestIdx >= geometry.length - 1) {
        bestIdx = geometry.length - 2;
      }
      if (bestIdx <= 0) {
        bestIdx = 1;
      }
      if (picked[picked.length - 1] !== bestIdx) {
        picked.push(bestIdx);
      }
    }
    if (picked[picked.length - 1] === geometry.length - 1) {
      picked[picked.length - 1] = geometry.length - 2;
    }
    const unique = [];
    picked.sort(function (a, b) {
      return a - b;
    });
    picked.forEach(function (idx) {
      if (unique[unique.length - 1] !== idx) {
        unique.push(idx);
      }
    });
    if (unique.length < 3) {
      unique.length = 0;
      unique.push(0);
      unique.push(Math.max(1, Math.floor((geometry.length - 1) / 3)));
      unique.push(Math.max(2, Math.floor((2 * (geometry.length - 1)) / 3)));
    }
    return unique.slice(0, 10).map(function (idx) {
      return [Number(geometry[idx][0]), Number(geometry[idx][1])];
    });
  }

  /**
   * Fingerprint einer Spike-Liste: identische Sackgassen → identischer String. Wird zwischen
   * den Pässen verglichen, um Endlos-Durchläufe zu erkennen, wenn Reroute den exakt gleichen
   * Stich erneut produziert.
   */
  function spikeFingerprint(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return '';
    }
    return segments
      .map(function (s) {
        const start = Math.round((s.start_path_m || 0) / 25);
        const end = Math.round((s.end_path_m || 0) / 25);
        const away = Math.round((s.max_away_m || 0) / 25);
        return start + '|' + end + '|' + away;
      })
      .sort()
      .join(',');
  }

  /**
   * Geometrische Sperrzonen aus den Schnitt-Spitzen ableiten: jeweils der Mittelpunkt eines
   * geschnittenen Stichs (worst-case Spike-Maximum) plus 1,2× max_away als Radius. Das
   * Wegpunkt-Sampling meidet diese Zonen, damit der Reroute nicht direkt wieder dort entlang läuft.
   */
  function buildSpikeAvoidZones(originalGeometry, segments) {
    if (!Array.isArray(originalGeometry) || originalGeometry.length < 2 || !Array.isArray(segments)) {
      return [];
    }
    const cum = cumulativeDistances(originalGeometry);
    const total = cum[cum.length - 1] || 0;
    const zones = [];
    segments.forEach(function (segment) {
      const mid = ((segment.start_path_m || 0) + (segment.end_path_m || 0)) / 2;
      if (mid <= 0 || mid >= total) {
        return;
      }
      let bestIdx = -1;
      let bestDelta = Infinity;
      for (let i = 0; i < cum.length; i++) {
        const delta = Math.abs(cum[i] - mid);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) {
        return;
      }
      const radius = Math.max(60, 1.2 * (segment.max_away_m || 80));
      zones.push({
        lat: Number(originalGeometry[bestIdx][0]),
        lng: Number(originalGeometry[bestIdx][1]),
        radiusM: radius,
      });
    });
    return zones;
  }

  function pointInsideAnyAvoidZone(latLng, zones) {
    if (!zones || zones.length === 0) {
      return false;
    }
    const ll = L.latLng(latLng[0], latLng[1]);
    for (let i = 0; i < zones.length; i++) {
      if (map.distance(ll, L.latLng(zones[i].lat, zones[i].lng)) <= zones[i].radiusM) {
        return true;
      }
    }
    return false;
  }

  function filterWaypointsAvoidingZones(waypoints, zones) {
    if (!Array.isArray(waypoints) || waypoints.length < 3) {
      return waypoints;
    }
    if (!zones || zones.length === 0) {
      return waypoints;
    }
    const kept = waypoints.filter(function (w, idx) {
      // Start (idx 0) immer behalten, sonst keine geschlossene Schleife mehr.
      if (idx === 0) {
        return true;
      }
      return !pointInsideAnyAvoidZone(w, zones);
    });
    return kept.length >= 3 ? kept : waypoints;
  }

  async function rerouteCleanedLoopCandidate(candidate, sourceData, avoidZones) {
    if (!candidate || !Array.isArray(candidate.geometry) || candidate.geometry.length < 3) {
      return null;
    }
    const rerouteMeta = sourceData && sourceData._nrReroute ? sourceData._nrReroute : null;
    const originalWaypoints =
      rerouteMeta &&
      rerouteMeta.kind === 'waypoints_loop' &&
      Array.isArray(rerouteMeta.waypoints) &&
      rerouteMeta.waypoints.length >= 3
        ? rerouteMeta.waypoints
        : null;
    let waypoints = originalWaypoints || sampleLoopWaypointsFromGeometry(candidate.geometry, 8);
    // Original-Wegpunkte (User-Input) sind sakrosankt — nur generische Samples werden gefiltert.
    if (!originalWaypoints) {
      waypoints = filterWaypointsAvoidingZones(waypoints, avoidZones);
    }
    if (!Array.isArray(waypoints) || waypoints.length < 3) {
      return null;
    }
    const body = {
      loop_from_waypoints: true,
      waypoints: waypoints,
      profil: (rerouteMeta && rerouteMeta.profil) || currentProfile(),
    };
    const rerouted = await fetchJsonWithTimeout(
      apiUrl('api/route.php'),
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      90000
    );
    if (!rerouted.ok || !Array.isArray(rerouted.geometry) || rerouted.geometry.length < 3) {
      throw new Error(rerouted.error || 'Bereinigte Rundkurs-Neuberechnung fehlgeschlagen');
    }
    return Object.assign({}, rerouted, {
      route_segment_edited: true,
      dead_end_segments_removed: candidate.dead_end_segments_removed || 0,
    });
  }

  /**
   * Nach jedem Schnitt können weitere Hin-und-zurück-Äste sichtbar werden, weil sich die
   * Geometrie ändert. Mehrere Durchläufe ersetzen das bisher nötige manuelle Nachklicken.
   *
   * Schutzmechanismen gegen Endlos-Pingpong:
   * 1. Spike-Fingerprint: identische Sackgassen zweimal hintereinander → abbrechen.
   * 2. Qualitäts-Check: wenn Reroute mehr Spikes erzeugt als die geschnittene Geometrie hatte,
   *    wird das Reroute verworfen und die geschnittene Variante (ohne Reroute) zurückgegeben.
   * 3. Distanz-Sanity: wenn Reroute die Strecke um >40 % gegen die geschnittene Geometrie
   *    aufbläht, wird die geschnittene Variante bevorzugt.
   */
  const ROUNDTRIP_DEAD_END_CLEAN_PASSES_DEFAULT = 5;

  async function cleanRoundtripVariant(data, maxPasses) {
    if (!data || !Array.isArray(data.geometry) || data.geometry.length < 6) {
      return data;
    }
    const passes =
      Number.isFinite(Number(maxPasses)) && Number(maxPasses) > 0
        ? Math.max(1, Math.min(ROUNDTRIP_DEAD_END_CLEAN_PASSES_DEFAULT, Math.floor(Number(maxPasses))))
        : ROUNDTRIP_DEAD_END_CLEAN_PASSES_DEFAULT;
    let current = Object.assign({}, data);
    let totalRemovedRanges = 0;
    let lastFingerprint = '';
    for (let pass = 0; pass < passes; pass++) {
      const segments = nrFindReliableNoExitSegments(current.geometry);
      if (!segments.length) {
        return Object.assign({}, current, { dead_end_segments_removed: totalRemovedRanges });
      }
      const fingerprint = spikeFingerprint(segments);
      if (fingerprint && fingerprint === lastFingerprint) {
        // Identische Sackgassen wie im vorigen Pass → Reroute hat sie nicht beseitigt, weitere
        // Iterationen sparen wir uns. Geschnittene Geometrie ist immer noch besser als das Original.
        const cleanedFinal = removeDeadEndSegmentsFromGeometry(current, segments);
        if (cleanedFinal) {
          return Object.assign({}, cleanedFinal, {
            dead_end_segments_removed: totalRemovedRanges + (cleanedFinal.dead_end_segments_removed || 0),
            reroute_skipped_reason: 'spike_fingerprint_repeat',
          });
        }
        return Object.assign({}, current, { dead_end_segments_removed: totalRemovedRanges });
      }
      lastFingerprint = fingerprint;

      const cleaned = removeDeadEndSegmentsFromGeometry(current, segments);
      if (!cleaned) {
        return Object.assign({}, current, { dead_end_segments_removed: totalRemovedRanges });
      }

      const avoidZones = buildSpikeAvoidZones(current.geometry, segments);
      let rerouted;
      try {
        rerouted = await rerouteCleanedLoopCandidate(cleaned, current, avoidZones);
      } catch (err) {
        // Reroute fehlgeschlagen — geschnittene Variante (ohne ORS-Roundtrip) ist immer noch besser.
        return Object.assign({}, cleaned, {
          dead_end_segments_removed: totalRemovedRanges + (cleaned.dead_end_segments_removed || 0),
          reroute_failed: true,
        });
      }
      if (!rerouted) {
        return Object.assign({}, cleaned, {
          dead_end_segments_removed: totalRemovedRanges + (cleaned.dead_end_segments_removed || 0),
        });
      }

      // Qualitäts-Vergleich: Reroute darf nicht mehr Spikes haben als die geschnittene Variante,
      // sonst war der ORS-Call kontraproduktiv (typisch bei Sackgassen-Cluster, das ORS umfährt
      // und dabei eine andere Sackgasse anschneidet).
      const reroutedSpikes = nrFindReliableNoExitSegments(rerouted.geometry);
      const cleanedSpikes = nrFindReliableNoExitSegments(cleaned.geometry);
      const cleanedDistKm = Number(cleaned.distance) || 0;
      const reroutedDistKm = Number(rerouted.distance) || 0;
      const distInflated = cleanedDistKm > 0.5 && reroutedDistKm > cleanedDistKm * 1.4;
      if (reroutedSpikes.length > cleanedSpikes.length || distInflated) {
        return Object.assign({}, cleaned, {
          dead_end_segments_removed: totalRemovedRanges + (cleaned.dead_end_segments_removed || 0),
          reroute_rejected_reason: distInflated ? 'distance_inflated' : 'more_spikes_after_reroute',
        });
      }

      totalRemovedRanges += cleaned.dead_end_segments_removed || 0;
      current = Object.assign({}, rerouted, {
        dead_end_segments_removed: totalRemovedRanges,
      });
    }
    return Object.assign({}, current, {
      dead_end_segments_removed: totalRemovedRanges,
    });
  }

  function paintNoExitAlongRouteGeometry(geom) {
    clearNoExitHighlightLayer();
    const segments = nrFindReliableNoExitSegments(geom);
    const cum = cumulativeDistances(geom);
    noExitLayerGroup = L.layerGroup();
    segments.forEach(function (segment) {
      const slice = nrGeometrySliceByPathMeters(geom, cum, segment.start_path_m, segment.end_path_m);
      if (slice.length < 2) {
        return;
      }
      const latlngs = slice.map(function (p) {
        return L.latLng(p[0], p[1]);
      });
      L.polyline(latlngs, {
        color: '#c0392b',
        weight: 8,
        opacity: 0.93,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(noExitLayerGroup);
    });
    noExitLayerGroup.addTo(map);
    if (routeInfo) {
      routeInfo.textContent =
        segments.length === 0
          ? 'Auf der grünen Route wurden keine verlässlichen Sackgassen-Äste erkannt.'
          : segments.length +
            ' Sackgassen-Abschnitt(e) erkannt: rot markiert sind nur Äste mit klar erkennbarem Hin-und-zurück-Verlauf.';
      routeInfo.hidden = false;
    }
  }

  async function refreshNoExitHighlightLayer() {
    if (!state.noExitHighlightActive) {
      return;
    }
    const geom = state.lastRoute && state.lastRoute.geometry;
    if (geom && geom.length >= 8) {
      paintNoExitAlongRouteGeometry(geom);
      return;
    }
    if (map.getZoom() < NOEXIT_MIN_ZOOM) {
      clearNoExitHighlightLayer();
      if (routeInfo) {
        routeInfo.textContent =
          'Ohne eingezeichnete Route: Sackgassen aus OSM (noexit) — stärker zoomen (ab Zoom ' +
          NOEXIT_MIN_ZOOM +
          '). Mit Route: grüne Linie anzeigen, dann „S“.';
        routeInfo.hidden = false;
      }
      return;
    }
    const b = map.getBounds();
    try {
      const data = await fetchJson(apiUrl('api/overpass_noexit.php'), {
        method: 'POST',
        body: JSON.stringify({
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        }),
      });
      if (!data.ok) {
        throw new Error(data.error || 'Abfrage fehlgeschlagen');
      }
      clearNoExitHighlightLayer();
      noExitLayerGroup = L.layerGroup();
      const ways = data.ways || [];
      ways.forEach(function (w) {
        const c = w.coordinates;
        if (!c || c.length < 2) {
          return;
        }
        const latlngs = c.map(function (p) {
          return L.latLng(p[0], p[1]);
        });
        L.polyline(latlngs, {
          color: '#c0392b',
          weight: 7,
          opacity: 0.92,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(noExitLayerGroup);
      });
      noExitLayerGroup.addTo(map);
      if (routeInfo) {
        if (ways.length === 0) {
          routeInfo.textContent =
            'Karte (ohne grüne Route): keine OSM noexit in diesem Ausschnitt. Route anzeigen für Analyse entlang des Wegs.';
        } else {
          routeInfo.textContent =
            'Karte: ' +
            ways.length +
            ' OSM-Weg(e) mit noexit — beim Verschieben neu. Mit grüner Route: Analyse entlang der Linie.';
        }
        routeInfo.hidden = false;
      }
    } catch (err) {
      clearNoExitHighlightLayer();
      if (routeInfo) {
        routeInfo.textContent = err.message || String(err);
        routeInfo.hidden = false;
      }
    }
  }

  function scheduleNoExitHighlightRefresh() {
    if (!state.noExitHighlightActive) {
      return;
    }
    const g = state.lastRoute && state.lastRoute.geometry;
    if (g && g.length >= 8) {
      return;
    }
    if (noExitMoveTimer) {
      window.clearTimeout(noExitMoveTimer);
    }
    noExitMoveTimer = window.setTimeout(function () {
      noExitMoveTimer = null;
      void refreshNoExitHighlightLayer();
    }, 700);
  }

  function updateNoExitClearButton() {
    const btnClr = document.getElementById('btn-map-noexit-clear');
    if (!btnClr) {
      return;
    }
    const hasRoute = hasRouteGeometryOnMap();
    btnClr.hidden = !hasRoute || !state.noExitHighlightActive;
  }

  function setNoExitHighlightMode(on) {
    state.noExitHighlightActive = !!on;
    const btn = document.getElementById('btn-map-noexit');
    if (btn) {
      btn.setAttribute('aria-pressed', state.noExitHighlightActive ? 'true' : 'false');
      btn.classList.toggle('is-active', state.noExitHighlightActive);
      btn.title = state.noExitHighlightActive
        ? 'Abzweig-/Sackgassen-Markierung ausblenden'
        : 'Mit grüner Route: Abzweig-Schleifen im Rundkurs markieren; sonst OSM noexit in der Karte';
      btn.setAttribute(
        'aria-label',
        state.noExitHighlightActive
          ? 'Abzweig- und Sackgassen-Markierung ausblenden'
          : 'Abzweig-Schleifen entlang der grünen Route oder OSM noexit in der Kartenansicht'
      );
    }
    updateNoExitClearButton();
    if (!state.noExitHighlightActive) {
      if (noExitMoveTimer) {
        window.clearTimeout(noExitMoveTimer);
        noExitMoveTimer = null;
      }
      clearNoExitHighlightLayer();
      if (routeInfo) {
        routeInfo.hidden = true;
        routeInfo.textContent = '';
      }
    }
    updatePointStatus();
    if (state.noExitHighlightActive) {
      void refreshNoExitHighlightLayer();
    }
  }

  function setNoExitButtonActiveState(on) {
    state.noExitHighlightActive = !!on;
    const btn = document.getElementById('btn-map-noexit');
    if (btn) {
      btn.setAttribute('aria-pressed', state.noExitHighlightActive ? 'true' : 'false');
      btn.classList.toggle('is-active', state.noExitHighlightActive);
      btn.title = state.noExitHighlightActive
        ? 'Abzweig-/Sackgassen-Markierung ausblenden'
        : 'Mit grüner Route: Abzweig-Schleifen im Rundkurs markieren; sonst OSM noexit in der Karte';
      btn.setAttribute(
        'aria-label',
        state.noExitHighlightActive
          ? 'Abzweig- und Sackgassen-Markierung ausblenden'
          : 'Abzweig-Schleifen entlang der grünen Route oder OSM noexit in der Kartenansicht'
      );
    }
    updateNoExitClearButton();
    updatePointStatus();
  }

  function autoDetectNoExitAlongRoute(data) {
    const geom = data && Array.isArray(data.geometry) ? data.geometry : null;
    if (!geom || geom.length < 8) {
      return;
    }
    const segments = nrFindReliableNoExitSegments(geom);
    if (!segments.length) {
      if (state.noExitHighlightActive) {
        clearNoExitHighlightLayer();
        setNoExitButtonActiveState(false);
      }
      return;
    }
    setNoExitButtonActiveState(true);
    paintNoExitAlongRouteGeometry(geom);
  }

  async function removeAutoDetectedDeadEndsFromRoute() {
    const data = state.lastRoute;
    if (!data || !Array.isArray(data.geometry) || data.geometry.length < 6) {
      setNoExitHighlightMode(false);
      return;
    }
    let current = data;
    let totalRemovedRanges = 0;
    let lastPatched = null;
    let lastFingerprint = '';
    for (let pass = 0; pass < ROUNDTRIP_DEAD_END_CLEAN_PASSES_DEFAULT; pass++) {
      const segments = nrFindReliableNoExitSegments(current.geometry);
      if (!segments.length) {
        break;
      }
      const fingerprint = spikeFingerprint(segments);
      if (fingerprint && fingerprint === lastFingerprint) {
        // Reroute hat dieselbe Sackgasse erneut produziert — die geschnittene Variante (ohne Reroute)
        // ist immer noch besser als das Original und wird hier finalisiert.
        const cleanedFinal = removeDeadEndSegmentsFromGeometry(current, segments);
        if (cleanedFinal) {
          totalRemovedRanges += cleanedFinal.dead_end_segments_removed || 0;
          lastPatched = Object.assign({}, cleanedFinal, {
            dead_end_segments_removed: totalRemovedRanges,
            reroute_skipped_reason: 'spike_fingerprint_repeat',
          });
        }
        break;
      }
      lastFingerprint = fingerprint;

      const next = removeDeadEndSegmentsFromGeometry(current, segments);
      if (!next) {
        break;
      }
      const avoidZones = buildSpikeAvoidZones(current.geometry, segments);
      let rerouted;
      try {
        rerouted = await rerouteCleanedLoopCandidate(next, current, avoidZones);
      } catch (err) {
        // ORS-Reroute fehlgeschlagen — geschnittene Variante als Endergebnis akzeptieren.
        totalRemovedRanges += next.dead_end_segments_removed || 0;
        lastPatched = Object.assign({}, next, {
          dead_end_segments_removed: totalRemovedRanges,
          reroute_failed: true,
        });
        break;
      }
      if (!rerouted) {
        totalRemovedRanges += next.dead_end_segments_removed || 0;
        lastPatched = Object.assign({}, next, {
          dead_end_segments_removed: totalRemovedRanges,
        });
        break;
      }

      // Reroute-Qualitätsvergleich: weniger oder gleich viele Spikes erforderlich, sonst ist
      // der ORS-Reroute kontraproduktiv (kann passieren, wenn ORS einen Cluster umfährt und
      // dabei eine andere Sackgasse trifft). Distanz-Sanity verhindert maßlose Aufblähung.
      const reroutedSpikes = nrFindReliableNoExitSegments(rerouted.geometry);
      const cleanedSpikes = nrFindReliableNoExitSegments(next.geometry);
      const cleanedDistKm = Number(next.distance) || 0;
      const reroutedDistKm = Number(rerouted.distance) || 0;
      const distInflated = cleanedDistKm > 0.5 && reroutedDistKm > cleanedDistKm * 1.4;
      if (reroutedSpikes.length > cleanedSpikes.length || distInflated) {
        totalRemovedRanges += next.dead_end_segments_removed || 0;
        lastPatched = Object.assign({}, next, {
          dead_end_segments_removed: totalRemovedRanges,
          reroute_rejected_reason: distInflated ? 'distance_inflated' : 'more_spikes_after_reroute',
        });
        break;
      }

      totalRemovedRanges += next.dead_end_segments_removed || 0;
      current = Object.assign({}, rerouted, {
        dead_end_segments_removed: totalRemovedRanges,
      });
      lastPatched = current;
    }
    if (!lastPatched) {
      if (routeInfo) {
        const tried = nrFindReliableNoExitSegments(data.geometry).length > 0;
        routeInfo.textContent = tried
          ? 'Die erkannten Sackgassen konnten nicht sicher aus der Route entfernt werden.'
          : 'Keine automatisch erkannten Sackgassen zum Entfernen gefunden.';
        routeInfo.hidden = false;
      }
      setNoExitHighlightMode(false);
      return;
    }
    const patched = Object.assign({}, lastPatched, {
      dead_end_segments_removed: totalRemovedRanges,
    });
    setRouteBusyVisible(true);
    updateRouteBusyProgress({
      title: 'Sackgassen werden entfernt',
      detail: 'Markierte Äste werden ersetzt und die Schleife wird neu verbunden.',
      indeterminate: true,
      stage: 'clean',
    });
    try {
      clearRouteLayer();
      clearNoExitHighlightLayer();
      state.lastRoute = null;
      setNoExitHighlightMode(false);
      await finalizeRouteOnMap(patched);
      if (routeInfo) {
        routeInfo.textContent =
          patched.dead_end_segments_removed +
          ' markierte Sackgassen-Abschnitt(e) wurden aus der Route entfernt.';
        routeInfo.hidden = false;
      }
    } finally {
      setRouteBusyVisible(false);
      resetRouteBusyBar();
      if (routeBusyDetail) {
        routeBusyDetail.textContent = '';
      }
    }
  }

  function coordNearM(a, b, maxM) {
    return map.distance(L.latLng(a[0], a[1]), L.latLng(b[0], b[1])) <= maxM;
  }

  function mergeRouteGeoms(prefix, bridgeGeom, suffix) {
    const merged = prefix.slice();
    for (let k = 0; k < bridgeGeom.length; k++) {
      if (k === 0 && merged.length > 0 && coordNearM(merged[merged.length - 1], bridgeGeom[k], 2.5)) {
        continue;
      }
      merged.push([bridgeGeom[k][0], bridgeGeom[k][1]]);
    }
    for (let k = 0; k < suffix.length; k++) {
      if (k === 0 && merged.length > 0 && coordNearM(merged[merged.length - 1], suffix[k], 2.5)) {
        continue;
      }
      merged.push([suffix[k][0], suffix[k][1]]);
    }
    return merged;
  }

  function closestSegmentOnRoute(click, geometry) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < geometry.length - 1; i++) {
      const a = L.latLng(geometry[i][0], geometry[i][1]);
      const b = L.latLng(geometry[i + 1][0], geometry[i + 1][1]);
      const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
      const d = Math.min(map.distance(click, a), map.distance(click, b), map.distance(click, mid));
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return { segIndex: bestI, distM: bestD };
  }

  function findStepIndexForVertex(steps, v) {
    for (let s = 0; s < steps.length; s++) {
      const end = steps[s].way_end_index;
      if (end == null || Number.isNaN(Number(end))) {
        continue;
      }
      if (v <= Number(end)) {
        return s;
      }
    }
    return Math.max(0, steps.length - 1);
  }

  function computeRemoveRangeFromStep(steps, si, nCoords) {
    const prevEnd = si > 0 ? Number(steps[si - 1].way_end_index) : -1;
    const hi = Number(steps[si].way_end_index);
    if (Number.isNaN(hi)) {
      return null;
    }
    const lo = prevEnd + 1;
    if (lo < 1 || hi > nCoords - 2 || hi < lo) {
      return null;
    }
    return { lo: lo, hi: hi };
  }

  function computeRemoveRangeVertexWindow(v, nCoords) {
    const r = ROUTE_REMOVE_VERTEX_HALFSPAN;
    let lo = Math.max(1, v - r);
    let hi = Math.min(nCoords - 2, v + r);
    if (hi <= lo) {
      lo = Math.max(1, v - 2);
      hi = Math.min(nCoords - 2, v + 2);
    }
    if (hi <= lo) {
      return null;
    }
    return { lo: lo, hi: hi };
  }

  function onRoutePolylineRemoveClick(e) {
    if (!state.routeSegmentRemoveActive || !state.lastRoute) {
      return;
    }
    if (e && e.originalEvent) {
      L.DomEvent.stop(e.originalEvent);
    }
    void tryRemoveRouteSegmentAt(e.latlng);
  }

  async function tryRemoveRouteSegmentAt(clickLatLng) {
    const data = state.lastRoute;
    if (!data || !data.geometry || data.geometry.length < 6) {
      return;
    }
    if (routeInfo) {
      routeInfo.hidden = true;
      routeInfo.textContent = '';
    }
    const geom = data.geometry;
    const hit = closestSegmentOnRoute(clickLatLng, geom);
    const maxClick = state.routeSegmentRemoveActive ? ROUTE_REMOVE_MAX_CLICK_EDIT_M : ROUTE_REMOVE_MAX_CLICK_M;
    if (hit.distM > maxClick) {
      if (routeInfo) {
        routeInfo.textContent = 'Tippen Sie näher auf die grüne Linie.';
        routeInfo.hidden = false;
      }
      return;
    }
    const v = Math.min(geom.length - 2, hit.segIndex + 1);
    const steps = data.navigation && Array.isArray(data.navigation.steps) ? data.navigation.steps : [];
    let range = null;
    if (steps.length > 0 && steps[0].way_end_index != null) {
      const si = findStepIndexForVertex(steps, v);
      range = computeRemoveRangeFromStep(steps, si, geom.length);
    }
    if (!range) {
      range = computeRemoveRangeVertexWindow(v, geom.length);
    }
    if (!range) {
      if (routeInfo) {
        routeInfo.textContent = 'Dieser Abschnitt kann hier nicht ersetzt werden.';
        routeInfo.hidden = false;
      }
      return;
    }
    const lo = range.lo;
    const hi = range.hi;
    void executeRouteSegmentBridge(data, lo, hi);
  }

  async function executeRouteSegmentBridge(data, lo, hi) {
    const geom = data.geometry;
    const connectA = geom[lo - 1];
    const connectB = geom[hi + 1];
    const cd = cumulativeDistances(geom);
    const removedM = Math.max(0, cd[hi] - cd[lo]);
    const removedKm = removedM / 1000;
    const body = {
      start: [connectA[0], connectA[1]],
      ziel: [connectB[0], connectB[1]],
      profil: currentProfile(),
    };
    const md = maxDetourKmFromUi();
    if (md > 0) {
      body.max_detour_km = md;
    }
    setRouteBusyVisible(true);
    updateRouteBusyProgress({
      title: 'Alternative wird gesucht',
      detail: 'Der markierte Abschnitt wird umfahren und wieder in die Route eingesetzt.',
      indeterminate: true,
      stage: 'route',
    });
    routeError.hidden = true;
    if (routeInfo) {
      routeInfo.hidden = true;
      routeInfo.textContent = '';
    }
    try {
      const bridge = await fetchJson(apiUrl('api/route.php'), {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!bridge.ok || !bridge.geometry || bridge.geometry.length < 2) {
        throw new Error(bridge.error || 'Ersatzroute fehlgeschlagen');
      }
      const prefix = geom.slice(0, lo);
      const suffix = geom.slice(hi + 1);
      const merged = mergeRouteGeoms(prefix, bridge.geometry, suffix);
      if (merged.length < 3) {
        throw new Error('Ergebnisroute zu kurz.');
      }
      const oldDist = typeof data.distance === 'number' ? data.distance : 0;
      const oldDur = typeof data.duration === 'number' ? data.duration : 1;
      const bridgeKm = typeof bridge.distance === 'number' ? bridge.distance : 0;
      const newDist = Math.max(0.05, oldDist - removedKm + bridgeKm);
      const newDur = Math.max(
        1,
        Math.round(oldDur - (removedKm / (oldDist || 1)) * oldDur + (bridge.duration || 0))
      );
      let nat = data.surface_nature;
      let asph = data.asphalt;
      if (
        typeof bridge.surface_nature === 'number' &&
        typeof bridge.asphalt === 'number' &&
        newDist > 0.01
      ) {
        const wKeep = Math.max(0, oldDist - removedKm) / newDist;
        const wBr = bridgeKm / newDist;
        nat = wKeep * (data.surface_nature || 0) + wBr * bridge.surface_nature;
        asph = wKeep * (data.asphalt || 0) + wBr * bridge.asphalt;
      }
      const patched = Object.assign({}, data, {
        geometry: merged,
        distance: Math.round(newDist * 100) / 100,
        duration: newDur,
        surface_nature: Math.round(nat * 10) / 10,
        asphalt: Math.round(asph * 10) / 10,
        surface_segments: [],
        instructions: [],
        navigation: { steps: [] },
        route_segment_edited: true,
      });
      clearRouteLayer();
      await finalizeRouteOnMap(patched);
    } catch (e) {
      routeError.textContent = e.message || String(e);
      routeError.hidden = false;
    } finally {
      setRouteBusyVisible(false);
      resetRouteBusyBar();
      if (routeBusyDetail) {
        routeBusyDetail.textContent = '';
      }
    }
  }

  function fmtKm(km) {
    if (km == null || Number.isNaN(km)) return '–';
    return km.toFixed(1).replace('.', ',') + ' km';
  }

  function fmtDeDateTime(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    let d = new Date(raw);
    if (Number.isNaN(d.getTime()) && raw.includes(' ') && !raw.includes('T')) {
      // MySQL TIMESTAMP often comes as "YYYY-MM-DD HH:MM:SS"
      d = new Date(raw.replace(' ', 'T'));
    }
    if (Number.isNaN(d.getTime())) return raw;
    try {
      return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    } catch (e0) {
      return raw;
    }
  }

  function buildSavedRouteTitleSuggestion(routeData) {
    const isRoundtrip = !!(routeData && routeData.roundtrip_mode);
    const startPlace = typeof startPlaceEl !== 'undefined' && startPlaceEl ? String(startPlaceEl.value || '').trim() : '';
    const startStreet = typeof startStreetEl !== 'undefined' && startStreetEl ? String(startStreetEl.value || '').trim() : '';
    const goalPlace = typeof goalPlaceEl !== 'undefined' && goalPlaceEl ? String(goalPlaceEl.value || '').trim() : '';
    const goalStreet = typeof goalStreetEl !== 'undefined' && goalStreetEl ? String(goalStreetEl.value || '').trim() : '';

    const startAddress = [startPlace, startStreet].filter(Boolean).join(', ');
    const goalAddress = [goalPlace, goalStreet].filter(Boolean).join(', ');

    const placePart = isRoundtrip
      ? startAddress || startPlace || 'Rundkurs'
      : [
          startAddress || startPlace || 'Start',
          goalAddress || goalPlace || 'Ziel',
        ]
          .filter(Boolean)
          .join(' – ');

    const km = routeData && Number.isFinite(Number(routeData.distance)) ? Number(routeData.distance) : null;
    const kmPart = km != null ? fmtKm(km) : '';

    const profileLabel =
      (typeof profileCurrentValue !== 'undefined' &&
      profileCurrentValue &&
      String(profileCurrentValue.textContent || '').trim() &&
      String(profileCurrentValue.textContent || '').trim() !== '–'
        ? String(profileCurrentValue.textContent || '').trim()
        : '');
    const profilePart = profileLabel ? profileLabel : '';

    const when = fmtDeDateTime(new Date().toISOString());
    return [placePart, kmPart, profilePart, when].filter(Boolean).join(' · ');
  }

  function fmtMin(m) {
    if (m == null) return '–';
    return m + ' min';
  }

  function fmtPct(p) {
    if (p == null) return '–';
    return p.toFixed(0).replace('.', ',') + ' %';
  }

  function setHintMessage(el, text) {
    if (!el) {
      return;
    }
    if (text) {
      el.textContent = text;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function setRegistrationApiKeyHint() {
    if (!authMessage) {
      return;
    }
    setHintMessage(authMessage, 'Konto angelegt. Bitte bestätigen Sie Ihre E-Mail-Adresse.');
  }

  function routeKindFromRouteData(data) {
    return data && data.roundtrip_mode ? 'roundtrip' : 'point_to_point';
  }

  function routeSnapshotForSave() {
    if (!state.lastRoute || !state.lastRoute.geometry) {
      return null;
    }
    return {
      profile: currentProfile(),
      start: state.start ? [state.start.lat, state.start.lng] : null,
      goal: state.goal ? [state.goal.lat, state.goal.lng] : null,
      vias: state.vias.map(function (v) {
        return [v.lat, v.lng];
      }),
      routeData: state.lastRoute,
    };
  }

  function applySavedRoutePoints(snapshot) {
    if (snapshot.start && Array.isArray(snapshot.start) && snapshot.start.length >= 2) {
      setStart(L.latLng(snapshot.start[0], snapshot.start[1]));
    }
    if (snapshot.goal && Array.isArray(snapshot.goal) && snapshot.goal.length >= 2) {
      setGoal(L.latLng(snapshot.goal[0], snapshot.goal[1]));
    }
    if (Array.isArray(snapshot.vias)) {
      snapshot.vias.forEach(function (v) {
        if (Array.isArray(v) && v.length >= 2) {
          addVia(L.latLng(v[0], v[1]));
        }
      });
    }
  }

  /** Marker an tatsächliche Linien-Enden (z. B. Rundkurs ohne goal im Snapshot; vermeidet Versatz zur Polylinie). */
  function syncMarkersToRouteGeometry(routeData) {
    if (!routeData || !Array.isArray(routeData.geometry) || routeData.geometry.length < 2) {
      return;
    }
    const g = routeData.geometry;
    const a = g[0];
    const b = g[g.length - 1];
    if (Array.isArray(a) && a.length >= 2) {
      setStart(L.latLng(a[0], a[1]));
    }
    if (Array.isArray(b) && b.length >= 2) {
      setGoal(L.latLng(b[0], b[1]));
    }
  }

  function nrTopBarUserLabel(user) {
    if (!user || typeof user !== 'object') {
      return '';
    }
    const dn = typeof user.display_name === 'string' ? user.display_name.trim() : '';
    if (dn !== '') {
      return dn;
    }
    const em = typeof user.email === 'string' ? user.email.trim() : '';
    if (em !== '') {
      const at = em.indexOf('@');
      return at > 0 ? em.slice(0, at) : em;
    }
    if (user.id != null && Number.isFinite(Number(user.id))) {
      return 'Nutzer #' + String(Math.floor(Number(user.id)));
    }
    return 'Angemeldet';
  }

  function updateAuthUi() {
    const user = state.currentUser;
    if (authDialog) {
      authDialog.hidden = !!user;
      authDialog.setAttribute('aria-hidden', user ? 'true' : 'false');
    }
    if (authGuest) {
      authGuest.hidden = !!user;
    }
    if (authUserBox) {
      authUserBox.hidden = !user;
    }
    if (authUserLabel) {
      authUserLabel.textContent = user
        ? 'Angemeldet als ' + String(user.display_name || user.email) + ' · ' + String(user.email || '')
        : '';
    }
    if (panelUserSummary) {
      panelUserSummary.hidden = !user;
    }
    if (panelUserName) {
      panelUserName.textContent = user ? nrTopBarUserLabel(user) : '';
    }
    if (panelFitnessPoints) {
      const points = user && Number.isFinite(Number(user.fitness_points)) ? Number(user.fitness_points) : 0;
      panelFitnessPoints.textContent = String(Math.max(0, Math.floor(points)));
    }
    if (topBarUserMeta) {
      if (user) {
        topBarUserMeta.removeAttribute('hidden');
        topBarUserMeta.hidden = false;
        topBarUserMeta.style.display = '';
      } else {
        topBarUserMeta.setAttribute('hidden', '');
        topBarUserMeta.hidden = true;
        topBarUserMeta.style.display = 'none';
      }
    }
    if (topBarUserName) {
      topBarUserName.textContent = user ? nrTopBarUserLabel(user) : '';
    }
    if (topBarFitnessPoints) {
      const pointsTb = user && Number.isFinite(Number(user.fitness_points)) ? Number(user.fitness_points) : 0;
      topBarFitnessPoints.textContent = String(Math.max(0, Math.floor(pointsTb)));
    }
    if (!user && authEmail && kontoDialog && !kontoDialog.hidden) {
      window.setTimeout(function () {
        if (!authDisplayNameWrap || authDisplayNameWrap.hidden) {
          authEmail.focus();
        }
      }, 0);
    }
    const canSave = !!(user && state.lastRoute && state.lastRoute.geometry);
    const btnSave = document.getElementById('btn-route-save');
    if (btnSave) {
      btnSave.disabled = !canSave;
    }
    const btnRefresh = document.getElementById('btn-route-refresh');
    if (btnRefresh) {
      btnRefresh.disabled = !user;
    }
    document.querySelectorAll('input[name="profil"]').forEach(function (radio) {
      radio.disabled = !user;
    });
    const maxDetour = document.getElementById('max-detour-km');
    if (maxDetour) {
      maxDetour.disabled = !user;
    }
    const rtKm = document.getElementById('rt-radius-km');
    if (rtKm) {
      rtKm.disabled = !user;
    }
    const rtVar = document.getElementById('rt-variant-count');
    if (rtVar) {
      rtVar.disabled = !user;
    }
    if (orsApiKeyInput) {
      orsApiKeyInput.readOnly = !user;
    }
    if (btnOrsApiKeySave) {
      btnOrsApiKeySave.disabled = !user;
    }
    if (navDebugLogEnabledInput) {
      navDebugLogEnabledInput.disabled = !user;
    }
    if (btnSavedRoutesManage) {
      btnSavedRoutesManage.disabled = !user;
    }
    ['btn-geocode-start', 'btn-geocode-start-address', 'btn-geocode-goal', 'btn-goal-here', 'btn-rt-start-gps'].forEach(function (id) {
      const b = document.getElementById(id);
      if (b) {
        b.disabled = !user;
      }
    });
    [startPlaceEl, startStreetEl, goalPlaceEl, goalStreetEl].forEach(function (inp) {
      if (inp) {
        inp.readOnly = !user;
      }
    });
    ['btn-map-noexit', 'btn-map-noexit-clear', 'btn-map-surface'].forEach(function (id) {
      const fab = document.getElementById(id);
      if (fab) {
        fab.disabled = !user;
      }
    });
    if (!user && savedRoutesList) {
      savedRoutesList.innerHTML = '';
    }
    if (!user) {
      setHintMessage(savedRoutesMessage, 'Zum Speichern und Laden bitte anmelden.');
    }
  }

  let fitnessStarHideTimer = null;
  let panelFitnessBumpTimer = null;

  function bumpPanelFitnessBadge() {
    const badges = document.querySelectorAll('.panel-fitness-badge, .top-bar-fitness-pill');
    if (!badges.length) {
      return;
    }
    badges.forEach(function (el) {
      el.classList.remove('is-bump');
      void el.offsetWidth;
      el.classList.add('is-bump');
    });
    window.clearTimeout(panelFitnessBumpTimer);
    panelFitnessBumpTimer = window.setTimeout(function () {
      badges.forEach(function (el) {
        el.classList.remove('is-bump');
      });
      panelFitnessBumpTimer = null;
    }, 900);
  }

  function showFitnessStarReward(delta, totalKmThisRide) {
    const overlay = document.getElementById('fitness-star-overlay');
    const cap = overlay ? overlay.querySelector('.fitness-star-caption') : null;
    if (!overlay || !cap) {
      return;
    }
    const n = Math.max(1, Math.min(20, Math.floor(Number(delta)) || 1));
    const total = Number.isFinite(Number(totalKmThisRide)) ? Math.max(0, Math.floor(Number(totalKmThisRide))) : null;
    const pointsWord = n === 1 ? 'Fitnesspunkt' : 'Fitnesspunkte';
    if (total != null && total > 0) {
      cap.textContent =
        n === 1
          ? 'Wieder 1 km gefahren – auf dieser Strecke jetzt insgesamt ' + total + ' km. +1 ' + pointsWord + '.'
          : 'Schon ' + n + ' km gefahren – auf dieser Strecke jetzt insgesamt ' + total + ' km. +' + n + ' ' + pointsWord + '.';
    } else {
      cap.textContent = n === 1 ? 'Wieder 1 km gefahren. +1 ' + pointsWord + '.' : 'Schon ' + n + ' km gefahren. +' + n + ' ' + pointsWord + '.';
    }
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.remove('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');
    window.clearTimeout(fitnessStarHideTimer);
    fitnessStarHideTimer = window.setTimeout(function () {
      overlay.classList.remove('is-visible');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      fitnessStarHideTimer = null;
    }, 4200);
  }

  function triggerFitnessFirework(delta) {
    const n = Math.max(1, Math.min(6, Math.floor(Number(delta)) || 1));
    const confettiFn = typeof window.confetti === 'function' ? window.confetti : null;
    if (!confettiFn) {
      return;
    }
    // Kleines, unaufdringliches Feuerwerk (oben/mittig).
    const base = {
      particleCount: 22,
      spread: 64,
      startVelocity: 22,
      gravity: 1.0,
      scalar: 0.75,
      ticks: 120,
      origin: { x: 0.5, y: 0.18 },
      colors: ['#ffbf75', '#f0a55f', '#ffe59a', '#69b97c', '#7ecbff'],
    };
    // Bei mehreren Punkten: ein paar kurze Bursts nacheinander.
    for (let i = 0; i < n; i++) {
      window.setTimeout(function () {
        confettiFn(Object.assign({}, base, { angle: 90 }));
      }, i * 180);
    }
  }

  /**
   * Server erlaubt max. 10 Punkte pro Request — bei mehreren Kilometern in einem Schritt mehrfach speichern.
   */
  async function addFitnessPoints(totalDelta) {
    if (!state.currentUser) {
      return null;
    }
    let remaining = Number.isFinite(Number(totalDelta)) ? Math.max(0, Math.floor(Number(totalDelta))) : 0;
    if (remaining <= 0) {
      return state.currentUser;
    }
    let lastUser = state.currentUser;
    while (remaining > 0) {
      const chunk = Math.min(10, remaining);
      remaining -= chunk;
      const previousUser = state.currentUser;
      const optimistic = Object.assign({}, state.currentUser, {
        fitness_points: Math.max(0, Number(state.currentUser.fitness_points || 0)) + chunk,
      });
      state.currentUser = optimistic;
      updateAuthUi();
      let data;
      try {
        data = await fetchJson(apiUrl('api/fitness_points.php'), {
          method: 'POST',
          body: JSON.stringify({ delta: chunk }),
        });
      } catch (err) {
        state.currentUser = previousUser;
        updateAuthUi();
        throw err;
      }
      if (!data.ok || !data.user) {
        state.currentUser = previousUser;
        updateAuthUi();
        throw new Error(data.error || 'Fitnesspunkte konnten nicht gespeichert werden.');
      }
      state.currentUser = data.user;
      lastUser = data.user;
      updateAuthUi();
    }
    return lastUser;
  }

  function showInitialAuthNotice() {
    if (!AUTH_NOTICE) {
      return;
    }
    if (state.currentUser) {
      setHintMessage(authPanelMessage, AUTH_NOTICE);
    } else {
      setHintMessage(authMessage, AUTH_NOTICE);
    }
  }

  function applyUserSettings(settings) {
    const cfg = settings && typeof settings === 'object' ? settings : {};
    try {
      window.NR_USER_SETTINGS = cfg;
    } catch (e0) {
      /* ignore */
    }
    if (orsApiKeyInput) {
      orsApiKeyInput.value = typeof cfg.orsApiKey === 'string' ? cfg.orsApiKey : '';
    }
    if (navDebugLogEnabledInput) {
      const enabled = !!cfg.navDebugLogEnabled;
      navDebugLogEnabledInput.checked = enabled;
      window.NR_NAV_DEBUG_LOG_ENABLED = enabled;
    }
    try {
      const e = typeof cfg.ttsEngine === 'string' ? String(cfg.ttsEngine).toLowerCase() : '';
      if (e === 'piper' || e === 'system') {
        setTtsEnginePref(e);
        const btnP = document.getElementById('tts-engine-global-piper');
        const btnS = document.getElementById('tts-engine-global-system');
        if (btnP && btnS) {
          const isSystem = e === 'system';
          btnP.setAttribute('aria-pressed', isSystem ? 'false' : 'true');
          btnS.setAttribute('aria-pressed', isSystem ? 'true' : 'false');
        }
      }
    } catch (e0) {
      /* ignore */
    }
  }

  async function loadUserSettings() {
    if (!state.currentUser) {
      return;
    }
    const data = await fetchGetJson(apiUrl('api/settings.php'));
    if (!data.ok) {
      throw new Error(data.error || 'Einstellungen konnten nicht geladen werden.');
    }
    applyUserSettings(data.settings || {});
  }

  function clearUserScopedClientState() {
    if (window.NRNavigation) {
      window.NRNavigation.close();
      window.NRNavigation.setRouteData(null);
    }
    clearAll();
    applyUserSettings({});
    if (savedRoutesList) {
      savedRoutesList.innerHTML = '';
    }
    if (savedRouteTitle) {
      savedRouteTitle.value = '';
    }
    closeSavedRoutesManageDialog();
    closeSavedRouteDeleteConfirm();
    closeSavedRouteRenameDialog();
    closeNavFeedbackDialog();
    setHintMessage(savedRoutesMessage, '');
  }

  function clearAuthFields(options) {
    const opts = options || {};
    if (authDisplayName && opts.clearDisplayName) {
      authDisplayName.value = '';
    }
    if (authRegisterApiKey && opts.clearApiKey) {
      authRegisterApiKey.value = '';
    }
    if (authEmail && opts.clearEmail) {
      authEmail.value = '';
    }
    if (authPassword) {
      authPassword.value = '';
    }
  }

  function setAuthRegisterMode(on) {
    const registerMode = WP_AUTH ? false : !!on;
    if (authDisplayNameWrap) {
      authDisplayNameWrap.hidden = !registerMode;
    }
    if (authRegisterApiWrap) {
      authRegisterApiWrap.hidden = !registerMode;
    }
    if (!registerMode && authDisplayName) {
      authDisplayName.value = '';
    }
    if (!registerMode && authRegisterApiKey) {
      authRegisterApiKey.value = '';
    }
    if (authDialogTitle) {
      authDialogTitle.textContent = registerMode ? 'Neu registrieren' : 'Anmelden';
    }
    if (authDialogCopy) {
      authDialogCopy.textContent = registerMode
        ? 'Erstellen Sie Ihr Konto. Der API-Key ist optional, wird aber für Routing benötigt und kann direkt mit gespeichert werden.'
        : WP_AUTH
          ? AUTH_DIALOG_COPY_LOGIN_WP
          : AUTH_DIALOG_COPY_LOGIN_LOCAL;
    }
    if (authEmail) {
      authEmail.setAttribute('autocomplete', registerMode ? 'email' : 'username');
    }
    if (authPassword) {
      authPassword.setAttribute('autocomplete', registerMode ? 'new-password' : 'current-password');
    }
    if (btnAuthLogin) {
      btnAuthLogin.hidden = registerMode;
    }
    if (btnAuthRegister) {
      btnAuthRegister.hidden = !registerMode;
    }
    if (btnAuthToggleRegister) {
      btnAuthToggleRegister.textContent = registerMode ? 'Zur Anmeldung' : 'Neu registrieren';
    }
    if (btnAuthForgot) {
      btnAuthForgot.hidden = registerMode;
    }
  }

  function renderSavedRoutes(routes) {
    if (!savedRoutesList) {
      return;
    }
    savedRoutesList.innerHTML = '';
    routes.forEach(function (route) {
      const li = document.createElement('li');
      li.className = 'saved-route-item';
      const head = document.createElement('div');
      head.className = 'saved-route-head';
      const title = document.createElement('div');
      title.className = 'saved-route-title';
      title.textContent = route.title || 'Ohne Titel';
      const meta = document.createElement('div');
      meta.className = 'saved-route-meta';
      const updatedDe = fmtDeDateTime(route.updated_at || '');
      meta.textContent =
        [route.profile || '–', fmtKm(route.distance_km), fmtMin(route.duration_min), updatedDe]
          .filter(Boolean)
          .join(' · ');
      head.appendChild(title);
      li.appendChild(head);
      li.appendChild(meta);
      const actions = document.createElement('div');
      actions.className = 'saved-route-actions';
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'btn btn-secondary';
      renameBtn.textContent = 'Umbenennen';
      renameBtn.addEventListener('click', function () {
        openSavedRouteRenameDialog(route.id, route.title || '');
      });
      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn-secondary';
      loadBtn.textContent = 'Laden';
      loadBtn.addEventListener('click', async function () {
        try {
          setRouteBusyVisible(true);
          resetRouteBusyBar();
          configureRouteBusyActions({ show: false });
          updateRouteBusyProgress({
            title: 'Gespeicherte Route wird geladen',
            detail: 'Route wird aus deinem Konto geholt.',
            indeterminate: false,
            progress: 8,
            stage: 'route',
          });
          const data = await fetchGetJson(apiUrl('api/saved_routes.php?id=' + encodeURIComponent(String(route.id))));
          if (!data.ok || !data.route || !data.route.payload) {
            throw new Error(data.error || 'Route konnte nicht geladen werden.');
          }
          updateRouteBusyProgress({
            title: 'Gespeicherte Route wird geladen',
            detail: 'Punkte und Wegverlauf werden geprüft.',
            indeterminate: false,
            progress: 24,
            stage: 'roundtrip',
          });
          clearAll();
          const loadedPayload = data.route.payload;
          const profileFromSave =
            (data.route && typeof data.route.profile === 'string' && data.route.profile) ||
            (loadedPayload && typeof loadedPayload.profile === 'string' && loadedPayload.profile) ||
            '';

          // Wichtig: nicht nur internal setzen, sondern UI/Label + LocalStorage synchronisieren.
          if (typeof NRProfile !== 'undefined' && NRProfile && typeof NRProfile.apply === 'function') {
            NRProfile.apply(profileFromSave || 'natur', { skipServer: true });
          } else {
            setCurrentProfile(profileFromSave || 'natur');
          }
          const loadedRoute = loadedPayload.routeData;
          if (!loadedRoute || !Array.isArray(loadedRoute.geometry) || loadedRoute.geometry.length < 2) {
            throw new Error('Gespeicherte Route hat keine gültige Geometrie.');
          }
          updateRouteBusyProgress({
            title: 'Gespeicherte Route wird geladen',
            detail: 'Die Strecke wird auf die Karte gelegt.',
            indeterminate: false,
            progress: 38,
            stage: 'map',
          });
          applySavedRoutePoints(loadedPayload);
          syncMarkersToRouteGeometry(loadedRoute);
          if (savedRouteTitle) {
            savedRouteTitle.value = data.route.title || '';
          }
          updateRouteBusyProgress({
            title: 'Gespeicherte Route wird geladen',
            detail: 'Statistik, Navigation und Sackgassen-Check werden vorbereitet.',
            indeterminate: false,
            progress: 52,
            stage: 'clean',
          });
          await finalizeRouteOnMap(loadedRoute);
          updateRouteBusyProgress({
            title: 'Tour geladen',
            detail: 'Route ist geladen und navigationstauglich.',
            indeterminate: false,
            progress: 100,
            stage: 'done',
          });
          configureRouteBusyActions({
            show: true,
            onClose: function () {
              hideRouteBusyOverlay();
            },
            onNavStart: function (ev) {
              const proceed = function () {
                if (window.NRNavigation && typeof window.NRNavigation.setRouteData === 'function') {
                  window.NRNavigation.setRouteData(loadedRoute);
                }
                if (window.NRNavigation && typeof window.NRNavigation.open === 'function') {
                  window.NRNavigation.open();
                }
              };
              // Erst Wetter-Modal (spricht Bericht), dann "Los geht's" -> Navigation öffnen.
              try {
                if (window.NRWeatherStartDialog && typeof window.NRWeatherStartDialog.openForStart === 'function') {
                  try {
                    if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
                      window.NRPiperTTS.cancel();
                    }
                  } catch (eP) {
                    /* ignore */
                  }
                  try {
                    if (typeof window.speechSynthesis !== 'undefined') {
                      window.speechSynthesis.cancel();
                    }
                  } catch (eS) {
                    /* ignore */
                  }
                  const g0 = loadedRoute && Array.isArray(loadedRoute.geometry) ? loadedRoute.geometry[0] : null;
                  const ll0 = g0 ? L.latLng(g0[0], g0[1]) : null;
                  hideRouteBusyOverlay();
                  window.NRWeatherStartDialog.openForStart(ll0, proceed);
                  return;
                }
              } catch (eW) {
                /* ignore */
              }
              hideRouteBusyOverlay();
              proceed();
            },
          });
          setHintMessage(savedRoutesMessage, 'Route "' + (data.route.title || '') + '" geladen.');
          closeSavedRoutesManageDialog();
        } catch (err) {
          hideRouteBusyOverlay();
          setHintMessage(savedRoutesMessage, err.message || String(err));
        }
      });
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger';
      deleteBtn.textContent = 'Löschen';
      deleteBtn.addEventListener('click', function () {
        openSavedRouteDeleteConfirm(route.id, route.title || '');
      });
      actions.appendChild(deleteBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(loadBtn);
      li.appendChild(actions);
      savedRoutesList.appendChild(li);
    });
  }

  async function loadSavedRoutes() {
    if (!state.currentUser) {
      updateAuthUi();
      return;
    }
    try {
      const data = await fetchGetJson(apiUrl('api/saved_routes.php'));
      if (!data.ok) {
        throw new Error(data.error || 'Routenliste konnte nicht geladen werden.');
      }
      renderSavedRoutes(Array.isArray(data.routes) ? data.routes : []);
      setHintMessage(savedRoutesMessage, data.routes && data.routes.length ? '' : 'Noch keine gespeicherten Routen.');
    } catch (err) {
      setHintMessage(savedRoutesMessage, err.message || String(err));
    }
  }

  function getRtMode() {
    const el = document.querySelector('input[name="rt_mode"]:checked');
    return el && el.value === 'waypoints' ? 'waypoints' : 'circle';
  }

  function rtWaypointCalcButtonLabel() {
    if (state.lastRoute && state.lastRoute.roundtrip_mode === 'waypoints_loop') {
      return 'Neu berechnen';
    }
    return 'Rundkurs aus Wegpunkten berechnen';
  }

  function syncRtRoundtripPanelUi() {
    const isWp = getRtMode() === 'waypoints';
    const hintC = document.getElementById('rt-hint-circle');
    const hintW = document.getElementById('rt-hint-waypoints');
    const blockC = document.getElementById('rt-circle-block');
    const blockW = document.getElementById('rt-waypoint-block');
    const rowVar = document.getElementById('rt-variant-row');
    const rtActions = document.getElementById('rt-actions');
    const btnRt = document.getElementById('btn-roundtrip');
    if (hintC) {
      hintC.hidden = isWp;
    }
    if (hintW) {
      hintW.hidden = !isWp;
    }
    if (blockC) {
      blockC.hidden = isWp;
    }
    if (blockW) {
      blockW.hidden = !isWp;
    }
    if (rowVar) {
      rowVar.hidden = isWp;
    }
    if (rtActions) {
      rtActions.classList.toggle('is-single', isWp);
    }
    if (btnRt) {
      btnRt.textContent = isWp ? rtWaypointCalcButtonLabel() : 'Rundkurse berechnen';
    }
    const btnNewVar = document.getElementById('btn-roundtrip-new-variant');
    if (btnNewVar && isWp) {
      btnNewVar.hidden = true;
    }
  }

  function syncRtWaypointCounterUi() {
    const el = document.getElementById('rt-wp-counter');
    if (el) {
      if (!state.start) {
        el.textContent =
          'Startpunkt: Erster Klick in der Karte (Beginn & Ende des Rundkurses), danach bis zu 9 weitere Punkte.';
      } else {
        let line =
          'Start gesetzt + ' +
          state.rtWaypoints.length +
          ' Wegpunkt(e) · max. 9 Zwischenpunkte · Route endet wieder am Start';
        if (state.lastRoute && state.lastRoute.roundtrip_mode === 'waypoints_loop') {
          if (typeof state.lastRoute.distance === 'number') {
            line += ' · Strecke: ' + fmtKm(state.lastRoute.distance);
          }
          line += ' · Punkte ziehen, dann „Neu berechnen“.';
        }
        el.textContent = line;
      }
    }
    const undo = document.getElementById('btn-rt-wp-undo');
    if (undo) {
      undo.disabled = state.rtWaypoints.length === 0;
    }
    const clearAll = document.getElementById('btn-rt-wp-clearall');
    if (clearAll) {
      clearAll.disabled = !state.start && state.rtWaypoints.length === 0;
    }
  }

  function clearRtWaypointDraft() {
    state.rtWaypoints = [];
    rtWaypointMarkers.forEach(function (m) {
      map.removeLayer(m);
    });
    rtWaypointMarkers.length = 0;
    syncRtWaypointCounterUi();
  }

  function clearRtWaypointsAll() {
    clearRtWaypointDraft();
    state.start = null;
    if (startMarker) {
      try {
        map.removeLayer(startMarker);
      } catch (e0) {
        /* ignore */
      }
      startMarker = null;
    }
    clearRoundtripUi();
    clearRouteLayer();
    state.lastRoute = null;
    updatePointStatus();
    refreshRouteButton();
  }

  function buildRtWaypointMarkerIcon(labelNum) {
    return L.divIcon({
      className: 'rt-wp-marker-icon',
      html: '<span class="rt-wp-marker-num">' + labelNum + '</span>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  function renumberRtWaypoints() {
    for (let i = 0; i < rtWaypointMarkers.length; i++) {
      const m = rtWaypointMarkers[i];
      if (!m) continue;
      const labelNum = i + 2; // 1 = Start, daher beginnen Wegpunkte bei 2
      m._nrWpIndex = i;
      m.setIcon(buildRtWaypointMarkerIcon(labelNum));
      try {
        m.options.title = 'Wegpunkt ' + labelNum + ' (ziehen zum Verschieben)';
      } catch (e0) {
        /* ignore */
      }
    }
  }

  function removeRtWaypointAt(index) {
    const idx = Number.isFinite(Number(index)) ? Math.floor(Number(index)) : -1;
    if (idx < 0 || idx >= state.rtWaypoints.length) {
      return;
    }
    state.rtWaypoints.splice(idx, 1);
    const m = rtWaypointMarkers.splice(idx, 1)[0];
    if (m) {
      map.removeLayer(m);
    }
    renumberRtWaypoints();
    syncRtWaypointCounterUi();
    refreshRouteButton();
    updatePointStatus();
  }

  function openRtWaypointPopup(marker) {
    if (!marker) return;
    const i = Number.isFinite(Number(marker._nrWpIndex)) ? Number(marker._nrWpIndex) : -1;
    const ll = typeof marker.getLatLng === 'function' ? marker.getLatLng() : null;
    NRWpDeleteDialog.show(i, ll);
  }

  // (Doppelklick-Löschen entfernt – stattdessen Click → kleines Popover am Punkt.)

  function pushRtWaypoint(latlng) {
    if (!state.start) {
      setStart(latlng);
      syncRtWaypointCounterUi();
      return;
    }
    if (state.rtWaypoints.length >= 9) {
      return;
    }
    state.rtWaypoints.push(latlng);
    const idx = state.rtWaypoints.length - 1;
    const labelNum = idx + 2;
    const icon = buildRtWaypointMarkerIcon(labelNum);
    const m = L.marker(latlng, {
      icon: icon,
      title: 'Wegpunkt ' + labelNum + ' (ziehen zum Verschieben)',
      draggable: true,
      zIndexOffset: 1200,
    }).addTo(map);
    m._nrWpIndex = idx;
    m.on('dragend', function (e) {
      const marker = e && e.target ? e.target : null;
      const i = marker && Number.isFinite(Number(marker._nrWpIndex)) ? Number(marker._nrWpIndex) : -1;
      if (i >= 0 && i < state.rtWaypoints.length) {
        state.rtWaypoints[i] = marker.getLatLng();
      }
      updatePointStatus();
    });
    m.on('click', function (e) {
      try {
        if (e && e.originalEvent) {
          L.DomEvent.stop(e.originalEvent);
        }
      } catch (e0) {
        /* ignore */
      }
      const marker = e && e.target ? e.target : this;
      openRtWaypointPopup(marker);
    });
    rtWaypointMarkers.push(m);
    syncRtWaypointCounterUi();
    refreshRouteButton();
    updatePointStatus();
  }

  function popRtWaypoint() {
    if (!state.rtWaypoints.length) {
      return;
    }
    removeRtWaypointAt(state.rtWaypoints.length - 1);
  }

  function onRtModeChange() {
    clearRoundtripUi();
    clearRtWaypointDraft();
    syncRtRoundtripPanelUi();
    refreshRouteButton();
    updatePointStatus();
  }

  function updatePointStatus() {
    const parts = [];
    parts.push(state.start ? 'Start gesetzt' : 'Start fehlt');
    parts.push(state.goal ? 'Ziel gesetzt' : 'Ziel fehlt');
    if (state.vias.length) {
      parts.push(state.vias.length + ' Zwischenpunkt(e)');
    }
    const hints = [];
    if (state.noExitHighlightActive) {
      hints.push(
        'Sackgassen: rot = verlässlich erkannter Hin-und-zurück-Ast; ohne grüne Route OSM noexit (Zoom ≥ ' +
          NOEXIT_MIN_ZOOM +
          '); ✕ = alle Markierungen löschen'
      );
    }
    let tail = ' · Karte: Klick setzt Punkte, Umschalt + Klick fügt Zwischenpunkte hinzu';
    if (getRtMode() === 'waypoints') {
      tail =
        ' · Rundkurs Wegpunkte: Erster Klick = Start (Beginn & Ende), danach Zwischenpunkte (max. 9). Mindestens Start + 2 weitere Punkte, dann „Rundkurs aus Wegpunkten berechnen“. Nach der Berechnung Start und Wegpunkte ziehen und „Neu berechnen“. Escape oder „Letzten Wegpunkt entfernen“ für den letzten Zwischenpunkt.';
    }
    if (hints.length) {
      tail = ' · ' + hints.join(' — ') + tail;
    }
    pointStatus.textContent = parts.join(' · ') + tail;
  }

  function canRoute() {
    return !!(state.start && state.goal);
  }

  function refreshRouteButton() {
    if (!routeHasSurfaceSegments(state.lastRoute)) {
      state.surfaceViewActive = false;
    }
    const user = state.currentUser;
    const btn = document.getElementById('btn-route');
    btn.disabled = !canRoute() || !user;
    const btnGpx = document.getElementById('btn-gpx');
    if (btnGpx) {
      btnGpx.disabled = !state.lastRoute || !user;
    }
    const navBtn = document.getElementById('btn-nav-start');
    const navBtnMap = document.getElementById('btn-nav-start-map');
    const navBtnMapWrap = document.getElementById('map-nav-start-wrap');
    if (navBtn) {
      navBtn.disabled = !state.lastRoute || !user;
    }
    if (btnAddressbookStart) {
      btnAddressbookStart.disabled = !state.currentUser;
    }
    if (btnAddressbookGoal) {
      btnAddressbookGoal.disabled = !state.currentUser;
    }
    if (btnAddressbookSaveStart) {
      btnAddressbookSaveStart.disabled = !state.currentUser || !state.start;
    }
    if (btnAddressbookSaveGoal) {
      btnAddressbookSaveGoal.disabled = !state.currentUser || !state.goal;
    }
    if (navBtnMap) {
      navBtnMap.disabled = !state.lastRoute || !user;
      navBtnMap.textContent = (navBtn && navBtn.textContent) ? navBtn.textContent : 'Navigation starten';
    }
    if (navBtnMapWrap) {
      const show = !!state.lastRoute && !!user;
      navBtnMapWrap.hidden = !show;
      navBtnMapWrap.setAttribute('aria-hidden', show ? 'false' : 'true');
    }
    const btnRt = document.getElementById('btn-roundtrip');
    if (btnRt) {
      if (getRtMode() === 'waypoints') {
        btnRt.disabled = !state.start || state.rtWaypoints.length < 2 || !user;
        btnRt.textContent = rtWaypointCalcButtonLabel();
      } else {
        btnRt.disabled = !state.start || !user;
        btnRt.textContent = 'Rundkurse berechnen';
      }
    }
    syncMapRouteFabToolbar();
    updateAuthUi();
  }

  function clearRouteLayer() {
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    clearSurfaceLayer();
  }

  const startPlaceEl = document.getElementById('start-place');
  const startStreetEl = document.getElementById('start-street');
  const goalPlaceEl = document.getElementById('goal-place');
  const goalStreetEl = document.getElementById('goal-street');
  const startSuggestEl = document.getElementById('start-suggest');
  const goalSuggestEl = document.getElementById('goal-suggest');

  function clearSuggestionList(ul) {
    if (!ul) return;
    ul.innerHTML = '';
    ul.hidden = true;
  }

  function clearRoundtripUi() {
    state.roundtripVariants = null;
    state._nrRoundtripContext = null;
    const box = document.getElementById('rt-variants');
    if (box) {
      box.innerHTML = '';
      box.hidden = true;
    }
    const btnNew = document.getElementById('btn-roundtrip-new-variant');
    if (btnNew) {
      btnNew.hidden = true;
      btnNew.disabled = false;
    }
  }

  function renderRoundtripVariantsBox() {
    const box = document.getElementById('rt-variants');
    if (!box) return;
    const variants = Array.isArray(state.roundtripVariants) ? state.roundtripVariants : [];
    box.hidden = variants.length === 0;
    box.innerHTML = '';
    variants.forEach(function (v, idx) {
      const card = document.createElement('div');
      card.className = 'rt-card';
      const head = document.createElement('div');
      head.className = 'rt-card-head';
      head.textContent = 'Variante ' + (idx + 1);
      const meta = document.createElement('div');
      meta.className = 'rt-card-meta';
      meta.textContent =
        fmtKm(v.distance) +
        ' · ' +
        fmtMin(v.duration) +
        (v.dead_end_segments_removed ? ' · bereinigt: ' + v.dead_end_segments_removed : '');
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'btn btn-secondary rt-pick';
      pick.setAttribute('data-idx', String(idx));
      pick.textContent = 'Auf Karte anzeigen';
      card.appendChild(head);
      card.appendChild(meta);
      card.appendChild(pick);
      box.appendChild(card);
    });

    box.querySelectorAll('.rt-pick').forEach(function (btnPick) {
      btnPick.addEventListener('click', async function () {
        const idx = parseInt(btnPick.getAttribute('data-idx') || '-1', 10);
        const v = state.roundtripVariants && state.roundtripVariants[idx];
        if (!v) {
          return;
        }
        routeError.hidden = true;
        clearRouteLayer();
        state.lastRoute = null;
        if (state.noExitHighlightActive) {
          clearNoExitHighlightLayer();
        }
        refreshRouteButton();
        setRouteBusyVisible(true);
        updateRouteBusyProgress({
          title: 'Variante wird angezeigt',
          detail: 'Ausgewählte Variante wird auf die Karte gelegt.',
          indeterminate: true,
          stage: 'map',
        });
        try {
          if (state.noExitHighlightActive) {
            setNoExitHighlightMode(false);
          }
          await finalizeRouteOnMap(v);
          updateRouteBusyProgress({
            title: 'Variante fertig',
            detail: 'Variante ist sichtbar.',
            indeterminate: false,
            progress: 100,
            stage: 'done',
          });
          await new Promise(function (resolve) {
            window.setTimeout(resolve, 200);
          });
        } catch (e) {
          routeError.textContent = e.message || String(e);
          routeError.hidden = false;
        } finally {
          setRouteBusyVisible(false);
          resetRouteBusyBar();
          if (routeBusyDetail) {
            routeBusyDetail.textContent = '';
          }
        }
      });
    });
  }

  function clearAll() {
    setRouteRemoveMode(false);
    setNoExitHighlightMode(false);
    setSurfaceViewMode(false);
    state.start = null;
    state.goal = null;
    state.vias = [];
    state.lastRoute = null;
    state.navRerouteSession = null;
    clearRoundtripUi();
    clearRtWaypointDraft();
    if (startMarker) map.removeLayer(startMarker);
    if (goalMarker) map.removeLayer(goalMarker);
    viaMarkers.forEach(function (m) {
      map.removeLayer(m);
    });
    viaMarkers.length = 0;
    startMarker = goalMarker = null;
    clearRouteLayer();
    if (statsSection) {
      statsSection.hidden = true;
    }
    if (routeError) {
      routeError.hidden = true;
      routeError.textContent = '';
    }
    if (startPlaceEl) startPlaceEl.value = '';
    if (startStreetEl) startStreetEl.value = '';
    if (goalPlaceEl) goalPlaceEl.value = '';
    if (goalStreetEl) goalStreetEl.value = '';
    clearSuggestionList(startSuggestEl);
    clearSuggestionList(goalSuggestEl);
    if (window.NRNavigation) {
      window.NRNavigation.close();
      window.NRNavigation.setRouteData(null);
    }
    updatePointStatus();
    refreshRouteButton();
  }

  function renderGeoSuggestions(ul, results, onPick) {
    clearSuggestionList(ul);
    if (!ul || !results || results.length === 0) {
      return;
    }
    results.forEach(function (r) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = r.label || (r.lat + ', ' + r.lon);
      btn.addEventListener('click', function () {
        onPick(L.latLng(r.lat, r.lon));
        clearSuggestionList(ul);
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
    ul.hidden = false;
  }

  async function reverseFillAddressFields(latlng, placeEl, streetEl) {
    if (!placeEl || !streetEl || !latlng) {
      return;
    }
    try {
      const data = await fetchGetJson(
        apiUrl(
          'api/geocode.php?lat=' +
            encodeURIComponent(String(latlng.lat)) +
            '&lon=' +
            encodeURIComponent(String(latlng.lng))
        )
      );
      if (!data.ok || !data.results || data.results.length < 1) {
        return;
      }
      const r = data.results[0];
      if (r.place && typeof r.place === 'string' && r.place.trim()) {
        placeEl.value = r.place.trim();
      }
      if (r.street && typeof r.street === 'string' && r.street.trim()) {
        streetEl.value = r.street.trim();
      }
    } catch (e) {
      /* Adresszeilen bleiben leer */
    }
  }

  // Adressbuch: Start/Ziel automatisch speichern (best-effort).
  // Wird an mehreren Stellen getriggert (Zielpunkt/Profil/Navi-Start) und ist dedupliziert,
  // damit nicht bei jeder UI-Änderung neue identische Einträge entstehen.
  const NRAddressbookAutosave = (function () {
    const AUTOSAVE_ENABLED = false;
    /** @type {number|null} */
    let timer = null;
    /** @type {string} */
    let lastKey = '';
    /** @type {number} */
    let lastAt = 0;

    const normalize = function (v) {
      return typeof v === 'string' ? v.trim() : '';
    };

    const buildKey = function (startLl, goalLl) {
      const p1 = startLl ? startLl.lat.toFixed(6) + ',' + startLl.lng.toFixed(6) : '';
      const p2 = goalLl ? goalLl.lat.toFixed(6) + ',' + goalLl.lng.toFixed(6) : '';
      return (
        p1 +
        '|' +
        p2 +
        '|' +
        normalize(startPlaceEl ? startPlaceEl.value : '') +
        '|' +
        normalize(startStreetEl ? startStreetEl.value : '') +
        '|' +
        normalize(goalPlaceEl ? goalPlaceEl.value : '') +
        '|' +
        normalize(goalStreetEl ? goalStreetEl.value : '')
      );
    };

    const saveNow = async function () {
      if (!AUTOSAVE_ENABLED) return;
      if (!state.currentUser || !state.start || !state.goal) return;
      const startLl = state.start;
      const goalLl = state.goal;

      const ensureStart = async function () {
        const p = normalize(startPlaceEl ? startPlaceEl.value : '');
        const s = normalize(startStreetEl ? startStreetEl.value : '');
        if (p && s) return;
        try {
          await reverseFillAddressFields(startLl, startPlaceEl, startStreetEl);
        } catch (e) {
          /* ignore */
        }
      };
      const ensureGoal = async function () {
        const p = normalize(goalPlaceEl ? goalPlaceEl.value : '');
        const s = normalize(goalStreetEl ? goalStreetEl.value : '');
        if (p && s) return;
        try {
          await reverseFillAddressFields(goalLl, goalPlaceEl, goalStreetEl);
        } catch (e) {
          /* ignore */
        }
      };

      // Nicht blockieren: reverse geocode best-effort parallel, dann speichern.
      await Promise.all([ensureStart(), ensureGoal()]).catch(function () {});

      const key = buildKey(startLl, goalLl);
      const now = Date.now();
      if (key === lastKey && now - lastAt < 15000) {
        return;
      }
      lastKey = key;
      lastAt = now;

      try {
        await fetchJson(apiUrl('api/address_book.php'), {
          method: 'POST',
          body: JSON.stringify({
            start: { lat: startLl.lat, lng: startLl.lng },
            goal: { lat: goalLl.lat, lng: goalLl.lng },
            start_place: normalize(startPlaceEl ? startPlaceEl.value : ''),
            start_street: normalize(startStreetEl ? startStreetEl.value : ''),
            goal_place: normalize(goalPlaceEl ? goalPlaceEl.value : ''),
            goal_street: normalize(goalStreetEl ? goalStreetEl.value : ''),
          }),
        });
      } catch (e0) {
        /* ignore */
      }
    };

    function schedule() {
      if (!AUTOSAVE_ENABLED) return;
      if (!state.currentUser || !state.start || !state.goal) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        timer = null;
        void saveNow();
      }, 600);
    }

    return { schedule: schedule, saveNow: saveNow };
  })();

  const NRMessageDialog = (function () {
    function show(text, title) {
      if (!messageDialog || !messageText) {
        alert(String(text || ''));
        return;
      }
      if (messageTitle) {
        messageTitle.textContent = title && String(title).trim() ? String(title).trim() : 'Hinweis';
      }
      messageText.textContent = String(text || '');
      messageDialog.hidden = false;
      messageDialog.setAttribute('aria-hidden', 'false');
      window.setTimeout(function () {
        if (messageOk) {
          messageOk.focus();
        }
      }, 0);
    }
    function hide() {
      if (!messageDialog) return;
      messageDialog.hidden = true;
      messageDialog.setAttribute('aria-hidden', 'true');
    }
    if (messageOk) {
      messageOk.addEventListener('click', function () {
        hide();
      });
    }
    if (messageDialog) {
      messageDialog.addEventListener('mousedown', function (ev) {
        if (ev.target === messageDialog) {
          hide();
        }
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && messageDialog && !messageDialog.hidden) {
        hide();
      }
    });
    return { show: show, hide: hide };
  })();

  function abCoordsUnset(lat, lng) {
    const a = Number(lat);
    const b = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return true;
    }
    return Math.abs(a) < 1e-5 && Math.abs(b) < 1e-5;
  }

  async function saveAddressbookFromCurrentPointsInteractive(partial) {
    const side = partial === 'goal' ? 'goal' : partial === 'start' ? 'start' : '';
    if (!state.currentUser) {
      NRMessageDialog.show('Bitte einloggen, um ins Adressbuch zu speichern.');
      return;
    }
    if (side === 'start' && !state.start) {
      NRMessageDialog.show('Bitte zuerst einen Startpunkt setzen (Karte, GPS oder Adresse), dann ins Adressbuch speichern.');
      return;
    }
    if (side === 'goal' && !state.goal) {
      NRMessageDialog.show('Bitte zuerst ein Ziel setzen (Karte, GPS oder Adresse), dann ins Adressbuch speichern.');
      return;
    }
    if (side === '') {
      if (!state.start || !state.goal) {
        NRMessageDialog.show('Bitte zuerst Start und Ziel setzen.');
        return;
      }
    }

    const startLl = state.start;
    const goalLl = state.goal;
    const normalize = function (v) {
      return typeof v === 'string' ? v.trim() : '';
    };
    try {
      if (side === 'start' || side === '') {
        await (async function () {
          const p = normalize(startPlaceEl ? startPlaceEl.value : '');
          const s = normalize(startStreetEl ? startStreetEl.value : '');
          if (p && s) return;
          if (!startLl) return;
          await reverseFillAddressFields(startLl, startPlaceEl, startStreetEl);
        })().catch(function () {});
      }
      if (side === 'goal' || side === '') {
        await (async function () {
          const p = normalize(goalPlaceEl ? goalPlaceEl.value : '');
          const s = normalize(goalStreetEl ? goalStreetEl.value : '');
          if (p && s) return;
          if (!goalLl) return;
          await reverseFillAddressFields(goalLl, goalPlaceEl, goalStreetEl);
        })().catch(function () {});
      }

      const body = {
        start_place: normalize(startPlaceEl ? startPlaceEl.value : ''),
        start_street: normalize(startStreetEl ? startStreetEl.value : ''),
        goal_place: normalize(goalPlaceEl ? goalPlaceEl.value : ''),
        goal_street: normalize(goalStreetEl ? goalStreetEl.value : ''),
      };
      if (side === 'start') {
        body.partial = 'start';
        body.start = { lat: startLl.lat, lng: startLl.lng };
        body.goal = { lat: 0, lng: 0 };
        body.goal_place = '';
        body.goal_street = '';
      } else if (side === 'goal') {
        body.partial = 'goal';
        body.goal = { lat: goalLl.lat, lng: goalLl.lng };
        body.start = { lat: 0, lng: 0 };
        body.start_place = '';
        body.start_street = '';
      } else {
        body.start = { lat: startLl.lat, lng: startLl.lng };
        body.goal = { lat: goalLl.lat, lng: goalLl.lng };
      }

      const data = await fetchJson(apiUrl('api/address_book.php'), {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!data || !data.ok) {
        throw new Error((data && data.error) || 'Speichern ins Adressbuch fehlgeschlagen.');
      }
      NRMessageDialog.show(data.deduped ? 'Schon im Adressbuch – Eintrag wurde aktualisiert.' : 'Ins Adressbuch gespeichert.');
      if (NRAddressbookDialog && typeof NRAddressbookDialog.refresh === 'function') {
        void NRAddressbookDialog.refresh();
      }
    } catch (e) {
      NRMessageDialog.show(e && e.message ? e.message : String(e));
    }
  }

  const NRWpDeleteDialog = (function () {
    let pendingIdx = null;
    function hide() {
      pendingIdx = null;
      if (!waypointDeletePopover) return;
      waypointDeletePopover.hidden = true;
      waypointDeletePopover.setAttribute('aria-hidden', 'true');
      waypointDeletePopover.style.left = '-9999px';
      waypointDeletePopover.style.top = '-9999px';
    }
    function show(idx, latlng) {
      const i = Number.isFinite(Number(idx)) ? Math.floor(Number(idx)) : -1;
      if (!waypointDeletePopover || !waypointDeletePopoverTitle) return;
      if (i < 0 || i >= state.rtWaypoints.length) return;
      pendingIdx = i;
      const labelNum = i + 2;
      waypointDeletePopoverTitle.textContent = 'Wegpunkt ' + labelNum + ' löschen?';
      waypointDeletePopover.hidden = false;
      waypointDeletePopover.setAttribute('aria-hidden', 'false');
      if (mapWrap && latlng && typeof map.latLngToContainerPoint === 'function') {
        const p = map.latLngToContainerPoint(latlng);
        const rect = mapWrap.getBoundingClientRect();
        const x = Math.round(rect.left + p.x);
        const y = Math.round(rect.top + p.y);
        waypointDeletePopover.style.left = x + 'px';
        waypointDeletePopover.style.top = y + 'px';
      }
      window.setTimeout(function () {
        if (waypointDeletePopoverConfirm) {
          waypointDeletePopoverConfirm.focus();
        }
      }, 0);
    }
    if (waypointDeletePopoverCancel) {
      waypointDeletePopoverCancel.addEventListener('click', function () {
        hide();
      });
    }
    if (waypointDeletePopoverConfirm) {
      waypointDeletePopoverConfirm.addEventListener('click', function () {
        const i = pendingIdx;
        hide();
        if (i == null) return;
        removeRtWaypointAt(i);
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && waypointDeletePopover && !waypointDeletePopover.hidden) {
        hide();
      }
    });
    document.addEventListener(
      'pointerdown',
      function (ev) {
        if (!waypointDeletePopover || waypointDeletePopover.hidden) return;
        const t = ev && ev.target ? ev.target : null;
        if (t && waypointDeletePopover.contains(t)) return;
        hide();
      },
      true
    );
    map.on('movestart zoomstart', function () {
      hide();
    });
    return { show: show, hide: hide };
  })();

  const NRWaypointsClearDialog = (function () {
    function show() {
      if (getRtMode() !== 'waypoints') return;
      if (!waypointsClearDialog || !waypointsClearText) return;
      if (!state.start && state.rtWaypoints.length === 0) return;
      const line =
        state.start
          ? 'Start gesetzt + ' +
            state.rtWaypoints.length +
            ' Wegpunkt(e) · max. 9 Zwischenpunkte · Route endet wieder am Start'
          : 'Noch kein Start gesetzt.';
      waypointsClearText.textContent = line + ' Wirklich Start und alle Wegpunkte löschen?';
      waypointsClearDialog.hidden = false;
      waypointsClearDialog.setAttribute('aria-hidden', 'false');
      window.setTimeout(function () {
        if (waypointsClearConfirm) {
          waypointsClearConfirm.focus();
        }
      }, 0);
    }
    function hide() {
      if (!waypointsClearDialog) return;
      waypointsClearDialog.hidden = true;
      waypointsClearDialog.setAttribute('aria-hidden', 'true');
    }
    if (waypointsClearCancel) {
      waypointsClearCancel.addEventListener('click', function () {
        hide();
      });
    }
    if (waypointsClearConfirm) {
      waypointsClearConfirm.addEventListener('click', function () {
        hide();
        clearRtWaypointsAll();
      });
    }
    if (waypointsClearDialog) {
      waypointsClearDialog.addEventListener('mousedown', function (ev) {
        if (ev.target === waypointsClearDialog) {
          hide();
        }
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && waypointsClearDialog && !waypointsClearDialog.hidden) {
        hide();
      }
    });
    return { show: show, hide: hide };
  })();

  const btnRtWpClearAll = document.getElementById('btn-rt-wp-clearall');
  if (btnRtWpClearAll) {
    btnRtWpClearAll.addEventListener('click', function () {
      NRWaypointsClearDialog.show();
    });
  }

  const NRChangelogDialog = (function () {
    function show() {
      if (!changelogDialog) return;
      changelogDialog.hidden = false;
      changelogDialog.setAttribute('aria-hidden', 'false');
      window.setTimeout(function () {
        const body = document.getElementById('changelog-body');
        if (body) {
          body.focus();
        } else if (changelogClose) {
          changelogClose.focus();
        }
      }, 0);
    }
    function hide() {
      if (!changelogDialog) return;
      changelogDialog.hidden = true;
      changelogDialog.setAttribute('aria-hidden', 'true');
      if (changelogOpen) {
        window.setTimeout(function () {
          changelogOpen.focus();
        }, 0);
      }
    }
    if (changelogOpen) {
      changelogOpen.addEventListener('click', function () {
        show();
      });
    }
    if (changelogClose) {
      changelogClose.addEventListener('click', function () {
        hide();
      });
    }
    if (changelogDialog) {
      changelogDialog.addEventListener('mousedown', function (ev) {
        if (ev.target === changelogDialog) {
          hide();
        }
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && changelogDialog && !changelogDialog.hidden) {
        hide();
      }
    });
    return { show: show, hide: hide };
  })();

  const NRSettingsDialog = (function () {
    function show() {
      if (!settingsDialog) return;
      settingsDialog.hidden = false;
      settingsDialog.setAttribute('aria-hidden', 'false');
      document.body.classList.add('settings-open');
      window.setTimeout(function () {
        if (settingsVoiceEnabled) {
          settingsVoiceEnabled.focus();
        } else if (settingsClose) {
          settingsClose.focus();
        }
      }, 0);
    }
    function hide() {
      if (!settingsDialog) return;
      settingsDialog.hidden = true;
      settingsDialog.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('settings-open');
      if (settingsOpen) {
        window.setTimeout(function () {
          settingsOpen.focus();
        }, 0);
      }
    }
    if (settingsOpen) {
      settingsOpen.addEventListener('click', function () {
        show();
      });
    }
    if (settingsClose) {
      settingsClose.addEventListener('click', function () {
        hide();
      });
    }
    if (settingsDialog) {
      settingsDialog.addEventListener('mousedown', function (ev) {
        if (ev.target === settingsDialog) {
          hide();
        }
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && settingsDialog && !settingsDialog.hidden) {
        hide();
      }
    });
    return { show: show, hide: hide };
  })();

  const NRKontoDialog = (function () {
    function show() {
      if (!kontoDialog) {
        return;
      }
      kontoDialog.hidden = false;
      kontoDialog.setAttribute('aria-hidden', 'false');
      document.body.classList.add('konto-dialog-open');
      window.setTimeout(function () {
        const u = state.currentUser;
        if (!u && authEmail) {
          if (!authDisplayNameWrap || authDisplayNameWrap.hidden) {
            authEmail.focus();
          }
        } else if (kontoDialogClose) {
          kontoDialogClose.focus();
        }
      }, 0);
    }
    function hide() {
      if (!kontoDialog) {
        return;
      }
      kontoDialog.hidden = true;
      kontoDialog.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('konto-dialog-open');
      if (btnKonto) {
        window.setTimeout(function () {
          btnKonto.focus();
        }, 0);
      }
    }
    if (btnKonto) {
      btnKonto.addEventListener('click', function () {
        show();
      });
    }
    if (kontoDialogClose) {
      kontoDialogClose.addEventListener('click', function () {
        hide();
      });
    }
    if (kontoDialogCloseBtn) {
      kontoDialogCloseBtn.addEventListener('click', function () {
        hide();
      });
    }
    if (kontoDialog) {
      kontoDialog.addEventListener('mousedown', function (ev) {
        if (ev.target === kontoDialog) {
          hide();
        }
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && kontoDialog && !kontoDialog.hidden) {
        hide();
      }
    });
    function showFocusOrs() {
      show();
      window.setTimeout(function () {
        const box = document.querySelector('.konto-dialog-card .ors-key-box');
        if (box && typeof box.scrollIntoView === 'function') {
          box.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        if (orsApiKeyInput && !orsApiKeyInput.hidden) {
          try {
            orsApiKeyInput.focus();
          } catch (eF) {
            /* ignore */
          }
        }
      }, 120);
    }
    return { show: show, hide: hide, showFocusOrs: showFocusOrs };
  })();

  const NRAddressbookDialog = (function () {
    let outsideBound = false;
    /** @type {'both'|'start'|'goal'} */
    let pickMode = 'both';

    function show(mode) {
      if (!addressbookDialog) return;
      pickMode = mode === 'start' || mode === 'goal' || mode === 'both' ? mode : 'both';
      addressbookDialog.hidden = false;
      addressbookDialog.setAttribute('aria-hidden', 'false');
      document.body.classList.add('addressbook-open');
      void refresh();
      window.setTimeout(function () {
        if (addressbookClose) addressbookClose.focus();
      }, 0);
      if (!outsideBound) {
        outsideBound = true;
        addressbookDialog.addEventListener('mousedown', function (ev) {
          if (ev.target === addressbookDialog) hide();
        });
      }
    }

    function hide() {
      if (!addressbookDialog) return;
      addressbookDialog.hidden = true;
      addressbookDialog.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('addressbook-open');
    }

    function safeLine(place, street) {
      const p = (place || '').trim();
      const s = (street || '').trim();
      if (p && s) return p + ' · ' + s;
      return p || s || 'Unbenannt';
    }

    function renderItem(it) {
      if (!addressbookList || !it) return;
      const start = it.start || {};
      const goal = it.goal || {};
      const startLine = safeLine(start.place, start.street);
      const goalLine = safeLine(goal.place, goal.street);
      const startUnset = abCoordsUnset(start.lat, start.lng);
      const goalUnset = abCoordsUnset(goal.lat, goal.lng);
      let derivedTitle = '';
      if (!startUnset && goalUnset) {
        derivedTitle = 'Nur Start · ' + startLine;
      } else if (startUnset && !goalUnset) {
        derivedTitle = 'Nur Ziel · ' + goalLine;
      } else {
        derivedTitle = startLine + ' → ' + goalLine;
      }
      const customTitle = it.title && String(it.title).trim() ? String(it.title).trim() : '';

      const row = document.createElement('div');
      row.className = 'addressbook-item';

      const main = document.createElement('div');
      main.className = 'addressbook-item-main';
      const title = document.createElement('p');
      title.className = 'addressbook-item-title';
      title.textContent = customTitle || derivedTitle;
      const sub = document.createElement('p');
      sub.className = 'addressbook-item-sub';
      sub.textContent =
        (customTitle ? derivedTitle + ' · ' : '') +
        'Zuletzt genutzt: ' +
        (it.updated_at || '—') +
        (it.times_used ? ' · ' + it.times_used + '×' : '');
      main.appendChild(title);
      main.appendChild(sub);

      const actions = document.createElement('div');
      actions.className = 'addressbook-item-actions';

      const btnUse = document.createElement('button');
      btnUse.type = 'button';
      btnUse.className = 'btn btn-primary';
      btnUse.textContent =
        pickMode === 'start' ? 'Start übernehmen' : pickMode === 'goal' ? 'Ziel übernehmen' : 'Start & Ziel übernehmen';
      btnUse.addEventListener('click', function () {
        if (pickMode !== 'goal' && startUnset) {
          return;
        }
        if (pickMode !== 'start' && goalUnset) {
          return;
        }
        const sLat = Number(start.lat);
        const sLng = Number(start.lng);
        const gLat = Number(goal.lat);
        const gLng = Number(goal.lng);
        const bounds = [];
        if (pickMode !== 'goal') {
          const sLl = L.latLng(sLat, sLng);
          setStart(sLl);
          if (startPlaceEl) startPlaceEl.value = String(start.place || '');
          if (startStreetEl) startStreetEl.value = String(start.street || '');
          bounds.push(sLl);
        }
        if (pickMode !== 'start') {
          const gLl = L.latLng(gLat, gLng);
          setGoal(gLl);
          if (goalPlaceEl) goalPlaceEl.value = String(goal.place || '');
          if (goalStreetEl) goalStreetEl.value = String(goal.street || '');
          bounds.push(gLl);
        }
        if (bounds.length === 2) {
          map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32] });
        } else if (bounds.length === 1) {
          map.panTo(bounds[0]);
        }
        hide();
      });

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn btn-secondary';
      btnDel.textContent = 'Löschen';
      btnDel.addEventListener('click', function () {
        const startLine = safeLine(start.place, start.street);
        const goalLine = safeLine(goal.place, goal.street);
        openAddressbookDeleteConfirm(Number(it.id), startLine + ' → ' + goalLine);
      });

      const btnRename = document.createElement('button');
      btnRename.type = 'button';
      btnRename.className = 'btn btn-secondary';
      btnRename.textContent = 'Umbenennen';
      btnRename.addEventListener('click', function () {
        openAddressbookRenameDialog(Number(it.id), customTitle || derivedTitle);
      });

      actions.appendChild(btnDel);
      actions.appendChild(btnRename);
      actions.appendChild(btnUse);

      row.appendChild(main);
      row.appendChild(actions);
      addressbookList.appendChild(row);
    }

    async function refresh() {
      if (!addressbookList) return;
      addressbookList.textContent = '';
      if (addressbookEmpty) {
        addressbookEmpty.hidden = true;
      }
      if (!state.currentUser) {
        if (addressbookEmpty) {
          addressbookEmpty.textContent = 'Bitte einloggen, um dein Adressbuch zu nutzen.';
          addressbookEmpty.hidden = false;
        }
        return;
      }
      try {
        const data = await fetchJson(apiUrl('api/address_book.php'));
        if (!data.ok) {
          throw new Error(data.error || 'Adressbuch konnte nicht geladen werden.');
        }
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
          if (addressbookEmpty) {
            addressbookEmpty.textContent =
              'Noch keine Einträge. Unter Start oder Ziel auf „Ins Adressbuch“ tippen – oder eine Tour starten, dann werden beide Punkte automatisch gespeichert.';
            addressbookEmpty.hidden = false;
          }
          return;
        }
        items.forEach(function (it) {
          renderItem(it);
        });
      } catch (err) {
        if (addressbookEmpty) {
          addressbookEmpty.textContent = err && err.message ? err.message : String(err);
          addressbookEmpty.hidden = false;
        }
      }
    }

    if (addressbookClose) {
      addressbookClose.addEventListener('click', function () {
        hide();
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && addressbookDialog && !addressbookDialog.hidden) {
        hide();
      }
    });

    return { show: show, hide: hide, refresh: refresh };
  })();

  const NROrsKeyMissingDialog = (function () {
    const orsDlg = document.getElementById('nr-ors-key-dialog');
    const orsCloseBtn = document.getElementById('nr-ors-key-close');
    const orsOpenKonto = document.getElementById('nr-ors-key-open-konto');
    function show() {
      if (!orsDlg) {
        return;
      }
      orsDlg.hidden = false;
      orsDlg.setAttribute('aria-hidden', 'false');
      document.body.classList.add('nr-ors-key-open');
      window.setTimeout(function () {
        if (orsOpenKonto) {
          orsOpenKonto.focus();
        } else if (orsCloseBtn) {
          orsCloseBtn.focus();
        }
      }, 0);
    }
    function hide() {
      if (!orsDlg) {
        return;
      }
      orsDlg.hidden = true;
      orsDlg.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('nr-ors-key-open');
    }
    if (orsCloseBtn) {
      orsCloseBtn.addEventListener('click', hide);
    }
    if (orsOpenKonto) {
      orsOpenKonto.addEventListener('click', function () {
        hide();
        if (NRKontoDialog && typeof NRKontoDialog.showFocusOrs === 'function') {
          NRKontoDialog.showFocusOrs();
        } else if (NRKontoDialog) {
          NRKontoDialog.show();
        }
      });
    }
    if (orsDlg) {
      orsDlg.addEventListener('mousedown', function (ev) {
        if (ev.target === orsDlg) {
          hide();
        }
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && orsDlg && !orsDlg.hidden) {
        hide();
      }
    });
    return { show: show, hide: hide };
  })();

  function nrRequireOrsApiKeyOrExplain() {
    if (nrHasEffectiveOrsApiKey()) {
      return true;
    }
    if (NROrsKeyMissingDialog && typeof NROrsKeyMissingDialog.show === 'function') {
      NROrsKeyMissingDialog.show();
    } else {
      NRMessageDialog.show(
        'Für Routen und Navigation wird ein OpenRouteService API-Key benötigt. Bitte unter Konto eintragen oder auf openrouteservice.org registrieren.',
        'API-Key fehlt'
      );
    }
    return false;
  }

  /** Nach Login: Hinweis auf fehlenden ORS-API-Key (wenn weder Nutzer-Key noch Server-Standard). */
  function nrWarnOrsKeyMissingAfterLoginDeferred() {
    window.setTimeout(function () {
      if (!state.currentUser) {
        return;
      }
      if (nrHasEffectiveOrsApiKey()) {
        return;
      }
      if (NROrsKeyMissingDialog && typeof NROrsKeyMissingDialog.show === 'function') {
        NROrsKeyMissingDialog.show();
      }
    }, 380);
  }

  function openAddressbookRenameDialog(id, currentTitle) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0 || !addressbookRenameDialog || !addressbookRenameInput) {
      return;
    }
    addressbookRenamePendingId = Math.floor(n);
    addressbookRenameInput.value = currentTitle && String(currentTitle).trim() ? String(currentTitle).trim() : '';
    addressbookRenameDialog.hidden = false;
    addressbookRenameDialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('addressbook-rename-open');
    window.setTimeout(function () {
      addressbookRenameInput.focus();
      addressbookRenameInput.select();
    }, 0);
  }

  function closeAddressbookRenameDialog() {
    addressbookRenamePendingId = null;
    if (addressbookRenameDialog) {
      addressbookRenameDialog.hidden = true;
      addressbookRenameDialog.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('addressbook-rename-open');
    if (addressbookRenameInput) {
      addressbookRenameInput.value = '';
    }
  }

  if (addressbookRenameCancel) {
    addressbookRenameCancel.addEventListener('click', function () {
      closeAddressbookRenameDialog();
    });
  }
  if (addressbookRenameConfirm) {
    addressbookRenameConfirm.addEventListener('click', async function () {
      const id = addressbookRenamePendingId;
      const title = addressbookRenameInput ? String(addressbookRenameInput.value || '').trim() : '';
      if (!id) {
        closeAddressbookRenameDialog();
        return;
      }
      if (!title) {
        if (addressbookRenameInput) {
          addressbookRenameInput.focus();
        }
        return;
      }
      try {
        const data = await fetchJson(apiUrl('api/address_book.php'), {
          method: 'PATCH',
          body: JSON.stringify({ id: id, title: title }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Umbenennen fehlgeschlagen.');
        }
        closeAddressbookRenameDialog();
        if (NRAddressbookDialog && typeof NRAddressbookDialog.refresh === 'function') {
          void NRAddressbookDialog.refresh();
        }
      } catch (err) {
        // Minimal: Input beibehalten; Fehler nicht als alert spammen.
      }
    });
  }
  if (addressbookRenameDialog) {
    addressbookRenameDialog.addEventListener('click', function (ev) {
      if (ev.target === addressbookRenameDialog) {
        closeAddressbookRenameDialog();
      }
    });
  }

  function openAddressbookDeleteConfirm(id, title) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) {
      return;
    }
    addressbookDeletePendingId = Math.floor(n);
    addressbookDeletePendingTitle = title ? String(title) : '';
    if (addressbookDeleteText) {
      const name = addressbookDeletePendingTitle.trim() ? addressbookDeletePendingTitle.trim() : 'Eintrag';
      addressbookDeleteText.textContent =
        'Der Eintrag „' + name + '“ wird gelöscht und kann nicht wiederhergestellt werden. Wirklich löschen?';
    }
    if (addressbookDeleteDialog) {
      addressbookDeleteDialog.hidden = false;
      addressbookDeleteDialog.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('addressbook-delete-open');
  }

  function closeAddressbookDeleteConfirm() {
    addressbookDeletePendingId = null;
    addressbookDeletePendingTitle = '';
    if (addressbookDeleteDialog) {
      addressbookDeleteDialog.hidden = true;
      addressbookDeleteDialog.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('addressbook-delete-open');
  }

  if (addressbookDeleteCancel) {
    addressbookDeleteCancel.addEventListener('click', function () {
      closeAddressbookDeleteConfirm();
    });
  }
  if (addressbookDeleteConfirm) {
    addressbookDeleteConfirm.addEventListener('click', async function () {
      const id = addressbookDeletePendingId;
      if (!id) {
        closeAddressbookDeleteConfirm();
        return;
      }
      try {
        const data = await fetchJson(apiUrl('api/address_book.php'), {
          method: 'DELETE',
          body: JSON.stringify({ id: id }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Löschen fehlgeschlagen.');
        }
        closeAddressbookDeleteConfirm();
        if (NRAddressbookDialog && typeof NRAddressbookDialog.refresh === 'function') {
          void NRAddressbookDialog.refresh();
        }
      } catch (err) {
        if (addressbookDeleteText) {
          addressbookDeleteText.textContent = err && err.message ? err.message : String(err);
        }
      }
    });
  }
  if (addressbookDeleteDialog) {
    addressbookDeleteDialog.addEventListener('click', function (ev) {
      if (ev.target === addressbookDeleteDialog) {
        closeAddressbookDeleteConfirm();
      }
    });
  }

  if (btnAddressbookStart) {
    btnAddressbookStart.addEventListener('click', function () {
      NRAddressbookDialog.show('start');
    });
  }
  if (btnAddressbookGoal) {
    btnAddressbookGoal.addEventListener('click', function () {
      NRAddressbookDialog.show('goal');
    });
  }
  if (btnAddressbookSaveStart) {
    btnAddressbookSaveStart.addEventListener('click', function () {
      void saveAddressbookFromCurrentPointsInteractive('start');
    });
  }
  if (btnAddressbookSaveGoal) {
    btnAddressbookSaveGoal.addEventListener('click', function () {
      void saveAddressbookFromCurrentPointsInteractive('goal');
    });
  }

  const NRWakelock = (function () {
    const KEY = 'nr_wake_lock';
    /** @type {any} */
    let sentinel = null;
    let enabled = false;

    function supports() {
      return !!(navigator && navigator.wakeLock && typeof navigator.wakeLock.request === 'function');
    }

    function setEnabled(v) {
      enabled = !!v;
      try {
        localStorage.setItem(KEY, enabled ? '1' : '0');
      } catch (e0) {
        /* ignore */
      }
      if (wakeLockToggle) {
        wakeLockToggle.checked = enabled;
      }
    }

    function loadPref() {
      try {
        return localStorage.getItem(KEY) === '1';
      } catch (e0) {
        return false;
      }
    }

    async function release() {
      if (!sentinel) return;
      try {
        await sentinel.release();
      } catch (e0) {
        /* ignore */
      } finally {
        sentinel = null;
      }
    }

    async function request() {
      if (!enabled || !supports()) return false;
      if (document.visibilityState !== 'visible') return false;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (sentinel && typeof sentinel.addEventListener === 'function') {
          sentinel.addEventListener('release', function () {
            sentinel = null;
          });
        }
        return true;
      } catch (e) {
        // Browser blockt evtl. ohne User-Geste → später erneut versuchen.
        sentinel = null;
        return false;
      }
    }

    function init() {
      setEnabled(loadPref());
      if (wakeLockToggle) {
        wakeLockToggle.addEventListener('change', function () {
          setEnabled(!!wakeLockToggle.checked);
          if (enabled) {
            void request();
          } else {
            void release();
          }
        });
      }
      document.addEventListener('visibilitychange', function () {
        if (!enabled) return;
        if (document.visibilityState === 'visible') {
          void request();
        } else {
          void release();
        }
      });

      // Beim Laden einmal versuchen (falls Browser es erlaubt); sonst bei erster Interaktion erneut.
      void request();
      const retryOnce = function () {
        window.removeEventListener('pointerdown', retryOnce, true);
        window.removeEventListener('keydown', retryOnce, true);
        void request();
      };
      window.addEventListener('pointerdown', retryOnce, true);
      window.addEventListener('keydown', retryOnce, true);
    }

    return { init: init, request: request, release: release, supports: supports };
  })();

  try {
    NRWakelock.init();
  } catch (e0) {
    /* ignore */
  }

  async function runGeocode(placeInput, streetInput, suggestUl, setFn) {
    const place = placeInput ? placeInput.value.trim() : '';
    const street = streetInput ? streetInput.value.trim() : '';
    if (place.length + street.length < 3) {
      NRMessageDialog.show('Bitte Ort und/oder Straße eingeben (mindestens 3 Zeichen zusammen).');
      return;
    }
    const params = new URLSearchParams();
    if (place) params.set('place', place);
    if (street) params.set('street', street);
    try {
      const data = await fetchGetJson(apiUrl('api/geocode.php?' + params.toString()));
      if (!data.ok) throw new Error(data.error || 'Suche fehlgeschlagen');
      if (!data.results || data.results.length === 0) {
        alert('Keine Treffer. Bitte Schreibweise prüfen oder Ort ergänzen.');
        clearSuggestionList(suggestUl);
        return;
      }
      if (data.results.length === 1) {
        const ll = L.latLng(data.results[0].lat, data.results[0].lon);
        setFn(ll);
        map.setView(ll, Math.max(map.getZoom(), 15));
        return;
      }
      renderGeoSuggestions(suggestUl, data.results, function (ll) {
        setFn(ll);
        map.setView(ll, Math.max(map.getZoom(), 15));
      });
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  document.getElementById('btn-geocode-goal').addEventListener('click', function () {
    runGeocode(goalPlaceEl, goalStreetEl, goalSuggestEl, setGoal);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      clearSuggestionList(startSuggestEl);
      clearSuggestionList(goalSuggestEl);
      if (getRtMode() === 'waypoints' && state.rtWaypoints.length) {
        popRtWaypoint();
      }
    }
  });

  function setStart(latlng) {
    state.start = latlng;
    if (startMarker) map.removeLayer(startMarker);
    const startIcon = L.divIcon({
      className: 'route-pin route-pin-start',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      html: '<span class="route-pin-dot" aria-hidden="true"></span>',
    });
    startMarker = L.marker(latlng, {
      icon: startIcon,
      draggable: true,
      title: getRtMode() === 'waypoints' ? 'Start & Ende des Rundkurses (ziehen)' : 'Start',
      zIndexOffset: 1100,
    }).addTo(map);
    startMarker.on('dragend', function (e) {
      state.start = e.target.getLatLng();
      updatePointStatus();
      if (getRtMode() === 'waypoints') {
        syncRtWaypointCounterUi();
      }
    });
    updatePointStatus();
    refreshRouteButton();
    if (getRtMode() === 'waypoints') {
      syncRtWaypointCounterUi();
    }
    if (state.goal) {
      NRAddressbookAutosave.schedule();
    }
  }

  function setStartFromCurrentGps() {
    if (!navigator.geolocation) {
      alert('GPS wird von diesem Browser nicht unterstützt.');
      return;
    }
    nrGeoGetCurrentPosition(
      function (pos) {
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
        setStart(ll);
        void reverseFillAddressFields(ll, startPlaceEl, startStreetEl);
        map.panTo(state.start);
      },
      function (err) {
        nrGeoAlert(err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  document.getElementById('btn-geocode-start').addEventListener('click', function () {
    setStartFromCurrentGps();
  });
  const btnRtStartGps = document.getElementById('btn-rt-start-gps');
  if (btnRtStartGps) {
    btnRtStartGps.addEventListener('click', function () {
      setStartFromCurrentGps();
    });
  }
  document.getElementById('btn-geocode-start-address').addEventListener('click', function () {
    runGeocode(startPlaceEl, startStreetEl, startSuggestEl, setStart);
  });

  function setGoal(latlng) {
    state.goal = latlng;
    if (goalMarker) map.removeLayer(goalMarker);
    const goalIcon = L.divIcon({
      className: 'route-pin route-pin-goal',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      html: '<span class="route-pin-dot" aria-hidden="true"></span>',
    });
    goalMarker = L.marker(latlng, { icon: goalIcon, draggable: true, title: 'Ziel' }).addTo(map);
    goalMarker.on('dragend', function (e) {
      state.goal = e.target.getLatLng();
      updatePointStatus();
    });
    updatePointStatus();
    refreshRouteButton();
    if (state.start) {
      NRAddressbookAutosave.schedule();
    }
  }

  function addVia(latlng) {
    if (state.vias.length >= 8) return;
    state.vias.push(latlng);
    const m = L.marker(latlng, { draggable: true, title: 'Zwischenstopp' }).addTo(map);
    const idx = state.vias.length - 1;
    m.on('dragend', function (e) {
      state.vias[idx] = e.target.getLatLng();
    });
    viaMarkers.push(m);
    updatePointStatus();
  }

  map.on('click', function (e) {
    if (getRtMode() === 'waypoints') {
      pushRtWaypoint(e.latlng);
      return;
    }
    if (e.originalEvent && e.originalEvent.shiftKey) {
      addVia(e.latlng);
      return;
    }
    if (!state.start) {
      setStart(e.latlng);
    } else if (!state.goal) {
      setGoal(e.latlng);
    } else {
      setGoal(e.latlng);
    }
  });

  map.on('moveend', scheduleNoExitHighlightRefresh);

  const NR_PROFILE_ALLOWED = new Set(['natur', 'gravel', 'offroad', 'kurvig', 'ruhig', 'radwege', 'abenteuer']);
  const NR_PROFILE_STORAGE_KEY = 'nr_last_profile_local';
  let activeProfile = 'natur';

  function normalizeProfile(v) {
    const key = typeof v === 'string' ? v.trim() : '';
    if (!key) return '';
    return NR_PROFILE_ALLOWED.has(key) ? key : '';
  }

  function loadProfileLocal() {
    try {
      return normalizeProfile(localStorage.getItem(NR_PROFILE_STORAGE_KEY));
    } catch (e0) {
      return '';
    }
  }

  function saveProfileLocal(v) {
    const key = normalizeProfile(v);
    try {
      localStorage.setItem(NR_PROFILE_STORAGE_KEY, key || '');
    } catch (e0) {
      /* ignore */
    }
  }

  function currentProfile() {
    return activeProfile || 'natur';
  }

  function setCurrentProfile(profile) {
    activeProfile = normalizeProfile(profile) || 'natur';
  }

  const NRProfile = (function () {
    const labels = {
      natur: 'Naturroute',
      gravel: 'Schotterroute',
      offroad: 'Feld-/Waldwege',
      kurvig: 'Kurvenreich',
      ruhig: 'Ruhige Route',
      radwege: 'Nur Radwege',
      abenteuer: 'Abenteuerroute',
    };

    function labelFor(v) {
      const key = typeof v === 'string' ? v : '';
      return labels[key] || 'Naturroute';
    }

    function loadLocal() {
      return loadProfileLocal();
    }

    function saveLocal(v) {
      saveProfileLocal(v);
    }

    function syncCurrentLabel() {
      if (!profileCurrentValue) return;
      profileCurrentValue.textContent = labelFor(currentProfile());
    }

    function openDialog() {
      if (!profileDialog) return;
      profileDialog.hidden = false;
      profileDialog.setAttribute('aria-hidden', 'false');
      document.body.classList.add('profile-dialog-open');
      syncDialogSelection();
      window.setTimeout(function () {
        const btn = profileDialog.querySelector('.profile-dialog-btn.is-selected');
        (btn || profileDialogClose || profileDialog).focus?.();
      }, 0);
    }

    function closeDialog() {
      if (!profileDialog) return;
      profileDialog.hidden = true;
      profileDialog.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('profile-dialog-open');
    }

    function syncDialogSelection() {
      if (!profileDialog) return;
      const cur = currentProfile();
      profileDialog.querySelectorAll('.profile-dialog-btn').forEach(function (btn) {
        const p = btn && btn.dataset ? btn.dataset.profile : '';
        btn.classList.toggle('is-selected', p === cur);
        btn.classList.toggle('btn-primary', p === cur);
        btn.classList.toggle('btn-secondary', p !== cur);
      });
    }

    function apply(v, opts) {
      const next = normalizeProfile(v) || 'natur';
      setCurrentProfile(next);
      saveLocal(next);
      syncCurrentLabel();
      syncDialogSelection();

      // Bestehendes Verhalten beibehalten: serverseitig als "lastProfile" merken.
      if (opts && opts.skipServer !== true) {
        fetchJson(apiUrl('api/settings.php'), {
          method: 'POST',
          body: JSON.stringify({ lastProfile: next }),
        }).catch(function () {});
      }

      NRAddressbookAutosave.schedule();
    }

    function init() {
      const local = loadLocal();
      if (local) {
        apply(local, { skipServer: true });
      } else {
        syncCurrentLabel();
      }

      const btnTopRoutingProfile = document.getElementById('btn-top-routing-profile');
      if (btnTopRoutingProfile) {
        btnTopRoutingProfile.addEventListener('click', function () {
          openDialog();
        });
      }

      const btnPanelRoutingProfile = document.getElementById('btn-panel-routing-profile');
      if (btnPanelRoutingProfile) {
        btnPanelRoutingProfile.addEventListener('click', function () {
          openDialog();
        });
      }
      if (profileDialogClose) {
        profileDialogClose.addEventListener('click', function () {
          closeDialog();
        });
      }
      if (profileDialog) {
        profileDialog.addEventListener('mousedown', function (ev) {
          if (ev.target === profileDialog) {
            closeDialog();
          }
        });
        profileDialog.querySelectorAll('.profile-dialog-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const p = btn && btn.dataset ? btn.dataset.profile : '';
            apply(p);
            closeDialog();
          });
        });
      }

      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && profileDialog && !profileDialog.hidden) {
          closeDialog();
        }
      });
    }

    return { init: init, apply: apply, syncCurrentLabel: syncCurrentLabel, openDialog: openDialog };
  })();

  // Max-Umweg-Slider wurde entfernt: Routing läuft ohne Detour-Limit.
  function maxDetourKmFromUi() {
    return 0;
  }

  function rtRoundtripDistanceKmFromUi() {
    const el = document.getElementById('rt-radius-km');
    if (!el) {
      return 8;
    }
    const v = parseFloat(el.value);
    return Number.isNaN(v) ? 8 : Math.max(1, Math.min(120, v));
  }

  function syncRtRadiusLabel() {
    const el = document.getElementById('rt-radius-km');
    const lab = document.getElementById('rt-radius-label');
    if (!el || !lab) {
      return;
    }
    const km = rtRoundtripDistanceKmFromUi();
    lab.textContent = String(km).replace('.', ',') + ' km';
    el.setAttribute('aria-valuenow', String(km));
  }

  const rtRadiusSlider = document.getElementById('rt-radius-km');
  if (rtRadiusSlider) {
    const syncRt = function () {
      syncRtRadiusLabel();
    };
    rtRadiusSlider.addEventListener('input', syncRt);
    rtRadiusSlider.addEventListener('change', syncRt);
    syncRtRadiusLabel();
  }

  document.querySelectorAll('input[name="rt_mode"]').forEach(function (radio) {
    radio.addEventListener('change', onRtModeChange);
  });
  const btnRtWpUndo = document.getElementById('btn-rt-wp-undo');
  if (btnRtWpUndo) {
    btnRtWpUndo.addEventListener('click', function () {
      popRtWaypoint();
    });
  }
  syncRtRoundtripPanelUi();
  syncRtWaypointCounterUi();

  try {
    NRProfile.init();
  } catch (e0) {
    /* ignore */
  }

  document.getElementById('btn-clear').addEventListener('click', clearAll);

  if (btnAuthToggleRegister) {
    btnAuthToggleRegister.addEventListener('click', function () {
      const nextMode = !authDisplayNameWrap || authDisplayNameWrap.hidden;
      setAuthRegisterMode(nextMode);
      setHintMessage(authMessage, '');
      window.setTimeout(function () {
        if (nextMode && authDisplayName) {
          authDisplayName.focus();
          return;
        }
        if (authEmail) {
          authEmail.focus();
        }
      }, 0);
    });
  }

  if (btnOrsApiKeySave) {
    btnOrsApiKeySave.addEventListener('click', async function () {
      if (!state.currentUser) {
        updateAuthUi();
        return;
      }
      const nextKey = orsApiKeyInput ? String(orsApiKeyInput.value || '').trim() : '';
      try {
        const data = await fetchJson(apiUrl('api/settings.php'), {
          method: 'POST',
          body: JSON.stringify({ orsApiKey: nextKey }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'API-Key konnte nicht gespeichert werden.');
        }
        if (orsApiKeyInput) {
          orsApiKeyInput.value = nextKey;
        }
        setHintMessage(
          authPanelMessage,
          nextKey ? 'ORS-API-Key gespeichert.' : 'ORS-API-Key entfernt. Standard-Key wird wieder verwendet.'
        );
      } catch (err) {
        setHintMessage(authPanelMessage, err.message || String(err));
      }
    });
  }
  if (navDebugLogEnabledInput) {
    navDebugLogEnabledInput.addEventListener('change', async function () {
      if (!state.currentUser) {
        updateAuthUi();
        return;
      }
      const enabled = !!navDebugLogEnabledInput.checked;
      try {
        const data = await fetchJson(apiUrl('api/settings.php'), {
          method: 'POST',
          body: JSON.stringify({ navDebugLogEnabled: enabled }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Log-Schalter konnte nicht gespeichert werden.');
        }
        window.NR_NAV_DEBUG_LOG_ENABLED = enabled;
        setHintMessage(authPanelMessage, enabled ? 'Debug-Logdatei ist aktiviert.' : 'Debug-Logdatei ist deaktiviert.');
      } catch (err) {
        navDebugLogEnabledInput.checked = !enabled;
        window.NR_NAV_DEBUG_LOG_ENABLED = !!navDebugLogEnabledInput.checked;
        setHintMessage(authPanelMessage, err.message || String(err));
      }
    });
  }

  if (btnAuthRegister) {
    btnAuthRegister.addEventListener('click', async function () {
      setAuthRegisterMode(true);
      const displayName = authDisplayName ? authDisplayName.value.trim() : '';
      const registerApiKey = authRegisterApiKey ? authRegisterApiKey.value.trim() : '';
      const email = authEmail ? authEmail.value.trim() : '';
      const password = authPassword ? authPassword.value : '';
      if (displayName.length < 2) {
        setHintMessage(authMessage, 'Bitte einen Anzeigenamen eingeben (2–120 Zeichen, wird in der App angezeigt).');
        if (authDisplayName) {
          authDisplayName.focus();
        }
        return;
      }
      if (!email) {
        setHintMessage(authMessage, 'Bitte Ihre E-Mail-Adresse eingeben.');
        if (authEmail) {
          authEmail.focus();
        }
        return;
      }
      if (!password || password.length < 8) {
        setHintMessage(authMessage, 'Bitte ein Passwort mit mindestens 8 Zeichen eingeben.');
        if (authPassword) {
          authPassword.focus();
        }
        return;
      }
      try {
        const data = await fetchJson(apiUrl('api/auth_register.php'), {
          method: 'POST',
          body: JSON.stringify({
            display_name: displayName,
            email: email,
            password: password,
            orsApiKey: registerApiKey,
          }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Registrierung fehlgeschlagen.');
        }
        setRegistrationApiKeyHint();
        clearAuthFields({ clearDisplayName: true, clearEmail: true, clearApiKey: true });
        setAuthRegisterMode(false);
        updateAuthUi();
      } catch (err) {
        clearAuthFields();
        setHintMessage(authMessage, err.message || String(err));
      }
    });
  }

  if (btnAuthLogin) {
    btnAuthLogin.addEventListener('click', async function () {
      setAuthRegisterMode(false);
      try {
        const data = await fetchJson(apiUrl('api/auth_login.php'), {
          method: 'POST',
          body: JSON.stringify({
            email: authEmail ? authEmail.value.trim() : '',
            password: authPassword ? authPassword.value : '',
          }),
        });
        if (!data.ok || !data.user) {
          throw new Error(data.error || 'Anmeldung fehlgeschlagen.');
        }
        clearUserScopedClientState();
        state.currentUser = data.user;
        setHintMessage(authMessage, 'Erfolgreich angemeldet.');
        clearAuthFields({ clearDisplayName: true, clearEmail: true });
        updateAuthUi();
        NRKontoDialog.hide();
        await loadUserSettings();
        await loadSavedRoutes();
        refreshRouteButton();
        ensureTtsAfterLogin();
        maybeShowPiperFirstLoadHintAfterLogin();
        nrWarnOrsKeyMissingAfterLoginDeferred();
      } catch (err) {
        clearAuthFields();
        setHintMessage(authMessage, err.message || String(err));
      }
    });
  }

  const btnAuthLogout = document.getElementById('btn-auth-logout');
  if (btnAuthLogout) {
    btnAuthLogout.addEventListener('click', async function () {
      try {
        const data = await fetchJson(apiUrl('api/auth_logout.php'), {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Abmeldung fehlgeschlagen.');
        }
        clearUserScopedClientState();
        state.currentUser = null;
        clearAuthFields({ clearDisplayName: true, clearEmail: true });
        setHintMessage(authMessage, 'Abgemeldet.');
        setAuthRegisterMode(false);
        updateAuthUi();
        refreshRouteButton();
      } catch (err) {
        setHintMessage(authMessage, err.message || String(err));
      }
    });
  }

  if (btnAuthForgot) {
    btnAuthForgot.addEventListener('click', async function () {
      setAuthRegisterMode(false);
      try {
        const data = await fetchJson(apiUrl('api/auth_request_reset.php'), {
          method: 'POST',
          body: JSON.stringify({
            email: authEmail ? authEmail.value.trim() : '',
          }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Passwort-Link konnte nicht angefordert werden.');
        }
        clearAuthFields();
        setHintMessage(
          authMessage,
          data.message ||
            'Wenn die Adresse bekannt ist, wurde eine E-Mail zum Zurücksetzen oder Bestätigen versendet.'
        );
      } catch (err) {
        setHintMessage(authMessage, err.message || String(err));
      }
    });
  }

  if (authDialog) {
    authDialog.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.shiftKey) {
        return;
      }
      const target = ev.target;
      if (target && (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA')) {
        return;
      }
      ev.preventDefault();
      if (btnAuthRegister && !btnAuthRegister.hidden) {
        btnAuthRegister.click();
        return;
      }
      if (btnAuthLogin && !btnAuthLogin.hidden) {
        btnAuthLogin.click();
      }
    });
  }

  if (btnSavedRoutesManage) {
    btnSavedRoutesManage.addEventListener('click', function () {
      openSavedRoutesManageDialog();
    });
  }
  if (savedRoutesManageClose) {
    savedRoutesManageClose.addEventListener('click', function () {
      closeSavedRoutesManageDialog();
    });
  }

  const btnRouteSave = document.getElementById('btn-route-save');
  if (btnRouteSave) {
    btnRouteSave.addEventListener('click', async function () {
      const snapshot = routeSnapshotForSave();
      if (!snapshot) {
        setHintMessage(savedRoutesMessage, 'Es gibt aktuell keine Route zum Speichern.');
        return;
      }
      try {
        const routeData = snapshot.routeData || {};
        const suggestedTitle = buildSavedRouteTitleSuggestion(routeData);
        const title = savedRouteTitle ? savedRouteTitle.value.trim() : '';
        const data = await fetchJson(apiUrl('api/saved_routes.php'), {
          method: 'POST',
          body: JSON.stringify({
            title: title || suggestedTitle || 'Route ' + new Date().toLocaleString('de-DE'),
            profile: currentProfile(),
            route_kind: routeKindFromRouteData(routeData),
            distance_km: routeData.distance || null,
            duration_min: routeData.duration || null,
            payload: snapshot,
          }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Speichern fehlgeschlagen.');
        }
        setHintMessage(savedRoutesMessage, 'Route gespeichert.');
        await loadSavedRoutes();
      } catch (err) {
        setHintMessage(savedRoutesMessage, err.message || String(err));
      }
    });
  }

  const btnRouteRefresh = document.getElementById('btn-route-refresh');
  if (btnRouteRefresh) {
    btnRouteRefresh.addEventListener('click', function () {
      void loadSavedRoutes();
    });
  }

  if (savedRouteDeleteCancel) {
    savedRouteDeleteCancel.addEventListener('click', function () {
      closeSavedRouteDeleteConfirm();
    });
  }
  if (savedRouteDeleteConfirm) {
    savedRouteDeleteConfirm.addEventListener('click', async function () {
      const id = savedRouteDeletePendingId;
      if (id == null) {
        closeSavedRouteDeleteConfirm();
        return;
      }
      try {
        const data = await fetchJson(apiUrl('api/saved_routes.php'), {
          method: 'DELETE',
          body: JSON.stringify({ id: id }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Löschen fehlgeschlagen.');
        }
        closeSavedRouteDeleteConfirm();
        await loadSavedRoutes();
        setHintMessage(savedRoutesMessage, 'Route wurde gelöscht.');
      } catch (err) {
        closeSavedRouteDeleteConfirm();
        setHintMessage(savedRoutesMessage, err.message || String(err));
      }
    });
  }
  if (savedRouteDeleteDialog) {
    savedRouteDeleteDialog.addEventListener('click', function (ev) {
      if (ev.target === savedRouteDeleteDialog) {
        closeSavedRouteDeleteConfirm();
      }
    });
  }
  if (savedRouteRenameCancel) {
    savedRouteRenameCancel.addEventListener('click', function () {
      closeSavedRouteRenameDialog();
    });
  }
  if (savedRouteRenameConfirm) {
    savedRouteRenameConfirm.addEventListener('click', async function () {
      const pending = savedRouteRenamePending;
      const trimmedTitle = savedRouteRenameInput ? String(savedRouteRenameInput.value || '').trim() : '';
      if (!pending) {
        closeSavedRouteRenameDialog();
        return;
      }
      if (!trimmedTitle) {
        setHintMessage(savedRoutesMessage, 'Bitte einen neuen Namen für die Route vergeben.');
        if (savedRouteRenameInput) {
          savedRouteRenameInput.focus();
        }
        return;
      }
      if (trimmedTitle === String(pending.title || '')) {
        closeSavedRouteRenameDialog();
        return;
      }
      try {
        const data = await fetchJson(apiUrl('api/saved_routes.php'), {
          method: 'PATCH',
          body: JSON.stringify({
            id: pending.id,
            title: trimmedTitle,
          }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Route konnte nicht umbenannt werden.');
        }
        closeSavedRouteRenameDialog();
        setHintMessage(savedRoutesMessage, 'Route wurde in "' + trimmedTitle + '" umbenannt.');
        await loadSavedRoutes();
      } catch (err) {
        setHintMessage(savedRoutesMessage, err.message || String(err));
      }
    });
  }
  if (savedRouteRenameDialog) {
    savedRouteRenameDialog.addEventListener('click', function (ev) {
      if (ev.target === savedRouteRenameDialog) {
        closeSavedRouteRenameDialog();
      }
    });
  }
  if (navFeedbackSkip) {
    navFeedbackSkip.addEventListener('click', function () {
      closeNavFeedbackDialog();
    });
  }
  if (btnPanelFeedback) {
    btnPanelFeedback.addEventListener('click', function () {
      openNavFeedbackDialog();
    });
  }
  if (navFeedbackDialog) {
    navFeedbackDialog.addEventListener('click', function (ev) {
      if (ev.target === navFeedbackDialog) {
        closeNavFeedbackDialog();
      }
    });
  }
  if (navFeedbackSubmit) {
    navFeedbackSubmit.addEventListener('click', async function () {
      const name = navFeedbackName ? String(navFeedbackName.value || '').trim() : '';
      const email = navFeedbackEmail ? String(navFeedbackEmail.value || '').trim() : '';
      const message = navFeedbackMessage ? String(navFeedbackMessage.value || '').trim() : '';
      if (!name || !email || !message) {
        setHintMessage(navFeedbackStatus, 'Bitte Name, E-Mail-Adresse und Feedback ausfüllen.');
        return;
      }
      navFeedbackSubmit.disabled = true;
      try {
        const data = await fetchJson(apiUrl('api/nav_feedback.php'), {
          method: 'POST',
          body: JSON.stringify({
            name: name,
            email: email,
            message: message,
            route: state.lastRoute
              ? {
                  profil: state.lastRoute.profil || currentProfile(),
                  distance: state.lastRoute.distance || null,
                  duration: state.lastRoute.duration || null,
                  roundtrip_mode: state.lastRoute.roundtrip_mode || null,
                }
              : null,
          }),
        });
        if (!data.ok) {
          throw new Error(data.error || 'Feedback konnte nicht gesendet werden.');
        }
        setHintMessage(navFeedbackStatus, 'Danke, das Feedback wurde gesendet.');
        window.setTimeout(closeNavFeedbackDialog, 650);
      } catch (err) {
        setHintMessage(navFeedbackStatus, err.message || String(err));
      } finally {
        navFeedbackSubmit.disabled = false;
      }
    });
  }
  document.addEventListener('nr-nav-ended', function () {
    openNavFeedbackDialog();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') {
      return;
    }
    if (navFeedbackDialog && !navFeedbackDialog.hidden) {
      closeNavFeedbackDialog();
      return;
    }
    if (savedRouteRenameDialog && !savedRouteRenameDialog.hidden) {
      closeSavedRouteRenameDialog();
      return;
    }
    if (savedRouteDeleteDialog && !savedRouteDeleteDialog.hidden) {
      closeSavedRouteDeleteConfirm();
      return;
    }
    if (addressbookDeleteDialog && !addressbookDeleteDialog.hidden) {
      closeAddressbookDeleteConfirm();
      return;
    }
    if (addressbookRenameDialog && !addressbookRenameDialog.hidden) {
      closeAddressbookRenameDialog();
    }
  });
  if (savedRouteRenameInput) {
    savedRouteRenameInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && savedRouteRenameConfirm) {
        event.preventDefault();
        savedRouteRenameConfirm.click();
      }
    });
  }

  const btnMapNoexit = document.getElementById('btn-map-noexit');
  if (btnMapNoexit) {
    btnMapNoexit.addEventListener('click', function () {
      setNoExitHighlightMode(!state.noExitHighlightActive);
    });
  }
  const btnMapNoexitClear = document.getElementById('btn-map-noexit-clear');
  if (btnMapNoexitClear) {
    btnMapNoexitClear.addEventListener('click', function () {
      if (state.noExitHighlightActive && state.lastRoute && state.lastRoute.geometry) {
        void removeAutoDetectedDeadEndsFromRoute();
        return;
      }
      setNoExitHighlightMode(false);
    });
  }
  const btnMapSurface = document.getElementById('btn-map-surface');
  if (btnMapSurface) {
    btnMapSurface.addEventListener('click', function () {
      setSurfaceViewMode(!state.surfaceViewActive);
    });
  }

  function nrViewportIsSmartphoneStyle() {
    try {
      return window.matchMedia('(max-width: 899px)').matches;
    } catch (e) {
      return typeof window.innerWidth === 'number' && window.innerWidth <= 899;
    }
  }

  function showUserPosition(latlng) {
    if (!userMarker) {
      const icon = L.divIcon({ className: 'user-pos-marker', iconSize: [16, 16] });
      userMarker = L.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(map);
    } else {
      userMarker.setLatLng(latlng);
    }
  }

  document.getElementById('btn-locate').addEventListener('click', function () {
    if (!navigator.geolocation) {
      alert('GPS wird von diesem Browser nicht unterstützt.');
      return;
    }
    nrGeoGetCurrentPosition(
      function (pos) {
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
        showUserPosition(ll);
        map.setView(ll, 14);
      },
      function (err) {
        nrGeoAlert(err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 28000 }
    );
  });

  // "Position verfolgen" Button wurde entfernt.

  document.getElementById('btn-goal-here').addEventListener('click', function () {
    if (!navigator.geolocation) {
      alert('GPS wird von diesem Browser nicht unterstützt.');
      return;
    }
    nrGeoGetCurrentPosition(
      function (pos) {
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
        setGoal(ll);
        void reverseFillAddressFields(ll, goalPlaceEl, goalStreetEl);
        map.panTo(state.goal);
      },
      function (err) {
        nrGeoAlert(err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 28000 }
    );
  });

  function cumulativeDistances(geometry) {
    const d = [0];
    let sum = 0;
    for (let i = 1; i < geometry.length; i++) {
      sum += map.distance(L.latLng(geometry[i - 1][0], geometry[i - 1][1]), L.latLng(geometry[i][0], geometry[i][1]));
      d.push(sum);
    }
    return d;
  }

  function setRouteBusyVisible(visible) {
    if (!routeBusyOverlay) {
      return;
    }
    if (visible) {
      routeBusyCloseHandler = null;
      routeBusyNavStartHandler = null;
      if (routeBusyActions) {
        routeBusyActions.hidden = true;
      }
      if (routeBusyClose) {
        routeBusyClose.hidden = true;
        routeBusyClose.textContent = 'Schließen';
      }
      if (routeBusyNavStart) {
        routeBusyNavStart.hidden = true;
        routeBusyNavStart.disabled = true;
        routeBusyNavStart.textContent = 'Navigation starten';
      }
      try {
        routeBusyOverlay.removeAttribute('data-mode');
      } catch (e0) {
        /* ignore */
      }
    }
    routeBusyOverlay.hidden = !visible;
    routeBusyOverlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function configureRouteBusyActions(opts) {
    if (!routeBusyActions) {
      return;
    }
    const show = !!(opts && opts.show);
    routeBusyActions.hidden = !show;
    routeBusyCloseHandler = show && opts && typeof opts.onClose === 'function' ? opts.onClose : null;
    const cancelOnly = !!(state && state._nrRouteBusyCancelOnly);
    routeBusyNavStartHandler = !cancelOnly && show && opts && typeof opts.onNavStart === 'function' ? opts.onNavStart : null;
    if (routeBusyOverlay) {
      try {
        if (cancelOnly) {
          routeBusyOverlay.setAttribute('data-mode', 'cancel-only');
        } else {
          routeBusyOverlay.removeAttribute('data-mode');
        }
      } catch (e0) {
        /* ignore */
      }
    }
    if (routeBusyClose) {
      routeBusyClose.hidden = !show || !!(opts && opts.hideClose);
      routeBusyClose.textContent = (opts && opts.closeLabel) || 'Schließen';
    }
    if (routeBusyNavStart) {
      routeBusyNavStart.hidden = !show || cancelOnly || !!(opts && opts.hideNavStart);
      routeBusyNavStart.textContent = (opts && opts.navStartLabel) || 'Navigation starten';
      routeBusyNavStart.disabled = !show || cancelOnly || !!(opts && opts.navStartDisabled);
    }
  }

  function inferRouteBusyStage(title, detail) {
    const text = String(title || '') + ' ' + String(detail || '');
    if (/fertig|bereit/i.test(text)) {
      return 'done';
    }
    if (/bereinig|Sackgassen|Prüfung/i.test(text)) {
      return 'clean';
    }
    if (/Karte|Linie|Zoom|Statistik|angezeigt|aufgebaut|Navigation/i.test(text)) {
      return 'map';
    }
    if (/Rundkurs|Rundkurse|Variante|OpenRouteService|Server/i.test(text)) {
      return 'roundtrip';
    }
    return 'route';
  }

  function setRouteBusyStage(stage) {
    if (!routeBusyVisual) {
      return;
    }
    routeBusyVisual.setAttribute('data-stage', stage || 'route');
  }

  function updateRouteBusyProgress(opts) {
    if (!routeProgressTrack || !routeProgressBar) {
      return;
    }
    const title = opts && opts.title != null ? opts.title : null;
    if (routeBusyTitle && title != null) {
      routeBusyTitle.textContent = title;
    }
    const detail = opts && opts.detail != null ? opts.detail : null;
    if (routeBusyDetail && detail != null) {
      routeBusyDetail.textContent = detail;
    }
    setRouteBusyStage((opts && opts.stage) || inferRouteBusyStage(title, detail));
    const indeterminate = !!(opts && opts.indeterminate);
    if (indeterminate) {
      routeProgressTrack.classList.add('is-indeterminate');
      routeProgressBar.style.width = '38%';
    } else {
      routeProgressTrack.classList.remove('is-indeterminate');
      const p = opts && typeof opts.progress === 'number' ? opts.progress : 0;
      routeProgressBar.style.width = Math.max(0, Math.min(100, p)) + '%';
    }
  }

  function resetRouteBusyBar() {
    if (routeBusyNarrationTimer) {
      window.clearTimeout(routeBusyNarrationTimer);
      routeBusyNarrationTimer = null;
    }
    if (routeBusyTitle) {
      routeBusyTitle.textContent = 'Route wird berechnet';
    }
    setRouteBusyStage('route');
    if (routeProgressTrack) {
      routeProgressTrack.classList.remove('is-indeterminate');
    }
    if (routeProgressBar) {
      routeProgressBar.style.width = '0%';
    }
    if (state) {
      state._nrRouteBusyCancelOnly = false;
    }
    configureRouteBusyActions({ show: false });
  }

  function hideRouteBusyOverlay() {
    setRouteBusyVisible(false);
    resetRouteBusyBar();
    if (routeBusyDetail) {
      routeBusyDetail.textContent = '';
    }
  }

  function startRoundtripBusyNarration(variantCount) {
    if (routeBusyNarrationTimer) {
      window.clearTimeout(routeBusyNarrationTimer);
      routeBusyNarrationTimer = null;
    }
    const count = Math.max(1, variantCount || 1);
    const steps = [
      count + ' Rundkurs-Variante(n) starten: Punkte werden sortiert und zum Routing vorbereitet.',
      'Der Routing-Motor legt fahrbare Schleifen über das Wegenetz.',
      'Teilstücke werden verbunden, Abzweige und Rückwege werden geprüft.',
      'Sackgassen-Detektor läuft: rote Kandidaten werden herausgefiltert.',
      'Varianten werden bewertet, sortiert und für die Karte vorbereitet.',
    ];
    const stages = ['route', 'roundtrip', 'roundtrip', 'clean', 'map'];
    const delays = [0, 2000, 5200, 9000, 13500];
    const rotateHints = [
      'Berechnung läuft weiter: das Wegenetz wird noch nach fahrbaren Verbindungen durchsucht.',
      'Varianten werden gegeneinander geprüft: Distanz, Wegtyp und Schleifenqualität.',
      'Sackgassen und doppelte Rückwege werden automatisch bereinigt.',
      'Kartendaten werden vorbereitet, damit Route und Varianten sofort sichtbar sind.',
      'Fast fertig: letzte Plausibilitätschecks und Darstellung.',
      'Bei großen Rundkursen kann dieser Schritt länger dauern, die App arbeitet weiter.',
    ];
    const rotationDelayMs = 3200;
    const runStep = function (idx) {
      updateRouteBusyProgress({
        title: 'Rundkurse werden berechnet',
        detail: steps[idx],
        indeterminate: true,
        stage: stages[idx],
      });
      if (idx + 1 < steps.length) {
        routeBusyNarrationTimer = window.setTimeout(function () {
          runStep(idx + 1);
        }, delays[idx + 1] - delays[idx]);
      } else {
        let rotIdx = 0;
        const runRotation = function () {
          updateRouteBusyProgress({
            title: 'Rundkurse werden berechnet',
            detail: rotateHints[rotIdx % rotateHints.length],
            indeterminate: true,
            stage: 'map',
          });
          rotIdx++;
          routeBusyNarrationTimer = window.setTimeout(runRotation, rotationDelayMs);
        };
        routeBusyNarrationTimer = window.setTimeout(runRotation, rotationDelayMs);
      }
    };
    runStep(0);
  }

  function cloneLatLonPairs(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.map(function (r) {
      if (!Array.isArray(r) || r.length < 2) {
        return [0, 0];
      }
      return [Number(r[0]), Number(r[1])];
    });
  }

  /**
   * Parameter für Neu-Routing bei Abweichung von der Linie (Navigation).
   * @param {{ roundtrip_mode?: string, geometry?: array }} data
   */
  function buildNrRerouteSnapshotForRoute(data) {
    try {
      const profil = currentProfile();
      const md = maxDetourKmFromUi();
      const mdVal = md > 0 ? md : null;
      if (data.roundtrip_mode === 'waypoints_loop' && state.start && state.rtWaypoints.length >= 2) {
        return {
          kind: 'waypoints_loop',
          waypoints: cloneLatLonPairs(
            [[state.start.lat, state.start.lng]].concat(
              state.rtWaypoints.map(function (ll) {
                return [ll.lat, ll.lng];
              })
            )
          ),
          profil: profil,
        };
      }
      if (data.roundtrip_mode === 'circle_loop' && state.start) {
        return {
          kind: 'circle_loop',
          distance_km: rtRoundtripDistanceKmFromUi(),
          profil: profil,
        };
      }
      if (!data.roundtrip_mode && state.start && state.goal) {
        const via =
          state.vias.length > 0
            ? cloneLatLonPairs(
                state.vias.map(function (v) {
                  return [v.lat, v.lng];
                })
              )
            : null;
        return {
          kind: 'p2p',
          ziel: [state.goal.lat, state.goal.lng],
          via: via,
          profil: profil,
          max_detour_km: mdVal,
        };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  /**
   * ORS-Manövertypen, die KEIN Abbiegen sind und daher nicht als Wieder-Aufnahme-Wegpunkt dienen:
   * 6 = straight, 10 = finish, 11 = depart. Alles andere (Abbiegungen, Kreisverkehre, U-Turns,
   * Spurführungen) ist ein gültiger „Wegpunkt mit Abbiegen“.
   */
  const NAV_REROUTE_NON_TURN_TYPES = new Set([6, 10, 11]);
  /** Mindestabstand vom Off-Route-Punkt zum nächsten Manöver-Wegpunkt (in Metern). */
  const NAV_REROUTE_MIN_AHEAD_M = 50;
  /** Maximale Vorwärts-Distanz, in der ein Manöver-Wegpunkt akzeptiert wird (Notfall-Cap). */
  const NAV_REROUTE_MAX_AHEAD_M = 5000;
  /** Anker-Distanz vor dem Ziel, um ORS in Streckenrichtung zu führen. */
  const NAV_REROUTE_ANCHOR_BACK_M = 60;
  /**
   * Fallback-Heuristik (geometrischer Punkt), wenn keine passenden Manöver-Steps existieren.
   * Mindest-/Maximal-Vorwärts skalieren mit Cross-Track-Abstand: bei großem Off-Track muss der
   * Rejoin-Punkt weiter vorne liegen, sonst routet ORS einen unnötigen Rückwärts-Bogen.
   */
  const NAV_REROUTE_FALLBACK_MIN_AHEAD_M = 180;
  const NAV_REROUTE_FALLBACK_MAX_AHEAD_M = 650;
  const NAV_REROUTE_FALLBACK_MIN_FACTOR = 0.6;
  const NAV_REROUTE_FALLBACK_MAX_FACTOR = 2.4;
  /**
   * Bearing-Plausibilität: wenn die User-Bewegung mehr als diesen Winkel von der Original-Strecke
   * am Rejoin-Anker abweicht, wird ein deutlich weiter entferntes Ziel gewählt — sonst verlangt
   * der Reroute einen physisch unmöglichen U-Turn.
   */
  const NAV_REROUTE_BEARING_DEVIATION_DEG = 110;
  /** Bei großer Bearing-Abweichung: zusätzliche Vorwärts-Distanz, um sinnvoll wieder einzufädeln. */
  const NAV_REROUTE_BEARING_PUSH_M = 350;

  /**
   * Liefert die Position (Streckenmeter, Geometrie-Index) des nächsten echten Abbiege-Wegpunkts,
   * der mindestens `minAheadAlongM` Streckenmeter VOR dem aktuellen Off-Route-Punkt liegt und
   * höchstens `maxAheadAlongM`. „Vorwärts“ bezieht sich immer auf die Streckenrichtung —
   * niemals zurück zu bereits absolvierten Abschnitten (wichtig für Rundkurse).
   */
  function findNextManeuverWaypointAlong(routeData, cum, minAheadAlongM, maxAheadAlongM) {
    const steps =
      routeData && routeData.navigation && Array.isArray(routeData.navigation.steps)
        ? routeData.navigation.steps
        : [];
    if (!steps.length || !Array.isArray(cum) || cum.length < 2) {
      return null;
    }
    const total = cum[cum.length - 1] || 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] || {};
      const type = Number(step.type);
      if (NAV_REROUTE_NON_TURN_TYPES.has(type)) {
        continue;
      }
      let geomIdx = Number(step.way_end_index);
      if (!Number.isFinite(geomIdx) || geomIdx < 0 || geomIdx >= cum.length) {
        geomIdx = Number(step.way_start_index);
      }
      if (!Number.isFinite(geomIdx) || geomIdx < 0 || geomIdx >= cum.length) {
        continue;
      }
      const m = Number(cum[geomIdx]);
      if (!Number.isFinite(m)) {
        continue;
      }
      if (m <= minAheadAlongM) {
        continue;
      }
      if (m > maxAheadAlongM) {
        return null;
      }
      if (m >= total - 25) {
        return null;
      }
      return { index: geomIdx, alongM: m, stepIndex: i, type: type };
    }
    return null;
  }

  function navRerouteBearingDeg(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return null;
    }
    const lat1 = (Number(a[0]) * Math.PI) / 180;
    const lat2 = (Number(b[0]) * Math.PI) / 180;
    const dLng = ((Number(b[1]) - Number(a[1])) * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const deg = (Math.atan2(y, x) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }

  function navRerouteAngleDelta(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return 0;
    }
    let d = ((b - a) % 360 + 540) % 360 - 180;
    return Math.abs(d);
  }

  /**
   * Wählt das Reroute-Ziel auf der Originalroute. Strategie (in dieser Reihenfolge):
   *
   * 1. Nächster echter Abbiege-Wegpunkt der Originalroute, der mindestens
   *    `lastManeuverAlongM` UND `safeAlong + minAhead` voraus liegt — strikt vorwärts in
   *    Streckenrichtung. Bei Rundkursen verhindert das, dass eine Stelle gewählt wird,
   *    die geometrisch nahe, aber auf der Strecke bereits passiert wurde.
   * 2. Fallback (keine Manöver mehr in Reichweite oder fehlende Steps): geometrisch nächster
   *    Polylinien-Punkt im Vorwärts-Fenster, das mit Cross-Track skaliert
   *    (`[forwardBase + max(180, 0.6×x), forwardBase + max(650, 2.4×x)]`).
   *
   * Bearing-Plausibilität: wenn der User effektiv in Gegenrichtung der Originalstrecke fährt,
   * wird der Anker auf der Strecke nach vorne geschoben (`bearingPush`), damit ORS keinen
   * unnötigen U-Turn auf den letzten 50 m zurücklegt.
   *
   * @param {{ geometry: number[][], navigation?: { steps?: Array } }} routeData
   * @param {number} alongM Aktuelle Vorwärts-Position (Snap, monoton steigend)
   * @param {number} currentLat
   * @param {number} currentLng
   * @param {number} [lastManeuverAlongM] Position der zuletzt passierten Abbiegung (Vorwärts-Anker)
   * @param {{ crossTrackM?: number }} [opts]
   */
  function pickOriginalRouteRejoinTarget(routeData, alongM, currentLat, currentLng, lastManeuverAlongM, opts) {
    if (!routeData || !Array.isArray(routeData.geometry) || routeData.geometry.length < 2) {
      return null;
    }
    const geometry = routeData.geometry;
    const cum = cumulativeDistances(geometry);
    const total = cum[cum.length - 1] || 0;
    const safeAlong = Math.max(0, Math.min(total, Number.isFinite(alongM) ? alongM : 0));
    const lastTurn = Number.isFinite(lastManeuverAlongM) ? Math.max(0, Math.min(total, lastManeuverAlongM)) : 0;
    const crossTrackM = Math.max(0, Number.isFinite(opts && opts.crossTrackM) ? opts.crossTrackM : 0);

    // Bearing-Plausibilität: User-Bewegungsrichtung (Snap-Punkt → aktuelle Position) gegen
    // die Streckenrichtung am Snap-Punkt. Große Abweichung ⇒ Reroute-Anker später setzen,
    // damit ORS nicht in einen U-Turn an der falschen Seite gezwungen wird.
    let bearingPushM = 0;
    if (geometry.length >= 2 && Number.isFinite(currentLat) && Number.isFinite(currentLng)) {
      let snapIdx = 0;
      for (let i = 0; i < cum.length; i++) {
        if (cum[i] >= safeAlong) {
          snapIdx = i;
          break;
        }
      }
      const snapPrev = geometry[Math.max(0, snapIdx - 1)];
      const snapHere = geometry[Math.min(geometry.length - 1, snapIdx)];
      if (Array.isArray(snapPrev) && Array.isArray(snapHere)) {
        const routeBearing = navRerouteBearingDeg(snapPrev, snapHere);
        const userBearing = navRerouteBearingDeg(snapHere, [currentLat, currentLng]);
        if (routeBearing !== null && userBearing !== null) {
          const deviation = navRerouteAngleDelta(routeBearing, userBearing);
          if (deviation > NAV_REROUTE_BEARING_DEVIATION_DEG) {
            bearingPushM = NAV_REROUTE_BEARING_PUSH_M;
          }
        }
      }
    }

    const forwardBaseM = Math.min(total, Math.max(safeAlong, lastTurn) + bearingPushM);
    const minAheadAlongM = Math.min(total, forwardBaseM + NAV_REROUTE_MIN_AHEAD_M);
    const maxAheadAlongM = Math.min(total, forwardBaseM + NAV_REROUTE_MAX_AHEAD_M);

    const maneuver = findNextManeuverWaypointAlong(routeData, cum, minAheadAlongM, maxAheadAlongM);
    if (maneuver) {
      const anchorAlongM = Math.max(forwardBaseM, maneuver.alongM - NAV_REROUTE_ANCHOR_BACK_M);
      let anchorIndex = -1;
      for (let i = 0; i < geometry.length; i++) {
        if (cum[i] >= anchorAlongM) {
          anchorIndex = i;
          break;
        }
      }
      const anchorPoint =
        anchorIndex > 0 && anchorIndex < maneuver.index
          ? [Number(geometry[anchorIndex][0]), Number(geometry[anchorIndex][1])]
          : null;
      return {
        index: maneuver.index,
        point: [Number(geometry[maneuver.index][0]), Number(geometry[maneuver.index][1])],
        anchorIndex: anchorPoint ? anchorIndex : -1,
        anchorPoint: anchorPoint,
        targetAlongM: maneuver.alongM,
        remainingM: Math.max(0, total - maneuver.alongM),
        reason: 'maneuver',
        stepIndex: maneuver.stepIndex,
        stepType: maneuver.type,
        bearingPushM: bearingPushM,
      };
    }

    // Fallback: Vorwärts-Fenster skaliert mit Cross-Track. Bei 50m Off-Track bleibt das alte
    // 180-650-Fenster, bei 400m Off-Track wird daraus 240-960 — verhindert, dass das Rejoin-Ziel
    // praktisch am User-Standort kleben bleibt.
    const fbMin = Math.min(
      total,
      forwardBaseM + Math.max(NAV_REROUTE_FALLBACK_MIN_AHEAD_M, NAV_REROUTE_FALLBACK_MIN_FACTOR * crossTrackM)
    );
    const fbMax = Math.min(
      total,
      forwardBaseM + Math.max(NAV_REROUTE_FALLBACK_MAX_AHEAD_M, NAV_REROUTE_FALLBACK_MAX_FACTOR * crossTrackM)
    );
    const fbAnchor = Math.min(total, forwardBaseM + 80);
    const currentLl = L.latLng(currentLat, currentLng);
    let geomAnchorIndex = -1;
    let fallbackIndex = -1;
    let bestIndex = -1;
    let bestDist = Infinity;
    for (let i = 0; i < geometry.length; i++) {
      const pathM = cum[i];
      if (geomAnchorIndex < 0 && pathM >= fbAnchor) {
        geomAnchorIndex = i;
      }
      if (pathM < fbMin) {
        continue;
      }
      if (fallbackIndex < 0) {
        fallbackIndex = i;
      }
      if (pathM > fbMax) {
        break;
      }
      const p = geometry[i];
      const dist = map.distance(currentLl, L.latLng(p[0], p[1]));
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    const targetIndex = bestIndex >= 0 ? bestIndex : fallbackIndex;
    if (targetIndex < 0) {
      return null;
    }
    const fbAnchorPoint =
      geomAnchorIndex > 0 && geomAnchorIndex < targetIndex
        ? [Number(geometry[geomAnchorIndex][0]), Number(geometry[geomAnchorIndex][1])]
        : null;
    return {
      index: targetIndex,
      point: [Number(geometry[targetIndex][0]), Number(geometry[targetIndex][1])],
      anchorIndex: fbAnchorPoint ? geomAnchorIndex : -1,
      anchorPoint: fbAnchorPoint,
      targetAlongM: cum[targetIndex],
      remainingM: Math.max(0, total - cum[targetIndex]),
      reason: 'geometric',
      bearingPushM: bearingPushM,
    };
  }

  /**
   * Zeichnet Polylinie, Statistik und Navigation aus einem Route-Payload (A–B oder Rundkurs).
   * @param {{ geometry: array, distance?: number, duration?: number, surface_nature?: number, asphalt?: number }} data
   */
  async function finalizeRouteOnMap(data) {
    if (!data._nrTemporaryRejoin) {
      state.navRerouteSession = null;
    }
    if (typeof data._nrReroute === 'undefined') {
      try {
        data._nrReroute = buildNrRerouteSnapshotForRoute(data);
      } catch (e) {
        data._nrReroute = null;
      }
    }
    state.lastRoute = data;
    if (savedRouteTitle && !savedRouteTitle.value.trim()) {
      savedRouteTitle.value =
        buildSavedRouteTitleSuggestion(data) ||
        (data.roundtrip_mode ? 'Rundkurs ' : 'Route ') + new Date().toLocaleString('de-DE');
    }
    const latlngs = data.geometry.map(function (p) {
      return L.latLng(p[0], p[1]);
    });
    attachRoutePolylineFromLatLngs(latlngs);
    map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });

    document.getElementById('stat-dist').textContent = fmtKm(data.distance);
    document.getElementById('stat-time').textContent = fmtMin(data.duration);
    document.getElementById('stat-nat').textContent = fmtPct(data.surface_nature);
    document.getElementById('stat-asph').textContent = fmtPct(data.asphalt);
    if (statsSection) {
      statsSection.hidden = false;
    }
    refreshRouteButton();
    updateRouteBusyProgress({
      title: 'Karte wird vorbereitet',
      detail: 'Navigation, Oberflächen und Sackgassen-Check werden synchronisiert.',
      indeterminate: false,
      progress: 90,
      stage: 'map',
    });
    if (window.NRNavigation) {
      window.NRNavigation.setRouteData(data);
    }
    if (state.surfaceViewActive) {
      renderSurfaceOverlay(data);
    } else {
      clearSurfaceLayer();
    }
    // Wegpunkte-Rundkurs: keine automatische Sackgassen-Erkennung (nicht bereinigen/markieren).
    if (!(data && data.roundtrip_mode === 'waypoints_loop')) {
      autoDetectNoExitAlongRoute(data);
    }
  }

  document.getElementById('btn-route').addEventListener('click', async function () {
    const btnRoute = document.getElementById('btn-route');
    routeError.hidden = true;
    routeError.textContent = '';
    if (routeInfo) {
      routeInfo.hidden = true;
      routeInfo.textContent = '';
    }
    clearRouteLayer();
    state.lastRoute = null;
    if (state.noExitHighlightActive) {
      clearNoExitHighlightLayer();
    }
    refreshRouteButton();
    const body = {
      start: [state.start.lat, state.start.lng],
      ziel: [state.goal.lat, state.goal.lng],
      profil: currentProfile(),
    };
    const md = maxDetourKmFromUi();
    if (md > 0) {
      body.max_detour_km = md;
    }
    if (state.vias.length) {
      body.via = state.vias.map(function (v) {
        return [v.lat, v.lng];
      });
    }

    setRouteBusyVisible(true);
    updateRouteBusyProgress({
      title: 'Route wird berechnet',
      detail: 'Punkte werden gesendet, Profil wird angewendet, das Wegenetz wird durchsucht.',
      indeterminate: true,
      stage: 'route',
    });
    btnRoute.disabled = true;

    try {
      const data = await fetchJson(apiUrl('api/route.php'), {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!data.ok) throw new Error(data.error || 'Routing fehlgeschlagen');

      updateRouteBusyProgress({
        title: 'Route wird aufgebaut',
        detail: 'Linie, Zoom, Statistik und Navigation werden vorbereitet.',
        indeterminate: false,
        progress: 42,
        stage: 'map',
      });

      if (routeInfo && data.detour_capped) {
        routeInfo.textContent =
          'Hinweis: Mit dem gewählten Profil wäre die Route länger als erlaubt. Es wird die kürzeste schnelle Referenzstrecke (gleiches Fahrprofil) angezeigt — Umweg-Slider erhöhen oder Profil wechseln.';
        routeInfo.hidden = false;
      }
      await finalizeRouteOnMap(data);

      updateRouteBusyProgress({
        title: 'Route fertig',
        detail: 'Route liegt auf der Karte.',
        indeterminate: false,
        progress: 100,
        stage: 'done',
      });
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 240);
      });
    } catch (e) {
      routeError.textContent = e.message || String(e);
      routeError.hidden = false;
    } finally {
      hideRouteBusyOverlay();
      refreshRouteButton();
    }
  });

  document.getElementById('btn-roundtrip').addEventListener('click', async function () {
    if (!nrRequireOrsApiKeyOrExplain()) {
      return;
    }
    const btnRt = this;
    const abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;

    if (getRtMode() === 'waypoints') {
      if (!state.start || state.rtWaypoints.length < 2) {
        routeError.textContent =
          'Rundkurs Wegpunkte: Bitte zuerst den Startpunkt setzen (erster Klick) und mindestens zwei weitere Wegpunkte. Die Route beginnt und endet am Start.';
        routeError.hidden = false;
        return;
      }
      routeError.hidden = true;
      routeError.textContent = '';
      if (routeInfo) {
        routeInfo.hidden = true;
        routeInfo.textContent = '';
      }
      clearRoundtripUi();
      clearRouteLayer();
      state.lastRoute = null;
      if (state.noExitHighlightActive) {
        clearNoExitHighlightLayer();
      }
      refreshRouteButton();
      setRouteBusyVisible(true);
      configureRouteBusyActions({
        show: true,
        hideNavStart: true,
        hideClose: false,
        closeLabel: 'Abbrechen',
        onClose: function () {
          if (abortCtrl) {
            try {
              abortCtrl.abort();
            } catch (e0) {
              /* ignore */
            }
          }
          hideRouteBusyOverlay();
        },
      });
      updateRouteBusyProgress({
        title: 'Rundkurs wird berechnet',
        detail: 'Start und Wegpunkte werden verbunden. Die Schleife endet wieder am Start.',
        indeterminate: true,
        stage: 'roundtrip',
      });
      btnRt.disabled = true;
      try {
        const body = {
          loop_from_waypoints: true,
          waypoints: [
            [state.start.lat, state.start.lng],
          ].concat(
            state.rtWaypoints.map(function (ll) {
              return [ll.lat, ll.lng];
            })
          ),
          profil: currentProfile(),
        };
        const timeoutId = window.setTimeout(function () {
          if (abortCtrl) {
            try {
              abortCtrl.abort();
            } catch (e0) {
              /* ignore */
            }
          }
        }, 210000);
        const data = await fetchJsonWithTimeout(
          apiUrl('api/route.php'),
          {
            method: 'POST',
            signal: abortCtrl ? abortCtrl.signal : undefined,
            body: JSON.stringify(body),
          },
          120000
        ).finally(function () {
          window.clearTimeout(timeoutId);
        });
        if (!data.ok) {
          throw new Error(data.error || 'Rundkurs fehlgeschlagen');
        }
        // Wichtig: vor dem Cleaning die Original-Wegpunkte am Payload hinterlegen,
        // damit alle Wegpunkte beim Neu-Routen so gut wie möglich angefahren werden.
        if (typeof data._nrReroute === 'undefined') {
          data._nrReroute = {
            kind: 'waypoints_loop',
            waypoints: cloneLatLonPairs(body.waypoints),
            profil: body.profil,
          };
        }
        updateRouteBusyProgress({
          title: 'Rundkurs bereinigen',
          detail: 'Sackgassen und Hin-und-zurück-Äste werden geprüft.',
          indeterminate: false,
          progress: 62,
          stage: 'clean',
        });
        // Wegpunkte-Rundkurs: keine Sackgassen-Bereinigung, damit die Route primär die Wegpunkte trifft.
        const cleaned = data;
        if (routeInfo && data.detour_capped) {
          routeInfo.textContent =
            'Hinweis: Mit dem gewählten Profil wäre die Route länger als erlaubt. Es wird die kürzeste schnelle Referenzstrecke (gleiches Fahrprofil) angezeigt — Umweg-Slider erhöhen oder Profil wechseln.';
          routeInfo.hidden = false;
        }
        await finalizeRouteOnMap(cleaned);
        syncRtRoundtripPanelUi();
        updateRouteBusyProgress({
          title: 'Rundkurs fertig',
          detail: 'Wegpunkte bei Bedarf ziehen und „Neu berechnen“ wählen.',
          indeterminate: false,
          progress: 100,
          stage: 'done',
        });
        await new Promise(function (resolve) {
          window.setTimeout(resolve, 240);
        });
      } catch (e) {
        const isAbort = e && (e.name === 'AbortError' || String(e.message || '').toLowerCase().includes('aborted'));
        routeError.textContent = isAbort ? 'Abgebrochen oder Timeout: Bitte erneut versuchen.' : e.message || String(e);
        routeError.hidden = false;
      } finally {
        setRouteBusyVisible(false);
        resetRouteBusyBar();
        if (routeBusyDetail) {
          routeBusyDetail.textContent = '';
        }
        refreshRouteButton();
      }
      return;
    }

    if (!state.start) {
      return;
    }
    routeError.hidden = true;
    routeError.textContent = '';
    if (routeInfo) {
      routeInfo.hidden = true;
      routeInfo.textContent = '';
    }

    const distanceRaw = rtRoundtripDistanceKmFromUi();
    const nVar = parseInt(document.getElementById('rt-variant-count').value, 10);
    if (Number.isNaN(distanceRaw) || distanceRaw < 1 || distanceRaw > 120) {
      routeError.textContent = 'Bitte eine Rundkurslänge zwischen 1 und 120 km wählen.';
      routeError.hidden = false;
      return;
    }
    if (Number.isNaN(nVar) || nVar < 1 || nVar > 5) {
      routeError.textContent = 'Bitte 1 bis 5 Varianten wählen.';
      routeError.hidden = false;
      return;
    }

    clearRoundtripUi();
    clearRouteLayer();
    state.lastRoute = null;
    if (state.noExitHighlightActive) {
      clearNoExitHighlightLayer();
    }
    refreshRouteButton();
    setRouteBusyVisible(true);
    state._nrRouteBusyCancelOnly = true;
    configureRouteBusyActions({
      show: true,
      hideNavStart: true,
      hideClose: false,
      closeLabel: 'Abbrechen',
      onClose: function () {
        if (abortCtrl) {
          try {
            abortCtrl.abort();
          } catch (e0) {
            /* ignore */
          }
        }
        hideRouteBusyOverlay();
      },
    });
    startRoundtripBusyNarration(nVar);
    btnRt.disabled = true;

    try {
      const timeoutId = window.setTimeout(function () {
        if (abortCtrl) {
          try {
            abortCtrl.abort();
          } catch (e0) {
            /* ignore */
          }
        }
      }, 210000);
      const res = await fetchJsonWithTimeout(
        apiUrl('api/route_roundtrip.php'),
        {
          method: 'POST',
          signal: abortCtrl ? abortCtrl.signal : undefined,
          body: JSON.stringify({
            start: [state.start.lat, state.start.lng],
            distance_km: distanceRaw,
            variants: nVar,
            profil: currentProfile(),
          }),
        },
        120000
      ).finally(function () {
        window.clearTimeout(timeoutId);
      });
      if (!res.ok) {
        throw new Error(res.error || 'Rundkurs fehlgeschlagen');
      }
      const rawVariants = Array.isArray(res.variants) ? res.variants : [];
      const cleanedVariants = [];
      for (let idx = 0; idx < rawVariants.length; idx++) {
        updateRouteBusyProgress({
          title: 'Rundkurse werden bereinigt',
          detail:
            'Variante ' +
            (idx + 1) +
            ' von ' +
            Math.max(1, rawVariants.length) +
            ': Sackgassen-Check läuft.',
          indeterminate: false,
          progress: 56 + Math.round((idx / Math.max(1, rawVariants.length)) * 24),
          stage: 'clean',
        });
        cleanedVariants.push(await cleanRoundtripVariant(rawVariants[idx]));
      }
      state.roundtripVariants = cleanedVariants;
      const box = document.getElementById('rt-variants');
      if (!box) {
        return;
      }
      updateRouteBusyProgress({
        title: 'Rundkurse werden aufgebaut',
        detail: 'Variantenkarten, Kennzahlen und Auswahl werden gesetzt.',
        indeterminate: false,
        progress: 84,
        stage: 'map',
      });
      state._nrRoundtripContext = {
        start: [state.start.lat, state.start.lng],
        distance_km: distanceRaw,
        profil: currentProfile(),
      };
      renderRoundtripVariantsBox();
      const btnNew = document.getElementById('btn-roundtrip-new-variant');
      if (btnNew) {
        btnNew.hidden = false;
      }
      const firstVariant = cleanedVariants[0];
      if (firstVariant) {
        updateRouteBusyProgress({
          title: 'Variante 1 wird angezeigt',
          detail: 'Die erste Variante wird direkt auf die Karte gelegt.',
          indeterminate: false,
          progress: 92,
          stage: 'map',
        });
        clearRouteLayer();
        state.lastRoute = null;
        if (state.noExitHighlightActive) {
          clearNoExitHighlightLayer();
        }
        await finalizeRouteOnMap(firstVariant);
      }
      updateRouteBusyProgress({
        title: 'Rundkurse fertig',
        detail: 'Die bereinigten Rundkurs-Varianten sind bereit.',
        indeterminate: false,
        progress: 100,
        stage: 'done',
      });
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 240);
      });
    } catch (e) {
      const isAbort = e && (e.name === 'AbortError' || String(e.message || '').toLowerCase().includes('aborted'));
      routeError.textContent = isAbort ? 'Abgebrochen oder Timeout: Bitte erneut versuchen.' : e.message || String(e);
      routeError.hidden = false;
    } finally {
      setRouteBusyVisible(false);
      resetRouteBusyBar();
      if (routeBusyDetail) {
        routeBusyDetail.textContent = '';
      }
      refreshRouteButton();
    }
  });

  const btnRoundtripNewVariant = document.getElementById('btn-roundtrip-new-variant');
  if (btnRoundtripNewVariant) {
    btnRoundtripNewVariant.addEventListener('click', async function () {
      if (!nrRequireOrsApiKeyOrExplain()) {
        return;
      }
      if (!state.start) {
        return;
      }
      const ctx = state._nrRoundtripContext;
      const start = ctx && Array.isArray(ctx.start) ? ctx.start : [state.start.lat, state.start.lng];
      const distanceKm = ctx && typeof ctx.distance_km === 'number' ? ctx.distance_km : rtRoundtripDistanceKmFromUi();
      const profil = ctx && typeof ctx.profil === 'string' ? ctx.profil : currentProfile();
      // Zufälliger Offset (Grad), damit jedes Mal ein anderer Rundkurs entsteht.
      const rotOffset = Math.floor(Math.random() * 36000) / 100;

      btnRoundtripNewVariant.disabled = true;
      routeError.hidden = true;
      routeError.textContent = '';
      setRouteBusyVisible(true);
      state._nrRouteBusyCancelOnly = true;
      const abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      // Abbrechen-Button im Busy-Overlay anbieten (und echten Abort auslösen).
      configureRouteBusyActions({
        show: true,
        hideNavStart: true,
        hideClose: false,
        closeLabel: 'Abbrechen',
        onClose: function () {
          if (abortCtrl) {
            try {
              abortCtrl.abort();
            } catch (e0) {
              /* ignore */
            }
          }
          hideRouteBusyOverlay();
        },
      });
      updateRouteBusyProgress({
        title: 'Neue Variante wird berechnet',
        detail: 'Neuer Startwinkel, gleiche Länge und Profil.',
        indeterminate: true,
        stage: 'route',
      });
      try {
        const timeoutId = window.setTimeout(function () {
          if (abortCtrl) {
            try {
              abortCtrl.abort();
            } catch (e0) {
              /* ignore */
            }
          }
        }, 180000);
        const res = await fetchJson(apiUrl('api/route_roundtrip.php'), {
          method: 'POST',
          signal: abortCtrl ? abortCtrl.signal : undefined,
          body: JSON.stringify({
            start: start,
            distance_km: distanceKm,
            variants: 1,
            profil: profil,
            rot_offset_deg: rotOffset,
          }),
        }).finally(function () {
          window.clearTimeout(timeoutId);
        });
        if (!res.ok) {
          throw new Error(res.error || 'Neue Variante fehlgeschlagen');
        }
        const rawVariants = Array.isArray(res.variants) ? res.variants : [];
        if (!rawVariants.length) {
          throw new Error('Keine Variante zurückgegeben.');
        }

        updateRouteBusyProgress({
          title: 'Variante wird bereinigt',
          detail: 'Sackgassen-Check läuft.',
          indeterminate: true,
          stage: 'clean',
        });
        // Neue Variante: schneller fertig werden → weniger Cleaning-Pässe.
        const cleaned = await cleanRoundtripVariant(rawVariants[0], 2);
        state.roundtripVariants = (Array.isArray(state.roundtripVariants) ? state.roundtripVariants : []).concat([cleaned]);
        renderRoundtripVariantsBox();

        updateRouteBusyProgress({
          title: 'Variante wird angezeigt',
          detail: 'Die neue Variante wird direkt auf die Karte gelegt.',
          indeterminate: true,
          stage: 'map',
        });
        clearRouteLayer();
        state.lastRoute = null;
        if (state.noExitHighlightActive) {
          clearNoExitHighlightLayer();
        }
        await finalizeRouteOnMap(cleaned);

        updateRouteBusyProgress({
          title: 'Neue Variante fertig',
          detail: 'Neue Rundkurs-Variante wurde hinzugefügt.',
          indeterminate: false,
          progress: 100,
          stage: 'done',
        });
        await new Promise(function (resolve) {
          window.setTimeout(resolve, 240);
        });
      } catch (e) {
        const isAbort = e && (e.name === 'AbortError' || String(e.message || '').toLowerCase().includes('aborted'));
        routeError.textContent = isAbort ? 'Abgebrochen oder Timeout: Bitte erneut versuchen.' : e.message || String(e);
        routeError.hidden = false;
      } finally {
        btnRoundtripNewVariant.disabled = false;
        setRouteBusyVisible(false);
        resetRouteBusyBar();
        if (routeBusyDetail) {
          routeBusyDetail.textContent = '';
        }
        refreshRouteButton();
      }
    });
  }

  const btnGpxDownload = document.getElementById('btn-gpx');
  if (btnGpxDownload) {
    btnGpxDownload.addEventListener('click', async function () {
      if (!state.lastRoute || !state.lastRoute.geometry) return;
      const name = 'NatureRide_' + currentProfile();
      try {
        const res = await fetch(apiUrl('api/export_gpx.php'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': CSRF,
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            name: name,
            geometry: state.lastRoute.geometry,
          }),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || res.statusText);
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'natureride.gpx';
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        alert('GPX-Export fehlgeschlagen: ' + (e.message || e));
      }
    });
  }

  document.addEventListener('nr-nav-fitness-point', function (ev) {
    const detail = ev && ev.detail && typeof ev.detail === 'object' ? ev.detail : {};
    const delta = Number.isFinite(Number(detail.delta)) ? Number(detail.delta) : 1;
    const totalThisRide = Number.isFinite(Number(detail.awarded_this_navigation))
      ? Math.max(0, Math.floor(Number(detail.awarded_this_navigation)))
      : Number.isFinite(Number(detail.kilometer))
        ? Math.max(0, Math.floor(Number(detail.kilometer)))
        : null;
    showFitnessStarReward(delta, totalThisRide);
    triggerFitnessFirework(delta);
    addFitnessPoints(delta)
      .then(function (user) {
        bumpPanelFitnessBadge();
      })
      .catch(function (err) {
        if (!state.currentUser) {
          return;
        }
        if (routeInfo) {
          routeInfo.textContent = err && err.message ? err.message : 'Fitnesspunkt konnte nicht gespeichert werden.';
          routeInfo.hidden = false;
        }
      });
  });

  document.addEventListener('nr-nav-return-start', async function (ev) {
    const nav = window.NRNavigation;
    const d = ev && ev.detail ? ev.detail : {};
    const lat = Number(d.lat);
    const lng = Number(d.lng);
    const session = state.navRerouteSession;
    const baseRoute =
      session && session.originalRoute && Array.isArray(session.originalRoute.geometry)
        ? session.originalRoute
        : state.lastRoute;
    const originalStart =
      baseRoute && Array.isArray(baseRoute._nrOriginalStart)
        ? baseRoute._nrOriginalStart
        : baseRoute && Array.isArray(baseRoute.geometry) && baseRoute.geometry.length >= 2
          ? baseRoute.geometry[0]
          : Array.isArray(d.start)
            ? d.start
            : null;

    const startLat = originalStart ? Number(originalStart[0]) : NaN;
    const startLng = originalStart ? Number(originalStart[1]) : NaN;

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !state.currentUser || !Number.isFinite(startLat) || !Number.isFinite(startLng)) {
      if (routeInfo) {
        routeInfo.textContent = 'Rückroute konnte nicht gestartet werden: aktueller Standort oder Startpunkt fehlt.';
        routeInfo.hidden = false;
      }
      return;
    }

    if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
      window.NRPiperTTS.cancel();
    }
    if (typeof window.speechSynthesis !== 'undefined') {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        /* ignorieren */
      }
    }

    setRouteBusyVisible(true);
    updateRouteBusyProgress({
      title: 'Zurück zum Start',
      detail: 'Aktueller GPS-Standort wird mit dem Startpunkt verbunden.',
      indeterminate: true,
      stage: 'route',
    });
    if (routeError) {
      routeError.hidden = true;
      routeError.textContent = '';
    }

    try {
      const data = await fetchJson(apiUrl('api/route.php'), {
        method: 'POST',
        body: JSON.stringify({
          start: [lat, lng],
          ziel: [startLat, startLng],
          profil: currentProfile(),
        }),
      });
      if (!data.ok) {
        throw new Error(data.error || 'Rückroute zum Start fehlgeschlagen');
      }
      data._nrReturnToStart = true;
      data._nrOriginalStart = [startLat, startLng];
      data._nrReroute = null;

      updateRouteBusyProgress({
        title: 'Rückroute wird gestartet',
        detail: 'Karte und Navigationshinweise werden auf den Weg zum Start umgestellt.',
        indeterminate: false,
        progress: 72,
        stage: 'map',
      });
      clearRouteLayer();
      await finalizeRouteOnMap(data);
      if (nav && typeof nav.open === 'function') {
        nav.open();
      }
      if (nav && typeof nav.updateFromLatLng === 'function') {
        nav.updateFromLatLng(L.latLng(lat, lng));
      }
      if (routeInfo) {
        routeInfo.textContent = 'Rücknavigation zum Start läuft.';
        routeInfo.hidden = false;
      }
      updateRouteBusyProgress({
        title: 'Rücknavigation läuft',
        detail: 'Die Navigation führt jetzt vom aktuellen Standort zurück zum Start.',
        indeterminate: false,
        progress: 100,
        stage: 'done',
      });
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 220);
      });
    } catch (err) {
      if (routeInfo) {
        routeInfo.textContent = 'Rückroute zum Start fehlgeschlagen: ' + (err.message || String(err));
        routeInfo.hidden = false;
      }
    } finally {
      hideRouteBusyOverlay();
      refreshRouteButton();
    }
  });

  document.addEventListener('nr-nav-request-reroute', async function (ev) {
    const nav = window.NRNavigation;
    const d = ev && ev.detail ? ev.detail : {};
    const lat = d.lat;
    const lng = d.lng;
    const alongM = Number.isFinite(d.alongM) ? d.alongM : 0;
    const lastManeuverAlongM = Number.isFinite(d.lastManeuverAlongM) ? d.lastManeuverAlongM : 0;
    function finishRerouteNav() {
      if (nav && typeof nav.notifyRerouteFinished === 'function') {
        nav.notifyRerouteFinished();
      }
    }
    if (lat == null || lng == null || !state.currentUser) {
      finishRerouteNav();
      return;
    }
    const session = state.navRerouteSession;
    const originalRoute =
      session && session.originalRoute
        ? session.originalRoute
        : state.lastRoute && !state.lastRoute._nrTemporaryRejoin
          ? state.lastRoute
          : null;
    if (!originalRoute || !Array.isArray(originalRoute.geometry) || originalRoute.geometry.length < 2) {
      finishRerouteNav();
      return;
    }
    const rr = (session && session.originalReroute) || originalRoute._nrReroute || buildNrRerouteSnapshotForRoute(originalRoute);
    const target =
      session && session.target
        ? session.target
        : pickOriginalRouteRejoinTarget(originalRoute, alongM, lat, lng, lastManeuverAlongM, {
            crossTrackM: Number.isFinite(d.crossTrackM) ? d.crossTrackM : 0,
          });
    if (!target || !Array.isArray(target.point) || target.point.length < 2 || target.remainingM < 20) {
      finishRerouteNav();
      return;
    }
    state.navRerouteSession = {
      originalRoute: originalRoute,
      originalReroute: rr || null,
      target: target,
    };
    if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
      window.NRPiperTTS.cancel();
    }
    if (typeof window.speechSynthesis !== 'undefined') {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        /* ignorieren */
      }
    }
    try {
      const body = {
        start: [lat, lng],
        ziel: target.point,
        profil: (rr && rr.profil) || currentProfile(),
      };
      if (Array.isArray(target.anchorPoint) && target.anchorPoint.length >= 2) {
        body.via = [target.anchorPoint];
      }
      if (rr && rr.max_detour_km != null) {
        body.max_detour_km = rr.max_detour_km;
      }
      const data = await fetchJson(apiUrl('api/route.php'), {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!data.ok) {
        throw new Error(data.error || 'Rückführung zur Route fehlgeschlagen');
      }
      if (data && data.geometry && data.geometry.length >= 2) {
        data._nrReroute = null;
        data._nrTemporaryRejoin = {
          targetIndex: target.index,
          anchorIndex: target.anchorIndex != null ? target.anchorIndex : null,
          targetAlongM: target.targetAlongM,
          targetPoint: target.point.slice(),
        };
        if (routeInfo) {
          routeInfo.textContent =
            'Abweichung erkannt. Rückführung zur geplanten Strecke läuft' +
            (d.crossTrackM != null ? ', etwa ' + d.crossTrackM + ' m' : '') +
            '.';
          routeInfo.hidden = false;
        }
        await finalizeRouteOnMap(data);
      }
    } catch (err) {
      state.navRerouteSession = null;
      if (routeInfo) {
        routeInfo.textContent = 'Rückführung zur geplanten Strecke fehlgeschlagen: ' + (err.message || String(err));
        routeInfo.hidden = false;
      }
    } finally {
      finishRerouteNav();
    }
  });

  document.addEventListener('nr-nav-reroute-rejoin-reached', async function () {
    const session = state.navRerouteSession;
    if (!session || !session.originalRoute || !Array.isArray(session.target && session.target.point)) {
      return;
    }
    state.navRerouteSession = null;
    try {
      await finalizeRouteOnMap(session.originalRoute);
      if (window.NRNavigation && typeof window.NRNavigation.updateFromLatLng === 'function') {
        window.NRNavigation.updateFromLatLng(L.latLng(session.target.point[0], session.target.point[1]));
      }
      if (routeInfo) {
        routeInfo.textContent = 'Zur geplanten Strecke zurückgekehrt. Navigation folgt wieder der Originalroute.';
        routeInfo.hidden = false;
      }
    } catch (err) {
      if (routeInfo) {
        routeInfo.textContent =
          'Originalroute konnte nach der Rückführung nicht wiederhergestellt werden: ' +
          (err.message || String(err));
        routeInfo.hidden = false;
      }
    }
  });

  const btnNavStart = document.getElementById('btn-nav-start');
  const btnNavStartMap = document.getElementById('btn-nav-start-map');
  if (btnNavStart) {
    btnNavStart.addEventListener('click', function () {
      if (!state.lastRoute || !window.NRNavigation) {
        return;
      }
      if (!nrRequireOrsApiKeyOrExplain()) {
        return;
      }

      // Adressbuch: Start/Ziel bei Navigation-Start speichern (best-effort, dedupliziert).
      void NRAddressbookAutosave.saveNow();

      const proceed = function () {
        // Erst nach „Los geht’s“ darf die Navigation sprechen.
        if (typeof window.NRNavigation.setSpeechArmed === 'function') {
          window.NRNavigation.setSpeechArmed(true);
        }
        // Route erst beim echten Start setzen, damit vorher keine Navi-Ansagen passieren.
        if (typeof window.NRNavigation.setRouteData === 'function') {
          window.NRNavigation.setRouteData(state.lastRoute);
        }
        if (typeof window.NRNavigation.open === 'function') {
          window.NRNavigation.open();
        }
      };
      // Erst Wetter-Modal (spricht Bericht), dann Navigation öffnen.
      try {
        if (window.NRWeatherStartDialog && typeof window.NRWeatherStartDialog.openForStart === 'function') {
          // Bis „Los geht’s“: Navi komplett stumm schalten (Welcome/Steps/Weather).
          if (typeof window.NRNavigation.setSpeechArmed === 'function') {
            window.NRNavigation.setSpeechArmed(false);
          }
          // Alle evtl. laufenden Ansagen stoppen, damit Wetter zuerst kommt.
          try {
            if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
              window.NRPiperTTS.cancel();
            }
          } catch (eP) {
            /* ignore */
          }
          try {
            if (typeof window.speechSynthesis !== 'undefined') {
              window.speechSynthesis.cancel();
            }
          } catch (eS) {
            /* ignore */
          }
          const g0 = state.lastRoute && Array.isArray(state.lastRoute.geometry) ? state.lastRoute.geometry[0] : null;
          const ll0 = g0 ? L.latLng(g0[0], g0[1]) : state.start ? state.start : null;
          window.NRWeatherStartDialog.openForStart(ll0, proceed);
          return;
        }
      } catch (eW) {
        /* ignore */
      }
      if (typeof window.NRNavigation.setSpeechArmed === 'function') {
        window.NRNavigation.setSpeechArmed(true);
      }
      proceed();
    });
  }

  if (btnNavStartMap) {
    btnNavStartMap.addEventListener('click', function () {
      const btn = document.getElementById('btn-nav-start');
      if (btn) {
        btn.click();
      }
    });
  }

  (function bindWeatherStartDialog() {
    const dialog = document.getElementById('weather-start-dialog');
    const copy = document.getElementById('weather-start-copy');
    const btnGo = document.getElementById('weather-start-go');
    const btnCancel = document.getElementById('weather-start-cancel');
    const animBox = document.getElementById('weather-start-anim');
    const sub = document.getElementById('weather-start-sub');
    if (!dialog || !copy || !btnGo || !btnCancel) {
      return;
    }
    let inFlight = false;
    /** @type {null|(() => void)} */
    let onProceed = null;

    function getEnginePref() {
      try {
        return localStorage.getItem('nr_tts_engine') === 'system' ? 'system' : 'piper';
      } catch (e) {
        return 'piper';
      }
    }

    function show() {
      dialog.hidden = false;
      dialog.setAttribute('aria-hidden', 'false');
    }

    function hide() {
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
      inFlight = false;
      onProceed = null;
      btnGo.disabled = true;
      if (sub) {
        sub.textContent = '';
        sub.hidden = true;
      }
    }

    function stopSpeech() {
      try {
        if (typeof window.speechSynthesis !== 'undefined') {
          window.speechSynthesis.cancel();
        }
      } catch (e) {
        /* ignore */
      }
      try {
        if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
          window.NRPiperTTS.cancel();
        }
      } catch (e2) {
        /* ignore */
      }
    }

    async function fetchWeather(lat, lon) {
      const ymd = new Date().toISOString().slice(0, 10);
      const url =
        apiUrl(
          'api/weather.php?lat=' +
            encodeURIComponent(String(lat)) +
            '&lon=' +
            encodeURIComponent(String(lon)) +
            '&date=' +
            encodeURIComponent(ymd)
        );
      const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
      if (!res.ok) throw new Error('weather_fetch_' + res.status);
      const json = await res.json();
      if (!json || !json.ok || !json.data) throw new Error('weather_bad_payload');
      const arr = Array.isArray(json.data.weather) ? json.data.weather : [];
      if (!arr.length) return null;
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
    }

    function normalizeWeatherKind(w) {
      const condRaw = w && w.condition != null ? String(w.condition) : '';
      const cond = condRaw.trim().toLowerCase();
      const prec = w && Number.isFinite(Number(w.precipitation)) ? Number(w.precipitation) : 0;
      const cloud = w && Number.isFinite(Number(w.cloud_cover)) ? Number(w.cloud_cover) : null;
      if (cond.includes('snow')) return 'snow';
      if (cond.includes('fog') || cond.includes('mist') || cond.includes('haze')) return 'fog';
      if (cond.includes('rain') || cond.includes('shower') || cond.includes('drizzle')) return 'rain';
      if (prec >= 0.2) return 'rain';
      if (cond.includes('clear') || cond.includes('sun')) return 'sun';
      if (cond.includes('cloud') || cond.includes('overcast')) return 'cloud';
      if (cloud != null && cloud >= 70) return 'cloud';
      return 'sun';
    }

    function setSkycon(kind) {
      const canvas = document.getElementById('weather-skycon');
      if (!canvas) return;
      const SkyconsCtor = window.Skycons;
      if (!SkyconsCtor) return;
      // keep singleton per dialog instance
      if (!window.__nrWeatherSkycons) {
        window.__nrWeatherSkycons = new SkyconsCtor({ color: '#ecfff2' });
      }
      const sky = window.__nrWeatherSkycons;
      try {
        sky.remove(canvas);
      } catch (e0) {
        /* ignore */
      }
      const map = {
        sun: 'CLEAR_DAY',
        cloud: 'CLOUDY',
        rain: 'RAIN',
        snow: 'SNOW',
        fog: 'FOG',
        unknown: 'PARTLY_CLOUDY_DAY',
      };
      const iconName = map[kind] || map.unknown;
      sky.add(canvas, SkyconsCtor[iconName]);
      sky.play();
    }

    function translateConditionDe(raw) {
      const s = String(raw || '').trim();
      if (!s) return '';
      const k = s.toLowerCase();
      if (k === 'rain') return 'Regen';
      if (k === 'light rain') return 'leichter Regen';
      if (k === 'heavy rain') return 'starker Regen';
      if (k === 'showers') return 'Regenschauer';
      if (k === 'drizzle') return 'Nieselregen';
      if (k === 'snow') return 'Schnee';
      if (k === 'light snow') return 'leichter Schneefall';
      if (k === 'fog') return 'Nebel';
      if (k === 'mist') return 'Dunst';
      if (k === 'overcast') return 'bedeckt';
      if (k === 'cloudy') return 'wolkig';
      if (k === 'partly cloudy') return 'teilweise wolkig';
      if (k === 'clear') return 'klar';
      if (k === 'sunny') return 'sonnig';
      if (k === 'dry') return 'trocken';
      // Fallback: englische Einzelwörter grob ersetzen
      return s
        .replace(/rain/gi, 'Regen')
        .replace(/snow/gi, 'Schnee')
        .replace(/fog/gi, 'Nebel')
        .replace(/dry/gi, 'trocken')
        .replace(/overcast/gi, 'bedeckt')
        .replace(/cloudy/gi, 'wolkig')
        .replace(/clear/gi, 'klar')
        .replace(/sunny/gi, 'sonnig');
    }

    function formatWeatherDe(w) {
      if (!w || typeof w !== 'object') return '';
      const parts = [];
      const temp = Number.isFinite(Number(w.temperature)) ? Math.round(Number(w.temperature)) : null;
      const cond = w.condition ? translateConditionDe(String(w.condition)) : '';
      const wind = Number.isFinite(Number(w.wind_speed)) ? Math.round(Number(w.wind_speed)) : null;
      const prec = Number.isFinite(Number(w.precipitation)) ? Number(w.precipitation) : null;
      if (cond) parts.push(cond);
      if (temp != null) parts.push(temp + ' Grad');
      if (wind != null) parts.push('Wind ' + wind + ' km/h');
      if (prec != null) parts.push('Niederschlag ' + prec.toFixed(1).replace('.', ',') + ' Millimeter');
      if (!parts.length) return '';
      return 'Wetter am Startpunkt: ' + parts.join(', ') + '.';
    }

    function speakPhrase(phrase) {
      const engine = getEnginePref();
      if (!phrase) return false;
      if (engine === 'system') {
        try {
          if (typeof window.speechSynthesis === 'undefined') return false;
          const u = new SpeechSynthesisUtterance(String(phrase));
          u.lang = 'de-DE';
          u.volume = getNavVoiceVolumeFromPrefs();
          u.rate = 0.96;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
          return true;
        } catch (e) {
          return false;
        }
      }
      const p = window.NRPiperTTS;
      if (p && typeof p.speak === 'function') {
        void p.speak(String(phrase), { kind: 'mile', volume: getNavVoiceVolumeFromPrefs() });
        return true;
      }
      return false;
    }

    async function openForStart(latlng, proceed) {
      if (!latlng || !Number.isFinite(Number(latlng.lat)) || !Number.isFinite(Number(latlng.lng))) {
        proceed();
        return;
      }
      if (inFlight) return;
      inFlight = true;
      onProceed = proceed;
      btnGo.disabled = true;
      copy.textContent = 'Wetter wird geladen …';
      if (sub) {
        sub.textContent = 'Startpunkt wird abgefragt und Wetterbericht vorbereitet.';
        sub.hidden = false;
      }
      if (animBox) {
        // Sofort sichtbare Animation während des Ladens.
        animBox.setAttribute('data-weather', 'unknown');
      }
      setSkycon('unknown');
      show();
      try {
        const w = await fetchWeather(Number(latlng.lat), Number(latlng.lng));
        if (animBox) {
          const k = normalizeWeatherKind(w);
          animBox.setAttribute('data-weather', k);
          setSkycon(k);
        }
        const phrase = formatWeatherDe(w);
        copy.textContent = phrase || 'Wetterbericht ist gerade nicht verfügbar.';
        if (sub) {
          sub.textContent = 'Tippe auf „Los geht’s“, um die Navigation zu starten.';
          sub.hidden = false;
        }
        if (phrase) {
          void speakPhrase(phrase);
        }
      } catch (e) {
        if (animBox) {
          animBox.setAttribute('data-weather', 'unknown');
        }
        setSkycon('unknown');
        copy.textContent = 'Wetterbericht konnte nicht geladen werden. Du kannst trotzdem starten.';
        if (sub) {
          sub.textContent = 'Tippe auf „Los geht’s“, um trotzdem zu starten.';
          sub.hidden = false;
        }
      } finally {
        btnGo.disabled = false;
        inFlight = false;
      }
    }

    btnGo.addEventListener('click', function () {
      const fn = onProceed;
      stopSpeech();
      hide();
      if (fn) fn();
    });
    btnCancel.addEventListener('click', function () {
      stopSpeech();
      hide();
    });

    window.NRWeatherStartDialog = {
      openForStart: openForStart,
      hide: hide,
    };
  })();

  if (window.NRNavigation) {
    window.NRNavigation.init(map);
  }

  function isNavVoiceEnabledFromPrefs() {
    try {
      const v = localStorage.getItem('nr_nav_voice');
      // Default: eingeschaltet (falls Pref fehlt/leer ist).
      if (v == null || v === '') {
        try {
          localStorage.setItem('nr_nav_voice', '1');
        } catch (e0) {
          /* ignore */
        }
        return true;
      }
      return v !== '0';
    } catch (e) {
      return true;
    }
  }

  function setNavVoiceEnabledPref(enabled) {
    try {
      localStorage.setItem('nr_nav_voice', enabled ? '1' : '0');
    } catch (e0) {
      /* ignore */
    }
  }

  function isNavFitnessVoiceEnabledFromPrefs() {
    try {
      const v = localStorage.getItem('nr_nav_fitness_voice');
      // Default: eingeschaltet (falls Pref fehlt/leer ist).
      if (v == null || v === '') {
        try {
          localStorage.setItem('nr_nav_fitness_voice', '1');
        } catch (e0) {
          /* ignore */
        }
        return true;
      }
      return v !== '0';
    } catch (e) {
      return true;
    }
  }

  function setNavFitnessVoiceEnabledPref(enabled) {
    try {
      localStorage.setItem('nr_nav_fitness_voice', enabled ? '1' : '0');
    } catch (e0) {
      /* ignore */
    }
  }

  function getNavVoiceVolumeFromPrefs() {
    try {
      const raw = parseInt(localStorage.getItem('nr_nav_voice_volume') || '', 10);
      if (Number.isFinite(raw)) {
        return Math.max(0, Math.min(1, raw / 100));
      }
    } catch (e) {
      /* ignore */
    }
    return 1;
  }

  /** Piper ohne Aktivierungs-Modals: Flag setzen, sobald Piper genutzt wird. */
  function ensurePiperAutoActivatedForVoice() {
    if (!isNavVoiceEnabledFromPrefs()) {
      return;
    }
    try {
      if (localStorage.getItem('nr_tts_engine') === 'system') {
        return;
      }
    } catch (e0) {
      /* ignore */
    }
    try {
      localStorage.setItem('nr_piper_user_activated', '1');
    } catch (e1) {
      /* ignore */
    }
  }

  function resolveUserNameForGreeting(user) {
    if (!user) return '';
    const dn = user.display_name != null ? String(user.display_name).trim() : '';
    if (dn) return dn;
    const em = user.email != null ? String(user.email).trim() : '';
    if (!em) return '';
    return em.split('@')[0] || em;
  }

  function buildPiperPageGreeting(user) {
    const name = resolveUserNameForGreeting(user);
    const pointsRaw = user && Number.isFinite(Number(user.fitness_points)) ? Math.max(0, Math.floor(Number(user.fitness_points))) : 0;
    const pointsWord = pointsRaw === 1 ? 'Fitnesspunkt' : 'Fitnesspunkte';
    const hello = name ? 'Hallo ' + name + '!' : 'Hallo!';
    return (
      hello +
      ' Willkommen zurück. Du hast ' +
      pointsRaw +
      ' ' +
      pointsWord +
      '. Ich bin bereit für deine nächste Tour.'
    );
  }

  function ensureTtsAfterLogin() {
    if (!state.currentUser || !isNavVoiceEnabledFromPrefs()) {
      return;
    }
    let engine = 'piper';
    try {
      engine = localStorage.getItem('nr_tts_engine') === 'system' ? 'system' : 'piper';
    } catch (e0) {
      engine = 'piper';
    }
    if (engine === 'system') {
      piperTtsUi.hide();
      return;
    }
    ensurePiperAutoActivatedForVoice();
    piperTtsUi.hide();
    const p = window.NRPiperTTS;
    if (p && typeof p.prepareNavTts === 'function') {
      void p.prepareNavTts();
    }
  }

  function maybeShowPiperFirstLoadHintAfterLogin() {
    if (!state.currentUser) return;
    if (!isNavVoiceEnabledFromPrefs()) return;
    try {
      const e = localStorage.getItem('nr_tts_engine');
      if (e === 'system') {
        return;
      }
    } catch (e0) {
      // Default ist Piper → Hinweis ist ok.
    }
    const userId = state.currentUser && state.currentUser.id != null ? String(state.currentUser.id) : '';
    const key = 'nr_piper_first_load_hint_shown' + (userId ? '_' + userId : '');
    try {
      if (localStorage.getItem(key) === '1') {
        return;
      }
      localStorage.setItem(key, '1');
    } catch (e1) {
      // Wenn storage nicht geht, trotzdem einmal zeigen (aber nicht persistieren).
    }
    NRMessageDialog.show(
      'Hinweis: Beim ersten Starten muss das Sprachmodell für die Sprachausgabe geladen werden. Das kann je nach Gerät/Netz bis zu 5 Minuten dauern. Danach ist es meist deutlich schneller.'
    );
  }

  (function bindSettingsVoiceToggle() {
    if (!settingsVoiceEnabled) {
      return;
    }
    const syncUi = function () {
      settingsVoiceEnabled.checked = isNavVoiceEnabledFromPrefs();
    };
    syncUi();
    settingsVoiceEnabled.addEventListener('change', function () {
      const enabled = !!settingsVoiceEnabled.checked;
      setNavVoiceEnabledPref(enabled);

      // Falls Navigation-Settings offen/geladen: Toggle dort synchron halten.
      const navVoiceOn = document.getElementById('nav-voice-on');
      if (navVoiceOn) {
        navVoiceOn.checked = enabled;
      }
      if (window.NRNavigation && typeof window.NRNavigation === 'object') {
        try {
          window.NRNavigation.voiceEnabled = enabled;
        } catch (e1) {
          /* ignore */
        }
      }

      if (!enabled) {
        if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
          window.NRPiperTTS.cancel();
        }
        if (typeof window.speechSynthesis !== 'undefined') {
          try {
            window.speechSynthesis.cancel();
          } catch (e2) {
            /* ignore */
          }
        }
        return;
      }

      // Beim Aktivieren ggf. Piper vorbereiten/aktivieren (nur wenn Nutzer eingeloggt).
      ensureTtsAfterLogin();
    });

    // Externe Änderungen (z.B. Nav-Settings) spiegeln, wenn der Dialog geöffnet wird.
    if (settingsOpen) {
      settingsOpen.addEventListener('click', function () {
        syncUi();
      });
    }
  })();

  (function bindSettingsFitnessVoiceToggle() {
    if (!settingsFitnessVoiceEnabled) {
      return;
    }
    const syncUi = function () {
      const globalVoiceOn = isNavVoiceEnabledFromPrefs();
      settingsFitnessVoiceEnabled.disabled = !globalVoiceOn;
      settingsFitnessVoiceEnabled.checked = globalVoiceOn ? isNavFitnessVoiceEnabledFromPrefs() : false;
    };
    syncUi();
    settingsFitnessVoiceEnabled.addEventListener('change', function () {
      const enabled = !!settingsFitnessVoiceEnabled.checked;
      setNavFitnessVoiceEnabledPref(enabled);
      if (window.NRNavigation && typeof window.NRNavigation === 'object') {
        try {
          window.NRNavigation.fitnessVoiceEnabled = enabled;
        } catch (e1) {
          /* ignore */
        }
      }
    });

    if (settingsOpen) {
      settingsOpen.addEventListener('click', function () {
        syncUi();
      });
    }

    if (settingsVoiceEnabled) {
      settingsVoiceEnabled.addEventListener('change', function () {
        syncUi();
      });
    }

    // Initial state to Nav (page load).
    if (window.NRNavigation && typeof window.NRNavigation === 'object') {
      try {
        window.NRNavigation.fitnessVoiceEnabled = isNavFitnessVoiceEnabledFromPrefs() && isNavVoiceEnabledFromPrefs();
      } catch (e2) {
        /* ignore */
      }
    }
  })();

  function schedulePiperGreetingOnPageLoad() {
    function debugLog() {}

    if (!state.currentUser) {
      return;
    }
    if (!isNavVoiceEnabledFromPrefs()) {
      return;
    }
    // Begrüßung soll bei jedem Reload kommen. Wir verhindern nur Mehrfach-Auslösung innerhalb eines Page-Loads.
    if (window.__nrAnyWelcomeDone) {
      return;
    }
    if (window.__nrPiperPageGreetDone) {
      return;
    }
    if (window.__nrPiperPageGreetInFlight) {
      return;
    }
    window.__nrPiperPageGreetInFlight = true;
    let greetedDone = false;
    let speakInFlight = false;
    let hadUserGesture = false;

    const enginePref = (function () {
      try {
        const e = localStorage.getItem('nr_tts_engine');
        if (e === 'system') return 'system';
      } catch (e0) {
        /* ignore */
      }
      return 'piper';
    })();

    const phrase = buildPiperPageGreeting(state.currentUser);
    const volume = getNavVoiceVolumeFromPrefs();

    if (enginePref === 'system') {
      // System-TTS: keine Modelle laden. Autoplay ist oft blockiert; außerdem laden Voices teils verzögert.
      let systemSpeakInFlight = false;
      const speakSystem = function () {
        if (window.__nrAnyWelcomeDone) {
          window.__nrPiperPageGreetInFlight = false;
          return;
        }
        if (systemSpeakInFlight) {
          return;
        }
        systemSpeakInFlight = true;
        let didSpeak = false;
        try {
          if (typeof window.speechSynthesis === 'undefined') {
            return;
          }
          try {
            void window.speechSynthesis.getVoices();
          } catch (eVoices) {
            /* ignore */
          }
          const doSpeak = function () {
            // Erneuter Idempotenz-Check: Begrüßung könnte zwischenzeitlich von anderer Stelle
            // (z. B. NRNavigation.speakWelcomeForNavigation) bereits gesprochen worden sein.
            if (window.__nrAnyWelcomeDone) {
              return;
            }
            try {
              const u = new SpeechSynthesisUtterance(String(phrase));
              u.lang = 'de-DE';
              u.volume = volume;
              u.rate = 0.96;
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(u);
              didSpeak = true;
              window.__nrPiperPageGreetDone = true;
              window.__nrAnyWelcomeDone = true;
            } catch (eSpeak) {
              didSpeak = false;
            }
          };
          let voices = [];
          try {
            voices = window.speechSynthesis.getVoices() || [];
          } catch (eGet) {
            voices = [];
          }
          if (voices.length) {
            doSpeak();
            return;
          }
          let done = false;
          const finish = function () {
            if (done) return;
            done = true;
            try {
              window.speechSynthesis.removeEventListener('voiceschanged', onChanged);
            } catch (eOff) {
              /* ignore */
            }
            doSpeak();
          };
          const onChanged = function () {
            finish();
          };
          try {
            window.speechSynthesis.addEventListener('voiceschanged', onChanged);
          } catch (eOn) {
            /* ignore */
          }
          window.setTimeout(finish, 800);
        } finally {
          window.__nrPiperPageGreetInFlight = false;
          systemSpeakInFlight = false;
          if (!didSpeak) {
            try {
              window.__nrPiperPageGreetDone = false;
              window.__nrAnyWelcomeDone = false;
            } catch (eReset) {
              /* ignore */
            }
          }
        }
      };

      // Wenn die Seite bereits User-Activation hat (z. B. Engine-Auswahl-Click), sofort sprechen.
      try {
        const ua = navigator.userActivation;
        if (ua && ua.hasBeenActive) {
          speakSystem();
          return;
        }
      } catch (eUa) {
        /* ignore */
      }

      window.addEventListener(
        'pointerdown',
        function () {
          speakSystem();
        },
        { once: true, capture: true, passive: true }
      );
      window.addEventListener(
        'keydown',
        function () {
          speakSystem();
        },
        { once: true, capture: true }
      );
      return;
    }

    // Piper initialisiert tatsächlich länger (60MB Model + ONNX Session). Deshalb: vorwärmen sobald möglich,
    // dann beim eigentlichen Begrüßungs-Sprechen ist es sofort da.
    let prewarmPromise = null;
    function startPrewarmIfPossible(reason) {
      const p = window.NRPiperTTS;
      if (!p || typeof p.prepareNavTts !== 'function') {
        return false;
      }
      if (prewarmPromise) {
        return true;
      }
      const t0 = Date.now();
      prewarmPromise = p
        .prepareNavTts()
        .then(function (ok) {
          return !!ok;
        })
        .catch(function (err) {
          prewarmPromise = null;
          return false;
        });
      return true;
    }

    function trySpeakOnce() {
      if (greetedDone || window.__nrAnyWelcomeDone) {
        return true;
      }
      if (speakInFlight) {
        return true;
      }
      const p = window.NRPiperTTS;
      if (!p || typeof p.prepareNavTts !== 'function' || typeof p.speak !== 'function') {
        return false;
      }
      // Ohne User-Geste ist autoplay oft blockiert. Vermeidet Doppel-Ansage:
      // erst sprechen, wenn der Browser bereits User-Activation hatte (oder nach Geste).
      try {
        const ua = navigator.userActivation;
        const canAuto = !!(ua && ua.hasBeenActive);
        if (!hadUserGesture && !canAuto) {
          return true;
        }
      } catch (eUa) {
        // falls userActivation nicht verfügbar ist, weiter versuchen (altes Verhalten).
      }
      // SOFORT die In-Flight-Sperre setzen — bevor irgendein Promise startet, sonst können
      // parallele trySpeakOnce-Aufrufe (ready-Event + User-Geste + Direkt-Aufruf) jeweils
      // ein eigenes prepareNavTts().speak() lostreten und die Begrüßung mehrfach abfeuern.
      speakInFlight = true;
      if (typeof p.setVolume === 'function') {
        p.setVolume(volume);
      }
      const finishSuccess = function (used) {
        window.__nrPiperPageGreetInFlight = false;
        speakInFlight = false;
        if (used) {
          greetedDone = true;
          window.__nrPiperPageGreetDone = true;
          window.__nrAnyWelcomeDone = true;
        }
      };
      const finishFailure = function () {
        window.__nrPiperPageGreetInFlight = false;
        speakInFlight = false;
      };
      const launch = function () {
        // Nochmal prüfen, falls inzwischen eine andere Stelle (z. B. Nav-Welcome) gesprochen hat.
        if (greetedDone || window.__nrAnyWelcomeDone) {
          finishFailure();
          return;
        }
        void p
          .prepareNavTts()
          .then(function (ok) {
            if (!ok) {
              return false;
            }
            if (greetedDone || window.__nrAnyWelcomeDone) {
              return false;
            }
            return p.speak(phrase, { kind: 'mile', volume: volume });
          })
          .then(finishSuccess)
          .catch(finishFailure);
      };
      if (prewarmPromise) {
        void prewarmPromise.finally(launch);
      } else {
        launch();
      }
      return true;
    }

    const primeAndSpeak = function () {
      hadUserGesture = true;
      const p = window.NRPiperTTS;
      if (p && typeof p.primeAudioPlayback === 'function') {
        p.primeAudioPlayback();
      }
      startPrewarmIfPossible('user_gesture');
      if (!greetedDone) {
        trySpeakOnce();
      }
      if (greetedDone) {
        cleanupGestureListeners();
      }
    };

    function cleanupGestureListeners() {
      window.removeEventListener('pointerdown', primeAndSpeak, true);
      window.removeEventListener('keydown', primeAndSpeak, true);
    }

    // Falls Modul-Ready-Event schon gefeuert hat, sofort prewarm anstoßen.
    if (window.__nrPiperTtsReady) {
      startPrewarmIfPossible('ready_latch');
      trySpeakOnce();
    }
    window.addEventListener(
      'nr-piper-tts-ready',
      function () {
        startPrewarmIfPossible('ready_event');
        if (!greetedDone) {
          trySpeakOnce();
        }
      },
      { once: true }
    );

    // Direkt versuchen (ohne User-Geste klappt das nur, wenn der Browser bereits Activation meldet).
    trySpeakOnce();

    window.addEventListener('pointerdown', primeAndSpeak, { once: true, capture: true, passive: true });
    window.addEventListener('keydown', primeAndSpeak, { once: true, capture: true });

    window.setTimeout(function () {
      startPrewarmIfPossible('timer_early');
    }, 0);
  }

  (function bindPiperMapInitProgressBar() {
    if (!piperMapProgressWrap || !piperMapProgressFill) {
      return;
    }
    /** @type {number|null} */
    let hideTimer = null;
    function engineIsPiper() {
      try {
        const e = localStorage.getItem('nr_tts_engine');
        return e !== 'system';
      } catch (e0) {
        return true;
      }
    }
    function showBar() {
      if (!engineIsPiper()) return;
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      piperMapProgressWrap.classList.remove('is-complete');
      piperMapProgressWrap.hidden = false;
      piperMapProgressWrap.setAttribute('aria-hidden', 'false');
    }
    function hideBarDeferred(ms) {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
      hideTimer = window.setTimeout(function () {
        hideTimer = null;
        piperMapProgressWrap.hidden = true;
        piperMapProgressWrap.setAttribute('aria-hidden', 'true');
        piperMapProgressWrap.classList.remove('is-complete');
        piperMapProgressFill.style.width = '0%';
        piperMapProgressWrap.setAttribute('aria-valuenow', '0');
      }, typeof ms === 'number' ? ms : 0);
    }
    function setPct(pct, opts) {
      const v = Math.max(0, Math.min(100, Math.round(pct)));
      piperMapProgressFill.style.width = v + '%';
      piperMapProgressWrap.setAttribute('aria-valuenow', String(v));
      if (opts && opts.complete) {
        piperMapProgressWrap.classList.add('is-complete');
      }
    }

    window.addEventListener(
      'nr-piper-prewarm',
      function (ev) {
        const d = ev && ev.detail && typeof ev.detail === 'object' ? ev.detail : {};
        const st = d.state ? String(d.state) : '';
        if (!engineIsPiper()) {
          if (st === 'start' || st === 'progress') {
            return;
          }
        }
        if (st === 'start') {
          showBar();
          setPct(4, {});
          return;
        }
        if (st === 'progress') {
          showBar();
          const p = d.progress && typeof d.progress === 'object' ? d.progress : null;
          const total = p && Number.isFinite(Number(p.total)) ? Number(p.total) : 0;
          const loaded = p && Number.isFinite(Number(p.loaded)) ? Number(p.loaded) : 0;
          if (total > 0 && loaded >= 0) {
            setPct(Math.max(6, Math.min(96, (loaded / total) * 100)), {});
          } else {
            const cur = parseFloat(piperMapProgressFill.style.width || '0') || 0;
            setPct(Math.min(92, Math.max(cur, 10) + 5), {});
          }
          return;
        }
        if (st === 'ready') {
          setPct(100, { complete: true });
          hideBarDeferred(450);
          return;
        }
        if (st === 'failed' || st === 'error' || st === 'cancelled') {
          piperMapProgressWrap.classList.remove('is-complete');
          hideBarDeferred(st === 'cancelled' ? 120 : 280);
          return;
        }
      },
      false
    );
  })();

  setAuthRegisterMode(false);
  updateAuthUi();
  showInitialAuthNotice();

  (function bindLoginScreen() {
    const screen = document.getElementById('login-screen');
    if (!screen) return;
    const emailInput = document.getElementById('login-screen-email');
    const passwordInput = document.getElementById('login-screen-password');
    const submitBtn = document.getElementById('login-screen-submit');
    const skipBtn = document.getElementById('login-screen-skip');
    const msgEl = document.getElementById('login-screen-message');

    function showMsg(text) {
      if (!msgEl) return;
      msgEl.textContent = text || '';
      msgEl.hidden = !text;
    }

    function dismiss() {
      screen.style.opacity = '0';
      screen.style.transition = 'opacity 0.25s ease';
      window.setTimeout(function () {
        screen.remove();
      }, 280);
    }

    async function doLogin() {
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      if (!email) {
        showMsg('Bitte Benutzername oder E-Mail eingeben.');
        if (emailInput) emailInput.focus();
        return;
      }
      if (!password) {
        showMsg('Bitte Passwort eingeben.');
        if (passwordInput) passwordInput.focus();
        return;
      }
      showMsg('');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const data = await fetchJson(apiUrl('api/auth_login.php'), {
          method: 'POST',
          body: JSON.stringify({ email: email, password: password }),
        });
        if (!data.ok || !data.user) {
          throw new Error(data.error || 'Anmeldung fehlgeschlagen.');
        }
        state.currentUser = data.user;
        updateAuthUi();
        dismiss();
        await loadUserSettings();
        await loadSavedRoutes();
        refreshRouteButton();
        ensureTtsAfterLogin();
        maybeShowPiperFirstLoadHintAfterLogin();
        nrWarnOrsKeyMissingAfterLoginDeferred();
      } catch (err) {
        showMsg(err.message || String(err));
        if (passwordInput) passwordInput.value = '';
        if (submitBtn) submitBtn.disabled = false;
      }
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', doLogin);
    }
    if (passwordInput) {
      passwordInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') doLogin();
      });
    }
    if (emailInput) {
      emailInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          if (passwordInput && !passwordInput.value) {
            passwordInput.focus();
          } else {
            doLogin();
          }
        }
      });
    }
    if (skipBtn) {
      skipBtn.addEventListener('click', dismiss);
    }
  })();

  if (state.currentUser) {
    void loadUserSettings()
      .then(function () {
        ensureTtsAfterLogin();
      })
      .catch(function () {
        ensureTtsAfterLogin();
      });
    void loadSavedRoutes();
  }
  const piperTtsUi = (function bindPiperTtsDialog() {
    function forceHide() {
      const dialog = document.getElementById('piper-tts-dialog');
      if (!dialog) {
        return;
      }
      try {
        dialog.hidden = true;
        dialog.setAttribute('aria-hidden', 'true');
      } catch (e0) {
        /* ignore */
      }
    }
    forceHide();
    return {
      show: function () {},
      hide: forceHide,
      startActivation: function () {},
    };
  })();

  function isLikelyIosOrIpados() {
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
      // iPadOS 13+ meldet sich oft als Mac; Mobile-Token bleibt meist erhalten.
      if (/iPad|iPhone|iPod/i.test(ua)) return true;
      if (/Macintosh/i.test(ua) && /Mobile/i.test(ua)) return true;
      return false;
    } catch (e0) {
      return false;
    }
  }

  function getTtsEnginePref() {
    try {
      const cfg = window.NR_USER_SETTINGS && typeof window.NR_USER_SETTINGS === 'object' ? window.NR_USER_SETTINGS : null;
      const e = cfg && typeof cfg.ttsEngine === 'string' ? String(cfg.ttsEngine).toLowerCase() : '';
      if (e === 'piper' || e === 'system') return e;
    } catch (e0) {
      /* ignore */
    }
    try {
      const e = localStorage.getItem('nr_tts_engine');
      if (e === 'piper' || e === 'system') return e;
    } catch (e0) {
      /* ignore */
    }
    return null;
  }

  function setTtsEnginePref(engine) {
    try {
      localStorage.setItem('nr_tts_engine', engine);
    } catch (e0) {
      /* ignore */
    }
  }

  function persistTtsEngineForUser(engine) {
    const e = engine === 'system' ? 'system' : 'piper';
    try {
      if (!state.currentUser) {
        return Promise.resolve(null);
      }
    } catch (e0) {
      return Promise.resolve(null);
    }
    return fetchJson(apiUrl('api/settings.php'), {
      method: 'POST',
      body: JSON.stringify({ ttsEngine: e }),
    })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error((data && data.error) || 'TTS-Einstellung konnte nicht gespeichert werden.');
        }
        return data;
      })
      .catch(function () {
        // Absichtlich still: Engine bleibt lokal aktiv, Sync erfolgt beim nächsten Laden erneut.
        return null;
      });
  }

  (function bindGlobalTtsEngineSelect() {
    const btnPiper = document.getElementById('tts-engine-global-piper');
    const btnSystem = document.getElementById('tts-engine-global-system');
    if (!btnPiper || !btnSystem) {
      return;
    }
    const setUi = function (engine) {
      const isSystem = engine === 'system';
      btnPiper.setAttribute('aria-pressed', isSystem ? 'false' : 'true');
      btnSystem.setAttribute('aria-pressed', isSystem ? 'true' : 'false');
    };
    const pref = getTtsEnginePref();
    setUi(pref === 'system' ? 'system' : 'piper');

    const apply = function (engine) {
      const e = engine === 'system' ? 'system' : 'piper';
      setUi(e);
      setTtsEnginePref(e);
      if (state.currentUser) {
        try {
          window.NR_USER_SETTINGS = Object.assign({}, window.NR_USER_SETTINGS || {}, { ttsEngine: e });
        } catch (e0) {
          /* ignore */
        }
        void persistTtsEngineForUser(e);
      }

      if (e !== 'piper') {
        piperTtsUi.hide();
        if (window.NRPiperTTS && typeof window.NRPiperTTS.cancel === 'function') {
          window.NRPiperTTS.cancel();
        }
        if (typeof window.speechSynthesis !== 'undefined') {
          try {
            window.speechSynthesis.cancel();
          } catch (e0) {
            /* ignore */
          }
        }
        return;
      }

      // Piper ohne Modals automatisch im Hintergrund vorbereiten.
      if (!state.currentUser || !isNavVoiceEnabledFromPrefs()) {
        return;
      }
      ensurePiperAutoActivatedForVoice();
      piperTtsUi.hide();
      const p = window.NRPiperTTS;
      if (p && typeof p.prepareNavTts === 'function') {
        void p.prepareNavTts();
      }
      schedulePiperGreetingOnPageLoad();
    };

    btnPiper.addEventListener('click', function () {
      apply('piper');
    });
    btnSystem.addEventListener('click', function () {
      apply('system');
    });
  })();

  // Engine aus localStorage; Piper läuft ohne Aktivierungs-Dialoge.

  (function bindTtsEngineDialog() {
    const dialog = document.getElementById('tts-engine-dialog');
    const btnPiper = document.getElementById('tts-engine-piper');
    const btnSystem = document.getElementById('tts-engine-system');
    if (!dialog || (!btnPiper && !btnSystem)) {
      return;
    }
    function show() {
      dialog.hidden = false;
      dialog.setAttribute('aria-hidden', 'false');
    }
    function hide() {
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
    }
    function choose(engine) {
      const e = engine === 'system' ? 'system' : 'piper';
      setTtsEnginePref(e);
      if (state.currentUser) {
        try {
          window.NR_USER_SETTINGS = Object.assign({}, window.NR_USER_SETTINGS || {}, { ttsEngine: e });
        } catch (e0) {
          /* ignore */
        }
        void persistTtsEngineForUser(e);
      }
      hide();
      const btnP = document.getElementById('tts-engine-global-piper');
      const btnS = document.getElementById('tts-engine-global-system');
      if (btnP && btnS) {
        const isSystem = e === 'system';
        btnP.setAttribute('aria-pressed', isSystem ? 'false' : 'true');
        btnS.setAttribute('aria-pressed', isSystem ? 'true' : 'false');
      }
      if (e === 'piper' && state.currentUser && isNavVoiceEnabledFromPrefs()) {
        ensurePiperAutoActivatedForVoice();
        piperTtsUi.hide();
        const p = window.NRPiperTTS;
        if (p && typeof p.prepareNavTts === 'function') {
          void p.prepareNavTts();
        }
      } else {
        piperTtsUi.hide();
      }
      // Jetzt Begrüßung/Prewarm anstoßen (je nach Engine).
      schedulePiperGreetingOnPageLoad();
    }
    if (btnPiper) {
      btnPiper.addEventListener('click', function () {
        choose('piper');
      });
    }
    if (btnSystem) {
      btnSystem.addEventListener('click', function () {
        choose('system');
      });
    }
    const pref = getTtsEnginePref();
    // Keine Engine-Frage per Modal: Default Piper, nur System-TTS ist explizit.
    if (state.currentUser && isNavVoiceEnabledFromPrefs()) {
      const btnP = document.getElementById('tts-engine-global-piper');
      const btnS = document.getElementById('tts-engine-global-system');
      let prefEffective = pref;
      if (!prefEffective) {
        // iOS: Piper-Audio unterbricht/duckt häufig externe Hintergrundmusik. System-TTS ist hier robuster.
        const defaultEngine = isLikelyIosOrIpados() ? 'system' : 'piper';
        setTtsEnginePref(defaultEngine);
        prefEffective = defaultEngine;
      }
      if (btnP && btnS) {
        const isSystem = prefEffective === 'system';
        btnP.setAttribute('aria-pressed', isSystem ? 'false' : 'true');
        btnS.setAttribute('aria-pressed', isSystem ? 'true' : 'false');
      }
      hide();
      if (prefEffective === 'piper') {
        ensurePiperAutoActivatedForVoice();
        piperTtsUi.hide();
        const p = window.NRPiperTTS;
        if (p && typeof p.prepareNavTts === 'function') {
          void p.prepareNavTts();
        }
      } else {
        piperTtsUi.hide();
      }
      schedulePiperGreetingOnPageLoad();
    }
  })();

  // Begrüßung/Prewarm erst NACH Engine-Auswahl starten.
  updatePointStatus();
  refreshRouteButton();
})();
