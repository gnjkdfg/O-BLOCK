# O-Blick — visibility, aim assist, MP7 sights/sound, music, performance

- ✅ Outlines: thin line round other characters (red = enemy; team colours in Gang Wars), ordinary depth-tested geometry so walls/fences/cars hide it; no ray casts or post-processing; setting to turn off; off in Super Performance Mode
- ✅ Lighting floor on characters (dark clothes / shadow / night stay readable; lit characters unchanged)
- ✅ Aim assist: cone 0.05→0.06, keep 0.075→0.095, slowdown 22%→28%, plus 30% rate-limited tracking of a target you are already on while you are aiming/moving/shooting. Measured: hands off = 0 movement; 8° off target = nothing; no assist through walls (line-of-sight check unchanged)
- ⚠️ Controller: the game has no gamepad input at all, so there is no controller aim assist to tune
- ✅ MP7: sight picture rebuilt to the reference (solid rear block with square notch, front post in the notch, eye behind the gun); damage 21→19, falloff starts 20 m (was 30), ×0.5 by 65 m, max range 110 m; new shot + reload sounds cut from the supplied recording
- ✅ Pause key frees the mouse (no Esc needed); game renamed O-Blick (saves untouched)
- ✅ Music: old tracks removed; Songs 4–7 as a playlist, one track in memory at a time
- ✅ Performance: characters merged from 16–25 meshes/skeletons to 3–5 meshes on 1 skeleton (bots, other players, corpses); Glock/Drako/e-bike/3 characters reduced ~45% (triangles and download); model text freed after decoding; menu appears after the guns + your character, the rest (~3 MB) loads behind it; auto quality steps graphics down under 30 fps
- Tests: server 104/104; browser: boot/staged load, merged characters + ragdoll, outlines day/night/Gang Wars online, aim assist, MP7 ADS, vehicles, trunk/ammo, reconnect

---

# O-Block — reconnect after a dropped connection

- ✅ A connection that drops mid-match (not LEAVE) keeps the player's seat for 30 s: they are taken off the field (can't be shot), everyone sees "LOST CONNECTION · 30s TO REJOIN"
- ✅ The game retries every 1.5 s with a countdown banner; on success the same account gets the same player id, team, kills/deaths, position and health back
- ✅ Another account can't take the seat; after 30 s the normal leave runs ("Left early"); a late return goes to the menu as before
- ✅ A dropped host stays host while they can return (bots resume with them); a solo player's room stays open for them
- Tests: protocol suite 104/104 (10 new), expiry + solo-room check, two-browser run (player drop and host drop)

---

# O-Block — MP7 / Taser ragdoll / Sawed-Off audio update

`cd server && npm test`: protocol **94/94** (incl. MP7 purchase, 30-round factory mag, 40-round extended mag honoured online only when owned) and progression **43/43** (file + Postgres). Browser: offline runs plus a two-browser online run.

