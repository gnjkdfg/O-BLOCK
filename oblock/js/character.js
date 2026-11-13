'use strict';
/* Characters — the imported masked-tracksuit model (skinned, 22-bone rig) driven by:
   - its own imported Idle and Walk clips (AnimationMixer) for idling and slow walking,
   - procedural foot-IK locomotion for running/sprinting (feet planted, no sliding),
     crouch, kneel-aim, slide, ladder and vault poses,
   - two-bone arm IK + per-weapon hand orientation for holding weapons,
   - a lightweight ragdoll for deaths.
   Jacket and pants colours are customizable per player. */

const JACKET_COLORS = [['Black','#1d1e21'],['Charcoal','#3b3d42'],['Red','#a3171b'],['Navy','#1f2d52'],['Olive','#4c5534'],['Tan','#9d8763'],['White','#d6d6d0'],['Purple','#4b2f6e'],['Teal','#1e6b69'],['Pink','#c86f97']];
const PANTS_COLORS  = [['Black','#1b1b1e'],['Grey','#56595e'],['Navy','#1f2a44'],['Olive','#495234'],['Tan','#8f7a58'],['Denim','#3e5578'],['White','#d2d2cc'],['Red','#8a1a1a']];
// playable characters (each is an imported, rigged GLB; same 22-bone layout + finger bones)
const CHARACTERS = {
  tracksuit:{name:'MASKED TRACKSUIT', glb:'char', top:'Hoodie', bottom:'Pants', topMat:/^Fleece/, botMat:/^Fleece/, fpHide:/^(Head|Pants|Shoes|Chain)/,
    desc:'Balaclava, tech-fleece hoodie, chain, joggers, sneakers', defaults:{jacket:'Black',pants:'Black'}},
  jeff:{name:'BLOOD HOUND LIL JEFF', glb:'jeff', top:'Jacket', bottom:'Jeans', topMat:/^(Jacket_Red|Rib_Red)/, botMat:/^Denim/, fpHide:/^(Head|Hair|Jeans|Shoes|Chain|SkiMask|Shirt)/,
    desc:'Red bomber jacket, white tee, chain, dreads, black denim · ski mask during Triple Health', defaults:{jacket:'Red',pants:'Black'}, ability:'triple', price:1000},
  cop:{name:'COP', glb:'cop', top:'Uniform', bottom:'Slacks', topMat:/^Uniform_Shirt/, botMat:/^Slacks/, fpHide:/^(Head|Hair|Cap|Glasses|Slacks|Shoes|Belt)/,
    desc:'Navy uniform shirt with badge and tie, duty belt, slacks, cap and glasses', defaults:{jacket:'Navy',pants:'Black'}, ability:'double', price:5000},
};
const CHAR_ORDER=['tracksuit','jeff','cop'];
const CharLook = Object.assign({char:'tracksuit', jacket:'Black', pants:'Black'}, Store.get('look', {}));
if (!CHARACTERS[CharLook.char]) CharLook.char='tracksuit';
function saveLook(){ Store.set('look', CharLook); }
const BOT_LOOK = {jacketHex:'#cf5f17', pantsHex:'#4c4c4c'};
function lookHex(l){ if (l.jacketHex) return Object.assign({char:'tracksuit'}, l);
  return {char:l.char||'tracksuit', jacketHex:(JACKET_COLORS.find(c=>c[0]===l.jacket)||JACKET_COLORS[0])[1], pantsHex:(PANTS_COLORS.find(c=>c[0]===l.pants)||PANTS_COLORS[0])[1]}; }

/* --------------------------------------------------------------- asset */
const CharAssets = {};
function loadCharacterAsset(){ return Promise.all(CHAR_ORDER.map(loadOneCharacter)); }
function loadOneCharacter(id){
  const CharAsset = CharAssets[id] = {scene:null, clips:[]};
  return new Promise((res,rej)=>{
    const b64=(window.GLB||{})[CHARACTERS[id].glb]; if (!b64) return rej('character model missing: '+id);
    const bin=atob(b64), buf=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(buf.buffer,'',g=>{
      // glTF colours are linear; this renderer outputs linear, so lift them to display values
      const drop=[]; g.scene.traverse(o=>{ if (o.isMesh && /^Icosphere/.test(o.name)) drop.push(o); });
      for (const o of drop) o.parent.remove(o);
      g.scene.traverse(o=>{ if (o.isMesh){
        const m=o.material, col=m.color.clone().convertLinearToSRGB();
        o.material=new THREE.MeshLambertMaterial({color:col, skinning:true, name:m.name});
        o.castShadow=true; } });
      CharAsset.scene=g.scene; CharAsset.clips=g.animations; res();
    }, rej);
  });
}

/* --------------------------------------------------------------- build */
const B_ = n => n; // bone names are already sanitized by GLTFLoader (hand.L -> handL)
function buildCharacter(look, opts={}){
  const L=lookHex(look), C=CHARACTERS[L.char]||CHARACTERS.tracksuit, CharAsset=CharAssets[L.char]||CharAssets.tracksuit;
  const model=THREE.SkeletonUtils.clone(CharAsset.scene);
  model.rotation.y=PI;                          // model faces +Z; game forward is -Z
  const root=new THREE.Group(), pose=new THREE.Object3D(); root.add(pose); pose.add(model);   // pose: whole-body tilt (prone)
  const bones={}, meshes=[];
  model.traverse(o=>{
    if (o.isBone) bones[o.name]=o;
    if (o.isMesh){
      o.material=o.material.clone(); meshes.push(o);
      if (o.name.startsWith('SkiMask')) o.visible=false;     // Blood Hound Mode accessory
    }
  });
  const rest={}; for (const k in bones) rest[k]=bones[k].quaternion.clone();
  model.updateMatrixWorld(true);
  const mq=new THREE.Quaternion(); model.getWorldQuaternion(mq); mq.invert();
  const footRest={}; for (const s of ['L','R']){ const q=new THREE.Quaternion(); bones['foot'+s].getWorldQuaternion(q); footRest[s]=mq.clone().multiply(q); }
  const mixer=new THREE.AnimationMixer(model);
  const clip=n=>CharAsset.clips.find(c=>c.name===n);
  const idle=mixer.clipAction(clip('Idle')), walk=mixer.clipAction(clip('Walk'));
  idle.play(); walk.play(); idle.setEffectiveWeight(1); walk.setEffectiveWeight(0);
  const arm=s=>({ua:bones['upper_arm'+s], fa:bones['forearm'+s], ha:bones['hand'+s], a:0.271, b:0.254, side:s==='R'?1:-1});
  const leg=s=>({th:bones['thigh'+s], sh:bones['shin'+s], ft:bones['foot'+s], a:0.411, b:0.421, side:s==='R'?1:-1, key:s});
  const holdPivot=new THREE.Object3D(); root.add(holdPivot);
  const weaponSlot=new THREE.Group(); holdPivot.add(weaponSlot);
  const prev={}; for (const k in bones) prev[k]=bones[k].quaternion.clone();
  const rigObj={look:L, charId:L.char, C, root, pose, proneK:0, model, bones, meshes, rest, footRest, mixer, idle, walk, armR:arm('R'), armL:arm('L'), legR:leg('R'), legL:leg('L'),
    holdPivot, weaponSlot, prev, phase:0, modelY:0, walkW:0, rag:null, weapon:null, firstFrame:true};
  setLookColors(rigObj, L);
  return rigObj;
}
function setSkiMask(rig, on){
  // the knit mask covers the head; the dreads are tucked under it while it is on
  for (const o of rig.meshes){ if (o.name.startsWith('SkiMask')) o.visible=on && !rig.fpOnly; if (o.name.startsWith('Hair')) o.visible=!on && !rig.fpOnly; }
}
function setLookColors(rig, look){
  const L=lookHex(look); L.char=rig.charId; rig.look=L; const C=rig.C;
  for (const o of rig.meshes){ const n=o.name, mn=o.material.name;
    if (n.startsWith(C.top) && C.topMat.test(mn)) o.material.color.set(L.jacketHex).multiplyScalar(/Panel|Rib/.test(mn)?1.25:1);
    if (n.startsWith(C.bottom) && C.botMat.test(mn)) o.material.color.set(L.pantsHex).multiplyScalar(/Panel/.test(mn)?1.25:1); }
}
// first-person body: only the arms/hands/jacket are rendered
function setFirstPersonOnly(rig){
  rig.fpOnly=true; for (const o of rig.meshes){ o.frustumCulled=false; if (rig.C.fpHide.test(o.name)) o.visible=false; }
}

