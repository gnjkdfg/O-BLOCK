'use strict';
/* Weapons: stats, 3D models, and the customization system (attachments + paint for every weapon).
   Weapon space: origin = right-hand grip, barrel points -Z, up is +Y, metres. */
const bx = (w,h,d) => new THREE.BoxGeometry(w,h,d);
const cy = (r1,r2,h,s=7) => new THREE.CylinderGeometry(r1,r2,h,s);
const WEAPON_ORDER = ['glock','drako','sniper','shotgun','ar15','knife'];

// insertAt = fraction of the reload when the new magazine seats (synced to the imported reload audio);
// cancelling before that point keeps the old ammo count, after it the mag is already in.
const WEAPON_DEFS = {
  drako:  {name:'DRAKO', kind:'auto', mag:30, reserve:120, rpm:620, dmg:28, headMul:2.0, range:220, falloff:[70,180,0.85],
           spreadHip:0.03, spreadAds:0.006, spreadMove:0.026,
           recoil:{p:0.016, y:0.007, kick:1, pattern:[0,0.4,-0.3,0.6,-0.5,0.2,0.7,-0.6,-0.2,0.5]}, recover:6,
           reloadTime:2.45, insertAt:0.62, adsZoom:0.76, adsTime:0.15, sound:'drako', moveMul:0.95, flash:1.25},
  glock:  {name:'GLOCK', kind:'semi', mag:17, reserve:85, rpm:450, dmg:23, headMul:2.0, range:110, falloff:[30,90,0.7],
           spreadHip:0.016, spreadAds:0.0025, spreadMove:0.014,
           recoil:{p:0.014, y:0.004, kick:0.6}, recover:12, reloadTime:1.7, insertAt:0.42, adsZoom:0.86, adsTime:0.12, sound:'glock', moveMul:1.0, flash:0.7},
  sniper: {name:'M24 SNIPER', kind:'bolt', mag:5, reserve:25, rpm:48, dmg:96, headMul:2.5, range:400, falloff:[400,400,1],
           spreadHip:0.06, spreadAds:0.0, spreadMove:0.018,
           recoil:{p:0.07, y:0.01, kick:2}, recover:3, reloadTime:3.1, insertAt:0.7, adsZoom:0.2, adsTime:0.3, sound:'sniper', moveMul:0.88, flash:1.3, scope:true},
  // AR-15 (imported model): the best all-rounder — fast, flat-shooting, accurate; slightly less damage per round than the Drako
  ar15:   {name:'AR-15', kind:'auto', mag:30, reserve:150, rpm:720, dmg:26, headMul:2.0, range:260, falloff:[80,200,0.8],
           spreadHip:0.026, spreadAds:0.004, spreadMove:0.02,
           recoil:{p:0.0125, y:0.0055, kick:0.85, pattern:[0,0.3,-0.25,0.4,-0.35,0.15,0.45,-0.4,-0.1,0.3]}, recover:7,
           reloadTime:2.3, insertAt:0.6, adsZoom:0.74, adsTime:0.15, sound:'ar15', moveMul:0.97, flash:1.1},
  // Pump shotgun (imported model): 8 pellets, devastating up close, falls off fast
  shotgun:{name:'PUMP SHOTGUN', kind:'pump', mag:7, reserve:28, rpm:75, dmg:16, pellets:8, pelletSpread:0.05, headMul:1.5, range:45, falloff:[9,32,0.25],
           spreadHip:0.012, spreadAds:0.006, spreadMove:0.02,
           recoil:{p:0.06, y:0.012, kick:1.8}, recover:3.5, reloadTime:3.0, insertAt:0.72, adsZoom:0.82, adsTime:0.18, sound:'shotgun', moveMul:0.95, flash:1.5, pumpTime:0.62},
  knife:  {name:'KNIFE', kind:'melee', dmg:55, heavyDmg:100, range:2.4, rate:0.48, heavyRate:1.0, moveMul:1.08},
};
const GLOCK_SWITCH_RPM = 1100;
const GLOCK_SWITCH_RECOIL = 1.2;     // Switch mode recoil is exactly 20% higher than semi-auto (aim climb, sideways kick and visual kick)
const GLOCK_SWITCH_ACCURACY = 0.85;   // Switch mode keeps 85% of the semi-auto accuracy (exactly 15% less)

