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

// FAZ 3a: IDB'de saklı GERÇEK maçtan (olay dökümü) detay üret — golcü+ASİST, kart.
// Atfı oyuncu adına çözer (DB.playerByIdSync). Kendi kalesine "(k.k.)" ile işaretlenir.
function _detailFromStored(m) {
    const _up = gameState.player;
    const _uName = _up ? _shortName(((_up.firstname || '') + ' ' + (_up.lastname || _up.name || '')).trim() || 'Sen') : 'Sen';
    const nm = id => { if (id === 'USER') return _uName; const pl = DB.playerByIdSync(id); return pl ? _shortName(pl.name) : 'Oyuncu'; };
    function teamEv(teamId) {
        const scorers = [], cards = [];
        for (const ev of (m.events || [])) {
            if (ev.teamId !== teamId) continue;
            if (ev.type === 'goal') scorers.push({ id: ev.playerId, name: nm(ev.playerId) + (ev.ownGoal ? ' (k.k.)' : ''), assist: (ev.assistId != null ? nm(ev.assistId) : null), min: ev.min });
            else if (ev.type === 'yellow') cards.push({ id: ev.playerId, name: nm(ev.playerId), type: 'y', min: ev.min });
            else if (ev.type === 'red') cards.push({ id: ev.playerId, name: nm(ev.playerId), type: 'r', min: ev.min });
        }
        scorers.sort((a, b) => a.min - b.min); cards.sort((a, b) => a.min - b.min);
        return { scorers, cards };
    }
    return { home: m.home, away: m.away, sh: m.sh, sa: m.sa, realUser: !!m.userMatch, stored: true, homeEv: teamEv(m.home), awayEv: teamEv(m.away) };
}

function _renderMatchDetail(body, home, away, hT, aT, d) {
    const evLine = (ev, tid) =>
        ev.scorers.map(s => `<div class="md-ev" data-pid="${s.id}" data-tid="${tid}"><i class="fa-solid fa-futbol"></i> ${s.name}${s.assist ? ` <span style="color:var(--text-muted);font-size:.78rem;">(${s.assist})</span>` : ''} <span class="md-min">${s.min}'</span></div>`).join('')
        + ev.cards.map(c => `<div class="md-ev md-card" data-pid="${c.id}" data-tid="${tid}"><span class="md-card-box md-${c.type}"></span> ${c.name} <span class="md-min">${c.min}'</span></div>`).join('');
    const tag = d.realUser ? '<i class="fa-solid fa-circle-check"></i> Senin maçın' : (d.stored ? 'Maç detayı' : 'Maç detayı (tahmini)');
    body.innerHTML = `
        <div class="md-head">
            <div class="md-team">${getTeamLogoHtml(home, 36)}<span>${hT.name}</span></div>
            <div class="md-score">${d.sh} <span>-</span> ${d.sa}</div>
            <div class="md-team">${getTeamLogoHtml(away, 36)}<span>${aT.name}</span></div>
        </div>
        <div class="md-tag">${tag}</div>
        <div class="md-events">
            <div class="md-col">${evLine(d.homeEv, home) || '<span class="md-empty">—</span>'}</div>
            <div class="md-col md-right">${evLine(d.awayEv, away) || '<span class="md-empty">—</span>'}</div>
        </div>`;
    body.querySelectorAll('.md-ev[data-pid]').forEach(el => el.addEventListener('click', () => {
        const pid = el.dataset.pid;
        if (pid === 'USER') { openPlayerProfile('USER', el.dataset.tid); return; }
        if (pid && !String(pid).startsWith('gen_') && !String(pid).startsWith('fa_') && !String(pid).startsWith('fic_'))
            openPlayerProfile(pid, el.dataset.tid);
    }));
}

