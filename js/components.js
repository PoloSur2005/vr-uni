/* global AFRAME */

/**
 * zoom-controls: acerca o aleja cambiando el FOV de la cámara
 * con la rueda del mouse (escritorio) o pellizcando con dos dedos (celular).
 * Se desactiva dentro de VR y del modo estéreo.
 */
AFRAME.registerComponent('zoom-controls', {
  schema: {
    min: {default: 35},
    max: {default: 95},
    wheelSpeed: {default: 0.05}
  },

  init: function () {
    this.pinchDistance = null;
    this.onWheel = this.onWheel.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
  },

  play: function () {
    var sceneEl = this.el.sceneEl;
    sceneEl.addEventListener('wheel', this.onWheel, {passive: false});
    sceneEl.addEventListener('touchstart', this.onTouchStart, {passive: true});
    sceneEl.addEventListener('touchmove', this.onTouchMove, {passive: true});
    sceneEl.addEventListener('touchend', this.onTouchEnd, {passive: true});
  },

  pause: function () {
    var sceneEl = this.el.sceneEl;
    sceneEl.removeEventListener('wheel', this.onWheel);
    sceneEl.removeEventListener('touchstart', this.onTouchStart);
    sceneEl.removeEventListener('touchmove', this.onTouchMove);
    sceneEl.removeEventListener('touchend', this.onTouchEnd);
  },

  isBlocked: function () {
    var sceneEl = this.el.sceneEl;
    return sceneEl.is('vr-mode') || sceneEl.is('stereo-mode');
  },

  setFov: function (fov) {
    var data = this.data;
    this.el.setAttribute('camera', 'fov', Math.min(data.max, Math.max(data.min, fov)));
  },

  onWheel: function (evt) {
    if (this.isBlocked()) { return; }
    evt.preventDefault();
    // deltaMode 1 = líneas (Firefox); se convierte a píxeles aproximados.
    var delta = evt.deltaMode === 1 ? evt.deltaY * 33 : evt.deltaY;
    this.setFov(this.el.getAttribute('camera').fov + delta * this.data.wheelSpeed);
  },

  onTouchStart: function (evt) {
    if (evt.touches.length === 2) { this.pinchDistance = touchDistance(evt.touches); }
  },

  onTouchMove: function (evt) {
    if (evt.touches.length !== 2 || !this.pinchDistance || this.isBlocked()) { return; }
    var distance = touchDistance(evt.touches);
    this.setFov(this.el.getAttribute('camera').fov * this.pinchDistance / distance);
    this.pinchDistance = distance;
  },

  onTouchEnd: function (evt) {
    if (evt.touches.length < 2) { this.pinchDistance = null; }
  }
});

function touchDistance (touches) {
  var dx = touches[0].pageX - touches[1].pageX;
  var dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * stereo-fallback: modo VR de respaldo para celulares sin WebXR (iPhone y algunos Android).
 * Dibuja la escena en pantalla dividida (ojo izquierdo / derecho) para visores tipo Cardboard;
 * la vista sigue al giroscopio mediante look-controls.
 *
 *   sceneEl.systems['stereo-fallback'].enable();
 *   sceneEl.systems['stereo-fallback'].disable();
 *
 * Emite 'stereo-enter' / 'stereo-exit' y agrega el estado 'stereo-mode' a la escena.
 */
AFRAME.registerSystem('stereo-fallback', {
  schema: {
    fov: {default: 85}
  },

  init: function () {
    this.active = false;
    this.stereo = null;
    this.size = new AFRAME.THREE.Vector2();
  },

  enable: function () {
    var sceneEl = this.el;
    if (this.active || sceneEl.is('vr-mode')) { return; }
    if (!this.stereo) { this.wrapRenderer(); }

    var cameraEl = sceneEl.camera.el;
    this.savedFov = cameraEl.getAttribute('camera').fov;
    cameraEl.setAttribute('camera', 'fov', this.data.fov);
    // Tocar la pantalla dentro del visor no debe mover la vista.
    if (cameraEl.hasAttribute('look-controls')) {
      cameraEl.setAttribute('look-controls', 'touchEnabled', false);
    }

    this.active = true;
    sceneEl.addState('stereo-mode');
    sceneEl.emit('stereo-enter');
  },

  disable: function () {
    var sceneEl = this.el;
    var renderer = sceneEl.renderer;
    if (!this.active) { return; }
    this.active = false;

    renderer.setScissorTest(false);
    renderer.getSize(this.size);
    renderer.setViewport(0, 0, this.size.x, this.size.y);

    var cameraEl = sceneEl.camera.el;
    cameraEl.setAttribute('camera', 'fov', this.savedFov);
    if (cameraEl.hasAttribute('look-controls')) {
      cameraEl.setAttribute('look-controls', 'touchEnabled', true);
    }

    sceneEl.removeState('stereo-mode');
    sceneEl.emit('stereo-exit');
  },

  // a-scene llama a renderer.render(scene, camera) en cada cuadro; lo envolvemos
  // para dibujar dos veces (una por ojo) solo mientras el modo estéreo está activo.
  wrapRenderer: function () {
    var self = this;
    var renderer = this.el.renderer;
    var render = renderer.render.bind(renderer);
    var stereo = this.stereo = new AFRAME.THREE.StereoCamera();
    stereo.aspect = 0.5;
    // La foto es mono (sin profundidad): ambos ojos ven la misma imagen.
    stereo.eyeSep = 0;

    renderer.render = function (scene, camera) {
      if (!self.active || renderer.xr.isPresenting) { return render(scene, camera); }

      var size = renderer.getSize(self.size);
      var half = size.x / 2;

      if (scene.matrixWorldAutoUpdate) { scene.updateMatrixWorld(); }
      if (camera.parent === null && camera.matrixWorldAutoUpdate) { camera.updateMatrixWorld(); }
      stereo.update(camera);

      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, half, size.y);
      renderer.setViewport(0, 0, half, size.y);
      render(scene, stereo.cameraL);

      renderer.setScissor(half, 0, half, size.y);
      renderer.setViewport(half, 0, half, size.y);
      render(scene, stereo.cameraR);

      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
    };
  }
});