// ======================================================================
// Weapon customization: attachments + paint for every weapon.
// One data table drives the 3D model (parts shown/built), the loadout UI
// (cards, pros/cons, stat deltas) and gameplay (weaponStats()).
// mods are fractional: recoil -0.2 = 20% less recoil, ads -0.2 = 20% slower ADS,
// move -0.2 = 20% slower movement while it is equipped.
// ======================================================================
const ATTACHMENTS = {
  iron:       {name:'Iron sights', cat:'optic', for:['drako','glock','ar15'], desc:'Factory sights. Nothing to slow you down.', pros:['Fastest aim'], cons:['No magnification beyond the base view'], mods:{}},
  dot_open:   {name:'Open red dot', cat:'optic', for:['glock'], part:'optic_b', desc:'Open reflex sight with a clear dot.', pros:['1.15x magnification','Clear sight picture'], cons:['Slightly slower ADS'], mods:{zoom:1.15, ads:-0.05}},
  dot_closed: {name:'Enclosed red dot', cat:'optic', for:['glock'], part:'optic_a', desc:'Boxed reflex sight, steadier picture.', pros:['1.2x magnification','Less visual recoil'], cons:['Slower ADS'], mods:{zoom:1.2, vkick:-0.15, ads:-0.08}},
  scope15:    {name:'1.5x scope', cat:'optic', for:['drako','ar15'], desc:'Low-power scope for mid-range lanes.', pros:['1.5x magnification','Reduced visual recoil'], cons:['ADS speed -20%','Running speed -20%'], mods:{zoom:1.5, vkick:-0.35, ads:-0.20, move:-0.20}},
  scope25:    {name:'2.5x scope', cat:'optic', for:['drako','ar15'], desc:'Higher magnification for long sight lines.', pros:['2.5x magnification','Reduced visual recoil'], cons:['ADS speed -30%','Running speed -30%'], mods:{zoom:2.5, vkick:-0.45, ads:-0.30, move:-0.30}},
  vgrip:      {name:'Vertical grip', cat:'under', for:['drako','glock'], part:'foregrip', desc:'Front grip for a firmer hold.', pros:['Recoil -20%'], cons:['Movement speed -10%','ADS speed -5%'], mods:{recoil:-0.20, move:-0.10, ads:-0.05}},
  brace:      {name:'Brace stock', cat:'stock', for:['glock'], part:'stock_c', desc:'Arm brace that braces against the forearm.', pros:['Recoil -30%'], cons:['ADS speed -8%','Movement speed -5%'], mods:{recoil:-0.30, ads:-0.08, move:-0.05}},
  skeleton:   {name:'Skeleton stock', cat:'stock', for:['glock'], part:'stock_b', desc:'Light skeleton stock.', pros:['Recoil -35%'], cons:['ADS speed -10%','Movement speed -6%'], mods:{recoil:-0.35, ads:-0.10, move:-0.06}},
  folding:    {name:'Folding stock', cat:'stock', for:['glock'], part:'stock_a', desc:'Full folding stock, most stable.', pros:['Recoil -40%'], cons:['ADS speed -12%','Movement speed -8%'], mods:{recoil:-0.40, ads:-0.12, move:-0.08}},
  suppressor: {name:'Suppressor', cat:'muzzle', for:['drako','glock','sniper','ar15'], part:'silencer', desc:'Quieter shots that do not show on the minimap.', pros:['Shot volume -70%','No minimap ping','Bots do not hear you'], cons:['Range -10%','ADS speed -5%'], mods:{loud:-0.7, noPing:true, range:-0.10, ads:-0.05}},
  compensator:{name:'Compensator', cat:'muzzle', for:['drako','glock','ar15'], part:'comp', desc:'Hides muzzle flash, −15% damage.', pros:['No muzzle flash (no light, harder to spot)','Recoil -12%'], cons:['Damage -15%'], mods:{noFlash:true, dmg:-0.15, recoil:-0.12}},
  laser:      {name:'Laser', cat:'other', for:['drako','glock','sniper','ar15','shotgun'], part:'laser', desc:'Visible beam that tightens hip-fire.', pros:['Hip-fire spread -40%'], cons:['Beam shows where you aim'], mods:{hip:-0.40, laser:true}},
  flashlight: {name:'Flashlight', cat:'other', for:['glock'], part:'flashlight', desc:'Bright light that dazzles close targets.', pros:['Bots within 20 m you aim at lose 30% accuracy'], cons:['ADS speed -3%'], mods:{glare:true, ads:-0.03}},
  mag_std:    {name:'Standard mag', cat:'mag', for:['glock'], part:'mag_std', desc:'17 rounds.', pros:['Fastest reload'], cons:[], mods:{cap:17}},
  mag_ext:    {name:'Extended mag', cat:'mag', for:['glock'], part:'mag_ext', desc:'31 rounds.', pros:['+14 rounds'], cons:['Reload +10%','Movement speed -3%'], mods:{cap:31, reload:0.10, move:-0.03}},
  mag_drum:   {name:'Drum mag', cat:'mag', for:['glock'], part:'mag_drum', desc:'50 rounds.', pros:['+33 rounds'], cons:['Reload +30%','Movement speed -8%','ADS speed -10%'], mods:{cap:50, reload:0.30, move:-0.08, ads:-0.10}},
};
const SLOT_LABELS = {optic:'Optics', under:'Underbarrel', stock:'Stock', muzzle:'Muzzle', other:'Other', mag:'Magazine'};
const WEAPON_SLOTS = { drako:['optic','under','muzzle','other'], glock:['optic','under','stock','muzzle','other','mag'], sniper:['muzzle','other'], ar15:['optic','muzzle','other'], shotgun:['other'], knife:[] };
const SLOT_DEFAULT = { optic:'iron', mag:'mag_std' };          // slots that cannot be empty
const WEAPON_CATEGORY = { drako:'Compact rifle', glock:'Pistol', sniper:'Bolt-action rifle', ar15:'Assault rifle', shotgun:'Pump shotgun', knife:'Melee · always carried' };
const PAINT = {
  drako:[ {key:'metal', label:'Receiver', opts:[['Factory',null],['Blued black','#202123'],['Gunmetal','#45484c'],['FDE','#8f7a58'],['OD green','#4a5233'],['Chrome','#c9ccd0'],['Gold','#c9a23a'],['Crimson','#7e1717']]},
          {key:'furniture', label:'Furniture', opts:[['Factory wood',null],['Dark walnut','#7a4a2a'],['Black polymer','#1c1c1d'],['OD polymer','#4c5534'],['Tan polymer','#a08a62'],['Red','#8e1b1b']]},
          {key:'finish', label:'Finish', opts:[['Satin',{r:0.45,m:0.55}],['Matte',{r:0.8,m:0.2}],['Polished',{r:0.2,m:0.8}]]} ],
  glock:[ {key:'slide', label:'Slide', opts:[['Gunmetal','#4a4c50'],['Black','#161616'],['FDE Tan','#a08a66'],['OD Green','#4c5634'],['Chrome','#d0d4d8'],['Gold','#caa230'],['Crimson','#9c1c1c'],['Cobalt','#2357a3'],['Pink','#d8709d'],['Ghost White','#e6e6e2']]},
          {key:'frame', label:'Frame', opts:[['Black','#141414'],['Grey','#5c5f63'],['FDE Tan','#9d8762'],['OD Green','#4a5333'],['White','#e2e2de'],['Crimson','#8e1a1a'],['Cobalt','#244f8f'],['Purple','#5b3a8a'],['Teal','#1f7a78']]},
          {key:'finish', label:'Finish', opts:[['Satin',{r:0.42,m:0.45}],['Matte',{r:0.8,m:0.15}],['Polished',{r:0.18,m:0.7}],['Cerakote',{r:0.62,m:0.25}]]},
          {key:'skin', label:'Skin', opts:[['None',null],['Woodland camo',1],['Tiger stripe',1],['Digital',1],['Carbon fiber',1],['Damascus',1],['Gold flake',1],['Street graffiti',1],['Hex',1]]} ],
  sniper:[ {key:'stock', label:'Stock', opts:[['Factory',null],['Black','#26272a'],['OD green','#4b5534'],['Desert tan','#a58c62'],['Arctic white','#d7d9d6'],['Urban grey','#6a6e72'],['Crimson','#7c1a1a']]},
           {key:'metal', label:'Barrel & scope', opts:[['Factory',null],['Black','#1e1f21'],['Gunmetal','#4b4e52'],['Bronze','#8a6a3a'],['Chrome','#c6c9cc']]} ],
  ar15:[ {key:'metal', label:'Receiver', opts:[['Factory',null],['Black','#222326'],['Gunmetal','#4a4d52'],['FDE','#9a8460'],['OD green','#4b5434'],['Wolf grey','#6e7176'],['Crimson','#7e1717'],['Cobalt','#25508f']]},
          {key:'finish', label:'Finish', opts:[['Satin',{r:0.45,m:0.5}],['Matte',{r:0.8,m:0.15}],['Polished',{r:0.22,m:0.75}],['Cerakote',{r:0.62,m:0.25}]]} ],
  shotgun:[ {key:'metal', label:'Receiver', opts:[['Factory',null],['Black','#1f2022'],['Gunmetal','#4a4d52'],['FDE','#9a8460'],['OD green','#4b5434'],['Chrome','#c6c9cc']]},
          {key:'finish', label:'Finish', opts:[['Satin',{r:0.45,m:0.5}],['Matte',{r:0.8,m:0.15}],['Polished',{r:0.22,m:0.75}]]} ],
  knife:[ {key:'blade', label:'Blade', opts:[['Steel','#c9ccd1'],['Black oxide','#2a2b2e'],['Gold','#d4a937'],['Damascus','#9fa3a8'],['Blood red','#8a1c1c']]},
          {key:'handle', label:'Handle wrap', opts:[['OD cord','#ffffff'],['Black','#3a3a3a'],['Red','#b03030'],['Tan','#c2a77a'],['Blue','#4a72b8']]},
          {key:'fittings', label:'Guard & pommel', opts:[['Brass','#b08a3a'],['Black','#202022'],['Steel','#b8bcc0'],['Gold','#d8b040']]} ],
};
function defaultConfig(id){
  const c={att:{}, paint:{}};
  for (const s of WEAPON_SLOTS[id]) c.att[s]=SLOT_DEFAULT[s]||null;
  for (const p of PAINT[id]) c.paint[p.key]=p.opts[0][0];
  return c;
}
const WCustom = (()=>{
  const saved=Store.get('wcustom', null), out={};
  for (const id of WEAPON_ORDER){ out[id]=defaultConfig(id); if (saved && saved[id]){ Object.assign(out[id].att, saved[id].att||{}); Object.assign(out[id].paint, saved[id].paint||{}); } }
  // migrate the previous Glock customizer
  const old=Store.get('glock', null);
  if (!saved && old){ const m={'Open red dot':'dot_open','Enclosed red dot':'dot_closed','Vertical foregrip':'vgrip','Brace stock':'brace','Skeleton stock':'skeleton','Folding stock':'folding','Extended (31)':'mag_ext','Drum (50)':'mag_drum','Compensator':'compensator','Suppressor':'suppressor','Laser':'laser','Flashlight':'flashlight'};
    const g=out.glock; if (m[old.sight]) g.att.optic=m[old.sight]; if (old.grip==='Vertical foregrip') g.att.under='vgrip'; else if (m[old.grip]) g.att.stock=m[old.grip];
    if (m[old.mag]) g.att.mag=m[old.mag]; if (m[old.muzzle]) g.att.muzzle=m[old.muzzle]; if (m[old.accessory]) g.att.other=m[old.accessory];
    for (const k of ['slide','frame','finish','skin']) if (old[k]) g.paint[k]=old[k]; }
  // sanitize
  for (const id of WEAPON_ORDER) for (const s in out[id].att){ const a=out[id].att[s]; if (a && (!ATTACHMENTS[a] || !ATTACHMENTS[a].for.includes(id) || ATTACHMENTS[a].cat!==s)) out[id].att[s]=SLOT_DEFAULT[s]||null; }
  return out;
})();
let WCustomSaved = JSON.parse(JSON.stringify(WCustom));
function saveWCustom(){ Store.set('wcustom', WCustom); WCustomSaved=JSON.parse(JSON.stringify(WCustom)); }
const STOCK_CONFIG = id => defaultConfig(id);           // what test bots carry
function attachmentsFor(id, slot){ return Object.entries(ATTACHMENTS).filter(([k,a])=>a.cat===slot && a.for.includes(id)).map(([k])=>k); }
function attachmentCount(id, cfg=WCustom[id]){ return Object.values(cfg.att).filter(a=>a && a!=='iron' && a!=='mag_std').length; }
function paintValue(id, key, cfg=WCustom[id]){ const p=PAINT[id].find(x=>x.key===key); const o=p.opts.find(o=>o[0]===cfg.paint[key])||p.opts[0]; return o[1]; }