/* --------------------------------------------------------------- IK */
const _S=new V3(), _D=new V3(), _P=new V3(), _U=new V3(), _E=new V3(), _F=new V3(), _T=new V3(), _Y=new V3(0,1,0);
const _qa=new THREE.Quaternion(), _qb=new THREE.Quaternion(), _qc=new THREE.Quaternion(), _m4=new THREE.Matrix4();
// Rotate a bone (limb axis = local +Y) so it points along `dir` in world space, using the
// minimal rotation from its rest orientation (keeps the model's natural twist; no candy-wrapping).
function aimBone(bone, restQ, dir){
  bone.parent.getWorldQuaternion(_qb);
  _qa.copy(_qb).multiply(restQ);                          // rest orientation in world
  _U.copy(_Y).applyQuaternion(_qa);                       // rest limb direction
  _qc.setFromUnitVectors(_U, dir).multiply(_qa);          // desired world orientation
  bone.quaternion.copy(_qb.invert().multiply(_qc));
  bone.updateMatrixWorld(true);
}
function solveLimb(rig, upper, lower, a, b, target, pole){
  upper.parent.updateMatrixWorld(true);
  _S.setFromMatrixPosition(upper.matrixWorld);
  _D.copy(target).sub(_S); let d=_D.length(); d=clamp(d, Math.abs(a-b)+0.02, (a+b)*0.997); _D.normalize();
  const cosA=clamp((a*a+d*d-b*b)/(2*a*d),-1,1), sinA=Math.sqrt(1-cosA*cosA);
  _P.copy(pole).sub(_S); _P.addScaledVector(_D,-_P.dot(_D)); if (_P.lengthSq()<1e-8) _P.set(0,-1,0); _P.normalize();
  const u=_D.clone().multiplyScalar(cosA).addScaledVector(_P,sinA);
  _E.copy(_S).addScaledVector(u,a); _T.copy(_S).addScaledVector(_D,d);
  const f=_T.clone().sub(_E).normalize();
  aimBone(upper, rig.rest[upper.name], u);
  aimBone(lower, rig.rest[lower.name], f);
}
const solveArmIK = (rig, arm, target, pole) => solveLimb(rig, arm.ua, arm.fa, arm.a, arm.b, target, pole);
const solveLegIK = (rig, leg, target, pole) => solveLimb(rig, leg.th, leg.sh, leg.a, leg.b, target, pole);

// Hand orientations relative to the weapon frame (x right, y up, -z forward).
// Hand bone: +Y = fingers, palm faces local +X on the right hand / -X on the left.
function basisQ(x,y){ const X=new V3(...x).normalize(), Y=new V3(...y); Y.addScaledVector(X,-Y.dot(X)).normalize(); const Z=new V3().crossVectors(X,Y); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X,Y,Z)); }
// ---- first-person hand tuning (pistol two-hand grip); offsets are in weapon space, metres
const HAND_TUNE = {
  pistolR: { offset:[0.0,-0.006,0.01], palm:[-1,0.05,0.25], fingers:[-0.22,-0.08,-0.97], curl:[0.02,1.45,1.5,1.5,0.6] },   // index straight along the frame above the trigger guard
  pistolL: { offset:[-0.04,-0.02,-0.012], palm:[1,0.2,-0.1], fingers:[0.7,-0.5,-0.5], curl:[1.05,1.1,1.15,1.15,0.0] },     // fingers over the right hand's fingers, thumb straight forward along the frame
};
// Tap the Nic hand path in first person (camera space, m) and the tilt of the mouthpiece toward the face (rad)
// Nic grip: the device is pinched between the thumb pad and the side of the curled index/middle fingers
const NIC_GRIP = { palm3:[-1,0.1,0.12], fingers3:[-0.12,0.22,-1], local:[0.03,0.075,0.0], up:0.045 };   // palm faces left (toward the mouth), fingers forward, thumb on top
// first-person hand path (camera space, m): raise from below the bottom-right corner to just under the mouth
const NIC_TUNE = { low:[0.22,-0.42,-0.34], mid:[0.13,-0.26,-0.3], mouth:[0.05,-0.175,-0.24], tilt:0.7, yaw:0.3, palm:[-0.75,0.1,0.65], fingers:[-0.1,0.9,-0.4] };   // first-person path (camera space) + hand facing: palm toward the mouth, fingers up
const HAND_Q = {
  gripR:    basisQ([-1,0,0.3],[-0.3,-0.25,-0.92]),   // knuckles forward along the grip, fingers wrap round the front
  pistolR:  basisQ(HAND_TUNE.pistolR.palm, HAND_TUNE.pistolR.fingers),   // palm on the back-right of the grip, index straight along the frame
  pistolL:  basisQ(HAND_TUNE.pistolL.palm, HAND_TUNE.pistolL.fingers),   // support hand cups from the left, fingers over the right hand's fingers
  supportL: basisQ([0,-1,0],[0.6,0,-0.8]),          // palm up under the handguard, fingers wrap up the far side
  wrapL:    basisQ([-1,0,0.2],[0.25,-0.35,-0.9]),   // cups the firing hand on pistols
  knifeR:   basisQ([-1,0,0],[0,-0.3,-0.95]),        // hammer grip on the handle
  nicR:     basisQ(NIC_GRIP.palm3, NIC_GRIP.fingers3),    // palm facing in/left toward the mouth, fingers curled round the device
  smokeR:   basisQ([-0.35,-0.15,0.92],[-0.4,0.88,-0.2]),  // palm toward the face, fingers up: blunt between index and middle
};
// Finger curl per grip: [index, middle, ring, little, thumb] (radians per joint)
const CURL = { pistolR:HAND_TUNE.pistolR.curl, pistolL:HAND_TUNE.pistolL.curl, gripR:[0.35,1.25,1.3,1.3,0.45], supportL:[1.0,1.05,1.1,1.1,0.4], wrapL:[1.05,1.1,1.15,1.15,0.5], knifeR:[1.3,1.35,1.35,1.35,0.6], nicR:[0.95,1.1,1.35,1.45,0.3], smokeR:[0.12,0.22,1.25,1.3,0.55], relax:[0.25,0.3,0.35,0.4,0.15] };
const _zAxis=new V3(0,0,1), _cq=new THREE.Quaternion();
// curl fingers toward the palm: rotate each joint about its local Z (left +, right -)
function curlFingers(rig, side, key){
  const c=CURL[key], s=side>0?'R':'L', sign=side>0?-1:1;
  for (let f=0;f<4;f++) for (let j=0;j<3;j++){ const b=rig.bones['f'+f+'_'+j+s]; if (!b) return;
    b.quaternion.copy(rig.rest[b.name]).multiply(_cq.setFromAxisAngle(_zAxis, sign*c[f]*(j===0?0.8:1))); }
  for (let j=0;j<3;j++){ const b=rig.bones['th_'+j+s]; if (b) b.quaternion.copy(rig.rest[b.name]).multiply(_cq.setFromAxisAngle(_zAxis, sign*c[4])); }
}
const _hq=new THREE.Quaternion(), _hp=new V3(), _hx=new V3(), _hy=new V3();
// Put the palm on `pos` with the given weapon-relative orientation.
function gripHand(rig, arm, pos, weaponQ, handKey, pole){
  _hq.copy(weaponQ).multiply(HAND_Q[handKey]);
  _hy.set(0,1,0).applyQuaternion(_hq); _hx.set(1,0,0).applyQuaternion(_hq);
  const palmN = arm.side>0 ? _hx : _hx.clone().negate();
  _hp.copy(pos).addScaledVector(_hy,-0.075).addScaledVector(palmN,-0.028);   // wrist position
  solveArmIK(rig, arm, _hp, pole);
  arm.fa.getWorldQuaternion(_qb); arm.ha.quaternion.copy(_qb.invert().multiply(_hq)); arm.ha.updateMatrixWorld(true);
  curlFingers(rig, arm.side, handKey);
}
// smoking: right hand posed by a target point + facing frame, blunt pinched between index and middle finger
const _bq=new THREE.Quaternion(), _bp=new V3(), _bp2=new V3(), _bx=new V3(), _bm=new THREE.Matrix4();
function smokeHand(rig, gripPos, frameQ, pole){ gripHand(rig, rig.armR, gripPos, frameQ, 'smokeR', pole); }
function placeBlunt(rig, blunt){
  const a=rig.bones.f0_1R, b=rig.bones.f1_1R, h=rig.armR.ha; if (!a||!b||!blunt.parent) return;
  a.getWorldPosition(_bp); b.getWorldPosition(_bp2); _bp.add(_bp2).multiplyScalar(0.5);
  h.getWorldQuaternion(_bq); _bx.set(1,0,0).applyQuaternion(_bq);              // palm normal (right hand: +X)
  const dir=_bx.clone().negate().addScaledVector(new V3(0,1,0).applyQuaternion(_bq),0.25).normalize();   // lit end out of the back of the hand
  const q=new THREE.Quaternion().setFromUnitVectors(new V3(0,1,0), dir);
  _bp.addScaledVector(dir, 0.012);
  // world -> parent space
  blunt.parent.updateWorldMatrix(true,false); _bm.copy(blunt.parent.matrixWorld).invert();
  blunt.position.copy(_bp).applyMatrix4(_bm);
  const pq=new THREE.Quaternion(); blunt.parent.getWorldQuaternion(pq); blunt.quaternion.copy(pq.invert().multiply(q));
}
function placeNic(rig, nic, frameQ, tilt){
  // grip anchor in the hand bone's frame (Y = along the fingers, X = out of the palm): the device sits inside the curled
  // fingers like a held cup, the thumb wraps over its top-front, mouthpiece up
  const h=rig.armR.ha; if (!nic.parent) return;
  h.updateWorldMatrix(true,false); _bp.set(...NIC_GRIP.local).applyMatrix4(h.matrixWorld);
  _bp.add(new V3(0,NIC_GRIP.up,0).applyQuaternion(frameQ||new THREE.Quaternion()));   // the top third (mouthpiece) rises out of the fist
  nic.parent.updateWorldMatrix(true,false); _bm.copy(nic.parent.matrixWorld).invert();
  nic.position.copy(_bp).applyMatrix4(_bm);
  const q=(frameQ||new THREE.Quaternion()).clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt||0,0,0)));
  const pq=new THREE.Quaternion(); nic.parent.getWorldQuaternion(pq); nic.quaternion.copy(pq.invert().multiply(q));
}
// Nic hit: 0..1 curve over NIC_ANIM (raise, hit, lower)
function nicCurve(t){ const u=t/NIC_ANIM; return u<0.3 ? u/0.3 : u<0.7 ? 1 : Math.max(0,1-(u-0.7)/0.3); }
// 0..1 hand-to-mouth curve over the 3 s smoke: raise, inhale, lower
function smokeCurve(t){ return t<0.45 ? 0 : t<1.25 ? (t-0.45)/0.8 : t<2.0 ? 1 : t<2.7 ? 1-(t-2.0)/0.7 : 0; }
function smokeIn(t){ return Math.min(1, t*3, Math.max(0,(3-t)*3)); }
function relaxHand(rig, arm){ arm.ha.quaternion.copy(rig.rest[arm.ha.name]); curlFingers(rig, arm.side, 'relax'); }

