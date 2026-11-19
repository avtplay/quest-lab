import * as THREE from 'three';
import { glowTexture } from './ui.js';

// Nuit polaire : aurore boréale animée dans le ciel, crêtes de montagnes, plaine de neige, flocons et étoiles.
export function buildAurore(scene) {
  scene.background = new THREE.Color(0x02060d);
  const root = new THREE.Group(); scene.add(root);

  // ciel : dégradé nocturne + rideaux d'aurore (bruit simple animé par le temps)
  const uni = { uT: { value: 0 } };
  root.add(new THREE.Mesh(new THREE.SphereGeometry(45, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: uni,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; uniform float uT;
      float h(float n){ return fract(sin(n)*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i.x+i.y*57.),h(i.x+1.+i.y*57.),f.x), mix(h(i.x+(i.y+1.)*57.),h(i.x+1.+(i.y+1.)*57.),f.x), f.y); }
      void main(){ float y = vP.y; float az = atan(vP.z, vP.x);
        vec3 col = mix(vec3(0.02,0.05,0.09), vec3(0.003,0.008,0.025), smoothstep(-0.1,0.7,y));
        float band = smoothstep(0.08,0.3,y) * (1.-smoothstep(0.45,0.85,y));
        float w = noise(vec2(az*3.+uT*0.12, uT*0.05)) * 0.6 + noise(vec2(az*7.-uT*0.2, 3.)) * 0.4;
        float rays = pow(noise(vec2(az*28.+uT*0.3, y*2.)), 2.2);
        float a = band * (0.35 + w) * (0.55 + rays) * (0.6 + 0.4*sin(uT*0.4 + az*2.));
        vec3 aur = mix(vec3(0.1,1.0,0.55), vec3(0.55,0.25,0.95), smoothstep(0.25,0.7,y + 0.15*w));
        col += aur * a * 0.75;
        gl_FragColor = vec4(col,1.);
        #include <colorspace_fragment>
      }`,
  })));

  // étoiles
  const N = 1800, sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const u = Math.random(), a = Math.random() * 6.283, r = 38, s = Math.sqrt(1 - u * u); sp.set([Math.cos(a) * s * r, u * r * 0.95 + 1, Math.sin(a) * s * r], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  root.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.4, map: glowTexture(), color: 0xdfeaff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })));

  // crêtes de montagnes (silhouette en anneau)
  const ridge = (r, hMax, color, seed) => {
    const pts = [], seg = 160;
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2, k = Math.sin(a * 5 + seed) * 0.5 + Math.sin(a * 11 + seed * 2) * 0.3 + Math.sin(a * 23 + seed * 3) * 0.2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * r, Math.max(0.5, (k + 1) * 0.5 * hMax), Math.sin(a) * r)); }
    const idx = []; for (let i = 0; i < seg; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry().setFromPoints(pts); g.setIndex(idx);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  };
  root.add(ridge(30, 7, 0x0b1a2a, 1), ridge(22, 4.5, 0x08121f, 4));

  // sol de neige : disque doux + anneaux discrets
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshBasicMaterial({ color: 0x0a1a28 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; root.add(ground);
  for (const [r, op] of [[1.0, 0.3], [2.6, 0.22], [4.0, 0.4]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.01, r + 0.01, 160), new THREE.MeshBasicMaterial({ color: 0x7fffd4, transparent: true, opacity: op, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.003; root.add(ring);
  }

  // flocons
  const F = 400, fp = new Float32Array(F * 3);
  for (let i = 0; i < F; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 7; fp.set([Math.cos(a) * r, Math.random() * 5, Math.sin(a) * r], i * 3); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  root.add(new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.04, map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false })));

  root.add(new THREE.HemisphereLight(0x7fffd4, 0x0a1020, 0.9));

  return {
    update(dt) {
      uni.uT.value += dt;
      const p = fg.attributes.position; for (let i = 0; i < F; i++) { let y = p.getY(i) - dt * 0.25; if (y < 0) y = 5; p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(uni.uT.value + i) * dt * 0.05); } p.needsUpdate = true;
    },
    dispose() { scene.remove(root); root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); },
  };
}
