# Neon Tower Defense Evolution

A high-performance, purely procedural HTML5 Canvas Tower Defense game built without external assets. Dive into an intense, neon-styled cyber battleground where every sound and visual is generated on the fly.

## 🌟 Key Features

* **Zero External Dependencies**: Pure HTML, CSS, and Vanilla JavaScript. Everything—including graphics and audio—is procedurally generated using the Canvas API and Web Audio API.
* **Procedural 8-bit Audio**: A fully custom sound engine produces authentic retro synthesizers, laser zaps, rocket explosions, and warning sirens directly in the browser.
* **Dynamic Grid Pathing**: Navigate through complex, procedurally calculated grid mazes.
* **Responsive & High-DPI Ready**: Crystal clear rendering on 4K/Retina displays with adaptive layouts that fit any screen aspect ratio perfectly.
* **Advanced Autopilot AI**: Toggle `AUTO` mode and watch the game play itself! The autopilot intelligently places, manages, and upgrades your defenses.
* **16X Speed Scaling**: Deeply optimized engine capable of running the simulation at extreme speeds without DOM-thrashing or lag.

## 🗼 Arsenal (Tower Types)

Defend your base using 8 distinct classes of weaponry, each featuring a 3-branch upgrade path:

1. **Blaster (Basic)**: Balanced damage, rate of fire, and range.
2. **Sniper**: Low fire rate, extremely high damage and massive range. Can be upgraded to ricochet through enemies.
3. **Pulse (Rapid)**: High-speed chain-gun that melts unarmored targets.
4. **Laser**: Continuous tracking beam that can be upgraded with a Cryo-slow effect.
5. **Rocket**: Slow, tracking projectiles that deal massive splash damage.
6. **Flak (AA)**: Specializes in taking down flying units. Deals **400% Damage** against airborne enemies.
7. **Tesla (Electric)**: A static energy orb that shoots lightning capable of chaining across multiple enemies.
8. **Silo**: The ultimate weapon. Constantly builds hovering tactical warheads that auto-acquire targets anywhere on the map.

## ✈️ Air Waves

Every 5th wave triggers a **Special Air Wave**. 
* Flying enemy drones completely ignore your maze layout and swarm directly toward your base in a wide formation.
* **Siren Alerts**: An on-screen countdown and blaring audio sirens give you exactly 5 seconds to prepare.
* **Tactical Shift**: All turrets can pitch in to shoot the sky, but standard turrets prioritize ground targets. To survive the later swarms, you must invest heavily in **Flak (AA)** towers.

## 🚀 How to Play

Simply open `index.html` in any modern web browser!

1. Select a tower from the right-hand menu.
2. Click on the grid to place it.
3. Click on any placed tower to open its **Upgrade Menu** and specialize its stats.
4. Watch out for the **Air Wave** countdown!
5. Toggle **SOUND** on to experience the procedural synth engine.

## 🛠 Project Structure

* `index.html`: The main entry point and UI overlay framework.
* `style.css`: Modern UI styles, dark mode, neon glow tokens, and responsive scaling.
* `main.js`: Setup, event listeners, and High-DPI window resizing logic.
* `game.js`: The core Game Loop, State Management, Autopilot AI, and UI Controller.
* `entities.js`: Tower properties, Enemy types, Upgrades, and Projectile logic.
* `assets.js`: Pure Canvas API drawing instructions for every entity, particle, and laser beam.
* `map.js`: Grid constants and procedural maze mapping tools.
* `audio.js`: Web Audio API procedural synthesis engine.

---
*Created as an experiment in building a complete, highly-polished web game using zero external image or sound files.*