// ---- Maç detay modalı ----
// Saklı gerçek dünya maçı (IDB matches) öncelikli → golcü/asist/kart birebir tutarlı.
// Yoksa (kullanıcı maçı / oynanmamış hafta) buildMatchDetail'e (deterministik) düşer.
function openMatchDetail(leagueId, weekIdx, home, away, season) {
    const modal = document.getElementById('match-detail-modal');
    const body = document.getElementById('match-detail-body');
    if (!modal || !body) return;
    if (typeof bringModalToFront === 'function') bringModalToFront(modal); else modal.style.zIndex = '100000';   // dinamik: en son açılan üstte
    const hT = getTeamById(home), aT = getTeamById(away);
    if (!hT || !aT) return;
    season = (season != null) ? season : gameState.currentSeason;
    modal.style.display = 'flex';
    // kadrolar yüklü değilse yükle, sonra tekrar aç (isim çözümü için)
    if (!DB.squadSync(home).length || !DB.squadSync(away).length) {
        body.innerHTML = '<p style="padding:16px;color:var(--text-muted);">Maç detayı yükleniyor…</p>';
        DB.loadPlayers(leagueId).then(() => { if (modal.style.display === 'flex') openMatchDetail(leagueId, weekIdx, home, away, season); });
        return;
    }
    const slot = gameState._slot;
    const matchId = season + ':' + leagueId + ':' + weekIdx + ':' + home + ':' + away;
    const tryStored = (slot != null && window.WorldDB && typeof WorldDB.get === 'function')
        ? WorldDB.get('matches', [slot, matchId]) : Promise.resolve(null);
    tryStored.then(stored => {
        const d = (stored && stored.events) ? _detailFromStored(stored) : buildMatchDetail(leagueId, weekIdx, home, away);
        _renderMatchDetail(body, home, away, hT, aT, d);
    }).catch(() => _renderMatchDetail(body, home, away, hT, aT, buildMatchDetail(leagueId, weekIdx, home, away)));
}

