import * as THREE from 'three';

// Salle blanche : fond clair uni, sol blanc quadrillé, lumière douce. Les objets de la session s'y affichent (room3d.js).
export function buildSalle(scene) {
  const prevFog = scene.fog; scene.background = new THREE.Color(0xe9edf4); scene.fog = new THREE.Fog(0xe9edf4, 8, 30);
  const root = new THREE.Group(); scene.add(root);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshBasicMaterial({ color: 0xffffff })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; root.add(floor);
  const grid = new THREE.GridHelper(24, 48, 0xb9c2d3, 0xdde2ec); grid.position.y = 0.002; root.add(grid);
  root.add(new THREE.HemisphereLight(0xffffff, 0xcfd6e4, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, 5, 3); root.add(sun);
  return { update() {}, dispose() { scene.remove(root); scene.fog = prevFog; root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); } };
}
