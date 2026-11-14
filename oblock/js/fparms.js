'use strict';
/* Dedicated first-person arms (viewmodel only; third person keeps the real skinned character).
   Rigid pieces in a hierarchy: no skinning, so no spikes or torn triangles are possible.
   Hand frame: origin = palm centre, +Y = wrist -> knuckles, +X = the direction the palm faces,
   thumb on -Z for the right hand and +Z for the left hand. Finger joints curl about local Z toward +X,
   clamped to 0..90 degrees (no sideways bending). Forearms are short (FP_ARM.forearm) and always point
   toward an elbow target below the screen, so the sleeve ends off-screen without any cut-off edges. */
const FP_ARM = {
  palm:{len:0.088, wid:0.08, thick:0.028},
  finger:{r:0.0085, len:[[0.042,0.025,0.02],[0.046,0.028,0.022],[0.043,0.026,0.021],[0.034,0.02,0.018]], z:[-0.03,-0.01,0.01,0.029]},
  thumb:{r:0.0105, len:[0.036,0.03]},
  wrist:{r:0.026, len:0.05},
  forearm:0.28, sleeveR:[0.042,0.055],
};
// Pose presets: curl per finger [index, middle, ring, little] x [base, middle, tip] (radians, 0..PI/2),
// thumb: rot = Euler of the thumb root relative to the palm, curl = [base, tip]
const HAND_POSES = {
  pistolR:  {curl:[[0.05,0.05,0.03],[1.35,1.5,1.0],[1.4,1.5,1.0],[1.45,1.5,1.0]], thumb:{rot:[0.3,0,-0.75], curl:[0.1,0.05]}},   // index straight along the frame
  pistolL:  {curl:[[1.05,1.25,0.9],[1.1,1.3,0.9],[1.15,1.3,0.9],[1.2,1.35,0.9]], thumb:{rot:[0.35,0.3,0.15], curl:[0.05,0]}},  // wraps the right hand, thumb forward
  rifleR:   {curl:[[0.15,0.3,0.2],[1.3,1.45,1.0],[1.35,1.45,1.0],[1.4,1.5,1.0]], thumb:{rot:[0.3,-0.5,-0.6], curl:[0.5,0.4]}},
  rifleL:   {curl:[[0.9,1.0,0.7],[1.0,1.1,0.8],[1.05,1.15,0.8],[1.1,1.2,0.8]], thumb:{rot:[0.1,0.6,-0.4], curl:[0.3,0.2]}},
  arR:      {curl:[[0.3,0.45,0.25],[1.3,1.45,1.0],[1.35,1.45,1.0],[1.4,1.5,1.0]], thumb:{rot:[0.3,-0.5,-0.6], curl:[0.5,0.4]}},   // index on the trigger
  vgripL:   {curl:[[1.2,1.35,0.9],[1.25,1.4,0.9],[1.3,1.4,0.9],[1.35,1.45,0.9]], thumb:{rot:[0.2,0.5,-0.3], curl:[0.4,0.3]}},   // fist round a vertical grip
  knife:    {curl:[[1.3,1.45,1.0],[1.35,1.5,1.0],[1.4,1.5,1.0],[1.45,1.5,1.0]], thumb:{rot:[0.35,-0.6,-0.8], curl:[0.6,0.5]}},
  vape:     {curl:[[0.75,0.9,0.5],[0.85,1.0,0.55],[1.35,1.5,1.0],[1.45,1.5,1.0]], thumb:{rot:[0.35,-0.75,-0.55], curl:[0.35,0.25]}},  // pinch: thumb pad against index/middle
  relax:    {curl:[[0.3,0.4,0.25],[0.35,0.45,0.3],[0.4,0.5,0.3],[0.45,0.55,0.35]], thumb:{rot:[0.2,-0.4,-0.3], curl:[0.2,0.1]}},
};
// Where each hand goes, per weapon (weapon space): pos = palm centre, palm = palm-facing direction, fingers = wrist->knuckle direction
const HAND_PLACE = {
  // two-hand grip like the reference: right hand around the grip with the index along the frame, left hand wrapped over the
  // right fingers; backs of both hands turned up and out, forearms coming in from the bottom corners (elbows wide while aiming)
  glock:  { R:{pos:[0.02,0.0,0.03], palm:[-0.75,-0.65,0], fingers:[-0.05,0.05,-1], pose:'pistolR', scale:0.8},
            L:{pos:[-0.028,-0.028,0.0], palm:[0.75,-0.6,-0.1], fingers:[0.35,0.0,-0.94], pose:'pistolL', scale:0.8},
            elbowAds:{R:[0.36,-0.34,0.1], L:[-0.36,-0.34,0.1]} },
  drako:  { R:{pos:[0.022,-0.02,0.035], palm:[-1,0,-0.1], fingers:[-0.1,0.45,-0.89], pose:'rifleR'},
            L:{pos:[0.0,0.0,-0.3], palm:[0.15,1,0.05], fingers:[0.95,-0.1,-0.3], pose:'rifleL', sup:true} },
  sniper: { R:{pos:[0.022,-0.02,0.035], palm:[-1,0,-0.1], fingers:[-0.1,0.45,-0.89], pose:'rifleR'},
            L:{pos:[0,0,0], palm:[0.15,1,0.05], fingers:[0.95,-0.1,-0.3], pose:'rifleL', sup:true} },
  // right hand: palm on the right side of the pistol grip, fingers wrapped round its front, index along the trigger;
  // left hand: fist around the factory vertical grip from the left-rear, fingers wrapped round its front, thumb on top
  ar15:   { R:{pos:[0.026,-0.034,0.018], palm:[-1,0,-0.05], fingers:[-0.05,0.18,-0.98], pose:'arR'},
            L:{pos:[-0.03,0.02,-0.218], palm:[0.94,0,0.35], fingers:[0.35,-0.03,-0.94], pose:'vgripL'} },
  shotgun:{ R:{pos:[0.022,-0.02,0.035], palm:[-1,0,-0.1], fingers:[-0.1,0.45,-0.89], pose:'rifleR'},
            L:{pos:[0,0,0], palm:[0.15,1,0.05], fingers:[0.95,-0.1,-0.3], pose:'rifleL', sup:true} },                    // under the pump forend
  knife:  { R:{pos:[0.022,0.0,0.0], palm:[-1,0,0], fingers:[0,-0.25,-0.97], pose:'knife'} },
};
// Elbow targets (camera space): forearms always point down/back toward these, so they leave the screen at the bottom (ADS: narrow V from the bottom corners)
const FP_ELBOW = { hipR:[0.32,-0.62,0.18], hipL:[-0.05,-0.66,0.18], adsR:[0.28,-0.5,0.12], adsL:[-0.28,-0.5,0.12], nic:[0.32,-0.65,0.1], knife:[0.34,-0.6,0.15] };

