// ============================================================================
//  48-awards.js  —  REKORLAR (tüm zamanlar) + ALTIN TOP (Ballon d'Or) + AYIN OYUNCUSU.
//  Veri kaynağı: WorldDB `playerSeasons` (bitmiş sezonların GERÇEK agregatı) +
//  kullanıcı için gameState (careerStats/seasonHistory — kullanıcı playerSeasons'a
//  yazılmaz, açık satır olarak birleştirilir). İsim çözümü WorldDB `players`
//  store'undan (regen'ler dahil her sayısal id'nin adı vardır).
//  47-worldstats'tan SONRA, 50-transfer'den ÖNCE yüklenir.
// ============================================================================

// ---- Lig ağırlığı: ortalama takım gücü → 0.75..1.10 (Altın Top'ta güçlü lig avantajı) ----
const _awLgWeightCache = {};
function _awLeagueWeight(lgId) {
    if (_awLgWeightCache[lgId] != null) return _awLgWeightCache[lgId];
    let w = 1;
    try {
        const teams = DB.teamsInLeague(lgId);
        if (teams && teams.length) {
            const avg = teams.reduce((s, t) => s + (t.power || 65), 0) / teams.length;
            w = Math.max(0.75, Math.min(1.1, avg / 80));
        }
    } catch (e) { /* sessiz */ }
    _awLgWeightCache[lgId] = Math.round(w * 1000) / 1000;
    return _awLgWeightCache[lgId];
}

// ---- İsim çözümü: WorldDB players store (seeded + regen; her sayısal id'nin adı var) ----
function _awResolveNames(slot, entries) {
    const jobs = entries.map(e => {
        if (e.isUser || e.name) return Promise.resolve(e);
        return WorldDB.get('players', [slot, e.pid])
            .then(rec => { e.name = (rec && rec.name) || ('Oyuncu #' + e.pid); return e; })
            .catch(() => { e.name = 'Oyuncu #' + e.pid; return e; });
    });
    return Promise.all(jobs).then(() => entries);
}

// ============================================================================
//  A1 — TÜM ZAMANLAR REKORLARI: playerSeasons tek geçişte taranır (cursor),
//  kariyer toplamları + tek-sezon zirveleri çıkarılır; kullanıcı satırları
//  gameState'ten birleştirilir. Sezon başına bir kez hesaplanır (cache).
// ============================================================================
let _recCache = null;   // { key, boards }
function computeWorldRecords(slot) {
    const key = slot + ':' + gameState.currentSeason;
    if (_recCache && _recCache.key === key) return Promise.resolve(_recCache.boards);
    if (typeof WorldDB === 'undefined' || slot == null) return Promise.resolve(null);

    const acc = {};          // pid → kariyer toplamları
    const seasonRows = [];   // her oyuncu-sezon satırı (tek-sezon rekorları)
    return WorldDB.iterateByIndex('playerSeasons', 'bySlotPlayer',
        IDBKeyRange.bound([slot], [slot, []]), (r) => {
            const L = DB.getLeague(r.leagueId);
            if (!L || L.type !== 'league') return;   // yalnız lig istatistiği (kupa hariç)
            const a = acc[r.playerId] || (acc[r.playerId] = { pid: r.playerId, g: 0, as: 0, m: 0, cs: 0, teamId: r.teamId });
            a.g += r.goals || 0; a.as += r.assists || 0; a.m += r.matches || 0; a.cs += r.cleanSheets || 0;
            a.teamId = r.teamId;   // en güncel kulüp
            seasonRows.push({ pid: r.playerId, teamId: r.teamId, season: r.season, g: r.goals || 0, as: r.assists || 0 });
        }).then(() => {
        const career = Object.values(acc);
        const p = gameState.player;
        const userName = p ? `${p.firstname || ''} ${p.lastname || p.name || ''}`.trim() : '';
        const cst = (p && p.careerStats) || {};
        const top = (rows, val, season) => rows
            .map(r => ({ pid: r.pid, teamId: r.teamId, v: val(r), season: season ? r.season : null, isUser: false }))
            .filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 10);
        const userRow = v => (p && v > 0) ? { pid: 'USER', teamId: p.teamId, v: v, season: null, isUser: true, name: userName } : null;
        const merge = (board, u) => {
            if (u) { board.push(u); board.sort((a, b) => b.v - a.v); }
            return board.slice(0, 10);
        };
        const boards = {
            careerGoals: merge(top(career, r => r.g), userRow(cst.goals || 0)),
            careerAssists: merge(top(career, r => r.as), userRow(cst.assists || 0)),
            careerMatches: merge(top(career, r => r.m), userRow(cst.matches || 0)),
            careerCS: merge(top(career, r => r.cs), userRow(cst.cleanSheets || 0)),
            seasonGoals: top(seasonRows, r => r.g, true),
            seasonAssists: top(seasonRows, r => r.as, true),
        };
        // Kullanıcının tek-sezon zirveleri (bitmiş sezonlar; playerSeasons ile aynı kapsam)
        (p && p.seasonHistory || []).forEach(h => {
            const lg = h.league || {};
            if (lg.goals > 0) boards.seasonGoals.push({ pid: 'USER', teamId: h.teamId, v: lg.goals, season: h.season, isUser: true, name: userName });
            if (lg.assists > 0) boards.seasonAssists.push({ pid: 'USER', teamId: h.teamId, v: lg.assists, season: h.season, isUser: true, name: userName });
        });
        boards.seasonGoals = boards.seasonGoals.sort((a, b) => b.v - a.v).slice(0, 10);
        boards.seasonAssists = boards.seasonAssists.sort((a, b) => b.v - a.v).slice(0, 10);
        const all = [].concat(...Object.values(boards));
        return _awResolveNames(slot, all).then(() => {
            _recCache = { key: key, boards: boards };
            return boards;
        });
    }).catch(() => null);
}

