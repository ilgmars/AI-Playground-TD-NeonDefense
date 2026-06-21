// Regression: a name typed with diacritics used to produce a PHANTOM
// duplicate on the global scoreboard. The sanitiser just stripped the
// accented letter (ILGMÁRS → ILGMRS) instead of folding it to ASCII, so the
// same player showed up twice — once as 'ILGMRS' and once as the plain
// 'ILGMARS' — both at the same wave (see the user's screenshot). The fix
// NFKD-normalises and drops combining marks BEFORE stripping, so accented
// and plain spellings collapse to ONE board key.
const G = require('../src/multiplayer/global.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

// 1) validateEntry folds accents to ASCII.
const folds = [
    ['ILGMÁRS', 'ILGMARS'],
    ['JOSÉ',    'JOSE'],
    ['MÜLLER',  'MULLER'],
    ['ÅSA',     'ASA'],
    [' илья',   ''],        // non-latin has no ASCII base → stripped → rejected (empty)
];
for (const [input, want] of folds) {
    const v = G.validateEntry({ name: input, wave: 50, tier: 0 });
    const got = v ? v.name : '';
    ok(`fold ${JSON.stringify(input)} -> ${JSON.stringify(want)}`, got === want, `got ${JSON.stringify(got)}`);
}

// 2) Accented and plain spelling share ONE dedup key (name|tier).
const a = G.validateEntry({ name: 'ILGMÁRS', wave: 677, tier: 0 });
const b = G.validateEntry({ name: 'ILGMARS', wave: 677, tier: 0 });
ok('accented and plain canonicalise identically', a.name === b.name, `${a.name} vs ${b.name}`);

// 3) Behavioural: publishing both into a real board yields ONE entry.
const board = G.createGlobalBoard();
board.publish({ name: 'ILGMARS', wave: 677, tier: 0 });
board.publish({ name: 'ILGMÁRS', wave: 677, tier: 0 });   // same player, accented
const ilg = board.snapshot().filter(e => e.name === 'ILGMARS');
ok('no phantom duplicate on the board', ilg.length === 1, `got ${ilg.length}: ${JSON.stringify(board.snapshot().map(e => e.name))}`);

// 4) Genuinely different names are NOT over-merged (don't fold too hard).
const board2 = G.createGlobalBoard();
board2.publish({ name: 'ILGMARS', wave: 677, tier: 0 });
board2.publish({ name: 'AI', wave: 467, tier: 0 });
ok('distinct names stay distinct', board2.snapshot().length === 2, JSON.stringify(board2.snapshot().map(e => e.name)));

console.log(`\nNAME ACCENT FOLD: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
