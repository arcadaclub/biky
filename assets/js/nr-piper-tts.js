/**
 * Piper TTS (de_DE-thorsten-medium): lokales @mintplex-labs/piper-tts-web unter assets/vendor/
 * + ONNX-WASM + Piper-Phonemize selbst gehostet (ohne esm.sh).
 * ONNX: Import-Map in index.php → onnxruntime-web → assets/vendor/onnxruntime-web/ort.min.js
 * Modelle: Self-hosted unter assets/vendor/piper-voices/ (Remote nur Fallback).
 * Fallback: dynamischer Import von esm.sh, falls lokales Modul fehlt.
 */
const DEFAULT_VOICE_ID = 'de_DE-thorsten-medium';
const AVAILABLE_VOICE_IDS = new Set([DEFAULT_VOICE_ID]);
let voiceIdCurrent = DEFAULT_VOICE_ID;

const NR_TTS_BOOT_TS = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
function nrTtsDebugEnabled() {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search || '');
    if ((params.get('nrlog') || '').toLowerCase() === 'tts') return true;
    return window.localStorage && window.localStorage.getItem('nr_debug_tts') === '1';
  } catch (e) {
    return false;
  }
}
function nrTtsLog() {
  if (!nrTtsDebugEnabled()) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const dt = Math.round(now - NR_TTS_BOOT_TS);
  try {
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[NRPiperTTS +' + dt + 'ms]');
    console.info.apply(console, args);
  } catch (e) {
    /* ignore */
  }
}

const PIPER_MODULE_LOCAL = new URL('../vendor/piper-tts-web/piper-tts-web.js', import.meta.url).href;
// External fallback intentionally disabled (project is self-hosted).
const PIPER_ESM_FALLBACK = null;

let ttsApi = null;
let loadPromise = null;
let sessionPromise = null;
let currentAudio = null;
let currentObjectUrl = null;
let currentPlaybackAbort = null;
/** @type {Promise<boolean>|null} */
let prepareNavPromise = null;
let prepareAbortController = null;
let backgroundWarmupStarted = false;
let currentVolume = 1;
let activeSpeakJob = null;
let pendingSpeakJob = null;
let speakJobSeq = 0;
let autoplayUnlockBound = false;

function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.max(0, Math.min(1, n));
}

function isLikelyIosOrIpados() {
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

function nrAssetUrl(relPath) {
  const clean = relPath.replace(/^\//, '');
  const base = typeof window.NR_BASE === 'string' ? window.NR_BASE.replace(/\/$/, '') : '';
  const path = (base ? base + '/' : '') + 'assets/' + clean;
  const abs = path.startsWith('/') ? path : '/' + path;
  return window.location.origin + abs;
}

function onnxWasmDirUrl() {
  let u = nrAssetUrl('vendor/onnxruntime-web');
  if (!u.endsWith('/')) {
    u += '/';
  }
  return u;
}

function revokeCurrentUrl() {
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl);
    } catch (e) {
      /* ignorieren */
    }
    currentObjectUrl = null;
  }
}

function ensurePlaybackAudio() {
  if (currentAudio) {
    return currentAudio;
  }
  const audio = new Audio();
  audio.preload = 'auto';
  try {
    audio.playsInline = true;
  } catch (e) {
    /* ältere Engines */
  }
  try {
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
  } catch (e2) {
    /* ignorieren */
  }
  try {
    if (typeof document !== 'undefined' && document.body && !audio.parentNode) {
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }
  } catch (e3) {
    /* ignorieren */
  }
  currentAudio = audio;
  return audio;
}

function cancelPlayback() {
  if (typeof currentPlaybackAbort === 'function') {
    try {
      currentPlaybackAbort();
    } catch (e0) {
      /* ignorieren */
    }
    currentPlaybackAbort = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch (e) {
      /* ignorieren */
    }
    try {
      currentAudio.removeAttribute('src');
      currentAudio.load();
    } catch (e2) {
      /* ignorieren */
    }
  }
  revokeCurrentUrl();
}

function settleSpeakJob(job, ok) {
  if (!job || job.done) {
    return;
  }
  job.done = true;
  try {
    job.resolve(!!ok);
  } catch (e) {
    /* ignorieren */
  }
}

/**
 * Laufende / anstehende Sprachausgabe stoppen, aber kein Modell-Download und keine ONNX-Session abbrechen.
 * Volles cancel() beendet zusaetzlich prepareNavTts per AbortController — das darf nicht bei jeder Step-Ansage passieren.
 */
