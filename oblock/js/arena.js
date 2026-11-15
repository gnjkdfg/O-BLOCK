'use strict';
/* RUN THAT FADE arena: an underground fight room 1.5 km south of the block (outside the camera's reach, so the city is
   never drawn while you're here). Your imported octagon (assets/cage.js) sits in the middle at 1.4x (about 9 m across
   inside, mat 1.12 m up, fence 2 m above the mat), with eight benches around it, three seats each.
   The colliders are always there (the server uses them for hit / line-of-sight checks); the visuals are built the
   first time a Run That Fade match starts. */
const ARENA = (()=>{
  const o=[0,-1500], s=1.4, mat=1.12, fenceR=3.2*s, platR=6.2, room=17, benchR=9.4, seats=[], spots=[];
  for (let i=0;i<8;i++){ const a=(i+0.5)*PI/4, cx=o[0]+Math.sin(a)*benchR, cz=o[1]+Math.cos(a)*benchR, yaw=Math.atan2(Math.sin(a),Math.cos(a));   // facing the cage
    for (const k of [-0.75,0,0.75]) seats.push([+(cx+Math.cos(a)*k).toFixed(2), +(cz-Math.sin(a)*k).toFixed(2), +yaw.toFixed(3)]);
    spots.push([+(o[0]+Math.sin(a)*(benchR-1.4)).toFixed(2), +(o[1]+Math.cos(a)*(benchR-1.4)).toFixed(2), +yaw.toFixed(3)]); }
  // fighters: opposite sides of the mat, facing each other (forward = -sin(yaw), -cos(yaw))
  const corners=[[o[0]-2.8, o[1], -PI/2], [o[0]+2.8, o[1], PI/2]];
  return {o, s, mat, fenceR, platR, room, benchR, seats, spots, corners};
})();
// colliders (built with the map): the raised octagon platform, the 8 fence sides, the room walls and the benches
function arenaColliders(){
  const A=ARENA, [ox,oz]=A.o, h=Math.tan(PI/8);
  for (let i=0;i<4;i++) addCol(ox,oz,A.platR,A.platR*h,0,A.mat,i*PI/4);                         // octagon = union of 4 rotated slabs
  for (let i=0;i<8;i++){ const a=i*PI/4+PI/8, d=A.fenceR+0.06;                                    // fence: one wall per side, mat to 2.3 m above it
    addCol(ox+Math.sin(a)*d, oz+Math.cos(a)*d, A.fenceR*h+0.12, 0.06, A.mat, A.mat+2.3, -a); }
  const R=A.room; addCol(ox,oz-R,R,0.5,0,8); addCol(ox,oz+R,R,0.5,0,8); addCol(ox-R,oz,0.5,R,0,8); addCol(ox+R,oz,0.5,R,0,8);
  for (let i=0;i<8;i++){ const a=(i+0.5)*PI/4; addCol(ox+Math.sin(a)*A.benchR, oz+Math.cos(a)*A.benchR, 1.25, 0.24, 0, 0.45, -a); }
}