/* --------------------------------------------------------------- locomotion helpers */
// One foot cycle: stance (planted, slides back relative to the body) then swing (lifts forward).
/* Running gait (one foot). u: foot phase 0..1, 0 = touchdown. d: duty factor (fraction of the cycle on the ground).
   Stance: foot planted, moves from `front` to `back` under the body, heel rises before toe-off.
   Swing: heel kicks up behind, knee drives forward/up, foot reaches out and comes down to `front`. Returns [forward, height]. */
function smooth01(x){ x=clamp(x,0,1); return x*x*(3-2*x); }
function gaitFoot(u, G){
  u=((u%1)+1)%1;
  if (u<G.d){ const k=u/G.d, r=clamp((k-0.6)/0.4,0,1);
    return [lerp(G.front,G.back,k), r*r*(3-2*r)*G.heelRise, true, k]; }
  const v=(u-G.d)/(1-G.d);
  const K=[[0,G.back,G.heelRise],[0.22,G.back*0.72,G.heelKick],[0.55,0.05,G.kneeY],[0.82,G.front+0.1,G.reachY],[1,G.front,0]];
  let i=0; while (i<K.length-2 && v>K[i+1][0]) i++;
  const a=K[Math.max(0,i-1)], p1=K[i], p2=K[i+1], c=K[Math.min(K.length-1,i+2)], t=(v-p1[0])/(p2[0]-p1[0]);
  const cr=(q0,q1,q2,q3)=>0.5*((2*q1)+(-q0+q2)*t+(2*q0-5*q1+4*q2-q3)*t*t+(-q0+3*q1-3*q2+q3)*t*t*t);
  return [cr(a[1],p1[1],p2[1],c[1]), Math.max(0,cr(a[2],p1[2],p2[2],c[2])), false, v];
}
// gait parameters from speed (cadence and stride derived from real running: ~165 steps/min jogging, ~200 sprinting)
function gaitParams(sp, sprint, crouch){
  if (crouch){ const c=clamp(1.9+sp*0.45,2.2,3.2), d=0.58, L=Math.min(0.62, d*2*sp/c);
    return {c, d:L*c/(2*Math.max(sp,0.1)), front:L*0.45, back:-L*0.55, heelRise:0.04, heelKick:0.13, kneeY:0.12, reachY:0.07, hipY:-0.44, bounce:0.015, lean:0.62}; }
  // sprint is a 0..1 blend (not a switch), so run -> sprint -> run changes stride, knee drive and lean smoothly
  const s=typeof sprint==='number'?clamp(sprint,0,1):(sprint?1:0), M=(a,b)=>a+(b-a)*s;
  const c=clamp(1.75+sp*0.22,1.9,3.4), dT=M(0.32,0.27), Lmax=M(1.0,1.1);
  const L=Math.min(Lmax, dT*2*sp/c), d=L*c/(2*Math.max(sp,0.1));
  return {c, d, front:L*0.38, back:-L*0.62, heelRise:M(0.15,0.2), heelKick:M(0.42,0.55), kneeY:M(0.3,0.42), reachY:M(0.18,0.24),
    hipY:M(-0.065,-0.085), bounce:M(0.065,0.08), lean:M(0.17,0.34)};
}
function footCycle(t, stride, lift, dirx, dirz){
  t=((t%1)+1)%1; let s, y=0;
  if (t<0.5){ s=lerp(0.5,-0.5,t/0.5); }
  else { const k=(t-0.5)/0.5, e=k*k*(3-2*k); s=lerp(-0.5,0.5,e); y=Math.sin(k*PI)*lift; }
  return [dirx*s*stride, y, dirz*s*stride];
}
const _rl=new V3();
function rootPt(rig,x,y,z){ return rig.root.localToWorld(_rl.set(x,y,z)).clone(); }
const _ql=new THREE.Quaternion(), _el=new THREE.Euler();
function localRot(bone, x, y, z){ _el.set(x,y,z); _ql.setFromEuler(_el); bone.quaternion.multiply(_ql); }
function plantFoot(rig, leg, pitch){
  rig.model.getWorldQuaternion(_qa); _qa.multiply(rig.footRest[leg.key]);
  if (pitch){ _el.set(pitch,0,0); _qc.setFromEuler(_el); rig.model.getWorldQuaternion(_qb); const w=_qb.clone().multiply(_qc).multiply(rig.footRest[leg.key]); _qa.copy(w); }
  leg.sh.getWorldQuaternion(_qb); leg.ft.quaternion.copy(_qb.invert().multiply(_qa));
}