function cancelSpeech() {
  if (pendingSpeakJob) {
    pendingSpeakJob.cancelled = true;
    settleSpeakJob(pendingSpeakJob, false);
    pendingSpeakJob = null;
  }
  if (activeSpeakJob) {
    activeSpeakJob.cancelled = true;
  }
  cancelPlayback();
}

/**
 * Safari/macOS: Audio-Wiedergabe nur nach Nutzeraktion; WebAudio kurz anstoßen + leises Sample,
 * damit spätere Piper-WAVs per play() nicht blockieren.
 */
function primeAudioPlayback() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) {
      const ctx = new Ctor();
      void ctx.resume().catch(function () {});
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(0);
      osc.stop(ctx.currentTime + 0.02);
      void ctx.close().catch(function () {});
    }
  } catch (e) {
    /* ignorieren */
  }
  try {
    const a = new Audio(
      'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
    );
    a.volume = 0.0001;
    void a.play().catch(function () {});
  } catch (e2) {
    /* ignorieren */
  }
}

function bindAutoplayUnlockOnce() {
  if (autoplayUnlockBound) {
    return;
  }
  autoplayUnlockBound = true;
  const unlock = function () {
    try {
      primeAudioPlayback();
    } catch (e) {
      /* ignore */
    }
    cleanup();
  };
  const cleanup = function () {
    ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(function (evt) {
      try {
        window.removeEventListener(evt, unlock, true);
      } catch (e) {
        /* ignore */
      }
    });
  };
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(function (evt) {
    try {
      window.addEventListener(evt, unlock, true);
    } catch (e) {
      /* ignore */
    }
  });
}

async function loadTtsModule() {
  if (ttsApi) {
    return ttsApi;
  }
  if (loadPromise) {
    return loadPromise;
  }
  nrTtsLog('loadTtsModule: import start', PIPER_MODULE_LOCAL);
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  loadPromise = import(PIPER_MODULE_LOCAL)
    .then(function (m) {
      ttsApi = m;
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      nrTtsLog('loadTtsModule: import done in', Math.round(t1 - t0), 'ms');
      return m;
    })
    .catch(function (err2) {
      console.warn('[NRPiperTTS] Piper konnte nicht geladen werden:', err2);
      ttsApi = null;
      loadPromise = null;
      throw err2;
    });
  return loadPromise;
}

/**
 * Session mit selbst gehosteten WASM-Pfaden (nur sinnvoll bei lokalem Modul).
 */
async function getTtsSession(onProgress) {
  if (sessionPromise) {
    try {
      return await sessionPromise;
    } catch {
      sessionPromise = null;
    }
  }
  const m = await loadTtsModule();
  if (!m.TtsSession || typeof m.TtsSession.create !== 'function') {
    throw new Error('TtsSession nicht verfügbar');
  }

  const wasmPaths = {
    onnxWasm: onnxWasmDirUrl(),
    piperWasm: nrAssetUrl('vendor/piper-wasm/piper_phonemize.wasm'),
    piperData: nrAssetUrl('vendor/piper-wasm/piper_phonemize.data'),
  };

  const created = m.TtsSession.create({
    voiceId: voiceIdCurrent,
    progress: onProgress,
    wasmPaths: wasmPaths,
  });
  sessionPromise = created.catch(function (err) {
    sessionPromise = null;
    throw err;
  });
  return sessionPromise;
}

async function warmup() {
  try {
    await loadTtsModule();
    return !!ttsApi && typeof ttsApi.download === 'function';
  } catch (e) {
    return false;
  }
}

/**
 * @param {(ev: { url: string; total: number; loaded: number }) => void} [onProgress]
 */
async function preload(onProgress) {
  try {
    const m = await loadTtsModule();
    if (!m || typeof m.download !== 'function') {
      return false;
    }
    try {
      if (typeof m.stored === 'function') {
        const storedList = await m.stored();
        if (Array.isArray(storedList) && storedList.indexOf(voiceIdCurrent) >= 0) {
          nrTtsLog('preload: voice already in OPFS cache', voiceIdCurrent);
          return true;
        }
        nrTtsLog('preload: voice NOT in OPFS, will download', voiceIdCurrent);
      }
    } catch (eStored) {
      /* ohne OPFS weiter mit Download */
    }
    // Manche Browser/Netze liefern gelegentlich einen kaputten Stream ("Error in input stream").
    // Dann einmal neu versuchen.
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (prepareAbortController && prepareAbortController.signal && prepareAbortController.signal.aborted) {
        return false;
      }
      try {
        await m.download(voiceIdCurrent, onProgress);
        return true;
      } catch (eAttempt) {
        if (prepareAbortController && prepareAbortController.signal && prepareAbortController.signal.aborted) {
          return false;
        }
        console.warn('[NRPiperTTS] Vorladen/Download fehlgeschlagen:', eAttempt);
        // Beschädigte/halbe Downloads im Storage entfernen, dann erneut versuchen.
        try {
          if (typeof m.remove === 'function') {
            await m.remove(voiceIdCurrent);
          } else if (typeof m.flush === 'function') {
            await m.flush();
          }
        } catch (eRm) {
          console.warn('[NRPiperTTS] Voice-Cleanup fehlgeschlagen:', eRm);
        }
        if (attempt >= 5) {
          return false;
        }
        await new Promise(function (r) {
          // Exponentielles Backoff: 0.6s, 1.2s, 2.4s, 4.8s ...
          window.setTimeout(r, 600 * Math.pow(2, attempt - 1));
        });
      }
    }
    return false;
  } catch (e) {
    console.warn('[NRPiperTTS] Vorladen/Download fehlgeschlagen:', e);
    return false;
  }
}

