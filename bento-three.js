import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = id => document.getElementById(id);
const canvas = $('threeCanvas'), status = $('threeStatus'), layer = $('logoLayer');
let renderer, scene, camera, pivot, paths, material, videoTexture, active = false, playing = true, angle = 0;
let previous = performance.now(), lastVideoUrl = '';
/* Export phase lock: while set, animate() stops advancing angle and uTime so a
   recorder can drive both from 0 to an exact integer number of turns. */
let phaseLock = false, playingBeforePhase = true;
function renderPhaseFrame() {
  if (!renderer || !pivot) return false;
  const vertical = $('arrangement3d').value === 'carousel' && $('carouselAxis').value === 'vertical';
  if (risoMode) { pivot.rotation.set(0, 0, 0); applyRisoStep(); }
  else pivot.rotation.set(vertical ? -angle : 0, vertical ? 0 : -angle, 0);
  liquidUniforms.uTwist.value = +$('liquidTwist').value / 100;
  const distance = camera.position.z;
  const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  pivot.position.set((parseFloat(layer.style.left) / 100 - .5) * viewHeight * camera.aspect,
    (.5 - parseFloat(layer.style.top) / 100) * viewHeight, 0);
  pivot.scale.setScalar(parseFloat($('scaleSlider').value) / 60);
  renderer.render(scene, camera);
  return true;
}
function setPhase(tNorm, loops = 1) {
  if (!renderer || !pivot) return false;
  const t = Math.min(0.999999, Math.max(0, Number(tNorm) || 0));
  const turns = Math.max(1, Math.round(Number(loops) || 1));
  if (!phaseLock) playingBeforePhase = playing;
  phaseLock = true;
  playing = false;
  angle = t * Math.PI * 2 * turns;
  liquidUniforms.uTime.value = t * Math.PI * 2 * turns;
  applyRisoStep();
  return true;
}
function releasePhase() {
  if (phaseLock) playing = playingBeforePhase;
  phaseLock = false;
  previous = performance.now();
}
let posterFps = 0;
let spinSeconds = 0;
let risoMode = false;
let risoHolders = [];
let risoJitter = [];
let risoStep = 0;
const RISO_PALETTES = {
  multi: ['#f5f2e8', '#e11d48', '#1d4ed8', '#facc15', '#10b981', '#111111'],
  tiger: ['#f5f2e8', '#c8102e', '#111111', '#a1a1aa'],
  mono: ['#f5f2e8'],
  'pw-cyan-gold': ['#5bc0de', '#e5b84b', '#9fb344', '#141414'],
  'pw-lime-pink': ['#9ee848', '#e879a8', '#f49d56', '#141414'],
  'pw-yellow-coral': ['#f2e55c', '#e88073', '#9b7ec8', '#4a5d23'],
};
function risoPalette() {
  const name = $('flipPalette')?.value || 'multi';
  return RISO_PALETTES[name] || RISO_PALETTES.multi;
}
function setPosterFps(fps) {
  posterFps = Math.max(0, Math.round(Number(fps) || 0));
  return posterFps;
}
function posterClock(seconds) {
  if (!posterFps) return seconds;
  const step = 1 / posterFps;
  return Math.floor(seconds / step) * step;
}
const phaseApi = { setPhase, releasePhase, renderPhaseFrame, setPosterFps };
const liquidUniforms = {uTime:{value:0},uTwist:{value:0},uCenter:{value:new THREE.Vector3()},uExtent:{value:1}};