// ============================================================================
//  A2 — ALTIN TOP: biten sezonun DÜNYA GENELİ en iyi oyuncusu. Skor: gol/asist/CS
//  + maç katkısı, lig gücü ağırlıklı, şampiyonluk bonusu. Kullanıcı seasonHistory
//  satırıyla yarışır. Sonuç gameState.ballonHistory'ye yazılır (kalıcı, slot kaydında).
//  94-bindings sezon-devri zincirinden (agregat + özet SONRASI) çağrılır.
// ============================================================================
function _ballonScore(g, a, cs, m, lgW, isChampion) {
    const base = g * 2 + a * 1.4 + cs * 0.5 + m * 0.05;
    return Math.round((base * lgW + (isChampion ? 8 : 0)) * 10) / 10;
}
function computeBallonDor(slot, season) {
    if (typeof WorldDB === 'undefined' || slot == null) return Promise.resolve(null);
    const leagues = DB.leagues().filter(l => l.type === 'league');
    const cands = [];
    return WorldDB.getSeasonSummary(slot, season).catch(() => null).then(summary => {
        const champs = {};
        if (summary && summary.leagues) for (const lg in summary.leagues) champs[lg] = summary.leagues[lg].championId;
        let chain = Promise.resolve();
        leagues.forEach(lg => {
            chain = chain.then(() => WorldDB.leagueSeasonStats(slot, season, lg.id)).then(rows => {
                const w = _awLeagueWeight(lg.id);
                (rows || []).forEach(r => {
                    if ((r.goals || 0) + (r.assists || 0) + (r.cleanSheets || 0) < 5) return;   // aday eşiği
                    cands.push({
                        pid: r.playerId, teamId: r.teamId, g: r.goals || 0, a: r.assists || 0,
                        v: _ballonScore(r.goals || 0, r.assists || 0, r.cleanSheets || 0, r.matches || 0, w, champs[lg.id] === r.teamId),
                        isUser: false,
                    });
                });
            }).catch(() => {});
        });
        return chain;
    }).then(() => {
        // Kullanıcı adayı: biten sezonun arşiv satırı (kullanıcı playerSeasons'a yazılmaz)
        const p = gameState.player;
        const h = p && (p.seasonHistory || []).find(x => x.season === season);
        if (p && h && h.teamId) {
            const lg = h.league || {};
            cands.push({
                pid: 'USER', teamId: h.teamId, g: lg.goals || 0, a: lg.assists || 0,
                v: _ballonScore(lg.goals || 0, lg.assists || 0, lg.cleanSheets || 0, lg.matches || 0,
                    _awLeagueWeight(h.leagueId), h.leagueRank === 1),
                isUser: true, name: `${p.firstname || ''} ${p.lastname || p.name || ''}`.trim(),
            });
        }
        cands.sort((a, b) => b.v - a.v);
        const userRank = cands.findIndex(c => c.isUser) + 1;   // 0 = aday değil
        const top = cands.slice(0, 10);
        return _awResolveNames(slot, top).then(() => {
            const entry = { season: season, userRank: userRank || null, list: top.map((c, i) => ({ rank: i + 1, pid: c.pid, name: c.name, teamId: c.teamId, g: c.g, a: c.a, score: c.v, isUser: !!c.isUser })) };
            if (!gameState.ballonHistory) gameState.ballonHistory = [];
            gameState.ballonHistory = gameState.ballonHistory.filter(e => e.season !== season);
            gameState.ballonHistory.push(entry);
            if (gameState.ballonHistory.length > 30) gameState.ballonHistory = gameState.ballonHistory.slice(-30);
            const w = entry.list[0];
            const p2 = gameState.player;
            if (w && w.isUser && p2) {
                if (!(gameState.trophies || []).some(t => t.season === season && t.title === 'Altın Top'))
                    gameState.trophies.push({ season: season, title: 'Altın Top' });
                p2.fansLove = Math.min(100, (p2.fansLove || 50) + 6);
                if (typeof showToast === 'function') showToast(`🏆 ALTIN TOP SENİN! ${season} sezonunun dünyadaki en iyi oyuncusu seçildin!`, 'success');
            } else if (w && typeof showToast === 'function') {
                const t = DB.getTeam(w.teamId) || {};
                showToast(userRank && userRank <= 10
                    ? `Altın Top ${season}: ${w.name} (${t.name || ''}). Sen ${userRank}. oldun!`
                    : `Altın Top ${season}: ${w.name} (${t.name || ''}).`, 'info');
            }
            if (typeof saveGame === 'function') saveGame();
            return entry;
        });
    }).catch(() => null);
}

