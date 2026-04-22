# TD & Roguelike Meta-Progression Patterns — Reference Research

Date: 2026-04-22
Purpose: Cherry-pick proven meta-progression / difficulty patterns for Neon Defense's roguelike redesign.
Method: WebSearch across wikis, dev posts, Steam discussions, design essays.

---

## 1. Rogue Tower

- **Run structure.** Finite-ish: each run is a single procedurally-grown map. At the end of every wave the player places new tiles extending paths from the core; enemies come from beyond the edges. Run ends on core destruction. Lanes are kept at different lengths so waves arrive staggered.
- **Persists between runs.** XP earned from surviving waves. Spent in a pre-run **tech tree** to unlock (a) new towers, (b) new tower upgrades that can drop during a run, (c) new building types, (d) flat permanent stat bonuses.
- **Pacing.** Game ships with roughly half the tech tree already unlocked so first runs feel fair. Later XP buys are incremental and situational — e.g. Universities unlock a research-stacking sub-system that only matters once Occult Shrines start appearing around wave 25+.
- **Difficulty scaling.** Single endless curve; difficulty emerges from map growth choices (bad junctions compound) rather than preset modes. RNG of tile options is the pressure valve.
- **Fun/challenge trick.** The player *chooses* how to make the map harder by which tiles they accept — so difficulty is diegetic, not a menu toggle. Meta unlocks add variety (new drops available), rarely raw power.

## 2. Bloons TD 6 (+ Rogue Legends)

- **Run structure — BTD6.** Fixed maps, 4 preset difficulties (Easy / Medium / Hard / Impoppable) + **CHIMPS** unlocked only by beating Impoppable on the same map. CHIMPS disables selling, income, Monkey Knowledge, life regen — a purist mode on top of meta-rich base game.
- **Run structure — Rogue Legends.** Actual roguelike mode: 4 stages, random encounters/merchants/campfires, a **Party** of 1 hero + ~10 towers (not all towers available), lose a Heart on any encounter loss. 0 Hearts = run over.
- **Persists — BTD6.** **Monkey Knowledge** tree (~134 points, ~6 branches by tower category + heroes/powers) unlocks from player level 30 onward; Heroes level per-match but have persistent cosmetic/voice unlocks; Paragons require massive in-run investment (a tier-5 fusion, not a meta unlock per se).
- **Persists — Rogue Legends.** Minimal: after beating a stage you can promote an in-run artifact to a future "starting artifact" slot; Rogue XP spent in a Rogue XP Shop for permanent buffs. Community widely criticizes the meta as too thin / too RNG-dependent.
- **Difficulty scaling.** Preset tiers + a community-loved **hard mode that disables meta** (CHIMPS). This is the key BTD6 insight: meta-progression is opt-in pressure, not forced.
- **Fun/challenge trick.** Letting hardcore players *turn off* Monkey Knowledge in CHIMPS resolves the trivialization tension — casuals get power fantasy, experts get pure skill mode, same base game.

## 3. Kingdom Rush: Vengeance / Alliance

- **Run structure.** Linear mission campaign, 3 difficulties per map (Casual / Normal / Veteran) plus per-map Heroic and Iron Challenges. Each map = one sitting.
- **Persists.** **Upgrade Points** from campaign completion (only; challenges give none) spent on a global tower upgrade tree. **Hero XP** is persistent per hero across campaign. Stars are purely cosmetic in V/A (functional in earlier games — a deliberate simplification).
- **Pacing.** Upgrade points are awarded flat per stage regardless of star rating — no grinding the same map for more power. Hero XP gain is *slower on higher difficulties*, nudging players to grind heroes on Casual and then tackle hard modes.
- **Difficulty scaling.** Preset tiers + challenge modes with fixed rulesets (Heroic = one hero no towers, Iron = fixed tower set). Challenges are *replayable skill gauntlets* orthogonal to progression.
- **Fun/challenge trick.** Separating progression currency (campaign-only) from challenge content means the hardcore layer doesn't feed into power creep. Heroes give long-tail per-character goals without making towers obsolete.