function setStatus(message) { status.textContent = message; }
try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(512, 512, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  camera.position.set(0, 0, 9);
  const resizePreview = () => {
    const frame = $('fvsFrame'), width = frame.clientWidth, height = frame.clientHeight;
    if (!width || !height) return;
    const aspect = width / height, renderWidth = 512, renderHeight = Math.max(1, Math.round(512 / aspect));
    camera.aspect = aspect; camera.updateProjectionMatrix();
    renderer.setSize(renderWidth, renderHeight, false);
  };
  new ResizeObserver(resizePreview).observe($('fvsFrame'));
  resizePreview();
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  // Reflect actual colored softboxes in the environment, not only direct lights.
  for (const [color,x,y,z,w,h] of [[0x66eaff,-4,1,1,2,7],[0xff9b91,4,1,1,2,7],[0xffffff,0,5,0,8,2],[0xcaaaff,0,-3,-4,8,2]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));
    panel.position.set(x,y,z); panel.lookAt(0,0,0); room.add(panel);
  }
  scene.environment = pmrem.fromScene(room).texture;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x41415b, 1.5));
  for (const [color, intensity, x, y, z] of [[0xffffff, 25, -3, 4, 5],[0x64ddff, 15,-4,0,3],[0xff80a5, 15,4,1,3]]) {
    const light = new THREE.PointLight(color, intensity); light.position.set(x,y,z); scene.add(light);
  }
  pivot = new THREE.Group(); scene.add(pivot);
  paths = (await new SVGLoader().loadAsync('./purotigersblood-logo.svg')).paths;
  rebuild(); setStatus('3D ready · PNG export remains 2D only.');
} catch (error) {
  console.error(error); setStatus(`3D unavailable: ${error.message}. Use 2D SVG.`);
  $('spinBtn').disabled = true;
}

function makeMaterial() {
  const mode = $('material3d').value;
  let result;
  if (mode === 'video') {
    if (!videoTexture) { setStatus('Choose a local video first. Showing silver chrome.'); result = new THREE.MeshPhysicalMaterial({color:0xffffff,metalness:1,roughness:.2}); }
    else result = new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.DoubleSide });
  } else if (mode === 'flat') result = new THREE.MeshStandardMaterial({ color: $('flat3d').value, roughness:.8, side:THREE.DoubleSide });
  else result = new THREE.MeshPhysicalMaterial({color:0xffffff, metalness:1, roughness:Math.max(.04, +$('rough3d').value / 100), iridescence:mode === 'iridescent' ? +$('irid3d').value / 100 : 0, iridescenceIOR:1.3, iridescenceThicknessRange:[210,900], side:THREE.DoubleSide});
  result.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, liquidUniforms);
    shader.vertexShader = 'uniform float uTime; uniform float uTwist; uniform vec3 uCenter; uniform float uExtent;\n' + shader.vertexShader;
    const twist = 'float liquidY = (position.y - uCenter.y) / max(uExtent, 0.001);\nfloat liquidAngle = uTwist * 0.28 * sin(liquidY * 3.0 + uTime * 1.3);\nfloat lc = cos(liquidAngle), ls = sin(liquidAngle);\nmat2 liquidRotation = mat2(lc, -ls, ls, lc);\n';
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', twist + '#include <beginnormal_vertex>\nobjectNormal.xz = liquidRotation * objectNormal.xz;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz = liquidRotation * (transformed.xz - uCenter.xz) + uCenter.xz;');
  };
  result.customProgramCacheKey = () => 'tb-liquid-v1';
  return result;
}

/* Map the phase to a glyph index and apply the registration jitter. */
function applyRisoStep() {
  if (!risoMode || !risoHolders.length) return;
  const n = risoHolders.length;
  const turn = Math.PI * 2;
  const t = ((angle % turn) + turn) % turn;
  const step = Math.min(n - 1, Math.floor((t / turn) * n));
  risoStep = step;
  for (let i = 0; i < n; i++) risoHolders[i].visible = i === step;
  const j = risoJitter[step];
  const holder = risoHolders[step];
  if (j && holder) {
    /* 0 % dead-locked, 100 % loose analog zine */
    const amp = (Math.max(0, Math.min(100, Number($('flipJitter')?.value ?? 35))) / 100) * 0.09;
    holder.position.set(j.x * amp, j.y * amp, 0);
    holder.rotation.z = j.r * amp;
  }
}

