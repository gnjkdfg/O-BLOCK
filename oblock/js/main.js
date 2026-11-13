'use strict';
/* Boot, renderer, game states, input (rebindable) and the main loop. */

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({canvas, antialias:false, powerPreference:'high-performance'});
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#a3abb0');
scene.fog = new THREE.Fog('#a3abb0', 30, 130);
const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.06, 160);
const hemi = new THREE.HemisphereLight('#d6dde2','#5a5045',0.78); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0db',0.68);
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-40,right:40,top:40,bottom:-40,near:1,far:200});
sun.shadow.bias=-0.0008; scene.add(sun); scene.add(sun.target);

const GFX = {
  low:  {scale:0.7, far:150, fogNear:30, fogFar:135, shadows:false, sky:false},
  med:  {scale:1.0, far:260, fogNear:55, fogFar:230, shadows:false, sky:true},
  high: {scale:Math.min(devicePixelRatio||1,1.5), far:320, fogNear:80, fogFar:300, shadows:true, sky:true},
};
let mapInfo=null, skyGroup=null, groundPhong=null;

/* ---------- Motion blur (lightweight): blends the previous frame in only while the view
   is turning quickly, and backs off while shooting. Costs two full-screen passes. */
const Post = {
  rtS:null, rtA:null, rtB:null, scene:null, cam:null, mat:null, copy:null, prevYaw:0, prevPitch:0, amt:0, w:0, h:0,
  init(){
    this.cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1); this.scene=new THREE.Scene();
    this.mat=new THREE.ShaderMaterial({uniforms:{cur:{value:null},prev:{value:null},k:{value:0}}, depthTest:false, depthWrite:false,
      vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader:'uniform sampler2D cur; uniform sampler2D prev; uniform float k; varying vec2 vUv; void main(){ gl_FragColor=mix(texture2D(cur,vUv),texture2D(prev,vUv),k); }'});
    this.copy=new THREE.MeshBasicMaterial({map:null, depthTest:false, depthWrite:false});
    this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2), this.mat); this.scene.add(this.quad);
  },
  enabled(){ return Settings.blur==='subtle' && !Settings.perf; },
  ensure(){
    const s=renderer.getDrawingBufferSize(new THREE.Vector2()); if (s.x===this.w && s.y===this.h && this.rtS) return;
    this.w=s.x; this.h=s.y; for (const r of [this.rtS,this.rtA,this.rtB]) if (r) r.dispose();
    const o={minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, depthBuffer:true};
    this.rtS=new THREE.WebGLRenderTarget(s.x,s.y,o); this.rtA=new THREE.WebGLRenderTarget(s.x,s.y,{minFilter:THREE.LinearFilter,depthBuffer:false}); this.rtB=this.rtA.clone();
  },
  amount(dt){
    let dy=P.yaw-this.prevYaw, dp=P.pitch-this.prevPitch; this.prevYaw=P.yaw; this.prevPitch=P.pitch;
    const ang=Math.hypot(dy,dp)/Math.max(dt,1e-3);
    let target=clamp((ang-2.5)*0.025,0,0.12);    // subtle: only very fast flicks, never a smear if (Arsenal.recoilP>0||Arsenal.adsK>0.5) target*=0.25;
    this.amt=damp(this.amt,target,14,dt); return this.amt;
  },
  begin(){ this.ensure(); renderer.setRenderTarget(this.rtS); renderer.clear(); },
  end(k){
    this.mat.uniforms.cur.value=this.rtS.texture; this.mat.uniforms.prev.value=this.rtA.texture; this.mat.uniforms.k.value=k;
    this.quad.material=this.mat; renderer.setRenderTarget(this.rtB); renderer.render(this.scene,this.cam);
    this.quad.material=this.copy; this.copy.map=this.rtB.texture; renderer.setRenderTarget(null); renderer.render(this.scene,this.cam);
    const t=this.rtA; this.rtA=this.rtB; this.rtB=t;
  },
};