// Gameplay statistics after attachments (this is what the game actually uses).
function weaponStats(id, opts={}){
  const base=WEAPON_DEFS[id], cfg=opts.cfg||WCustom[id];
  const d=Object.assign({}, base, {recoil:Object.assign({},base.recoil||{})});
  if (base.kind==='melee') return d;
  const m={recoil:0,hrecoil:0,vkick:0,ads:0,move:0,hip:0,range:0,reload:0,loud:0,flash:0,dmg:0};
  d.attachments=[];
  for (const s of WEAPON_SLOTS[id]){ const a=cfg.att[s]; if (!a) continue; const A=ATTACHMENTS[a]; d.attachments.push(a);
    for (const k in A.mods){ if (typeof A.mods[k]==='number' && k in m) m[k]+=A.mods[k]; }
    if (A.mods.zoom) d.adsZoom=Math.min(d.adsZoom, 1/A.mods.zoom);
    if (A.mods.cap) d.mag=A.mods.cap;
    if (A.mods.noFlash) d.noFlash=true; if (A.mods.noPing) d.noPing=true; if (A.mods.laser) d.laser=true; if (A.mods.glare) d.glare=true; }
  d.suppressed = d.attachments.includes('suppressor');
  d.recoil.p *= (1+m.recoil); d.recoil.y *= (1+m.recoil)*(1+m.hrecoil); d.recoil.kick=(base.recoil.kick||1)*(1+m.vkick);
  d.adsTime = (base.adsTime||0.15)/Math.max(0.3,1+m.ads);
  d.moveMul = (base.moveMul||1)*(1+m.move);
  d.spreadHip *= (1+m.hip);
  d.range *= (1+m.range); if (d.falloff) d.falloff=[d.falloff[0]*(1+m.range), d.falloff[1]*(1+m.range), d.falloff[2]];
  d.reloadTime = base.reloadTime*(1+m.reload);
  d.loudness = Math.max(0.2,1+m.loud); d.flash=(base.flash||1)*(1+m.flash)*(d.suppressed?0.25:1);
  d.dmg = base.dmg*(1+m.dmg);      // compensator: x0.85, applied after every other modifier
  d.zoomX = 1/(d.adsZoom||1); d.optic = d.attachments.includes('scope15')||d.attachments.includes('scope25');
  if (id==='glock' && opts.auto){
    // Switch: full auto. Accuracy = 1/spread, so spread is divided by 0.85 -> exactly 15% less accurate.
    d.kind='auto'; d.rpm=GLOCK_SWITCH_RPM; d.auto=true;
    d.spreadHip/=GLOCK_SWITCH_ACCURACY; d.spreadAds/=GLOCK_SWITCH_ACCURACY; d.spreadMove/=GLOCK_SWITCH_ACCURACY;
    d.recoil.p*=GLOCK_SWITCH_RECOIL; d.recoil.y*=GLOCK_SWITCH_RECOIL; d.recoil.kick*=GLOCK_SWITCH_RECOIL;
  }
  return d;
}
function weaponDef(id, glockAuto, cfg){ return weaponStats(id, {auto:glockAuto, cfg}); }
const glockStats = auto => weaponStats('glock',{auto});
// Procedural skin textures (applied to the real slide/frame materials)
const SKIN_TEX = {};
function skinTexture(name){
  if (SKIN_TEX[name]) return SKIN_TEX[name];
  const t = canvasTex(256,256,(g,w,h)=>{
    const R=Math.random;
    const fill=c=>{g.fillStyle=c; g.fillRect(0,0,w,h);};
    if (name==='Woodland camo'){ fill('#5a5a3a'); for (const c of ['#3b3f26','#7a6b45','#26261c','#4e6b3a']) for (let i=0;i<22;i++){ g.fillStyle=c; g.beginPath(); g.ellipse(R()*w,R()*h,10+R()*30,6+R()*18,R()*PI,0,PI*2); g.fill(); } }
    else if (name==='Tiger stripe'){ fill('#c47a22'); g.fillStyle='#1a1410'; for (let i=0;i<26;i++){ const y=R()*h; g.beginPath(); g.moveTo(0,y); for (let x=0;x<=w;x+=16) g.lineTo(x,y+Math.sin(x*0.05+i)*8+R()*6); g.lineTo(w,y+6+R()*8); for (let x=w;x>=0;x-=16) g.lineTo(x,y+5+Math.sin(x*0.05+i)*6); g.fill(); } }
    else if (name==='Digital'){ for (let y=0;y<h;y+=8) for (let x=0;x<w;x+=8){ g.fillStyle=['#6d7a86','#4b5560','#9aa6b0','#2f3740'][Math.floor(R()*4)]; g.fillRect(x,y,8,8);} }
    else if (name==='Carbon fiber'){ fill('#151515'); for (let y=0;y<h;y+=8) for (let x=0;x<w;x+=8){ g.fillStyle=((x+y)/8)%2?'#2a2a2a':'#1c1c1c'; g.fillRect(x,y,8,4); g.fillStyle=((x+y)/8)%2?'#1c1c1c':'#2a2a2a'; g.fillRect(x,y+4,8,4);} }
    else if (name==='Damascus'){ fill('#8a8d92'); for (let i=0;i<60;i++){ g.strokeStyle=i%2?'#4d5055':'#b9bcc1'; g.lineWidth=2+R()*2; g.beginPath(); const y=i*5; g.moveTo(0,y); for (let x=0;x<=w;x+=8) g.lineTo(x,y+Math.sin(x*0.04+i*0.4)*10); g.stroke(); } }
    else if (name==='Gold flake'){ fill('#9c7a18'); for (let i=0;i<900;i++){ g.fillStyle=['#f5d76e','#c9a227','#fff1a8','#7a5c10'][Math.floor(R()*4)]; g.fillRect(R()*w,R()*h,1+R()*3,1+R()*3);} }
    else if (name==='Street graffiti'){ fill('#222'); for (let i=0;i<40;i++){ g.strokeStyle=['#ff3b6b','#3fd0ff','#ffe23f','#7cff4f','#ffffff'][i%5]; g.lineWidth=3+R()*6; g.beginPath(); g.moveTo(R()*w,R()*h); g.bezierCurveTo(R()*w,R()*h,R()*w,R()*h,R()*w,R()*h); g.stroke(); } }
    else if (name==='Hex'){ fill('#2b2e33'); g.strokeStyle='#c9a227'; g.lineWidth=1.5; for (let y=0;y<h+16;y+=14) for (let x=0;x<w+16;x+=24){ const ox=(y/14)%2?12:0; g.beginPath(); for (let k=0;k<6;k++){ const a=k*PI/3; g.lineTo(x+ox+Math.cos(a)*7,y+Math.sin(a)*7);} g.closePath(); g.stroke(); } }
    noise(g,w,h,12);
  });
  return SKIN_TEX[name]=t;
}

