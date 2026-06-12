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

// ---- İstatistik sekmesi (FAZ B: SEZON seçici — geçmiş sezon krallıkları WorldDB'den) ----
let _statsPastCache = {};   // 'slot:season:league' -> liderler (geçmiş sezon, değişmez → kalıcı cache)
function _statsActive() { const t = document.getElementById('stats-tab'); return t && t.classList.contains('active'); }
function _statSeasonLabel(s) { return `${s}/${String((s + 1) % 100).padStart(2, '0')}${s === gameState.currentSeason ? ' (güncel)' : ''}`; }
// Görünüm değiştirici: Krallıklar (lig liderleri) | Rekorlar (tüm zamanlar) | Altın Top
function _statsViewBtnsHtml(view) {
    const views = [['leaders', 'fa-ranking-star', 'Krallıklar'], ['records', 'fa-trophy', 'Rekorlar'], ['ballon', 'fa-medal', 'Altın Top']];
    return `<div class="stat-cat-btns" id="stats-view-btns" style="margin-bottom:10px;">${views.map(([k, ic, lbl]) =>
        `<button class="stat-cat-btn ${view === k ? 'active' : ''}" data-view="${k}"><i class="fa-solid ${ic}"></i> ${lbl}</button>`).join('')}</div>`;
}
function _bindStatsViewBtns(host, sv) {
    host.querySelectorAll('#stats-view-btns .stat-cat-btn').forEach(b =>
        b.addEventListener('click', () => { sv.view = b.dataset.view; renderStatsTab(); }));
}
function renderStatsTab() {
    const host = document.getElementById('stats-content');
    if (!host) return;
    if (!gameState.statsView) gameState.statsView = { league: null, cat: 'g' };
    const sv = gameState.statsView;
    if (!sv.view) sv.view = 'leaders';
    // Rekorlar / Altın Top görünümleri 48-awards'a delege edilir
    if (sv.view === 'records' || sv.view === 'ballon') {
        host.innerHTML = `${_statsViewBtnsHtml(sv.view)}<div id="stats-alt-view"></div>`;
        _bindStatsViewBtns(host, sv);
        const c = document.getElementById('stats-alt-view');
        if (sv.view === 'records' && typeof renderRecordsView === 'function') renderRecordsView(c);
        else if (sv.view === 'ballon' && typeof renderBallonView === 'function') renderBallonView(c);
        return;
    }
    if (!sv.league) sv.league = activeLeagueId() || (DB.leagues()[0] && DB.leagues()[0].id);
    const startS = (typeof START_SEASON !== 'undefined') ? START_SEASON : gameState.currentSeason;
    if (sv.season == null || sv.season > gameState.currentSeason || sv.season < startS) sv.season = gameState.currentSeason;
    const season = sv.season, _slot = gameState._slot;
    const catBtns = STAT_CATS.map(c => `<button class="stat-cat-btn ${c.key === sv.cat ? 'active' : ''}" data-cat="${c.key}"><i class="fa-solid ${c.icon}"></i> ${c.label}</button>`).join('');

    // Leaders kaynağı: GÜNCEL → WorldStats/computeLeagueLeaders; GEÇMİŞ → WorldDB playerSeasons (gerçek).
    let leaders;
    if (season >= gameState.currentSeason) {
        if (window.WorldStats && _slot != null && !WorldStats.ready(_slot, season)) {
            WorldStats.ensureSeason(_slot, season).then(() => { if (_statsActive()) renderStatsTab(); });
            leaders = null;
        } else leaders = computeLeagueLeaders(sv.league);
        if (!leaders) DB.loadPlayers(sv.league).then(() => { if (_statsActive()) renderStatsTab(); });
    } else {
        const key = _slot + ':' + season + ':' + sv.league;
        if (_statsPastCache[key]) leaders = _statsPastCache[key];
        else {
            leaders = null;
            if (window.WorldDB && _slot != null && typeof WorldDB.leagueSeasonStats === 'function') {
                DB.loadPlayers(sv.league).then(() => WorldDB.leagueSeasonStats(_slot, season, sv.league)).then(list => {
                    _statsPastCache[key] = (list || []).map(rr => {
                        const pl = DB.playerByIdSync(rr.playerId) || {}, t = DB.getTeam(rr.teamId) || {};
                        return { id: rr.playerId, name: pl.name || ('Oyuncu #' + rr.playerId), teamId: rr.teamId, teamName: t.name || '', pos: pl.pos || '', img: pl.img || '', g: rr.goals || 0, a: rr.assists || 0, cs: rr.cleanSheets || 0, y: rr.yellows || 0, r: rr.reds || 0, motm: rr.motm || 0, played: rr.matches || 0, ovr: pl.ovr || 0 };
                    });
                    if (_statsActive()) renderStatsTab();
                }).catch(() => { _statsPastCache[key] = []; if (_statsActive()) renderStatsTab(); });
            }
        }
    }

    let table;
    if (!leaders) {
        table = `<p style="color:var(--text-muted);padding:14px;">İstatistikler ${season < gameState.currentSeason ? 'yükleniyor' : 'hesaplanıyor'}…</p>`;
    } else {
        const cat = STAT_CATS.find(c => c.key === sv.cat) || STAT_CATS[0];
        const rows = _topBy(leaders, sv.cat, 25);
        if (!rows.length) table = `<p style="color:var(--text-muted);padding:14px;">${season < gameState.currentSeason ? 'Bu sezon için veri yok.' : 'Henüz veri yok (sezon yeni başladı).'}</p>`;
        else table = `<table class="stats-table"><thead><tr><th>#</th><th>Oyuncu</th><th>Takım</th><th style="text-align:center;">${cat.col}</th></tr></thead><tbody>${rows.map((r, i) => `
            <tr class="${r.isUser ? 'stats-user-row' : ''}" data-pid="${r.id}" data-tid="${r.teamId}" style="cursor:pointer;">
                <td><strong>${i + 1}</strong></td>
                <td><span style="display:inline-flex;align-items:center;gap:8px;">${_photoHtml(r.img, (POS_BY_KEY[r.pos] || {}).short || '', 22, '#555')}<span>${r.name}${r.isUser ? ' <span style="color:var(--accent);font-size:.7rem;">(Sen)</span>' : ''}</span></span></td>
                <td><span style="display:inline-flex;align-items:center;gap:6px;">${getTeamLogoHtml(r.teamId, 16)}<span class="stats-team">${r.teamName}</span></span></td>
                <td style="text-align:center;font-weight:800;font-family:var(--font-heading);">${r[sv.cat] || 0}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    host.innerHTML = `
        ${_statsViewBtnsHtml('leaders')}
        <div class="stats-toolbar">
            ${(typeof customDropdownShell === 'function') ? customDropdownShell('stats-season-picker', 'season-dd', false) : ''}
            ${(typeof leagueDropdownHtml === 'function') ? leagueDropdownHtml('stats-league-picker', 'stats-ldd') : `<select id="stats-league-picker" class="game-league-select"></select>`}
            <div class="stat-cat-btns">${catBtns}</div>
        </div>
        <div class="stats-table-wrap">${table}</div>`;
    _bindStatsViewBtns(host, sv);

    // Sezon seçici (custom dropdown)
    const sdd = document.getElementById('stats-season-picker');
    if (sdd && typeof setupDropdown === 'function') {
        const sOpts = []; for (let s = gameState.currentSeason; s >= startS; s--) sOpts.push({ id: String(s), label: _statSeasonLabel(s) });
        setupDropdown(sdd, sOpts, String(season));
        const sh = sdd.querySelector('input[type="hidden"]');
        if (sh) sh.addEventListener('change', () => { sv.season = parseInt(sh.value, 10) || gameState.currentSeason; renderStatsTab(); });
    }
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
            return `<div class="pp-attr" data-attr="${k}" style="display:flex;justify-content:space-between;gap:6px;font-size:.78rem;padding:1px 4px;border-radius:4px;"><span class="pp-attr-lbl" style="color:var(--text-muted)">${lbl}</span><strong style="color:${col}">${v}</strong></div>`;
        }).join('');
        html += `<div style="min-width:138px;flex:1;"><div style="font-weight:700;font-size:.8rem;margin-bottom:3px;color:#fff;">${gname}</div>${items}</div>`;
    }
    return `<div class="pp-section-title">Detaylı Özellikler</div><div style="display:flex;flex-wrap:wrap;gap:14px;">${html}</div>`;
}

