// ============================================================================
//  58-history.js  —  Maç detayı (tüm dünya, deterministik) + maç/transfer geçmişi.
//  55-stats.js'ten SONRA yüklenir (_GOAL_W, posFamily, ageAdjustedOvr, getTeamById,
//  _shortName, _photoHtml, openPlayerProfile, getTeamLogoHtml, _detRng global).
//  Dünya maç skorları DETERMINISTIK (worldMatchScore) -> puan durumuyla tutarlı,
//  depolama gerektirmez. Kullanıcının gerçek maçları matchLog/fixtures'tan okunur.
// ============================================================================

// Bir takımın golcü/kart dağılımını maç-tohumlu deterministik üret
function _detTeamEvents(teamId, goals, seedBase) {
    const squad = DB.squadSync(teamId);
    if (!squad.length) return { scorers: [], cards: [] };
    const rng = (typeof _detRng === 'function') ? _detRng(seedBase) : Math.random;
    const weighted = squad.map(pl => {
        const fam = posFamily(pl.pos);
        return { pl, w: ((_GOAL_W[fam] || 1) + 0.3) * (0.4 + rng()) };
    }).sort((a, b) => b.w - a.w);

    const scorers = [];
    for (let g = 0; g < goals; g++) {
        const idx = Math.floor(rng() * Math.min(6, weighted.length));
        const pick = weighted[idx] || weighted[0];
        scorers.push({ id: pick.pl.id, name: _shortName(pick.pl.name), min: 3 + Math.floor(rng() * 87) });
    }
    scorers.sort((a, b) => a.min - b.min);

    const cards = [];
    const yc = Math.floor(rng() * 3);            // 0..2 sarı
    for (let i = 0; i < yc; i++) {
        const c = weighted[Math.floor(rng() * weighted.length)];
        if (c) cards.push({ id: c.pl.id, name: _shortName(c.pl.name), type: 'y', min: 10 + Math.floor(rng() * 80) });
    }
    if (rng() < 0.06) {                          // nadir kırmızı
        const c = weighted[Math.floor(rng() * weighted.length)];
        if (c) cards.push({ id: c.pl.id, name: _shortName(c.pl.name), type: 'r', min: 30 + Math.floor(rng() * 55) });
    }
    cards.sort((a, b) => a.min - b.min);
    return { scorers, cards };
}

// Bir maçın skorunu + golcü/kart detayını döndür (deterministik veya gerçek)
function buildMatchDetail(leagueId, weekIdx, home, away) {
    const p = gameState.player;
    const salt = (gameState.careerSalt != null ? gameState.careerSalt : 12345);
    const seedBase = salt + '|' + leagueId + '|' + gameState.currentSeason + '|w' + weekIdx + '|' + home + '|' + away;
    let sh, sa, realUser = false;

    // 1) Kullanıcının gerçek oynadığı maç mı? (matchLog önceliği)
    const real = (p && p.matchLog || []).find(m =>
        m.season === gameState.currentSeason && m.week === weekIdx + 1 && m.home === home && m.away === away);
    if (real) { sh = real.sh; sa = real.sa; realUser = true; }
    else {
        // 2) Aktif lig fikstüründe gerçek skor (ör. kullanıcının/atlanan maçın sonucu)
        const fx = (gameState.fixtures && gameState.fixtures[weekIdx] || []).find(m => m.home === home && m.away === away);
        if (fx && fx.scoreHome !== null && fx.scoreHome !== undefined) { sh = fx.scoreHome; sa = fx.scoreAway; }
        // 3) Deterministik dünya skoru (puan durumuyla tutarlı)
        else if (typeof worldMatchScore === 'function') { const r = worldMatchScore(leagueId, weekIdx, home, away); sh = r[0]; sa = r[1]; }
        else { sh = 0; sa = 0; }
    }
    return {
        home, away, sh, sa, realUser,
        homeEv: _detTeamEvents(home, sh, seedBase + '|H'),
        awayEv: _detTeamEvents(away, sa, seedBase + '|A'),
    };
}