const FPArms = {
  scene:null, R:null, L:null,
  build(scene, look){
    if (this.R){ scene.remove(this.R.root); scene.remove(this.L.root); }
    const L=lookHex(look||CharLook), C=CHARACTERS[L.char]||CHARACTERS.tracksuit;
    let skinHex='#6b4128'; const ca=CharAssets[L.char]; if (ca) ca.scene.traverse(o=>{ if (o.isMesh && /^Skin/.test(o.material.name)) skinHex='#'+o.material.color.getHexString(); });
    const skin=new THREE.MeshLambertMaterial({color:skinHex}), sleeve=new THREE.MeshLambertMaterial({color:L.jacketHex});
    this.mats={skin,sleeve}; this.scene=scene;
    if (this.inst) for (const m of Object.values(this.inst)){ scene.remove(m); m.dispose(); }
    this.pieces={cyl:[], sph:[]};
    this.R=this.makeArm(1, skin, sleeve); this.L=this.makeArm(-1, skin, sleeve);
    scene.add(this.R.root); scene.add(this.L.root);
    /* Performance: the finger / thumb / wrist pieces (about 90 small meshes = 90 draw calls a frame) are drawn as two
       instanced meshes (2 draw calls). The hierarchy above stays as empty Object3Ds that are posed exactly as before;
       sync() copies their world matrices into the instances right before the viewmodel is rendered. */
    if (!FPArms.unitCyl){ FPArms.unitCyl=new THREE.CylinderGeometry(0.92,1,1,8); FPArms.unitCyl.translate(0,0.5,0); FPArms.unitSph=new THREE.SphereGeometry(1,8,6); }
    const mk=(geo,n)=>{ const m=new THREE.InstancedMesh(geo, skin, n); m.frustumCulled=false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; };
    this.inst={cyl:mk(FPArms.unitCyl, this.pieces.cyl.length), sph:mk(FPArms.unitSph, this.pieces.sph.length)};
    this.sync();
  },
  // copy the posed pieces into the instanced meshes (hidden arm = zero-size instances)
  sync(){
    if (!this.inst) return;
    this.R.root.updateMatrixWorld(true); this.L.root.updateMatrixWorld(true);
    const m=FPArms._m||(FPArms._m=new THREE.Matrix4());
    for (const k of ['cyl','sph']){ const im=this.inst[k], list=this.pieces[k];
      for (let i=0;i<list.length;i++){ const p=list[i];
        if (p.arm.root.visible) m.multiplyMatrices(p.obj.matrixWorld, p.s); else m.makeScale(0,0,0);
        im.setMatrixAt(i, m); }
      im.instanceMatrix.needsUpdate=true; }
  },
  recolor(look){ if (!this.mats) return; const L=lookHex(look||CharLook); this.mats.sleeve.color.set(L.jacketHex); },
  makeArm(side, skin, sleeve){
    const A=FP_ARM, root=new THREE.Group(), hand=new THREE.Group(); root.add(hand);
    const arm={root}, PC=this.pieces;
    // a capsule = tapered cylinder + sphere at each end; each piece is an empty marker drawn through the instanced meshes
    const piece=(kind,g,y,sx,sy,sz)=>{ const o=new THREE.Object3D(); o.position.y=y; g.add(o); PC[kind].push({obj:o, arm, s:new THREE.Matrix4().makeScale(sx,sy,sz)}); };
    const cap=(r,len,mat)=>{ const g=new THREE.Group();
      piece('cyl',g,0,r,len,r); piece('sph',g,len,r*0.93,r*0.93,r*0.93); piece('sph',g,0,r,r,r); return g; };
    // palm: rounded slab
    const shp=new THREE.Shape(), w=A.palm.wid, l=A.palm.len, rr=0.014;
    shp.moveTo(-w/2+rr,-l/2); shp.lineTo(w/2-rr,-l/2); shp.quadraticCurveTo(w/2,-l/2,w/2,-l/2+rr); shp.lineTo(w/2,l/2-rr); shp.quadraticCurveTo(w/2,l/2,w/2-rr,l/2);
    shp.lineTo(-w/2+rr,l/2); shp.quadraticCurveTo(-w/2,l/2,-w/2,l/2-rr); shp.lineTo(-w/2,-l/2+rr); shp.quadraticCurveTo(-w/2,-l/2,-w/2+rr,-l/2);
    const pg=new THREE.ExtrudeGeometry(shp,{depth:A.palm.thick-0.012,bevelEnabled:true,bevelThickness:0.006,bevelSize:0.006,bevelSegments:2,curveSegments:3});
    pg.translate(0,0,-(A.palm.thick-0.012)/2); pg.rotateY(PI/2);          // shape (Z across, Y along), thickness along X
    const palm=new THREE.Mesh(pg,skin); hand.add(palm);
    // fingers
    const fingers=[];
    for (let f=0;f<4;f++){
      const z=A.finger.z[f]*side, base=new THREE.Group(); base.position.set(0.002,l/2-0.004,z); hand.add(base);
      const joints=[]; let parent=base;
      for (let j=0;j<3;j++){ const jg=new THREE.Group(); parent.add(jg); if (j>0) jg.position.y=A.finger.len[f][j-1];
        jg.add(cap(A.finger.r*(1-j*0.08), A.finger.len[f][j], skin)); joints.push(jg); parent=jg; }
      fingers.push(joints);
    }
    // thumb: root on the palm edge near the wrist
    const troot=new THREE.Group(); troot.position.set(0.006,-l*0.12,-side*w*0.47); hand.add(troot);
    const t1=new THREE.Group(); troot.add(t1); t1.add(cap(A.thumb.r, A.thumb.len[0], skin));
    const t2=new THREE.Group(); t2.position.y=A.thumb.len[0]; t1.add(t2); t2.add(cap(A.thumb.r*0.92, A.thumb.len[1], skin));
    // wrist (skin) + forearm sleeve: positioned each frame in arm root space
    const wrist=cap(A.wrist.r, A.wrist.len, skin); root.add(wrist);
    const sg=new THREE.CylinderGeometry(A.sleeveR[0],A.sleeveR[1],A.forearm,12,1,false); sg.translate(0,A.forearm/2,0);
    const forearm=new THREE.Mesh(sg,sleeve); root.add(forearm);
    const cuff=new THREE.Mesh(new THREE.TorusGeometry(A.sleeveR[0]*0.92,0.006,6,14),sleeve); cuff.rotation.x=PI/2; forearm.add(cuff);
    root.traverse(o=>{ o.frustumCulled=false; });
    return Object.assign(arm, {side, hand, fingers, thumb:[troot,t1,t2], wrist, forearm});
  },
  pose(arm, name){
    const P=HAND_POSES[name]||HAND_POSES.relax, lim=v=>clamp(v,0,PI/2);
    for (let f=0;f<4;f++) for (let j=0;j<3;j++) arm.fingers[f][j].rotation.set(0,0,-lim(P.curl[f][j]));
    const [tr,t1,t2]=arm.thumb, s=arm.side;
    tr.rotation.set(P.thumb.rot[0], P.thumb.rot[1]*s, P.thumb.rot[2]*s);
    t1.rotation.set(0,0,-lim(P.thumb.curl[0])); t2.rotation.set(0,0,-lim(P.thumb.curl[1]));
  },
  // place a hand: pos (VM space palm centre; the arm root may be uniformly scaled), q (VM space hand orientation), elbow target (VM space)
  place(arm, pos, q, elbow){
    arm.root.visible=true; const k=arm.root.scale.x; if (k!==1){ pos=pos.clone().multiplyScalar(1/k); elbow=elbow.map(v=>v/k); }
    arm.hand.position.copy(pos); arm.hand.quaternion.copy(q);
    const wristP=new V3(0,-FP_ARM.palm.len/2+0.004,0).applyQuaternion(q).add(pos);
    const dir=new V3(...elbow).sub(wristP).normalize();
    const up=new V3(0,1,0), qd=new THREE.Quaternion().setFromUnitVectors(up,dir);
    arm.wrist.position.copy(wristP).addScaledVector(dir,-0.008); arm.wrist.quaternion.copy(qd);
    arm.forearm.position.copy(wristP).addScaledVector(dir,FP_ARM.wrist.len*0.55); arm.forearm.quaternion.copy(qd);
  },
  hide(arm){ arm.root.visible=false; },
  // weapon-space placement -> VM space
  placeOnWeapon(arm, w, spec, elbow){
    w.model.updateWorldMatrix(true,false);
    const wq=w.model.getWorldQuaternion(new THREE.Quaternion());
    const q=wq.clone().multiply(basisQ(spec.palm, spec.fingers));
    let p=new V3(...spec.pos); if (spec.sup && w.support) p=w.support.clone().add(new V3(0,-0.022,0));
    arm.root.scale.setScalar(spec.scale||1);
    this.pose(arm, spec.pose); this.place(arm, w.model.localToWorld(p), q, elbow);
  },
  // pinch anchor on the right hand (hand space): between the thumb pad and the side of the curled index/middle fingers
  pinchAnchor(arm){ return arm.hand.localToWorld(new V3(...VAPE_GRIP.anchor)); },
};
// hand-held items: anchor in hand space and the item's orientation in hand space
const VAPE_GRIP = { anchor:[0.03,0.036,-0.03], rot:[0,0,0.25] };