// ---- FM-tarzı ETKİLEŞİMLİ mevki/rol/özellik bloğu (TEK DURUM ile senkron) ----
// Mevki haritası + yetkinlik çipleri + roller aynı `selectedPos`/`selectedRole`'a bağlı.
// Mevki seç (çip veya harita) → o mevkinin rolleri gelir + en iyi rol seçilir; rol seç → önemli
// özellikler parlar (mavi≥2 / sarı=1). Açılışta en verimli (doğal) mevki + en iyi rol seçili gelir.
let _ppState = null;
function _ppPlLike(info) { return { pos: info.pos, position: info.pos, altPos: info.altPos || [], attrs: info.attrs }; }
function _ppFamColor(key) { return key === 'NAT' ? 'var(--accent)' : key === 'ACC' ? '#8bc34a' : key === 'COMP' ? '#ffca28' : '#ef5350'; }
function _ppBestRole(plLike, fam) {
    const roles = (typeof ROLE_CATALOG !== 'undefined' && ROLE_CATALOG[fam]) || [];
    let best = null, bs = -1;
    roles.forEach(r => { const s = roleSuitability(plLike, r.key); if (s > bs) { bs = s; best = r.key; } });
    return best;
}
function _ppRoleWeights(roleKey) { const r = (typeof findRole === 'function') ? findRole(roleKey) : null; return r ? r.w : null; }
function _ppApplyHighlight(body, weights) {
    body.querySelectorAll('.pp-attr').forEach(el => {
        el.classList.remove('attr-key', 'attr-useful');
        const w = weights ? weights[el.getAttribute('data-attr')] : 0;
        if (w >= 2) el.classList.add('attr-key');
        else if (w >= 1) el.classList.add('attr-useful');
    });
}
// Skills bloğunun kabuğu (mount sonrası içerikler doldurulur)
function _ppSkillsHtml() {
    return `<div id="pp-posmap-wrap"></div><div id="pp-fams-wrap"></div><div id="pp-roles-wrap"></div>`;
}
function _ppRenderSkills() {
    const st = _ppState; if (!st) return;
    const body = st.body, plLike = st.plLike;
    const fam = posFamily(st.pos);
    // mevki haritası
    const mapHost = body.querySelector('#pp-posmap-wrap');
    if (mapHost) {
        const spots = Object.keys(PP_POS_COORDS).map(key => {
            const c = PP_POS_COORDS[key];
            const f = positionFamiliarity(plLike, key);
            const op = f.key === 'AWK' ? 0.32 : 1;
            const sel = key === st.pos ? ' pp-pos-sel' : '';
            const short = (POS_BY_KEY[key] || { short: key }).short;
            return `<div class="pp-pos-spot${sel}" data-pos="${key}" style="left:${c.x}%;top:${c.y}%;background:${_ppFamColor(f.key)};opacity:${op};" title="${key}: ${f.label}">${short}</div>`;
        }).join('');
        mapHost.innerHTML = `<div class="pp-section-title">Mevki Haritası <span class="pp-sec-sub">(tıkla → mevki seç)</span></div><div class="pp-posmap">${spots}</div>`;
    }
    // yetkinlik çipleri
    const famHost = body.querySelector('#pp-fams-wrap');
    if (famHost) {
        const chips = (playerPositionsFamiliarity(plLike) || []).map(x => {
            const short = (POS_BY_KEY[x.pos] || { short: x.pos }).short;
            const sel = x.pos === st.pos ? ' pp-fam-sel' : '';
            return `<span class="pp-fam${sel}" data-pos="${x.pos}" style="border-color:${_ppFamColor(x.fam.key)};color:${_ppFamColor(x.fam.key)};">${short} <small>${x.fam.label}</small></span>`;
        }).join('');
        famHost.innerHTML = `<div class="pp-section-title">Mevki Yetkinliği <span class="pp-sec-sub">(tıkla → mevki seç)</span></div><div class="pp-fams">${chips || '<span class="pp-fam">—</span>'}</div>`;
    }
    // seçili mevkinin rolleri
    const roleHost = body.querySelector('#pp-roles-wrap');
    if (roleHost) {
        const roles = (typeof ROLE_CATALOG !== 'undefined' && ROLE_CATALOG[fam]) || [];
        const best = _ppBestRole(plLike, fam);
        const rows = roles.map(r => {
            const stars = roleStars(plLike, r.key);
            const isBest = r.key === best, isSel = r.key === st.role;
            return `<div class="pp-role${isBest ? ' pp-role-best' : ''}${isSel ? ' pp-role-sel' : ''}" data-rolekey="${r.key}">
                <span class="pp-role-lbl">${r.label}${isBest ? ' <i class="fa-solid fa-star" style="color:#ffca28;font-size:.66rem;" title="En uygun rol"></i>' : ''}</span>
                <span class="pp-role-stars">${'★'.repeat(Math.round(stars))}<span class="pp-star-num">${stars.toFixed(1)}</span></span></div>`;
        }).join('');
        const posShort = (POS_BY_KEY[st.pos] || { short: st.pos }).short;
        roleHost.innerHTML = `<div class="pp-section-title">${posShort} Rolleri <span class="pp-sec-sub">(tıkla → <span style="color:#7fb0ff;">mavi</span> çok önemli · <span style="color:#e0c060;">sarı</span> yararlı)</span></div><div class="pp-roles">${rows || '<span class="pp-sec-sub">—</span>'}</div>`;
    }
    _ppApplyHighlight(body, _ppRoleWeights(st.role));
}
function _ppMountSkills(body, info) {
    if (typeof positionFamiliarity !== 'function' || typeof ROLE_CATALOG === 'undefined' || !info.attrs) { _ppState = null; return; }
    const plLike = _ppPlLike(info);
    _ppState = { body: body, info: info, plLike: plLike, pos: info.pos, role: _ppBestRole(plLike, posFamily(info.pos)) };
    _ppRenderSkills();
    // tek seferlik delege dinleyici (her açılışta yeniden eklenmesin)
    if (!body._ppSkillsBound) {
        body._ppSkillsBound = true;
        body.addEventListener('click', (e) => {
            const st = _ppState; if (!st || st.body !== body || !e.target.closest) return;
            const roleEl = e.target.closest('.pp-role[data-rolekey]');
            if (roleEl) { st.role = roleEl.getAttribute('data-rolekey'); _ppRenderSkills(); return; }
            const posEl = e.target.closest('.pp-fam[data-pos]') || e.target.closest('.pp-pos-spot[data-pos]');
            if (posEl) { st.pos = posEl.getAttribute('data-pos'); st.role = _ppBestRole(st.plLike, posFamily(st.pos)); _ppRenderSkills(); }
        });
    }
}

