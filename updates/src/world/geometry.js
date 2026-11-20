import * as THREE from '../../vendor/three.module.js';
// Shared low-poly bevels preserve silhouette and catch light without subdivision modifiers.
export function bevelBox(w, h, d, amount = 0.12){
  const r = Math.min(w, h, d) * amount;
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const pos = g.attributes.position, normal = g.attributes.normal;
  const q = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for(let i=0;i<pos.count;i++){
    p.fromBufferAttribute(pos,i);
    q.set(Math.max(-w/2+r,Math.min(w/2-r,p.x)),Math.max(-h/2+r,Math.min(h/2-r,p.y)),Math.max(-d/2+r,Math.min(d/2-r,p.z)));
    n.copy(p).sub(q).normalize(); p.copy(q).addScaledVector(n,r);
    pos.setXYZ(i,p.x,p.y,p.z); normal.setXYZ(i,n.x,n.y,n.z);
  }
  return g;
}