// ============================================================================
//  A3 — AYIN OYUNCUSU: her 4 haftada bir, son 4 haftanın LİG maçları (≥30 dk)
//  değerlendirilir; ≥3 maç ve ort. reyting ≥ 7.5 → ödül (abartısız: rozet +
//  küçük taraftar sevgisi). Ay başına TEK değerlendirme (_lastMonthlyKey).
// ============================================================================
function maybeMonthlyAward() {
    const p = gameState.player;
    if (!p || !p.teamId) return null;
    const W = gameState.currentWeek;
    if (W < 4 || W % 4 !== 0) return null;
    const month = W / 4;
    const key = gameState.currentSeason + '-' + month;
    if (p._lastMonthlyKey === key) return null;
    p._lastMonthlyKey = key;   // değerlendirme ayda bir (ödül olmasa da tekrar bakılmaz)
    const logs = (p.matchLog || []).filter(m =>
        m.season === gameState.currentSeason && !m.comp && m.week > W - 4 && m.week <= W && (m.mins || 0) >= 30);
    if (logs.length < 3) return null;
    const avg = logs.reduce((s, m) => s + (m.rating || 0), 0) / logs.length;
    if (avg < 7.5) return null;
    if (!p.monthlyAwards) p.monthlyAwards = [];
    const award = { season: gameState.currentSeason, month: month, avg: Math.round(avg * 100) / 100, n: logs.length };
    p.monthlyAwards.push(award);
    p.fansLove = Math.min(100, (p.fansLove || 50) + 3);
    if (typeof showToast === 'function') showToast(`⭐ AYIN OYUNCUSU seçildin! (${logs.length} maç, ort. ${award.avg})`, 'success');
    return award;
}

