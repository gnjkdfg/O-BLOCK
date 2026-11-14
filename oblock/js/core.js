'use strict';
/* Core helpers, deterministic RNG (map generation), saved settings. */

let _seed = 20261111;
function rnd(){ _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; }
const rr = (a,b) => a + rnd()*(b-a);
const pick = a => a[Math.floor(rnd()*a.length)];
const PI = Math.PI;
const clamp = (v,a,b) => v<a?a:v>b?b:v;
const lerp = (a,b,t) => a+(b-a)*t;
const damp = (a,b,k,dt) => a+(b-a)*(1-Math.exp(-k*dt));
const V3 = THREE.Vector3;

const Store = {
  get(k, def){ try { const v = localStorage.getItem('oblock_'+k); return v==null ? def : JSON.parse(v); } catch(e){ return def; } },
  set(k, v){ try { localStorage.setItem('oblock_'+k, JSON.stringify(v)); } catch(e){} },
};

// Weaker devices (most Chromebooks) default to Low.
const weakDevice = (navigator.hardwareConcurrency||4) <= 4 || (navigator.deviceMemory||4) <= 4;
const DEFAULT_SETTINGS = {
  quality: (navigator.hardwareConcurrency||4) <= 2 ? 'potato' : weakDevice ? 'low' : 'med',
  rainFx: 'full',        // 'full' | 'reduced'
  camMode: 'first',      // 'first' | 'third'
  sens: 1.0,             // mouse sensitivity multiplier
  master: 80, sfx: 100, camMotion: 100, music: 35, guns: 95, hits: 90, steps: 80, breath: 80, ambience: 45, vehicles: 80, env: 85, ui: 70, uiHover: true,
  perf: false,           // Performance Mode
  superPerf: false,      // Super Performance Mode: the lightest possible settings for very weak computers (overrides the options below)
  renderScale: 0,        // 0 = from the graphics preset; else a fixed resolution 0.25..1
  dynRes: weakDevice,    // Auto resolution: lowers/raises the render resolution to keep the frame rate up
  simpleMat: weakDevice, // Simple lighting: cheap Lambert shading instead of the realistic (PBR) shading (on by default for Low / Potato)
  viewDist: 'auto',      // 'auto' (from the preset) | 'far' | 'normal' | 'short' | 'tiny'
  fxLevel: 'full',       // effects: 'full' | 'reduced' | 'minimal' (casings, bullet holes, dust, glass shards, bodies)
  dynLights: true,       // muzzle-flash / explosion lights
  fpsCap: weakDevice ? 30 : 0,   // 0 = unlimited; else 15/30/60/120/240 (weak devices: a steady 30 instead of a jumpy 35-55)
  leanMode: 'hold',      // 'hold' | 'toggle'
  crouchMode: 'hold',    // 'hold' (hold the key) | 'toggle' (press once to crouch, again to stand)
  tpDistance: 1.5,       // third-person camera distance (m)
  minimap: true, killfeed: true, crosshair: 'cross',
  name: 'PLAYER',
  bob: 60,               // first-person head bob strength (0 = off)
  blur: 'off',          // motion blur: 'off' | 'subtle' | 'auto' (subtle on Medium/High)
  fov: 120,              // 60..120 (maxed by default)
  aimAssist: 'on',       // 'off' | 'on': slight slowdown while your crosshair is already on someone (no pull / lock-on)
  botsFire: true,        // test bots shoot back
  showFps: true,
};
const Settings = Object.assign({}, DEFAULT_SETTINGS, Store.get('settings', {}));
if (Settings.blur==='auto') Settings.blur='off';
if (!['none','cross','dotS','dotM','dotL'].includes(Settings.crosshair)) Settings.crosshair='cross';   // old small/medium cross -> Cross   // old default smeared the screen
Settings.fov = clamp(Math.round(+Settings.fov||120), 60, 120);
// one-time: everyone starts on the widest first-person view and with aim assist on (both can be changed in Settings)
if (!Store.get('fovMax', false)){ Settings.fov=120; if (!Settings.aimAssist) Settings.aimAssist='normal'; Store.set('settings', Settings); Store.set('fovMax', true); }
if (Settings.aimAssist!=='off' && Settings.aimAssist!=='on') Settings.aimAssist='on';   // old Normal / Strong -> the new slight assist
if (!['potato','low','med','high'].includes(Settings.quality)) Settings.quality='low';
/* One-time (Chromebook performance update): anyone already on Low or Potato gets Simple lighting and a 30 fps limit.
   Both can be changed back in Settings → Video. */