/**
 * Modul, Stimme, ONNX-Session und eine kurze Synthese vorab laden — erste Navigationsansage ohne große Verzögerung.
 *
 * @param {(ev: { url: string; total: number; loaded: number }) => void} [onProgress]
 * @returns {Promise<boolean>}
 */
async function prepareNavTts(onProgress) {
  if (prepareNavPromise) {
    return prepareNavPromise;
  }
  // Neuen AbortController für diesen Prepare-Lauf setzen, damit "Abbrechen" wirklich Downloads stoppt.
  try {
    prepareAbortController = new AbortController();
    globalThis.__nrPiperAbortSignal = prepareAbortController.signal;
  } catch (eAbort) {
    prepareAbortController = null;
    try {
      globalThis.__nrPiperAbortSignal = void 0;
    } catch (e0) {
      /* ignore */
    }
  }
  prepareNavPromise = (async function () {
    try {
      window.dispatchEvent(new CustomEvent('nr-piper-prewarm', { detail: { state: 'start' } }));
    } catch (e0) {
      /* ignore */
    }
    try {
      await warmup();
      const progressCb =
        typeof onProgress === 'function'
          ? function (ev) {
              try {
                onProgress(ev);
              } catch (eCb) {
                /* ignore */
              }
              try {
                window.dispatchEvent(new CustomEvent('nr-piper-prewarm', { detail: { state: 'progress', progress: ev } }));
              } catch (eEvt) {
                /* ignore */
              }
            }
          : function (ev) {
              try {
                window.dispatchEvent(new CustomEvent('nr-piper-prewarm', { detail: { state: 'progress', progress: ev } }));
              } catch (eEvt) {
                /* ignore */
              }
            };

      const tPre = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const okPreload = await preload(progressCb);
      const tPreEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      nrTtsLog('prepareNavTts: preload done in', Math.round(tPreEnd - tPre), 'ms ok=', okPreload);
      if (!okPreload) {
        if (prepareAbortController && prepareAbortController.signal && prepareAbortController.signal.aborted) {
          try {
            window.dispatchEvent(new CustomEvent('nr-piper-prewarm', { detail: { state: 'cancelled' } }));
          } catch (eC) {
            /* ignore */
          }
          return false;
        }
        try {
          window.dispatchEvent(new CustomEvent('nr-piper-prewarm', { detail: { state: 'failed' } }));
        } catch (e1) {
          /* ignore */
        }
        return false;
      }
      const tS0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const session = await getTtsSession(undefined);
      const tS1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      nrTtsLog('prepareNavTts: TtsSession.create in', Math.round(tS1 - tS0), 'ms');
      if (session && typeof session.predict === 'function') {
        const tP0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const blob = await session.predict('So.');
        const tP1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        nrTtsLog('prepareNavTts: warmup predict in', Math.round(tP1 - tP0), 'ms blob=', blob && blob.size);
      }
      try {
        window.dispatchEvent(new CustomEvent('nr-piper-prewarm', { detail: { state: 'ready' } }));
      } catch (e2) {
        /* ignore */
      }
      return true;
    } catch (e) {
      if (prepareAbortController && prepareAbortController.signal && prepareAbortController.signal.aborted) {
        prepareNavPromise = null;
        try {
          window.dispatchEvent(new CustomEvent('nr-piper-prewarm', { detail: { state: 'cancelled' } }));
        } catch (eC2) {
          /* ignore */
        }
        return false;
      }
      prepareNavPromise = null;
      console.warn('[NRPiperTTS] prepareNavTts:', e);
      try {
        window.dispatchEvent(new CustomEvent('nr-piper-prewarm', { detail: { state: 'error', message: e && e.message ? String(e.message) : '' } }));
      } catch (e3) {
        /* ignore */
      }
      return false;
    } finally {
      // Signal wieder entfernen, damit spätere normale Fetches nicht beeinflusst werden.
      try {
        globalThis.__nrPiperAbortSignal = void 0;
      } catch (eSig) {
        /* ignore */
      }
    }
  })();
  return prepareNavPromise;
}