const Game = {
  state:'loading', menuT:0,
  go(screen, from){
    if (screen==='settings'){ UI.settingsReturn = from||'main'; UI.buildSettings(); }
    if (screen==='loadout'){ UI.loadoutReturn = from||'main'; }
    if (screen==='qload') UI.buildQuick();
    if (screen==='main'){ UI.menuInfo(); $('#brief').style.display='none'; document.querySelectorAll('#mainnav button').forEach(x=>x.classList.remove('sel')); }
    this.state=screen; UI.show(screen);
    if (screen==='pause'||screen==='qload') $('#hud').style.display='block';
    if (screen==='char') Stage.showCharacter();
    if (screen==='loadout') UI.openLoadout();
    if (screen!=='char' && screen!=='loadout') Stage.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  },
  startMatch(mode, online){
    if (!online && Net.inMatch) Net.leaveMatch();
    Snd.init(); Snd.playMusic('song_game'); Stage.clear(); Env.t=Game.gameEnvT; Menu.hide();
    Mode.cur=mode; Bots.setCount((mode==='backpack'?ZARules:MatchRules).bots);          // rules are locked from here until the match ends
    Mode.start(mode); Corpses.clear(); Pickups.clear(); Glass.reset(); Equip.clear(); Effects.reset(); Rides.reset(); Thermal.on=false;
    this.matchId=ProfileAuthority.beginMatch(mode, mode==='backpack'?ZARules.variant:null); this.rewards=null;
    for (const s of searchables) s.searched=false;
    respawnPlayer();
    for (const b of Bots.list) b.respawn();
    P.items.blunt=0; P.items.beer=0; P.items.zyn=0; P.corpse=null;
    this.applyCharacter(); respawnPlayer(); Match.reset(); Perks.reset(); setBloodHoundLook(false);
    this.state='playing'; UI.show(null); $('#death').style.display='none';
    Rig.mode=Settings.camMode; UI.camButtons(); requestLock();
    UI.toast(Mode.label(),'obj'); Pings.list=[];
  },
  pause(){ if (this.state!=='playing') return; this.state='pause'; Snd.uiSfx('open'); Arsenal.trigger=false; Arsenal.ads=false; Snd.autoStop(); for (const k in Input.down) Input.down[k]=false; UI.tabHeld=false; UI.scoreboard(false); UI.show('pause'); $('#hud').style.display='block'; },
  resume(){ Mode._lastNow=null; Snd.uiSfx('close'); this.state='playing'; UI.show(null); requestLock(); },
  toMenu(){ if (Net.inMatch){ Net.leaveMatch(); if (Net.room){ this.state='online'; this.go('online'); Lobby.render(); LaserBeam.hide(); $('#death').style.display='none'; Snd.autoStop(); if (document.pointerLockElement) document.exitPointerLock(); return; } } this.state='main'; this.go('main'); LaserBeam.hide(); $('#death').style.display='none'; Snd.autoStop(); Snd.breath(0); Snd.slideStop(); Snd.playMusic('song_menu'); if (document.pointerLockElement) document.exitPointerLock(); },
  showEnd(name){
    this.state='end'; if (document.pointerLockElement) document.exitPointerLock();
    $('#end-title').textContent = name==='YOU' ? 'VICTORY' : name+' WINS';
    if (name==='TIE') $('#end-title').textContent='DRAW';
    const rows=Net.inMatch && Net.endRows ? Net.endRows.map(r=>({name:r.id===Net.id?'YOU':r.name, kills:r.kills, deaths:r.deaths, score:Mode.cur==='dm'?r.kills*100-r.deaths*10:Math.round(r.hold*10), me:r.id===Net.id, bot:r.kind==='bot'})) : Match.rows(), dm=Mode.cur==='dm';
    const za=!dm, hold=za && ZARules.variant==='hold', stn=za?BackpackAuthority.standings():[];
    $('#end-sub').textContent = dm ? (name==='TIE' ? 'Time is up — tied on kills' : (MatchRules.kills>0 && rows[0].kills>=MatchRules.kills ? 'Reached the kill limit' : 'Most kills when time ran out'))
      : hold ? (name==='TIE' ? 'Time is up — tied on hold time' : 'Longest total hold time: '+(stn[0]?stn[0][1].toFixed(1)+' s':'—')) : 'Held the za for '+ZARules.classicHold+' seconds';
    $('#end-info').innerHTML = `<span>Duration <b>${fmtTime(Mode.clock)}</b></span>`+(dm?`<span>Kill limit <b>${MatchRules.kills||'∞'}</b></span><span>Time limit <b>${MatchRules.time?(MatchRules.time>=60?Math.round(MatchRules.time/60)+' min':MatchRules.time+' s'):'∞'}</b></span><span>Bots <b>${Bots.list.length} · ${MatchRules.difficulty}</b></span>`
      :`<span>Your hold <b>${BackpackAuthority.holdOf('player').toFixed(1)} s</b></span><span>Bots <b>${Bots.list.length} · ${ZARules.difficulty}</b></span>`);
    // placement: kills (Deathmatch) or hold time (THE FIGHT FOR ZA); rewards are paid once per match by the profile authority
    let place = rows.findIndex(r=>r.me)+1;
    if (za){ const ord=[['player',BackpackAuthority.holdOf('player')], ...Bots.list.map(b=>['bot'+b.i,BackpackAuthority.holdOf('bot'+b.i)])].sort((a,b)=>b[1]-a[1]); place=ord.findIndex(r=>r[0]==='player')+1; }
    const won = name==='YOU';
    if (Net.inMatch && Net.endRows) place=Net.endRows.findIndex(r=>r.id===Net.id)+1;
    if (!this.rewards && !Net.inMatch) this.rewards=ProfileAuthority.finishMatch(this.matchId, place, won);
    UI.showRewards(this.rewards, place);
    $('#end-table').innerHTML = rows.map((r,i)=>`<tr class="${r.me?'me':''}"><td>${i+1}</td><td>${r.name}${r.bot?' <small>BOT</small>':''}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.score}</td></tr>`).join('');
    UI.show('end');
  },
  applyCharacter(){ VM.setCharacter(); PlayerChar.build(); },
  applyLoadout(){ if (Arsenal.firearm!==Loadout.firearm) Arsenal.setFirearm(Loadout.firearm); },  // equipment counts apply on next spawn (no refill exploit)
  // saved attachments / paint changed: re-apply to every live instance and clamp magazines
  refreshWeapons(){ VM.refreshWeapons(); PlayerChar.refreshWeapons(); Menu.refresh();
    for (const id of FIREARMS){ const a=Arsenal.ammo[id]; if (a) a.mag=Math.min(a.mag, weaponDef(id).mag); }
    Arsenal.refreshDef(); },
  applyGfx(){
    const s=Object.assign({}, GFX[Settings.quality]||GFX.low);
    if (Settings.perf){ s.scale=Math.min(s.scale,0.6); s.far=Math.min(s.far,130); s.fogNear=25; s.fogFar=Math.min(s.fogFar,125); s.shadows=false; s.sky=false; }
    renderer.setPixelRatio(s.scale); renderer.setSize(innerWidth,innerHeight,false);
    camera.far=s.far; camera.updateProjectionMatrix(); scene.fog.near=s.fogNear; scene.fog.far=s.fogFar;
    if (renderer.shadowMap.enabled!==s.shadows){ renderer.shadowMap.enabled=s.shadows; sun.castShadow=s.shadows; scene.traverse(o=>{ if (o.material) [].concat(o.material).forEach(m=>m.needsUpdate=true); }); }
    if (skyGroup) skyGroup.visible=s.sky;
    if (Flashlight.target) Flashlight.applyQuality(scene);
  },
};