// Mevki haritası koordinatları (mini saha; y büyük=kendi kale, küçük=hücum)
const PP_POS_COORDS = {
    'Kaleci': { x: 50, y: 93 },
    'Sol Bek': { x: 13, y: 75 }, 'Stoper': { x: 50, y: 81 }, 'Sağ Bek': { x: 87, y: 75 },
    'DOS': { x: 50, y: 64 }, 'Merkez OS': { x: 50, y: 51 },
    'Sol Kanat': { x: 12, y: 48 }, 'Sağ Kanat': { x: 88, y: 48 },
    'Ofansif OS': { x: 50, y: 37 },
    'Sol Açık': { x: 22, y: 23 }, 'Sağ Açık': { x: 78, y: 23 },
    'Santrfor': { x: 50, y: 14 },
};
// (Mevki haritası + yetkinlik + vurgulama artık _ppRenderSkills/_ppMountSkills içinde — yukarı bak.)

// ---- FM-tarzı oyuncu profili ----
// FAZ 3c: profil geçmiş-sezon tablosu. Kullanıcı: gameState.player.seasonHistory.
// NPC: IDB playerSeasonsAll (sezon sonlarında agregat edilen gerçek istatistik).
function _fillProfileHistory(info) {
    const host = document.getElementById('pp-history');
    if (!host) return;
    const isGK = info.pos === 'Kaleci';
    const curSeason = gameState.currentSeason;
    const s = info.season || {};
    // GÜNCEL sezon satırı (ilk sezonda bile görünür — canlı veriden)
    const curRow = {
        season: curSeason, teamId: info.teamId, teamName: info.teamName,
        matches: s.matches || 0, subApps: s.subApps || 0, goals: s.goals || 0, assists: s.assists || 0,
        cleanSheets: s.cleanSheets || 0, motm: s.motm || 0, current: true
    };
    const render = (pastRows) => {
        const rows = [curRow].concat((pastRows || []).filter(r => r.season < curSeason));
        rows.sort((a, b) => b.season - a.season);   // yeni → eski
        host.innerHTML = `<div class="pp-section-title">Sezon-Sezon İstatistik</div>
            <div class="stats-table-wrap"><table class="stats-table" style="font-size:.82rem;">
            <thead><tr><th>Sezon</th><th>Takım</th><th style="text-align:center;">Maç</th><th style="text-align:center;">Gol</th><th style="text-align:center;">Asist</th>${isGK ? '<th style="text-align:center;" title="Gol yenmeyen maç">C.Sheet</th>' : ''}<th style="text-align:center;">MoM</th></tr></thead>
            <tbody>${rows.map(r => `<tr class="${r.current ? 'pp-hist-cur' : ''}">
                <td>${r.season}/${String((r.season + 1) % 100).padStart(2, '0')}${r.current ? ' <span class="pp-cur-tag">güncel</span>' : ''}</td>
                <td><span style="display:inline-flex;align-items:center;gap:6px;">${getTeamLogoHtml(r.teamId, 16)}<span>${r.teamName || (DB.getTeam(r.teamId) || {}).name || ''}</span></span></td>
                <td style="text-align:center;">${r.matches || 0}${r.subApps ? ` <span style="color:var(--text-muted);">(${r.subApps})</span>` : ''}</td>
                <td style="text-align:center;font-weight:700;">${r.goals || 0}</td>
                <td style="text-align:center;">${r.assists || 0}</td>
                ${isGK ? `<td style="text-align:center;font-weight:700;color:#26c6da;">${r.cleanSheets || 0}</td>` : ''}
                <td style="text-align:center;">${r.motm || 0}</td></tr>`).join('')}</tbody></table></div>`;
    };
    if (info.isUser) {
        const sh = (gameState.player.seasonHistory || []).map(h => ({
            season: h.season, teamId: h.teamId, teamName: h.teamName,
            matches: (h.league && h.league.matches) || 0, subApps: (h.league && h.league.subApps) || 0,
            goals: (h.league && h.league.goals) || 0, assists: (h.league && h.league.assists) || 0,
            cleanSheets: (h.league && h.league.cleanSheets) || 0, motm: (h.league && h.league.motm) || 0,
        }));
        render(sh);
    } else if (window.WorldDB && gameState._slot != null && info.playerId != null && /^\d+$/.test(String(info.playerId)) && typeof WorldDB.playerSeasonsAll === 'function') {
        render([]);   // güncel sezonu HEMEN göster; geçmiş async eklenir
        WorldDB.playerSeasonsAll(gameState._slot, Number(info.playerId)).then(list => {
            render((list || []).map(r => ({
                season: r.season, teamId: r.teamId, teamName: (DB.getTeam(r.teamId) || {}).name || '',
                matches: r.matches, subApps: r.subApps, goals: r.goals, assists: r.assists,
                cleanSheets: r.cleanSheets || 0, motm: r.motm || 0,
            })));
        }).catch(() => {});
    } else {
        render([]);
    }
}