// ============================================================================
//  UI — İstatistik sekmesi görünümleri (55-stats renderStatsTab delege eder)
// ============================================================================
function _awRowHtml(r, i, valLabel) {
    const seasonTag = r.season ? ` <span style="color:var(--text-muted);font-size:.72rem;">(${r.season})</span>` : '';
    return `<tr class="${r.isUser ? 'stats-user-row' : ''}" ${r.isUser ? '' : `data-pid="${r.pid}" data-tid="${r.teamId}"`} style="cursor:${r.isUser ? 'default' : 'pointer'};">
        <td><strong>${i + 1}</strong></td>
        <td>${r.name}${r.isUser ? ' <span style="color:var(--accent);font-size:.7rem;">(Sen)</span>' : ''}${seasonTag}</td>
        <td><span style="display:inline-flex;align-items:center;gap:6px;">${getTeamLogoHtml(r.teamId, 16)}</span></td>
        <td style="text-align:center;font-weight:800;font-family:var(--font-heading);">${r.v}</td>
    </tr>`;
}
function _awBoardHtml(title, icon, rows, valLabel) {
    const body = (rows && rows.length)
        ? `<table class="stats-table"><thead><tr><th>#</th><th>Oyuncu</th><th></th><th style="text-align:center;">${valLabel}</th></tr></thead><tbody>${rows.map((r, i) => _awRowHtml(r, i, valLabel)).join('')}</tbody></table>`
        : `<p style="color:var(--text-muted);padding:8px 4px;font-size:.85rem;">Henüz veri yok.</p>`;
    return `<div style="min-width:280px;flex:1;"><div style="font-weight:800;margin:4px 0 6px;color:#fff;"><i class="fa-solid ${icon}"></i> ${title}</div>${body}</div>`;
}
function renderRecordsView(container) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:14px;">Rekorlar hesaplanıyor…</p>`;
    computeWorldRecords(gameState._slot).then(b => {
        if (!b) { container.innerHTML = `<p style="color:var(--text-muted);padding:14px;">Rekor verisi yok (dünya veritabanı kapalı).</p>`; return; }
        const empty = Object.values(b).every(rows => !rows.length);
        if (empty) {
            container.innerHTML = `<p style="color:var(--text-muted);padding:14px;">Henüz tamamlanmış sezon yok — rekor tabloları ilk sezon sonunda dolmaya başlar.</p>`;
            return;
        }
        container.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:18px;">
            ${_awBoardHtml('Kariyer Gol', 'fa-futbol', b.careerGoals, 'Gol')}
            ${_awBoardHtml('Kariyer Asist', 'fa-wand-magic-sparkles', b.careerAssists, 'Asist')}
            ${_awBoardHtml('Tek Sezon Gol', 'fa-bolt', b.seasonGoals, 'Gol')}
            ${_awBoardHtml('Tek Sezon Asist', 'fa-paper-plane', b.seasonAssists, 'Asist')}
            ${_awBoardHtml('Kariyer Maç', 'fa-shirt', b.careerMatches, 'Maç')}
            ${_awBoardHtml('Kariyer Clean Sheet', 'fa-hands', b.careerCS, 'CS')}
        </div>`;
        container.querySelectorAll('tr[data-pid]').forEach(tr =>
            tr.addEventListener('click', () => openPlayerProfile(tr.dataset.pid, tr.dataset.tid)));
    });
}
function renderBallonView(container) {
    const hist = (gameState.ballonHistory || []).slice().sort((a, b) => b.season - a.season);
    if (!hist.length) {
        container.innerHTML = `<p style="color:var(--text-muted);padding:14px;">Altın Top ilk kez bu sezonun sonunda verilecek — dünyanın en iyi oyuncusu seçilir (gol, asist, şampiyonluk ve lig gücü etkiler).</p>`;
        return;
    }
    const latest = hist[0];
    const tName = id => (DB.getTeam(id) || {}).name || '';
    const topTable = `<table class="stats-table"><thead><tr><th>#</th><th>Oyuncu</th><th>Takım</th><th style="text-align:center;">Gol</th><th style="text-align:center;">Asist</th><th style="text-align:center;">Puan</th></tr></thead><tbody>
        ${latest.list.map(r => `<tr class="${r.isUser ? 'stats-user-row' : ''}" ${r.isUser ? '' : `data-pid="${r.pid}" data-tid="${r.teamId}"`} style="cursor:${r.isUser ? 'default' : 'pointer'};">
            <td><strong>${r.rank}</strong>${r.rank === 1 ? ' 🏆' : ''}</td>
            <td>${r.name}${r.isUser ? ' <span style="color:var(--accent);font-size:.7rem;">(Sen)</span>' : ''}</td>
            <td><span style="display:inline-flex;align-items:center;gap:6px;">${getTeamLogoHtml(r.teamId, 16)}<span class="stats-team">${tName(r.teamId)}</span></span></td>
            <td style="text-align:center;">${r.g}</td><td style="text-align:center;">${r.a}</td>
            <td style="text-align:center;font-weight:800;font-family:var(--font-heading);">${r.score}</td>
        </tr>`).join('')}</tbody></table>`;
    const past = hist.slice(1).map(e => {
        const w = e.list[0] || {};
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.06);">
            <strong style="min-width:46px;">${e.season}</strong> 🏆 ${w.name || '?'}${w.isUser ? ' <span style="color:var(--accent);font-size:.7rem;">(Sen)</span>' : ''}
            <span style="display:inline-flex;align-items:center;gap:6px;">${getTeamLogoHtml(w.teamId, 16)}<span class="stats-team">${tName(w.teamId)}</span></span>
            ${e.userRank ? `<span style="margin-left:auto;color:var(--text-muted);font-size:.78rem;">senin sıran: ${e.userRank}</span>` : ''}
        </div>`;
    }).join('');
    container.innerHTML = `
        <div style="font-weight:800;margin:4px 0 8px;color:#fff;"><i class="fa-solid fa-medal"></i> Altın Top ${latest.season}${latest.userRank ? ` <span style="color:var(--text-muted);font-weight:400;font-size:.82rem;">— senin sıran: ${latest.userRank}</span>` : ''}</div>
        ${topTable}
        ${past ? `<div style="font-weight:800;margin:16px 0 4px;color:#fff;">Geçmiş Kazananlar</div>${past}` : ''}`;
    container.querySelectorAll('tr[data-pid]').forEach(tr =>
        tr.addEventListener('click', () => openPlayerProfile(tr.dataset.pid, tr.dataset.tid)));
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        computeWorldRecords, computeBallonDor, maybeMonthlyAward,
        renderRecordsView, renderBallonView, _ballonScore, _awLeagueWeight,
    });
}