function scheduleBackgroundWarmup() {
  if (backgroundWarmupStarted) {
    return;
  }
  backgroundWarmupStarted = true;
  const run = function () {
    void warmup().catch(function () {});
  };
  if (typeof window.requestIdleCallback === 'function') {
    // Niedrigere Timeout-Schranke: früher starten wenn die Seite beschäftigt ist,
    // damit Piper-Modul/Import nicht erst nach ~1.8s angegangen wird.
    window.requestIdleCallback(run, { timeout: 450 });
    return;
  }
  window.setTimeout(run, 180);
}

function shouldAutoPrewarmFromPrefs() {
  try {
    const engine = localStorage.getItem('nr_tts_engine');
    if (engine === 'system') {
      return false;
    }
  } catch (e0) {
    /* ignore */
  }
  try {
    if (localStorage.getItem('nr_nav_voice') === '0') {
      return false;
    }
  } catch (e1) {
    /* ignore */
  }
  return true;
}

/**
 * @param {string} text
 * @param {{ kind?: 'step' | 'mile' | 'curve' }} [opts]
 * @returns {Promise<boolean>}
 */
async function performSpeakJob(job) {
  const opts = job.opts || {};
  try {
    if (isLikelyIosOrIpados()) {
      primeAudioPlayback();
    }
    let session = await getTtsSession(undefined);
    let blob;
    try {
      blob = await session.predict(job.text);
    } catch (ePredict) {
      // Wenn der Voice-Download-Stream kaputt war, kann ein Session-Reset helfen.
      console.warn('[NRPiperTTS] predict fehlgeschlagen, retry nach session reset:', ePredict);
      sessionPromise = null;
      session = await getTtsSession(undefined);
      blob = await session.predict(job.text);
    }
    if (job.cancelled) {
      return false;
    }
    if (!blob || blob.size < 200) {
      return false;
    }

    cancelPlayback();
    const url = URL.createObjectURL(blob);
    currentObjectUrl = url;
    const audio = ensurePlaybackAudio();
    audio.src = url;
    audio.volume = clampVolume(opts.volume != null ? opts.volume : currentVolume);

    await new Promise(function (resolve, reject) {
      function cleanup() {
        currentPlaybackAbort = null;
        revokeCurrentUrl();
      }
      currentPlaybackAbort = function () {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onErr);
        cleanup();
        resolve(false);
      };
      function onEnded() {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onErr);
        cleanup();
        resolve(true);
      }
      function onErr() {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onErr);
        cleanup();
        if (job.cancelled) {
          resolve(false);
          return;
        }
        reject(new Error('Piper-Audiofehler'));
      }
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onErr);
      function tryPlayBlob() {
        try {
          audio.currentTime = 0;
        } catch (ePos) {
          /* ignorieren */
        }
        try {
          audio.load();
        } catch (eLd) {
          /* ignorieren */
        }
        return audio.play().catch(function (playErr) {
          if (isLikelyIosOrIpados()) {
            primeAudioPlayback();
            try {
              audio.load();
            } catch (eLd2) {
              /* ignorieren */
            }
            return audio.play();
          }
          throw playErr;
        });
      }
      tryPlayBlob().catch(function (playErr) {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onErr);
        cleanup();
        try {
          const name = playErr && playErr.name ? String(playErr.name) : '';
          const msg = playErr && playErr.message ? String(playErr.message) : String(playErr || '');
          const blocked =
            name === 'NotAllowedError' ||
            msg.includes('play method is not allowed') ||
            msg.includes('not allowed by the user agent') ||
            msg.includes('user denied permission');
          if (blocked) {
            window.dispatchEvent(new CustomEvent('nr-piper-autoplay-blocked', { detail: { message: msg } }));
        bindAutoplayUnlockOnce();
          }
        } catch (e0) {
          /* ignore */
        }
        reject(playErr);
      });
    });
    return true;
  } catch (e) {
    console.warn('[NRPiperTTS] Synthese oder Wiedergabe fehlgeschlagen:', e);
    sessionPromise = null;
    cancelPlayback();
    return false;
  }
}