## 4. Mindustry

- **Run structure.** Sector map on two planets. **Named sectors** are handcrafted campaign beats; **numbered sectors** are procedural optional territory. Capture by either surviving waves or destroying enemy cores. Held sectors keep producing resources between sessions.
- **Persists.** **Global resource pool** aggregated across all held sectors, spent on the **Tech Tree** to unlock blocks/units/turrets. Tech unlocks gate further tech — classic metroidvania-style progression.
- **Pacing.** Named sectors gate most tech; numbered sectors are pure resource farms. Player sets their own pace — push story or consolidate economy.
- **Difficulty scaling.** Difficulty is emergent from how aggressively you expand (more sectors = more attacks to defend simultaneously). Planet Erekir acts as a "Hard Mode +" with tighter combat focus, less content, more difficulty.
- **Fun/challenge trick.** Progression is *spatial and diegetic* — the research tree is a map, not a menu. Players feel power growth by seeing their territory expand. No run/death loop; attrition is the pressure.

## 5. Defense Grid: Awakening & Defender's Quest

- **Run structure.** Both are linear mission-based. Defense Grid: fixed 10-tower roster, available from early on, levels focus on placement mastery. Defender's Quest: JRPG-TD hybrid, mission map with replayable stages.
- **Persists — Defense Grid.** Very little beyond mission completion/medals. Towers are *available but not unlocked over time*; mastery comes from learning the 10 towers, not acquiring more. Replay medals are the meta-layer (bronze/silver/gold scoring).
- **Persists — Defender's Quest.** Squad-level XP, class levels (cap 60), skill tree per defender, up to 37 total defenders across 7 classes, with deployment constrained by a **PSI pool** (squad size vs per-unit power tradeoff).
- **Pacing.** Defender's Quest explicitly balances for NG+ — you hit level ~20 on first clear, 30-50 on NG+, cap 60 for completionists. Missions are replayable for XP farm but constrained by diminishing returns.
- **Difficulty scaling.** Defender's Quest: Normal, Hero, Hero++ (NG+). Defense Grid: no difficulty preset; per-mission medal tiers act as self-selected challenge.
- **Fun/challenge trick.** **PSI as a loadout budget** — more units = less power per unit, forcing real strategic tradeoffs instead of dumping strongest stuff. Defense Grid's "no tower unlocks" forces depth-of-mastery, not breadth-of-collection.

## 6. Slay the Spire & Hades (roguelike gold standard)

### Slay the Spire — Ascension

