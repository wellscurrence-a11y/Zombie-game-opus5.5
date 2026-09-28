# Quiet Hours

An isometric zombie survival sandbox about small mistakes that snowball into disasters.

You are one survivor in **Cedar Hollow**, a small procedurally generated town (houses, a main street
of shops, a police station, a clinic, a gas station, a motel, apartments, a church, a warehouse and a
cannery, a farm, hunting cabins, a river, a highway with an abandoned military checkpoint and a
pile-up). There are no missions. The only goal is to survive for as long as you can.

The game is designed around one rule:

> Whenever the game makes something difficult, the player should be able to understand what caused
> it — and a skilled player could have prevented it.

So difficulty never comes from zombies spawning next to you, super-speed or bullet-sponge health.
It comes from noise, fatigue, weight, darkness, infection, weather, utilities failing, weapons wearing
out, crashes, fires and your own greed. When you die, the death report shows the chain of events and
the factors that contributed.

## Running

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npm test           # simulation & world-generation tests
SOAK=1 npm test    # also run a slow multi-day soak test
```

The build is a static site (relative paths), so `dist/` can be hosted anywhere, including GitHub Pages.
A WebGL2-capable browser is required.

**Graphics.** The game picks a quality tier for the device on first launch (Chromebooks and older
integrated GPUs get *Low*: no shadows or antialiasing, simpler ground shading and a reduced render
resolution). Resolution also drops automatically when the frame rate does. Change it under Settings.

Developer shortcuts: `?quick=1&seed=123` starts straight into a world; `&hour=22` sets the clock;
`&gfx=low|medium|high` forces a graphics tier; `&lowgfx=1` halves the resolution.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move (screen-relative). You face the mouse cursor. |
| Shift | Run — loud and tiring |
| C | Crouch / sneak |
| Left click | Attack. With a gun: hold to aim, release to fire |
| Space | Shove (breaks grabs, knocks zombies down — then stomp them) |
| Right click | Context options for doors, windows, furniture, cars, bodies, trees, the ground |
| E | Open/close doors, climb through windows, vault fences; get out of a car (brakes first) |
| F | Flashlight (headlights when driving) |
| R | Reload (start/stop the engine when driving) |
| G | Horn (when driving — very loud) |
| L | Room lights (if there is power) |
| 1–6 | Equip weapons |
| Tab / I | Inventory and looting |
| H / K / B / M / J | Health, Skills, Craft & Build, Map, Journal |
| T | Speed up time (only when nothing is nearby) |
| Z / X, wheel | Rotate camera, zoom |
| Esc | Close panels / pause |

## Systems

**Senses, not cheating.** Zombies see in a cone, and how far depends on light (carrying a flashlight at
night makes you visible from far away), fog and rain, whether you are crouched, moving or hidden in
tall grass. They hear noise that travels outward and is muffled by walls and doors. When they lose
sight of you they walk to where they last saw you and search. Moaning zombies pull nearby zombies
along. Sound indicators show what *you* heard and from which direction.

**No cheap spawning.** The population is placed once, where people would have been. Later arrivals
only walk in from the edge of the map, far away, as a migrating group — with a log message if you can
hear them. Every crowd at your door came for a reason: a gunshot, an alarm, an engine, a helicopter,
hammering, a broken window, a door slammed while running.

**Combat** is about reach, swing time, weight, stamina, knockback and weapon wear. Nobody hits
through walls, doors or intact windows; a zombie that hasn't noticed you, struck from behind, often
goes down in one blow. Exhaustion slows
swings and weakens shoves; being grabbed lets others bite; hits from behind land more often; panic
ruins accuracy and narrows your field of view. Firearms are powerful and heard for hundreds of meters.

**Body.** Eleven body parts, eight injury types (scratches, lacerations, deep wounds, burns, sprains,
fractures, bites, bruises). Bleeding needs bandages; dirty wounds get infected within hours unless
disinfected; bandages soak through; glass stays in wounds until removed; fractures need splints and
cripple legs or two-handed weapons; bites carry a fever with no cure. Treatment takes time and is
interrupted by attacks.

**Needs.** Hunger, thirst, sleep, stamina, body temperature, wetness, stress, panic, pain, food
poisoning, colds (coughing is noisy), drunkenness and carbon monoxide. Health, food, water, rest,
stamina and body temperature are always shown top-left. You get hungry about 13 hours after a meal and
thirsty after about 7; dehydration kills in about two days, starvation in about four. Stay awake too
long and you collapse where you stand, or nod off at the wheel.

**Weight.** Everything weighs something. Bags help but don't make weight meaningless. Heavy loads slow
you down, burn stamina, and make climbing fences and windows dangerous.

**Looting** follows the room: kitchens have food and knives, bathrooms have medicine, garages have
tools and fuel, the police armory has guns, the hardware store has building materials. Searching can
be careful (quiet, slow) or quick (noisy, and sometimes you knock something over). Many buildings have
alarm panels by the door while the power is on.

**Vehicles** need keys (or hotwiring know-how), fuel, a working battery, engine and tires. Engines are
loud, damaged engines louder. Crashes injure — badly at speed. A car is not a shelter: the dead
surround a stopped car, break the glass, reach in, and with enough hands drag you out. It keeps the rain
off but not the cold unless the engine (and its noise) runs. Fuel can be siphoned or pumped while the
power lasts.

**Base building.** Lock doors, barricade doors and windows, hang sheets over windows, move furniture,
build wooden/log/metal walls and gates, crates, rain collectors, tin-can alarm lines, sleeping bags,
campfires. Repair what the dead damage. Nothing is perfectly safe.

**Utilities** fail after a random number of days (the radio warns you if you have one). Then
refrigerators spoil, lights die, taps run dry and pumps stop. Generators restore power but must run
outdoors — indoors the fumes kill you.

**Weather and time.** Day/night, seasons turning toward winter, rain (masks sound, soaks you), fog,
storms with thunder, snow. Cooking left unattended burns — and fires spread.

**Skills** improve by doing (Strength, Fitness, Blunt, Blade, Firearms, Sneaking, Carpentry, Cooking,
Mechanics, First Aid, Electrical, Farming, Foraging). Books speed learning. Occupations and traits
shape a character, but no level makes you safe.

**One life.** When your survivor dies, their body — and everything they carried — stays in the
persistent world, and a new survivor can continue elsewhere in the same town. If they were bitten,
they may not stay down. Days survived are recorded in the Hall of the Dead (milestones: 3, 10, 30,
100 days).

## Architecture

```
src/
  core/     RNG, math, game clock
  world/    world data model, furniture table, procedural town generator
  sim/      simulation (pure data + functions; runs headless in tests)
    step.ts         one simulation tick
    zombies.ts      AI: sight, hearing, memory, banging, climbing
    path.ts         A* for zombies (doors/windows are costly "passable" obstacles)
    noise.ts        sound events
    vision.ts fov.ts lighting.ts   what the survivor can see
    combat.ts body.ts medical.ts stats.ts player.ts
    items.ts loot.ts inventory.ts use.ts build.ts interact.ts world-actions.ts
    vehicles.ts vehicleSpecs.ts world-systems.ts (weather, utilities, fire, events)
    save.ts         IndexedDB persistence, death & succession
  render/   Three.js renderer: procedural ground shader, fog-of-war, instanced walls with
            cutaway, furniture, trees, roofs, characters, vehicles, effects
  ui/       HUD, panels, context menus, screens
  audio/    procedural Web Audio sound
```

All art and sound is generated in code — there are no external assets.