const Arena = {
  on:false, built:false, root:null, fade:null, seat:null, watch:false,
  inCage(p){ return Math.hypot(p.x-ARENA.o[0], p.z-ARENA.o[1]) < ARENA.fenceR+0.3 && p.y>0.6; },
  build(){
    if (this.built) return; this.built=true;
    const A=ARENA, [ox,oz]=A.o, root=this.root=new THREE.Group(); root.position.set(ox,0,oz); scene.add(root);
    const L=(c,o)=>new THREE.MeshLambertMaterial(Object.assign({color:c},o||{}));
    // the imported octagon
    const addCage=()=>{ const b64=(window.GLB||{}).cage;
    if (b64){ GLBfree(b64); const bin=atob(b64), buf=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
      new THREE.GLTFLoader().parse(buf.buffer,'',g=>{ const c=g.scene; c.scale.multiplyScalar(A.s);
        c.traverse(o=>{ if (o.isMesh){ const m=o.material; o.material=new THREE.MeshLambertMaterial({color:m.color.clone().convertLinearToSRGB(), map:m.map||null, alphaTest:m.alphaTest||(m.transparent?0.4:0), transparent:false, side:m.alphaTest||m.transparent?THREE.DoubleSide:THREE.FrontSide});
          if (m.map) m.map.encoding=THREE.LinearEncoding; o.receiveShadow=true; o.castShadow=!/Fence/.test(m.name); } });
        root.add(c); Arena.cage=c; }); } };
    if ((window.GLB||{}).cage) addCage(); else loadScript('assets/cage.js').then(addCage).catch(e=>UI.toast('COULD NOT LOAD THE CAGE · '+e,'warn'));   // 0.8 MB, only fetched for this mode
    // room: concrete floor, brick-dark walls, low ceiling with beams
    const R=A.room, floor=new THREE.Mesh(new THREE.PlaneGeometry(R*2,R*2), L('#3a3734')); floor.rotation.x=-PI/2; floor.position.y=0.005; floor.receiveShadow=true; root.add(floor);
    const wallM=L('#2b2524'), wallG=new THREE.BoxGeometry(R*2,8,0.5);
    for (const [x,z,ry] of [[0,-R,0],[0,R,0],[-R,0,PI/2],[R,0,PI/2]]){ const w=new THREE.Mesh(wallG,wallM); w.position.set(x,4,z); w.rotation.y=ry; root.add(w); }
    const ceil=new THREE.Mesh(new THREE.PlaneGeometry(R*2,R*2), L('#151414')); ceil.rotation.x=PI/2; ceil.position.y=7.5; root.add(ceil);
    const beamM=L('#1d1b1a'); for (let i=-2;i<=2;i++){ const bm=new THREE.Mesh(new THREE.BoxGeometry(R*2,0.4,0.3), beamM); bm.position.set(0,7.2,i*6.5); root.add(bm); }
    // benches (wood seat on two steel legs) and a few crates by the walls
    const wood=L('#6b4a2e'), steel=L('#3b3d40');
    for (let i=0;i<8;i++){ const a=(i+0.5)*PI/4, g=new THREE.Group(); g.position.set(Math.sin(a)*A.benchR,0,Math.cos(a)*A.benchR); g.rotation.y=a+PI/2;
      const seat=new THREE.Mesh(new THREE.BoxGeometry(2.5,0.08,0.46), wood); seat.position.y=0.45; seat.castShadow=true; g.add(seat);
      for (const x of [-1,1]){ const leg=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.44,0.38), steel); leg.position.set(x,0.22,0); g.add(leg); }
      root.add(g); }
    const crate=L('#5a4630'); for (const [x,z,s] of [[-14,-13,1.2],[-12.6,-14,0.9],[14,13.5,1.1],[13,-14.2,1],[-14.5,12,1]]){ const c=new THREE.Mesh(new THREE.BoxGeometry(s,s,s), crate); c.position.set(x,s/2,z); c.rotation.y=x*0.3; root.add(c); }
    // lights: one hanging lamp over the cage (the directional light is aimed straight down while you're here) and dim bulbs
    // on the walls; the glow is unlit geometry, so it costs nothing
    const glow=new THREE.MeshBasicMaterial({color:'#ffe4a8'}), shade=L('#202020');
    const lamp=new THREE.Mesh(new THREE.CylinderGeometry(0.5,1.4,0.5,16,1,true), shade); lamp.position.y=6.4; root.add(lamp);
    const bulb=new THREE.Mesh(new THREE.CircleGeometry(1.25,20), glow); bulb.rotation.x=PI/2; bulb.position.y=6.17; root.add(bulb);
    const wire=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,1.2,4), shade); wire.position.y=6.9; root.add(wire);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(5.6,6,24,1,true), new THREE.MeshBasicMaterial({color:'#ffdca0', transparent:true, opacity:0.05, depthWrite:false, side:THREE.DoubleSide}));
    cone.position.y=3.15; root.add(cone);
    for (const [x,z] of [[0,-R+0.3],[0,R-0.3],[-R+0.3,0],[R-0.3,0],[-R+0.3,-10],[R-0.3,10]]){ const b=new THREE.Mesh(new THREE.SphereGeometry(0.12,8,6), glow); b.position.set(x,4.6,z); root.add(b); }
    root.traverse(o=>{ if (o.isMesh && o.geometry.type!=='PlaneGeometry') o.castShadow=o.castShadow||false; });
  },
  enter(){ this.build(); this.on=true; this.root.visible=true; this.seat=null; this.watch=false; Env.raining=false; },
  exit(){ this.on=false; if (this.root) this.root.visible=false; this.seat=null; this.watch=false; this.fade=null; P.seated=false; },
  // dark underground room: overrides the day/night lighting after Env.update each frame
  light(){
    scene.background.set('#1a1714'); scene.fog.color.set('#1a1714'); scene.fog.near=26; scene.fog.far=75;
    hemi.color.set('#c9bfb0'); hemi.groundColor.set('#4a4038'); hemi.intensity=0.85;
    sun.color.set('#ffe6bc'); sun.intensity=1.15; Env.sunDir=new V3(0.06,1,0.04).normalize();
    if (Env.stars) Env.stars.material.opacity=0; if (Env.disc) Env.disc.material.opacity=0; if (Env.rain) Env.rain.visible=false;
    CharLight.value.set(0.75,0.08);
  },
  fighter(){ const F=this.fade; return !!(F && (F.a===Net.id || F.b===Net.id) && (F.state==='count'||F.state==='fight')); },
  // benches: F to sit (the view drops to seat height, movement keys stand you up); while seated, V switches to the fight camera
  nearSeat(){ let best=null, bd=1.3; for (const s of ARENA.seats){ const d=Math.hypot(P.pos.x-s[0],P.pos.z-s[1]); if (d<bd){ bd=d; best=s; } } return best; },
  sit(s){ this.seat=s; P.seated=true; P.pos.set(s[0],0,s[1]); P.vel.set(0,0,0); P.yaw=s[2]; Fists.setBlock(false); },
  stand(){ if (!this.seat) return; const s=this.seat; this.seat=null; this.watch=false; P.seated=false; P.pos.set(s[0]-Math.sin(s[2])*0.7, 0, s[1]-Math.cos(s[2])*0.7); },
  update(dt){
    if (!this.on) return;
    if (this.seat){ const s=this.seat; P.pos.set(s[0],0,s[1]); P.vel.set(0,0,0);
      if (!P.alive || Input.down[Binds.forward] || Input.down[Binds.back] || Input.down[Binds.left] || Input.down[Binds.right] || Input.down[Binds.jump] || this.fighter()) this.stand(); }
    this.hud();
  },
  // spectator camera: high above the cage, slowly circling, looking at the two fighters
  camera(){
    if (!this.watch) return false; const F=this.fade, t=performance.now()/4000, [ox,oz]=ARENA.o;
    let tx=ox, tz=oz, ty=1.9; const a=F&&Net.entityById(F.a), b=F&&Net.entityById(F.b);
    if (a && b && a.pos && b.pos){ tx=(a.pos.x+b.pos.x)/2; tz=(a.pos.z+b.pos.z)/2; ty=(a.pos.y+b.pos.y)/2+1.3; }
    camera.position.set(ox+Math.sin(t)*7.5, 5.6, oz+Math.cos(t)*7.5); camera.lookAt(tx,ty,tz); return true;
  },
  hud(){
    const el=document.getElementById('fadehud'); if (!el) return; const F=this.fade;
    let h='';
    if (F){ const nm=id=>id===Net.id?'YOU':esc(((Net.entityById(id)||{}).name)||'?'), hp=id=>{ const e=id===Net.id?P:Net.entityById(id); return e?Math.max(0,Math.round(e.hp)):0; };
      const bar=id=>`<span class="fbar"><i style="width:${hp(id)}%"></i></span>`;
      if (F.state==='count') h=`<b>${nm(F.a)}</b> vs <b>${nm(F.b)}</b><div class="fbig">${Math.max(1,Math.ceil(F.left||0))}</div>`;
      else if (F.state==='fight') h=`<b>${nm(F.a)}</b> ${bar(F.a)} <span class="fvs">VS</span> ${bar(F.b)} <b>${nm(F.b)}</b>`;
      else if (F.last) h=`<div class="fbig">${nm(F.last.w)} WINS</div>${nm(F.last.l)} ${F.last.how==='ko'?'knocked out':F.last.how==='forfeit'?'forfeited':'lost'}`;
      if (F.state!=='count' && F.state!=='fight') h+=`<div class="fsub">${Net.isHost?'Press '+Input.label(Binds.pause)+' to pick the next two fighters':'Waiting for the host to pick the next fight'}</div>`; }
    if (this.seat) h+=`<div class="fsub">Seated · <b>${Input.label(Binds.camera)}</b> ${this.watch?'back to your seat view':'fight camera'} · move to stand up</div>`;
    if (el._h!==h){ el._h=h; el.innerHTML=h; el.style.display=h?'block':'none'; }
  },
  // pause menu: host controls (pick two players, start / stop) and a forfeit button for fighters
  pauseMenu(){
    const box=document.getElementById('pfade'); if (!box) return; box.innerHTML=''; if (!this.on) return;
    const F=this.fade||{}, players=((Net.room&&Net.room.players)||[]).filter(p=>!p.away);
    if (this.fighter()){ const b=el('button','','FORFEIT · BACK TO THE BENCHES'); b.onclick=()=>{ Net.send({t:'fade', cmd:'forfeit'}); Game.resume(); }; box.appendChild(b); }
    if (!Net.isHost) return;
    if (F.state==='count'||F.state==='fight'){ const b=el('button','','STOP THIS FIGHT'); b.onclick=()=>{ Net.send({t:'fade', cmd:'stop'}); Game.resume(); }; box.appendChild(b); return; }
    box.appendChild(el('h4','','PICK THE NEXT FIGHT'));
    if (players.length<2){ box.appendChild(el('p','muted small','Needs at least two players in the room (bots can\'t fight).')); return; }
    const sel=i=>{ const s=el('select'); players.forEach((p,j)=>{ const o=el('option','',esc(p.name)+(p.id===Net.id?' (you)':'')); o.value=p.id; if (j===i) o.selected=true; s.appendChild(o); }); return s; };
    const a=sel(0), b=sel(1), row=el('div','row'); row.append(a, el('span','',' vs '), b); box.appendChild(row);
    const go=el('button','primary','START FIGHT'); go.onclick=()=>{ if (a.value===b.value) return UI.toast('PICK TWO DIFFERENT PLAYERS','warn'); Net.send({t:'fade', cmd:'start', a:a.value, b:b.value}); Game.resume(); };
    const nx=el('button','','NEXT TWO IN LINE'); nx.onclick=()=>{ Net.send({t:'fade', cmd:'next'}); Game.resume(); };
    box.append(go, nx);
  },
  onState(st){ const was=this.fade; this.fade=st;
    if (st.state==='count' && (!was || was.state!=='count')) Snd.uiSfx('confirm');
    if (st.state==='result' && st.last && (!was || was.state!=='result')){ Snd.uiSfx(st.last.w===Net.id?'confirm':'click'); /* the big banner in #fadehud says who won */ }
    if (this.fighter()) this.stand(); },
};