function rebuild() {
  if (!paths || !pivot) return;
  for (const child of [...pivot.children]) { pivot.remove(child); child.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
  material?.dispose(); material = makeMaterial();
  const group = new THREE.Group();
  const mode = $('arrangement3d').value;
  const carousel = mode === 'carousel';
  const riso = mode === 'riso';
  risoMode = riso;
  const depth = Math.max(1, +$('depthSlider').value) * (carousel ? 1.05 : 1.8);
  const bevel = +$('bevel3d').value * (carousel ? .3 : 1);
  for (const path of paths) for (const shape of SVGLoader.createShapes(path)) {
    const geom = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled:bevel > 0, bevelThickness:bevel, bevelSize:bevel, bevelSegments:3, curveSegments:10, steps:1});
    const mesh = new THREE.Mesh(geom, material);
    mesh.onBeforeRender = () => {
      const box = mesh.geometry.boundingBox;
      if (box) { box.getCenter(liquidUniforms.uCenter.value); liquidUniforms.uExtent.value = Math.max(box.max.y-box.min.y,1); }
    };
    group.add(mesh);
  }
  // One shared planar UV space across every letter, including bevel vertices.
  const bounds = new THREE.Box3();
  for (const mesh of group.children) { mesh.geometry.computeBoundingBox(); bounds.union(mesh.geometry.boundingBox); }
  const width = bounds.max.x - bounds.min.x || 1, height = bounds.max.y - bounds.min.y || 1;
  for (const mesh of group.children) {
    const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i)-bounds.min.x)/width, 1-(pos.getY(i)-bounds.min.y)/height);
    uv.needsUpdate = true;
  }
  if (carousel || riso) {
    const radius = +$('carouselRadius').value, letterScale = +$('letterScale').value;
    const origin = bounds.getCenter(new THREE.Vector3());
    const logoSize = bounds.getSize(new THREE.Vector3());
    const minArea = logoSize.x * logoSize.y * .00025;
    const candidates = [...group.children];
    const area = mesh => { const s = mesh.geometry.boundingBox.getSize(new THREE.Vector3()); return s.x*s.y; };
    const areas = candidates.map(area).sort((a,b) => a-b);
    const median = areas[Math.floor(areas.length/2)] || 0;
    const main = candidates.filter(mesh => area(mesh) >= Math.max(minArea, median*.3));
    const details = candidates.filter(mesh => !main.includes(mesh));
    const attachments = new Map(main.map(mesh => [mesh, []]));
    for (const detail of details) {
      const box = detail.geometry.boundingBox, c = box.getCenter(new THREE.Vector3());
      let nearest, best = Infinity;
      for (const mesh of main) {
        const b = mesh.geometry.boundingBox, s = b.getSize(new THREE.Vector3());
        const dx = Math.max(b.min.x-c.x, 0, c.x-b.max.x), dy = Math.max(b.min.y-c.y, 0, c.y-b.max.y);
        const distance = Math.hypot(dx,dy);
        if (distance < best && distance < Math.max(s.x,s.y)*.65) { best=distance; nearest=mesh; }
      }
      if (nearest) attachments.get(nearest).push(detail);
      else detail.geometry.dispose();
    }
    const pieces = main;
    /* The flipbook shows one letter per step, so it keeps the letters whole
       and drops the small attached flourishes instead of merging them in. */
    if (!riso) for (const mesh of pieces) {
      const children = attachments.get(mesh);
      if (!children.length) continue;
      const geometries = [mesh, ...children].map(item => item.geometry);
      const combined = mergeGeometries(geometries, true);
      if (combined) {
        geometries.forEach(geometry => geometry.dispose());
        combined.clearGroups(); combined.computeBoundingBox(); mesh.geometry = combined;
      }
    }
    // Reading order: top arc L->R (T-I-G-E-R-S), bottom arc L->R (B-L-O-O-D), then center Texas mark.
    const topArc = [], botArc = [], centerMarks = [];
    pieces.forEach(mesh => {
      const c = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
      const dx = c.x - origin.x, dy = c.y - origin.y;
      const outer = Math.hypot(dx / logoSize.x, dy / logoSize.y) > .18;
      if (!outer) centerMarks.push(mesh);
      else if (dy < 0) topArc.push(mesh);
      else botArc.push(mesh);
    });
    const byX = (a, b) => a.geometry.boundingBox.getCenter(new THREE.Vector3()).x - b.geometry.boundingBox.getCenter(new THREE.Vector3()).x;
    topArc.sort(byX);
    botArc.sort(byX);
    const ordered = [...topArc, ...botArc, ...centerMarks];
    if (riso) {
      /* Riso Flipbook: one huge glyph per step, pivoting on the shared pivot. */
      group.clear();
      risoHolders = [];
      risoJitter = [];
      const jitter = (n => () => ((n = (n * 1664525 + 1013904223) >>> 0) / 4294967296))(20260101);
      ordered.forEach((mesh, index) => {
        const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
        mesh.geometry.translate(-center.x, -center.y, -center.z);
        mesh.geometry.computeBoundingBox();
        const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
        const factor = Math.min(4.2 / Math.max(size.y, 1), 5.4 / Math.max(size.x, 1));
        mesh.scale.set(factor, -factor, factor);
        const palette = risoPalette();
        if (palette.length > 1) {
          mesh.material = material.clone();
          mesh.material.color.set(palette[index % palette.length]);
        }
        const holder = new THREE.Group();
        holder.add(mesh);
        holder.visible = index === 0;
        risoJitter.push({
          x: jitter() * 2 - 1,
          y: jitter() * 2 - 1,
          r: jitter() * 2 - 1,
        });
        risoHolders.push(holder);
        group.add(holder);
      });
      pivot.add(group);
      applyRisoStep();
      window.__tb3d = {get shapes(){return risoHolders.length},get angle(){return angle},get active(){return active},get mode(){return 'riso'},get step(){return risoStep},...phaseApi, refreshRiso: applyRisoStep};
      return;
    }
    group.clear();
    ordered.forEach((mesh, index) => {
      const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
      const dx = center.x-origin.x, dy = center.y-origin.y;
      const outer = Math.hypot(dx / logoSize.x, dy / logoSize.y) > .18;
      mesh.geometry.translate(-center.x,-center.y,-center.z);
      // SVG y points down: upright top-arc and bottom-arc glyphs separately.
      if (outer) {
        if (dy < 0) mesh.geometry.rotateZ(-Math.atan2(dx, -dy));
        else mesh.geometry.rotateZ(Math.atan2(dx, dy));
      }
      mesh.geometry.computeBoundingBox();
      const holder = new THREE.Group(), a = index * Math.PI * 2 / ordered.length;
      const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
      const vertical = $('carouselAxis').value === 'vertical';
      const slot = 2 * radius * Math.sin(Math.PI / ordered.length) * .85;
      const factor = Math.min(letterScale / Math.max(size.y,1), letterScale * 1.5 / Math.max(size.x,1), slot / Math.max(vertical ? size.y : size.x,1));
      mesh.scale.set(factor,-factor,factor);
      if ($('carouselAxis').value === 'vertical') {
        holder.position.set(0,-Math.sin(a)*radius,Math.cos(a)*radius); holder.rotation.x = a;
      } else {
        holder.position.set(Math.sin(a)*radius,0,Math.cos(a)*radius); holder.rotation.y = a;
      }
      holder.add(mesh); group.add(holder);
    });
    pivot.add(group);
    window.__tb3d = {get shapes(){return pieces.length},get angle(){return angle},get active(){return active},get mode(){return 'carousel'},...phaseApi, refreshRiso: applyRisoStep};
    return;
  }
  group.scale.y = -1;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  group.position.sub(center);
  const scale = 4.1 / Math.max(size.x,size.y); group.scale.multiplyScalar(scale); group.position.multiplyScalar(scale);
  pivot.add(group);
  window.__tb3d = { get shapes(){return group.children.length}, get holes(){return paths.reduce((n,p)=>n+SVGLoader.createShapes(p).reduce((sum,s)=>sum+s.holes.length,0),0)}, get angle(){return angle}, get active(){return active}, ...phaseApi };
}

