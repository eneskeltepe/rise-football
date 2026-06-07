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
// EFL/FM modeli: alt RELEGATE_N düşer; üst AUTO_PROMOTE OTOMATİK çıkar; +1 PLAYOFF (3.–6. sıra)
// → toplam çıkış = düşüş (lig boyları sabit). Playoff DETERMİNİSTİK çözülür (yapı hazır: ileride
// gameState._lastPlayoffs'tan interaktif playoff maçları oynatılabilir).
const RELEGATE_N = 3, AUTO_PROMOTE = 2, PLAYOFF_POOL = 4;

// Deterministik [0,1) RNG (kariyer tohumlu) — playoff sonucu reload'da tutarlı.
function _promoRand(key) {
    const salt = (typeof gameState !== 'undefined' && gameState && gameState.careerSalt != null) ? gameState.careerSalt : 0;
    if (typeof _detRng === 'function') return _detRng(salt + '|' + key);
    let h = 2166136261; const s = salt + '|' + key; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    let st = h >>> 0; return function () { st = (st * 1103515245 + 12345) & 0x7fffffff; return st / 0x7fffffff; };
}
// Playoff: AUTO_PROMOTE+1 .. AUTO_PROMOTE+PLAYOFF_POOL sıraları arasından deterministik kazanan
// (üst sıra hafif favori + güç + tohumlu şans). Döner: { winner, cands:[{id,rank,name}] }.
function _resolvePlayoff(downS, season, key) {
    const pool = downS.slice(AUTO_PROMOTE, AUTO_PROMOTE + PLAYOFF_POOL);
    if (!pool.length) return { winner: null, cands: [] };
    const rng = _promoRand('po|' + key + '|' + season);
    let best = pool[0].id, bestScore = -1;
    pool.forEach((r, i) => {
        const t = DB.getTeam(r.id) || {};
        const score = (t.power || 65) * (1.12 - i * 0.05) * (0.85 + rng() * 0.3);
        if (score > bestScore) { bestScore = score; best = r.id; }
    });
    return { winner: best, cands: pool.map((r, i) => ({ id: r.id, rank: AUTO_PROMOTE + i + 1, name: (DB.getTeam(r.id) || {}).name })) };
}

// Sezon sonunda cagrilir (initAllStandings'ten ONCE; biten sezon puan durumu lazim)
function runPromotionRelegation() {
    const moves = [], playoffs = [];
    const season = (typeof gameState !== 'undefined') ? gameState.currentSeason : 0;
    for (const chain of PYRAMIDS) {
        for (let i = 0; i < chain.length - 1; i++) {
            const up = chain[i], down = chain[i + 1];
            if (!DB.getLeague(up) || !DB.getLeague(down)) continue;
            const upS = standingsSorted(up), downS = standingsSorted(down);
            if (upS.length < RELEGATE_N + 2 || downS.length < AUTO_PROMOTE + 2) continue;   // emniyet
            const relegated = upS.slice(-RELEGATE_N).map(r => r.id);
            const auto = downS.slice(0, AUTO_PROMOTE).map(r => r.id);
            const po = _resolvePlayoff(downS, season, up + '|' + i);
            const promoted = auto.concat(po.winner ? [po.winner] : []).filter(Boolean);
            if (po.cands.length) playoffs.push({ fromLeague: down, toLeague: up, season, autoPromoted: auto, candidates: po.cands, winner: po.winner });
            relegated.forEach(id => { const t = DB.getTeam(id); if (t) { t.leagueId = down; moves.push({ id, name: t.name, dir: 'down', league: down }); } });
            promoted.forEach(id => { const t = DB.getTeam(id); if (t) { t.leagueId = up; moves.push({ id, name: t.name, dir: 'up', league: up, via: (auto.indexOf(id) < 0) ? 'playoff' : 'auto' }); } });
        }
    }
    gameState._lastPlayoffs = playoffs;   // yapı hazır (ileride interaktif playoff UI bunu okur)
    if (moves.length) { DB.invalidate(); resetFixtureCache(); }
    return moves;
}

function announcePromotionForPlayer(moves) {
    const p = gameState.player;
    if (!p || !p.teamId) return;
    const mine = (moves || []).find(m => m.id === p.teamId);
    if (mine) {
        const lg = DB.getLeague(mine.league) || { name: 'Lig' };
        if (mine.dir === 'up') {
            const via = mine.via === 'playoff' ? ' Play-off finalini kazanarak çıktın!' : ' (doğrudan yükselme)';
            showToast(`🎉 ${p.teamName} ${lg.name} ligine YÜKSELDİ!${via}`, 'success');
            gameState.trophies.push({ season: gameState.currentSeason, title: `${lg.name}'e Yükselme${mine.via === 'playoff' ? ' (Play-off)' : ''}` });
        } else {
            showToast(`⬇️ ${p.teamName} ${lg.name} ligine düştü. Hedef: hemen geri çıkmak!`, 'warning');
        }
        return;
    }
    // Playoff'a kaldı ama kazanamadı → bilgilendir (yapı hazır; ileride interaktif oynanır)
    const po = (gameState._lastPlayoffs || []).find(x => x.candidates.some(c => c.id === p.teamId));
    if (po && po.winner !== p.teamId) showToast(`Play-off'a kaldın ama finali kaybettin — yükselemedin. Sonraki sezon yeniden!`, 'warning');
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        PYRAMIDS, runPromotionRelegation, announcePromotionForPlayer,
        _resolvePlayoff,
    });
}
