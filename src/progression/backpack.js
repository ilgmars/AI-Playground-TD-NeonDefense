// Backpack-Hero-style spatial inventory — pure logic, no DOM. Shared by the
// UI (src/engine/main.js) and the run-effect application (game.js), and
// require()-able in node tests. All functions are deterministic.
//
// backpack shape: { w, h, placed: [{ id, x, y, rot }], stash: [id, ...] }
//   rot ∈ {0,1,2,3} = 90° clockwise steps. (x,y) is the top-left of the
//   item's (rotated) shape bounding box in grid coords.
const NeonBackpack = (function () {

    // Rotate a 0/1 matrix 90° clockwise `rot` times. Returns a new matrix.
    function rotateShape(shape, rot) {
        let m = shape.map(row => row.slice());
        const times = ((rot % 4) + 4) % 4;
        for (let t = 0; t < times; t++) {
            const R = m.length, C = m[0].length;
            const out = [];
            for (let c = 0; c < C; c++) {
                out.push([]);
                for (let r = R - 1; r >= 0; r--) out[c].push(m[r][c]);
            }
            m = out;
        }
        return m;
    }

    // Occupied [dx,dy] offsets of a rotated shape (relative to its box).
    function shapeOffsets(shape, rot) {
        const m = rotateShape(shape, rot);
        const out = [];
        for (let y = 0; y < m.length; y++)
            for (let x = 0; x < m[y].length; x++)
                if (m[y][x]) out.push([x, y]);
        return out;
    }

    function shapeSize(shape, rot) {
        const m = rotateShape(shape, rot);
        return { w: m[0].length, h: m.length };
    }

    // Absolute grid cells a placed item occupies.
    function itemCells(itemDef, place) {
        return shapeOffsets(itemDef.shape, place.rot || 0)
            .map(([dx, dy]) => [place.x + dx, place.y + dy]);
    }

    // Map "x,y" -> index into backpack.placed (skip `ignoreIdx`).
    function occupancy(backpack, ITEMS, ignoreIdx) {
        const map = {};
        backpack.placed.forEach((p, idx) => {
            if (idx === ignoreIdx) return;
            const def = ITEMS[p.id];
            if (!def) return;
            for (const [cx, cy] of itemCells(def, p)) map[cx + ',' + cy] = idx;
        });
        return map;
    }

    // Can `def` be placed at (x,y,rot) without leaving the grid or
    // overlapping any other placed item (optionally ignoring one index)?
    function canPlace(backpack, ITEMS, def, x, y, rot, ignoreIdx) {
        const occ = occupancy(backpack, ITEMS, ignoreIdx);
        for (const [dx, dy] of shapeOffsets(def.shape, rot)) {
            const cx = x + dx, cy = y + dy;
            if (cx < 0 || cy < 0 || cx >= backpack.w || cy >= backpack.h) return false;
            if (occ[cx + ',' + cy] !== undefined) return false;
        }
        return true;
    }

    const STAT_KEYS = ['damage', 'fireRate', 'payout', 'kill', 'maxHP', 'interest', 'towerCost', 'upgradeCost'];

    function zeroStats() {
        const s = {};
        for (const k of STAT_KEYS) s[k] = 0;
        return s;
    }

    function addInto(acc, delta, scale) {
        if (!delta) return;
        for (const k of STAT_KEYS) if (delta[k]) acc[k] += delta[k] * (scale == null ? 1 : scale);
    }

    // Sum every placed item's base effect plus adjacency synergies.
    // Adjacency = an orthogonally-touching cell owned by a DIFFERENT placed
    // item whose tags intersect the synergy's tags. Count capped at max.
    function computeStats(backpack, ITEMS) {
        const acc = zeroStats();
        if (!backpack || !Array.isArray(backpack.placed)) return acc;

        const owner = occupancy(backpack, ITEMS);          // "x,y" -> idx
        backpack.placed.forEach((p, idx) => {
            const def = ITEMS[p.id];
            if (!def) return;
            addInto(acc, def.effect);

            if (def.synergy) {
                const seen = new Set();
                let adj = 0;
                for (const [cx, cy] of itemCells(def, p)) {
                    for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]) {
                        const oIdx = owner[nx + ',' + ny];
                        if (oIdx === undefined || oIdx === idx) continue;
                        const oDef = ITEMS[backpack.placed[oIdx].id];
                        if (!oDef || !oDef.tags) continue;
                        const key = oIdx + ':' + cx + ',' + cy;
                        if (seen.has(key)) continue;
                        if (def.synergy.tags.some(t => oDef.tags.includes(t))) {
                            seen.add(key);
                            adj++;
                        }
                    }
                }
                if (def.synergy.max != null) adj = Math.min(adj, def.synergy.max);
                addInto(acc, def.synergy.perAdj, adj);
            }
        });
        return acc;
    }

    // Weighted-by-rarity random item id. randFn defaults to Math.random
    // (re-seeded by the auto-tune harness, so determinism there holds).
    function salvageRoll(ITEMS, WEIGHTS, randFn) {
        const r = randFn || Math.random;
        const ids = Object.keys(ITEMS);
        let total = 0;
        const w = ids.map(id => {
            const ww = (WEIGHTS && WEIGHTS[ITEMS[id].rarity]) || 1;
            total += ww;
            return ww;
        });
        let roll = r() * total;
        for (let i = 0; i < ids.length; i++) {
            roll -= w[i];
            if (roll <= 0) return ids[i];
        }
        return ids[ids.length - 1];
    }

    // Rarity weights for *earned* loot (OVERCLOCK / end-of-run). `luck`
    // rises with how far the player pushed / how deep the run went and
    // biases the roll toward rarer items.
    function lootWeights(luck) {
        const L = Math.max(0, luck || 0);
        return {
            common:   Math.max(5, 60 - L * 8),
            uncommon: 30 + L * 3,
            rare:     10 + L * 6,
        };
    }
    function lootRoll(ITEMS, luck, randFn) {
        return salvageRoll(ITEMS, lootWeights(luck), randFn);
    }

    return {
        rotateShape, shapeOffsets, shapeSize, itemCells,
        occupancy, canPlace, computeStats, salvageRoll,
        lootWeights, lootRoll, STAT_KEYS, zeroStats
    };
})();

if (typeof window !== 'undefined') window.NeonBackpack = NeonBackpack;
if (typeof module !== 'undefined' && module.exports) module.exports = { NeonBackpack };
