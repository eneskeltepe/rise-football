// ============================================================================
//  53-finance.js  —  KULÜP FİNANSI (kalıcı kasa + gerçek gelir/gider kalemleri)
//  Her kulübe KALICI bakiye: gelir (bilet/maç-başı, yayın/TV, ödül/şampiyonluk,
//  sponsorluk, oyuncu satışı) − gider (maaş, bonservis, işletme). Transfer bütçesi
//  kasadan türer (clubBudget → financeTransferBudget). Kulüp borçlanabilir.
//  Dünya kulüpleri FORMÜL (squad yüklemeden → performans); KULLANICI kulübü mümkünse
//  gerçek squad maaşıyla. Sezon-sonu `settleClubFinances` (evolveWorld'den ÖNCE).
//  52-market'ten SONRA yüklenir.
// ============================================================================

// ---- Kasa erişimi (lazy init) ----
function _finOf(teamId) {
    if (!gameState.clubFin) gameState.clubFin = {};
    let f = gameState.clubFin[teamId];
    if (!f) {
        const t = (typeof DB !== 'undefined' && DB.getTeam(teamId)) || {};
        const seed = (typeof _clubBudgetFormula === 'function') ? _clubBudgetFormula(t) : 5000000;
        f = gameState.clubFin[teamId] = {
            balance: Math.round(seed),
            season: (typeof gameState !== 'undefined' && gameState.currentSeason) || 2026,
            rev: { gate: 0, tv: 0, prize: 0, sponsor: 0, sales: 0 },
            exp: { wages: 0, ops: 0, transfers: 0 },
            lastNet: 0,
        };
    }
    return f;
}

// ---- Gelir/gider formülleri (yıllık, EUR) ----
function _estRevenue(t, rank) {
    const lg = (typeof DB !== 'undefined' && DB.getLeague(t.leagueId)) || { avgPower: 65, teamCount: 18 };
    const av = lg.avgPower || 65, pres = t.prestige || 2, pw = t.power || 65;
    const cap = (t.stadium && t.stadium.capacity) || 20000;
    const homeGames = Math.max(10, (lg.teamCount || 18) - 1);
    // Bilet / maç-başı: kapasite × doluluk × bilet fiyatı × ev maçı
    const ticket = 8 + pres * 7 + Math.max(0, av - 65) * 0.8;
    const occ = Math.max(0.4, Math.min(0.98, 0.45 + pres * 0.10 + (pw - 65) * 0.005));
    const gate = Math.round(cap * occ * ticket * homeGames);
    // Yayın/TV: lig kalitesi tabanı × sıra meriti
    const tvBase = Math.pow(Math.max(0, av - 58), 2) * 60000;
    const merit = (lg.teamCount && rank) ? (0.7 + 0.6 * (lg.teamCount - rank + 1) / lg.teamCount) : 1;
    const tv = Math.round(tvBase * merit);
    // Ödül / şampiyonluk: sıraya göre
    const rankMult = rank <= 1 ? 2.6 : rank <= 4 ? 1.6 : rank <= 10 ? 0.8 : 0.35;
    const prize = Math.round(tvBase * 0.35 * rankMult);
    // Sponsorluk: prestij + lig
    const sponsor = Math.round(Math.pow(pres, 1.8) * 1200000 + Math.max(0, av - 60) * 200000);
    return { gate, tv, prize, sponsor };
}
function _estWages(t) {
    // Kullanıcının kulübü + squad yüklüyse GERÇEK maaş; değilse power/prestij tahmini.
    try {
        if (typeof gameState !== 'undefined' && gameState.player && gameState.player.teamId === t.id
            && typeof DB !== 'undefined' && typeof DB.squadSync === 'function') {
            const sq = DB.squadSync(t.id) || [];
            if (sq.length >= 8) {
                let w = 0;
                for (const p of sq) w += calcWage(p.ovr || 60, t.prestige || 2);
                if (gameState.player.wage) w += gameState.player.wage;
                return Math.round(w * 52 * 0.9);   // haftalık → yıllık (hafif iskonto)
            }
        }
    } catch (e) { /* squad yok → formül */ }
    const sz = t.squadSize || 25;
    return Math.round(sz * calcWage(Math.max(50, (t.power || 65) - 3), t.prestige || 2) * 52 * 0.6);
}
function _estOps(t) {
    const cap = (t.stadium && t.stadium.capacity) || 20000;
    return Math.round(cap * 120 + (t.prestige || 2) * 1500000);   // stadyum bakım + işletme
}

