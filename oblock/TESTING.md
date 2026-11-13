# O-Block v0.7.0 — Game Update 3 test checklist

Tested in headless Chrome (SwiftShader software rendering) plus the server's automated suite (`server/test.js`, 40 checks).
✅ = verified by running it · ⚠️ = works with a limitation noted · ❌ = not done

## 1. Stamina and consumables
- ✅ Stamina capacity 140 (was 100, +40%); sprint drain per second unchanged, so sprints last 40% longer
- ✅ Slide costs 9 stamina (was 15, −40%)
- ✅ Blunt: heals 30 and raises max health to 120 (+20%) until death; HUD shows `HP/120` and a "MAX HP +20%" tag
- ✅ Nic (Tap the Nic, 5-kill streak → +1 Nic, max 3): +35% run/sprint speed, −20% stamina capacity, exactly 10 s, cannot stack; also heals 30%
- ✅ Zyn: spread ÷1.5 (+50% accuracy) for 30 s, survives weapon switches, cannot stack, timer in HUD
- ✅ Effect timers run on real time, so they stay exact on slow frames

## 2. Trunk loot
- ✅ Independent rolls per trunk: beer 1/7, blunt 1/5, Zyn 1/8 (+ ammo 1/4 as before); each trunk once per match
- ✅ Beer: 2.4 s drinking animation (can raised and tipped in first and third person), can-open + gulp sounds, heals 25 over 5 s and −10% damage taken for 20 s with slight aim sway
- ⚠️ No item images or beer/Zyn sounds were supplied: icons, can and tin are drawn in code; sounds are synthesized

## 3. Cash
- ✅ Saved in localStorage offline; server profile online (validated)
- ✅ Car hopping (getting into a car): 1/3 chance of $1–20, 120 s cooldown per car
- ✅ Match rewards: win $100, kill $10, 2nd $50, 3rd $25, participation $10; all numbers in `PROG` (js/progression.js)
- ✅ Results screen lists every reward line; paid exactly once per match (a second payout attempt returns nothing)

## 4. XP and levels
- ✅ 1,000 XP per level; kill 100, win 250, participation 50, objective (bag pick-up, max 5/match) 100, classic hold win 250, ZA win 250
- ✅ HUD: level, XP bar, XP text, cash, "+100 XP · KILL" pop-ups, level-up banner, unlock banner
- ✅ Unlocks: Glock 1, Drako 10, Sniper 20, Shotgun 50, AR-15 100; enforced when equipping, at match start, and by the server
- ✅ XP keeps counting past level 100

## 5. Glock Switch
- ✅ Bought in the Armory ($500, configurable); ownership saved; toggle refused (with a message) until owned; 15% accuracy penalty kept

## 6. Characters
- ✅ Lil Jeff $1,000 · Triple Health (max HP ×3, current HP scaled) 30 s, 90 s cooldown, ski mask on, shrinks back proportionally
- ✅ Cop $5,000 (imported cop_final.glb, decimated to 14.6k tris, same rig) · Double Damage ×2 firearms + melee 30 s, 90 s cooldown
- ✅ Both work in the real damage/health code (player, bots, and the server); bots with those characters use their abilities