// ---------- GLB assets ----------
const Assets = { glock:null, sniper:null };
function loadAssets(){
  const loader=new THREE.GLTFLoader();
  // GLB data ships inside assets/*.js as base64 (keeps the game a plain static site)
  const load=(name)=>new Promise((res,rej)=>{
    const b64=(window.GLB||{})[name]; if (!b64) return rej('missing '+name);
    const bin=atob(b64), buf=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
    loader.parse(buf.buffer, '', g=>res(g.scene), rej);
  });
  return Promise.all([load('glock'), load('sniper'), load('drako'), load('ar'), load('sg')]).then(([g,s,d,ar,sg])=>{
    // imported AR-15 and pump shotgun (assets/ar.js, assets/sg.js): grip at the origin, bore y≈0.07, muzzle toward -Z
    for (const sc of [ar,sg]) sc.traverse(o=>{ if (o.isMesh){ o.castShadow=true; for (const m of [].concat(o.material)){ m.metalnessMap=null; m.roughnessMap=null; m.metalness=Math.min(m.metalness,0.5); m.roughness=Math.max(m.roughness,0.4); m.needsUpdate=true; } } });
    Assets.ar15=ar; Assets.shotgun=sg;
    // imported Drako: textures shown as authored (renderer output is linear), materials named Metal / Wood
    d.traverse(o=>{ if (o.isMesh){ o.castShadow=true; for (const m of [].concat(o.material)){
      // metal/roughness maps use a second UV set (unsupported in r128) -> use plain values that read as gunmetal and oiled wood
      m.metalnessMap=null; m.roughnessMap=null; m.metalness = m.name==='Wood' ? 0.05 : 0.45; m.roughness = m.name==='Wood' ? 0.6 : 0.5; m.needsUpdate=true; } } });
    Assets.drako=d;
    for (const sc of [g,s]) sc.traverse(o=>{ if (o.isMesh){ o.castShadow=true;
      for (const m of [].concat(o.material)){ m.metalness=Math.min(m.metalness,0.55); m.roughness=Math.max(m.roughness,0.35); if (m.name==='Laser'){ m.emissive=new THREE.Color('#ff2020'); } if (m.name==='Red Dot'){ m.emissive=new THREE.Color('#ff1010'); } if (m.name==='Transparent Glass'||m.name==='Lens'){ m.transparent=true; m.opacity=0.35; } if (m.name==='Body'||m.name==='Body 2'){ m.color.multiplyScalar(1.6); } m.userData.base=m.color.clone(); } } });
    Assets.glock=g; Assets.sniper=s;
  });
}
// Wrap a GLB (barrel +X, Y up) into weapon space; materials are cloned so each gun can be painted on its own.
function wrapGlb(scene, scale, gripGlb){
  const outer=new THREE.Group(), inner=scene.clone(true);
  const cache=new Map();
  inner.traverse(o=>{ if (o.isMesh){ const m=o.material; if (!cache.has(m)){ const c=m.clone(); c.userData.base=(m.userData.base||m.color).clone(); cache.set(m,c); } o.material=cache.get(m); } });
  inner.rotation.y=PI/2; inner.scale.setScalar(scale);
  const g2w=(x,y,z)=>new V3(z*scale, y*scale, -x*scale);
  const off=g2w(...gripGlb).negate(); inner.position.copy(off);
  outer.add(inner);
  const P=(x,y,z)=>g2w(x,y,z).add(off);
  const parts={}; inner.traverse(o=>{ if (o.name) parts[o.name]=o; });
  return {outer, inner, P, parts, mats:[...cache.values()]};
}
const wmat = (c, r=0.5, m=0.3, map=null) => new THREE.MeshStandardMaterial({color:c, roughness:r, metalness:m, map});
const WOOD_TEX = canvasTex(128,64,(g,w,h)=>{ g.fillStyle='#b4783e'; g.fillRect(0,0,w,h); for (let i=0;i<40;i++){ g.strokeStyle=`rgba(${90+Math.random()*40|0},50,20,${0.25+Math.random()*0.3})`; g.lineWidth=1+Math.random()*2; g.beginPath(); const y=Math.random()*h; g.moveTo(0,y); for (let x=0;x<=w;x+=8) g.lineTo(x,y+Math.sin(x*0.08+i)*2); g.stroke(); } noise(g,w,h,14); });
const CORD_TEX = canvasTex(64,64,(g,w,h)=>{ g.fillStyle='#1e1e1e'; g.fillRect(0,0,w,h); for (let y=0;y<h;y+=8){ for (let x=0;x<w;x+=8){ g.fillStyle=((x+y)/8)%2?'#3c4a2c':'#2a3420'; g.beginPath(); g.ellipse(x+4,y+4,4,2.5,((x+y)/8)%2?0.6:-0.6,0,PI*2); g.fill(); } } });
const POLY_TEX = canvasTex(64,64,(g,w,h)=>{ g.fillStyle='#1b1b1c'; g.fillRect(0,0,w,h); for (let i=0;i<500;i++){ g.fillStyle=Math.random()<0.5?'#262628':'#121213'; g.fillRect(Math.random()*w,Math.random()*h,2,2);} });