// ---------- Pointer lock & input (all actions go through Binds) ----------
let dragLook=false, mouseDown=false, lockGrace=0;
function requestLock(){
  lockGrace=performance.now()+400;   // ignore a stale 'unlocked' event from leaving the previous match
  try { const r=canvas.requestPointerLock(); if (r && r.catch) r.catch(()=>{ dragLook=true; }); } catch(e){ dragLook=true; }
  setTimeout(()=>{ if (Game.state==='playing' && document.pointerLockElement!==canvas) dragLook=true; }, 600);
}
document.addEventListener('pointerlockchange',()=>{
  if (document.pointerLockElement===canvas) dragLook=false;
  else if (Game.state==='playing' && !dragLook && performance.now()>lockGrace) Game.pause();
});
function actionsFor(code){ return ACTIONS.filter(a=>Binds[a[0]]===code).map(a=>a[0]); }
function pressAction(a){
  if (Game.state!=='playing') return;
  const alive=P.alive && !Mode.ended;
  switch(a){
    case 'jump': P.jumpQueued=true; break;
    case 'interact': interact(); break;
    case 'reload': Arsenal.reload(); break;
    case 'firearm': if (alive) Arsenal.equip(Arsenal.firearm); break;
    case 'knife': if (alive) Arsenal.equip('knife'); break;
    case 'firemode': Arsenal.toggleFireMode(); break;
    case 'grenade': Equip.throwFlash(); break;
    case 'mine': Equip.placeMine(); break;
    case 'smoke': startSmoking(); break;
    case 'beer': useItem('beer'); break;
    case 'zyn': useItem('zyn'); break;
    case 'flashlight': Flashlight.toggle(); break;
    case 'thermal': Thermal.toggle(); break;
    case 'nic': Perks.use('nic'); break;
    case 'ability': Perks.use('ability'); break;
    case 'camera': Rig.toggle(); break;
    case 'loadout': Game.pause(); Game.go('qload'); break;
    case 'prone': if (alive && !P.slide && !P.ladder && !P.inCar && !P.riding) setProne(!P.prone); break;
    case 'leanL': if (Settings.leanMode==='toggle') P.leanToggle = P.leanToggle===-1?0:-1; break;
    case 'leanR': if (Settings.leanMode==='toggle') P.leanToggle = P.leanToggle===1?0:1; break;
    case 'pause': Game.pause(); break;
    case 'scoreboard': UI.tabHeld=true; UI.scoreboard(true); break;
    case 'slide': if (P.sprinting && P.grounded && !P.slide) startSlide(); else if (P.slide) endSlide(); break;
    case 'crouch': if (P.slide) endSlide(); else if (P.prone) setProne(false); else if (Settings.crouchMode==='toggle') P.crouchToggle=!P.crouchToggle; break;
    case 'fire': if (alive){ Arsenal.trigger=true; Arsenal.triggerEdge=true; } break;
    case 'aim': if (alive){ if (Arsenal.cur==='knife'){ if (Arsenal.swing<=0 && Arsenal.state==='idle' && Arsenal.canFire()) Arsenal.startSwing(true); } else Arsenal.ads=true; } break;
  }
}
function releaseAction(a){
  if (a==='fire') Arsenal.trigger=false;
  if (a==='aim') Arsenal.ads=false;
  if (a==='scoreboard'){ UI.tabHeld=false; UI.scoreboard(false); }   // only visible while held
}
const locked = () => document.pointerLockElement===canvas || dragLook;
canvas.addEventListener('mousedown',e=>{
  mouseDown=true;
  if (Game.state!=='playing') return;
  if (document.pointerLockElement!==canvas && !dragLook){ requestLock(); return; }
  const code='Mouse'+e.button; Input.down[code]=true; actionsFor(code).forEach(pressAction);
});
addEventListener('mouseup',e=>{ mouseDown=false; const code='Mouse'+e.button; Input.down[code]=false; actionsFor(code).forEach(releaseAction); });
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',e=>{ if (Game.state==='playing' && locked() && P.alive) Arsenal.cycle(); },{passive:true});
addEventListener('mousemove',e=>{
  if (Game.state!=='playing') return;
  if (document.pointerLockElement!==canvas && !(dragLook && mouseDown)) return;
  // sensitivity scales with the zoom (FOV narrows by the same factor), so the view moves at the same angular rate on screen
  const k=0.0022*Settings.sens*lerp(1, Arsenal.def.adsZoom||1, Arsenal.adsK);
  P.yaw -= e.movementX*k; P.pitch = clamp(P.pitch - e.movementY*k, -1.5, 1.5);
  VM.addLook(e.movementX, e.movementY);
});
addEventListener('keydown',e=>{
  if (UI._k) return;    // key-binding capture in progress
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code)) e.preventDefault();
  if (Game.state!=='playing') return;
  if (e.ctrlKey || e.altKey) e.preventDefault();
  if (e.repeat){ Input.down[e.code]=true; return; }
  Input.down[e.code]=true; actionsFor(e.code).forEach(pressAction);
  if (e.code==='Escape' && dragLook) Game.pause();
});
addEventListener('keyup',e=>{ Input.down[e.code]=false; actionsFor(e.code).forEach(releaseAction); });
addEventListener('blur',()=>{ for (const k in Input.down) Input.down[k]=false; Arsenal.trigger=false; UI.tabHeld=false; UI.scoreboard&&UI.scoreboard(false); });
addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); VM.cam.aspect=camera.aspect; VM.cam.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight,false); });