/* --------------------------------------------------------------- animation
  st: {speed, moveX, moveZ (root-local velocity), sprint, crouch, slide, air, ladder, climb, vault, pitch,
       ads, hold:{weapon, kick, reloadK, swing, firing, lowReady}, lean} */
function animateCharacter(rig, st, dt){
  if (rig.rag){ Ragdoll.step(rig, dt); return; }
  const b=rig.bones, sp=st.speed||0;
  // ---- choose locomotion mode
  let mode='idle';
  { const tp=st.prone?1:0; rig.proneK += clamp(tp-rig.proneK, -dt*1.6, dt*1.6); }   // ~0.6 s down (kneel, then tip forward), same back up
  if (rig.proneK>0.05) mode='prone';           // also while getting up, so the stand-up plays the kneel in reverse
  else if (st.ladder) mode='ladder'; else if (st.vault) mode='vault'; else if (st.slide) mode='slide'; else if (st.sit) mode='sit';
  else if (st.air) mode='air'; else if (st.crouch) mode = sp>0.4 ? 'crouchwalk' : (st.hold && st.hold.weapon && st.hold.weapon.id!=='knife' && st.hold.weapon.id!=='glock' ? 'kneel' : 'crouch');
  else if (sp>0.3) mode = sp>3.1 ? 'run' : 'walk';
  // ---- walk <-> run: one locomotion state. runK blends the imported Walk clip into the procedural run (feet stay
  // in phase: the clip's footfalls are locked to the run cycle), sprintK blends run into sprint.
  const loco = mode==='walk'||mode==='run'||mode==='idle';
  rig.runK = damp(rig.runK||0, loco && mode!=='idle' ? clamp((sp-2.5)/1.1,0,1) : 0, 6, dt); if (!loco) rig.runK=0;
  rig.sprintK = damp(rig.sprintK||0, st.sprint?1:0, 4, dt);
  const runK = rig.runK;
  // ---- base pose: imported clips for idle/walk, otherwise rest
  const wantWalk = mode==='walk'||mode==='run' ? 1 : 0;
  rig.walkW = damp(rig.walkW, wantWalk, 8, dt);
  for (const k in b) b[k].quaternion.copy(rig.rest[k]);
  // prone transition: kneel down first (knees bend, hips drop), then the body tips forward onto the ground
  const tilt = smooth01((rig.proneK-0.3)/0.7), kneelK = st.prone||rig.proneK>0.02 ? Math.sin(Math.min(1,rig.proneK/0.55)*PI/2)*(1-tilt) : 0;
  rig.pose.rotation.x = -PI/2*tilt; rig.pose.position.set(0, 0.13*tilt, 1.1*tilt);
  if (mode==='prone'){
    // lying flat: legs slightly apart, toes down, crawl cycle when moving
    rig.phase += dt*(sp>0.2?3:0); const c=Math.sin(rig.phase*PI*2)*Math.min(1,sp)*tilt;
    localRot(b.thighR, 0.05+c*0.25, 0, 0.12); localRot(b.thighL, 0.05-c*0.25, 0, -0.12);
    localRot(b.shinR, Math.max(0,c)*0.6, 0, 0); localRot(b.shinL, Math.max(0,-c)*0.6, 0, 0);
    localRot(b.footR, 0.9*tilt, 0, 0); localRot(b.footL, 0.9*tilt, 0, 0);
  }
  if (mode==='idle' || mode==='walk' || mode==='run'){
    rig.idle.setEffectiveWeight(1-rig.walkW); rig.walk.setEffectiveWeight(Math.max(0.0001,rig.walkW));
    const wd=rig.walk.getClip().duration;
    if (runK>0.001){
      // running: the clip is evaluated at the run cycle's phase (Walk clip: L down at 0.25, R down at 0.75; run: R down at phase 0)
      rig.walk.time=(((rig.phase+0.75)%1)+1)%1*wd; rig.mixer.update(0);
    } else {
      // imported Walk clip: 2 steps per 0.8 s at timeScale 1 -> scale to a natural walking cadence for this speed
      const cad=clamp(1.3+sp*0.3,1.5,2.3); rig.walk.timeScale = cad/2.5;
      const w0=(rig.walk.time%wd)/wd;
      rig.mixer.update(dt);
      const w1=(rig.walk.time%wd)/wd;
      if (mode!=='idle') rig.phase = w1-0.75;                     // keep the run cycle in step with the clip
      if (rig.onStep && mode!=='idle') for (const e of [0.25,0.75]) if ((w0<e && w1>=e) || (w1<w0 && (e>w0 || e<=w1))) rig.onStep(e<0.5?'L':'R','walk');
    }
  }
  const LEGB=[b.thighR,b.shinR,b.footR,b.thighL,b.shinL,b.footL], walkLeg = runK>0.001&&runK<0.999 ? LEGB.map(x=>x.quaternion.clone()) : null;
  // ---- procedural lower body
  const doRun = mode==='crouchwalk' || ((mode==='run'||mode==='walk') && runK>0.001);
  let targetY=0, lean=0, twist=0; if (!doRun){ rig.bounce=damp(rig.bounce||0,0,10,dt); rig.sway=damp(rig.sway||0,0,10,dt); }
  rig.model.position.y = rig.modelY + (rig.bounce||0);
  rig.root.updateMatrixWorld(true);
  const mvx=st.moveX||0, mvz=st.moveZ||-1, ml=Math.hypot(mvx,mvz)||1, dx=mvx/ml, dz=mvz/ml;
  const kneePole=(side)=>rootPt(rig, side*0.15, 0.6, -1.2);
  if (doRun){
    const cw=mode==='crouchwalk', rk=cw?1:runK;
    const G=gaitParams(Math.max(sp,cw?0.5:2.4), rig.sprintK, cw);
    const prevPh=rig.phase; if (cw||runK>0.001 && !(rig.walkW>0 && runK<0.001)) rig.phase += dt*G.c/2;   // one cycle = two steps
    const ph=rig.phase, uR=((ph%1)+1)%1, uL=(((ph+0.5)%1)+1)%1;
    // footfall events (touchdown of each foot) drive the footstep audio (the clip's events cover the walking end)
    if (rk>=0.5 && rig.onStep && Math.floor(prevPh)!==Math.floor(ph)) rig.onStep('R', cw?mode:'run');
    if (rk>=0.5 && rig.onStep && Math.floor(prevPh+0.5)!==Math.floor(ph+0.5)) rig.onStep('L', cw?mode:'run');
    // vertical bounce: lowest at mid-stance, highest in the flight phase
    const comp=u=>u<G.d ? Math.sin(PI*u/G.d) : 0;
    const cmp=Math.max(comp(uR),comp(uL));
    targetY=G.hipY*rk; rig.bounce = (0.5-cmp)*G.bounce*rk;
    // forward lean grows with speed and sprint; hips rotate with the stride and the shoulders counter-rotate
    lean=G.lean*rk; twist=Math.sin(ph*PI*2)*(cw?0.08:0.12+0.06*rig.sprintK)*rk; rig.sway=Math.sin(ph*PI*2)*0.035*rk;
    rig.model.position.y = rig.modelY + rig.bounce; rig.root.updateMatrixWorld(true);
    for (const [leg,u] of [[rig.legR,uR],[rig.legL,uL]]){
      const [fw,fy,stance,k]=gaitFoot(u,G);
      const t=rootPt(rig, leg.side*(cw?0.15:0.1)+dx*fw, 0.1+fy, dz*fw);
      solveLegIK(rig, leg, t, rootPt(rig, leg.side*0.12, 0.75, -1.4));
      plantFoot(rig, leg, stance ? -k*k*0.9*(G.heelRise/0.2) : (fy>0.05 ? -0.35 : 0));
    }
    // walk <-> run cross-fade of the legs (both poses share the same footfall phase, so the blend never crosses the legs)
    if (walkLeg && !cw) LEGB.forEach((x,i)=>{ x.quaternion.copy(walkLeg[i].slerp(x.quaternion, runK)); });
  } else if (mode==='crouch'){
    targetY=-0.36; lean=0.42;
    for (const leg of [rig.legR,rig.legL]){
      const t=rootPt(rig, leg.side*0.15, 0.1, leg.side*0.06-0.05);
      solveLegIK(rig, leg, t, kneePole(leg.side)); plantFoot(rig, leg, 0);
    }
  } else if (mode==='kneel'){
    // one knee down, other foot planted forward (aiming rifles while crouched)
    targetY=-0.43; lean=0.12;
    solveLegIK(rig, rig.legL, rootPt(rig,-0.13,0.1,-0.34), rootPt(rig,-0.2,0.8,-1.2)); plantFoot(rig, rig.legL, 0);
    solveLegIK(rig, rig.legR, rootPt(rig, 0.15,0.12,0.42), rootPt(rig,0.2,-0.6,-0.3)); plantFoot(rig, rig.legR, 0.9);
  } else if (mode==='slide'){
    // leaning back, lead leg extended, trailing leg folded underneath
    targetY=-0.55; lean=-0.62;
    solveLegIK(rig, rig.legR, rootPt(rig,0.12,0.12,-0.78), rootPt(rig,0.2,1.2,-0.6)); plantFoot(rig, rig.legR, -0.6);
    solveLegIK(rig, rig.legL, rootPt(rig,-0.16,0.1,0.02), rootPt(rig,-0.6,0.5,-0.6)); plantFoot(rig, rig.legL, 0.3);
  } else if (mode==='sit'){
    // seated on the e-bike: hips down on the seat, knees forward, feet on the footboard
    targetY=-0.4; lean=0.16;
    solveLegIK(rig, rig.legR, rootPt(rig,0.17,0.22,-0.4), rootPt(rig,0.3,0.9,-1.4)); plantFoot(rig, rig.legR, 0);
    solveLegIK(rig, rig.legL, rootPt(rig,-0.17,0.22,-0.4), rootPt(rig,-0.3,0.9,-1.4)); plantFoot(rig, rig.legL, 0);
  } else if (mode==='air'){
    targetY=0.0; lean=0.1;
    solveLegIK(rig, rig.legR, rootPt(rig,0.11,0.42,-0.12), kneePole(1)); plantFoot(rig,rig.legR,-0.3);
    solveLegIK(rig, rig.legL, rootPt(rig,-0.11,0.26,0.1), kneePole(-1)); plantFoot(rig,rig.legL,-0.2);
  } else if (mode==='ladder'){
    const c=st.climb||0;
    solveLegIK(rig, rig.legR, rootPt(rig,0.12,0.25+Math.sin(c)*0.18,-0.28), kneePole(1)); plantFoot(rig,rig.legR,0);
    solveLegIK(rig, rig.legL, rootPt(rig,-0.12,0.25-Math.sin(c)*0.18,-0.28), kneePole(-1)); plantFoot(rig,rig.legL,0);
  } else if (mode==='vault'){
    // hands plant on the rail, knees tuck up and swing through, then the legs reach for the landing
    const v=st.vaultK||0, tuck=Math.sin(Math.min(1,v/0.75)*PI);
    targetY=-0.1-0.12*tuck; lean=0.35*tuck;
    solveLegIK(rig, rig.legR, rootPt(rig,0.15,0.2+0.45*tuck,-0.1-0.25*tuck), kneePole(1)); plantFoot(rig,rig.legR,-0.2*tuck);
    solveLegIK(rig, rig.legL, rootPt(rig,-0.15,0.15+0.35*tuck,0.1-0.15*tuck), kneePole(-1)); plantFoot(rig,rig.legL,-0.2*tuck);
  } else if (mode==='prone' && kneelK>0.01){
    // on the way down / up: knees bent under the body
    targetY=-0.42*kneelK; lean=0.35*kneelK;
    for (const leg of [rig.legR,rig.legL]){ const q=[leg.th.quaternion.clone(),leg.sh.quaternion.clone(),leg.ft.quaternion.clone()];
      solveLegIK(rig, leg, rootPt(rig, leg.side*0.15, 0.1, 0.12), kneePole(leg.side)); plantFoot(rig, leg, 0);
      const k=kneelK; leg.th.quaternion.copy(q[0].slerp(leg.th.quaternion,k)); leg.sh.quaternion.copy(q[1].slerp(leg.sh.quaternion,k)); leg.ft.quaternion.copy(q[2].slerp(leg.ft.quaternion,k)); }
  } else {
    rig.phase += dt*(mode==='walk'?1.2:0);
  }
  rig.modelY = damp(rig.modelY, targetY, 12, dt);
  // ---- torso: lean, stride twist, aim pitch, lean-peek
  const pitch=clamp(st.pitch||0,-1.2,1.2), peek=st.lean||0;
  if (mode==='prone'){ localRot(b.spine, lean*0.6*(1-tilt), 0, 0); localRot(b.chest, -0.25*tilt+lean*0.4*(1-tilt), 0, 0); localRot(b.neck, (-0.75-pitch*0.3)*tilt-lean*0.4*(1-tilt), 0, 0); localRot(b.head, (-0.45-pitch*0.2)*tilt-pitch*0.25*(1-tilt), 0, 0); }
  else {
  const sw=rig.sway||0, bo=rig.bounce||0;
  localRot(b.hips, 0, twist*0.9, sw);                                  // pelvis turns with the swinging leg
  localRot(b.spine, lean*0.6 - pitch*0.15, -twist*0.9, peek*0.35 - sw*0.6);
  localRot(b.chest, lean*0.4 - pitch*0.25, -twist*0.7, peek*0.2 - sw*0.4); // shoulders counter-rotate
  localRot(b.neck, -lean*0.4 - pitch*0.3 + bo*0.8, twist*0.5, sw*0.5);   // head stays level and steady
  localRot(b.head, -pitch*0.25, twist*0.25, 0); }
  // ---- smooth all transitions (no snapping): blend toward this frame's pose
  const k = rig.firstFrame ? 1 : 1-Math.exp(-16*dt); rig.firstFrame=false;
  for (const n in b){ if (/arm|hand|^f\d|^th_/.test(n)) continue; rig.prev[n].slerp(b[n].quaternion,k); b[n].quaternion.copy(rig.prev[n]); }
  rig.model.position.y=rig.modelY; rig.root.updateMatrixWorld(true);
  // ---- landing absorb: hips drop and the knees take it, feet stay exactly where they touched down
  const land=st.land||0;
  if (land>0.02 && (mode==='idle'||mode==='walk'||mode==='run'||mode==='crouch'||mode==='crouchwalk')){
    const fR=new V3(), fL=new V3(); b.footR.getWorldPosition(fR); b.footL.getWorldPosition(fL);
    rig.model.position.y = rig.modelY - 0.14*land; rig.root.updateMatrixWorld(true);
    solveLegIK(rig, rig.legR, fR, kneePole(1)); plantFoot(rig, rig.legR, 0);
    solveLegIK(rig, rig.legL, fL, kneePole(-1)); plantFoot(rig, rig.legL, 0);
  }
  // ---- arms
  const hold=st.hold, w=hold&&hold.weapon;
  const standSh = 1.43 + rig.modelY - Math.abs(lean)*0.08, shoulderY = mode==='prone' ? lerp(standSh, 0.24, tilt) : standSh;
  rig.weaponSlot.visible = !!w && mode!=='ladder' && mode!=='vault';
  const swingArm=(arm, ph, amp)=>{ // free arm swing opposite the legs, elbow slightly bent
    const s=Math.sin(ph*PI*2)*amp*arm.side;
    solveArmIK(rig, arm, rootPt(rig, arm.side*0.24, shoulderY-0.5+Math.abs(s)*0.15, s*0.35-0.05), rootPt(rig, arm.side*0.5, shoulderY-0.4, 0.6));
    relaxHand(rig, arm);
  };
  const runAmp = mode==='run'||mode==='walk' ? lerp(0.3, 0.6+0.3*rig.sprintK, runK) : 0.05;   // arms swing harder as the gait speeds up
  if (mode==='ladder' || mode==='vault'){
    const c=st.climb||0;
    for (const arm of [rig.armR, rig.armL]){
      const t = mode==='vault' ? rootPt(rig, arm.side*0.25, 1.0, -0.45) : rootPt(rig, arm.side*0.22, 1.75+Math.sin(c)*0.2*arm.side, -0.32);
      solveArmIK(rig, arm, t, rootPt(rig, arm.side*0.9, 0.9, 0.3)); relaxHand(rig, arm);
    }
    return;
  }
  if (!w){ swingArm(rig.armR, rig.phase, runAmp); swingArm(rig.armL, rig.phase, runAmp); return; }
  // weapon placement (holdPivot at shoulder height, pitched with aim)
  const lowRun = hold.lowReady && !hold.firing && !st.ads;
  const moveK = (mode==='run'||mode==='crouchwalk') ? 1 : 0, sph=Math.sin(rig.phase*PI*2);
  rig.holdPivot.position.set(0.04 - (rig.sway||0)*0.6, shoulderY + (rig.bounce||0)*0.5, mode==='prone' ? lerp(-0.02,-0.42,tilt) : -0.02);
  rig.holdPivot.rotation.set((lowRun ? -0.15 : pitch) + moveK*Math.abs(sph)*0.03*(st.ads?0.3:1), -twist*0.6*moveK*(st.ads?0.4:1), sph*0.04*moveK*(st.ads?0.3:1));
  const hp=w.tpHold.slice();
  let rx=(hold.kick||0)*0.14, rz=0, ry=0;
  if (lowRun){
    if (w.id==='glock'){ hp[0]=0.24; hp[1]=-0.58+Math.abs(sph)*0.03; hp[2]=-0.1-sph*0.14; rx=-1.15+sph*0.25; }       // pistol down at the side, swinging with the stride (reference run)
    else if (w.id==='knife'){ hp[0]=0.22; hp[1]=-0.5+Math.abs(sph)*0.1; hp[2]=-0.05-sph*0.3; rx=-0.9+sph*0.4; }   // knife arm swings naturally
    else if (w.id!=='knife'){ hp[0]=0.2; hp[1]=-0.32+Math.abs(sph)*0.025; hp[2]=-0.3; rx=-0.5+sph*0.06; ry=0.32; } // rifle low-ready on the right side (visible from the over-the-shoulder camera), bobbing with the stride
  }
  const rk=hold.reloadK||0, dip=Math.sin(Math.min(1,rk*1.15)*PI);
  rig.weaponSlot.position.set(hp[0], hp[1]-dip*0.07, hp[2]+(hold.kick||0)*0.05);
  rig.weaponSlot.rotation.set(rx+dip*0.3, ry, rz+dip*0.45);
  if (hold.swing){ const e=Math.sin(hold.swing*PI); rig.weaponSlot.rotation.y=-1.3*e; rig.weaponSlot.position.x-=0.25*e; rig.weaponSlot.position.z-=0.2*e; }
  if (hold.smoking){ rig.weaponSlot.visible=false; }
  rig.weaponSlot.updateMatrixWorld(true);
  const wq=w.model.getWorldQuaternion(new THREE.Quaternion());
  const poleR=mode==='prone'&&tilt>0.5?rootPt(rig,0.8,-0.6,0.2):rootPt(rig,0.75,0.55,0.5), poleL=mode==='prone'&&tilt>0.5?rootPt(rig,-0.8,-0.6,0.2):rootPt(rig,-0.75,0.55,0.4);
  if (hold.nicT!==undefined && hold.nicT!==null && hold.nic && nicPhase(hold.nicT).visible){
    const nph=nicPhase(hold.nicT), e=nph.hand;
    const head=new V3(); rig.bones.head.getWorldPosition(head);
    const rq=rig.root.getWorldQuaternion(new THREE.Quaternion());
    const mouth=head.clone().add(new V3(0.0,-0.08,-0.12).applyQuaternion(rq));
    const gp=rootPt(rig,0.22,1.1+rig.modelY,-0.32).lerp(mouth,e);
    gripHand(rig, rig.armR, gp, rq, 'nicR', rootPt(rig,0.8,0.9,0.3));
    rig.weaponSlot.visible=false; hold.nic.visible=true; placeNic(rig, hold.nic, rq, 0.6*e);
    if (hold.nic.userData.led) hold.nic.userData.led.material.opacity=0.25+0.75*nph.hold;
    swingArm(rig.armL, rig.phase, runAmp);
    return;
  } else if (hold.nic) hold.nic.visible=false;
  if (hold.smoking){
    // hand travels between chest height and the mouth; the mouth point is taken from the head bone so walking can't make it wobble
    const t=hold.smokeT||0, k=smokeCurve(t), e=k*k*(3-2*k), up=smokeIn(t);
    const head=new V3(); rig.bones.head.getWorldPosition(head);
    const rq=rig.root.getWorldQuaternion(new THREE.Quaternion());
    const mouth=head.clone().add(new V3(0.0,-0.06,-0.13).applyQuaternion(rq));
    const low=rootPt(rig,0.2,1.12+rig.modelY,-0.3);
    const gp=low.lerp(mouth,e); gp.y-= (1-up)*0.35;
    smokeHand(rig, gp, rq, poleR);
    if (hold.blunt){ hold.blunt.visible=true; placeBlunt(rig, hold.blunt); }
    swingArm(rig.armL, rig.phase, runAmp);
    return;
  }
  gripHand(rig, rig.armR, w.model.localToWorld(w.grip.clone()), wq, w.id==='knife'?'knifeR':'gripR', poleR);
  if (hold.supportOverride){ solveArmIK(rig, rig.armL, hold.supportOverride, poleL); relaxHand(rig, rig.armL); }
  else if (w.id==='knife' || (lowRun && w.id==='glock')) swingArm(rig.armL, rig.phase+0.5, runAmp);
  else gripHand(rig, rig.armL, w.model.localToWorld(w.support.clone()), wq, w.id==='glock'?'wrapL':'supportL', poleL);
}