// ---- optics modelled from the supplied references (tube centre at SCOPE_Y, real reticle plane inside the housing)
const SCOPE_Y=0.158;
// ---- ADS alignment per sight (weapon space): sight = the point put on the camera axis, eye = eye relief (m), rot = extra aim rotation
const ADS_TUNE = {
  iron:    {sight:[0,0.127,-0.1], eye:0.26, rot:[0,0,0]},
  scope15: {sight:[0,SCOPE_Y,-0.03], eye:0.16, rot:[0,0,0]},                 // 3D red dot with a thin housing
  scope25: {sight:[0,SCOPE_Y,-0.03], eye:0.14, rot:[0,0,0], overlay:true},   // 3D while aiming in, then full-screen scope view
};
function reticleTex(kind){
  return canvasTex(256,256,(g,w,h)=>{ g.clearRect(0,0,w,h); const c=w/2;
    if (kind==='15'){   // 1.5x: red ring with centre dot, black post from below
      g.strokeStyle='#ff2a1f'; g.lineWidth=5; g.beginPath(); g.arc(c,c,22,0,PI*2); g.stroke();
      g.fillStyle='#ff2a1f'; g.beginPath(); g.arc(c,c,4,0,PI*2); g.fill();
      g.fillStyle='#111'; g.fillRect(c-1.5,c+62,3,64);   // thin post from the reference, clear of the dot
    } else {            // 2.5x: red chevron with a centre stem and two thin side posts
      g.strokeStyle='#ff2a1f'; g.lineWidth=6; g.lineJoin='miter'; g.beginPath(); g.moveTo(c-18,c+16); g.lineTo(c,c-6); g.lineTo(c+18,c+16); g.stroke();
      g.fillStyle='#ff2a1f'; g.fillRect(c-3,c+4,6,52);
      g.fillStyle='#111'; g.fillRect(c-1.5,c+70,3,58); g.fillRect(c-110,c-1.5,60,3); g.fillRect(c+50,c-1.5,60,3);
    } }, false);
}
function scopeOptics(g, z0, z1, r, kind){
  // glass + reticle: the reticle plane sits inside the tube, so it is seen through the housing when aiming
  const glass=new THREE.MeshStandardMaterial({color:'#9fc4dc',roughness:0.05,metalness:0.4,transparent:true,opacity:0.16,depthWrite:false});
  for (const z of [z0,z1]){ const l=new THREE.Mesh(new THREE.CircleGeometry(r,24),glass); l.position.set(0,SCOPE_Y,z); if (z===z0) l.rotation.y=PI; g.add(l); }
  const ret=new THREE.Mesh(new THREE.PlaneGeometry(r*2,r*2), new THREE.MeshBasicMaterial({map:reticleTex(kind),transparent:true,depthWrite:false,side:THREE.DoubleSide}));
  ret.position.set(0,SCOPE_Y,(z0+z1)/2); ret.renderOrder=3; g.add(ret);
}
// hollow housing helpers: nothing solid crosses the optical axis, so the reticle is seen through the tube
function tubeShell(g, mat, r, len, z, seg=24){ const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,seg,1,true), mat); m.material.side=THREE.DoubleSide; m.rotation.x=PI/2; m.position.set(0,SCOPE_Y,z); m.castShadow=true; g.add(m); return m; }
function boxFrame(g, add, mat, w, h, len, z, hole){   // four slabs around a square hole
  const t=(w-hole)/2, tv=(h-hole)/2;
  add(bx(w,tv,len),mat,0,SCOPE_Y+hole/2+tv/2,z,0,0,0,g); add(bx(w,tv,len),mat,0,SCOPE_Y-hole/2-tv/2,z,0,0,0,g);
  add(bx(t,hole,len),mat,-hole/2-t/2,SCOPE_Y,z,0,0,0,g); add(bx(t,hole,len),mat,hole/2+t/2,SCOPE_Y,z,0,0,0,g);
}
function buildScope15(g, add){
  // 1.5x: compact tan body around a slim tube, thin black bezels; bolts sit on the front face outside the sight picture
  const fde=wmat('#a3967a',0.75,0.1), blk=wmat('#141415',0.5,0.4), bolt=wmat('#2a2a2b',0.4,0.7);
  const z=-0.07, L=0.06, r=0.0225;
  add(bx(0.03,0.016,0.07),blk,0,0.121,z,0,0,0,g);                                   // mount under the body (below the view)
  tubeShell(g, fde, r+0.004, L, z);
  add(bx(0.022,0.005,0.03),fde,0,SCOPE_Y+r+0.006,z,0,0,0,g);                        // low top hump (stays out of the sight picture)
  add(cy(0.0075,0.0075,0.01,8),fde,r+0.01,SCOPE_Y+0.006,z,0,0,PI/2,g);             // windage knob, outside the tube
  for (const zz of [z-L/2-0.002, z+L/2+0.002]){ const ring=new THREE.Mesh(new THREE.TorusGeometry(r+0.0015,0.0022,6,32),blk); ring.position.set(0,SCOPE_Y,zz); g.add(ring); }
  for (const [bx_,by_] of [[-0.024,0.022],[0.024,0.022],[-0.024,-0.022],[0.024,-0.022]]) add(cy(0.004,0.004,0.005,6),bolt,bx_,SCOPE_Y+by_,z-L/2-0.004,PI/2,0,0,g);
  scopeOptics(g, z-L/2-0.001, z+L/2+0.001, r, '15');
}
function buildScope25(g, add){
  // longer black housing with a rounded top, ring opening, four screws, mount underneath
  const blk=wmat('#1a1b1d',0.55,0.35), dk=wmat('#0e0e0f',0.6,0.3), bolt=wmat('#3a3a3c',0.4,0.7);
  const z=-0.07, L=0.11, r=0.0235;
  add(bx(0.03,0.016,0.1),dk,0,0.121,z,0,0,0,g);
  tubeShell(g, blk, 0.0255, L, z);
  add(bx(0.044,0.01,L),blk,0,SCOPE_Y-0.032,z,0,0,0,g);                    // flat base under the tube (outside the bore)
  add(bx(0.022,0.012,0.03),blk,0,SCOPE_Y+0.033,z,0,0,0,g);                // top turret
  add(cy(0.008,0.008,0.012,8),blk,0.0335,SCOPE_Y,z+0.01,0,0,PI/2,g);       // side turret now fully outside the tube wall
  const front=z-L/2-0.012, back=z+L/2+0.003;
  tubeShell(g, blk, 0.03, 0.022, z-L/2-0.006);                              // objective bell
  for (const zz of [front, back]){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(0.024,0.0042,8,28),dk); ring.position.set(0,SCOPE_Y,zz); g.add(ring);
    for (const [bx_,by_] of [[-0.021,0.02],[0.021,0.02],[-0.021,-0.02],[0.021,-0.02]]) add(cy(0.0035,0.0035,0.005,6),bolt,bx_,SCOPE_Y+by_,zz,PI/2,0,0,g);
  }
  scopeOptics(g, front, back, r, '25');
}
function buildDrako(){
  // imported Drako model (assets/drako.js): grip at the origin, bore at y=0.07, muzzle at z=-0.485, separate magazine mesh
  const G=new THREE.Group();
  const blk=wmat('#202123',0.45,0.55), poly=wmat('#1a1a1b',0.8,0.05,POLY_TEX), dk=wmat('#111',0.6,0.4);
  const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0,parent=G)=>{ const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.rotation.set(rx,ry,rz); m.castShadow=true; parent.add(m); return m; };
  const src=Assets.drako; let metal=null, wood=null, magMat=null; const mag=new THREE.Group(); mag.position.set(0,0.045,-0.115); G.add(mag);
  const fsight=new THREE.Group(); G.add(fsight);      // front sight assembly: folded away when an optic is mounted
  src.traverse(o=>{ if (!o.isMesh) return;
    const mats=[].concat(o.material).map(m=>{ if (m.name==='Wood'){ if (!wood){ wood=m.clone(); wood.userData.tex=wood.map; } return wood; }
      if (/mag/i.test(o.name)){ if (!magMat){ magMat=m.clone(); magMat.userData.tex=magMat.map; } return magMat; }
      if (!metal){ metal=m.clone(); metal.userData.tex=metal.map; } return metal; });
    const mesh=new THREE.Mesh(o.geometry, Array.isArray(o.material)?mats:mats[0]); mesh.castShadow=true;
    o.updateWorldMatrix(true,false); mesh.applyMatrix4(o.matrixWorld);
    let isF=false; for (let p=o; p; p=p.parent) if (/fsight/i.test(p.name)) isF=true;
    if (/mag/i.test(o.name)){ mesh.position.sub(mag.position); mag.add(mesh); } else if (isF) fsight.add(mesh); else G.add(mesh); });
  if (!magMat) magMat=metal.clone();
  const rear=new THREE.Group(); G.add(rear);     // the imported model carries its own iron sights
  // ----- attachments (built once, shown per config)
  const att={};
  const mk=(name,fn)=>{ const g=new THREE.Group(); g.name=name; fn(g); g.visible=false; G.add(g); att[name]=g; return g; };
  mk('scope15', g=>buildScope15(g, add));
  mk('scope25', g=>buildScope25(g, add));
  mk('vgrip', g=>{ add(bx(0.022,0.01,0.03),dk,0,0.035,-0.3,0,0,0,g); add(cy(0.014,0.016,0.075,8),poly,0,-0.006,-0.3,0,0,0,g); });
  mk('suppressor', g=>{ add(cy(0.022,0.022,0.17,12),dk,0,0.07,-0.57,PI/2,0,0,g); add(cy(0.018,0.022,0.012,12),blk,0,0.07,-0.66,PI/2,0,0,g); });
  mk('compensator', g=>{ add(cy(0.017,0.017,0.05,8),blk,0,0.07,-0.5,PI/2,0,0,g); for (const zz of [-0.49,-0.505,-0.52]) add(bx(0.036,0.004,0.006),dk,0,0.085,zz,0,0,0,g); });
  mk('laser', g=>{ add(bx(0.018,0.022,0.045),dk,0.032,0.07,-0.3,0,0,0,g); add(cy(0.006,0.006,0.006,8),wmat('#ff2a2a',0.3,0),0.032,0.07,-0.325,PI/2,0,0,g); });
  return {group:G, support:new V3(0,0.035,-0.3), muzzle:new V3(0,0.07,-0.49), sight:new V3(0,0.127,-0.1), parts:{mag, rear, fsight, att, mats:{blk:metal,wood,poly,magMat}}};
}
// Imported long guns (AR-15 / shotgun): meshes copied into one group with cloned materials; the magazine and the iron sights
// are kept as their own groups (mag drops on reload, irons are hidden under an optic)
const GUN_SPEC = {
  ar15:   {muzzle:[0,0.07,-0.41], sight:[0,0.099,-0.06], eye:0.3, support:[0,0.0,-0.255], railY:0.095, magRe:/mag/i, ironRe:/ironsight/i},
  shotgun:{muzzle:[0,0.071,-0.845], sight:[0,0.106,-0.14], eye:0.38, support:[0,0.02,-0.36], railY:null, magRe:null, ironRe:null},
};
function buildImportedGun(id){
  const G=new THREE.Group(), S=GUN_SPEC[id], src=Assets[id];
  const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0,parent=G)=>{ const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.rotation.set(rx,ry,rz); m.castShadow=true; parent.add(m); return m; };
  const mag=new THREE.Group(), irons=new THREE.Group(); G.add(mag); G.add(irons);
  const mats=new Map(); src.updateMatrixWorld(true);
  src.traverse(o=>{ if (!o.isMesh) return;
    const m0=o.material; if (!mats.has(m0)){ const c=m0.clone(); c.userData.base=m0.color.clone(); mats.set(m0,c); }
    const mesh=new THREE.Mesh(o.geometry, mats.get(m0)); mesh.castShadow=true; mesh.applyMatrix4(o.matrixWorld);
    let isMag=false; for (let p=o; p; p=p.parent) if (S.magRe && S.magRe.test(p.name)) isMag=true; if (S.magRe && S.magRe.test(m0.name)) isMag=true;
    if (isMag) mag.add(mesh); else if (S.ironRe && S.ironRe.test(m0.name)) irons.add(mesh); else G.add(mesh); });
  const dk=wmat('#111',0.6,0.4), blk=wmat('#202123',0.45,0.55), att={};
  const mk=(name,fn)=>{ const g=new THREE.Group(); g.name=name; fn(g); g.visible=false; G.add(g); att[name]=g; return g; };
  const mz=S.muzzle;
  if (S.railY!==null){
    // the drako optics sit on a 0.113 m mount base: drop them onto this rail
    const dy=S.railY-0.113;
    mk('scope15', g=>{ buildScope15(g, add); g.position.y=dy; });
    mk('scope25', g=>{ buildScope25(g, add); g.position.y=dy; });
  }
  mk('suppressor', g=>{ add(cy(0.021,0.021,0.17,12),dk,0,mz[1],mz[2]-0.085,PI/2,0,0,g); add(cy(0.017,0.021,0.012,12),blk,0,mz[1],mz[2]-0.175,PI/2,0,0,g); });
  mk('compensator', g=>{ add(cy(0.016,0.016,0.05,8),blk,0,mz[1],mz[2]-0.02,PI/2,0,0,g); for (const dz of [0.0,-0.015,-0.03]) add(bx(0.034,0.004,0.006),dk,0,mz[1]+0.015,mz[2]+dz,0,0,0,g); });
  mk('laser', g=>{ const z=S.support[2]-0.05; add(bx(0.018,0.022,0.045),dk,0.03,mz[1]-0.005,z,0,0,0,g); add(cy(0.006,0.006,0.006,8),wmat('#ff2a2a',0.3,0),0.03,mz[1]-0.005,z-0.025,PI/2,0,0,g); });
  return {group:G, support:new V3(...S.support), muzzle:new V3(...mz), sight:new V3(...S.sight), parts:{mag, irons, att, mats:[...mats.values()]}};
}
function buildKnife(){
  const G=new THREE.Group();
  const steel=wmat('#c9ccd1',0.25,0.85), edge=wmat('#eef0f2',0.15,0.9), dk=wmat('#1a1a1a',0.6,0.3), cord=wmat('#ffffff',0.9,0,CORD_TEX), brass=wmat('#b08a3a',0.35,0.8);
  const s=new THREE.Shape();
  s.moveTo(0,0); s.lineTo(0.12,0.002); s.quadraticCurveTo(0.165,0.004,0.185,0.026); s.lineTo(0.135,0.03); s.quadraticCurveTo(0.1,0.034,0.06,0.034); s.lineTo(0,0.032); s.lineTo(0,0);
  const geo=new THREE.ExtrudeGeometry(s,{depth:0.004,bevelEnabled:true,bevelThickness:0.0015,bevelSize:0.0015,bevelSegments:1,curveSegments:6});
  geo.translate(0,-0.016,-0.002);
  const blade=new THREE.Mesh(geo,steel); blade.rotation.y=PI/2; blade.position.set(0,0.0,-0.065); blade.castShadow=true; G.add(blade);
  const ed=new THREE.Mesh(bx(0.0012,0.004,0.12),edge); ed.position.set(0,-0.0155,-0.12); G.add(ed);
  const fuller=new THREE.Mesh(bx(0.0062,0.004,0.09),dk); fuller.position.set(0,0.004,-0.12); G.add(fuller);
  const guard=new THREE.Mesh(bx(0.016,0.052,0.012),brass); guard.position.set(0,0.0,-0.06); G.add(guard);
  const handle=new THREE.Mesh(bx(0.024,0.03,0.105),cord); G.add(handle);
  const pommel=new THREE.Mesh(bx(0.026,0.034,0.016),brass); pommel.position.set(0,0,0.06); G.add(pommel);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.01,0.003,4,8),brass); ring.position.set(0,-0.006,0.075); G.add(ring);
  return {group:G, support:null, muzzle:new V3(0,0,-0.25), sight:new V3(0,0.05,0), parts:{mats:{steel,cord,brass}}};
}
// procedural muzzle devices / laser for the imported sniper rifle
function sniperExtras(w){
  const add=(geo,mat,x,y,z,rx=0)=>{ const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.rotation.x=rx; m.castShadow=true; return m; };
  const dk=wmat('#161718',0.5,0.5), att={};
  const mz=w.muzzle0;
  att.suppressor=new THREE.Group(); att.suppressor.add(add(cy(0.022,0.022,0.2,12),dk,0,mz.y,mz.z-0.1,PI/2));
  att.laser=new THREE.Group(); att.laser.add(add(bx(0.02,0.022,0.05),dk,0.03,w.support.y+0.02,w.support.z-0.05)); att.laser.add(add(cy(0.006,0.006,0.006,8),wmat('#ff2a2a',0.3,0),0.03,w.support.y+0.02,w.support.z-0.078,PI/2));
  for (const k in att){ att[k].visible=false; w.model.add(att[k]); }
  return att;
}