## 7. AR-15
- ✅ Imported model; first and third person; hands on pistol grip and its vertical grip; mag drops on reload; recoil pattern; muzzle flash; casings
- ✅ Sounds cut from your recordings (3 shot variants with the recording's own tail, reload from your reload recording)
- ✅ Armory: stats, attachments (iron / 1.5x / 2.5x, suppressor, compensator, laser), paint
- ✅ Balance: 26 dmg, 720 rpm, lowest recoil and best ADS spread of the rifles; Drako still hits harder per round

## 8. Sniper
- ✅ Moving penalty 0.08 → 0.018, hip spread 0.09 → 0.06
- ✅ New reticle: mil-dots, heavy posts, holdover marks, lit centre dot
- ✅ Thermal (N while scoped): people white-hot, world cold; depth-tested, so walls hide people (pixel test: bot 218–249, world ~60)

## 9. Flashlights
- ✅ Rebindable toggle (U); beam visible in third person; bots switch theirs on at night
- ✅ No shadow-casting lights; Low/Performance: the player's light is created only on first use, bots get beams but no lights; Medium/High: two pooled bot lights

## 10. Armory
- ✅ Opened from the pause menu it renders its own preview scene (it used to render the game world)
- ✅ One render path (no second loop); preview copies and thumbnails are disposed (shared imported geometry kept)
- ✅ Unlock levels, lock state, Switch purchase, AR-15, Shotgun, Sniper, Drako

## 11. Online private matches
- ✅ Lobby: connect to a server address, create (5-character code) / join by code, host-only settings (mode, bots on/off, count, difficulty, rules), host starts
- ✅ Server-authoritative (see server/README.md); 40 automated checks pass; two-browser tests passed for Deathmatch (hits validated, through-wall hit rejected, locked weapon rejected, kill limit, server-paid rewards) and ZA (server bag, hold time, end, rewards, back to the room)
- ⚠️ There is no public server: someone has to run `server/`. The Claude artifact viewer blocks outside connections, so online play needs the game hosted elsewhere (https pages need a wss:// server)
- ⚠️ Online bots are simulated by the host's browser (their health and shots are still validated by the server); landmines are offline-only

## 12. Vehicles
- ✅ Exactly 2 e-scooters + 1 e-bike (imported, decimated: 5k / 18k tris), parked spots validated each match
- ✅ Enter/exit with Interact, W/S/A/D, world collision with bump speed loss, standing pose on the scooter, seated pose on the e-bike
- ✅ Shooting while riding; steering locks while the trigger is held; first and third person; scooter motor loop from your recording (pitch follows speed)

## 13. THE FIGHT FOR ZA
- ✅ Accumulated hold time decides the winner; default 5 minutes; classic 30 s hold still available
- ✅ Settings: length, bots, difficulty, spawns (all / far from the bag), dropped bag stays or respawns
- ✅ HUD: timer, carrier, everyone's hold time, leader, where the bag is
- ✅ Bots go for the bag, the carrier retreats toward cover away from threats, everyone else hunts the carrier
- ✅ Hold time runs on real time offline and on the server online

## 14. Spawns and bots
- ✅ Exactly 15 spawn points, validated against colliders and the nav grid at load (1 point nudged by 1 m), shared by player and bots, also on the server
- ✅ Bots use the AR-15 and the shotgun (pellet spread, pump cadence, close range band), AR burst lengths, abilities, carrier targeting

## 15. Outer buildings
- ✅ 6 enterable buildings outside the block (2 shacks, 2 run-down houses with a partition room, 2 storage units), real interiors, doorways, window openings, colliders, roofs
- ✅ Nav grid reaches every room (both sides of each partition)
- ⚠️ Doors are open hinged leaves (not opened/closed interactively), so bots can always path through

## 16. HUD and menus
- ✅ Cash, level, XP, unlocks, ownership, consumable counts with icons, effect and ability timers, toasts

## 17. Developer tools
- ✅ No code exists in the published game; the panel (F9) only appears when the unpublished `js/dev.local.js` is present and the page is served from localhost
- ✅ Commands: unlock all, set level / XP, add cash, unlimited cash, reset, no-damage and infinite-ammo testing toggles, skip to day/night; every action logged (localStorage `oblock_devlog`)
- ✅ Online: only accounts listed in the server's `DEV_TOKENS` may use them; others are rejected; actions logged to `devlog.jsonl`

## 18. Performance
- ✅ Low stays the default on weak hardware
- ✅ Same scene, Low, 7 bots: draw calls 101 → 107, triangles 21.4k → 18.0k; e-bike materials merged (90 → 21) and textures capped at 256 px

## Update 4 (v0.8.0) — verified headless (Chrome/SwiftShader) + `node server/test.js` (53/53)
- [x] Character seam: hoodie/shirt hem and trousers share one hip→thigh weight field; covered trouser verts pulled inside the top (tracksuit 155, Jeff/Cop reweighted). Checked idle/walk/run/crouch/slide from front/side/back.
- [x] AR-15 first person: right hand round the pistol grip (index on trigger), left fist round the vertical grip. Side/left/below/front renders.
- [x] Glock Switch: recoil ×1.2 (climb, sideways, visual kick) only in Switch mode; semi unchanged; 15 % accuracy penalty kept.
- [x] Shelter (wood): south window collider now matches the model's real opening; all 3 windows have visible bulletproof glass with same-size 3 cm colliders. Rays hit the pane at the wall plane.
- [x] Fences: body collider (movement) separate from bullet colliders (posts, top rail, plates). Rays pass the mesh and over the rail, stop on posts/rail. Server LOS uses the same set.
- [x] Minimap 150 → 188 px (clamped to 26 vh on small screens); kill feed follows it.
- [x] UI sounds: hover / click / select / character / weapon / buy / deny / back / open / close / confirm, throttled; Interface volume + hover on/off.
- [x] Main menu restyled to the mockup; character screen FRONT/SIDE/BACK/AUTO views, auto-rotate resumes after 4 s.
- [x] Movement: walk↔run cross-fade locked to one footfall phase, continuous sprint blend, accel/brake curves, landing absorb, vault pose, kneel→prone transition, prone room check, crouch Hold/Toggle setting.
- [x] Ragdoll: 15-mass Verlet ragdoll on the real skeleton, hit impulse, ground/wall collision, sleeps when settled, removed at 10 s.
- [x] Cop / Jeff abilities: 10-kill streak (server-counted online), manual activation, until death; HUD icon with streak progress.
- [x] Private match: tabbed host settings (room, match, weapons & gear, mode, rewards, summary), validated/clamped by the server, locked during a match; two-browser ZA match passes.