if (!Store.get('perfPass1', false)){
  if (Settings.quality==='low' || Settings.quality==='potato'){ Settings.simpleMat=true; if (!(Settings.fpsCap>0)) Settings.fpsCap=30; }
  Store.set('settings', Settings); Store.set('perfPass1', true);
}
/* Performance helpers: one place that turns the settings into what each system should do.
   Super Performance Mode wins over everything; otherwise each option is used as chosen. */
const Perf = {
  get sup(){ return !!Settings.superPerf; },
  get potato(){ return Settings.superPerf || Settings.quality==='potato'; },
  fx(){ return Settings.superPerf ? 'minimal' : Settings.quality==='potato' && Settings.fxLevel==='full' ? 'reduced' : (Settings.fxLevel||'full'); },
  simple(){ return Settings.superPerf || !!Settings.simpleMat; },
  lights(){ return !Settings.superPerf && Settings.dynLights!==false; },
  botAnimHz(){ return Settings.superPerf ? 6 : Settings.perf||Settings.quality==='potato' ? 8 : 10; },   // far characters
  // character detail LOD: beyond this distance small character / weapon parts are not drawn (Low, Potato, Performance Mode only)
  lodDist(){ return Settings.superPerf ? 10 : Settings.quality==='potato' ? 14 : Settings.quality==='low' || Settings.perf ? 20 : Infinity; },
  label(){ return Settings.superPerf ? 'SUPER PERF' : (Settings.quality||'low').toUpperCase()+(Settings.perf?' · PERF':''); },
};
function saveSettings(){ Store.set('settings', Settings); }

// One firearm per loadout (+ knife for everyone) and a limited equipment budget.
const FIREARMS = ['glock','drako','sniper','shotgun','ar15'];
const EQUIP_BUDGET = 3;                               // total grenades + mines carried
const DEFAULT_LOADOUT = { firearm:'glock', flash:2, mine:1 };
const Loadout = Object.assign({}, DEFAULT_LOADOUT, Store.get('loadout2', {}));
if (!FIREARMS.includes(Loadout.firearm)) Loadout.firearm='glock';
Loadout.flash=clamp(Loadout.flash|0,0,EQUIP_BUDGET); Loadout.mine=clamp(Loadout.mine|0,0,EQUIP_BUDGET-Loadout.flash);
function saveLoadout(){ Store.set('loadout2', Loadout); }

// Simple event hub so modules stay decoupled.
const Bus = { h:{}, on(e,f){ (this.h[e]=this.h[e]||[]).push(f); }, emit(e,...a){ (this.h[e]||[]).forEach(f=>f(...a)); } };

/* ---------- Rebindable controls ----------
   Codes are KeyboardEvent.code values, or Mouse0/Mouse1/Mouse2 for mouse buttons.
   Esc is reserved by the browser for releasing the mouse, so Pause also always works on Esc. */
const ACTIONS = [
  ['forward','Move forward','KeyW'],['back','Move back','KeyS'],['left','Move left','KeyA'],['right','Move right','KeyD'],
  ['jump','Jump / vault','Space'],['sprint','Sprint','ShiftLeft'],['crouch','Crouch','KeyC'],['slide','Slide (while sprinting)','KeyC'],['prone','Prone (toggle)','KeyZ'],
  ['fire','Shoot / attack','Mouse0'],['aim','Aim / heavy stab','Mouse2'],['reload','Reload','KeyR'],
  ['firearm','Firearm','Digit1'],['knife','Knife','Digit2'],['firemode','Glock fire mode (Switch)','KeyB'],
  ['interact','Interact / search / pick up','KeyF'],['leanL','Lean left','KeyQ'],['leanR','Lean right','KeyE'],
  ['grenade','Throw flash grenade','KeyG'],['mine','Place landmine','KeyX'],['smoke','Use item: blunt','KeyH'],['beer','Use item: beer','KeyK'],['zyn','Use item: Zyn','KeyJ'],['nic','Kill streak: Tap the Nic','KeyT'],['ability','Character ability','KeyY'],
  ['flashlight','Flashlight (toggle)','KeyU'],['thermal','Sniper thermal (toggle)','KeyN'],
  ['camera','Switch camera','KeyV'],['scoreboard','Scoreboard (hold)','Tab'],['loadout','In-game loadout','KeyL'],['pause','Pause','KeyP'],
];
// groups for the control guide / settings
const ACTION_GROUPS = { Movement:['forward','back','left','right','jump','sprint','crouch','slide','prone','leanL','leanR'], Combat:['fire','aim','reload','firearm','knife','firemode','grenade','mine','flashlight','thermal'], Interaction:['interact','smoke','beer','zyn','nic','ability'], Interface:['camera','scoreboard','loadout','pause'] };
const GAME_VERSION = 'v0.9.0';
/* Map compression (Update 5): the block in the middle (|x|,|z| <= MAP_CORE: towers A-D, courtyard, ring road) stays where
   it is; everything outside it is pulled toward the centre by MAP_K. Only the ANCHOR of each object (its centre, or both
   ends of a fence / wall / road) is moved — object sizes never change. Applied once, at map build time. */