// Hold placements
const HOLDS = {
  //            third-person grip offset (holdPivot space) | first-person hip | first-person ADS distance
  drako:  {tp:[0.07,-0.13,-0.19],  vm:[0.07,-0.165,-0.25],  ads:0.26, vmRot:[0,0.04,0]},
  ar15:   {tp:[0.07,-0.13,-0.19],  vm:[0.12,-0.19,-0.36],  ads:0.3, vmRot:[0.02,0.07,0]},
  shotgun:{tp:[0.07,-0.13,-0.17],  vm:[0.11,-0.19,-0.3],  ads:0.36, vmRot:[0.02,0.06,0]},
  glock:  {tp:[0.06,-0.06,-0.47], vm:[0.12,-0.16,-0.36], ads:0.38, vmRot:[0.06,0.1,0.03], cant:0, vmFov:40},   // ADS: front sight dead centre, both hands visible below (two-hand wrap)   // hip: bottom-right, tilted up/inward; ADS: 32 cm, slight cant, viewmodel lens narrowed so the pistol reads big
  sniper: {tp:[0.07,-0.11,-0.15], vm:[0.08,-0.17,-0.2], ads:0.2,  vmRot:[0,0.03,0]},
  knife:  {tp:[0.22,-0.42,-0.32], vm:[0.16,-0.17,-0.36],  ads:0.34, vmRot:[0.35,0.25,0.35]},
};