function refreshMaterial() {
  if (!pivot || !material) return;
  const old = material; material = makeMaterial(); pivot.traverse(o=>{if(o.isMesh)o.material=material}); old.dispose();
}

window.addEventListener('preview3d', e => {
  active = !!e.detail && !!renderer;
  canvas.style.display = active ? 'block' : 'none';
  $('fvsMark').style.display = active ? 'none' : 'block';
  $('logoCanvas').style.display = 'none';
  (active ? $('fvsFrame') : layer).appendChild($('printCanvas'));
  for (const slice of layer.querySelectorAll('.vol-slice')) slice.remove();
  previous = performance.now();
  spinSeconds = 0;
});
window.addEventListener('logo-video', () => {
  videoTexture?.dispose(); videoTexture = new THREE.VideoTexture($('srcLogoVid'));
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.needsUpdate = true;
  $('srcLogoVid').play().catch(() => setStatus('Video could not play. Choose a supported local video.'));
  $('material3d').value = 'video';
  if (!active) $('spinBtn').click();
  requestAnimationFrame(()=>{ canvas.style.display='block'; $('fvsMark').style.display='none'; $('logoCanvas').style.display='none'; refreshMaterial(); });
});
for (const id of ['material3d','flat3d','rough3d','irid3d']) $(id).addEventListener('input',refreshMaterial);
for (const id of ['depthSlider','bevel3d']) $(id).addEventListener('change',rebuild);
for (const id of ['arrangement3d','carouselRadius','letterScale','carouselAxis','flipPalette']) $(id).addEventListener('change',rebuild);
$('pause3d').addEventListener('click', e=>{playing=!playing;e.target.textContent=playing?'Pause':'Play';previous=performance.now();});
$('reset3d').addEventListener('click',()=>{angle=0; if(pivot)pivot.rotation.set(0,0,0);});
for (const button of document.querySelectorAll('[data-preview-bg]')) button.addEventListener('click',()=>{
  const value=button.dataset.previewBg;
  $('bgImg').style.display='none'; $('bgVid').style.display='none';
  if(value==='transparent') $('fvsFrame').style.background='repeating-conic-gradient(#303035 0% 25%,#1a1a1d 0% 50%) 0 / 20px 20px';
  else { $('bgColor1').value=value==='red'?'#c8102e':'#000000'; $('fvsFrame').style.background=$('bgColor1').value; }
});
function animate(now) {
  const dt=Math.min((now-previous)/1000,.1); previous=now;
  if(active && renderer && pivot) {
    if(!phaseLock) {
      if(playing) spinSeconds += dt;
      const clock = posterClock(spinSeconds);
      angle = (clock * Math.PI * 2 / Math.max(0.1, +$('speed3d').value)) % (Math.PI * 2);
      liquidUniforms.uTime.value = posterClock(now / 1000);
    }
    const vertical=$('arrangement3d').value === 'carousel' && $('carouselAxis').value === 'vertical';
    if (risoMode) { pivot.rotation.set(0, 0, 0); applyRisoStep(); }
    else pivot.rotation.set(vertical ? -angle : 0,vertical ? 0 : -angle,0);
    liquidUniforms.uTwist.value = +$('liquidTwist').value / 100;
    const frame = $('fvsFrame'), distance = camera.position.z;
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    pivot.position.set((parseFloat(layer.style.left)/100-.5)*viewHeight*camera.aspect, (.5-parseFloat(layer.style.top)/100)*viewHeight, 0);
    pivot.scale.setScalar(parseFloat($('scaleSlider').value)/60);
    renderer.render(scene,camera);
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