const MAP_CORE = 46, MAP_K = 0.5;
const RMv = v => Math.abs(v) <= MAP_CORE ? v : Math.sign(v)*(MAP_CORE + (Math.abs(v)-MAP_CORE)*MAP_K);
const RM = (x, z) => [RMv(x), RMv(z)];
const DEFAULT_BINDS = Object.fromEntries(ACTIONS.map(a=>[a[0],a[2]]));
const Binds = Object.assign({}, DEFAULT_BINDS, Store.get('binds', {}));
function saveBinds(){ Store.set('binds', Binds); }
/* Ctrl as crouch closed the game tab: Ctrl+W (crouch + forward) is a browser shortcut no page can block, and on
   Chromebooks Ctrl+Shift+Q signs you out. One-time move: anyone still on the old Ctrl crouch gets C (C = crouch,
   C while sprinting = slide). */
const CROUCH_MOVED = !Store.get('crouchFix', false) && (Binds.crouch==='ControlLeft' || Binds.crouch==='ControlRight');
if (CROUCH_MOVED){ Binds.crouch='KeyC'; saveBinds(); }
Store.set('crouchFix', true);
/* "Recommended controls": the developer's own setup, applied with one button in Settings → Controls.
   Only the keys listed here change; anything not listed keeps the player's current key. (Fill in from the
   developer menu's "Copy my controls".) */
const RECOMMENDED_CONTROLS = {
  binds:{forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',jump:'Space',sprint:'ShiftLeft',crouch:'KeyC',slide:'KeyC',prone:'KeyZ',
         fire:'Mouse0',aim:'KeyE',reload:'KeyR',firearm:'Digit1',knife:'Digit2',firemode:'KeyB',interact:'KeyF',leanL:'KeyQ',leanR:'Digit3',
         grenade:'KeyG',mine:'KeyX',smoke:'KeyH',beer:'KeyK',zyn:'KeyJ',nic:'KeyT',ability:'KeyY',flashlight:'KeyU',thermal:'KeyN',
         camera:'KeyV',scoreboard:'Tab',loadout:'KeyL',pause:'KeyP'},
  sens:1, leanMode:'toggle', crouchMode:'toggle',
};
function applyRecommendedControls(){
  const R=RECOMMENDED_CONTROLS; if (!R) return false;
  if (R.binds) for (const [a,c] of Object.entries(R.binds)) if (a in DEFAULT_BINDS) Binds[a]=c;
  for (const k of ['sens','leanMode','crouchMode']) if (R[k]!==undefined) Settings[k]=R[k];
  saveBinds(); saveSettings(); return true;
}
const Input = {
  down:{},                                  // code -> pressed
  held(action){ return !!this.down[Binds[action]]; },
  is(action, code){ return Binds[action]===code; },
  label(code){ if (!code) return '—'; if (code.startsWith('Mouse')) return ['Left click','Middle click','Right click'][+code.slice(5)]||code;
    return code.replace(/^Key/,'').replace(/^Digit/,'').replace('ShiftLeft','L-Shift').replace('ControlLeft','L-Ctrl').replace('ShiftRight','R-Shift').replace('ControlRight','R-Ctrl').replace('AltLeft','L-Alt'); },
  conflicts(){ const m={}, out=[]; for (const [a] of ACTIONS){ const c=Binds[a]; if (!c) continue; if (m[c] && !(m[c]==='crouch' && a==='slide')) out.push([m[c],a,c]); else if (!m[c]) m[c]=a; } return out; },   // crouch + slide on one key is a deliberate combo (crouch, or slide while sprinting)
};