function pumpSpeakQueue() {
  if (activeSpeakJob || !pendingSpeakJob) {
    return;
  }
  const job = pendingSpeakJob;
  pendingSpeakJob = null;
  activeSpeakJob = job;
  void performSpeakJob(job)
    .then(function (ok) {
      settleSpeakJob(job, ok);
    })
    .catch(function () {
      settleSpeakJob(job, false);
    })
    .finally(function () {
      if (activeSpeakJob === job) {
        activeSpeakJob = null;
      }
      if (pendingSpeakJob) {
        pumpSpeakQueue();
      }
    });
}

async function speak(text, _opts) {
  const opts = _opts || {};
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return false;
  }
  const replaceCurrent = opts.kind === 'step';
  return new Promise(function (resolve) {
    const job = {
      id: ++speakJobSeq,
      text: trimmed,
      opts: opts,
      resolve: resolve,
      cancelled: false,
      done: false,
    };
    if (pendingSpeakJob) {
      pendingSpeakJob.cancelled = true;
      settleSpeakJob(pendingSpeakJob, false);
    }
    pendingSpeakJob = job;
    if (replaceCurrent && activeSpeakJob) {
      activeSpeakJob.cancelled = true;
      cancelPlayback();
    }
    pumpSpeakQueue();
  });
}

function cancel() {
  // laufende Prepare/Downloads abbrechen
  if (prepareAbortController) {
    try {
      prepareAbortController.abort();
    } catch (eAbort) {
      /* ignore */
    }
  }
  prepareAbortController = null;
  prepareNavPromise = null;
  try {
    globalThis.__nrPiperAbortSignal = void 0;
  } catch (eSig) {
    /* ignore */
  }
  cancelSpeech();
}

function setVolume(value) {
  currentVolume = clampVolume(value);
  if (currentAudio) {
    try {
      currentAudio.volume = currentVolume;
    } catch (e) {
      /* ignorieren */
    }
  }
  return currentVolume;
}

function getVolume() {
  return currentVolume;
}

window.NRPiperTTS = {
  VOICE_ID: voiceIdCurrent,
  setVoiceId: function (nextId) {
    const prev = voiceIdCurrent;
    const id = (nextId || '').trim();
    if (!id) {
      return voiceIdCurrent;
    }
    const desired = AVAILABLE_VOICE_IDS.has(id) ? id : DEFAULT_VOICE_ID;
    if (desired !== id) {
      console.warn('[NRPiperTTS] Unbekannte Stimme (nicht self-hosted), fallback:', id, '→', desired);
    }
    if (desired === prev) {
      return prev;
    }
    voiceIdCurrent = desired;
    // Reset cached state so next prepare/speak uses the new voice.
    prepareNavPromise = null;
    sessionPromise = null;
    cancelPlayback();
    window.NRPiperTTS.VOICE_ID = voiceIdCurrent;
    return voiceIdCurrent;
  },
  warmup: warmup,
  preload: preload,
  prepareNavTts: prepareNavTts,
  scheduleBackgroundWarmup: scheduleBackgroundWarmup,
  speak: speak,
  cancelSpeech: cancelSpeech,
  cancel: cancel,
  setVolume: setVolume,
  getVolume: getVolume,
  primeAudioPlayback: primeAudioPlayback,
};

try {
  // Latch zusätzlich zum Event setzen, damit später ankommende Listener (in app.js)
  // nicht ins Leere laufen, wenn das Event bereits gefeuert wurde.
  window.__nrPiperTtsReady = true;
  window.dispatchEvent(new CustomEvent('nr-piper-tts-ready'));
} catch (e) {
  /* ignorieren */
}

// Aggressiver Warmstart aus Cache:
// - lädt das Piper-Modul früh (idle/timer) und stößt (wenn User bereits aktiviert hat) prepareNavTts an,
//   damit OPFS/Model/Session beim ersten "echten" Sprechen möglichst schon bereit sind.
try {
  // Immer warmup im Idle, auch ohne Aktivierung (nur Modul-Load, keine Downloads).
  scheduleBackgroundWarmup();
  if (shouldAutoPrewarmFromPrefs()) {
    const runPrepare = function () {
      void prepareNavTts().catch(function () {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      // Vorher sehr hohes Timeout (~2.2s): Bei Last auf dem Main Thread startete prepareNavTts spät —
      // Begrüßung wirkte dann deutlich verzögert. 500ms bleibt hinter kritischem Laden zurück.
      window.requestIdleCallback(runPrepare, { timeout: 500 });
    } else {
      window.setTimeout(runPrepare, 240);
    }
  }
} catch (e0) {
  /* ignore */
}
