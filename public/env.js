import * as THREE from 'three';
import { canvasTex, glowTexture } from './ui.js';

// Observatoire cosmique : ciel dégradé, étoiles, nébuleuses, plateforme circulaire à cadran, poussière.
export function buildEnvironment(scene) {
  scene.background = new THREE.Color(0x03040c);
  const root = new THREE.Group(); scene.add(root);

  // dôme dégradé
  const sky = new THREE.Mesh(new THREE.SphereGeometry(45, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; void main(){ float h = vP.y;
      vec3 low = vec3(0.03,0.012,0.075), mid = vec3(0.012,0.010,0.05), top = vec3(0.003,0.005,0.02);
      vec3 col = mix(low, mid, smoothstep(-0.25,0.12,h)); col = mix(col, top, smoothstep(0.1,0.85,h));
      gl_FragColor = vec4(col,1.);
      #include <colorspace_fragment>
      }`,
  }));
  root.add(sky);

  // étoiles (deux couches)
  const starLayer = (n, size, rMin, rMax) => {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin), s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, Math.abs(u) * r * 0.9 - r * 0.05, Math.sin(a) * s * r], i * 3);
      c.setHSL(0.55 + Math.random() * 0.15, 0.4 + Math.random() * 0.5, 0.65 + Math.random() * 0.3); col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }));
  };
  const stars = new THREE.Group(); stars.add(starLayer(2200, 0.45, 30, 42), starLayer(160, 1.1, 30, 42)); root.add(stars);

  // nébuleuses
  const neb = [[0x6a4bd8, 28, [-14, 12, -26]], [0x1fa6c9, 22, [20, 9, -18]], [0xc43d9a, 20, [4, 18, 22]], [0x3a56d8, 26, [-22, 6, 14]]];
  for (const [color, size, p] of neb) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(size); s.position.set(...p); root.add(s);
  }

  // plateforme : disque + anneaux + cadran gradué
  const { g, t } = canvasTex(512, 512);
  const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  gr.addColorStop(0, 'rgba(55,65,150,.32)'); gr.addColorStop(0.55, 'rgba(25,30,80,.2)'); gr.addColorStop(1, 'rgba(10,12,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512); t.needsUpdate = true;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5, 64), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  disc.rotation.x = -Math.PI / 2; root.add(disc);
  for (const [r, op] of [[1.0, 0.35], [2.4, 0.28], [3.8, 0.5]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.008, r + 0.008, 160), new THREE.MeshBasicMaterial({ color: 0x7a95ff, transparent: true, opacity: op, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.003; root.add(ring);
  }
  const ticks = []; for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2, r1 = 3.8, r2 = r1 + (i % 10 === 0 ? 0.18 : 0.07);
    ticks.push(Math.cos(a) * r1, 0.004, Math.sin(a) * r1, Math.cos(a) * r2, 0.004, Math.sin(a) * r2); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  root.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x8aa2ff, transparent: true, opacity: 0.5 })));

  // poussière flottante
  const N = 260, dp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 4; dp.set([Math.cos(a) * r, Math.random() * 3.2, Math.sin(a) * r], i * 3); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.035, map: glowTexture(), color: 0x9fb4ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  root.add(dust);

  scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x1a1030, 0.9));

  return { update(dt) {
    stars.rotation.y += dt * 0.004;
    const p = dg.attributes.position; for (let i = 0; i < N; i++) { let y = p.getY(i) + dt * 0.03; if (y > 3.2) y = 0; p.setY(i, y); } p.needsUpdate = true;
  } };
}
