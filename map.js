var TILE_SIZE = 40;
var COLS = 20;
var ROWS = 15;

class GameMap {
    constructor() {
        this.generateMap();
    }

    generateMap() {
        // Initialize empty grid
        this.grid = [];
        for (let r = 0; r < ROWS; r++) {
            let row = [];
            for (let c = 0; c < COLS; c++) {
                row.push(0);
            }
            this.grid.push(row);
        }
        
        this.path = [];
        
        let c = 0;
        let r = Math.floor(Math.random() * (ROWS - 4)) + 2; 
        
        this.path.push({c, r});
        this.startPoint = {c, r};
        
        while (c < COLS - 1) {
            // Move right
            let stepRight = Math.floor(Math.random() * 3) + 2; // 2 to 4 steps
            if (c + stepRight >= COLS - 1) {
                stepRight = (COLS - 1) - c;
            }
            
            for (let i = 0; i < stepRight; i++) {
                c++;
                this.path.push({c, r});
            }
            
            if (c === COLS - 1) break; 
            
            // Move vertical
            let canUp = r > 2;
            let canDown = r < ROWS - 3;
            
            if (!canUp && !canDown) continue;
            
            let dir = 1;
            if (canUp && canDown) {
                dir = Math.random() < 0.5 ? 1 : -1;
            } else if (canUp) {
                dir = -1;
            } else {
                dir = 1;
            }
            
            let maxDist = dir === 1 ? ROWS - 2 - r : r - 2;
            if (maxDist < 2) continue; // Minimum vertical step is 2
            
            let dist = Math.floor(Math.random() * (maxDist - 1)) + 2;
            
            for (let i = 0; i < dist; i++) {
                r += dir;
                this.path.push({c, r});
            }
        }
        
        this.endPoint = this.path[this.path.length - 1];
        
        // Write path to grid
        for (let i = 0; i < this.path.length; i++) {
            let p = this.path[i];
            if (i === 0) {
                this.grid[p.r][p.c] = 3;  // Start
            } else if (i === this.path.length - 1) {
                this.grid[p.r][p.c] = 2; // Base
            } else {
                this.grid[p.r][p.c] = 1; // Path
            }
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