// ---- Kullanıcının oynadığı maçı kaydet (kompakt, kalıcı) ----
function recordRealMatch(myMatch, rating, g, a, motm, comp) {
    const p = gameState.player;
    if (!p || !myMatch) return;
    if (!p.matchLog) p.matchLog = [];
    // Sahada geçen süre + ilk-11/yedek (activeMatch'ten — maç bitişinde geçerli; canlı + instant ortak)
    let _mins = 90, _started = true;
    try {
        if (typeof activeMatch !== 'undefined' && activeMatch) {
            _started = activeMatch.playerStatus === 'starting' && (activeMatch.userOnPitchSince || 0) === 0;
            _mins = activeMatch.isSubbedOut ? Math.round(activeMatch.actualPlayedMinutes || 0) : Math.max(0, 90 - (activeMatch.userOnPitchSince || 0));
        }
    } catch (e) { }
    p.matchLog.push({
        season: gameState.currentSeason, week: gameState.currentWeek,
        leagueId: comp ? null : activeLeagueId(), comp: comp || null,
        home: myMatch.home, away: myMatch.away,
        sh: myMatch.scoreHome, sa: myMatch.scoreAway,
        rating: +(+rating).toFixed(1), g: g || 0, a: a || 0, motm: motm ? 1 : 0,
        mins: _mins, started: _started,
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

// ============================================================================
//  FAZ 5: TARİHÇE EKRANI — geçmiş sezonlar (puan durumu + şampiyon/ödül + maç detayı).
//  Tüm veri WorldDB'den GERÇEK: teamSeasons (puan durumu snapshot), summary (4c),
//  matches (olay dökümü → openMatchDetail). Sezon + lig seç, hafta hafta gezin,
//  herhangi bir maça tıkla → detay. Veri yoksa zarifçe boş gösterir.
// ============================================================================
function renderHistoryTab() {
    const host = document.getElementById('history-content');
    if (!host || typeof DB === 'undefined') return;
    const slot = gameState._slot;
    const startS = (typeof START_SEASON !== 'undefined') ? START_SEASON : 2026;
    if (!gameState.historyView) gameState.historyView = { season: gameState.currentSeason, league: (typeof activeLeagueId === 'function' ? activeLeagueId() : null), week: 0 };
    const hv = gameState.historyView;
    if (!hv.season || hv.season > gameState.currentSeason) hv.season = gameState.currentSeason;
    if (hv.season < startS) hv.season = startS;
    if (!hv.league) hv.league = (typeof activeLeagueId === 'function') ? activeLeagueId() : 'eng-premier-league';

    // Seçiciler: native <select> (sağlam; game-league-select stili mevcut)
    const seasonOpts = [];
    for (let s = gameState.currentSeason; s >= startS; s--)
        seasonOpts.push(`<option value="${s}"${s === hv.season ? ' selected' : ''}>${s} Sezonu${s === gameState.currentSeason ? ' (güncel)' : ''}</option>`);
    const leagues = DB.leagues().filter(l => l.type === 'league').slice()
        .sort((a, b) => (b.avgPower || 0) - (a.avgPower || 0) || a.name.localeCompare(b.name));
    const leagueOpts = leagues.map(l => `<option value="${l.id}"${l.id === hv.league ? ' selected' : ''}>${l.name} — ${l.country}</option>`).join('');

    host.innerHTML = `
        <div class="history-controls">
            <div class="hist-ctrl"><label class="hist-lbl">Sezon</label><select id="history-season-picker" class="game-league-select">${seasonOpts.join('')}</select></div>
            <div class="hist-ctrl hist-ctrl-lg"><label class="hist-lbl">Lig</label><select id="history-league-picker" class="game-league-select">${leagueOpts}</select></div>
        </div>
        <div id="history-summary"></div>
        <div id="history-standings"></div>
        <div id="history-fixtures"></div>`;

    const sp = document.getElementById('history-season-picker');
    if (sp) sp.addEventListener('change', () => { hv.season = parseInt(sp.value, 10) || gameState.currentSeason; hv.week = 0; _renderHistoryBody(slot, hv); });
    const lp = document.getElementById('history-league-picker');
    if (lp) lp.addEventListener('change', () => { hv.league = lp.value; hv.week = 0; _renderHistoryBody(slot, hv); });

    _renderHistoryBody(slot, hv);
}

function _renderHistoryBody(slot, hv) {
    const lg = hv.league, season = hv.season;
    const lgObj = DB.getLeague(lg) || { name: 'Lig' };
    const sumHost = document.getElementById('history-summary');
    const stHost = document.getElementById('history-standings');
    const fxHost = document.getElementById('history-fixtures');
    if (!stHost) return;
    stHost.innerHTML = '<p class="hist-loading">Yükleniyor…</p>';
    if (sumHost) sumHost.innerHTML = '';
    if (fxHost) fxHost.innerHTML = '';
    if (slot == null || typeof WorldDB === 'undefined') { stHost.innerHTML = '<p class="hist-empty">Bu kayıt için geçmiş verisi yok.</p>'; return; }

    // Ligi yükle (isim çözümü: puan durumu + maç detayı), sonra puan durumu + özet çek
    const loadLg = (typeof DB.loadPlayers === 'function') ? DB.loadPlayers(lg).catch(() => null) : Promise.resolve();
    loadLg.then(() => Promise.all([
        WorldDB.getAllByIndex('teamSeasons', 'bySlotSeasonLeague', IDBKeyRange.only([slot, season, lg])),
        WorldDB.getSeasonSummary ? WorldDB.getSeasonSummary(slot, season) : Promise.resolve(null)
    ])).then(([ts, summary]) => {
        if (sumHost) sumHost.innerHTML = _historySummaryHtml(summary, lg, season);
        const sorted = (ts || []).slice().sort((a, b) => (a.rank || 99) - (b.rank || 99) || (b.Pts || 0) - (a.Pts || 0));
        stHost.innerHTML = _historyStandingsHtml(sorted, lgObj, season);
        const nTeams = sorted.length || 18;
        const weeks = (nTeams % 2 === 0 ? (nTeams - 1) : nTeams) * 2;   // çift devre
        _renderHistoryFixtures(slot, season, lg, weeks);
    }).catch(() => { stHost.innerHTML = '<p class="hist-empty">Geçmiş verisi yüklenemedi.</p>'; });
}

function _histName(row) {
    if (!row) return '—';
    let nm = row.name;
    if (!nm && typeof DB !== 'undefined' && DB.playerByIdSync) { const pl = DB.playerByIdSync(row.playerId); nm = pl ? pl.name : ''; }
    return nm || ('Oyuncu #' + row.playerId);
}
function _historySummaryHtml(summary, lg, season) {
    const e = summary && summary.leagues && summary.leagues[lg];
    if (!e) {
        return `<div class="hist-summary hist-summary-empty"><i class="fa-solid fa-hourglass-half"></i> ${season} sezonu için şampiyon/ödüller henüz yok (sezon sürüyor veya veri eski kayıttan).</div>`;
    }
    const champ = e.championId ? getTeamById(e.championId) : null;
    const champHtml = champ ? `${getTeamLogoHtml(e.championId, 28)} <strong>${champ.name}</strong>` : '—';
    const award = (icon, label, row, statTxt) => `
        <div class="hist-award"><span class="hist-award-ico"><i class="fa-solid ${icon}"></i></span>
            <span class="hist-award-lbl">${label}</span>
            <span class="hist-award-val">${_histName(row)}${statTxt ? ` <span class="hist-award-stat">${statTxt}</span>` : ''}</span></div>`;
    return `
        <div class="hist-summary">
            <div class="hist-champ"><span class="hist-champ-lbl"><i class="fa-solid fa-trophy"></i> Şampiyon</span><span class="hist-champ-val">${champHtml}</span></div>
            <div class="hist-awards">
                ${award('fa-crown', 'Gol Kralı', e.topScorer, e.topScorer ? e.topScorer.goals + ' gol' : '')}
                ${award('fa-wand-magic-sparkles', 'Asist Kralı', e.topAssist, e.topAssist ? e.topAssist.assists + ' asist' : '')}
                ${award('fa-medal', 'MVP', e.mvp, e.mvp ? (e.mvp.goals + 'G ' + e.mvp.assists + 'A') : '')}
                ${award('fa-hands', 'En İyi Kaleci', e.bestGk, e.bestGk ? e.bestGk.cleanSheets + ' clean sheet' : '')}
            </div>
        </div>`;
}
function _historyStandingsHtml(sorted, lgObj, season) {
    if (!sorted.length) return `<p class="hist-empty">${season} ${lgObj.name} için puan durumu kaydı yok.</p>`;
    const myTeam = gameState.player ? gameState.player.teamId : null;
    const rows = sorted.map((r, i) => {
        const t = getTeamById(r.teamId) || { name: r.teamId };
        const mine = r.teamId === myTeam ? ' class="hist-row-mine"' : '';
        return `<tr${mine}><td>${r.rank || i + 1}</td><td class="hist-team">${getTeamLogoHtml(r.teamId, 20)} ${t.name}</td>
            <td>${r.P || 0}</td><td>${r.W || 0}</td><td>${r.D || 0}</td><td>${r.L || 0}</td>
            <td>${(r.GF || 0) - (r.GA || 0)}</td><td><strong>${r.Pts || 0}</strong></td></tr>`;
    }).join('');
    return `<div class="hist-section-title">${season} ${lgObj.name} — Puan Durumu</div>
        <div class="table-responsive"><table class="standings-table hist-standings">
        <thead><tr><th>#</th><th>Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th>Av</th><th>P</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}
function _renderHistoryFixtures(slot, season, lg, weeks) {
    const fxHost = document.getElementById('history-fixtures');
    if (!fxHost) return;
    const hv = gameState.historyView;
    if (hv.week == null || hv.week < 0) hv.week = 0;
    if (hv.week >= weeks) hv.week = weeks - 1;
    fxHost.innerHTML = `
        <div class="hist-section-title hist-fx-head">
            <span>Maçlar</span>
            <span class="fixture-selector">
                <button class="btn btn-icon-sm" id="hist-fx-prev"><i class="fa-solid fa-chevron-left"></i></button>
                <span id="hist-fx-week">Hafta ${hv.week + 1}</span>
                <button class="btn btn-icon-sm" id="hist-fx-next"><i class="fa-solid fa-chevron-right"></i></button>
            </span>
        </div>
        <div class="fixtures-list" id="hist-fx-list"><p class="hist-loading">Yükleniyor…</p></div>`;
    const prev = document.getElementById('hist-fx-prev'), next = document.getElementById('hist-fx-next');
    if (prev) prev.addEventListener('click', () => { if (hv.week > 0) { hv.week--; _renderHistoryFixtures(slot, season, lg, weeks); } });
    if (next) next.addEventListener('click', () => { if (hv.week < weeks - 1) { hv.week++; _renderHistoryFixtures(slot, season, lg, weeks); } });

    WorldDB.matchesOfWeek(slot, season, lg, hv.week).then(matches => {
        const list = document.getElementById('hist-fx-list');
        if (!list) return;
        if (!matches || !matches.length) { list.innerHTML = `<p class="hist-empty">Bu hafta maç kaydı yok.</p>`; return; }
        list.innerHTML = matches.map(m => {
            const h = getTeamById(m.home) || { name: m.home }, a = getTeamById(m.away) || { name: m.away };
            return `<div class="hist-fx-row" data-h="${m.home}" data-a="${m.away}">
                <span class="hist-fx-team hist-fx-home">${h.name} ${getTeamLogoHtml(m.home, 18)}</span>
                <span class="hist-fx-score">${m.sh} - ${m.sa}</span>
                <span class="hist-fx-team hist-fx-away">${getTeamLogoHtml(m.away, 18)} ${a.name}</span>
            </div>`;
        }).join('');
        list.querySelectorAll('.hist-fx-row').forEach(row => row.addEventListener('click', () => {
            if (typeof openMatchDetail === 'function') openMatchDetail(lg, hv.week, row.dataset.h, row.dataset.a, season);
        }));
    }).catch(() => { const list = document.getElementById('hist-fx-list'); if (list) list.innerHTML = `<p class="hist-empty">Maçlar yüklenemedi.</p>`; });
}

if (typeof window !== 'undefined') {
    Object.assign(window, { buildMatchDetail, openMatchDetail, recordRealMatch, recordTransferHistory, renderHistoryTab });
}