// ---- Transfer bütçesi (clubBudget bunu kullanır) ----
function financeTransferBudget(t) {
    if (!t || !t.id) return 0;
    const f = _finOf(t.id);
    const fromCash = Math.max(0, f.balance) * 0.7;            // kasanın %70'i harcanabilir
    const expectedNet = Math.max(0, f.lastNet || 0) * 0.5;    // beklenen pozitif sezon netinin payı
    return Math.round(fromCash + expectedNet);
}

// ---- Anlık transfer bedeli akışı (AI + kullanıcı) ----
function applyTransferFee(buyerId, sellerId, fee) {
    fee = Math.max(0, Math.round(fee || 0));
    if (!fee) return;
    if (buyerId) { const b = _finOf(buyerId); b.balance -= fee; b.exp.transfers = (b.exp.transfers || 0) + fee; }
    if (sellerId) { const s = _finOf(sellerId); s.balance += fee; s.rev.sales = (s.rev.sales || 0) + fee; }
}

// ---- Sezon-sonu yıllık hesaplaşma (tüm kulüpler tek geçiş; evolveWorld'den ÖNCE) ----
function settleClubFinances(season) {
    if (typeof DB === 'undefined') return;
    const teams = DB.teams() || [];
    const rankCache = {};
    const rankOf = (t) => {
        const lid = t.leagueId;
        if (!(lid in rankCache)) {
            let ids = [];
            try { if (typeof standingsSorted === 'function') ids = (standingsSorted(lid) || []).map(x => x.id || x.teamId); } catch (e) { }
            rankCache[lid] = ids;
        }
        const i = rankCache[lid].indexOf(t.id);
        if (i >= 0) return i + 1;
        // yedek: lig içi güç sırası
        const peers = (typeof DB.teamsInLeague === 'function') ? DB.teamsInLeague(lid) : [t];
        const sorted = peers.slice().sort((a, b) => (b.power || 0) - (a.power || 0));
        const j = sorted.findIndex(x => x.id === t.id);
        return j >= 0 ? j + 1 : Math.ceil((peers.length || 18) / 2);
    };
    for (const t of teams) {
        const f = _finOf(t.id);
        const rank = rankOf(t);
        const r = _estRevenue(t, rank);
        const wages = _estWages(t), ops = _estOps(t);
        const sales = (f.rev && f.rev.sales) || 0;          // sezon içi birikmiş (applyTransferFee)
        const transfers = (f.exp && f.exp.transfers) || 0;
        const opNet = (r.gate + r.tv + r.prize + r.sponsor) - (wages + ops);
        // Bonservis akışı balance'a ZATEN anlık işlendi (applyTransferFee) → settlement yalnız işletme netini ekler.
        f.balance = Math.round(f.balance + opNet);
        f.lastNet = Math.round((r.gate + r.tv + r.prize + r.sponsor + sales) - (wages + ops + transfers));
        f.rev = { gate: r.gate, tv: r.tv, prize: r.prize, sponsor: r.sponsor, sales: 0 };   // yeni sezon için sıfırla
        f.exp = { wages, ops, transfers: 0 };
        f.season = season;
    }
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        financeTransferBudget, applyTransferFee, settleClubFinances,
        _finOf, _estRevenue, _estWages, _estOps,
    });
}
