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
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
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