## MP7 ($3,000, primary)
- ✅ Your imported model (Sketchfab "MP7 - CODMW2019") is used: reduced from 16.9k to 8.9k triangles and 11.4 MB to 450 KB (colour textures 512/256 px, normal/metal maps dropped); grip at the hands, muzzle forward, hands on the pistol grip and handguard
- ✅ Iron sights: the model's own flip-up front post and rear notch. Measured in ADS: front-post tip and rear-notch centre both land on the screen centre (±1 px)
- ✅ Stats: 900 rpm, 21 dmg (×1.8 head), best hip-fire of the rifles, strong to ~30 m then falls off (×0.6 by 90 m), 2.0 s reload
- ✅ Vertical grip: modelled grip under the handguard, left hand moves onto it, recoil −20%
- ✅ Laser: module on the right rail; beam and dot come from the module and follow the gun (hip, ADS, recoil)
- ✅ Extended mag: visibly longer magazine (model part), 30 → 40 rounds, HUD "40 / reserve", reload refills to 40, enforced by the server
- ✅ Bought once and saved (attachments shared with other guns that take them); bots use it; works online
- ⚠️ No MP7 recording was supplied: it uses the AR-15 shot samples pitched up and shortened
## Taser
- ✅ A hit drops the character into the physics ragdoll (the one deaths use), falling away from the shooter: no shaking or twitching
- ✅ 5 s down, no moving/firing, a second hit doesn't restart it; then a 0.45 s blend back to standing; gun and controls return
- ✅ Your own view follows your body's head to the ground (steady) and your gun drops out of view; other players see the same ragdoll (two-browser test)
## Sawed-Off audio
- ✅ The previous shot clip was silent (cut from the wrong part of your file): re-cut from your recording — shot (instant onset), 2-shell reload, 1-shell reload
- ✅ Other players now hear its shots and reloads (and every gun's reloads) at the shooter's position

---

# O-Block — Game Update 6 test checklist

Run with `cd server && npm test` (protocol suite **89/89** + progression suite **43/43**; set `TEST_DATABASE_URL` to also run the Postgres half) and in headless Chrome (one browser offline, two browsers against a local server online).
✅ = verified by running it · ⚠️ = works with a limitation noted

## Deploy (Render) — needed for progress to survive restarts
1. Create a free Postgres database (Neon or Supabase) and copy its connection string.
2. On Render → your service → Environment: add `DATABASE_URL` = that string, and `PROFILE_SECRET` = any long random text.
3. Redeploy. The log should say `storage: postgres`. Existing `profiles.json` profiles are imported once.
Without `DATABASE_URL` the server still saves to a file (atomic write + backup), but Render's free disk is wiped on every restart.

## 1. Permanent progression
- ✅ Every kill / purchase / match result is written to storage; "✓ PROGRESS SAVED" shows only after the write is confirmed (pending → saved / failed → retry)
- ✅ Crash right after a confirmed save (SIGKILL), restart, reconnect: nothing lost (file and Postgres)
- ✅ Rewards paid once; revision-guarded writes never overwrite a newer copy; leaving mid-match keeps earnings and records "Left early"
- ✅ Recent matches panel (last 20) on the main menu; character / outfit / loadout / weapon looks follow the account
## 2. Difficulty rewards
- ✅ Easy ×0.5 · Normal ×1 · Hard ×1.5 · Expert ×2 (server-side, only with bots), shown in the lobby before the match, locked once it starts; same-player farming pays 0 after 3 kills a minute
## 3. Vehicles
- ✅ Cars can't be entered or driven (and car-hop cash is gone); trunks are still searchable
- ✅ E-scooter and e-bike mount, ride (≈9–11 m in 4 s in the test) and dismount
## 4. Ammo loot
- ✅ Trunk ammo chance 60%; each gun gets its own ammo type (primary, secondary, Taser charges), capped at 1.5× the starting reserve, "FULL" when capped; pickups go to the matching gun and stay on the ground if it's full
## 5. Online mines and flashbangs
- ✅ Server checks counts, reach and spacing; max 3 mines per player; mines arm after 1.5 s, explode once, damage falls off with distance and is credited to the owner (two-browser test: 98 damage, removed on both screens)
- ✅ Flashbang throws are shared with every player; each player's flash strength comes from their own distance, line of sight and facing
## 6. Gang Wars custom teams
- ✅ 2–4 teams with name, colour, emblem, max players, bots, reward multiplier and starting weapon; players assigned by drag-and-drop or team buttons
- ✅ Manual assignments are kept exactly (no random teams); unassigned players join the smallest team
- ✅ Friendly fire (off by default, team kills never score or pay); team switching locked by default, optional (applies at respawn, from the pause menu)
## 7. Taser ($5,000, replaces the knife)
- ✅ 20 m hard limit, 5 s stun with ragdoll + camera shake, no move / fire while stunned, a second hit doesn't restart it; server validates all of it (two-browser test)
## 8. Armory
- ✅ PRIMARY (Drako, Sniper, AR-15, Shotgun) / SECONDARY (Glock, Sawed-Off, Taser) / EQUIPMENT (knife, flash, mines) tabs; one weapon per slot; 3D preview, price, owned/locked, stats, attachments, equip/buy
- ✅ Preview no longer re-measures the page every frame and stops redrawing when still (0 redraws/s when idle)
- ✅ In-game loadout (L) has primary / secondary / melee columns
## 9. Sawed-Off ($2,500)
- ✅ 2 shells, 9 pellets, strong up close, 5 m effective range; reload by shell count (2-shell / 1-shell sounds), shells eject on reload; HUD "2 / reserve"; bots use it
## 10. HUD / purchases
- ✅ Level, XP, cash, save state on the HUD; every purchase asks for confirmation with the price and the balance after
## 11. Reliability
- ✅ Batched saves (250 ms + every 5 s), retry with back-off, never "saved" without confirmation
- ⚠️ Timing-based tests under software rendering run at ~5–20 fps; one progression check flaked once and passed on two reruns

---

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
