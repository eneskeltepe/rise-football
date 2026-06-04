// ============================================================================
//  55-stats.js  —  Lig krallıkları (gol/asist/kart/clean sheet/maçın adamı),
//  yıl sonu bireysel ödüller ve FM-tarzı oyuncu profili.
//  Diğer oyuncuların istatistikleri, lig puan durumundan (gol sayıları) +
//  pozisyon/OVR ağırlıklı DETERMINISTIK dağıtımla üretilir (sezon içinde tutarlı).
// ============================================================================

// pozisyon ailesine gore agirliklar
const _GOAL_W = { GK: 0, CB: 0.5, FB: 1.2, DM: 1.0, CM: 2.4, AM: 5, WM: 4, W: 7, ST: 11 };
const _AST_W = { GK: 0, CB: 0.6, FB: 3.6, DM: 2.2, CM: 5, AM: 8, WM: 6.5, W: 6, ST: 3 };
const _YEL_W = { GK: 0.05, CB: 0.22, FB: 0.20, DM: 0.26, CM: 0.16, AM: 0.12, WM: 0.12, W: 0.12, ST: 0.12 };
const _RED_W = { GK: 0.012, CB: 0.045, FB: 0.040, DM: 0.050, CM: 0.030, AM: 0.020, WM: 0.020, W: 0.020, ST: 0.022 };

// deterministik [0,1) tohum (oyuncu+sezon)
function _seed01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
}

// `total` tamsayısını `weights` oranında, toplamı TAM `total` olacak şekilde dağıt
// (largest-remainder/Hamilton). En yüksek ağırlıklı oyuncular golleri/asistleri önce
// alır → erken sezonda (düşük örneklem) bile gerçekçi bir gol kralı çıkar; eski
// `Math.round(gf*w/sum)` yaklaşımının "herkes 0'a yuvarlanıyor" sorununu çözer.
function _allocateByWeight(total, weights) {
    const n = weights.length;
    const alloc = new Array(n).fill(0);
    if (total <= 0 || !n) return alloc;
    const sum = weights.reduce((s, w) => s + w, 0);
    if (sum <= 0) return alloc;
    const raw = weights.map(w => total * w / sum);
    let used = 0;
    for (let i = 0; i < n; i++) { alloc[i] = Math.floor(raw[i]); used += alloc[i]; }
    const rem = total - used;
    const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < rem && k < n; k++) alloc[order[k].i]++;
    return alloc;
}

// FAZ 3b: Krallık verisi — GERÇEK (WorldStats, maçlardan) hazırsa onu; değilse
// sentetik (geriye uyum / WorldStats yoksa / cache henüz kurulmadıysa ödüller bozulmasın).
function computeLeagueLeaders(leagueId) {
    const slot = (typeof gameState !== 'undefined') ? gameState._slot : null;
    const season = (typeof gameState !== 'undefined') ? gameState.currentSeason : 0;
    if (window.WorldStats && slot != null && WorldStats.ready(slot, season)) {
        const real = _realLeaders(leagueId, slot, season);
        if (real) return real;
    }
    return _syntheticLeaders(leagueId);
}

// GERÇEK krallık: her takımın kadrosundaki oyuncuların WorldStats (matches agregatı) statları.
function _realLeaders(leagueId, slot, season) {
    const tbl = gameState.standings && gameState.standings[leagueId];
    if (!tbl) return null;
    const teams = DB.teamsInLeague(leagueId);
    const anyLoaded = teams.some(t => DB.squadSync(t.id).length > 0);
    if (!anyLoaded) { DB.loadPlayers(leagueId); return null; }
    const seasonsElapsed = season - START_SEASON;
    const p = gameState.player, userTeam = p && p.teamId;
    const players = [];
    for (const t of teams) {
        for (const pl of DB.squadSync(t.id)) {
            const st = WorldStats.playerStat(pl.id);
            if (!st || st.m === 0) continue;   // bu sezon oynamadıysa krallıkta yok
            players.push({
                id: pl.id, name: _shortName(pl.name), teamId: t.id, teamName: t.name,
                pos: pl.pos, ovr: ageAdjustedOvr(pl, seasonsElapsed), img: pl.img,
                g: st.g, a: st.a, y: st.y, r: st.r, cs: st.cs, motm: st.motm, played: st.m,
            });
        }
    }
    // Kullanıcı GERÇEK statıyla (gameState — kullanıcı için tek doğruluk). Kendi maçları henüz
    // IDB'de olmadığından kulüp arkadaşları Faz 3d'de tam atfedilecek.
    if (userTeam && DB.getTeam(userTeam) && DB.getTeam(userTeam).leagueId === leagueId) {
        const cs = p.currentSeasonStats;
        players.push({
            id: 'USER', name: `${p.firstname} ${p.lastname}`, teamId: userTeam, teamName: p.teamName,
            pos: p.position, ovr: p.ovr, img: p.img, isUser: true,
            g: cs.goals || 0, a: cs.assists || 0, y: cs.yellowCards || 0, r: cs.redCards || 0,
            cs: p.position === 'Kaleci' ? (cs.cleanSheets || 0) : 0, motm: cs.motm || 0, played: cs.matches || 0,
        });
    }
    return players;
}