- **Run structure.** One run = 3 acts (+ secret 4th). Finite. Deck built during the run, reset on death.
- **Persists.** Only card/relic *unlocks* (new stuff appearing in future runs' pools) and Ascension progress per character. **Zero permanent stat boosts.** This is the crucial design choice.
- **Pacing — Ascension.** 20 levels per character. Each level adds ONE specific modifier (more elites, less healing, stronger bosses, starting curse, etc.). Must *win* the previous level to unlock the next — progression gated by skill, not grind.
- **Difficulty scaling.** Cumulative stacking: A10 includes all modifiers from A1-A9. Later levels reveal new mechanics (A10 adds a starting curse card that changes deckbuilding fundamentals).
- **Fun/challenge trick.** Ascension *teaches the game* — each modifier surfaces a strategy layer the player didn't have to engage with before (e.g. forced elite density rewrites your "skip elites" playbook). Difficulty depth comes from re-teaching, not number-bloat.

### Hades — Heat / Pact of Punishment

- **Run structure.** 4 biomes, ~30 min per run, permadeath. Rich narrative meta-layer (NPC conversations advance between runs).
- **Persists.** Mirror of Night (permanent power-ups bought with Darkness), weapon unlocks, Keepsakes, NPC relationships. Deliberately *does* include power creep — but the game is designed around it.
- **Pacing — Heat.** After first clear, players opt into Pact of Punishment: **15+ modifier conditions**, each with 1-5 ranks, each rank adds 1 Heat. Hit the Target Heat on a run = get Titan Blood / Diamond / Ambrosia (endgame resources). Target Heat *raises per weapon* after each clear, tracked independently.
- **Difficulty scaling.** Player-composed. Unlike Ascension's fixed stack, Heat lets you pick *which* pains you take. Some conditions devastate one build but barely touch another.
- **Fun/challenge trick.** (1) **Per-weapon progression** — 6 weapons × independent Heat targets gives 6 progression tracks, preventing burnout. (2) **Heat as tax for rewards** — you *want* more difficulty because it's the only source of endgame currency. Difficulty is desirable, not punitive. (3) **Mirror upgrades are opt-in** — you can respec any time, so players pick their own power level within the permanent meta.

---

## Cross-Cutting Patterns & Recommendations for Neon Defense

### Anti-patterns to avoid

- **Permanent stat boosts that stack without a counterweight.** Roguebook, early Hades II complaints, and Slay the Spire purists all converge: permanent +HP / +damage without a matching difficulty dial turns the game into a grind-gate. If Neon Defense adds permanent stats, pair each with a matching Ascension/Heat-style knob.
- **Mandatory meta grind before the game feels good.** Rogue Tower ships with half the tech tree pre-unlocked for exactly this reason. First three runs must feel complete on their own.
- **RNG-dependent unlocks.** Rogue Legends is the cautionary tale — community criticism centers on "feels like RNG, not progression." Unlocks should be deterministic (skill-gated or spend-gated), randomness belongs *inside* a run.
- **One monolithic progression track.** Burns out at ~20 hours. Per-tower, per-hero, per-weapon, or per-difficulty subtracks keep fresh goals alive (Hades: 6 weapons; BTD6: heroes; Defender's Quest: 7 classes).
- **Letting meta trivialize hard modes.** BTD6's CHIMPS solves this elegantly — the hardest mode *disables* Monkey Knowledge. Any Neon Defense "true" difficulty should be able to opt out of permanent buffs.

### The "one more run" hook — what actually works

1. **Fast restart.** Seconds from game-over to next run. Neon Defense already has this shape; protect it.
2. **New thing visible each run.** Unlock pool in view (not yet owned), or rotating daily seed, or a just-unlocked tower you haven't tried.
3. **Convergent progress even on losses.** Every run yields *some* meta XP / currency, scaled by performance. Failure is not zero-progress.
4. **Skill-gated next tier.** Ascension-style: only winning unlocks the next challenge. This is the hook — "I *almost* had it, one more try."
5. **Multiple progression tracks.** If tower A is fully maxed, there's still B, C, hero D, and difficulty level 7 to chase.

### How difficulty levels should interact with meta-progression

- **Meta unlocks expand the sandbox; difficulty tiers tighten constraints.** Unlocks say "you can now also use X." Ascension/Heat says "now you must deal with Y."
- **Split progression currencies.** Campaign/casual currency buys unlocks. Challenge-mode currency buys cosmetic prestige or pure-skill flexes (Kingdom Rush: Heroic/Iron give *no* upgrade points). Prevents the grind-the-easiest-mode exploit.
- **Make hardest mode able to opt out of meta.** CHIMPS model. Gives speedrunners / purists a clean slate on the same codebase.
- **Per-tower or per-difficulty Heat tracks.** 9 towers × independent Ascension/Heat tracks = ~60+ discrete goals without adding new content.

### Concrete shortlist for Neon Defense

1. **Meta XP on every run**, scaled by wave reached. Spend on a Rogue-Tower-style tree: unlock new tower variants, new upgrade cards, starting-loadout slots. Start with ~40% pre-unlocked.
2. **Difficulty tiers 1-10 (Ascension model)** unlocked by winning the previous tier. Each tier adds ONE stacking modifier: faster air waves, less starting gold, +HP scaling, no sell-refund, starting curse tower, etc.
3. **Purist mode** that disables all permanent unlocks — the Neon Defense equivalent of CHIMPS. Score leaderboard lives here.
4. **Per-tower mastery tracks.** Each tower has its own clear-count / damage-dealt milestones that unlock tower-specific variants or skins. Keeps all 9 towers relevant long-term.
5. **Starting loadout (BTD6 Rogue Legends Party model, fixed).** Pick 5 of 9 towers before a run — forces varied strategies, makes unlocks meaningful (unlocking tower #10 means a new loadout option, not +power).
6. **Daily seed** reusing the existing seed system — single fixed seed per day, global leaderboard. Zero dev cost, infinite "one more run."
7. **Autopilot interaction.** Autopilot should *respect* the loadout and difficulty tier. Could become a meta-level "AI assistant level" — higher AI tiers unlocked by player wins, creates a second progression axis (watch-the-AI-climb mode).

Sources:
- [Rogue Tower Upgrades Wiki](https://rogue-tower.fandom.com/wiki/Upgrades)
- [Rogue Tower Map features Wiki](https://rogue-tower.fandom.com/wiki/Map_features)
- [Rogue Tower - Beginners Guide](https://gamepretty.com/rogue-tower-beginners-guide-game-mechanics-strategies/)
- [Monkey Knowledge (BTD6) Wiki](https://bloons.fandom.com/wiki/Monkey_Knowledge_(BTD6))
- [C.H.I.M.P.S. Wiki](https://bloons.fandom.com/wiki/C.H.I.M.P.S.)
- [Rogue Legends Wiki](https://bloons.fandom.com/wiki/Rogue_Legends)
- [Strategy:Rogue Legends](https://www.bloonswiki.com/Strategy:Rogue_Legends)
- [Kingdom Rush Upgrades Wiki](https://kingdomrushtd.fandom.com/wiki/Upgrades)
- [Kingdom Rush Difficulty Wiki](https://kingdomrushtd.fandom.com/wiki/Difficulty)
- [Mindustry Campaign Wiki](https://mindustry-unofficial.fandom.com/wiki/Campaign)
- [Mindustry Tech Tree Wiki](https://mindustry-unofficial.fandom.com/wiki/Tech_Tree)
- [Defense Grid Awakening Guide (GameFAQs)](https://gamefaqs.gamespot.com/pc/955296-defense-grid-the-awakening/faqs/68016)
- [Defender's Quest Class Guide](https://gamefaqs.gamespot.com/pc/646479-defenders-quest-valley-of-the-forgotten/faqs/73591)
- [Slay the Spire Ascension Wiki](https://slay-the-spire.fandom.com/wiki/Ascension)
- [More games should handle difficulty like Slay the Spire (Frostilyte)](https://frostilyte.ca/2020/04/16/more-games-should-handle-difficulty-like-slay-the-spire/)
- [Hades Pact of Punishment Wiki](https://hades.fandom.com/wiki/Pact_of_Punishment)
- [Hades Heat & Pact of Punishment (RPG Site)](https://www.rpgsite.net/feature/10287-hades-pact-of-punishment-heat-modifiers-and-how-to-maximize-your-rewards)
- [Meta progression with gradual tutorial (Juha-Matti Santala)](https://notes.hamatti.org/gaming/video-games/meta-progression-with-gradual-tutorial-in-roguelike-games)
- [On Roguelikes and Progression Systems (Indiecator)](https://indiecator.org/2022/03/30/on-roguelikes-and-progression-systems/)
- [Roguelite Restart length (Medium)](https://medium.com/@todorovicnik2/video-games-roguelite-restart-length-of-a-perfect-run-ef8078c76495)
