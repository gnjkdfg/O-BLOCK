'use strict';
/* Consumable items and timed effects.
   BLUNT  (H) — 3 s smoke: heals 30 and raises max health by 20% until you die (one raise per life).
   BEER   (K) — 2.4 s drink: heals 25 over 5 s; for 20 s you take 10% less damage, with a slight aim sway.
   ZYN    (J) — 1.3 s: +50% accuracy (spread ÷1.5) for 30 s, kept across weapon switches.
   NIC    (T) — from the Tap the Nic kill streak (see streaks.js): +35% run/sprint speed, -20% stamina capacity, exactly 10 s.
   No effect stacks: using an item whose effect is still running is refused and the item is kept.
   Trunk loot rolls every item independently (beer 1/7, blunt 1/5, Zyn 1/8, ammo 1/4); each trunk can be searched once per match.
   No item images were supplied, so the HUD icons and the in-hand can / tin are drawn in code. */
const ITEMS = {
  blunt:{name:'BLUNT', max:3, action:'smoke', capMul:1.2, heal:30},
  beer: {name:'BEER',  max:3, action:'beer', dur:2.4, heal:25, healOver:5, buzz:20, dmgTaken:0.9, sway:0.0035},
  zyn:  {name:'ZYN',   max:3, action:'zyn',  dur:1.3, effect:30, spreadMul:1/1.5},
};
const LOOT_TABLE = { beer:1/7, blunt:1/5, zyn:1/8, ammo:1/4 };

const Effects = {
  zyn:0, beer:0, beerHeal:0,
  reset(){ this.zyn=0; this.beer=0; this.beerHeal=0; },
  update(dt){
    this.zyn=Math.max(0,this.zyn-dt); this.beer=Math.max(0,this.beer-dt);
    if (this.beerHeal>0 && P.alive){ const k=Math.min(this.beerHeal, ITEMS.beer.heal/ITEMS.beer.healOver*dt); this.beerHeal-=k; P.hp=Math.min(P.maxHp(), P.hp+k); }
  },
  spreadMul(){ return this.zyn>0 ? ITEMS.zyn.spreadMul : 1; },
  dmgTakenMul(){ return this.beer>0 ? ITEMS.beer.dmgTaken : 1; },
  // slight drunk sway (radians) while the beer buzz lasts
  sway(t){ if (this.beer<=0) return [0,0]; const k=Math.min(1,this.beer/3)*ITEMS.beer.sway; return [Math.sin(t*0.9)*k, Math.sin(t*1.3+1)*k*0.6]; },
};

function itemBusy(){ return P.smoking || P.using || Perks.busy() || P.inCar || P.riding || P.ladder || P.anim || P.search; }
function useItem(kind){
  if (!P.alive || Game.state!=='playing' || Mode.ended) return;
  if (kind==='blunt') return startSmoking();
  const I=ITEMS[kind]; if (!I) return;
  if ((P.items[kind]||0)<=0){ Bus.emit('toast',{t:'NO '+I.name, kind:'warn'}); return; }
  if (itemBusy()) return;
  if (kind==='zyn' && Effects.zyn>0){ Bus.emit('toast',{t:'ZYN ALREADY ACTIVE · NO STACKING', kind:'warn'}); return; }
  if (kind==='beer' && Effects.beer>0){ Bus.emit('toast',{t:'STILL BUZZED · NO STACKING', kind:'warn'}); return; }
  P.items[kind]--; P.using={kind, t:0, dur:I.dur};
  Arsenal.trigger=false; Arsenal.ads=false; Snd.autoStop(); if (Arsenal.state==='reload') Arsenal.cancelReload();
  if (kind==='beer') Snd.canOpen(); else Snd.zynTin();
}
function updateUsing(dt){
  const U=P.using; if (!U) return;
  if (!P.alive){ P.using=null; return; }
  const t0=U.t; U.t+=dt;
  if (U.kind==='beer' && t0<0.7 && U.t>=0.7) Snd.gulps(3);
  if (U.t>=U.dur){
    P.using=null;
    if (Net.inMatch) Net.send({t:'use', item:U.kind});
    if (U.kind==='beer'){ Effects.beer=ITEMS.beer.buzz; Effects.beerHeal=Net.inMatch?0:ITEMS.beer.heal; Bus.emit('toast',{t:'BEER · +25 HP OVER 5s · -10% DAMAGE TAKEN '+ITEMS.beer.buzz+'s', kind:'ok'}); }
    else { Effects.zyn=ITEMS.zyn.effect; Bus.emit('toast',{t:'ZYN · +50% ACCURACY '+ITEMS.zyn.effect+'s', kind:'ok'}); }
  }
}
// hand-to-mouth curve for drinking / pouching (0 = down, 1 = at the mouth)
function useCurve(t, dur){ const up=0.4, down=0.35; if (t<up){ const u=t/up; return 1-(1-u)*(1-u); } if (t>dur-down) return Math.max(0,(dur-t)/down); return 1; }

