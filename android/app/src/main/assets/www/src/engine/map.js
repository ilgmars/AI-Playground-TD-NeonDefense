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

        let c = 0;
        let r = Math.floor(rng() * (ROWS - 4)) + 2;

        this.path.push({c, r});
        this.startPoint = {c, r};

        while (c < COLS - 1) {
            let stepRight = Math.floor(rng() * 3) + 2;
            if (c + stepRight >= COLS - 1) stepRight = (COLS - 1) - c;

            for (let i = 0; i < stepRight; i++) {
                c++;
                this.path.push({c, r});
            }

            if (c === COLS - 1) break;

            let canUp = r > 2;
            let canDown = r < ROWS - 3;
            if (!canUp && !canDown) continue;

            let dir = 1;
            if (canUp && canDown) dir = rng() < 0.5 ? 1 : -1;
            else if (canUp) dir = -1;

            let maxDist = dir === 1 ? ROWS - 2 - r : r - 2;
            if (maxDist < 2) continue;

            let dist = Math.floor(rng() * (maxDist - 1)) + 2;
            for (let i = 0; i < dist; i++) {
                r += dir;
                this.path.push({c, r});
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