// ---- Profil sekmeleri (Genel/Geçmiş/Maçlar/Gelişim) ----
function _ppBindTabs(body) {
    const tabs = body.querySelectorAll('.pp-tab');
    const panes = body.querySelectorAll('.pp-pane');
    tabs.forEach(t => t.addEventListener('click', () => {
        const target = t.getAttribute('data-pane');
        tabs.forEach(x => x.classList.toggle('active', x === t));
        panes.forEach(p => { p.hidden = (p.getAttribute('data-pane') !== target); });
    }));
}

// ---- Transfer geçmişi (kullanıcı: transferHistory; NPC: WorldDB transfers) ----
function _fillProfileTransfers(info) {
    const host = document.getElementById('pp-transfers');
    if (!host) return;
    const feeTxt = t => t.type === 'loan' ? 'Kiralık' : t.type === 'return' ? 'Dönüş' : (t.fee ? formatMoney(t.fee) : 'Bonservissiz');
    const render = (rows) => {
        if (!rows.length) { host.innerHTML = ''; return; }
        host.innerHTML = `<div class="pp-section-title">Transfer Geçmişi</div>
            <div class="pp-transfers">${rows.map(t => `
                <div class="pp-tr-row">
                    <span class="pp-tr-yr">${t.season}</span>
                    <span class="pp-tr-move">${t.from} <i class="fa-solid fa-arrow-right"></i> ${t.to}</span>
                    <span class="pp-tr-fee">${feeTxt(t)}</span>
                </div>`).join('')}</div>`;
    };
    if (info.isUser) {
        render((gameState.player.transferHistory || []).slice().reverse().slice(0, 12));
    } else if (window.WorldDB && gameState._slot != null && info.playerId != null && /^\d+$/.test(String(info.playerId)) && typeof WorldDB.transfersOfPlayer === 'function') {
        WorldDB.transfersOfPlayer(gameState._slot, Number(info.playerId)).then(list => {
            render((list || []).slice().sort((a, b) => b.season - a.season).slice(0, 12).map(t => ({
                season: t.season, type: t.type, fee: t.fee,
                from: t.fromName || (DB.getTeam(t.fromTeam) || {}).name || '?',
                to: t.toName || (DB.getTeam(t.toTeam) || {}).name || '?',
            })));
        }).catch(() => {});
    }
}