// Footsteps: emitted by the character animation at each foot contact (see PlayerChar.rig.onStep)
function footsteps(dt){}

// ---------- Main-menu backdrop: rooftop of Building D at sunset, selected character idle on the right ----------
const Menu = {
  rig:null, weapon:null, t:0, on:false,
  build(){
    if (this.rig) scene.remove(this.rig.root);
    this.rig=buildCharacter(CharLook); scene.add(this.rig.root);
    this.weapon=createWeapon(Loadout.firearm, WCustomSaved[Loadout.firearm]); this.rig.weaponSlot.add(this.weapon.model);
    const b=BUILDINGS.find(x=>x.id==='D')||BUILDINGS[0];
    this.base=new V3(b.x0+21.5, b.h, b.z0+6.3);   // clear patch of roof between the AC units and the parapet
    this.rig.root.position.copy(this.base); this.rig.root.rotation.y=-0.5+PI*0.92;   // facing the camera, slightly turned
    if (!this.key){ this.key=new THREE.PointLight('#ffd7a8',1.8,6,2); this.rim=new THREE.PointLight('#8fa8ff',1.6,8,1.5); scene.add(this.key,this.rim); }
    const yaw=-0.5, f=new V3(Math.sin(yaw),0,Math.cos(yaw)), r=new V3(f.z,0,-f.x);
    this.key.position.copy(this.base).addScaledVector(f,1.6).addScaledVector(r,2.0).add(new V3(0,2.0,0));
    this.rim.position.copy(this.base).addScaledVector(f,-1.8).addScaledVector(r,-1.2).add(new V3(0,2.2,0));
  },
  refresh(){ if (this.on||this.rig) this.build(); this.show(); },
  show(){ this.on=true; if (this.rig) this.rig.root.visible=true; if (this.key) this.key.visible=this.rim.visible=true; for (const b of Bots.list) if (b.rig) b.rig.root.visible=false; PlayerChar.rig && (PlayerChar.rig.root.visible=false); },
  hide(){ this.on=false; if (this.rig) this.rig.root.visible=false; if (this.key) this.key.visible=this.rim.visible=false; camera.clearViewOffset(); camera.updateProjectionMatrix(); },
  update(dt){
    const key=Loadout.firearm+JSON.stringify(CharLook)+JSON.stringify(WCustomSaved[Loadout.firearm]);
    if (!this.rig || this.key_!==key){ this.key_=key; this.build(); }
    if (!this.on) this.show();
    this.t+=dt;
    Env.t=Game.menuEnvT; Env.apply(dt, camera);            // fixed sunset light for the menu
    sun.position.copy(Env.sunDir).multiplyScalar(80);
    animateCharacter(this.rig,{speed:0,pitch:-0.05,hold:{weapon:this.weapon}},dt);
    // camera behind-left of the character, looking out over the block; character sits right of centre
    const yaw=-0.5, f=new V3(Math.sin(yaw),0,Math.cos(yaw)), rgt=new V3(f.z,0,-f.x);
    const sway=Math.sin(this.t*0.15)*0.25;
    camera.position.copy(this.base).addScaledVector(f,3.0).addScaledVector(rgt,1.1+sway).add(new V3(0,1.45,0));
    camera.fov=48; camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    camera.lookAt(this.base.clone().addScaledVector(rgt,-0.2).add(new V3(0,1.05,0)));
    // shift the projection so the character renders in the right third of the screen
    const W=innerWidth, H=innerHeight; camera.setViewOffset(W,H,-W*0.2,0,W,H);
  },
};
Game.menuEnvT = PERIOD_SECONDS*4.35;  // sunset
Game.gameEnvT = PERIOD_SECONDS*2;