/* --------------------------------------------------------------- ragdoll
   Physics ragdoll on the character's own skeleton. 15 point masses sit on the joints (pelvis, chest, head, shoulders,
   elbows, hands, hips, knees, ankles) and are joined by distance constraints along the bones, with cross braces that
   keep the torso a rigid box and soft limits that stop knees/elbows folding through the body (position-based /
   Verlet dynamics, 8 solver passes). Gravity, ground and wall collisions (the map colliders), friction and a little
   bounce. The killing hit's direction and force is applied as an impulse at the part that was hit, so bodies
   tumble backwards, spin sideways or flip their legs up depending on the shot. Every frame the bones are re-aimed
   from the masses: torso orientation from its four corners, limbs aimed joint-to-joint. Bodies go to sleep once
   they stop moving (no more work) and are removed after 10 s by Corpses. */
const RAG_J = ['hips','chest','head','shL','elL','haL','shR','elR','haR','thL','knL','ftL','thR','knR','ftR'];
const RAG_R = {head:0.12, chest:0.14, hips:0.13, haL:0.05, haR:0.05, ftL:0.06, ftR:0.06};   // contact radius per mass
const RAG_LINKS = [ // [a, b, stiffness]  bones + torso braces
  ['hips','chest',1],['chest','head',1],['chest','shL',1],['chest','shR',1],['shL','shR',1],['hips','shL',1],['hips','shR',1],
  ['hips','thL',1],['hips','thR',1],['thL','thR',1],['chest','thL',1],['chest','thR',1],['shL','thL',1],['shR','thR',1],
  ['head','shL',0.5],['head','shR',0.5],
  ['shL','elL',1],['elL','haL',1],['shR','elR',1],['elR','haR',1],['thL','knL',1],['knL','ftL',1],['thR','knR',1],['knR','ftR',1]];