// ---- Gelişim eğrisi — kullanıcı: trainingHistory (gerçek). NPC/yetersiz kayıt: yaş-bazlı kariyer eğrisi. ----
function _ppPeakAge(pos) { return pos === 'Kaleci' ? 31 : (pos === 'Stoper' || pos === 'DOS') ? 30 : 28; }
function _careerOvrArc(info) {
    const ovr = info.ovr, age = info.age || 24, peak = _ppPeakAge(info.pos);
    const pot = Math.max(info.potential || ovr, ovr);
    const startAge = 17, endAge = Math.max(age + 3, peak + 3) > 38 ? 38 : Math.max(age + 3, peak + 3);
    const pts = [];
    for (let a = startAge; a <= endAge; a++) {
        let v;
        if (a <= peak) { const t = (a - startAge) / Math.max(1, peak - startAge); const floor = Math.max(46, pot - 22); v = floor + (pot - floor) * Math.pow(t, 0.8); }
        else { v = pot - (a - peak) * 1.4; }
        pts.push({ age: a, v: v });
    }
    const cur = pts.find(p => p.age === age);   // şu anki yaş+OVR'a sabitle (kayma)
    if (cur) { const shift = ovr - cur.v; pts.forEach(p => p.v += shift); }
    return pts.map(p => ({ age: p.age, ovr: Math.max(40, Math.min(99, Math.round(p.v))) }));
}
const _MAIN_LABELS = { hiz: 'Hız', sut: 'Şut', pas: 'Pas', teknik: 'Teknik', defans: 'Defans', fizik: 'Fizik' };
// NPC: GERÇEK (deterministik) sezon-sezon özellik gelişimi — "hangi özellik ne kadar gelişti".
function _npcDevHtml(dev, pos) {
    const isGK = pos === 'Kaleci';
    const order = isGK ? ['teknik', 'fizik', 'hiz', 'pas', 'defans', 'sut'] : ['hiz', 'sut', 'pas', 'teknik', 'defans', 'fizik'];
    const seasons = dev.seasons || 0;
    const curveVals = dev.curve.map(c => c.ovr);
    const ovrD = curveVals.length ? (curveVals[curveVals.length - 1] - curveVals[0]) : 0;
    const axis = dev.curve.map(c => `<span>${String(c.season % 100).padStart(2, '0')}</span>`).join('');
    let rows = '';
    for (const g of order) {
        const base = dev.baseMains[g] || 0, cur = dev.mains[g] || 0, d = cur - base;
        const lbl = (isGK && g === 'teknik') ? 'Kalecilik' : (_MAIN_LABELS[g] || g);
        const dCls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
        rows += `<div class="pp-dev-row">
            <span class="pp-dev-lbl">${lbl}</span>
            <div class="pp-dev-bar"><div class="pp-dev-fill" style="width:${Math.max(0, Math.min(100, cur))}%;"></div></div>
            <span class="pp-dev-val">${base} <i class="fa-solid fa-arrow-right-long" style="font-size:.7em;opacity:.6;"></i> <b>${cur}</b> <span class="pp-dev-d ${dCls}">${d > 0 ? '+' : ''}${d}</span></span>
        </div>`;
    }
    const injTxt = (dev.injuries && dev.injuries.length)
        ? `<div class="pp-dev-inj"><i class="fa-solid fa-kit-medical"></i> Sakatlık/sekte: ${dev.injuries.map(s => String(s) + '/' + String((s + 1) % 100).padStart(2, '0')).join(', ')}</div>`
        : (seasons > 0 ? `<div class="pp-dev-inj ok"><i class="fa-solid fa-shield-heart"></i> Bu dönemde ciddi sakatlık yaşamadı.</div>` : '');
    const sub = seasons > 0 ? `${seasons} sezon · OVR ${ovrD >= 0 ? '+' : ''}${ovrD}` : 'kariyer henüz başında';
    return `<div class="pp-section-title">Gelişim <span class="pp-sec-sub">(${sub})</span></div>
        ${seasons > 0 ? `<div class="pp-devcurve-wrap">${_devChart(curveVals, '#00b0ff')}</div><div class="pp-arc-axis">${axis}</div>` : ''}
        <div class="pp-dev-list">${rows}</div>
        ${injTxt}`;
}
function _fillProfileDevCurve(info) {
    const host = document.getElementById('pp-devcurve');
    if (!host || typeof _devChart !== 'function') return;
    if (info.isUser) {
        const hist = gameState.player.trainingHistory || [];
        if (hist.length >= 2) {
            const vals = hist.map(h => h.ovr); const first = vals[0], last = vals[vals.length - 1], d = last - first;
            host.innerHTML = `<div class="pp-section-title">Gelişim Eğrisi <span class="pp-sec-sub">(gerçek antrenman/sezon kaydı · ${first} → ${last}, ${d >= 0 ? '+' : ''}${d} OVR · ${hist.length} kayıt)</span></div>
                <div class="pp-devcurve-wrap">${_devChart(vals, '#00e676')}</div>`;
            return;
        }
    }
    // NPC → GERÇEK deterministik özellik gelişimi (başlangıçtan bugüne)
    if (info.dev) { host.innerHTML = _npcDevHtml(info.dev, info.pos); return; }
    // Fallback (altyapı/yetersiz kayıt) → yaş-bazlı eğri
    const arc = _careerOvrArc(info);
    const vals = arc.map(p => p.ovr);
    const axis = arc.map(p => `<span>${p.age}</span>`).join('');
    host.innerHTML = `<div class="pp-section-title">Gelişim Eğrisi <span class="pp-sec-sub">(yaş-bazlı kariyer eğrisi · şu an ${info.age} yaş · OVR ${info.ovr}${info.potential ? ' · pot. ' + info.potential : ''})</span></div>
        <div class="pp-devcurve-wrap">${_devChart(vals, '#00b0ff')}</div>
        <div class="pp-arc-axis">${axis}</div>`;
}