// Sentetik krallık (eski deterministik dağıtım) — WorldStats yoksa/hazır değilse yedek.
function _syntheticLeaders(leagueId) {
    const tbl = gameState.standings && gameState.standings[leagueId];
    if (!tbl) return null;
    const teams = DB.teamsInLeague(leagueId);
    // oyuncular yuklu mu? degilse yukle ve null don
    const anyLoaded = teams.some(t => DB.squadSync(t.id).length > 0);
    if (!anyLoaded) { DB.loadPlayers(leagueId); return null; }

    const season = gameState.currentSeason;
    const seasonsElapsed = season - START_SEASON;
    const p = gameState.player;
    const userTeam = p && p.teamId;
    const players = [];

    for (const t of teams) {
        const row = tbl[t.id]; if (!row) continue;
        const played = row.played, ga = row.goalsAgainst;
        let gf = row.goalsFor;
        // kullanicinin golleri team gf'ye dahil; cifte saymamak icin dusulur
        if (t.id === userTeam) gf = Math.max(0, gf - (p.currentSeasonStats.goals || 0));

        const squad = DB.squadSync(t.id);
        if (!squad.length) continue;

        // Her oyuncuya yaş-düzeltilmiş OVR + deterministik tohum; OVR'a göre sırala (en iyi ilk).
        const rated = squad.map(pl => ({
            pl, fam: posFamily(pl.pos), f: _seed01(pl.id + season), ovr: ageAdjustedOvr(pl, seasonsElapsed),
        })).sort((a, b) => b.ovr - a.ovr);
        const N = rated.length;
        // Yedek kalecileri (en iyi GK dışı) ele: kalecide rotasyon nadirdir.
        const topGk = rated.filter(e => e.fam === 'GK').sort((a, b) => b.ovr - a.ovr)[0];
        const topGkPid = topGk ? topGk.pl.id : null;

        // Oynama payı (appearance): ilk XI düzenli oynar, kadro derinliğinde kademeli azalır.
        // Böylece hiç oynamayan yedek 0 maç görür; yıldız neredeyse tüm maçları oynar — eski
        // modelde herkes takımın oynadığı maç sayısını (ör. 7) görüyordu.
        const entries = rated.map((e, rank) => {
            let appShare;
            if (rank < 11) appShare = 0.92 - rank * 0.02;                          // ilk XI: 0.92 → 0.72
            else appShare = 0.55 * (1 - (rank - 11) / Math.max(1, N - 11));         // yedekler: 0.55 → ~0
            appShare = Math.max(0, Math.min(1, appShare + (e.f - 0.5) * 0.16));     // ±0.08 tohumlu dalgalanma
            if (e.fam === 'GK' && e.pl.id !== topGkPid) appShare = Math.min(appShare, 0.06);
            const pld = Math.max(0, Math.min(played, Math.round(played * appShare)));
            const avgR = Math.max(5.6, Math.min(8.6, 6.3 + (e.ovr - 75) * 0.045 + (e.f - 0.5) * 0.6));
            return {
                ...e, appShare, pld, avgR,
                // gol/asist ağırlığı oynama payıyla çarpılır → oynamayan katkı yapmaz
                gw: (_GOAL_W[e.fam] || 1) * Math.pow(e.ovr / 80, 2) * (0.45 + e.f) * appShare,
                aw: (_AST_W[e.fam] || 1) * Math.pow(e.ovr / 82, 1.5) * (0.45 + (1 - e.f)) * appShare,
            };
        });

        const teamAssists = Math.round(gf * 0.62);
        const goalAlloc = _allocateByWeight(gf, entries.map(e => e.gw));            // toplam = gf (tutarlı)
        const astAlloc = _allocateByWeight(teamAssists, entries.map(e => e.aw));
        const gkEntry = entries.filter(e => e.fam === 'GK').sort((a, b) => b.ovr - a.ovr)[0];
        const csCount = played > 0 ? Math.round(played * Math.max(0, Math.min(0.6, 1 - (ga / played) / 2.2))) : 0;

        entries.forEach((e, idx) => {
            const g = goalAlloc[idx];
            const a = astAlloc[idx];
            // kart ve MotM artık oyuncunun KENDİ maç sayısına (e.pld) ölçeklenir
            const y = Math.round(e.pld * (_YEL_W[e.fam] || 0.12) * (0.6 + e.f));
            const r = Math.round(e.pld * (_RED_W[e.fam] || 0.025) * (0.4 + e.f * 1.2));
            const cs = (gkEntry && e === gkEntry) ? Math.min(csCount, e.pld) : 0;
            // MotM: reyting (her mevki) + somut katki (gol/asist) + kaleci clean sheet
            const motmRate =
                Math.max(0, e.avgR - 6.7) * 0.22
                + (g + a) / Math.max(1, e.pld) * 0.45
                + ((gkEntry && e === gkEntry) ? cs / Math.max(1, e.pld) * 0.30 : 0);
            const motm = e.pld > 0 ? Math.max(0, Math.round(motmRate * e.pld * (0.7 + e.f * 0.6))) : 0;
            players.push({
                id: e.pl.id, name: _shortName(e.pl.name), teamId: t.id, teamName: t.name,
                pos: e.pl.pos, ovr: e.ovr, img: e.pl.img, g, a, y, r, cs, motm, played: e.pld,
            });
        });
    }

    // kullaniciyi gercek istatistikleriyle ekle
    if (userTeam && DB.getTeam(userTeam) && DB.getTeam(userTeam).leagueId === leagueId) {
        const cs = p.currentSeasonStats;
        players.push({
            id: 'USER', name: `${p.firstname} ${p.lastname}`, teamId: userTeam, teamName: p.teamName,
            pos: p.position, ovr: p.ovr, img: p.img, isUser: true,
            g: cs.goals || 0, a: cs.assists || 0, y: cs.yellowCards || 0, r: cs.redCards || 0,
            cs: p.position === 'Kaleci' ? (cs.cleanSheets || 0) : 0, motm: cs.motm || 0, played: cs.matches || 0,
        });
    }
    return players;
}

