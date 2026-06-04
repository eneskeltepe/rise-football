// ============================================================================
//  35-promotion.js  —  Kume dusme / yukselme (yalniz cok kademeli ulkeler).
//  DB'de sadece su 5 ulkede ayni ulkeden cok lig var: ENG/GER/ESP/ITA/FRA.
//  Sezon sonunda her komsu kademe arasinda alt 3 <-> ust 3 takas edilir.
//  Diger ulkelerin tek ligi oldugu icin onlarda kume dusme YOKTUR.
// ============================================================================

const PYRAMIDS = [
    ['eng-premier-league', 'eng-championship', 'eng-league-one', 'eng-league-two'],
    ['ger-bundesliga', 'ger-bundesliga-2', 'ger-3-liga'],
    ['esp-laliga', 'esp-laliga2'],
    ['ita-serie-a', 'ita-serie-b'],
    ['fra-ligue-1', 'fra-ligue-2'],
];
const SWAP_N = 3;   // her kademe arasinda kac takim takas edilir

// Sezon sonunda cagrilir (initAllStandings'ten ONCE; biten sezon puan durumu lazim)
function runPromotionRelegation() {
    const moves = [];
    for (const chain of PYRAMIDS) {
        for (let i = 0; i < chain.length - 1; i++) {
            const up = chain[i], down = chain[i + 1];
            if (!DB.getLeague(up) || !DB.getLeague(down)) continue;
            const upS = standingsSorted(up), downS = standingsSorted(down);
            if (upS.length < SWAP_N + 2 || downS.length < SWAP_N + 2) continue;   // emniyet
            const relegated = upS.slice(-SWAP_N).map(r => r.id);
            const promoted = downS.slice(0, SWAP_N).map(r => r.id);
            relegated.forEach(id => { const t = DB.getTeam(id); if (t) { t.leagueId = down; moves.push({ id, name: t.name, dir: 'down', league: down }); } });
            promoted.forEach(id => { const t = DB.getTeam(id); if (t) { t.leagueId = up; moves.push({ id, name: t.name, dir: 'up', league: up }); } });
        }
    }
    if (moves.length) { DB.invalidate(); resetFixtureCache(); }
    return moves;
}

function announcePromotionForPlayer(moves) {
    const p = gameState.player;
    if (!p || !p.teamId || !moves || !moves.length) return;
    const mine = moves.find(m => m.id === p.teamId);
    if (!mine) return;
    const lg = DB.getLeague(mine.league) || { name: 'Lig' };
    if (mine.dir === 'up') {
        showToast(`🎉 ${p.teamName} ${lg.name} liginE YÜKSELDİ! Yeni sezon üst kademede.`, 'success');
        gameState.trophies.push({ season: gameState.currentSeason, title: `${lg.name}'e Yükselme` });
    } else {
        showToast(`⬇️ ${p.teamName} ${lg.name} ligine düştü. Hedef: hemen geri çıkmak!`, 'warning');
    }
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        PYRAMIDS, runPromotionRelegation, announcePromotionForPlayer,
    });
}