// Create a weapon instance. cfg = attachment/paint config (defaults to the player's saved one).
function createWeapon(id, cfg){
  let w;
  if (id==='drako'){ const d=buildDrako(); w={model:d.group, support:d.support, muzzle:d.muzzle, sight:d.sight, parts:d.parts}; }
  else if (id==='ar15' || id==='shotgun'){ const d=buildImportedGun(id); w={model:d.group, support:d.support, muzzle:d.muzzle, sight:d.sight, parts:d.parts, mats:d.parts.mats}; }
  else if (id==='knife'){ const d=buildKnife(); w={model:d.group, support:null, muzzle:d.muzzle, sight:d.sight, parts:d.parts}; }
  else if (id==='glock'){
    const W=wrapGlb(Assets.glock, 0.032, [-1.55,2.05,0]);
    const slide=[]; W.parts.body && W.parts.body.traverse(o=>{ if (o.isMesh && ['Pistol Slide','Sight','Glock Sight','Ejection Port','Muzzle'].includes(o.material.name)) slide.push(o); });
    if (W.parts.laser) W.parts.laser.traverse(o=>{ if (o.isMesh && o.material.name==='Laser') o.visible=false; });   // replaced by a raycast beam that stops at walls
    w={model:W.outer, support:null, muzzle:W.P(2.9,3.62,0), sight:W.P(-1.0,4.36,0), parts:Object.assign({slide}, W.parts), P:W.P, glb:W, mats:W.mats};
    w.supportBase=W.P(-1.65,1.55,-0.55);
    // bright unlit sight dots (front post + two rear) so the sight picture pops
    const dm=new THREE.MeshBasicMaterial({color:'#7dff6a'}), dg=new THREE.SphereGeometry(0.0016,8,6);
    for (const [x,y,z] of [[0,0.0638,-0.119],[-0.0046,0.0618,0.0262],[0.0046,0.0618,0.0262]]){ const d=new THREE.Mesh(dg,dm); d.position.set(x,y,z); W.outer.add(d); }
  } else if (id==='sniper'){
    const W=wrapGlb(Assets.sniper, 0.0833, [-2.6,-0.3,0]);
    w={model:W.outer, support:W.P(1.5,-0.15,-0.05), muzzle:W.P(7.25,0.45,0), sight:W.P(-3.0,1.16,0), parts:{mag:W.parts.mag, bolt:W.parts.bolt, scope:W.parts.scope}, mats:W.mats};
    w.muzzle0=w.muzzle.clone(); w.parts.att=sniperExtras(w);
  }
  w.id=id; w.grip=new V3(0,0,0); w.tpHold=HOLDS[id].tp; w.hold=HOLDS[id];
  w.kickMul=(WEAPON_DEFS[id].recoil||{kick:0.5}).kick;
  w.cfg = cfg || WCustom[id];
  w.model.traverse(o=>{ if (o.isMesh) o.castShadow=true; });
  applyWeaponConfig(w);
  return w;
}
const _col=new THREE.Color();
// Show the right parts and paint for a weapon instance (called on create and on every customization change)
function applyWeaponConfig(w, cfg){
  if (cfg) w.cfg=cfg; const c=w.cfg, id=w.id, on=new Set(Object.values(c.att).filter(Boolean));
  if (id==='glock'){
    const p=w.parts, parts=new Set();
    for (const a of on){ const A=ATTACHMENTS[a]; if (A.part) parts.add(A.part); }
    if (on.has('vgrip')||on.has('flashlight')||on.has('laser')) parts.add('rail');
    for (const name of ['mag_std','mag_ext','mag_drum','rail','optic_a','optic_b','comp','foregrip','stock_a','stock_b','stock_c','flashlight','laser','silencer']) if (p[name]) p[name].visible = parts.has(name);
    p.mag = p[ATTACHMENTS[c.att.mag||'mag_std'].part];
    for (const n of ['mag_std','mag_ext','mag_drum']) if (p[n] && p[n].userData.y0===undefined) p[n].userData.y0=p[n].position.y;
    w.support = on.has('vgrip') ? w.P(1.8,1.25,0) : w.supportBase.clone();
    // iron sights: the front-post dot goes on the crosshair, and the gun is pitched so the rear dots sit level with it (3-dot picture)
    const dot=on.has('dot_open')||on.has('dot_closed');
    w.sight = dot ? w.P(0.6,4.66,0) : new V3(0,0.0638,-0.119); w.adsRot = dot ? [0,0,0] : [-Math.atan2(0.0638-0.0618, 0.0262+0.119),0,0];
    w.muzzle = on.has('suppressor') ? w.P(7.3,3.68,0) : on.has('compensator') ? w.P(5.1,3.4,0) : w.P(2.9,3.62,0);
    w.laserFrom = w.P(2.6,1.9,0);
    const fin=paintValue('glock','finish',c), skin=c.paint.skin;
    const tex = skin && skin!=='None' ? skinTexture(skin) : null;
    for (const m of w.mats){
      if (m.name==='Pistol Slide'||m.name==='Pistol Body'){
        m.color.set(paintValue('glock', m.name==='Pistol Slide'?'slide':'frame', c)); if (tex) m.color.lerp(new THREE.Color('#ffffff'),0.65);
        m.roughness = m.name==='Pistol Slide' ? fin.r : Math.min(1,fin.r+0.2); m.metalness = m.name==='Pistol Slide' ? fin.m : fin.m*0.4;
        if (m.map!==tex){ m.map=tex; m.needsUpdate=true; } }
    }
  } else if (id==='drako'){
    const a=w.parts.att; for (const k in a) a[k].visible=on.has(k);
    const scoped=on.has('scope15')||on.has('scope25');
    w.parts.rear.visible=!scoped; if (w.parts.fsight) w.parts.fsight.visible=!scoped;
    const T=ADS_TUNE[on.has('scope15')?'scope15':on.has('scope25')?'scope25':'iron'];
    w.sight=new V3(...T.sight); w.adsDist=T.eye; w.adsRot=T.rot; w.optic=T.overlay?'overlay':scoped?'3d':null;
    w.muzzle = on.has('suppressor') ? new V3(0,0.07,-0.66) : on.has('compensator') ? new V3(0,0.07,-0.53) : new V3(0,0.07,-0.49);
    w.support = on.has('vgrip') ? new V3(0,-0.02,-0.3) : new V3(0,0.035,-0.3);
    w.laserFrom = new V3(0.032,0.07,-0.33);
    const M=w.parts.mats, fin=paintValue('drako','finish',c);
    // imported textures stay; paint tints the metal and replaces the wood with polymer colours
    const mt=paintValue('drako','metal',c);
    for (const m of [M.blk, M.magMat]){ if (mt) m.color.set(mt).multiplyScalar(3.2); else m.color.set('#ffffff').multiplyScalar(1.15); m.roughness=fin.r; m.metalness=fin.m*0.8; }
    const fur=paintValue('drako','furniture',c), woodLike=!fur || c.paint.furniture==='Dark walnut';
    const want = woodLike ? M.wood.userData.tex : null;
    if (M.wood.map!==want){ M.wood.map=want; M.wood.needsUpdate=true; }
    M.wood.color.set(!fur ? '#ffffff' : c.paint.furniture==='Dark walnut' ? '#7a5a48' : fur); if (!fur) M.wood.color.multiplyScalar(1.15);
    M.wood.roughness = woodLike?0.6:0.85; M.wood.metalness=0.05;
  } else if (id==='ar15' || id==='shotgun'){
    const a=w.parts.att, S=GUN_SPEC[id]; for (const k in a) a[k].visible=on.has(k);
    const scoped=on.has('scope15')||on.has('scope25'); if (w.parts.irons) w.parts.irons.visible=!scoped;
    if (scoped){ const T=ADS_TUNE[on.has('scope15')?'scope15':'scope25'], dy=(S.railY||0.113)-0.113; w.sight=new V3(T.sight[0],T.sight[1]+dy,T.sight[2]); w.adsDist=T.eye; w.adsRot=T.rot; w.optic=T.overlay?'overlay':'3d'; }
    else { w.sight=new V3(...S.sight); w.adsDist=S.eye; w.adsRot=[0,0,0]; w.optic=null; }
    const mz=new V3(...S.muzzle); w.muzzle = on.has('suppressor') ? mz.clone().add(new V3(0,0,-0.18)) : on.has('compensator') ? mz.clone().add(new V3(0,0,-0.045)) : mz;
    w.laserFrom = new V3(0.03,S.muzzle[1]-0.005,S.support[2]-0.075);
    const mt=paintValue(id,'metal',c), fin=paintValue(id,'finish',c);
    for (const m of w.mats){ const base=m.userData.base; if (mt){ m.color.set(mt).multiplyScalar(2.2); } else if (base) m.color.copy(base); m.roughness=fin.r; m.metalness=fin.m*0.7; }
  } else if (id==='sniper'){
    const a=w.parts.att; for (const k in a) a[k].visible=on.has(k);
    w.muzzle = on.has('suppressor') ? new V3(0,w.muzzle0.y,w.muzzle0.z-0.2) : w.muzzle0.clone();
    w.laserFrom = new V3(0.03,w.support.y+0.02,w.support.z-0.08);
    const st=paintValue('sniper','stock',c), mt=paintValue('sniper','metal',c);
    for (const m of w.mats){ const isStock=/^Body/.test(m.name), base=m.userData.base;
      const v = isStock ? st : mt;
      if (v) m.color.set(v).multiplyScalar(isStock?1:1); else if (base) m.color.copy(base); }
  } else if (id==='knife'){
    const M=w.parts.mats; M.steel.color.set(paintValue('knife','blade',c)); M.cord.color.set(paintValue('knife','handle',c)); M.brass.color.set(paintValue('knife','fittings',c));
    if (c.paint.blade==='Damascus'){ if (M.steel.map!==skinTexture('Damascus')){ M.steel.map=skinTexture('Damascus'); M.steel.needsUpdate=true; } } else if (M.steel.map){ M.steel.map=null; M.steel.needsUpdate=true; }
  }
  const st=weaponStats(id,{cfg:c}); if (st.recoil && st.recoil.kick) w.kickMul=st.recoil.kick;
}
// ---------- Imported "blunt" item model (healing item) ----------
let BluntAsset=null;
function loadBluntAsset(){
  return new Promise((res)=>{
    const b64=(window.GLB||{}).blunt; if (!b64){ res(); return; }
    const bin=atob(b64), buf=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(buf.buffer,'',g=>{ BluntAsset=g.scene; res(); }, ()=>res());
  });
}
function makeBluntModel(){
  const g=new THREE.Group();
  if (BluntAsset){
    const m=BluntAsset.clone(true); const box=new THREE.Box3().setFromObject(m), sz=box.getSize(new V3()), c=box.getCenter(new V3());
    const s=0.085/Math.max(sz.x,sz.y,sz.z); m.scale.setScalar(s); m.position.copy(c).multiplyScalar(-s); g.add(m);
    const ember=new THREE.Mesh(new THREE.SphereGeometry(0.006,6,4), new THREE.MeshBasicMaterial({color:'#ff6a1a'}));
    // the model's long axis is Y
    ember.position.y = sz.y>sz.x ? 0.043 : 0; ember.position.x = sz.y>sz.x ? 0 : 0.043; g.add(ember);
  }
  return g;
}

