'use strict';
/* Collision queries against the map's oriented-box colliders. */

function overlapXZ(c,x,z,r){
  const dx=x-c.cx, dz=z-c.cz, rb=r+c.br;
  if (dx*dx+dz*dz > rb*rb) return null;
  const lx=dx*c.c-dz*c.s, lz=dx*c.s+dz*c.c;
  const qx=Math.max(-c.hx,Math.min(c.hx,lx)), qz=Math.max(-c.hz,Math.min(c.hz,lz));
  const ex=lx-qx, ez=lz-qz, d2=ex*ex+ez*ez;
  if (d2 >= r*r) return null;
  return {lx,lz,ex,ez,d2};
}

// Ray vs one collider (slab test in the box's local frame). Returns t or -1; writes normal.
const _rayN = new V3();
function rayOBB(c, ox,oy,oz, dx,dy,dz, maxD){
  const rx=ox-c.cx, rz=oz-c.cz;
  const lo=[rx*c.c-rz*c.s, oy, rx*c.s+rz*c.c];
  const ld=[dx*c.c-dz*c.s, dy, dx*c.s+dz*c.c];
  const mn=[-c.hx, c.y0, -c.hz], mx=[c.hx, c.y1, c.hz];
  let t0=0, t1=maxD, ax=-1, sg=0;
  for (let i=0;i<3;i++){
    if (Math.abs(ld[i])<1e-9){ if (lo[i]<mn[i]||lo[i]>mx[i]) return -1; continue; }
    let ta=(mn[i]-lo[i])/ld[i], tb=(mx[i]-lo[i])/ld[i], s=-1;
    if (ta>tb){ const t=ta; ta=tb; tb=t; s=1; }
    if (ta>t0){ t0=ta; ax=i; sg=s; }
    if (tb<t1) t1=tb;
    if (t0>t1) return -1;
  }
  if (ax<0) return -1; // started inside
  const n=[0,0,0]; n[ax]=sg;
  _rayN.set(n[0]*c.c+n[2]*c.s, n[1], -n[0]*c.s+n[2]*c.c);
  return t0;
}

// Nearest world hit along a ray (colliders + ground plane).
function raycastWorld(o, d, maxD){
  let best=maxD, normal=new V3(0,1,0), hit=false, bestCol=null;
  if (d.y < -1e-6){ const t=-o.y/d.y; if (t>0 && t<best){ best=t; hit=true; normal.set(0,1,0); } }
  for (let li=0; li<2; li++) for (const c of (li ? bulletCols : colliders)){
    if (c.nb) continue;                       // see-through (chain-link): only its posts/rails in bulletCols block
    // cheap reject: distance from ray to box centre
    const cy=(c.y0+c.y1)/2, hy=(c.y1-c.y0)/2;
    const px=c.cx-o.x, py=cy-o.y, pz=c.cz-o.z;
    const tp=px*d.x+py*d.y+pz*d.z;
    const rad=c.br+hy;
    if (tp < -rad || tp-rad > best) continue;
    const qx=px-d.x*tp, qy=py-d.y*tp, qz=pz-d.z*tp;
    if (qx*qx+qy*qy+qz*qz > rad*rad) continue;
    const t=rayOBB(c,o.x,o.y,o.z,d.x,d.y,d.z,best);
    if (t>=0 && t<best){ best=t; hit=true; normal.copy(_rayN); bestCol=c; }
  }
  return {hit, dist:best, normal, point:o.clone().addScaledVector(d,best), col:bestCol};
}
// a bullet: the world ray, and if it stops on a window the pane takes the damage (it may shatter)
function bulletRay(o, d, maxD, dmg){
  const r=raycastWorld(o,d,maxD);
  if (r.hit && r.col && r.col.glass){ r.glass=r.col.glass; Glass.hit(r.glass, dmg||20, r.point, d); }
  return r;
}
function raySphere(o,d,c,r,maxD){
  const px=c.x-o.x, py=c.y-o.y, pz=c.z-o.z;
  const tp=px*d.x+py*d.y+pz*d.z; if (tp<0) return -1;
  const q2=px*px+py*py+pz*pz-tp*tp; if (q2>r*r) return -1;
  const t=tp-Math.sqrt(r*r-q2); return t<=maxD ? Math.max(0,t) : -1;
}
function lineOfSight(a,b){
  const d=b.clone().sub(a), L=d.length(); d.divideScalar(L);
  return !raycastWorld(a,d,L-0.05).hit;
}
function pointFree(x,z,y0,y1,r){
  for (const c of colliders) if (c.y1>y0 && c.y0<y1 && overlapXZ(c,x,z,r)) return false;
  return true;
}