const STAT_CATS = [
    { key: 'g', label: 'Gol Krallığı', icon: 'fa-futbol', col: 'Gol' },
    { key: 'a', label: 'Asist Krallığı', icon: 'fa-handshake-angle', col: 'Asist' },
    { key: 'motm', label: 'Maçın Adamı', icon: 'fa-star', col: 'MotM' },
    { key: 'cs', label: 'Gol Yemeyen (Kaleci)', icon: 'fa-shield', col: 'CS' },
    { key: 'y', label: 'Sarı Kart', icon: 'fa-square', col: 'Sarı' },
    { key: 'r', label: 'Kırmızı Kart', icon: 'fa-square', col: 'Kırmızı' },
];

function _topBy(players, key, n) {
    return players.filter(p => (p[key] || 0) > 0 || p.isUser)
        .sort((a, b) => (b[key] || 0) - (a[key] || 0) || b.ovr - a.ovr).slice(0, n);
}

// ---- İstatistik sekmesi ----
function renderStatsTab() {
    const host = document.getElementById('stats-content');
    if (!host) return;
    if (!gameState.statsView) gameState.statsView = { league: null, cat: 'g' };
    const sv = gameState.statsView;
    if (!sv.league) sv.league = activeLeagueId() || (DB.leagues()[0] && DB.leagues()[0].id);

    const leagues = DB.leagues().filter(l => l.type === 'league').slice().sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    const leagueOpts = leagues.map(l => `<option value="${l.id}" ${l.id === sv.league ? 'selected' : ''}>${l.name} (${l.country})</option>`).join('');
    const catBtns = STAT_CATS.map(c => `<button class="stat-cat-btn ${c.key === sv.cat ? 'active' : ''}" data-cat="${c.key}"><i class="fa-solid ${c.icon}"></i> ${c.label}</button>`).join('');

    // FAZ 3b: GERÇEK krallık (matches'ten) için WorldStats cache'i hazırla; hazır değilse
    // "hesaplanıyor" göster, kurulunca yeniden çiz (sentetik flaş gösterme).
    const _slot = gameState._slot, _season = gameState.currentSeason;
    if (window.WorldStats && _slot != null && !WorldStats.ready(_slot, _season)) {
        WorldStats.ensureSeason(_slot, _season).then(() => { if (document.getElementById('stats-tab') && document.getElementById('stats-tab').classList.contains('active')) renderStatsTab(); });
    }

    const leaders = (window.WorldStats && _slot != null && !WorldStats.ready(_slot, _season)) ? null : computeLeagueLeaders(sv.league);
    let table = '';
    if (!leaders) {
        table = `<p style="color:var(--text-muted);padding:14px;">İstatistikler hesaplanıyor…</p>`;
        DB.loadPlayers(sv.league).then(() => { if (document.getElementById('stats-tab').classList.contains('active')) renderStatsTab(); });
    } else {
        const cat = STAT_CATS.find(c => c.key === sv.cat) || STAT_CATS[0];
        const rows = _topBy(leaders, sv.cat, 25);
        if (!rows.length) table = `<p style="color:var(--text-muted);padding:14px;">Henüz veri yok (sezon yeni başladı).</p>`;
        else table = `<table class="stats-table"><thead><tr><th>#</th><th>Oyuncu</th><th>Takım</th><th style="text-align:center;">${cat.col}</th></tr></thead><tbody>${rows.map((r, i) => `
            <tr class="${r.isUser ? 'stats-user-row' : ''}" data-pid="${r.id}" data-tid="${r.teamId}" style="cursor:pointer;">
                <td><strong>${i + 1}</strong></td>
                <td><span style="display:inline-flex;align-items:center;gap:8px;">${_photoHtml(r.img, (POS_BY_KEY[r.pos] || {}).short || '', 22, '#555')}<span>${r.name}${r.isUser ? ' <span style="color:var(--accent);font-size:.7rem;">(Sen)</span>' : ''}</span></span></td>
                <td><span style="display:inline-flex;align-items:center;gap:6px;">${getTeamLogoHtml(r.teamId, 16)}<span class="stats-team">${r.teamName}</span></span></td>
                <td style="text-align:center;font-weight:800;font-family:var(--font-heading);">${r[sv.cat] || 0}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    host.innerHTML = `
        <div class="stats-toolbar">
            ${(typeof leagueDropdownHtml === 'function') ? leagueDropdownHtml('stats-league-picker', 'stats-ldd') : `<select id="stats-league-picker" class="stats-league-picker game-league-select">${leagueOpts}</select>`}
            <div class="stat-cat-btns">${catBtns}</div>
        </div>
        <div class="stats-table-wrap">${table}</div>`;

    if (typeof wireLeagueDropdown === 'function') wireLeagueDropdown('stats-league-picker', sv.league, (v) => { sv.league = v; renderStatsTab(); });
    else { const picker = document.getElementById('stats-league-picker'); if (picker) picker.addEventListener('change', () => { sv.league = picker.value; renderStatsTab(); }); }
    host.querySelectorAll('.stat-cat-btn').forEach(b => b.addEventListener('click', () => { sv.cat = b.dataset.cat; renderStatsTab(); }));
    host.querySelectorAll('tr[data-pid]').forEach(tr => tr.addEventListener('click', () => openPlayerProfile(tr.dataset.pid, tr.dataset.tid)));
}

// ---- Yıl sonu bireysel ödüller (aktif lig) ----
function computeSeasonAwards(leagueId) {
    const leaders = computeLeagueLeaders(leagueId);
    if (!leaders) return null;
    const top = (k) => _topBy(leaders, k, 1)[0] || null;
    const mvpList = leaders.slice().sort((a, b) =>
        (b.g * 2 + b.a * 1.4 + b.motm * 1.1 + b.cs * 0.4) - (a.g * 2 + a.a * 1.4 + a.motm * 1.1 + a.cs * 0.4));
    return { topScorer: top('g'), topAssist: top('a'), bestGk: top('cs'), mvp: mvpList[0] || null };
}

// Detaylı alt-özellik ızgarası (HER oyuncu profilinde — kulüp kartıyla aynı görünüm).
function _ppAttrsGrid(attrs, pos) {
    if (!attrs || !Object.keys(attrs).length) return '';
    const isGK = pos === 'Kaleci';
    const groups = isGK
        ? { 'Kalecilik': GK_ATTR_GROUP, 'Fizik': ATTR_GROUPS.fizik, 'Hız': ATTR_GROUPS.hiz, 'Pas': ATTR_GROUPS.pas }
        : { 'Hız': ATTR_GROUPS.hiz, 'Şut': ATTR_GROUPS.sut, 'Pas': ATTR_GROUPS.pas, 'Teknik': ATTR_GROUPS.teknik, 'Defans': ATTR_GROUPS.defans, 'Fizik': ATTR_GROUPS.fizik };
    let html = '';
    for (const gname in groups) {
        if (!groups[gname]) continue;
        const items = groups[gname].map(([k, lbl]) => {
            const v = Math.round((attrs && attrs[k]) || 0);
            const col = v >= 80 ? 'var(--accent,#0f8)' : v >= 65 ? '#ffca28' : v >= 50 ? '#ff9800' : '#ef5350';
            return `<div style="display:flex;justify-content:space-between;gap:6px;font-size:.78rem;padding:1px 0;"><span style="color:var(--text-muted)">${lbl}</span><strong style="color:${col}">${v}</strong></div>`;
        }).join('');
        html += `<div style="min-width:138px;flex:1;"><div style="font-weight:700;font-size:.8rem;margin-bottom:3px;color:#fff;">${gname}</div>${items}</div>`;
    }
    return `<div class="pp-section-title">Detaylı Özellikler</div><div style="display:flex;flex-wrap:wrap;gap:14px;">${html}</div>`;
}

// ---- FM-tarzı oyuncu profili ----
// FAZ 3c: profil geçmiş-sezon tablosu. Kullanıcı: gameState.player.seasonHistory.
// NPC: IDB playerSeasonsAll (sezon sonlarında agregat edilen gerçek istatistik).
function _fillProfileHistory(info) {
    const host = document.getElementById('pp-history');
    if (!host) return;
    const render = (rows) => {
        rows = (rows || []).filter(r => r.season < gameState.currentSeason);   // yalnız GEÇMİŞ sezonlar
        if (!rows.length) { host.innerHTML = ''; return; }
        rows.sort((a, b) => a.season - b.season);
        host.innerHTML = `<div class="pp-section-title">Geçmiş Sezonlar</div>
            <div class="stats-table-wrap"><table class="stats-table" style="font-size:.82rem;">
            <thead><tr><th>Sezon</th><th>Takım</th><th style="text-align:center;">Maç</th><th style="text-align:center;">Gol</th><th style="text-align:center;">Asist</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${r.season}/${String((r.season + 1) % 100).padStart(2, '0')}</td>
                <td><span style="display:inline-flex;align-items:center;gap:6px;">${getTeamLogoHtml(r.teamId, 16)}<span>${r.teamName || ''}</span></span></td>
                <td style="text-align:center;">${r.matches || 0}${r.subApps ? ` <span style="color:var(--text-muted);">(${r.subApps})</span>` : ''}</td>
                <td style="text-align:center;font-weight:700;">${r.goals || 0}</td>
                <td style="text-align:center;">${r.assists || 0}</td></tr>`).join('')}</tbody></table></div>`;
    };
    if (info.isUser) {
        const sh = (gameState.player.seasonHistory || []).map(h => ({
            season: h.season, teamId: h.teamId, teamName: h.teamName,
            matches: (h.league && h.league.matches) || 0, subApps: (h.league && h.league.subApps) || 0,
            goals: (h.league && h.league.goals) || 0, assists: (h.league && h.league.assists) || 0,
        }));
        render(sh);
    } else if (window.WorldDB && gameState._slot != null && info.playerId != null && typeof WorldDB.playerSeasonsAll === 'function') {
        WorldDB.playerSeasonsAll(gameState._slot, info.playerId).then(list => {
            render((list || []).map(r => ({
                season: r.season, teamId: r.teamId, teamName: (DB.getTeam(r.teamId) || {}).name || '',
                matches: r.matches, subApps: r.subApps, goals: r.goals, assists: r.assists,
            })));
        }).catch(() => {});
    }
}

function openPlayerProfile(pid, teamId) {
    const modal = document.getElementById('player-profile-modal');
    const body = document.getElementById('player-profile-body');
    if (!modal || !body) return;
    const p = gameState.player;
    const seasonsElapsed = gameState.currentSeason - START_SEASON;
    const pidStr = String(pid);
    let info;
    if (pid === 'USER' || (p && p.id !== undefined && pidStr === String(p.id))) {
        const cs = p.currentSeasonStats, car = p.careerStats;
        info = {
            name: `${p.firstname} ${p.lastname}`, teamId: p.teamId, teamName: p.teamName, pos: p.position,
            ovr: p.ovr, age: p.age, img: p.img, nat: p.nationality, value: p.value, wage: p.wage,
            season: cs, career: car, isUser: true, real: true, playerId: (p.id != null ? p.id : 'USER'),
            potential: p.potential, attrs: p.attrs,
        };
    } else {
        const pl = DB.squadSync(teamId).find(x => String(x.id) === pidStr) || DB.playerByIdSync(pid) || DB.playerByIdSync(pidStr);
        if (!pl) { showToast('Oyuncu verisi yüklenemedi.', 'error'); return; }
        const team = DB.getTeam(teamId) || DB.getTeam(pl.teamId) || {};
        const ovr = ageAdjustedOvr(pl, seasonsElapsed);
        // Altyapı oyuncusu MANUEL yaşlanır (clubYouth) → yaşına seasonsElapsed EKLEME (kadroda 17, profilde 21 bug'ı).
        const _isY = !!pl.isYouth;
        const effAge = _isY ? (pl.age || 17) : (pl.age || 0) + seasonsElapsed;
        // Potansiyel: youth'ta açıkça var; DB oyuncusunda gençlik boşluğundan türet (yaşlıda ≈ ovr).
        const pot = pl.potential ? pl.potential : Math.max(ovr, Math.min(99, Math.round(ovr + Math.max(0, 23 - effAge) * 1.1)));
        // FAZ 3c: bu sezon istatistiği GERÇEK (WorldStats, maçlardan) hazırsa onu; değilse sentetik (tahmini).
        const _slotP = gameState._slot, _seasonP = gameState.currentSeason;
        const _wst = (window.WorldStats && _slotP != null && WorldStats.ready(_slotP, _seasonP)) ? WorldStats.playerStat(pl.id) : null;
        let ls, _real;
        if (_wst) { ls = { played: _wst.m, starts: _wst.starts, subApps: _wst.subApps, g: _wst.g, a: _wst.a, cs: _wst.cs, y: _wst.y, motm: _wst.motm }; _real = true; }
        else {
            const leaders = computeLeagueLeaders(team.leagueId) || [];
            const f = leaders.find(x => String(x.id) === pidStr) || { g: 0, a: 0, motm: 0, cs: 0, y: 0, played: 0 };
            ls = { played: f.played, starts: 0, subApps: 0, g: f.g, a: f.a, cs: f.cs, y: f.y, motm: f.motm }; _real = false;
        }
        info = {
            name: pl.name, teamId: team.id, teamName: team.name, pos: pl.pos, ovr, potential: pot,
            age: effAge, img: pl.img, nat: pl.nation, real: _real, playerId: pl.id,
            value: calcMarketValue(ovr, effAge, team.prestige || 2),
            wage: calcWage(ovr, team.prestige || 2),
            season: { matches: ls.played, starts: ls.starts, subApps: ls.subApps, goals: ls.g, assists: ls.a, cleanSheets: ls.cs, yellowCards: ls.y, motm: ls.motm },
            foot: pl.foot, skillMoves: pl.skillMoves, weakFoot: pl.weakFoot, attrs: pl.attrs,
        };
    }
    const flag = info.nat ? (DB.nationFlag(info.nat)) : '';
    const posShort = (POS_BY_KEY[info.pos] || { short: info.pos }).short;
    const s = info.season || {};
    const statBox = (lbl, val) => `<div class="pp-stat"><span class="pp-stat-v">${val}</span><span class="pp-stat-l">${lbl}</span></div>`;
    body.innerHTML = `
        <div class="pp-head">
            <div class="pp-card">
                <div class="pp-ovr">${info.ovr}</div>
                <div class="pp-pos">${posShort}</div>
                <div class="pp-photo">${_photoHtml(info.img, posShort, 70, '#444')}</div>
                ${info.isUser ? `<button class="pp-photo-edit" id="pp-edit-photo" title="Profil fotoğrafını değiştir"><i class="fa-solid fa-camera"></i></button>` : ''}
            </div>
            <div class="pp-meta">
                <h2>${info.name}</h2>
                <div class="pp-club">${getTeamLogoHtml(info.teamId, 18)} <span>${info.teamName || 'Serbest'}</span></div>
                <div class="pp-tags">
                    <span>${natFlagImg(info.nat)} ${info.nat || '—'}</span>
                    <span><i class="fa-solid fa-cake-candles"></i> ${info.age} yaş</span>
                    ${info.foot ? `<span><i class="fa-solid fa-shoe-prints"></i> ${info.foot} ayak</span>` : ''}
                    ${info.potential ? `<span title="Gelişim potansiyeli (zirve)"><i class="fa-solid fa-arrow-trend-up" style="color:#ab47bc;"></i> Potansiyel: <strong>${info.potential}</strong>${(info.potential > info.ovr && info.age <= 23) ? ` <span style="color:var(--text-muted);font-weight:400;">(${info.ovr}→${info.potential})</span>` : ''}</span>` : ''}
                </div>
                <div class="pp-money">
                    <span><i class="fa-solid fa-tag"></i> Değer: <strong>${formatMoney(info.value)}</strong></span>
                    <span><i class="fa-solid fa-coins"></i> Maaş: <strong>${(info.wage || 0).toLocaleString('tr-TR')} €/hf</strong></span>
                </div>
            </div>
        </div>
        <div class="pp-section-title">${gameState.currentSeason} Sezonu${(info.isUser || info.real) ? '' : ' (tahmini)'}</div>
        <div class="pp-stats-grid">
            ${statBox('Maç', ((info.isUser || info.real) && s.starts != null) ? `${s.starts || 0} (${s.subApps || 0})` : (s.matches || 0))}
            ${info.pos === 'Kaleci' ? statBox('Clean Sheet', s.cleanSheets || 0) : statBox('Gol', s.goals || 0)}
            ${statBox('Asist', s.assists || 0)}
            ${statBox('Maçın Adamı', s.motm || 0)}
            ${statBox('Sarı Kart', s.yellowCards || 0)}
        </div>
        ${_ppAttrsGrid(info.attrs, info.pos)}
        ${info.isUser ? `
        <div class="pp-section-title">Kariyer Toplamı</div>
        <div class="pp-stats-grid">
            ${statBox('Maç', info.career.matches)}
            ${statBox(info.pos === 'Kaleci' ? 'Kurtarış' : 'Gol', info.pos === 'Kaleci' ? info.career.saves : info.career.goals)}
            ${statBox('Asist', info.career.assists)}
            ${statBox('Kupa', (gameState.trophies || []).length)}
        </div>
        ${(gameState.trophies && gameState.trophies.length) ? `<div class="pp-trophies">${_groupTrophies(gameState.trophies)}</div>` : ''}
        ${(p.transferHistory && p.transferHistory.length) ? `
        <div class="pp-section-title">Transfer Geçmişi</div>
        <div class="pp-transfers">${p.transferHistory.slice().reverse().slice(0, 8).map(t => `
            <div class="pp-tr-row">
                <span class="pp-tr-yr">${t.season}</span>
                <span class="pp-tr-move">${t.from} <i class="fa-solid fa-arrow-right"></i> ${t.to}</span>
                <span class="pp-tr-fee">${t.type === 'loan' ? 'Kiralık' : t.type === 'return' ? 'Dönüş' : (t.fee ? formatMoney(t.fee) : 'Bonservissiz')}</span>
            </div>`).join('')}</div>
        ` : ''}
        ` : ''}
        <div id="pp-history"></div>`;
    modal.style.display = 'flex';
    // FAZ 3c: geçmiş sezonlar (kullanıcı: seasonHistory; NPC: IDB playerSeasonsAll) — async doldur.
    if (typeof _fillProfileHistory === 'function') _fillProfileHistory(info);

    // Bug3: kullanıcı profil fotoğrafını buradan değiştirebilir
    if (info.isUser) {
        const eb = document.getElementById('pp-edit-photo');
        if (eb) eb.addEventListener('click', openProfileAvatarEditor);
    }
}

// ---- Profil fotoğrafı düzenleyici (galeri + yükleme; oluşturma ekranı mantığını yeniden kullanır) ----
function openProfileAvatarEditor() {
    const p = gameState.player; if (!p) return;
    let modal = document.getElementById('avatar-edit-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'avatar-edit-modal'; modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content glass-card" style="max-width:480px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <h2 style="margin:0;font-size:1.2rem;"><i class="fa-solid fa-camera text-accent"></i> Profil Fotoğrafı</h2>
                <button class="btn-close" id="ae-close" style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:4px;">
                <button class="btn btn-secondary btn-sm" id="ae-upload"><i class="fa-solid fa-upload"></i> Bilgisayardan Yükle</button>
                <button class="btn btn-secondary btn-sm" id="ae-clear"><i class="fa-solid fa-user"></i> Varsayılana Dön</button>
                <input type="file" id="ae-file" accept="image/*" style="display:none;">
            </div>
            <div class="avatar-gallery" id="ae-gallery" style="display:grid;"></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
        modal.querySelector('#ae-close').addEventListener('click', () => modal.style.display = 'none');
        const file = modal.querySelector('#ae-file');
        modal.querySelector('#ae-upload').addEventListener('click', () => file.click());
        file.addEventListener('change', e => {
            const f = e.target.files && e.target.files[0]; if (!f) return;
            if (f.size > 6 * 1024 * 1024) { showToast('Resim çok büyük (maks 6MB).', 'error'); return; }
            const reader = new FileReader();
            reader.onload = ev => _resizeToDataUrl(ev.target.result, 128, url => _applyProfileAvatar(url));
            reader.readAsDataURL(f); file.value = '';
        });
        modal.querySelector('#ae-clear').addEventListener('click', () => _applyProfileAvatar(''));
        const g = modal.querySelector('#ae-gallery');
        (typeof buildAvatarGallery === 'function' ? buildAvatarGallery() : []).forEach(url => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'avatar-choice';
            b.innerHTML = `<img src="${url}" loading="lazy" alt="">`;
            b.addEventListener('click', () => _applyProfileAvatar(url));
            g.appendChild(b);
        });
    }
    // mevcut seçimi vurgula
    modal.querySelectorAll('.avatar-choice').forEach(b => {
        const img = b.querySelector('img');
        b.classList.toggle('sel', img && img.getAttribute('src') === p.img);
    });
    modal.style.display = 'flex';
}

function _applyProfileAvatar(url) {
    const p = gameState.player; if (!p) return;
    p.img = url || '';
    if (typeof saveGame === 'function') saveGame();
    const m = document.getElementById('avatar-edit-modal'); if (m) m.style.display = 'none';
    if (typeof updateUI === 'function') updateUI();
    // Profil modalı AÇIKSA tazele; dashboard'dan düzenlendiyse modalı açma
    const ppm = document.getElementById('player-profile-modal');
    if (ppm && ppm.style.display === 'flex') openPlayerProfile('USER', p.teamId);
    if (typeof showToast === 'function') showToast('Profil fotoğrafın güncellendi.', 'success');
}

function _groupTrophies(trophies) {
    const c = {}; trophies.forEach(t => { c[t.title] = (c[t.title] || 0) + 1; });
    return Object.keys(c).map(t => `<span class="pp-trophy"><i class="fa-solid fa-award"></i> ${t}${c[t] > 1 ? ' ×' + c[t] : ''}</span>`).join('');
}

// Profil modalı kapatma (script body sonunda yüklendiği için DOM hazır)
(function () {
    const closeBtn = document.getElementById('btn-close-player-profile');
    const modal = document.getElementById('player-profile-modal');
    if (closeBtn) closeBtn.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
})();

if (typeof window !== 'undefined') {
    Object.assign(window, {
        computeLeagueLeaders, renderStatsTab, computeSeasonAwards, openPlayerProfile, STAT_CATS,
    });
}
