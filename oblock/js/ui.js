'use strict';
/* Menus, 3D preview stage (weapon inspection + character), loadout station, settings,
   in-game loadout, HUD, toasts and minimap. One visual system (see css/style.css). */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e=document.createElement(tag); if (cls) e.className=cls; if (html!==undefined) e.innerHTML=html; return e; };
// bounds of visible meshes only (hidden lasers / unused attachment parts must not affect framing)
function visibleBox(root){
  const box=new THREE.Box3(), tmp=new THREE.Box3(); root.updateMatrixWorld(true);
  (function walk(o){ if (!o.visible) return; if (o.isMesh && o.geometry){ if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp); } o.children.forEach(walk); })(root);
  return box;
}
const fmtTime = s => String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');

// =====================================================================
// Stage: renders weapon / character previews (only while those screens are open)
// =====================================================================
const Stage = {
  scene:null, cam:null, mode:'char', yaw:0.6, pitch:0.12, dist:1.6, tYaw:0.6, tPitch:0.12, tDist:1.6, drag:false, autoRot:true,
  charRig:null, weapon:null, wgroup:null, anims:[],
  init(){
    const s=this.scene=new THREE.Scene(); s.background=new THREE.Color('#111214'); s.fog=new THREE.Fog('#111214',7,16);
    s.add(new THREE.HemisphereLight('#e4e8ef','#3a332e',1.1));
    const key=new THREE.DirectionalLight('#fff1dc',1.35); key.position.set(2,4,3); s.add(key);
    const rim=new THREE.DirectionalLight('#b8c8ff',0.9); rim.position.set(-3,2,-3); s.add(rim);
    const fill=new THREE.DirectionalLight('#ffd6a0',0.25); fill.position.set(0,-2,2); s.add(fill);
    const plat=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.2,0.1,32), new THREE.MeshLambertMaterial({color:'#1d1f23'})); plat.position.y=-0.05; s.add(plat); this.plat=plat;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.12,0.012,4,48), new THREE.MeshBasicMaterial({color:'#d6ad4a'})); ring.rotation.x=PI/2; ring.position.y=0.005; s.add(ring); this.ring=ring;
    this.holder=new THREE.Group(); s.add(this.holder);
    this.cam=new THREE.PerspectiveCamera(30, innerWidth/innerHeight, 0.02, 50);
    const c=$('#game');
    c.addEventListener('pointerdown',e=>{ if (Game.state==='char'||Game.state==='loadout'){ this.drag=true; this.autoRot=false; this.idleT=0; this.lx=e.clientX; this.ly=e.clientY; this.viewBtn(null); } });
    addEventListener('pointerup',()=>{ this.drag=false; });
    addEventListener('pointermove',e=>{ if (!this.drag) return; this.tYaw-=(e.clientX-this.lx)*0.01; if (this.mode==='weapon') this.tPitch=clamp(this.tPitch+(e.clientY-this.ly)*0.008,-1.45,1.45); this.lx=e.clientX; this.ly=e.clientY; });
    c.addEventListener('wheel',e=>{ if (Game.state==='loadout'){ this.tDist=clamp(this.tDist*(e.deltaY>0?1.12:0.89),0.7,4); } },{passive:true});
  },
  showCharacter(){
    this.mode='char'; this.clear(); this.plat.visible=this.ring.visible=true;
    const rig=buildCharacter(CharLook); this.charRig=rig; this.holder.add(rig.root);
    const w=createWeapon(Loadout.firearm); rig.weaponSlot.add(w.model); this.weapon=w;
    this.tYaw=this.yaw=0.5; this.tPitch=this.pitch=0.08; this.tDist=this.dist=5.2; this.autoRot=true; this.idleT=0; this.viewBtn('auto');
  },
  showWeapon(id){
    this.mode='weapon'; this.clear(); this.plat.visible=this.ring.visible=false;
    const w=createWeapon(id); this.weapon=w;
    const g=new THREE.Group(); g.add(w.model); this.holder.add(g);
    // fit using the stock silhouette so attachments don't shift the framing
    const box=visibleBox(w.model), c=box.getCenter(new V3()), sz=box.getSize(new V3());
    w.model.position.sub(c); g.scale.setScalar(1/Math.max(sz.x,sz.y,sz.z)); g.position.y=0;
    this.wgroup=g; this.autoRot=false;
    if (this.lastWeapon!==id){ this.view('right', true); this.lastWeapon=id; }
  },
  // inspection presets
  view(name, instant){
    const V={left:[-PI/2,0.05], right:[PI/2,0.05], front:[PI,0.05], rear:[0,0.05], top:[PI/2,1.4], angled:[0.9,0.35]}[name]||[PI/2,0.05];
    this.tYaw=V[0]; this.tPitch=V[1]; this.tDist=name==='front'||name==='rear'?1.9:2.9; this.autoRot=false;
    if (instant){ this.yaw=this.tYaw; this.pitch=this.tPitch; this.dist=this.tDist; }
  },
  clear(){ while (this.holder.children.length){ const o=this.holder.children[0]; this.holder.remove(o); disposePreview(o); } this.charRig=null; this.weapon=null; this.wgroup=null; this.anims=[]; },
  // attachment install / removal animation: the part slides along its mounting axis
  partFor(w, key){
    if (!key) return null; const A=ATTACHMENTS[key];
    if (w.id==='glock') return A.part ? w.parts[A.part] : null;
    return (w.parts.att||{})[key] || null;
  },
  slideVec(cat){ return {optic:new V3(0,0.12,0), under:new V3(0,-0.12,0), stock:new V3(0,0,0.16), muzzle:new V3(0,0,-0.18), other:new V3(0.12,0,0), mag:new V3(0,-0.14,0)}[cat]||new V3(0,0.1,0); },
  animPart(part, cat, dir, done){
    if (!part){ done&&done(); return; }
    const w=this.weapon, v=this.slideVec(cat);
    const a=part.parent.worldToLocal(w.model.localToWorld(v.clone())), b=part.parent.worldToLocal(w.model.localToWorld(new V3()));
    const off=a.sub(b); if (part.userData.home===undefined) part.userData.home=part.position.clone();
    part.visible=true;
    this.anims=this.anims.filter(x=>x.part!==part);
    this.anims.push({part, off, t:0, dur:dir>0?0.32:0.2, dir, done});
  },
  // character inspection presets (front / side / back) — the model faces +Z in preview space after the holder yaw
  charView(v){ if (v==='auto'){ this.autoRot=true; this.viewBtn('auto'); return; }
    const Y={front:PI, side:PI/2, back:0}[v]; let d=((Y-this.tYaw)%(2*PI)+3*PI)%(2*PI)-PI; this.tYaw+=d; this.autoRot=false; this.idleT=-1e9; this.viewBtn(v); },
  viewBtn(v){ document.querySelectorAll('#char-views button').forEach(b=>b.classList.toggle('on',b.dataset.v===v)); },
  update(dt){
    // drag: auto-rotation resumes after 4 s without interaction (a picked view preset stays until changed)
    if (this.mode==='char' && !this.autoRot && !this.drag){ this.idleT=(this.idleT||0)+dt; if (this.idleT>4){ this.autoRot=true; this.viewBtn('auto'); } }
    if (this.autoRot && this.mode==='char') this.tYaw+=dt*0.35;
    const k=1-Math.exp(-10*dt);
    this.yaw+=(this.tYaw-this.yaw)*k; this.pitch+=(this.tPitch-this.pitch)*k; this.dist+=(this.tDist-this.dist)*k;
    for (const a of this.anims){ a.t+=dt; const u=Math.min(1,a.t/a.dur), e=a.dir>0 ? 1-(1-u)*(1-u)*(1-u) : u*u;
      const f = a.dir>0 ? 1-e : e; a.part.position.copy(a.part.userData.home).addScaledVector(a.off, f);
      if (u>=1){ a.part.position.copy(a.part.userData.home); a.fin=true; if (a.done) a.done(); } }
    this.anims=this.anims.filter(a=>!a.fin);
    if (this.charRig){ animateCharacter(this.charRig,{speed:0,pitch:-0.08,hold:{weapon:this.weapon}},dt); }
    if (this.mode==='char'){ this.holder.rotation.y=this.yaw; const d=this.dist; this.cam.position.set(0,1.1+this.pitch*2,d); this.cam.lookAt(0,0.92,0); }
    else { const d=this.dist*(this.fitK||1), cp=Math.cos(this.pitch); this.cam.position.set(Math.sin(this.yaw)*cp*d, Math.sin(this.pitch)*d, Math.cos(this.yaw)*cp*d); this.cam.lookAt(0,0,0); this.holder.rotation.y=0; }
  },
  // centre the preview in the middle column
  render(r){
    const mid=document.querySelector('#scr-'+Game.state+' .col.mid'), W=innerWidth, H=innerHeight;
    this.cam.aspect=W/H;
    if (mid){ const R=mid.getBoundingClientRect(); let cy=R.top+R.height/2;
      if (this.mode==='weapon'){
        // fit the weapon into the free area between the title block and the view buttons / stats panel
        const top=R.top+125, bot=R.bottom-255; cy=(top+bot)/2;
        const avail=Math.max(120, Math.min(R.width*0.66, (bot-top)/0.95));
        this.fitK = H/(2*Math.tan(15*PI/180)*avail) / 2.9;
      }
      this.cam.setViewOffset(W,H,W/2-(R.left+R.width/2),H/2-cy,W,H); }
    else this.cam.clearViewOffset();
    this.cam.updateProjectionMatrix(); r.render(this.scene,this.cam);
  },
};

// Free GPU memory for preview copies. Geometry that belongs to the imported assets is shared with the game and is kept;
// everything the preview created itself (cloned materials, procedural attachment / character geometry) is disposed.
let _sharedGeo=null;
function sharedGeometry(){
  if (_sharedGeo) return _sharedGeo; _sharedGeo=new Set();
  const add=o=>o&&o.traverse(x=>{ if (x.geometry) _sharedGeo.add(x.geometry); });
  for (const k in Assets) add(Assets[k]); for (const k in CharAssets) add(CharAssets[k].scene); add(BluntAsset); add(NicAsset);
  return _sharedGeo;
}
function disposePreview(root){
  const shared=sharedGeometry(), mats=new Set();
  root.traverse(o=>{ if (o.geometry && !shared.has(o.geometry) && !o.geometry.userData.keep) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m=>mats.add(m)); });
  for (const m of mats){ if (m.userData && m.userData.keep) continue; m.dispose(); }
}