// ---- Oynadığı maçlar + tek-tek performans ----
function _ppMatchRowUser(m) {
    const dnp = !!m.dnp;
    const rt = (m.rating != null) ? (+m.rating).toFixed(1) : '—';
    const rtCls = m.rating == null ? '' : (m.rating >= 7.5 ? 'high' : m.rating <= 5.8 ? 'low' : '');
    const motm = m.motm ? ' <i class="fa-solid fa-star" title="Maçın Adamı" style="color:#ffca28;"></i>' : '';
    const comp = m.comp ? `<span class="pp-m-comp">${m.comp}</span>` : '';
    const role = dnp ? '' : (m.mins != null ? `${m.started === false ? 'Yedek ' : ''}${m.mins}'` : '');
    const clk = m.leagueId ? ` pp-m-click" data-lg="${m.leagueId}" data-w="${(m.week || 1) - 1}" data-h="${m.home}" data-a="${m.away}" data-s="${m.season}` : '';
    return `<div class="pp-m-row${clk}">
        <span class="pp-m-when">S${m.season}·H${m.week}</span>
        <span class="pp-m-match">${getTeamLogoHtml(m.home, 14)} <b>${m.sh}-${m.sa}</b> ${getTeamLogoHtml(m.away, 14)}</span>
        <span class="pp-m-role">${comp}${role}</span>
        <span class="pp-m-ga">${dnp ? '<span class="pp-m-dnp">oynamadı</span>' : `${m.g || 0}G ${m.a || 0}A${motm}`}</span>
        <span class="pp-m-rt ${rtCls}">${dnp ? '—' : rt}</span></div>`;
}
// Deterministik per-maç tohumu (NPC rating/dakika tutarlı kalsın — aynı oyuncu/sezon/hafta hep aynı)
function _npcMatchRng(pid, season, week) {
    let h = ((Number(pid) || 0) >>> 0) ^ (Math.imul((season || 0), 73856093) >>> 0) ^ (Math.imul((week || 0) + 1, 19349663) >>> 0);
    h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
    return (h % 1000) / 1000;
}
function _ppMatchRowNpc(m) {
    const role = m.started ? `İlk 11 · ${m.mins != null ? m.mins : 90}'` : (m.sub ? `Yedek · ${m.mins != null ? m.mins : 0}'` : '');
    const cards = (m.y ? ' <span class="pp-m-yc"></span>' : '') + (m.r ? ' <span class="pp-m-rc"></span>' : '');
    const rt = (m.rating != null) ? (+m.rating).toFixed(1) : '—';
    const rtCls = m.rating == null ? '' : (m.rating >= 7.5 ? 'high' : m.rating <= 5.8 ? 'low' : '');
    return `<div class="pp-m-row pp-m-click" data-lg="${m.leagueId}" data-w="${m.week}" data-h="${m.home}" data-a="${m.away}" data-s="${m.season}">
        <span class="pp-m-when">H${(m.week || 0) + 1}</span>
        <span class="pp-m-match">${getTeamLogoHtml(m.home, 14)} <b>${m.sh}-${m.sa}</b> ${getTeamLogoHtml(m.away, 14)}</span>
        <span class="pp-m-role">${role}</span>
        <span class="pp-m-ga">${m.g || 0}G ${m.a || 0}A${cards}</span>
        <span class="pp-m-rt ${rtCls}">${rt}</span></div>`;
}
function _ppBindMatchRows(host) {
    host.querySelectorAll('.pp-m-click').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            if (typeof openMatchDetail === 'function')
                openMatchDetail(el.dataset.lg, parseInt(el.dataset.w, 10) || 0, el.dataset.h, el.dataset.a, parseInt(el.dataset.s, 10));
        });
    });
}
function _fillProfileMatches(info) {
    const host = document.getElementById('pp-matches');
    if (!host) return;
    const curSeason = gameState.currentSeason;
    const startS = (typeof START_SEASON !== 'undefined') ? START_SEASON : curSeason;
    // Sezon seçenekleri: kullanıcı → matchLog'taki sezonlar; NPC → başlangıçtan güncele
    let seasons = [];
    if (info.isUser) {
        const set = new Set((gameState.player.matchLog || []).map(m => m.season)); set.add(curSeason);
        seasons = [...set].sort((a, b) => b - a);
    } else {
        for (let sy = curSeason; sy >= startS; sy--) seasons.push(sy);
    }
    if (!seasons.length) seasons = [curSeason];
    const opts = seasons.map(sy => `<option value="${sy}"${sy === curSeason ? ' selected' : ''}>${sy}/${String((sy + 1) % 100).padStart(2, '0')}${sy === curSeason ? ' (güncel)' : ''}</option>`).join('');
    host.innerHTML = `<div class="pp-section-title">Maçları
        <select id="pp-mseason" class="game-league-select pp-mseason">${opts}</select></div>
        <div id="pp-mlist"><p class="pp-loading">Yükleniyor…</p></div>`;
    const sel = document.getElementById('pp-mseason');
    if (sel) sel.addEventListener('change', () => _loadMatchesSeason(info, parseInt(sel.value, 10)));
    _loadMatchesSeason(info, curSeason);
}
function _loadMatchesSeason(info, season) {
    const list = document.getElementById('pp-mlist');
    if (!list) return;
    if (info.isUser) {
        const rows = (gameState.player.matchLog || []).filter(m => m.season === season);
        if (!rows.length) { list.innerHTML = `<p class="pp-empty-sm">Bu sezon maç kaydı yok.</p>`; return; }
        list.innerHTML = `<div class="pp-matches-list">${rows.slice().reverse().map(_ppMatchRowUser).join('')}</div>`;
        _ppBindMatchRows(list); return;
    }
    const slot = gameState._slot, pid = Number(info.playerId);
    if (!(window.WorldDB && slot != null && /^\d+$/.test(String(info.playerId)) && typeof WorldDB.matchesOfLeagueSeason === 'function')) { list.innerHTML = `<p class="pp-empty-sm">Maç verisi yok.</p>`; return; }
    list.innerHTML = `<p class="pp-loading">Yükleniyor…</p>`;
    // O sezondaki takım/lig transfer nedeniyle farklı olabilir → playerSeason kaydından, yoksa güncel
    const teamP = (season < gameState.currentSeason && typeof WorldDB.playerSeason === 'function')
        ? WorldDB.playerSeason(slot, pid, season).then(ps => ps ? { teamId: ps.teamId, lg: ps.leagueId } : null).catch(() => null)
        : Promise.resolve(null);
    teamP.then(t2 => {
        const teamId = (t2 && t2.teamId) || info.teamId;
        const lg = (t2 && t2.lg) || (DB.getTeam(teamId) || {}).leagueId || (teamId ? String(teamId).split('__')[0] : null);
        if (!lg) { list.innerHTML = `<p class="pp-empty-sm">Maç verisi yok.</p>`; return; }
        WorldDB.matchesOfLeagueSeason(slot, season, lg).then(matches => {
            const mine = [];
            (matches || []).forEach(m => {
                if (m.home !== teamId && m.away !== teamId) return;
                const inXI = (m.homeXI || []).map(Number).indexOf(pid) >= 0 || (m.awayXI || []).map(Number).indexOf(pid) >= 0;
                const inSub = (m.homeSubs || []).map(Number).indexOf(pid) >= 0 || (m.awaySubs || []).map(Number).indexOf(pid) >= 0;
                let g = 0, a = 0, y = 0, rd = 0;
                for (const ev of (m.events || [])) {
                    if (Number(ev.playerId) === pid) { if (ev.type === 'goal' && !ev.ownGoal) g++; else if (ev.type === 'yellow') y++; else if (ev.type === 'red') rd++; }
                    if (ev.type === 'goal' && Number(ev.assistId) === pid) a++;
                }
                if (!inXI && !inSub && !g && !a && !y && !rd) return;
                // Dakika (yaklaşık) + rating (deterministik): kayıtta tutulmuyor → maç sonucu + katkı + OVR'dan üret
                const _won = (m.home === teamId && m.sh > m.sa) || (m.away === teamId && m.sa > m.sh);
                const _lost = (m.home === teamId && m.sh < m.sa) || (m.away === teamId && m.sa < m.sh);
                const _rng = _npcMatchRng(pid, season, m.week);
                let _rt = 6.3 + g * 0.9 + a * 0.55 - rd * 1.6 - y * 0.15 + (_won ? 0.35 : _lost ? -0.35 : 0) + (((info.ovr || 72) - 72) * 0.012) + (_rng - 0.5) * 0.7;
                _rt = Math.max(4.3, Math.min(9.6, _rt));
                const _mins = inXI ? 90 : (inSub ? Math.round(16 + _rng * 26) : 0);
                mine.push({ week: m.week, home: m.home, away: m.away, sh: m.sh, sa: m.sa, leagueId: m.leagueId, season: season, g, a, y, r: rd, started: inXI, sub: inSub, rating: +_rt.toFixed(1), mins: _mins });
            });
            if (!mine.length) { list.innerHTML = `<p class="pp-empty-sm">Bu sezon için kayıtlı maç bulunamadı.</p>`; return; }
            mine.sort((x, z) => z.week - x.week);
            list.innerHTML = `<div class="pp-matches-list">${mine.map(_ppMatchRowNpc).join('')}</div>`;
            _ppBindMatchRows(list);
        }).catch(() => { list.innerHTML = `<p class="pp-empty-sm">Maçlar yüklenemedi.</p>`; });
    });
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
            potential: p.potential, attrs: p.attrs, altPos: p.altPos || [], role: p.role,
        };
    } else {
        const pl = DB.squadSync(teamId).find(x => String(x.id) === pidStr) || DB.playerByIdSync(pid) || DB.playerByIdSync(pidStr);
        if (!pl) { showToast('Oyuncu verisi yüklenemedi.', 'error'); return; }
        const team = DB.getTeam(teamId) || DB.getTeam(pl.teamId) || {};
        const ovr = ageAdjustedOvr(pl, seasonsElapsed);
        // Altyapı oyuncusu MANUEL yaşlanır (clubYouth), regen'ler WorldDB evriminde yaşlanır →
        // yaşına seasonsElapsed EKLEME (kadroda 17, profilde 21 çifte-yaş bug'ı; regen'de aynısı).
        const _isY = !!(pl.isYouth || pl.isRegen);
        const effAge = _isY ? (pl.age || 17) : (pl.age || 0) + seasonsElapsed;
        // Potansiyel: youth'ta açıkça var; DB oyuncusunda gençlik boşluğundan türet (yaşlıda ≈ ovr).
        const pot = pl.potential ? pl.potential : Math.max(ovr, Math.min(99, Math.round(ovr + Math.max(0, 23 - effAge) * 1.1)));
        // Yaşayan gelişim: başlangıçtan bugüne deterministik özellik projeksiyonu (güncel özellikler + "Gelişim" sekmesi).
        // Youth/regen kendi sistemlerinde gelişir → sentetik projeksiyon onlara uygulanmaz.
        const _dev = (typeof buildNpcDevHistory === 'function' && !_isY && pl.attrs) ? buildNpcDevHistory(pl, seasonsElapsed) : null;
        // FAZ 3c: bu sezon istatistiği GERÇEK (WorldStats, maçlardan) hazırsa onu; değilse sentetik (tahmini).
        const _slotP = gameState._slot, _seasonP = gameState.currentSeason;
        const _wst = (window.WorldStats && _slotP != null && WorldStats.ready(_slotP, _seasonP)) ? WorldStats.playerStat(pl.id) : null;
        let ls, _real;
        if (_wst) { ls = { played: _wst.m, starts: _wst.starts, subApps: _wst.subApps, g: _wst.g, a: _wst.a, cs: _wst.cs, y: _wst.y, reds: _wst.r || 0, motm: _wst.motm }; _real = true; }
        else {
            const leaders = computeLeagueLeaders(team.leagueId) || [];
            const f = leaders.find(x => String(x.id) === pidStr) || { g: 0, a: 0, motm: 0, cs: 0, y: 0, played: 0 };
            ls = { played: f.played, starts: 0, subApps: 0, g: f.g, a: f.a, cs: f.cs, y: f.y, reds: f.reds || 0, motm: f.motm }; _real = false;
        }
        info = {
            name: pl.name, teamId: team.id, teamName: team.name, pos: pl.pos, ovr, potential: pot,
            age: effAge, img: pl.img, nat: pl.nation, real: _real, playerId: pl.id,
            value: calcMarketValue(ovr, effAge, team.prestige || 2),
            wage: calcWage(ovr, team.prestige || 2),
            season: { matches: ls.played, starts: ls.starts, subApps: ls.subApps, goals: ls.g, assists: ls.a, cleanSheets: ls.cs, yellowCards: ls.y, redCards: ls.reds, motm: ls.motm },
            foot: pl.foot, skillMoves: pl.skillMoves, weakFoot: pl.weakFoot, attrs: (_dev ? _dev.attrs : pl.attrs), altPos: pl.altPos || [], dev: _dev,
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
        <div class="pp-tabs">
            <button class="pp-tab active" data-pane="genel"><i class="fa-solid fa-id-card"></i> Genel</button>
            <button class="pp-tab" data-pane="gecmis"><i class="fa-solid fa-clock-rotate-left"></i> Geçmiş</button>
            <button class="pp-tab" data-pane="maclar"><i class="fa-solid fa-futbol"></i> Maçlar</button>
            <button class="pp-tab" data-pane="gelisim"><i class="fa-solid fa-chart-line"></i> Gelişim</button>
        </div>
        <div class="pp-pane pp-genel-grid" data-pane="genel">
            <div class="pp-col-main">
                <div class="pp-section-title">${gameState.currentSeason} Sezonu${(info.isUser || info.real) ? '' : ' (tahmini)'}</div>
                <div class="pp-stats-grid">
                    ${statBox('Maç', ((info.isUser || info.real) && s.starts != null) ? `${s.starts || 0} (${s.subApps || 0})` : (s.matches || 0))}
                    ${info.pos === 'Kaleci' ? (statBox('Clean Sheet', s.cleanSheets || 0) + statBox('Gol', s.goals || 0)) : statBox('Gol', s.goals || 0)}
                    ${statBox('Asist', s.assists || 0)}
                    ${statBox('Maçın Adamı', s.motm || 0)}
                    ${statBox('Sarı Kart', s.yellowCards || 0)}
                    ${statBox('Kırmızı Kart', s.redCards || 0)}
                </div>
                ${_ppAttrsGrid(info.attrs, info.pos)}
            </div>
            <div class="pp-col-side">${_ppSkillsHtml()}</div>
        </div>
        <div class="pp-pane" data-pane="gecmis" hidden>
            ${info.isUser ? `
            <div class="pp-section-title">Kariyer Toplamı</div>
            <div class="pp-stats-grid">
                ${statBox('Maç', info.career.matches)}
                ${statBox(info.pos === 'Kaleci' ? 'Kurtarış' : 'Gol', info.pos === 'Kaleci' ? info.career.saves : info.career.goals)}
                ${statBox('Asist', info.career.assists)}
                ${statBox('Kupa', (gameState.trophies || []).length)}
                ${statBox('Ayın Oyuncusu', ((gameState.player || {}).monthlyAwards || []).length)}
            </div>
            ${(gameState.trophies && gameState.trophies.length) ? `<div class="pp-trophies">${_groupTrophies(gameState.trophies)}</div>` : ''}` : ''}
            <div id="pp-history"></div>
            <div id="pp-transfers"></div>
        </div>
        <div class="pp-pane" data-pane="maclar" hidden><div id="pp-matches"></div></div>
        <div class="pp-pane" data-pane="gelisim" hidden><div id="pp-devcurve"></div></div>`;
    modal.style.display = 'flex';
    if (typeof bringModalToFront === 'function') bringModalToFront(modal);
    if (typeof _ppBindTabs === 'function') _ppBindTabs(body);
    // FM-tarzı etkileşimli mevki/rol/özellik (açılışta en verimli mevki + en iyi rol seçili → vurgu hazır)
    if (typeof _ppMountSkills === 'function') _ppMountSkills(body, info);
    // Geçmiş sezonlar + transfer geçmişi + gelişim eğrisi + maçlar (async doldur)
    if (typeof _fillProfileHistory === 'function') _fillProfileHistory(info);
    if (typeof _fillProfileTransfers === 'function') _fillProfileTransfers(info);
    if (typeof _fillProfileDevCurve === 'function') _fillProfileDevCurve(info);
    if (typeof _fillProfileMatches === 'function') _fillProfileMatches(info);

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
