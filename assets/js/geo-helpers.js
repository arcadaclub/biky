/**
 * Gemeinsame Geolocation-Hilfen (Safari/iOS: HTTPS erforderlich; Timeout-Fallback).
 */
(function (global) {
  'use strict';

  var PERMISSION_DENIED = 1;
  var POSITION_UNAVAILABLE = 2;
  var TIMEOUT = 3;

  function isSecureContext() {
    if (typeof global.isSecureContext === 'boolean') {
      return global.isSecureContext;
    }
    try {
      var loc = global.location;
      if (!loc) {
        return true;
      }
      if (loc.protocol === 'https:') {
        return true;
      }
      var host = (loc.hostname || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') {
        return true;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  function userMessage(err) {
    if (!isSecureContext()) {
      return (
        'Standort funktioniert in Safari auf dem iPhone nur über HTTPS. ' +
        'Eine Seite wie http://192.168.… oder http://rechner.local liefert keinen GPS-Zugriff. ' +
        'Bitte mit https:// aufrufen (z. B. über einen Tunnel mit TLS oder ein Hosting mit Zertifikat).'
      );
    }
    var code = err && err.code;
    if (code === PERMISSION_DENIED) {
      return (
        'Standortzugriff wurde abgelehnt. Am iPhone: Einstellungen → Safari → Websites → Standort ' +
        'oder Einstellungen → Datenschutz & Sicherheit → Ortungsdienste → Safari-Websites prüfen.'
      );
    }
    if (code === TIMEOUT) {
      return (
        'GPS hat zu lange gebraucht (Zeitüberschreitung). Kurz nach draußen gehen, WLAN/ Mobilfunk prüfen und erneut versuchen.'
      );
    }
    if (code === POSITION_UNAVAILABLE) {
      return 'Standortdienst meldet keine Position. Bitte später erneut versuchen.';
    }
    return 'Position konnte nicht ermittelt werden. Berechtigung, HTTPS und Ortungsdienste prüfen.';
  }

  /**
   * @param {PositionCallback} success
   * @param {PositionErrorCallback|null} onFailure
   * @param {PositionOptions} [primaryOpts]
   */
  function getCurrentPosition(success, onFailure, primaryOpts) {
    var geo = global.navigator && global.navigator.geolocation;
    if (!geo) {
      if (onFailure) {
        onFailure(null);
      }
      return;
    }
    if (!isSecureContext()) {
      if (onFailure) {
        onFailure({ code: 0, message: 'insecure' });
      }
      return;
    }
    var high = Object.assign(
      { enableHighAccuracy: true, maximumAge: 0, timeout: 28000 },
      primaryOpts || {}
    );
    var low = { enableHighAccuracy: false, maximumAge: 60000, timeout: 22000 };
    geo.getCurrentPosition(
      success,
      function (err) {
        var retry = err && (err.code === TIMEOUT || err.code === POSITION_UNAVAILABLE);
        if (!retry) {
          if (onFailure) {
            onFailure(err);
          }
          return;
        }
        geo.getCurrentPosition(
          success,
          function (err2) {
            if (onFailure) {
              onFailure(err2 || err);
            }
          },
          low
        );
      },
      high
    );
  }

  global.NRGeo = {
    isSecureContext: isSecureContext,
    userMessage: userMessage,
    getCurrentPosition: getCurrentPosition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
