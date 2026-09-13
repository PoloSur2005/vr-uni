/* global AFRAME */

/**
 * Lógica de la interfaz: el botón "Ver en VR" elige el mejor modo según el dispositivo.
 *  - Visor con WebXR (Quest, Pico, Android con Cardboard, PC con visor): sesión immersive-vr de A-Frame.
 *  - Celular sin WebXR (iPhone, algunos Android): modo estéreo propio (js/components.js).
 *  - Computadora sin visor: pantalla completa.
 */
(function () {
  var sceneEl = document.querySelector('a-scene');
  var body = document.body;
  var btnVR = document.getElementById('btn-vr');
  var btnIcon = btnVR.querySelector('.icon');
  var btnLabel = btnVR.querySelector('.label');
  var btnExit = document.getElementById('btn-exit-stereo');
  var rotateHint = document.getElementById('rotate-hint');
  var hint = document.getElementById('hint');

  var device = AFRAME.utils.device;
  var isMobile = device.isMobile() || device.isMobileDeviceRequestingDesktopSite();
  var portrait = window.matchMedia('(orientation: portrait)');

  var xrSupported = false;
  var wakeLock = null;
  var stereoFullscreen = false;
  var exitButtonTimer = null;

  function noop () {}

  if (isMobile) {
    hint.textContent = 'Mueve el celular o arrastra para mirar';
  }

  // Evita que Safari haga zoom a toda la página al pellizcar.
  document.addEventListener('gesturestart', function (evt) { evt.preventDefault(); });

  Promise.all([sceneLoaded(), detectXR()]).then(function (results) {
    xrSupported = results[1];
    updateButton();
    btnVR.disabled = false;
  });

  // Un visor de PC puede conectarse después de cargar la página.
  if (navigator.xr && navigator.xr.addEventListener) {
    navigator.xr.addEventListener('devicechange', function () {
      detectXR().then(function (supported) {
        xrSupported = supported;
        updateButton();
      });
    });
  }

  /* ---------- Botón principal ---------- */

  btnVR.addEventListener('click', function () {
    if (xrSupported) {
      sceneEl.enterVR().catch(function (err) {
        console.warn('No se pudo iniciar WebXR.', err);
        if (isMobile) { enterStereo(); }
      });
    } else if (isMobile) {
      enterStereo();
    } else if (fullscreenElement()) {
      exitFullscreen();
    } else {
      requestFullscreen(document.documentElement);
    }
  });

  function updateButton () {
    if (xrSupported || isMobile) {
      setButton('🕶️', 'Ver en VR');
    } else if (fullscreenElement()) {
      setButton('✕', 'Salir de pantalla completa');
    } else {
      setButton('⛶', 'Pantalla completa');
    }
  }

  function setButton (icon, label) {
    btnIcon.textContent = icon;
    btnLabel.textContent = label;
  }

  /* ---------- Modo estéreo (Cardboard sin WebXR) ---------- */

  function enterStereo () {
    // Todo lo que requiere un gesto del usuario se pide aquí, dentro del clic.
    requestOrientationPermission();
    requestFullscreen(document.documentElement).then(function (ok) {
      stereoFullscreen = ok;
      if (ok && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(noop);
      }
    });
    requestWakeLock();
    sceneEl.systems['stereo-fallback'].enable();
  }

  function exitStereo () {
    sceneEl.systems['stereo-fallback'].disable();
  }

  sceneEl.addEventListener('stereo-enter', function () {
    body.classList.add('is-vr', 'is-stereo');
    btnExit.hidden = false;
    showExitButton();
    updateRotateHint();
  });

  sceneEl.addEventListener('stereo-exit', function () {
    body.classList.remove('is-vr', 'is-stereo');
    btnExit.hidden = true;
    rotateHint.hidden = true;
    releaseWakeLock();
    if (screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) { /* no soportado */ }
    }
    if (stereoFullscreen && fullscreenElement()) { exitFullscreen(); }
    stereoFullscreen = false;
  });

  btnExit.addEventListener('click', function (evt) {
    evt.stopPropagation();
    exitStereo();
  });

  // Dentro del visor el botón de salir se desvanece; un toque en la pantalla lo vuelve a mostrar.
  document.addEventListener('pointerdown', function () {
    if (sceneEl.is('stereo-mode')) { showExitButton(); }
  });

  function showExitButton () {
    btnExit.classList.add('visible');
    clearTimeout(exitButtonTimer);
    exitButtonTimer = setTimeout(function () { btnExit.classList.remove('visible'); }, 3000);
  }

  function updateRotateHint () {
    rotateHint.hidden = !(sceneEl.is('stereo-mode') && portrait.matches);
  }

  if (portrait.addEventListener) {
    portrait.addEventListener('change', updateRotateHint);
  } else if (portrait.addListener) {
    portrait.addListener(updateRotateHint);
  }

  document.addEventListener('keydown', function (evt) {
    if (evt.key === 'Escape' && sceneEl.is('stereo-mode')) { exitStereo(); }
  });

  /* ---------- VR con WebXR ---------- */

  sceneEl.addEventListener('enter-vr', function () { body.classList.add('is-vr'); });
  sceneEl.addEventListener('exit-vr', function () { body.classList.remove('is-vr'); });

  /* ---------- Pantalla completa ---------- */

  function onFullscreenChange () {
    // En Android, salir de pantalla completa (botón atrás) también sale del modo estéreo.
    if (!fullscreenElement() && stereoFullscreen && sceneEl.is('stereo-mode')) {
      stereoFullscreen = false;
      exitStereo();
    }
    updateButton();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  function fullscreenElement () {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function requestFullscreen (el) {
    var fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) { return Promise.resolve(false); }
    try {
      return Promise.resolve(fn.call(el, {navigationUI: 'hide'})).then(
        function () { return true; },
        function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function exitFullscreen () {
    var fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) { Promise.resolve(fn.call(document)).catch(noop); }
  }

  /* ---------- Sensores y wake lock ---------- */

  // iOS pide permiso explícito para el giroscopio. look-controls lo activa al recibir
  // el evento 'deviceorientationpermissiongranted' en la escena.
  function requestOrientationPermission () {
    if (typeof DeviceOrientationEvent === 'undefined' || !DeviceOrientationEvent.requestPermission) { return; }
    var permissionUI = sceneEl.components['device-orientation-permission-ui'];
    if (permissionUI && permissionUI.permissionGranted) { return; }

    DeviceOrientationEvent.requestPermission().then(function (response) {
      if (response !== 'granted') { return; }
      if (permissionUI) {
        permissionUI.permissionGranted = true;
        var dialog = permissionUI.devicePermissionDialogEl;
        if (dialog && dialog.parentNode) { dialog.parentNode.removeChild(dialog); }
      }
      sceneEl.emit('deviceorientationpermissiongranted');
    }).catch(function (err) {
      console.warn('Permiso de sensores no concedido.', err);
    });
  }

  // Evita que la pantalla se apague mientras el celular está dentro del visor.
  function requestWakeLock () {
    if (!('wakeLock' in navigator)) { return; }
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
    }).catch(noop);
  }

  function releaseWakeLock () {
    if (wakeLock) {
      wakeLock.release().catch(noop);
      wakeLock = null;
    }
  }

  // El sistema libera el wake lock al cambiar de pestaña; se vuelve a pedir al regresar.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && sceneEl.is('stereo-mode')) { requestWakeLock(); }
  });

  /* ---------- Utilidades ---------- */

  function sceneLoaded () {
    return new Promise(function (resolve) {
      if (sceneEl.hasLoaded) {
        resolve();
      } else {
        sceneEl.addEventListener('loaded', resolve, {once: true});
      }
    });
  }

  function detectXR () {
    if (!navigator.xr || !navigator.xr.isSessionSupported) { return Promise.resolve(false); }
    return navigator.xr.isSessionSupported('immersive-vr').catch(function () { return false; });
  }
})();