// ---------- Main loop ----------
let last=performance.now(), fpsAcc=0, fpsN=0;
function loop(now){
  requestAnimationFrame(loop);
  const cap=Settings.fpsCap|0;
  if (cap>0 && now-last < 1000/cap - 1.5) return;      // FPS limiter
  const dt=Math.min(0.05,(now-last)/1000), rdt=Math.min(0.25,Math.max(0,(now-last)/1000)); last=now;   // rdt: real time, for timers that must be exact on slow frames
  const st=Game.state, inGame = st==='playing' || st==='pause' || st==='end' || st==='qload' || (st==='settings' && UI.settingsReturn==='pause');
  Ambience.update(dt, !inGame); Snd.updateListener(); if (inGame) Snd.updateSpace(dt);
  // the Armory / character screens always render their own isolated preview scene (never the game world), even when opened from a match
  if (inGame){
    if (Menu.on) Menu.hide();
    if (st==='playing'){
      Env.update(dt, camera);
      if (P.alive && !P.inCar && !P.riding){ const n=Math.ceil(dt/0.0167); for (let i=0;i<n;i++) stepPlayer(dt/n); }
      Rides.update(dt); Net.update(dt);
      updateLean(dt); updateSearch(dt); updateSmoking(rdt); updateUsing(rdt); Effects.update(rdt); footsteps(dt);
      updateHealth(dt);
      Arsenal.update(dt);
      Bots.update(dt); Mode.update(dt);
      Equip.update(dt); Pickups.update(dt); Pings.update(dt); Perks.update(rdt);
      for (const car of interactCars){ if (car.open!==car.target){ car.open=damp(car.open,car.target,8,dt); if (Math.abs(car.open-car.target)<0.005) car.open=car.target; car.pivot.rotation.y=car.yaw+car.open; } }
    } else if (st==='end'){ Bots.update(dt*0); }
    Corpses.update(st==='playing'||st==='end'?dt:0); Glass.update(dt); FX.update(dt); Smoke.update(dt); MuzzleFlash.update(dt); Casings.update(st==='playing'||st==='end'?dt:0);
    Rig.update(dt);
    PlayerChar.update(st==='playing'?dt:0);
    LaserBeam.update(); Flashlight.update();
    if (renderer.shadowMap.enabled){ const sx=Math.round(P.pos.x/4)*4, sz=Math.round(P.pos.z/4)*4; sun.target.position.set(sx,0,sz); sun.position.set(sx,0,sz).addScaledVector(Env.sunDir,80); sun.target.updateMatrixWorld(); }
    else sun.position.copy(Env.sunDir).multiplyScalar(80);
    const blur = Post.enabled() && st==='playing' ? Post.amount(dt) : 0;
    if (blur>0.01) Post.begin(); else renderer.setRenderTarget(null);
    if (Thermal.active()) Thermal.render(renderer); else renderer.render(scene,camera);
    const showVM = (Rig.mode==='first' || Rig.optic) && !Rig.scoped && !P.inCar && P.alive;
    if (showVM && (UI.scopeOverlay||0)<0.97){ VM.syncLights(hemi,sun); VM.update(dt,Arsenal,{speed:P.riding?0:P.speed,sprint:P.sprinting,grounded:P.grounded}); renderer.clearDepth(); renderer.render(VM.scene,VM.cam); }
    if (blur>0.01) Post.end(blur); else if (Post.enabled()){ Post.ensure(); }
    UI.updateHUD(dt);
  } else if (st==='char' || st==='loadout'){
    Stage.update(dt); renderer.setRenderTarget(null); renderer.clear(); Stage.render(renderer);
  } else {
    if (Game.state==='loading') return;      // assets still decoding
    Menu.update(dt);
    renderer.setRenderTarget(null); renderer.clear();
    renderer.render(scene,camera);
  }
  fpsAcc+=dt; fpsN++; if (fpsAcc>0.5){ $('#fps').textContent=Math.round(fpsN/fpsAcc)+' fps · '+Settings.quality.toUpperCase(); fpsAcc=0; fpsN=0; }
}