// ---- Maç detay modalı ----
function openMatchDetail(leagueId, weekIdx, home, away) {
    const modal = document.getElementById('match-detail-modal');
    const body = document.getElementById('match-detail-body');
    if (!modal || !body) return;
    const hT = getTeamById(home), aT = getTeamById(away);
    if (!hT || !aT) return;
    // kadrolar yüklü değilse yükle, sonra tekrar aç
    if (!DB.squadSync(home).length || !DB.squadSync(away).length) {
        DB.loadPlayers(leagueId).then(() => { if (modal.style.display === 'flex') openMatchDetail(leagueId, weekIdx, home, away); });
    }
    const d = buildMatchDetail(leagueId, weekIdx, home, away);
    const evLine = (ev, tid) =>
        ev.scorers.map(s => `<div class="md-ev" data-pid="${s.id}" data-tid="${tid}"><i class="fa-solid fa-futbol"></i> ${s.name} <span class="md-min">${s.min}'</span></div>`).join('')
        + ev.cards.map(c => `<div class="md-ev md-card" data-pid="${c.id}" data-tid="${tid}"><span class="md-card-box md-${c.type}"></span> ${c.name} <span class="md-min">${c.min}'</span></div>`).join('');
    body.innerHTML = `
        <div class="md-head">
            <div class="md-team">${getTeamLogoHtml(home, 36)}<span>${hT.name}</span></div>
            <div class="md-score">${d.sh} <span>-</span> ${d.sa}</div>
            <div class="md-team">${getTeamLogoHtml(away, 36)}<span>${aT.name}</span></div>
        </div>
        <div class="md-tag">${d.realUser ? '<i class="fa-solid fa-circle-check"></i> Senin maçın' : 'Maç detayı'}</div>
        <div class="md-events">
            <div class="md-col">${evLine(d.homeEv, home) || '<span class="md-empty">—</span>'}</div>
            <div class="md-col md-right">${evLine(d.awayEv, away) || '<span class="md-empty">—</span>'}</div>
        </div>`;
    body.querySelectorAll('.md-ev[data-pid]').forEach(el => el.addEventListener('click', () => {
        const pid = el.dataset.pid; if (pid && !String(pid).startsWith('gen_') && !String(pid).startsWith('fa_'))
            openPlayerProfile(pid, el.dataset.tid);
    }));
    modal.style.display = 'flex';
}

// ---- Kullanıcının oynadığı maçı kaydet (kompakt, kalıcı) ----
function recordRealMatch(myMatch, rating, g, a, motm, comp) {
    const p = gameState.player;
    if (!p || !myMatch) return;
    if (!p.matchLog) p.matchLog = [];
    p.matchLog.push({
        season: gameState.currentSeason, week: gameState.currentWeek,
        leagueId: comp ? null : activeLeagueId(), comp: comp || null,
        home: myMatch.home, away: myMatch.away,
        sh: myMatch.scoreHome, sa: myMatch.scoreAway,
        rating: +(+rating).toFixed(1), g: g || 0, a: a || 0, motm: motm ? 1 : 0,
    });
    if (p.matchLog.length > 240) p.matchLog = p.matchLog.slice(-240);
}

// ---- Kullanıcı transfer/kiralama geçmişi ----
function recordTransferHistory(entry) {
    const p = gameState.player;
    if (!p) return;
    if (!p.transferHistory) p.transferHistory = [];
    p.transferHistory.push(Object.assign({ season: gameState.currentSeason, week: gameState.currentWeek }, entry));
    if (p.transferHistory.length > 60) p.transferHistory = p.transferHistory.slice(-60);
}

// Modal kapatma bağlama
(function () {
    function bind() {
        const c = document.getElementById('btn-close-match-detail');
        const m = document.getElementById('match-detail-modal');
        if (c && !c._bound) { c._bound = true; c.addEventListener('click', () => { if (m) m.style.display = 'none'; }); }
        if (m && !m._bound) { m._bound = true; m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; }); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();

if (typeof window !== 'undefined') {
    Object.assign(window, { buildMatchDetail, openMatchDetail, recordRealMatch, recordTransferHistory });
}