const RAG_MIN = [['shL','haL',0.16],['shR','haR',0.16],['thL','ftL',0.42],['thR','ftR',0.42],['head','hips',0.5],['haL','hips',0.08],['haR','hips',0.08],['ftL','ftR',0.12],['knL','knR',0.1]];
function ragGround(x, z, y){
  let g=0; for (const c of colliders){ if (c.y1<=y+0.25 && c.y1>g && overlapXZ(c,x,z,0.02)) g=c.y1; } return g;
}
const Ragdoll = {
  start(rig, hitDirWorld, opts={}){
    rig.root.updateMatrixWorld(true);
    const b=rig.bones, wp=o=>o.getWorldPosition(new V3());
    const tip=(bone,len)=>{ const q=bone.getWorldQuaternion(new THREE.Quaternion()); return wp(bone).add(new V3(0,len,0).applyQuaternion(q)); };
    const pos={hips:wp(b.hips), chest:wp(b.neck), head:tip(b.head,0.16), shL:wp(b.upper_armL), elL:wp(b.forearmL), haL:tip(b.handL,0.07),
      shR:wp(b.upper_armR), elR:wp(b.forearmR), haR:tip(b.handR,0.07), thL:wp(b.thighL), knL:wp(b.shinL), ftL:wp(b.footL), thR:wp(b.thighR), knR:wp(b.shinR), ftR:wp(b.footR)};
    const N=RAG_J.length, x=new Float32Array(N*3), o=new Float32Array(N*3), idx={};
    RAG_J.forEach((n,i)=>{ idx[n]=i; x[i*3]=pos[n].x; x[i*3+1]=pos[n].y; x[i*3+2]=pos[n].z; });
    const links=RAG_LINKS.map(([p,q,k])=>[idx[p],idx[q],pos[p].distanceTo(pos[q]),k]);
    const mins=RAG_MIN.map(([p,q,d])=>[idx[p],idx[q],d]);
    // initial velocity: the body's own motion + the hit impulse (strongest at the part that was hit, felt through the torso)
    const d=(hitDirWorld||new V3(0,0,1)).clone(); d.y=0; if (d.lengthSq()<1e-6) d.set(0,0,1); d.normalize();
    const base=(opts.vel||new V3()).clone(), force=(opts.force||1)*(2.2+Math.random()*1.4);
    const hitPart=opts.part==='head'?'head':opts.part==='legs'?(Math.random()<0.5?'knL':'knR'):'chest';
    const big=Math.random()<0.15;                                  // now and then a bigger, funnier fall (legs fly up)
    const dt0=1/60;
    for (let i=0;i<N;i++){
      const n=RAG_J[i], w = n===hitPart ? 1 : (n==='chest'||n==='head'||n==='shL'||n==='shR') ? 0.7 : n==='hips' ? 0.45 : 0.3;
      const v=base.clone().addScaledVector(d, force*w);
      if (big && /^(kn|ft)/.test(n)) v.y+=2.2; if (big && n==='head') v.addScaledVector(d,1.2);
      v.x+=(Math.random()-0.5)*0.4; v.z+=(Math.random()-0.5)*0.4; v.y+=0.25*w;
      o[i*3]=x[i*3]-v.x*dt0; o[i*3+1]=x[i*3+1]-v.y*dt0; o[i*3+2]=x[i*3+2]-v.z*dt0;
    }
    // knees and elbows start slightly bent so limbs never lock straight
    for (const [k,dx] of [['knL',0],['knR',0]]){ const i=idx[k]; x[i*3]+=d.x*0.03; x[i*3+2]+=d.z*0.03; }
    // reference torso frames (for re-orienting hips / chest from the masses)
    const frameOf=(X,up,side)=>{ const U=new V3(X[idx[up[1]]*3]-X[idx[up[0]]*3],X[idx[up[1]]*3+1]-X[idx[up[0]]*3+1],X[idx[up[1]]*3+2]-X[idx[up[0]]*3+2]).normalize();
      const S=new V3(X[idx[side[0]]*3]-X[idx[side[1]]*3],X[idx[side[0]]*3+1]-X[idx[side[1]]*3+1],X[idx[side[0]]*3+2]-X[idx[side[1]]*3+2]); S.addScaledVector(U,-S.dot(U)).normalize();
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(S, U, new V3().crossVectors(S,U))); };
    const F={hip:[['hips','chest'],['thL','thR']], chest:[['chest','head'],['shL','shR']]};
    const q0={hips:b.hips.getWorldQuaternion(new THREE.Quaternion()), chest:b.chest.getWorldQuaternion(new THREE.Quaternion()), spine:b.spine.getWorldQuaternion(new THREE.Quaternion()), neck:b.neck.getWorldQuaternion(new THREE.Quaternion())};
    rig.rag={t:0, x, o, idx, links, mins, frameOf, F, B0:{hip:frameOf(x,...F.hip), chest:frameOf(x,...F.chest)}, q0, hipOff:wp(b.hips).sub(pos.hips), still:0, sleep:false};
    rig.weaponSlot.visible=false;
  },
  step(rig, dt){
    const R=rig.rag; if (R.sleep) return;
    R.t+=dt; const h=Math.min(dt,1/30), x=R.x, o=R.o, N=RAG_J.length, G=9.8, idx=R.idx;
    // Verlet integration (air drag 1%)
    let move=0;
    for (let i=0;i<N;i++){ const j=i*3;
      const vx=(x[j]-o[j])*0.99, vy=(x[j+1]-o[j+1])*0.99, vz=(x[j+2]-o[j+2])*0.99;
      o[j]=x[j]; o[j+1]=x[j+1]; o[j+2]=x[j+2];
      x[j]+=vx; x[j+1]+=vy-G*h*h; x[j+2]+=vz; move+=Math.abs(vx)+Math.abs(vy)+Math.abs(vz); }
    for (let it=0; it<8; it++){
      for (const [a,c,L,k] of R.links){ const A=a*3, C=c*3, dx=x[C]-x[A], dy=x[C+1]-x[A+1], dz=x[C+2]-x[A+2], d=Math.hypot(dx,dy,dz)||1e-6, f=(d-L)/d*0.5*k;
        x[A]+=dx*f; x[A+1]+=dy*f; x[A+2]+=dz*f; x[C]-=dx*f; x[C+1]-=dy*f; x[C+2]-=dz*f; }
      for (const [a,c,m] of R.mins){ const A=a*3, C=c*3, dx=x[C]-x[A], dy=x[C+1]-x[A+1], dz=x[C+2]-x[A+2], d=Math.hypot(dx,dy,dz)||1e-6; if (d>=m) continue; const f=(d-m)/d*0.5;
        x[A]+=dx*f; x[A+1]+=dy*f; x[A+2]+=dz*f; x[C]-=dx*f; x[C+1]-=dy*f; x[C+2]-=dz*f; }
      // collisions: ground (with friction + a little bounce) and the sides of walls / cars / props
      for (let i=0;i<N;i++){ const j=i*3, r=RAG_R[RAG_J[i]]||0.07;
        const g=ragGround(x[j],x[j+2],x[j+1])+r;
        if (x[j+1]<g){ const vy=x[j+1]-o[j+1]; x[j+1]=g; o[j+1]=g+vy*0.25;                  // bounce: 25% of the impact speed
          o[j]=x[j]-(x[j]-o[j])*0.72; o[j+2]=x[j+2]-(x[j+2]-o[j+2])*0.72; }                // friction while touching the ground
        for (const c of colliders){ if (c.nb || x[j+1]>c.y1-0.02 || x[j+1]<c.y0) continue; const q=overlapXZ(c,x[j],x[j+2],r); if (!q) continue;
          let nx, nz, pen; if (q.d2>1e-10){ const d=Math.sqrt(q.d2); nx=q.ex/d; nz=q.ez/d; pen=r-d; }
          else { const px=c.hx-Math.abs(q.lx), pz=c.hz-Math.abs(q.lz); if (px<pz){ nx=Math.sign(q.lx)||1; nz=0; pen=px+r; } else { nx=0; nz=Math.sign(q.lz)||1; pen=pz+r; } }
          const wx=nx*c.c+nz*c.s, wz=-nx*c.s+nz*c.c; x[j]+=wx*pen; x[j+2]+=wz*pen; }
      }
    }
    // ---- drive the skeleton from the masses
    const P=i=>new V3(x[i*3],x[i*3+1],x[i*3+2]), b=rig.bones;
    const qHip=R.frameOf(x,...R.F.hip).multiply(R.B0.hip.clone().invert()), qCh=R.frameOf(x,...R.F.chest).multiply(R.B0.chest.clone().invert());
    const setWorldQ=(bone,q)=>{ const pq=bone.parent.getWorldQuaternion(new THREE.Quaternion()); bone.quaternion.copy(pq.invert().multiply(q)); bone.updateMatrixWorld(true); };
    // hips: world position = pelvis mass, orientation = rotation of the pelvis frame since death
    const hipW=P(idx.hips).add(R.hipOff.clone().applyQuaternion(qHip));
    const par=b.hips.parent; par.updateMatrixWorld(true); b.hips.position.copy(par.worldToLocal(hipW));
    setWorldQ(b.hips, qHip.clone().multiply(R.q0.hips));
    const qS=qHip.clone().slerp(qCh,0.5); setWorldQ(b.spine, qS.multiply(R.q0.spine));
    setWorldQ(b.chest, qCh.clone().multiply(R.q0.chest));
    setWorldQ(b.neck, qCh.clone().multiply(R.q0.neck));
    const aim=(bone,toI)=>{ const from=bone.getWorldPosition(new V3()), d=P(toI).sub(from); if (d.lengthSq()>1e-6) aimBone(bone, rig.rest[bone.name], d.normalize()); };
    aim(b.head, idx.head);
    aim(b.upper_armL, idx.elL); aim(b.forearmL, idx.haL); aim(b.upper_armR, idx.elR); aim(b.forearmR, idx.haR);
    aim(b.thighL, idx.knL); aim(b.shinL, idx.ftL); aim(b.thighR, idx.knR); aim(b.shinR, idx.ftR);
    relaxHand(rig, rig.armR); relaxHand(rig, rig.armL);
    // sleep once settled (no more per-frame work until despawn)
    R.still = move<0.004*N ? R.still+dt : 0;
    if (R.t>1.5 && R.still>0.6) R.sleep=true;
  },
};
// Corpses: pooled ragdoll bodies that despawn after exactly 10 seconds.
const Corpses = {
  pool:[], live:[],
  spawn(srcRig, hitDir, opts){
    const pi=this.pool.findIndex(r=>r.charId===srcRig.charId);
    let rig = pi>=0 ? this.pool.splice(pi,1)[0] : null; if (!rig){ rig=buildCharacter(srcRig.look); scene.add(rig.root); }
    setSkiMask(rig, srcRig.meshes.some(o=>o.name.startsWith('SkiMask')&&o.visible));
    setLookColors(rig, srcRig.look);
    rig.root.visible=true; for (const m of rig.meshes) m.frustumCulled=false;   // bones travel away from the root
    rig.root.position.copy(srcRig.root.position); rig.root.quaternion.copy(srcRig.root.quaternion);
    rig.modelY=srcRig.modelY; rig.model.position.y=srcRig.model.position.y;
    rig.pose.position.copy(srcRig.pose.position); rig.pose.rotation.copy(srcRig.pose.rotation); rig.proneK=srcRig.proneK;
    for (const n in rig.bones){ rig.bones[n].quaternion.copy(srcRig.bones[n].quaternion); rig.bones[n].position.copy(srcRig.bones[n].position); }
    Ragdoll.start(rig, hitDir, opts||{});
    this.live.push({rig, t:0});
    return rig;
  },
  update(dt){
    for (let i=this.live.length-1;i>=0;i--){
      const c=this.live[i]; c.t+=dt;
      const fx=Perf.fx(), life=fx==='minimal'?3.5:fx==='reduced'?6:10, maxN=fx==='minimal'?2:fx==='reduced'?4:99;
      if (c.t>=life || this.live.length-i>maxN){ c.rig.root.visible=false; c.rig.rag=null; this.pool.push(c.rig); this.live.splice(i,1); continue; }
      Ragdoll.step(c.rig, dt);
    }
  },
  clear(){ for (const c of this.live){ c.rig.root.visible=false; c.rig.rag=null; this.pool.push(c.rig); } this.live=[]; },
};
// Merge sibling meshes that share a material (per bone) to cut draw calls.
function mergeStatic(obj){
  const groups=new Map();
  for (const c of obj.children.slice()){
    if (c.isMesh && c.children.length===0 && !c.userData.keep){ const k=c.material.uuid; if (!groups.has(k)) groups.set(k,[]); groups.get(k).push(c); }
    else mergeStatic(c);
  }
  for (const list of groups.values()){
    if (list.length<2) continue;
    let n=0; const geos=list.map(m=>{ m.updateMatrix(); const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone(); g.applyMatrix4(m.matrix); n+=g.attributes.position.count; return g; });
    const pos=new Float32Array(n*3), nor=new Float32Array(n*3), uv=new Float32Array(n*2); let o=0;
    for (const g of geos){ pos.set(g.attributes.position.array,o*3); nor.set(g.attributes.normal.array,o*3); if (g.attributes.uv) uv.set(g.attributes.uv.array,o*2); o+=g.attributes.position.count; g.dispose(); }
    const bg=new THREE.BufferGeometry(); bg.setAttribute('position',new THREE.BufferAttribute(pos,3)); bg.setAttribute('normal',new THREE.BufferAttribute(nor,3)); bg.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    const m=new THREE.Mesh(bg,list[0].material); m.castShadow=true;
    list.forEach(x=>obj.remove(x)); obj.add(m);
  }
}