// =====================================================================
// Screens
// =====================================================================
// which interface sound a button makes (buy buttons play buy / deny from the purchase result instead)
function uiSoundFor(b){
  if (b.dataset.sfx) return b.dataset.sfx==='none' ? null : b.dataset.sfx;
  if (b.disabled) return 'deny';
  const id=b.id||'';
  if (/-back$|^on-back$|^btn-quit$/.test(id)) return 'back';
  if (/buy/.test(id)) return null;
  if (id==='br-start' || id==='end-again' || id==='char-confirm' || id==='lo-save') return 'confirm';
  if (b.closest('#char-list')) return 'char';
  if (b.closest('#lo-weapons') || b.closest('.wpick') || b.dataset.w) return 'weapon';
  if (b.closest('#mainnav') || /^btn-p/.test(id)) return 'open';
  if (b.closest('.seg') || b.closest('.chips') || b.closest('.tabs') || b.closest('#lo-tabs') || b.classList.contains('chip')) return 'select';
  return 'click';
}
const UI = {
  screens:['main','char','loadout','settings','pause','loading','end','qload','online'],
  show(name){
    for (const s of this.screens){ const e=$('#scr-'+s); if (!e) continue; const on=s===name; if (on && e.style.display!=='flex' && e.style.display!=='grid'){ e.classList.remove('enter'); void e.offsetWidth; e.classList.add('enter'); }
      e.style.display = on ? (e.classList.contains('cols3')?'grid':'flex') : 'none'; }
    $('#hud').style.display = (name===null) ? 'block' : 'none';
  },
  init(){
    // hover + click sounds on every menu button, and double-click protection
    document.addEventListener('mouseover',e=>{ const b=e.target.closest&&e.target.closest('button'); if (b && b!==this._hov && !b.disabled && Game.state!=='playing'){ this._hov=b; Snd.hover(); } });
    document.addEventListener('click',e=>{ const b=e.target.closest&&e.target.closest('button'); if (b && Game.state!=='playing'){ Snd.init(); const k=uiSoundFor(b); if (k) Snd.uiSfx(k); } }, true);
    $('#btn-play').onclick=()=>this.brief('dm');
    document.querySelectorAll('#char-views button').forEach(b=>b.onclick=()=>Stage.charView(b.dataset.v));
    $('#btn-guide').onclick=()=>{ const g=$('#guide'), on=!g.classList.contains('on'); g.classList.toggle('on',on); $('#btn-guide').classList.toggle('on',on); };
    $('#btn-backpack').onclick=()=>this.brief('backpack');
    $('#btn-online').onclick=()=>{ Game.go('online'); Lobby.open(); };
    $('#on-back').onclick=()=>{ Lobby.leave(); Game.go('main'); };
    $('#btn-char').onclick=()=>Game.go('char');
    $('#btn-loadout').onclick=()=>Game.go('loadout','main');
    $('#btn-settings').onclick=()=>Game.go('settings','main');
    $('#btn-resume').onclick=()=>Game.resume();
    // FULLSCREEN / EXIT FULLSCREEN: one big button on the main menu, one in the pause menu; both labels follow the real
    // state (also when Esc leaves fullscreen)
    { const fsEl=()=>document.fullscreenElement||document.webkitFullscreenElement;
      const label=()=>{ const on=!!fsEl(); $('#btn-pfull').textContent = on ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
        $('#btn-full b').textContent = on ? 'EXIT FULLSCREEN' : 'FULLSCREEN'; $('#btn-full small').textContent = on ? 'BACK TO THE BROWSER WINDOW' : 'FILL THE WHOLE SCREEN'; };
      const toggle=async()=>{ try{
          if (fsEl()) await (document.exitFullscreen||document.webkitExitFullscreen).call(document);
          else { const el=document.documentElement, req=el.requestFullscreen||el.webkitRequestFullscreen; if (!req) throw new Error('unsupported'); await req.call(el); }
        } catch(e){ this.toast('FULLSCREEN IS BLOCKED HERE · OPEN THE GAME IN ITS OWN TAB','warn'); } label(); };
      $('#btn-pfull').onclick=toggle; $('#btn-full').onclick=toggle;
      document.addEventListener('fullscreenchange',label); document.addEventListener('webkitfullscreenchange',label); label(); }
    $('#btn-ploadout').onclick=()=>Game.go('qload');
    $('#btn-psettings').onclick=()=>Game.go('settings','pause');
    Bus.on('devtag',()=>{ this.menuInfo(); PlayerChar.updateTag&&PlayerChar.updateTag(); if (Net.connected) Net.send({t:'tag', dev:Dev.showTag()}); });
    $('#btn-pcam').onclick=()=>{ Rig.toggle(); this.camButtons(); };
    $('#camBtn').onclick=e=>{ e.stopPropagation(); Rig.toggle(); this.camButtons(); };
    $('#btn-quit').onclick=()=>Game.toMenu();
    $('#end-again').onclick=()=>{ if (Net.inMatch){ Game.toMenu(); return; } Game.startMatch(Mode.cur); };
    $('#end-menu').onclick=()=>Game.toMenu();
    $('#ql-close').onclick=()=>Game.go('pause');
    $('#ql-apply').onclick=()=>{ Loadout.firearm=this.qlPick||Loadout.firearm; saveLoadout(); Arsenal.setFirearm(Mode.allowedFirearm(Loadout.firearm)); this.toast('LOADOUT UPDATED','ok'); Game.resume(); };
    this.initLoadout(); this.buildChar(); this.camButtons(); this.menuInfo();
    Bus.on('kill',k=>{ this.killfeed(`<b>YOU</b> <span>[${k.weapon}${k.head?' · HEADSHOT':''}]</span> <em>${k.victim}</em>`); this.toast((k.head?'HEADSHOT · ':'')+'ELIMINATED '+k.victim,'kill'); });
    Bus.on('killfeed',k=>this.killfeed(`<em>${k.killer}</em> <span>[${k.weapon}]</span> ${k.victim==='YOU'?'<b>YOU</b>':'<em>'+k.victim+'</em>'}`));
    Bus.on('hit',h=>this.hitmarker(h)); Bus.on('hurt',h=>this.hurt(h));
    Bus.on('died',by=>{ $('#death-by').textContent='Eliminated by '+by; const R=roomRules(); $('#death .sm').textContent = R ? (R.respawnOn ? 'Respawning in '+R.respawnDelay+' s…' : 'No respawns in this room · spectating until the match ends') : 'Respawning…'; $('#death').style.display='flex'; });
    Bus.on('respawn',()=>{ $('#death').style.display='none'; });
    Bus.on('weather',on=>this.toast(on?'RAIN ROLLING IN':'THE RAIN HAS STOPPED',''));
    Bus.on('notice',t=>this.toast(t,''));
    Bus.on('toast',o=>this.toast(o.t,o.kind));
    Bus.on('firemode',a=>this.toast(a?'GLOCK · SWITCH (FULL AUTO)':'GLOCK · SEMI-AUTO','warn'));
    Bus.on('cammode',()=>this.camButtons());
    Bus.on('loot',l=>{ const f=l.found||[]; if (!f.length){ this.toast('NOTHING IN THIS TRUNK',''); return; }
      const nm={beer:'BEER',blunt:'BLUNT',zyn:'ZYN',ammo:'AMMO'}; const got=f.filter(x=>!x.endsWith('-full')).map(x=>nm[x]), full=f.filter(x=>x.endsWith('-full')).map(x=>nm[x.slice(0,-5)]);
      if (got.length) this.toast('FOUND '+got.join(' + '),'ok'); if (full.length) this.toast(full.join(', ')+' FULL',''); });
    Bus.on('carhop',n=>this.toast(n>0?'FOUND '+fmtCash(n)+' IN THE CAR':'NOTHING IN THIS CAR', n>0?'ok':''));
    Bus.on('xp',e=>this.xpPop('+'+e.n+' XP'+(e.why?' · '+e.why:''),'')); Bus.on('cash',e=>this.xpPop('+'+fmtCash(e.n),'c'));
    Bus.on('levelup',l=>{ this.levelBanner('LEVEL '+l, 'LEVEL UP'); Snd.levelUp&&Snd.levelUp(); });
    Bus.on('profile',()=>{ this.menuInfo(); });
    Bus.on('pickup',p=>this.toast('+'+p.add+' '+p.weapon+' AMMO','ok'));
    Bus.on('healed',()=>this.toast('+30 HEALTH · MAX HEALTH +20% UNTIL DEATH','ok'));
    Bus.on('matchEnd',name=>Game.showEnd(name));
  },
  camButtons(){ const t=Rig.mode==='first'?'1ST PERSON':'3RD PERSON'; $('#camBtn').textContent='CAMERA · '+t; $('#btn-pcam').textContent='CAMERA: '+t; },
  // ----- main menu: control guide (from the live bindings) + player information -----
  menuInfo(){
    { const sm=document.querySelector('#btn-play .rules'); if (sm) sm.textContent=rulesText(); }
    const K=c=>`<kbd>${Input.label(c)}</kbd>`;
    const G={Movement:[['forward','back','left','right','Move'],['sprint','Sprint'],['jump','Jump/vault'],['crouch','Crouch'],['slide','Slide'],['prone','Prone'],['leanL','leanR','Lean']],
             Combat:[['fire','Shoot'],['aim','Aim'],['reload','Reload'],['firearm','knife','Weapons'],['firemode','Switch'],['grenade','Flash'],['mine','Mine']],
             Interaction:[['interact','Interact / ride'],['smoke','Blunt'],['beer','Beer'],['zyn','Zyn'],['nic','Nic'],['ability','Ability'],['flashlight','Flashlight'],['thermal','Thermal']],
             Interface:[['camera','Camera'],['scoreboard','Scores'],['loadout','Loadout'],['pause','Pause']]};
    $('#guide').innerHTML=Object.entries(G).map(([g,rows])=>`<div class="g"><b>${g.toUpperCase()}</b>${rows.map(r=>r.slice(0,-1).map(a=>K(Binds[a])).join('')+' '+r[r.length-1]).join('<br>')}</div>`).join('');
    const fa=Arsenal.usable?Arsenal.usable(Loadout.firearm):Loadout.firearm, n=attachmentCount(fa);
    $('#pinfo').innerHTML=`${Dev.showTag()?'<span class="devtag">DEV</span><br>':''}<b>${(Settings.name||'PLAYER').toUpperCase()}</b><br>${CHARACTERS[CharLook.char].name} · ${CharLook.jacket} / ${CharLook.pants}<br>${WEAPON_DEFS[fa].name}${n?' · '+n+' attachment'+(n>1?'s':''):''} + Knife<br><span class="off">● ${Net.connected?'ONLINE · '+Net.url:'OFFLINE — online play needs the O-Block server'}</span><br><span class="ver">${GAME_VERSION}</span>`;
    if (ProfileAuthority.s){ const pr=ProfileAuthority.levelProgress(), c=ProfileAuthority.cash;
      const crown='<svg class="crown" viewBox="0 0 64 40"><path d="M4 34 7 8l13 13L32 3l12 18L57 8l3 26z" fill="currentColor"/><rect x="5" y="35" width="54" height="4" rx="2" fill="currentColor"/></svg>';
      const bill='<svg viewBox="0 0 30 22"><rect x="3" y="5" width="26" height="15" rx="2" fill="#2f8a3b" stroke="#123d18"/><rect x="1" y="2" width="26" height="15" rx="2" fill="#4cc25a" stroke="#1a5a22"/><circle cx="14" cy="9.5" r="4" fill="#2f8a3b"/><text x="14" y="12.3" font-size="7" font-weight="700" text-anchor="middle" fill="#bff0c4">$</text></svg>';
      $('#mprof').innerHTML=`${crown}<div class="lvl"><b>LEVEL ${ProfileAuthority.level()}</b><small>${pr.cur.toLocaleString()} / ${pr.need.toLocaleString()} XP</small><div class="bar"><i style="width:${(pr.k*100).toFixed(1)}%"></i></div></div><i class="div"></i><div class="money">${bill}<span>${c===Infinity?'∞':fmtCash(c)}</span></div>`; }
  },
  // ----- mode briefing (real rules; no fabricated matchmaking) -----
  brief(mode){
    const b=$('#brief'); document.querySelectorAll('#mainnav button').forEach(x=>x.classList.remove('sel'));
    $(mode==='dm'?'#btn-play':'#btn-backpack').classList.add('sel');
    const dm=mode==='dm';
    b.className='panel '+(dm?'dm':'bp');
    b.innerHTML = `<div class="mt" style="color:${dm?'var(--gold)':'#ff6a5a'}">${dm?'DEATHMATCH':'THE FIGHT FOR ZA'}</div>
      <p>${dm?'Every player for themselves across O Block.':'A ziplock bag of za spawns somewhere in the courtyard (the spot changes every round). Grab it and hold it.'}</p>
      <h3>Objective</h3>
      <ul>${dm?'<li>Most kills wins. Set the kill limit and time limit below — whichever is reached first ends the match.</li><li>Respawn at the 15 safe spawn points away from enemies.</li>':(ZARules.variant==='classic'?'<li>Hold the bag for <b>'+ZARules.classicHold+' uninterrupted seconds</b>.</li>':'<li>Every second you carry the bag adds to your <b>hold time</b>. When the clock runs out, the longest total hold wins.</li>')+'<li>If the carrier dies the bag drops where they fell.</li><li>The HUD shows the timer, the carrier, everyone\'s hold time, the leader and where the bag is.</li>'}</ul>
      <h3>Rules</h3><ul>${dm?'<li>Your saved loadout: '+WEAPON_DEFS[Arsenal.usable(Loadout.firearm)].name+' + knife.</li><li>Glock Switch allowed (if you own it).</li>':'<li><b>Glock only</b>, <b>no Switch mode</b> — enforced by the match authority.</li><li>The carrier is marked on everyone\'s minimap.</li>'}</ul>
      <h3>Match settings <small>(you are the host · locked once the match starts)</small></h3><div id="${dm?'dm-setup':'za-setup'}"></div>
      <div class="mm">This is an offline match against labelled bots. To play with friends, use PRIVATE MATCH · ONLINE (needs the O-Block server).</div>
      <div class="btns"><button id="br-cancel">CANCEL</button><button id="br-start" class="primary">START MATCH</button></div>`;
    b.style.display='block';
    if (dm) this.buildDmSetup(); else this.buildZaSetup();
    $('#br-cancel').onclick=()=>{ b.style.display='none'; document.querySelectorAll('#mainnav button').forEach(x=>x.classList.remove('sel')); };
    $('#br-start').onclick=e=>{ const btn=e.currentTarget; if (btn.disabled) return; btn.disabled=true; btn.textContent='LOADING…'; setTimeout(()=>{ b.style.display='none'; Game.startMatch(mode); btn.disabled=false; },60); };
  },
  // ----- Deathmatch setup (host rules): time limit, kill limit, custom values, bots, difficulty, tie rule -----
  buildDmSetup(){
    const box=$('#dm-setup'); if (!box) return; box.innerHTML='';
    const R=MatchRules;
    const row=(label, opts, key, mul, custom)=>{
      const r=el('div','srow'); r.appendChild(el('label','',label)); const s=el('div','seg');
      const val=v=>typeof v==='number'?v*mul:v;
      for (const [v,t] of opts){ const b=el('button',R[key]===val(v)?'on':'',t); b.onclick=()=>{ R[key]=val(v); saveMatchRules(); this.buildDmSetup(); this.menuInfo(); }; s.appendChild(b); }
      if (custom){ const inp=el('input'); inp.type='number'; inp.min=1; inp.max=custom.max; inp.placeholder='custom'; inp.className='cust';
        if (R[key]>0 && !opts.some(o=>o[0]*mul===R[key])){ inp.value=R[key]/mul; inp.classList.add('on'); }
        inp.onchange=()=>{ const v=Math.round(+inp.value); if (v>=1 && v<=custom.max){ R[key]=v*mul; saveMatchRules(); this.buildDmSetup(); } }; s.appendChild(inp); }
      r.appendChild(s); box.appendChild(r); };
    row('Time limit',[[5,'5m'],[10,'10m'],[15,'15m'],[20,'20m'],[30,'30m'],[0,'∞']],'time',60,{max:180});
    row('Kill limit',[[5,'5'],[10,'10'],[15,'15'],[20,'20'],[25,'25'],[30,'30'],[50,'50'],[0,'∞']],'kills',1,{max:500});
    row('Bots',[[0,'0'],[3,'3'],[5,'5'],[7,'7'],[9,'9'],[12,'12']],'bots',1,null);
    row('Bot difficulty',[['easy','Easy'],['normal','Normal'],['hard','Hard']],'difficulty',1,null);
    row('Tie on time-out',[['tie','Draw'],['deaths','Fewest deaths wins']],'tie',1,null);
    const sm=$('#btn-play .rules'); if (sm) sm.textContent=rulesText();
    box.appendChild(el('p','hint','Selected: '+rulesText()+' · '+R.bots+' bots · '+R.difficulty+(R.time===0&&R.kills===0?' · practice (no end condition)':'')));
  },
  // ----- THE FIGHT FOR ZA setup: variant, duration, bots, difficulty, spawn rule, objective respawn -----
  buildZaSetup(){
    const box=$('#za-setup'); if (!box) return; box.innerHTML=''; const R=ZARules;
    const row=(label, opts, key, mul=1)=>{ const r=el('div','srow'); r.appendChild(el('label','',label)); const sg=el('div','seg');
      for (const [v,t] of opts){ const val=typeof v==='number'?v*mul:v; const b=el('button',R[key]===val?'on':'',t); b.onclick=()=>{ R[key]=val; saveZARules(); this.brief('backpack'); }; sg.appendChild(b); }
      r.appendChild(sg); box.appendChild(r); };
    row('Win rule',[['hold','Most hold time'],['classic','Classic 30 s hold']],'variant');
    if (R.variant==='hold') row('Match length',[[3,'3m'],[5,'5m'],[8,'8m'],[10,'10m'],[15,'15m']],'time',60);
    else row('Hold needed',[[20,'20 s'],[30,'30 s'],[45,'45 s'],[60,'60 s']],'classicHold');
    row('Bots',[[0,'0'],[3,'3'],[5,'5'],[7,'7'],[9,'9'],[12,'12']],'bots');
    row('Bot difficulty',[['easy','Easy'],['normal','Normal'],['hard','Hard']],'difficulty');
    row('Spawns',[['all','All 15 points'],['far','Far from the bag']],'spawns');
    row('Dropped bag',[['drop','Stays where it fell'],['reset','Respawns after '+R.resetAfter+' s']],'respawn');
    
    box.appendChild(el('p','hint','Selected: '+zaRulesText()+' · '+R.bots+' bots · '+R.difficulty));
  },
  // ----- character screen -----
  buildChar(){
    const saved=Store.get('look',{}).char||'tracksuit';
    $('#char-list').innerHTML='';
    for (const id of CHAR_ORDER){ const C=CHARACTERS[id], own=ProfileAuthority.ownsChar(id);
      const b=el('button','card'+(CharLook.char===id?' on':'')+(own?'':' locked'),`<b>${C.name}</b><small>${saved===id?'Selected':own?(C.price?'Owned':'Free'):'<span class="lock">'+fmtCash(C.price)+'</span>'}${C.ability?' · ability':''}</small>`);
      b.onclick=()=>{ if (CharLook.char===id) return; CharLook.char=id; Object.assign(CharLook, C.defaults, Store.get('look_'+id,{})); Stage.showCharacter(); this.buildChar(); $('#char-status').textContent='Not saved — press CONFIRM SELECTION'; };
      $('#char-list').appendChild(b); }
    const C=CHARACTERS[CharLook.char], own=ProfileAuthority.ownsChar(CharLook.char), AB=CHAR_ABILITIES[CharLook.char];
    $('#char-info').innerHTML=`<div class="big">${C.name}</div>${saved===CharLook.char?'<span class="sel">SELECTED</span>':''}${own?(C.price?'<span class="own">OWNED</span>':''):'<span class="lock">LOCKED · '+fmtCash(C.price)+'</span>'}
      <dl><dt>Outfit</dt><dd>${C.desc}</dd><dt>Rig</dt><dd>22 body bones + 30 finger bones</dd><dt>Clips</dt><dd>Idle, Walk (imported) · run / sprint blended from the walk, crouch, slide, vault, prone (procedural on the rig) · physics ragdoll</dd>
      <dt>Kill streak</dt><dd>5 kills: +1 NIC (all characters)</dd>
      <dt>Ability · ${Input.label(Binds.ability)}</dt><dd>${AB?'<b style="color:#ff6a5a">'+AB.name+'</b> — '+(AB.hpMul?'max health ×'+AB.hpMul:'firearm and melee damage ×'+AB.dmgMul)+' until you die':'None'}</dd>
      ${AB?`<dt>Unlock</dt><dd>${AB.at}-kill streak (kills in a row without dying), then press ${Input.label(Binds.ability)} to activate. Dying resets the streak.</dd>`:''}</dl>
      ${own?'':`<div class="buybox"><b>BUY ${C.name} · ${fmtCash(C.price)}</b><p>You have ${ProfileAuthority.cash===Infinity?'unlimited cash':fmtCash(ProfileAuthority.cash)}. Ownership is saved to your profile.</p><button id="char-buy" class="primary">BUY</button></div>`}`;
    const cb=$('#char-buy'); if (cb) cb.onclick=()=>{ const r=ProfileAuthority.buy(CharLook.char); if (r.ok){ this.toast(C.name+' UNLOCKED','ok'); Snd.uiSfx('buy'); } else { this.toast('CAN\'T BUY: '+r.why.toUpperCase(),'warn'); Snd.uiSfx('deny'); } this.buildChar(); };
    const box=$('#char-opts'); box.innerHTML='';
    for (const [key,label,list] of [['jacket','Jacket colour',JACKET_COLORS],['pants','Pants colour',PANTS_COLORS]]){
      const grp=el('div','opt'); grp.appendChild(el('label','',label)); const chips=el('div','chips');
      for (const [n,c] of list){ const b=el('button','chip'+(CharLook[key]===n?' on':''),`<i style="background:${c}"></i>${n}`);
        b.onclick=()=>{ CharLook[key]=n; chips.querySelectorAll('.chip').forEach(x=>x.classList.remove('on')); b.classList.add('on'); if (Stage.charRig) setLookColors(Stage.charRig, CharLook); $('#char-status').textContent='Not saved — press CONFIRM SELECTION'; };
        chips.appendChild(b); }
      grp.appendChild(chips); box.appendChild(grp);
    }
    $('#char-confirm').disabled=!own; $('#char-confirm').textContent=own?'CONFIRM SELECTION':'LOCKED';
    $('#char-confirm').onclick=()=>{ if (!ProfileAuthority.ownsChar(CharLook.char)) return; saveLook(); Store.set('look_'+CharLook.char,{jacket:CharLook.jacket,pants:CharLook.pants}); Game.applyCharacter(); $('#char-status').textContent='Saved'; this.menuInfo(); this.buildChar(); };
    $('#char-back').onclick=()=>{ Object.assign(CharLook, {char:'tracksuit',jacket:'Black',pants:'Black'}, Store.get('look',{})); if (!ProfileAuthority.ownsChar(CharLook.char)) CharLook.char='tracksuit'; this.buildChar(); Game.go('main'); };
  },
  // =================================================================
  // LOADOUT STATION
  // =================================================================
  lo:{sel:'drako', tab:'att', slot:null, pick:null},
  initLoadout(){
    $('#lo-back').onclick=()=>{ if (this.loDirty()){ this.revertCustom(); this.toast('UNSAVED CHANGES DISCARDED',''); } Game.go(this.loadoutReturn||'main'); };
    $('#lo-save').onclick=()=>{ saveLoadout(); saveWCustom(); Game.refreshWeapons(); this.loStatus('Loadout saved'); this.menuInfo(); this.renderLoadout(); };
    $('#lo-reset').onclick=()=>{ const id=this.lo.sel; Object.assign(WCustom[id].att, JSON.parse(JSON.stringify(WCustomSaved[id].att))); this.rebuildPreview(); this.loStatus('Attachments reset to the saved setup'); };
    $('#lo-clear').onclick=()=>{ const id=this.lo.sel; for (const s of WEAPON_SLOTS[id]) WCustom[id].att[s]=SLOT_DEFAULT[s]||null; this.rebuildPreview(); this.loStatus('All attachments removed (not saved yet)'); };
    document.querySelectorAll('#lo-tabs button').forEach(b=>b.onclick=()=>{ this.lo.tab=b.dataset.t; document.querySelectorAll('#lo-tabs button').forEach(x=>x.classList.toggle('on',x===b)); this.renderLoadout(); });
    $('#lo-views').innerHTML=['left','right','front','rear','top','angled'].map(v=>`<button data-v="${v}">${v.toUpperCase()}</button>`).join('')+'<span class="zh">Drag to rotate · Scroll to zoom</span>';
    $('#lo-views').querySelectorAll('button').forEach(b=>b.onclick=()=>Stage.view(b.dataset.v));
  },
  loDirty(){ return JSON.stringify(WCustom)!==JSON.stringify(WCustomSaved) || JSON.stringify(Loadout)!==JSON.stringify(Object.assign({},DEFAULT_LOADOUT,Store.get('loadout2',{}))); },
  revertCustom(){ for (const id of WEAPON_ORDER){ Object.assign(WCustom[id].att, JSON.parse(JSON.stringify(WCustomSaved[id].att))); Object.assign(WCustom[id].paint, JSON.parse(JSON.stringify(WCustomSaved[id].paint))); }
    Object.assign(Loadout, DEFAULT_LOADOUT, Store.get('loadout2',{})); Game.refreshWeapons(); },
  loStatus(t){ $('#lo-status').textContent=t; clearTimeout(this._lst); this._lst=setTimeout(()=>{ $('#lo-status').textContent=this.loDirty()?'Unsaved changes':''; },2500); },
  openLoadout(){ if (!this.thumbs) this.makeThumbs(); this.lo.sel=Loadout.firearm; this.lo.slot=null; this.lo.pick=null; Stage.showWeapon(this.lo.sel); this.renderLoadout(); },
  // small renders of each weapon for the list
  makeThumbs(){
    this.thumbs={}; const r=renderer, rt=new THREE.WebGLRenderTarget(256,144), sc=new THREE.Scene(); sc.add(new THREE.HemisphereLight('#fff','#666',1.5)); const dl=new THREE.DirectionalLight('#fff',1.3); dl.position.set(1,2,2); sc.add(dl); sc.environment=Stage.scene.environment;
    const cam=new THREE.PerspectiveCamera(22,256/144,0.01,20), buf=new Uint8Array(256*144*4), cv=document.createElement('canvas'); cv.width=256; cv.height=144; const g=cv.getContext('2d');
    for (const id of WEAPON_ORDER){
      const w=createWeapon(id), grp=new THREE.Group(); grp.add(w.model); sc.add(grp);
      const box=visibleBox(w.model), c=box.getCenter(new V3()), sz=box.getSize(new V3()); w.model.position.sub(c); grp.scale.setScalar(1/Math.max(sz.x,sz.y,sz.z));
      cam.position.set(2.9,0.25,0); cam.lookAt(0,0,0);
      r.setRenderTarget(rt); r.setClearColor('#000000',0); r.clear(); r.render(sc,cam); r.readRenderTargetPixels(rt,0,0,256,144,buf); r.setRenderTarget(null); r.setClearColor('#000000',1);
      const img=g.createImageData(256,144); for (let y=0;y<144;y++) img.data.set(buf.subarray((143-y)*256*4,(144-y)*256*4), y*256*4); g.putImageData(img,0,0);
      this.thumbs[id]=cv.toDataURL(); sc.remove(grp); disposePreview(grp);
    }
    rt.dispose();
  },
  rebuildPreview(changedSlot, prevKey){
    const id=this.lo.sel, w=Stage.weapon;
    if (w && w.id===id && changedSlot){
      const cat=changedSlot, newKey=WCustom[id].att[cat];
      const oldPart=Stage.partFor(w, prevKey), newPart=Stage.partFor(w, newKey);
      const finish=()=>{ applyWeaponConfig(w); if (newPart && newPart!==oldPart){ newPart.visible=true; Stage.animPart(newPart, cat, 1); } Snd.install(); };
      if (oldPart && oldPart!==newPart && prevKey!==SLOT_DEFAULT[cat]) Stage.animPart(oldPart, cat, -1, finish); else finish();
    } else if (w && w.id===id){ applyWeaponConfig(w); } else Stage.showWeapon(id);
    this.renderLoadout();
  },
  renderLoadout(){
    const L=this.lo, id=L.sel;
    // ---- left: weapons
    const list=$('#lo-weapons'); list.innerHTML='';
    for (const wid of WEAPON_ORDER){
      const isFire=wid!=='knife', eq = isFire ? Loadout.firearm===wid : true, n=attachmentCount(wid), ok=ProfileAuthority.canUse(wid), pr=ProfileAuthority.price(wid);
      const b=el('button','wcard'+(L.sel===wid?' on':'')+(ok?'':' locked'), `<img src="${(this.thumbs||{})[wid]||''}" alt=""><div><b>${WEAPON_DEFS[wid].name}</b><small>${WEAPON_CATEGORY[wid]}${isFire?' · '+n+' attachment'+(n===1?'':'s'):''}${isFire&&!ok&&pr?' · '+fmtCash(pr):''}</small><span class="eq ${eq&&ok?'':'no'}">${!ok?'LOCKED · BUY FOR '+fmtCash(pr):isFire?(eq?'EQUIPPED FIREARM':'NOT EQUIPPED'):'ALWAYS CARRIED'}</span></div>`);
      b.onclick=()=>{ L.sel=wid; L.slot=null; L.pick=null; Stage.showWeapon(wid); this.renderLoadout(); };
      list.appendChild(b);
    }
    // equipment budget
    const eqb=$('#lo-equip'); eqb.innerHTML='<h3>Equipment · '+EQUIP_BUDGET+' total</h3>';
    for (const [k,label,act] of [['flash','Flash grenades','grenade'],['mine','Landmines','mine']]){
      const r=el('div','srow'); r.appendChild(el('label','',label+'<small>'+Input.label(Binds[act])+'</small>'));
      const s=el('div','seg'), other=k==='flash'?'mine':'flash';
      for (let n=0;n<=EQUIP_BUDGET;n++){ const bb=el('button',Loadout[k]===n?'on':'',String(n)); bb.disabled=n+Loadout[other]>EQUIP_BUDGET; bb.onclick=()=>{ Loadout[k]=n; this.loStatus('Unsaved changes'); this.renderLoadout(); }; s.appendChild(bb); }
      r.appendChild(s); eqb.appendChild(r);
    }
    // ---- centre header
    const isFire=id!=='knife';
    const okW=ProfileAuthority.canUse(id), prW=ProfileAuthority.price(id), haveC=ProfileAuthority.cash;
    $('#lo-head').innerHTML=`<div class="wn">${WEAPON_DEFS[id].name}${okW?'':' <span class="lock">'+fmtCash(prW)+'</span>'}</div><div class="wc">${WEAPON_CATEGORY[id]}</div>`+
      (isFire ? (!okW ? `<button class="toggle primary" id="lo-buyw" data-sfx="none">BUY ${WEAPON_DEFS[id].name.toUpperCase()} · ${fmtCash(prW)} (YOU HAVE ${haveC===Infinity?'∞':fmtCash(haveC)})</button>` : Loadout.firearm===id ? '<button class="toggle on" disabled>✓ EQUIPPED FIREARM</button>' : '<button class="toggle" id="lo-equipbtn">EQUIP AS FIREARM</button>') : '');
    let swBox='';
    if (id==='glock'){ const own=ProfileAuthority.owns('switch');
      swBox=(own ? `<div class="buybox"><b>GLOCK SWITCH · OWNED</b><p>Full auto (${GLOCK_SWITCH_RPM} rpm) with 15% less accuracy. Toggle in a match with ${Input.label(Binds.firemode)}.</p></div>`
        : `<div class="buybox"><b>GLOCK SWITCH · ${fmtCash(PROG.price.switch)}</b><p>Full auto (${GLOCK_SWITCH_RPM} rpm), 15% less accuracy. You have ${ProfileAuthority.cash===Infinity?'unlimited cash':fmtCash(ProfileAuthority.cash)}.</p><button class="primary" id="lo-buysw">BUY SWITCH</button></div>`); }
    { const bw=$('#lo-buyw'); if (bw) bw.onclick=()=>this.buyItem(id, WEAPON_DEFS[id].name, ()=>{ Loadout.firearm=id; this.loStatus(WEAPON_DEFS[id].name+' bought and equipped (not saved yet)'); }); }
    const eb=$('#lo-equipbtn'); if (eb) eb.onclick=()=>{ if (!ProfileAuthority.canUse(id)) return; Loadout.firearm=id; this.loStatus('Firearm changed (not saved yet)'); this.renderLoadout(); };
    this.renderStats();
    // ---- right: attachments or paint
    const slots=$('#lo-slots'), cards=$('#lo-cards'), det=$('#lo-detail'); slots.innerHTML=swBox; cards.innerHTML=''; det.innerHTML='';
    { const bs=$('#lo-buysw'); if (bs) bs.onclick=()=>{ const r=ProfileAuthority.buy('switch'); if (r.ok){ this.toast('GLOCK SWITCH UNLOCKED','ok'); Snd.uiSfx('buy'); } else { this.toast('CAN\'T BUY: '+r.why.toUpperCase(),'warn'); Snd.uiSfx('deny'); } this.renderLoadout(); }; }
    if (L.tab==='paint'){
      for (const p of PAINT[id]){
        const grp=el('div','opt'); grp.appendChild(el('label','',p.label)); const chips=el('div','chips');
        for (const [n,v] of p.opts){ const sw = typeof v==='string' ? `<i style="background:${v==='#ffffff'&&p.key==='furniture'?'#b4783e':v==='#ffffff'&&p.key==='handle'?'#3c4a2c':v}"></i>` : '';
          const c=el('button','chip'+(WCustom[id].paint[p.key]===n?' on':''), sw+n);
          c.onclick=()=>{ WCustom[id].paint[p.key]=n; applyWeaponConfig(Stage.weapon); Snd.install(); this.loStatus('Paint changed (not saved yet)'); this.renderLoadout(); };
          chips.appendChild(c); }
        grp.appendChild(chips); slots.appendChild(grp);
      }
      return;
    }
    if (!WEAPON_SLOTS[id].length){ slots.appendChild(el('p','hint','The knife has no attachments — open PAINT to customize it.')); return; }
    for (const s of WEAPON_SLOTS[id]){
      const cur=WCustom[id].att[s];
      const b=el('button','slot'+(L.slot===s?' on':''), `<span class="k">${SLOT_LABELS[s]}</span><span class="v">${cur?ATTACHMENTS[cur].name:'None'}</span><span class="ch">›</span>`);
      b.onclick=()=>{ L.slot = L.slot===s?null:s; L.pick=null; this.renderLoadout(); };
      slots.appendChild(b);
    }
    if (!L.slot) { cards.appendChild(el('p','hint','Select a slot to see compatible attachments. Only parts that fit the '+WEAPON_DEFS[id].name+' are listed.')); return; }
    const opts=[...(SLOT_DEFAULT[L.slot]?[]:[null]), ...attachmentsFor(id, L.slot)];
    for (const key of opts){
      const on=WCustom[id].att[L.slot]===key, A=key?ATTACHMENTS[key]:null, own=ProfileAuthority.ownsAtt(key), apr=key?ProfileAuthority.price('att:'+key):0;
      const deltas=this.deltas(id, L.slot, key);
      const c=el('button','acard'+(on?' on':'')+(L.pick===key?' pick':''), `<div class="t">${A?A.name:'None'}${on?'<em>EQUIPPED</em>':own?'':'<em class="price">'+fmtCash(apr)+'</em>'}</div><div class="d">${A?A.desc:'Remove the attachment from this slot.'}</div><div class="dl">${deltas.map(d=>`<span class="${d.cls}">${d.arrow} ${d.label} ${d.txt}</span>`).join('')||'<span class="same">— no stat changes</span>'}</div>`);
      if (!own) c.classList.add('locked');
      c.onclick=()=>{ L.pick=key; if (!own){ this.renderLoadout(); return; } const prev=WCustom[id].att[L.slot]; if (prev!==key){ WCustom[id].att[L.slot]=key; this.rebuildPreview(L.slot, prev); this.loStatus((A?A.name+' installed':'Attachment removed')+' (not saved yet)'); } else this.renderLoadout(); };
      cards.appendChild(c);
    }
    const sel=L.pick!==null && L.pick!==undefined ? L.pick : WCustom[id].att[L.slot];
    if (sel){ const A=ATTACHMENTS[sel], dl=this.deltas(id,L.slot,sel);
      det.innerHTML=`<div class="detail"><div class="h">${A.name.toUpperCase()}</div>${A.desc}<b>PROS</b><ul>${A.pros.map(x=>'<li class="up">'+x+'</li>').join('')||'<li class="same">—</li>'}</ul><b>CONS</b><ul>${A.cons.map(x=>'<li class="dn">'+x+'</li>').join('')||'<li class="same">—</li>'}</ul><b>STAT CHANGES (ACTUAL GAMEPLAY VALUES)</b><ul>${dl.map(d=>`<li class="${d.cls}">${d.label}: ${d.txt}</li>`).join('')||'<li class="same">No change</li>'}</ul></div>`+(ProfileAuthority.ownsAtt(sel)?'':`<div class="buybox"><b>${A.name.toUpperCase()} · ${fmtCash(ProfileAuthority.price('att:'+sel))}</b><p>Buy once, use it on every gun it fits. You have ${ProfileAuthority.cash===Infinity?'unlimited cash':fmtCash(ProfileAuthority.cash)}.</p><button class="primary" id="lo-buyatt" data-sfx="none">BUY &amp; INSTALL</button></div>`);
      const ba=$('#lo-buyatt'); if (ba) ba.onclick=()=>this.buyItem('att:'+sel, A.name, ()=>{ const prev=WCustom[id].att[L.slot]; WCustom[id].att[L.slot]=sel; this.rebuildPreview(L.slot, prev); this.loStatus(A.name+' bought and installed (not saved yet)'); }); }
  },
  // purchases from the loadout (offline: local profile; online: the server checks the price and your cash)
  buyItem(item, name, then){
    const r=ProfileAuthority.buy(item);
    if (r.ok){ this.toast(name.toUpperCase()+' BOUGHT','ok'); Snd.uiSfx('buy'); if (then) then(); }
    else if (r.pending){ this._afterBuy={item, then}; }
    else { this.toast('CAN\'T BUY: '+r.why.toUpperCase(),'warn'); Snd.uiSfx('deny'); }
    this.renderLoadout();
  },
  // gameplay stats used for display (all from weaponStats, the same function gameplay uses)
  statRows(d){
    if (d.kind==='melee') return [['Damage',d.dmg,100,true,v=>v+''],['Heavy stab',d.heavyDmg,200,true,v=>v+''],['Swing time',d.rate,1.2,false,v=>v.toFixed(2)+' s'],['Movement',4.6*d.moveMul,5.6,true,v=>v.toFixed(2)+' m/s']];
    return [
      ['Damage', d.dmg, 100, true, v=>Math.round(v)+''],
      ['Fire rate', d.rpm, 1100, true, v=>Math.round(v)+' rpm'],
      ['Effective range', d.falloff?d.falloff[0]:d.range, 400, true, v=>Math.round(v)+' m'],
      ['Recoil', d.recoil.p*1000, 75, false, v=>v.toFixed(1)],
      ['Visual recoil', d.recoil.kick, 2.2, false, v=>v.toFixed(2)],
      ['Hip-fire spread', d.spreadHip*1000, 100, false, v=>v.toFixed(1)],
      ['ADS time', d.adsTime*1000, 450, false, v=>Math.round(v)+' ms'],
      ['Movement', 4.6*d.moveMul, 5.6, true, v=>v.toFixed(2)+' m/s'],
      ['Reload time', d.reloadTime, 4, false, v=>v.toFixed(2)+' s'],
      ['Magnification', 1/(d.adsZoom||1), 5, true, v=>v.toFixed(2)+'×'],
    ];
  },
  renderStats(){
    const id=this.lo.sel, cur=weaponStats(id), stock=weaponStats(id,{cfg:defaultConfig(id)});
    const A=this.statRows(cur), S=this.statRows(stock);
    $('#lo-stats').innerHTML='<h3 style="margin-top:0">Statistics</h3>'+A.map((r,i)=>{ const s=S[i][1], v=r[1], pct=clamp(v/r[2],0,1)*100, spct=clamp(s/r[2],0,1)*100;
      const better = Math.abs(v-s)<1e-6 ? 0 : ((v>s)===r[3] ? 1 : -1);
      return `<div class="srow2"><span class="lb">${r[0]}</span><span class="sbar"><i style="width:${pct}%"></i><u style="left:${spct}%"></u></span><span class="val ${better>0?'up':better<0?'dn':''}">${better>0?'▲ ':better<0?'▼ ':''}${r[4](v)}</span></div>`; }).join('');
  },
  // stat changes for an attachment: compare the slot with this attachment vs. empty/default
  deltas(id, slot, key){
    const cfgA=JSON.parse(JSON.stringify(WCustom[id])), cfgB=JSON.parse(JSON.stringify(WCustom[id]));
    cfgA.att[slot]=key; cfgB.att[slot]=SLOT_DEFAULT[slot]||null;
    const a=this.statRows(weaponStats(id,{cfg:cfgA})), b=this.statRows(weaponStats(id,{cfg:cfgB})), out=[];
    a.forEach((r,i)=>{ const v=r[1], s=b[i][1]; if (Math.abs(v-s)<=Math.abs(s)*0.005+1e-9) return;
      const pct=s?((v-s)/Math.abs(s))*100:0, good=(v>s)===r[3];
      out.push({label:r[0], txt:(pct>0?'+':'')+pct.toFixed(0)+'%', cls:good?'up':'dn', arrow:good?'▲':'▼'}); });
    return out;
  },
  // =================================================================
  // In-game compact loadout (L)
  // =================================================================
  buildQuick(){
    const b=$('#ql-body'); b.innerHTML=''; this.qlPick=Arsenal.firearm;
    b.appendChild(el('p','hint', Mode.cur==='backpack' ? 'THE FIGHT FOR ZA: Glock only, no Switch mode (enforced by the match authority).' : 'Pick your firearm. Attachments come from your saved loadout. Equipment changes apply on your next spawn.'));
    const draw=()=>{ b.querySelectorAll('.qrow').forEach(x=>x.remove());
      for (const id of FIREARMS){ const ok=Mode.allowedFirearm(id)===id && ProfileAuthority.canUse(id), cfg=WCustomSaved[id];
        const sum=WEAPON_SLOTS[id].map(s=>cfg.att[s]).filter(a=>a && a!=='iron' && a!=='mag_std').map(a=>ATTACHMENTS[a].name).join(', ')||'No attachments';
        const r=el('button','qrow'+(this.qlPick===id?' on':'')+(ok?'':' locked'), `<b>${WEAPON_DEFS[id].name}</b><small>${ProfileAuthority.canUse(id)?sum:'Buy in Loadout · '+fmtCash(ProfileAuthority.price(id))}</small><small>${this.qlPick===id?'SELECTED':Arsenal.firearm===id?'CURRENT':''}</small>`);
        r.disabled=!ok; r.onclick=()=>{ this.qlPick=id; draw(); }; b.insertBefore(r, b.querySelector('.qknife')); } };
    b.appendChild(el('div','qrow qknife','<b>KNIFE</b><small>Always available · '+Input.label(Binds.knife)+'</small><small></small>'));
    draw();
  },
  // =================================================================
  // Settings: VIDEO / CONTROLS / AUDIO / GAMEPLAY
  // =================================================================
  buildSettings(){
    const tabs=$('#set-tabs'); tabs.innerHTML=''; this.setTab=this.setTab||'video';
    for (const [k,t] of [['video','VIDEO'],['controls','CONTROLS'],['audio','AUDIO'],['gameplay','GAMEPLAY']]){ const b=el('button',this.setTab===k?'on':'',t); b.onclick=()=>{ this.cancelCapture(); this.setTab=k; this.buildSettings(); }; tabs.appendChild(b); }
    const box=$('#set-body'); box.innerHTML='';
    const seg=(label,key,opts,apply)=>{ const r=el('div','srow'); r.appendChild(el('label','',label)); const s=el('div','seg');
      for (const [v,t] of opts){ const b=el('button',Settings[key]===v?'on':'',t); b.onclick=()=>{ Settings[key]=v; saveSettings(); apply&&apply(v); s.querySelectorAll('button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); }; s.appendChild(b); }
      r.appendChild(s); box.appendChild(r); };
    const slider=(label,key,min,max,step,fmt,apply)=>{ const r=el('div','srow'); r.appendChild(el('label','',label));
      const w=el('div','sl'); const i=el('input'); i.type='range'; i.min=min; i.max=max; i.step=step; i.value=Settings[key]; i.id='set-'+key;
      const v=el('output','',fmt(Settings[key])); i.oninput=()=>{ Settings[key]=+i.value; v.textContent=fmt(+i.value); apply&&apply(+i.value); saveSettings(); };
      w.append(i,v); r.appendChild(w); box.appendChild(r); };
    if (this.setTab==='video'){
      const g=()=>{ Game.applyGfx(); this.buildSettings(); };
      seg('Super Performance Mode','superPerf',[[false,'Off'],[true,'On']],g);
      box.appendChild(el('p','hint','For very slow computers. Uses the lightest version of everything: low resolution with auto adjustment, short view distance, simple lighting, no shadows, sky, blur or light flashes, minimal effects, and distant players animate less often. Overrides the options below while it is on.'));
      const sp=Settings.superPerf, sub=(...a)=>{ seg(...a); if (sp) box.lastChild.classList.add('dim'); };
      sub('Graphics quality','quality',[['potato','Potato'],['low','Low'],['med','Medium'],['high','High']],g);
      sub('Performance Mode','perf',[[false,'Off'],[true,'On']],g);
      box.appendChild(el('p','hint','Potato is the lowest preset (half resolution, short view, reduced effects). Performance Mode lowers resolution, shortens draw distance, disables shadows, motion blur and light flashes, and animates distant bots less often.'));
      sub('Render resolution','renderScale',[[0,'Preset'],[1,'100%'],[0.75,'75%'],[0.6,'60%'],[0.5,'50%'],[0.4,'40%'],[0.3,'30%']],g);
      sub('Auto resolution','dynRes',[[false,'Off'],[true,'On']],g);
      box.appendChild(el('p','hint','Auto resolution lowers the resolution when the frame rate drops and raises it again when there is room (never above the resolution chosen above).'));
      sub('View distance','viewDist',[['auto','Preset'],['far','Far'],['normal','Normal'],['short','Short'],['tiny','Very short']],g);
      sub('Lighting','simpleMat',[[false,'Realistic'],[true,'Simple (fast)']],g);
      sub('Light flashes','dynLights',[[true,'On'],[false,'Off']],g);
      sub('Effects','fxLevel',[['full','Full'],['reduced','Reduced'],['minimal','Minimal']],g);
      box.appendChild(el('p','hint','Effects: shell casings, bullet holes, dust and gun smoke, glass shards and how long bodies stay.'));
      seg('FPS limit','fpsCap',[[15,'15'],[30,'30'],[60,'60'],[120,'120'],[240,'240'],[0,'Unlimited']]);
      seg('Motion blur','blur',[['off','Off'],['subtle','Subtle']]);
      slider('Camera bobbing','bob',0,100,1,v=>v===0?'Off':v+'%');
      seg('Rain effects','rainFx',[['full','Full'],['reduced','Reduced']],()=>{ if (Env.raining) Snd.setRain(true, Settings.rainFx==='reduced'?0.6:1); });
      seg('Show FPS','showFps',[[true,'On'],[false,'Off']]);
    } else if (this.setTab==='audio'){
      const a=()=>Snd.applyVolumes(), pc=v=>v+'%';
      const tb=el('div','srow'); tb.appendChild(el('label','','Test sounds')); const tw=el('div','seg');
      for (const [t,fn] of [['Drako shot',()=>Snd.shot('drako')],['Drako ×5',()=>{ for (let i=0;i<5;i++) setTimeout(()=>Snd.shot('drako'),i*97); }],['Glock',()=>Snd.shot('glock')],['Footsteps',()=>{ for (let i=0;i<4;i++) setTimeout(()=>{ Snd._lastStep=0; Snd.step('run',null,i%2?'R':'L'); },i*360); }],['Fence',()=>Snd.rattle()]]){ const b=el('button','',t); b.onclick=()=>{ Snd.init(); fn(); }; tw.appendChild(b); }
      tb.appendChild(tw); box.appendChild(tb);
      for (const [k,l] of [['master','Master'],['sfx','SFX (all effects)'],['ambience','Ambience'],['music','Music'],['guns','Weapons'],['hits','Hit sounds'],['steps','Footsteps'],['breath','Breathing'],['ui','Interface'],['vehicles','Vehicles'],['env','Other effects']]) slider(l,k,0,100,1,pc,a);
      seg('Menu hover sounds','uiHover',[[true,'On'],[false,'Off']]);
    } else if (this.setTab==='gameplay'){
      const r=el('div','srow'); r.appendChild(el('label','','Player name')); const inp=el('input'); inp.type='text'; inp.maxLength=16; inp.value=Settings.name||'PLAYER'; inp.oninput=()=>{ Settings.name=inp.value.trim()||'PLAYER'; saveSettings(); this.menuInfo(); }; r.appendChild(inp); box.appendChild(r);
      seg('Camera','camMode',[['first','First person'],['third','Third person']],v=>Rig.setMode(v));
      slider('Field of view','fov',60,120,1,v=>v+'°');
      slider('3rd-person distance','tpDistance',1.2,3,0.1,v=>v.toFixed(1)+' m');
      slider('Camera motion','camMotion',0,100,1,v=>v===0?'Off':v+'%');
      box.appendChild(el('p','hint','Scales third-person camera bob, sway, roll, sprint FOV and landing dip (lower it if you get motion sick).'));
      box.appendChild(el('h3','','HUD'));
      seg('Minimap','minimap',[[true,'On'],[false,'Off']]);
      seg('Kill feed','killfeed',[[true,'On'],[false,'Off']]);
      seg('Crosshair','crosshair',[['none','None'],['cross','Cross'],['dotS','Dot S'],['dotM','Dot M'],['dotL','Dot L']],()=>this.xhPreview());
      { const r=box.lastChild, pv=el('div','xhprev'); pv.id='xh-prev'; r.appendChild(pv); this.xhPreview(); }
      box.appendChild(el('h3','','Practice'));
      seg('Bots target you','botsFire',[[true,'On'],[false,'Off']]);
    } else {
      slider('Mouse sensitivity','sens',0.2,3,0.05,v=>v.toFixed(2)+'×');
      seg('Lean (Q / E)','leanMode',[['hold','Hold'],['toggle','Toggle']]);
      seg('Crouch','crouchMode',[['hold','Hold'],['toggle','Toggle']],()=>{ P.crouchToggle=false; });
      if (RECOMMENDED_CONTROLS){ const r=el('div','srow'); r.appendChild(el('label','','Recommended controls')); const s=el('div','seg'); const b=el('button','','APPLY');
        b.onclick=()=>{ this.cancelCapture(); P.crouchToggle=false; P.leanToggle=0; applyRecommendedControls(); this.toast('RECOMMENDED CONTROLS APPLIED','ok'); this.buildSettings(); };
        s.appendChild(b); r.appendChild(s); box.appendChild(r);
        box.appendChild(el('p','hint','The developer\'s own key setup. Reset Controls puts the standard keys back.')); }
      this.buildBinds(box);
    }
    $('#set-back').onclick=()=>{ this.cancelCapture(); this.menuInfo(); Game.go(this.settingsReturn||'main'); };
    $('#set-reset').onclick=()=>{
      if (this.setTab==='controls'){ Object.assign(Binds,DEFAULT_BINDS); saveBinds(); Settings.sens=DEFAULT_SETTINGS.sens; Settings.leanMode='hold'; saveSettings(); }
      else { const keep={camMode:Settings.camMode,name:Settings.name}; Object.assign(Settings,DEFAULT_SETTINGS,keep); saveSettings(); Game.applyGfx(); Snd.applyVolumes(); }
      this.buildSettings(); };
    $('#set-reset').textContent = this.setTab==='controls' ? 'RESET CONTROLS' : 'RESET DEFAULTS';
  },
  xhPreview(){ const pv=$('#xh-prev'); if (!pv) return; const xh=Settings.crosshair, d=({dotS:2,dotM:4,dotL:6}[xh]||2);
    pv.innerHTML = xh==='none' ? '<span>—</span>' : xh==='cross' ? '<div class="cross"><i></i><i></i><i></i><i></i></div>' : `<b style="width:${d}px;height:${d}px"></b>`; },
  buildBinds(box){
    const conf=Input.conflicts(), clash=new Set(conf.flatMap(c=>[c[0],c[1]])), name=a=>ACTIONS.find(x=>x[0]===a)[1];
    if (conf.length) box.appendChild(el('p','warn','⚠ '+conf.map(c=>`“${name(c[0])}” and “${name(c[1])}” both use ${Input.label(c[2])}`).join('; ')));
    if (this.pending){
      const pd=this.pending;
      const w=el('div','conflict',`<b>${Input.label(pd.code)}</b> is already used by “${name(pd.other)}”.`);
      const sw=el('button','toggle','Swap keys'), keep=el('button','toggle','Keep both'), cancel=el('button','toggle','Cancel');
      sw.onclick=()=>{ Binds[pd.other]=Binds[pd.id]; Binds[pd.id]=pd.code; saveBinds(); this.pending=null; this.buildSettings(); };
      keep.onclick=()=>{ Binds[pd.id]=pd.code; saveBinds(); this.pending=null; this.buildSettings(); };
      cancel.onclick=()=>{ this.pending=null; this.buildSettings(); };
      w.append(sw,keep,cancel); box.appendChild(w);
    }
    for (const [g,ids] of Object.entries(ACTION_GROUPS)){
      box.appendChild(el('h3','',g));
      for (const id of ids){ const r=el('div','srow'); r.appendChild(el('label','',name(id)));
        const b=el('button','bind'+(clash.has(id)?' clash':''), this.capturing===id?'Press a key…':Input.label(Binds[id]));
        b.onclick=e=>{ e.stopPropagation(); this.startCapture(id); }; r.appendChild(b); box.appendChild(r); }
    }
    box.appendChild(el('p','hint','Click a binding, then press a key or mouse button (Esc cancels). Esc always pauses because the browser reserves it for releasing the mouse.'));
  },
  startCapture(id){
    this.cancelCapture(); this.capturing=id; this.buildSettings();
    const done=(code)=>{ this.cancelCapture(); if (!code){ this.buildSettings(); return; }
      const other=ACTIONS.find(a=>a[0]!==id && Binds[a[0]]===code);
      if (other) this.pending={id, code, other:other[0]}; else { Binds[id]=code; saveBinds(); }
      this.buildSettings(); };
    this._k=e=>{ e.preventDefault(); e.stopPropagation(); done(e.code==='Escape'?null:e.code); };
    this._m=e=>{ if (e.target.closest && e.target.closest('.bind')) return; e.preventDefault(); e.stopPropagation(); done('Mouse'+e.button); };
    setTimeout(()=>{ addEventListener('keydown',this._k,true); addEventListener('mousedown',this._m,true); },0);
  },
  cancelCapture(){ if (this._k){ removeEventListener('keydown',this._k,true); removeEventListener('mousedown',this._m,true); this._k=null; } this.capturing=null; },
  // =================================================================
  // HUD
  // =================================================================
  toast(t, kind='', quiet){
    if (!t) return; const box=$('#toasts'); if (!box) return;
    if (box.firstChild && box.firstChild.textContent===t){ return; }
    const e=el('div','toast '+(kind||''), t); box.prepend(e); while (box.children.length>3) box.lastChild.remove();
    setTimeout(()=>e.classList.add('out'),2100); setTimeout(()=>e.remove(),2500);
  },
  killfeed(html){ if (!Settings.killfeed) return; const f=$('#killfeed'); const e=el('div','kf',html); f.prepend(e); setTimeout(()=>e.remove(),5000); while (f.children.length>5) f.lastChild.remove(); },
  hitmarker(h){ const m=$('#hitmark'); m.className=h.kill?'kill':h.head?'head':''; m.style.opacity=1; clearTimeout(this.hmT); this.hmT=setTimeout(()=>m.style.opacity=0,120); },
  hurt(h){ const v=$('#vignette'); v.style.opacity=Math.min(0.9,0.35+h.n/30); clearTimeout(this.vT); this.vT=setTimeout(()=>v.style.opacity=0,250);
    const ind=$('#dmgdir'); ind.style.transform=`translate(-50%,-50%) rotate(${-h.ang}rad)`; ind.style.opacity=1; clearTimeout(this.dT); this.dT=setTimeout(()=>ind.style.opacity=0,700); },
  scoreboard(show){
    const sb=$('#scoreboard'); sb.style.display=show?'flex':'none'; if (!show) return;
    const rows=Match.rows(); sb.querySelector('.sb-title').textContent=Mode.label();
    sb.querySelector('tbody').innerHTML=rows.map((r,i)=>`<tr class="${r.me?'me':''} ${i===0&&r.kills>0?'lead':''}"><td>${i+1}</td><td>${r.me&&Dev.showTag()?'<span class="devtag">DEV</span> ':''}${r.dev&&!r.me?'<span class="devtag">DEV</span> ':''}${r.me?(Settings.name||'YOU'):r.name}${i===0&&r.kills>0?' ★':''}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.streak[0]}</td><td>${r.streak[1]}</td><td>${r.score}</td></tr>`).join('');
  },
  hudT:0, lowAmmoT:0, lowStamT:0,
  updateHUD(dt){
    const A=Arsenal, d=A.def;
    const moving=Math.min(1,P.speed/4);
    const spread = d.kind==='melee' ? 0.01 : (lerp(d.spreadHip,d.spreadAds,A.adsK) + (d.spreadMove||0)*moving + A.bloom + (d.pellets?d.pelletSpread*0.6:0))*Effects.spreadMul();
    const gap = 3 + spread*innerHeight*1.0 + A.kick*5;
    const ch=$('#cross'), xh=Settings.crosshair; ch.style.setProperty('--g',gap.toFixed(1)+'px');
    // dots are 2/4/6 px at 1080p, scaled with the screen height; the cross keeps its spread behaviour
    if (ch._xh!==xh || ch._h!==innerHeight){ ch._xh=xh; ch._h=innerHeight; ch.className=xh; ch.style.setProperty('--d',(({dotS:2,dotM:4,dotL:6}[xh]||2)*innerHeight/1080).toFixed(2)+'px'); }
    ch.style.opacity = (xh==='none' || (A.adsK>0.25 && Rig.mode==='first' && d.kind!=='melee') || Perks.nic || P.smoking || P.using || Rig.scoped || Rig.optic || (A.adsK>0.6 && Rig.mode==='first' && d.kind!=='melee') || !P.alive || P.inCar) ? 0 : 1;
    $('#scope').style.display = Rig.scoped ? 'block' : 'none'; $('#scope').classList.toggle('therm', Thermal.active());
    // 2.5x: full-screen scope picture once fully aimed in (the 3D scope is shown during the transition)
    const ov = Rig.optic && A.def.attachments && A.def.attachments.includes('scope25') ? clamp((A.adsK-0.82)/0.16,0,1) : 0;
    this.scopeOverlay=ov; const sc=$('#scope25'); if (sc._o!==ov){ sc._o=ov; sc.style.opacity=ov.toFixed(3); }
    if (!this._s25){ this._s25=true; const g=sc.querySelector('canvas').getContext('2d'), c=256;
      g.strokeStyle='#ff2a1f'; g.lineWidth=5; g.lineJoin='miter'; g.beginPath(); g.moveTo(c-16,c+14); g.lineTo(c,c-5); g.lineTo(c+16,c+14); g.stroke();
      g.fillStyle='#ff2a1f'; g.fillRect(c-2.5,c+5,5,46);
      g.fillStyle='rgba(0,0,0,.9)'; g.fillRect(c-1.2,c+70,2.4,180); g.fillRect(c-250,c-1.2,190,2.4); g.fillRect(c+60,c-1.2,190,2.4); }
    const rb=$('#reload'); if (A.state==='reload'){ rb.style.display='block'; rb.firstChild.style.width=(A.stateT/A.stateDur*100)+'%'; rb.lastChild.textContent='RELOADING'; }
    else if (P.search){ rb.style.display='block'; rb.firstChild.style.width=(P.search.t/P.search.dur*100)+'%'; rb.lastChild.textContent='SEARCHING'; }
    else if (P.smoking){ rb.style.display='block'; rb.firstChild.style.width=(P.smoking.t/3*100)+'%'; rb.lastChild.textContent='SMOKING'; }
    else if (P.using){ rb.style.display='block'; rb.firstChild.style.width=(P.using.t/P.using.dur*100)+'%'; rb.lastChild.textContent=P.using.kind==='beer'?'DRINKING':'ZYN'; }
    else rb.style.display='none';
    const ex=P.alive?clamp((0.25-staminaK())/0.25,0,1):0; $('#stamvig').style.opacity=(ex*0.8).toFixed(3);
    $('#flashfx').style.opacity=Equip.flashK.toFixed(3);
    this.objectiveMarker();
    if (this.tabHeld) this.scoreboard(true);
    // brief feedback toasts
    this.lowAmmoT-=dt; this.lowStamT-=dt;
    const a=A.ammo[A.cur];
    if (a && P.alive && a.mag>0 && a.mag<=Math.ceil(d.mag*0.2) && this.lowAmmoT<=0 && A.state!=='reload'){ this.toast('LOW AMMO','warn'); this.lowAmmoT=8; }
    if (P.alive && staminaK()<0.11 && this.lowStamT<=0){ this.toast('LOW STAMINA','warn'); this.lowStamT=10; }
    this.hudT-=dt; if (this.hudT>0) return; this.hudT=0.08;
    const mh=P.maxHp(), hk=P.hp/mh;
    $('#hp-fill').style.width=(hk*100)+'%'; $('#hp-num').innerHTML=Math.ceil(P.hp)+(Math.round(mh)!==100?`<small class="cap">/${Math.round(mh)}</small>`:'');
    $('#hp-fill').style.background = mh>200?'#ff6a5a':hk>0.5?'var(--txt)':hk>0.25?'var(--gold2)':'#e04a3a';
    $('#st-fill').style.width=(staminaK()*100)+'%'; $('#st-fill').style.background=P.exhausted?'#e05a40':StreakAuthority.nicOn('player')?'#e6a0c0':'#7cc3e8';
    this.progHUD();
    const st=[]; if (P.exhausted) st.push(['EXHAUSTED','bad']); if (Equip.flashK>0.05) st.push(['FLASHED','bad']); if (P.smoking) st.push(['SMOKING','']); if (P.carrying) st.push(['CARRYING THE BAG','obj']);
    if (P.prone && Rig.proneK>0.8) st.push(['PRONE','']); else if (P.crouch && PlayerChar.rig && PlayerChar.rig.modelY<-0.24) st.push(['CROUCHED','']);
    if (P.riding) st.push([P.riding.S.name+(Rides.steerLocked()?' · STEERING LOCKED':''),'']);
    if (P.bluntCap) st.push(['MAX HP +20%','good']);
    if (Effects.zyn>0) st.push(['ZYN +50% ACCURACY '+Math.ceil(Effects.zyn)+'s','good']);
    if (Effects.beer>0) st.push(['BEER -10% DAMAGE '+Math.ceil(Effects.beer)+'s','good']);
    if (Flashlight.on) st.push(['FLASHLIGHT','']);
    if (Thermal.on && Arsenal.cur==='sniper') st.push(['THERMAL '+(Rig.scoped?'ON':'(SCOPE IN)'),'']);
    { const S=StreakAuthority.e.player; if (S){
      if (S.streak>=2) st.push(['STREAK '+S.streak,'']);
      if (StreakAuthority.nicOn('player')) st.push(['NIC +35% SPEED '+Math.ceil(StreakAuthority.remaining('player','nic'))+'s','good']);
      const ab=StreakAuthority.abilityState('player');
      if (ab.A && ab.active) st.push([ab.A.name+' ACTIVE','ab']); } }
    // ability icon: progress to the 10-kill streak, then READY (press the key), then ACTIVE until death
    { const ab=StreakAuthority.abilityState('player'), box=$('#abil');
      if (!ab.A){ box.style.display='none'; } else { box.style.display='flex';
        const k=ab.active||ab.ready ? 1 : Math.min(1,ab.streak/ab.A.at), C=2*PI*19;
        box.className=ab.active?'on':ab.ready?'ready':'';
        box.querySelector('.prg').style.strokeDasharray=(C*k).toFixed(1)+' '+C.toFixed(1);
        const ic=ab.A.id==='triple'?'<svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="currentColor"/><text x="12" y="15.5" font-size="9" font-weight="700" text-anchor="middle" fill="#111">x3</text></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M12 2 9 7v13h6V7z" fill="currentColor"/><path d="M8 21h8v1.5H8z" fill="currentColor"/><text x="12" y="16" font-size="6.5" font-weight="700" text-anchor="middle" fill="#111">x2</text></svg>';
        if (box._ic!==ab.A.id){ box.querySelector('.ic').innerHTML=ic; box._ic=ab.A.id; }
        box.querySelector('b').textContent=ab.A.name;
        box.querySelector('small').textContent = ab.active ? 'ACTIVE · UNTIL YOU DIE' : ab.ready ? 'READY · PRESS '+Input.label(Binds.ability) : 'KILL STREAK '+ab.streak+' / '+ab.A.at; } }
    $('#status').innerHTML=st.map(s=>`<i class="${s[1]}">${s[0]}</i>`).join('');
    $('#wname').innerHTML=d.name+(A.cur==='glock'?` <span class="mode ${A.glockAuto?'auto':''}">${A.glockAuto?'SWITCH · AUTO':'SEMI'}</span>`:'');
    $('#ammo').innerHTML = a ? `<b class="${a.mag===0?'empty':a.mag<=Math.ceil(d.mag*0.25)?'low':''}">${a.mag}</b><span>/ ${a.res}</span>` : '<b>—</b>';
    $('#slots').innerHTML = `<i class="${A.cur!=='knife'?'on':''}">${Input.label(Binds.firearm)} ${WEAPON_DEFS[A.firearm].name}</i><i class="${A.cur==='knife'?'on':''}">${Input.label(Binds.knife)} KNIFE</i>`;
    { const nic=(StreakAuthority.e.player||{charges:{nic:0}}).charges.nic||0, it=(k,n,act)=>`<i class="${n?'':'dim'}" title="${k}">${ITEM_ICON[k]}${n}<small>${Input.label(Binds[act])}</small></i>`;
      $('#equip').innerHTML = `<i>FLASH ${P.flash}<small>${Input.label(Binds.grenade)}</small></i><i>MINE ${P.mine}<small>${Input.label(Binds.mine)}</small></i>`+it('blunt',P.items.blunt,'smoke')+it('beer',P.items.beer,'beer')+it('zyn',P.items.zyn,'zyn')+it('nic',nic,'nic'); }
    $('#mtimer').textContent = (Mode.cur==='dm' && MatchRules.time>0) ? fmtTime(Math.max(0,MatchRules.time-Mode.clock)) : (Mode.cur==='backpack' && ZARules.variant==='hold') ? fmtTime(Math.max(0,ZARules.time-Mode.clock)) : fmtTime(Mode.clock);   // counts down with a time limit $('#mtitle').textContent=Mode.title()+' · '+Env.clockString()+(Env.raining?' · RAIN':'');
    if (Mode.cur==='backpack'){
      const s=BackpackAuthority.s, who=Mode.nameOf(s.carrier), where=zoneName(s.x,s.z,s.y);
      if (ZARules.variant==='classic'){
        $('#objective').innerHTML = who ? `<b class="${s.carrier==='player'?'mine':'theirs'}">${who==='YOU'?'YOU HAVE THE BAG':who+' HAS THE BAG'}</b><span class="timer">${BackpackAuthority.remaining().toFixed(1)}s</span>` : `<b>THE BAG IS ${s.atHome?'AT ITS SPAWN':'ON THE GROUND'} · ${where.toUpperCase()}</b><span class="timer" style="font-size:14px">GRAB IT</span>`;
      } else {
        const stn=BackpackAuthority.standings(), lead=stn[0], mine=BackpackAuthority.holdOf('player');
        const rows=[...stn.slice(0,4)]; if (!rows.some(r=>r[0]==='player')) rows.push(['player',mine]);
        $('#objective').innerHTML = `<b class="${s.carrier==='player'?'mine':s.carrier?'theirs':''}">${who ? (who==='YOU'?'YOU HAVE THE BAG':who+' HAS THE BAG') : 'BAG '+(s.atHome?'AT ITS SPAWN':'ON THE GROUND')+' · '+where.toUpperCase()}</b>`+
          `<span style="color:var(--mut)"> · LEADER ${lead?Mode.nameOf(lead[0])+' '+lead[1].toFixed(1)+'s':'—'}</span>`+
          `<div id="zastand">${rows.map(r=>`<div class="${r[0]==='player'?'me':''} ${r[0]===s.carrier?'car':''}"><span>${Mode.nameOf(r[0])}${r[0]===s.carrier?' ◆':''}</span><span>${r[1].toFixed(1)}s</span></div>`).join('')}</div>`;
      }
    } else { const top=Match.rows()[0], K=MatchRules.kills; $('#objective').innerHTML=`<b>${P.kills}</b>${K>0?' / '+K:''} KILLS <span style="color:var(--mut)">· LEADER ${top.me?'YOU':top.name} ${top.kills}</span>${K>0?`<span class="kprog"><i style="width:${Math.min(100,P.kills/K*100)}%"></i></span>`:''}`; }
    $('#area').textContent = areaName();
    let t='';
    if (!P.alive || Mode.ended) t='';
    else if (P.riding) t=`<b>${Input.label(Binds.interact)}</b> get off · <b>W</b>/<b>S</b> speed · <b>A</b>/<b>D</b> steer${Rides.steerLocked()?' <span style="color:#ff9a8a">(locked while firing)</span>':''}`;
    else if (P.inCar) t=`<b>${Input.label(Binds.interact)}</b> get out`;
    else if (P.ladder) t=`<b>W</b>/<b>S</b> climb · <b>${Input.label(Binds.jump)}</b> let go`;
    else if (P.slide) t='';
    else if (!P.anim && !P.search && !P.smoking){
      const v=nearVault(), lad=nearLadder(), car=nearestCar(), pk=Pickups.near(), srch=nearestSearchable(), K=Input.label(Binds.interact);
      if (Mode.nearBackpack()) t=`<b>${K}</b> pick up the BAG`;
      else if (pk>=0){ const p=Pickups.list[pk]; t=`<b>${K}</b> pick up ${WEAPON_DEFS[p.type].name} ammo${p.type!==A.firearm?' (converts)':''}`; }
      else if (v) t=`<b>${Input.label(Binds.jump)}</b> climb over fence`; else if (lad) t=`<b>${K}</b> `+(lad.top?'climb down ladder':'climb ladder');
      else if (car) t=`<b>${K}</b> get in — ${car.name}`; else if (Rides.near()) t=`<b>${K}</b> ride the ${Rides.near().S.name.toLowerCase()}`; else if (srch) t=`<b>${K}</b> search the trunk`;
      else if (a && a.mag===0 && a.res===0) t='Out of ammo — use the knife or find ammo'; else if (a && a.mag===0) t=`<b>${Input.label(Binds.reload)}</b> reload`; }
    const pr=$('#prompt'); if (pr._t!==t){ pr._t=t; pr.innerHTML=t; pr.style.display=t?'block':'none'; }
    $('#fps').style.display = Settings.showFps ? 'block' : 'none';
    $('#mini').style.display = Settings.minimap ? 'block' : 'none'; $('#killfeed').style.top = Settings.minimap ? '' : '12px';
    if (Settings.minimap){ this.mmT=(this.mmT||0)+dt; if (!Perf.potato || this.mmT>0.1){ this.mmT=0; drawMinimap(); } }   // potato: minimap at 10 Hz
  },
  // end-of-match rewards (computed and paid once by ProfileAuthority / the server)
  showRewards(r, place){
    const box=$('#end-rewards'); if (!box) return;
    if (!r){ box.innerHTML='<p class="hint">Rewards for this match were already paid.</p>'; return; }
    const pr=ProfileAuthority.levelProgress();
    box.innerHTML=`<table>${r.lines.map(l=>`<tr class="${l.already?'dim':''}"><td>${l.label}${l.already?' <small>(paid live)</small>':''}</td><td class="x">${l.xp?'+'+l.xp+' XP':''}</td><td class="c">${l.cash?'+'+fmtCash(l.cash):''}</td></tr>`).join('')}
      <tr class="tot"><td>TOTAL THIS MATCH · place ${place}</td><td class="x">+${r.totalXP} XP</td><td class="c">+${fmtCash(r.totalCash)}</td></tr></table>
      <div class="lvp"><b>LEVEL ${r.level}</b>${r.level>r.levelBefore?' <span class="own">LEVEL UP</span>':''}<span class="bar"><i style="width:${(pr.k*100).toFixed(1)}%"></i></span><span>${pr.cur} / ${pr.need} XP · ${ProfileAuthority.cash===Infinity?'∞':fmtCash(ProfileAuthority.cash)}</span></div>`;
  },
  // level / XP / cash strip (top-left) and pop-ups
  progHUD(){
    if (!ProfileAuthority.s) return; const pr=ProfileAuthority.levelProgress(), c=ProfileAuthority.cash;
    $('#pl-lvl').textContent=ProfileAuthority.level(); $('#pl-xp').style.width=(pr.k*100).toFixed(1)+'%';
    $('#pl-xpt').textContent=pr.cur+' / '+pr.need+' XP'; $('#pl-cash').textContent=c===Infinity?'∞':fmtCash(c);
  },
  xpPop(t, cls){ const f=$('#xpfeed'); if (!f || Game.state!=='playing') return; const e=el('i',cls,t); f.appendChild(e); setTimeout(()=>e.remove(),1700); while (f.children.length>4) f.firstChild.remove(); },
  levelBanner(big, small){ const b=$('#lvlup'); if (!b) return; b.innerHTML=`<small>${small}</small><b>${big}</b>`; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); },
  objectiveMarker(){
    const m=$('#objmark'), p=Mode.objectivePos();
    if (!p || Mode.ended){ m.style.display='none'; return; }
    const v=p.clone().project(camera); let x=(v.x*0.5+0.5)*innerWidth, y=(-v.y*0.5+0.5)*innerHeight;
    if (v.z>1){ x=innerWidth-x; y=innerHeight-8; }
    x=clamp(x,30,innerWidth-30); y=clamp(y,90,innerHeight-60);
    const s=BackpackAuthority.s; m.className = s.carrier==='player'?'mine':s.carrier?'theirs':'';
    m.style.display='block'; m.style.transform=`translate(${x-14}px,${y-14}px)`;
    m.lastChild.textContent = Math.round(p.distanceTo(camera.position))+'m';
  },
};

// ---------- Minimap (mode visibility rules: no live enemy positions) ----------
const MMH = RMv(84)+4;   // the minimap shows the (compressed) playable area, not the whole ground texture
let miniBase=null;
function bakeMinimap(){
  miniBase=document.createElement('canvas'); miniBase.width=miniBase.height=212;
  const g=miniBase.getContext('2d'), k=212/(2*MMH);
  g.drawImage(groundCanvas,gX(-MMH),gZ(-MMH),gL(2*MMH),gL(2*MMH),0,0,212,212);
  for (const b of BUILDINGS){ g.fillStyle= b.style==='tower'? '#b9a68f' : '#9c7a62'; g.fillRect((b.x0+MMH)*k,(b.z0+MMH)*k,(b.x1-b.x0)*k,(b.z1-b.z0)*k);
    g.fillStyle='#111'; g.font='bold 10px sans-serif'; g.textAlign='center'; g.textBaseline='middle'; g.fillText(b.id,((b.x0+b.x1)/2+MMH)*k,((b.z0+b.z1)/2+MMH)*k); }
  for (const o of OUTER_BUILDINGS.concat(LP_BUILDINGS)){ g.save(); g.translate((o.x+MMH)*k,(o.z+MMH)*k); g.rotate(-o.yaw); const L=OUTER_LAYOUT[o.model], hx=L?L.half[0]:o.w/2, hz=L?L.half[1]:o.d/2; g.fillStyle='#8c7b66'; g.fillRect(-hx*k,-hz*k,hx*2*k,hz*2*k); g.restore(); }
  g.fillStyle='#d6ad4a'; for (const l of ladders) g.fillRect(((l.x0+l.x1)/2+MMH)*k-2,((l.z0+l.z1)/2+MMH)*k-2,4,4);
  g.strokeStyle='#d6ad4a'; g.lineWidth=2; for (const v of vaults){ g.beginPath(); g.moveTo((v.ax+MMH)*k,(v.az+MMH)*k); g.lineTo((v.bx+MMH)*k,(v.bz+MMH)*k); g.stroke(); }
}
function drawSkull(g,x,y){ g.fillStyle='#e0302a'; g.beginPath(); g.arc(x,y-1,4.5,0,PI*2); g.fill(); g.fillRect(x-3,y+2,6,3); g.fillStyle='#111'; g.fillRect(x-2.5,y-2,2,2); g.fillRect(x+0.5,y-2,2,2); }
function drawMinimap(){
  const cv=$('#mini'), mg=cv.getContext('2d'), k=cv.width/(2*MMH); mg.drawImage(miniBase,0,0,cv.width,cv.height);
  for (const p of Pickups.list){ mg.fillStyle='#ffffff'; mg.fillRect((p.m.position.x+MMH)*k-1.5,(p.m.position.z+MMH)*k-1.5,3,3); }
  // unsuppressed gunfire: red ping for 0.3 s
  for (const p of Pings.list){ mg.fillStyle=`rgba(230,40,30,${0.4+p.t/0.3*0.6})`; mg.beginPath(); mg.arc((p.x+MMH)*k,(p.z+MMH)*k,3.5,0,PI*2); mg.fill(); }
  if (Mode.cur==='backpack'){ const s=BackpackAuthority.s;
    if (s.carrier && s.carrier!=='player') drawSkull(mg,(s.x+MMH)*k,(s.z+MMH)*k);           // carrier: red skull
    else if (!s.carrier){ mg.fillStyle='#d6ad4a'; mg.fillRect((s.x+MMH)*k-3,(s.z+MMH)*k-3,6,6); } }
  const x=(P.pos.x+MMH)*k, y=(P.pos.z+MMH)*k;
  mg.save(); mg.translate(x,y); mg.rotate(-P.yaw);
  mg.fillStyle=P.carrying?'#5fbf72':'#fff'; mg.strokeStyle='#000'; mg.lineWidth=1.5;
  mg.beginPath(); mg.moveTo(0,-6); mg.lineTo(4,5); mg.lineTo(0,3); mg.lineTo(-4,5); mg.closePath(); mg.stroke(); mg.fill();
  mg.restore();
}
// area name for any point (used for the bag's location)
function zoneName(x,z,y=0){
  for (const b of BUILDINGS) if (y>b.h-0.6 && x>b.x0-0.6&&x<b.x1+0.6&&z>b.z0-0.6&&z<b.z1+0.6) return 'Rooftop · Building '+b.id;
  for (const o of OUTER_BUILDINGS.concat(LP_BUILDINGS)) if (x>o.x0&&x<o.x1&&z>o.z0&&z<o.z1) return o.name;
  if (x>-21&&x<6&&z>-22&&z<10) return 'Courtyard'; if (x>RMv(-79)&&x<RMv(-55)&&z>3&&z<31) return 'West parking lot'; if (x>25&&x<38&&z>-6&&z<28) return 'East lot';
  if (x>-30&&x<-20&&z>-22&&z<-14) return 'North-west alley'; if (x>-44&&x<-20&&z>12&&z<19.5) return 'Brick alley'; if (x>6&&x<26&&z>-8&&z<10) return 'East alley';
  return 'The block';
}
function areaName(){
  const p=P.pos;
  if (P.riding) return 'On the '+P.riding.S.name.toLowerCase();
  for (const o of OUTER_BUILDINGS) if (p.x>o.x0&&p.x<o.x1&&p.z>o.z0&&p.z<o.z1) return o.name;
  if (P.inCar) return 'Inside the '+P.inCar.name.toLowerCase();
  for (const b of BUILDINGS) if (p.y>b.h-0.6 && p.x>b.x0-0.6&&p.x<b.x1+0.6&&p.z>b.z0-0.6&&p.z<b.z1+0.6) return 'Rooftop · Building '+b.id;
  if (p.y>20 && p.x>-2 && p.x<6) return 'Tower bridge';
  for (const z of busZones){ const lx=(p.x-z.F.x)*z.F.c-(p.z-z.F.z)*z.F.s, lz=(p.x-z.F.x)*z.F.s+(p.z-z.F.z)*z.F.c; if (Math.abs(lx)<z.hl&&Math.abs(lz)<z.hw) return 'Inside the bus'; }
  if (P.ladder) return 'Ladder · '+P.ladder.name;
  if (p.x>-21&&p.x<6&&p.z>-22&&p.z<10) return 'Courtyard';
  if (p.x>-79&&p.x<-55&&p.z>3&&p.z<31) return 'West parking lot';
  if (p.x>25&&p.x<38&&p.z>-6&&p.z<28) return 'East lot';
  if (p.x>-30&&p.x<-20&&p.z>-22&&p.z<-14) return 'North-west alley';
  if (p.x>-44&&p.x<-20&&p.z>12&&p.z<19.5) return 'Brick alley';
  if (p.x>6&&p.x<26&&p.z>-8&&p.z<10) return 'East alley';
  if (p.y>0.5 && p.z>20 && p.z<21.6) return 'Stairway · Building D';
  return 'The block';
}