// ---------- Boot ----------
UI.show('loading');
setTimeout(()=>{
  mapInfo = buildMap(scene);
  skyGroup = skyline(scene);
  windowMats.push(M.towerUp, M.lowUp);
  groundPhong = new THREE.MeshPhongMaterial({map:mapInfo.gtex, color:'#ffffff', shininess:70, specular:'#3a3f46'});
  Env.init({scene, hemi, sun, windowMats, groundMat:mapInfo.groundMat,
    wetPhong(on){ const m=on?groundPhong:mapInfo.groundMat; if (mapInfo.ground.material!==m){ groundPhong.color.copy(mapInfo.groundMat.color); mapInfo.ground.material=m; } if (on) groundPhong.color.copy(mapInfo.groundMat.color); }});
  Env.t = PERIOD_SECONDS*2;
  bakeMinimap();
  VM.init(); FX.init(scene); Smoke.init(scene); MuzzleFlash.init(); Casings.init(); Stage.init(); Post.init(); LaserBeam.init(); Flashlight.init(scene); Thermal.init();
  { const pm=new THREE.PMREMGenerator(renderer), es=new THREE.Scene();
    const gt=canvasTex(8,64,(g,w,h)=>{ const gr=g.createLinearGradient(0,0,0,h); gr.addColorStop(0,'#cfd6de'); gr.addColorStop(0.48,'#8a8f96'); gr.addColorStop(0.52,'#4a4642'); gr.addColorStop(1,'#1c1a18'); g.fillStyle=gr; g.fillRect(0,0,w,h); },false);
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10,16,8), new THREE.MeshBasicMaterial({map:gt, side:THREE.BackSide})));
    const sb=new THREE.Mesh(new THREE.PlaneGeometry(6,3), new THREE.MeshBasicMaterial({color:'#ffffff', side:THREE.DoubleSide})); sb.position.set(0,6,-4); sb.lookAt(0,0,0); es.add(sb);
    const env=pm.fromScene(es,0.04).texture; scene.environment=env; VM.scene.environment=env; Stage.scene.environment=env; pm.dispose(); }
  Promise.all([loadAssets(), loadCharacterAsset(), loadBluntAsset(), loadNicAsset(), Rides.load(), OuterModels.load(scene)]).then(()=>{
    ProfileAuthority.load(); Dev.init();
    Mode.init();
    Bots.init();
    Rides.init(scene);
    Arsenal.reset();
    Game.applyCharacter();
    UI.init();
    Game.applyGfx();
    Rig.mode=Settings.camMode;
    Game.state='main'; Game.go('main');
    loadMusic();
    // browsers only allow audio after a click: start menu music on the first interaction
    const kick=()=>{ Snd.init(); if (Game.state!=='playing') Snd.playMusic('song_menu'); removeEventListener('pointerdown',kick,true); removeEventListener('keydown',kick,true); };
    addEventListener('pointerdown',kick,true); addEventListener('keydown',kick,true);
    window.__oblock={ProfileAuthority,PROG,Effects,useItem,Rides,Flashlight,Thermal,ZARules,MatchRules,SPAWN_POINTS,SPAWN_REPORT,OUTER_BUILDINGS,Dev,Net,Lobby,disposePreview,P,Arsenal,Bots,Env,Game,Rig,Input,Binds,stepPlayer,interact,colliders,ladders,vaults,interactCars,searchables,WCustom,WCustomSaved,weaponStats,Stage,Menu,UI,Pings,LaserBeam,setProne,Settings,VM,PlayerChar,camera,renderer,scene,mapInfo,Mode,BackpackAuthority,Match,Corpses,Pickups,Equip,Snd,Loadout,Post,startSlide,startSmoking,StreakAuthority,Perks,damagePlayer,CharAssets};
  }).catch(err=>{ $('#load-msg').textContent='Could not load assets: '+err; console.error(err); });
  requestAnimationFrame(loop);
}, 30);