// independent loot rolls for one trunk; returns what was found
function rollTrunk(){
  const found=[];
  for (const k of ['beer','blunt','zyn']) if (Math.random()<LOOT_TABLE[k]){ if ((P.items[k]||0)<ITEMS[k].max){ P.items[k]=(P.items[k]||0)+1; found.push(k); } else found.push(k+'-full'); }
  if (Math.random()<LOOT_TABLE.ammo){ const a=Arsenal.ammo[Arsenal.firearm], d=weaponDef(Arsenal.firearm); if (a){ a.res+=Math.ceil(d.mag*0.5); found.push('ammo'); } }
  return found;
}

// ---- drawn models (no image files were supplied for these items)
function itemTex(kind){
  return canvasTex(128,64,(g,w,h)=>{
    if (kind==='beer'){ g.fillStyle='#c8ccd2'; g.fillRect(0,0,w,h); g.fillStyle='#1d3f8f'; g.fillRect(0,10,w,44); g.fillStyle='#d7b13a'; g.fillRect(0,26,w,6);
      g.fillStyle='#fff'; g.font='bold 15px sans-serif'; g.textAlign='center'; g.fillText('LAGER',w/4,22); g.fillText('LAGER',w*3/4,22); g.font='bold 9px sans-serif'; g.fillText('ICE COLD',w/4,48); g.fillText('ICE COLD',w*3/4,48); }
    else { g.fillStyle='#f2f4f6'; g.fillRect(0,0,w,h); g.fillStyle='#2e6fd1'; g.beginPath(); g.arc(w/2,h/2,26,0,PI*2); g.fill();
      g.fillStyle='#fff'; g.font='bold 18px sans-serif'; g.textAlign='center'; g.textBaseline='middle'; g.fillText('ZYN',w/2,h/2+1); }
  }, false);
}
function makeCanModel(){
  const g=new THREE.Group(), tex=itemTex('beer');
  const body=new THREE.Mesh(new THREE.CylinderGeometry(0.033,0.033,0.115,16,1,true), new THREE.MeshStandardMaterial({map:tex, roughness:0.35, metalness:0.6}));
  const top=new THREE.Mesh(new THREE.CylinderGeometry(0.029,0.033,0.008,16), new THREE.MeshStandardMaterial({color:'#b9bec4', roughness:0.3, metalness:0.8})); top.position.y=0.061;
  const bot=top.clone(); bot.position.y=-0.061; bot.rotation.x=PI;
  g.add(body,top,bot); g.traverse(o=>{ o.frustumCulled=false; if (o.isMesh) o.castShadow=true; }); g.visible=false; return g;
}
function makeZynModel(){
  const g=new THREE.Group(), tex=itemTex('zyn');
  const tin=new THREE.Mesh(new THREE.CylinderGeometry(0.034,0.034,0.02,20), [new THREE.MeshStandardMaterial({color:'#e9edf1',roughness:0.4}), new THREE.MeshStandardMaterial({map:tex,roughness:0.4}), new THREE.MeshStandardMaterial({color:'#e9edf1',roughness:0.4})]);
  tin.rotation.x=PI/2; g.add(tin);
  g.traverse(o=>{ o.frustumCulled=false; if (o.isMesh) o.castShadow=true; }); g.visible=false; return g;
}
// small HUD icons (inline SVG) for the item counters
const ITEM_ICON = {
  blunt:'<svg viewBox="0 0 24 12" width="22" height="11"><rect x="1" y="4" width="18" height="4" rx="2" fill="#8a5a32"/><circle cx="20" cy="6" r="2.2" fill="#ff7a2a"/></svg>',
  beer:'<svg viewBox="0 0 12 18" width="10" height="15"><rect x="1" y="2" width="10" height="15" rx="2" fill="#1d3f8f"/><rect x="1" y="8" width="10" height="2" fill="#d7b13a"/><rect x="2" y="0.5" width="8" height="2" rx="1" fill="#c8ccd2"/></svg>',
  zyn:'<svg viewBox="0 0 18 18" width="15" height="15"><circle cx="9" cy="9" r="8" fill="#f2f4f6"/><circle cx="9" cy="9" r="5" fill="#2e6fd1"/></svg>',
  nic:'<svg viewBox="0 0 10 20" width="8" height="16"><rect x="1" y="1" width="8" height="18" rx="3" fill="#e6a0c0"/><rect x="2" y="15" width="6" height="1.5" fill="#ff3b8a"/></svg>',
};