// ---------- The bag (THE FIGHT FOR ZA objective): the clear ziplock bag ----------
function makeBagModel(){
  const g=new THREE.Group();
  const plastic=new THREE.MeshStandardMaterial({color:'#dfe9ee',roughness:0.15,metalness:0,transparent:true,opacity:0.38,depthWrite:false});
  const seal=new THREE.MeshLambertMaterial({color:'#2f6fd0'}), cash=new THREE.MeshLambertMaterial({color:'#6f9a5a'}), band=new THREE.MeshLambertMaterial({color:'#d8c48a'});
  const bag=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.3,0.08), plastic); g.add(bag);
  for (const y of [0.15,0.135]) { const s=new THREE.Mesh(new THREE.BoxGeometry(0.285,0.008,0.085), seal); s.position.y=y; g.add(s); }
  for (let i=0;i<3;i++) for (let j=0;j<2;j++){ const c=new THREE.Mesh(new THREE.BoxGeometry(0.11,0.06,0.05), cash); c.position.set(-0.06+j*0.12,-0.1+i*0.07,0); c.rotation.z=(i+j)%2?0.08:-0.06; g.add(c);
    const b=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.062,0.052), band); b.position.copy(c.position); b.rotation.z=c.rotation.z; g.add(b); }
  g.traverse(o=>{ if (o.isMesh) o.castShadow=true; });
  return g;
}
// ---------- Backpack (kept for compatibility) ----------
function makeBackpackModel(){
  const g=new THREE.Group();
  const nylon=new THREE.MeshLambertMaterial({color:'#b51f2a'}), dark=new THREE.MeshLambertMaterial({color:'#1b1b1d'}), zip=new THREE.MeshLambertMaterial({color:'#d9b13a'});
  const add=(geo,mat,x,y,z,rx=0)=>{ const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.rotation.x=rx; m.castShadow=true; g.add(m); return m; };
  add(new THREE.BoxGeometry(0.3,0.42,0.16), nylon, 0,0,0);
  add(new THREE.CylinderGeometry(0.15,0.15,0.3,10,1,false,0,PI), nylon, 0,0.21,0, 0).rotation.z=PI/2;
  add(new THREE.BoxGeometry(0.24,0.18,0.07), nylon, 0,-0.08,-0.11);
  add(new THREE.BoxGeometry(0.25,0.012,0.012), zip, 0,0.01,-0.146);
  for (const x of [-0.09,0.09]) add(new THREE.BoxGeometry(0.04,0.4,0.02), dark, x,0.02,0.09);
  add(new THREE.BoxGeometry(0.12,0.03,0.04), dark, 0,0.27,0.02);
  return g;
}
