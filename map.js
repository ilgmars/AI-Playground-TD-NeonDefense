var TILE_SIZE = 40;
var COLS = 20;
var ROWS = 15;

class GameMap {
    constructor() {
        this.generateMap();
    }

    generateMap() {
        this.grid = [];
        for (let r = 0; r < ROWS; r++) {
            let row = [];
            for (let c = 0; c < COLS; c++) {
                row.push(0);
            }
            this.grid.push(row);
        }
        
        this.paths = []; 
        let numPaths = Math.random() < 0.6 ? 2 : 1; 
        if (ROWS > 20 && Math.random() < 0.3) numPaths = 3; 
        
        let endR = Math.floor(Math.random() * (ROWS - 6)) + 3;
        let endC = COLS - 1;
        this.endPoint = { c: endC, r: endR };
        
        for (let p = 0; p < numPaths; p++) {
            let path = [];
            let c = 0;
            let r;
            
            if (numPaths === 1) {
                r = Math.floor(Math.random() * (ROWS - 4)) + 2;
            } else if (numPaths === 2) {
                if (p === 0) r = Math.floor(Math.random() * (Math.floor(ROWS/2) - 2)) + 1;
                else r = Math.floor(Math.random() * (Math.floor(ROWS/2) - 2)) + Math.floor(ROWS/2) + 1;
            } else {
                if (p === 0) r = 2;
                else if (p === 1) r = Math.floor(ROWS/2);
                else r = ROWS - 3;
            }
            
            path.push({c, r});
            
            while (c < endC) {
                let stepRight = Math.floor(Math.random() * 4) + 2;
                if (c + stepRight >= endC) {
                    stepRight = endC - c;
                }
                
                for (let i = 0; i < stepRight; i++) {
                    c++;
                    path.push({c, r});
                }
                
                if (c === endC) {
                    let targetR = endR;
                    if (r < targetR) {
                        let steps = targetR - r;
                        for (let i = 0; i < steps; i++) {
                            r++;
                            path.push({c, r});
                        }
                    } else if (r > targetR) {
                        let steps = r - targetR;
                        for (let i = 0; i < steps; i++) {
                            r--;
                            path.push({c, r});
                        }
                    }
                    break;
                }
                
                // Smooth vertical movement towards the base to prevent weird U-shapes
                let dir = (r < endR) ? 1 : -1;
                // Add a bit of randomness so they don't immediately converge perfectly
                if (Math.random() < 0.3) {
                    let canReverse = (dir === 1 && r > 2) || (dir === -1 && r < ROWS - 3);
                    if (canReverse) dir *= -1;
                }
                
                let maxDist = dir === 1 ? ROWS - 2 - r : r - 2;
                if (maxDist < 2) continue;
                
                let dist = Math.floor(Math.random() * (Math.min(maxDist, 4) - 1)) + 2;
                for (let i = 0; i < dist; i++) {
                    r += dir;
                    path.push({c, r});
                }
            }
            this.paths.push(path);
        }
        
        for (let pIdx = 0; pIdx < this.paths.length; pIdx++) {
            let path = this.paths[pIdx];
            for (let i = 0; i < path.length; i++) {
                let p = path[i];
                if (p.c === 0) {
                    this.grid[p.r][p.c] = 3;  // Start
                } else if (p.c === endC && p.r === endR) {
                    this.grid[p.r][p.c] = 2; // Base
                } else {
                    if (this.grid[p.r][p.c] !== 2 && this.grid[p.r][p.c] !== 3) {
                        this.grid[p.r][p.c] = 1; // Path
                    }
                }
            }
        }
        this.grid[endR][endC] = 2; // Force base
        this.path = this.paths[0]; 
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
