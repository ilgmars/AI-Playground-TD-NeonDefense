// Seeded PRNG (mulberry32)
function createRng(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

var TILE_SIZE = 40;
var COLS = 20;
var ROWS = 15;

class GameMap {
    constructor(seed) {
        this.seed = seed != null ? seed : Math.floor(Math.random() * 99999) + 1;
        this.generateMap();
    }

    generateMap() {
        let rng = createRng(this.seed);

        this.grid = [];
        for (let r = 0; r < ROWS; r++) {
            this.grid.push(new Array(COLS).fill(0));
        }

        this.path = [];

        // The walk runs along the board's LONG axis: wide boards
        // (default 24×16) walk left→right, TALL boards (the portrait
        // "field rotated −90°" option, 16×24) walk top→bottom so
        // enemies come from above. The RNG call sequence is identical
        // to the original left→right walker, so every existing seed
        // still produces the exact same wide map.
        const tall = ROWS > COLS;
        const mainLen  = tall ? ROWS : COLS;     // walk-axis length
        const crossLen = tall ? COLS : ROWS;     // wander-axis length
        const P = (main, cross) => tall ? { c: cross, r: main } : { c: main, r: cross };

        let main = 0;
        let cross = Math.floor(rng() * (crossLen - 4)) + 2;

        this.path.push(P(main, cross));
        this.startPoint = this.path[0];

        while (main < mainLen - 1) {
            let stepFwd = Math.floor(rng() * 3) + 2;
            if (main + stepFwd >= mainLen - 1) stepFwd = (mainLen - 1) - main;

            for (let i = 0; i < stepFwd; i++) {
                main++;
                this.path.push(P(main, cross));
            }

            if (main === mainLen - 1) break;

            let canBack = cross > 2;
            let canFwd  = cross < crossLen - 3;
            if (!canBack && !canFwd) continue;

            let dir = 1;
            if (canBack && canFwd) dir = rng() < 0.5 ? 1 : -1;
            else if (canBack) dir = -1;

            let maxDist = dir === 1 ? crossLen - 2 - cross : cross - 2;
            if (maxDist < 2) continue;

            let dist = Math.floor(rng() * (maxDist - 1)) + 2;
            for (let i = 0; i < dist; i++) {
                cross += dir;
                this.path.push(P(main, cross));
            }
        }

        this.endPoint = this.path[this.path.length - 1];

        for (let i = 0; i < this.path.length; i++) {
            let p = this.path[i];
            if (i === 0) this.grid[p.r][p.c] = 3;
            else if (i === this.path.length - 1) this.grid[p.r][p.c] = 2;
            else this.grid[p.r][p.c] = 1;
        }
    }

    // Shortcut candidates for the 'cutter' enemy: non-overlapping
    // (from, to) path-index pairs where ≥ MIN_SAVED tiles of road can
    // be replaced by ≤ MAX_CROSS tiles of straight-line OPEN GRASS —
    // the classic U-bend. Deterministic (pure grid geometry, no RNG),
    // computed lazily once per map and stashed on path._shortcuts so
    // enemies can read it without a map reference.
    computeShortcuts() {
        if (this._shortcuts) return this._shortcuts;
        const MIN_SAVED = 10;
        const MAX_CROSS = 3.6;
        const out = [];
        let i = 0;
        while (i < this.path.length - MIN_SAVED) {
            let found = null;
            // Longest skip first — cutters take the best cut available.
            for (let j = this.path.length - 1; j >= i + MIN_SAVED; j--) {
                const a = this.path[i], b = this.path[j];
                if (Math.hypot(b.c - a.c, b.r - a.r) > MAX_CROSS) continue;
                if (!this._lineIsGrass(a, b)) continue;
                found = { from: i, to: j };
                break;
            }
            if (found) { out.push(found); i = found.to; }
            else i++;
        }
        this._shortcuts = out;
        this.path._shortcuts = out;
        return out;
    }

    // Tiles a straight crossing passes over (deduped, in order),
    // endpoints excluded. Used by the digger boss to carve its trail.
    crossingTiles(a, b) {
        const steps = Math.max(2, Math.ceil(Math.hypot(b.c - a.c, b.r - a.r) * 4));
        const out = [];
        const seen = new Set();
        for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const c = Math.round(a.c + (b.c - a.c) * t);
            const r = Math.round(a.r + (b.r - a.r) * t);
            if ((c === a.c && r === a.r) || (c === b.c && r === b.r)) continue;
            const k = c + '|' + r;
            if (!seen.has(k)) { seen.add(k); out.push({ c, r }); }
        }
        return out;
    }

    // Digger boss commit: carve the crossing between path indices
    // from→to into permanent road and rebuild the canonical path so
    // every FUTURE spawn takes the shorter route. The old loop's tiles
    // stay grid=1 (still road, still unbuildable) and enemies already
    // in flight keep their old path array — both remain valid.
    // Returns the dug tiles. _rev bumps so the cached map layer
    // re-rasterizes.
    digShortcut(from, to) {
        const a = this.path[from], b = this.path[to];
        if (!a || !b) return null;
        const dug = this.crossingTiles(a, b);
        for (const t of dug) this.grid[t.r][t.c] = 1;
        const newPath = this.path.slice(0, from + 1)
            .concat(dug)
            .concat(this.path.slice(to));
        this.path = newPath;
        this.endPoint = this.path[this.path.length - 1];
        this._rev = (this._rev || 0) + 1;
        this._shortcuts = null;                 // recompute on demand
        delete this.path._shortcuts;
        return dug;
    }

    // Pick the digger's target: the longest-saving shortcut whose
    // crossing is pure grass AND free of towers. Relaxed thresholds vs
    // the cutter's (a boss digs harder). Deterministic given the same
    // map + tower layout.
    pickDigSite(towers) {
        const MIN_SAVED = 8;
        const MAX_CROSS = 4.5;
        const occupied = new Set((towers || []).map(t => t.c + '|' + t.r));
        let best = null;
        for (let i = 0; i < this.path.length - MIN_SAVED; i++) {
            for (let j = this.path.length - 1; j >= i + MIN_SAVED; j--) {
                const a = this.path[i], b = this.path[j];
                if (Math.hypot(b.c - a.c, b.r - a.r) > MAX_CROSS) continue;
                if (!this._lineIsGrass(a, b)) continue;
                if (this.crossingTiles(a, b).some(t => occupied.has(t.c + '|' + t.r))) continue;
                const saved = (j - i) - Math.hypot(b.c - a.c, b.r - a.r);
                if (!best || saved > best.saved) best = { from: i, to: j, saved };
                break;      // longest j for this i — move on
            }
        }
        return best ? { from: best.from, to: best.to } : null;
    }

    // Every tile the straight segment between two path tiles crosses
    // (sampled at quarter-tile steps) must be open grass (grid 0).
    _lineIsGrass(a, b) {
        const steps = Math.max(2, Math.ceil(Math.hypot(b.c - a.c, b.r - a.r) * 4));
        for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const c = Math.round(a.c + (b.c - a.c) * t);
            const r = Math.round(a.r + (b.r - a.r) * t);
            if ((c === a.c && r === a.r) || (c === b.c && r === b.r)) continue;
            if (!this.grid[r] || this.grid[r][c] === undefined) return false;
            if (this.grid[r][c] !== 0) return false;
        }
        return true;
    }

    draw(ctx) {
        // Iterate THIS map's grid, never the live COLS/ROWS globals.
        // When the FIELD orientation toggles, the globals swap to the
        // new dimensions before the next Game is constructed — drawing
        // the old map against the new globals walked off the grid
        // ("portrait mode does not start the game at all": the crash
        // aborted restartGame).
        const rows = this.grid.length;
        const cols = this.grid[0] ? this.grid[0].length : 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = c * TILE_SIZE;
                const y = r * TILE_SIZE;
                const cell = this.grid[r][c];

                if (cell === 0) {
                    drawGridTile(ctx, x, y, TILE_SIZE);
                } else if (cell === 1) {
                    drawPathTile(ctx, x, y, TILE_SIZE);
                } else if (cell === 2) {
                    drawBaseTile(ctx, x, y, TILE_SIZE);
                } else if (cell === 3) {
                    drawSpawnerTile(ctx, x, y, TILE_SIZE);
                }
            }
        }
    }

    isBuildable(c, r) {
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
        return this.grid[r][c] === 0;
    }
}
