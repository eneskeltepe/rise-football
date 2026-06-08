// ============================================================================
//  52-market.js  —  Transfer ekonomisi: kulüp bütçeleri, transfer pencereleri,
//  oyunun ürettiği serbest oyuncu havuzu, dünya transfer haberleri (al-sat),
//  yetersiz kadroları doldurma.
//  Not: tüm 16k oyuncunun kalıcı kulüp-değişimi yerine (performans/kayıt boyutu),
//  haberler + kulüp güç kaymaları + serbest oyuncu havuzu kullanılır. Tam kadro
//  mutasyonu ileride ayrı bir DB ile yapılabilir.
// ============================================================================

function _mRnd(lo, hi) { return lo + Math.random() * (hi - lo); }

// ---- Kulüp bütçesi ----
// Eski formül (başlangıç kasası tohumu + finans yoksa yedek). 53-finance VARSA gerçek kasadan türetilir.
function _clubBudgetFormula(t) {
    if (!t) return 0;
    const lg = DB.getLeague(t.leagueId) || { avgPower: 65 };
    const pres = t.prestige || 2;
    const base = Math.pow(2, ((t.power || 65) - 60) / 6) * 3000000;
    const presF = 0.5 + pres * 0.4;
    const lgF = 0.6 + ((lg.avgPower || 65) - 60) / 30;
    return Math.max(800000, Math.round(base * presF * lgF));
}
// Gerçek transfer bütçesi: finans modülü (53-finance) yüklüyse KALICI kasadan, yoksa formülden.
function clubBudget(t) {
    if (!t) return 0;
    if (typeof financeTransferBudget === 'function') return financeTransferBudget(t);
    return _clubBudgetFormula(t);
}

// ---- Transfer pencereleri (yaz: hafta 1-4, kış: sezon ortası ±1) ----
function transferWindowKind() {
    const wk = gameState.currentWeek;
    const tot = (typeof activeLeagueWeeks === 'function' ? activeLeagueWeeks() : 38) || 38;
    if (wk <= 4) return 'summer';
    const mid = Math.round(tot * 0.5);
    if (wk >= mid - 1 && wk <= mid + 1) return 'winter';
    return null;
}
function isTransferWindowOpen() { return !!transferWindowKind(); }

// ---- Oyunun ürettiği serbest oyuncular (FM tarzı) ----
const _FA_POS = ['Stoper', 'Sağ Bek', 'Sol Bek', 'DOS', 'Merkez OS', 'Ofansif OS', 'Sağ Kanat', 'Sol Kanat', 'Santrfor', 'Kaleci'];
const _FA_NATIONS = ['Türkiye', 'Brazil', 'Argentina', 'France', 'Spain', 'Germany', 'England', 'Portugal', 'Holland', 'Italy', 'Belgium', 'Croatia', 'Serbia', 'Senegal', 'Nigeria', 'Japan', 'Korea Republic', 'Mexico', 'United States', 'Colombia'];
const _FA_FIRST = ['Marco', 'Luis', 'Diego', 'Hugo', 'Yann', 'Leon', 'Mateo', 'Bruno', 'Nikola', '', 'Adama', 'Kenji', 'Pedro', 'Ivan', 'Omar', 'Felix', 'Noah', 'Carlos', 'Tariq', 'Andre'];
const _FA_LAST = ['Silva', 'Costa', 'Müller', 'Diallo', 'Kovač', 'Rossi', 'Nakamura', 'Hansen', 'Petrov', 'García', 'Mendoza', 'Okafor', 'Lefebvre', 'Bauer', 'Yilmaz', 'Santos', 'Novak', 'Haddad', 'Park', 'Johnson'];

function _genFreeAgent(i) {
    const pos = _FA_POS[Math.floor(Math.random() * _FA_POS.length)];
    const age = Math.floor(_mRnd(18, 35));
    // OVR dagilimi: cogunlukla 58-74, nadiren 75-81
    let ovr = Math.round(_mRnd(58, 74));
    if (Math.random() < 0.12) ovr = Math.round(_mRnd(75, 81));
    const nation = _FA_NATIONS[Math.floor(Math.random() * _FA_NATIONS.length)];
    const fn = _FA_FIRST[Math.floor(Math.random() * _FA_FIRST.length)];
    const ln = _FA_LAST[Math.floor(Math.random() * _FA_LAST.length)];
    const name = (fn ? fn + ' ' : '') + ln;
    return {
        id: 'fa_' + gameState.currentSeason + '_' + i + '_' + Math.floor(Math.random() * 99999),
        name, pos, position: pos, ovr, age, nation,
        value: calcMarketValue(ovr, age, 1), img: '', isFreeAgent: true,
    };
}
function generateFreeAgentPool(n) {
    n = n || 16;
    const pool = [];
    for (let i = 0; i < n; i++) pool.push(_genFreeAgent(i));
    pool.sort((a, b) => b.ovr - a.ovr);
    gameState.freeAgents = pool;
}

// ---- Dünya transfer haberleri (her pencerede) ----
function _loadedPlayersSample(maxFrom) {
    // yuklenmis liglerden orta-ust seviye oyunculardan ornek
    const out = [];
    const lids = Object.keys(window.DB && DB.isLoaded ? {} : {});
    // basit: aktif lig + son yuklenenler
    const leagues = DB.leagues().filter(l => l.type === 'league');
    for (const lg of leagues) {
        const teams = DB.teamsInLeague(lg.id);
        for (const t of teams) {
            const sq = DB.squadSync(t.id);
            for (const pl of sq) if ((pl.ovr || 0) >= 74) out.push({ pl, team: t });
            if (out.length > 400) return out;
        }
    }
    return out;
}

function generateTransferNews() {
    if (!gameState.clubSpend) gameState.clubSpend = {};
    const news = gameState.transferNews || [];
    const sample = _loadedPlayersSample();
    const richClubs = DB.teams().filter(t => clubBudget(t) > 25000000).sort((a, b) => clubBudget(b) - clubBudget(a)).slice(0, 60);
    const kind = transferWindowKind() || 'summer';
    const count = 4 + Math.floor(Math.random() * 5);
    let made = 0, tries = 0;
    while (made < count && tries++ < count * 6) {
        const useFA = sample.length < 5 || Math.random() < 0.3;
        let playerName, fromName, fromId, ovr, value;
        if (useFA && gameState.freeAgents && gameState.freeAgents.length) {
            const fa = gameState.freeAgents[Math.floor(Math.random() * gameState.freeAgents.length)];
            playerName = fa.name; fromName = 'Serbest'; fromId = null; ovr = fa.ovr; value = fa.value;
            // havuzdan cikar (imzalandi)
            gameState.freeAgents = gameState.freeAgents.filter(x => x.id !== fa.id);
        } else if (sample.length) {
            const s = sample[Math.floor(Math.random() * sample.length)];
            playerName = _shortName(s.pl.name); fromName = s.team.name; fromId = s.team.id;
            ovr = s.pl.ovr; value = calcMarketValue(s.pl.ovr, s.pl.age || 25, s.team.prestige || 3);
        } else continue;
        // alici: bonservisi karsilayan guclu kulup (kaynaktan farkli)
        const fee = fromName === 'Serbest' ? 0 : Math.round(value * (0.9 + Math.random() * 0.8) / 100000) * 100000;
        const buyers = richClubs.filter(t => t.id !== fromId && clubBudget(t) >= fee);
        if (!buyers.length) continue;
        const to = buyers[Math.floor(Math.random() * Math.min(buyers.length, 25))];
        news.unshift({ player: playerName, from: fromName, to: to.name, toId: to.id, fee, ovr, season: gameState.currentSeason, window: kind });
        // al-sat verisi (güç sezon ortasında DEĞİŞTİRİLMEZ: deterministik skorların
        // puan durumuyla tutarlılığını bozmasın; güç sezon sonu evolveWorld ile evrilir)
        gameState.clubSpend[to.id] = (gameState.clubSpend[to.id] || 0) + fee;
        if (fromId) gameState.clubSpend[fromId] = (gameState.clubSpend[fromId] || 0) - fee;
        made++;
    }
    gameState.transferNews = news.slice(0, 14);
    // Dunya transfer arsivi (kalici gecmis, sezon-pencere bazli, sinirli)
    if (!gameState.worldTransferLog) gameState.worldTransferLog = [];
    gameState.worldTransferLog = news.slice(0, made).concat(gameState.worldTransferLog).slice(0, 150);
}

// Pencere acildiginda bir kez calistir (advanceWeek'ten)
function maybeRunMarket() {
    const kind = transferWindowKind();
    const key = kind ? (gameState.currentSeason + '-' + kind) : null;
    if (!kind) return;
    if (gameState._lastMarketKey === key) return;
    gameState._lastMarketKey = key;
    if (!gameState.freeAgents || !gameState.freeAgents.length) generateFreeAgentPool(16);
    generateTransferNews();
}

// ---- Yetersiz kadrolu kulübe seviyeye uygun oyuncu doldur ----
function fillSquadIfNeeded(teamId) {
    const t = DB.getTeam(teamId); if (!t) return;
    const sq = DB.squadSync(teamId);
    if (sq.length >= 14) return;
    if (!gameState.genFillers) gameState.genFillers = {};
    if (gameState.genFillers[teamId]) return;   // bir kez
    const need = 16 - sq.length;
    const fillers = [];
    const lvl = t.power || 65;
    for (let i = 0; i < need; i++) {
        const pos = _FA_POS[Math.floor(Math.random() * _FA_POS.length)];
        const ovr = Math.max(45, Math.round(lvl - _mRnd(4, 14)));   // kadro seviyesine uygun (altinda)
        const age = Math.floor(_mRnd(18, 31));
        const ln = _FA_LAST[Math.floor(Math.random() * _FA_LAST.length)];
        fillers.push({ id: 'gen_' + teamId + '_' + i, name: ln, pos, position: pos, ovr, age, teamId, img: '', isGen: true });
    }
    gameState.genFillers[teamId] = fillers;
}

// ---- UI: transfer piyasası (haberler + serbest oyuncular + pencere) ----
function renderMarketUI() {
    const badge = document.getElementById('transfer-window-badge');
    const kind = transferWindowKind();
    if (badge) {
        if (kind === 'summer') { badge.textContent = '🟢 Yaz Transfer Dönemi Açık'; badge.style.color = 'var(--accent)'; }
        else if (kind === 'winter') { badge.textContent = '🟢 Kış Transfer Dönemi Açık'; badge.style.color = 'var(--accent)'; }
        else { badge.textContent = '🔴 Transfer Dönemi Kapalı'; badge.style.color = 'var(--text-muted)'; }
    }
    const newsList = document.getElementById('transfer-news-list');
    if (newsList) {
        const news = gameState.transferNews || [];
        newsList.innerHTML = news.length ? news.map(n => `
            <div class="market-news-row">
                <span class="mn-player">${n.player} <span class="mn-ovr">${n.ovr}</span></span>
                <span class="mn-move">${n.from} <i class="fa-solid fa-arrow-right"></i> ${getTeamLogoHtml(n.toId, 14)} ${n.to}</span>
                <span class="mn-fee">${n.fee ? formatMoney(n.fee) : 'Bonservissiz'}</span>
            </div>`).join('') : '<p style="color:var(--text-muted);font-size:.85rem;">Transfer dönemi geldiğinde haberler burada görünecek.</p>';
    }
    const faList = document.getElementById('free-agents-list');
    if (faList) {
        const fa = (gameState.freeAgents || []).slice(0, 10);
        faList.innerHTML = fa.length ? fa.map(f => `
            <div class="market-fa-row">
                <span class="mf-pos">${(POS_BY_KEY[f.pos] || {}).short || f.pos}</span>
                <span class="mf-name">${f.name}</span>
                <span class="mf-meta">${f.age}y • ${f.nation || ''}</span>
                <span class="mf-ovr">${f.ovr}</span>
            </div>`).join('') : '<p style="color:var(--text-muted);font-size:.85rem;">Havuz boş.</p>';
    }
}

// ============================================================================
//  FAZ 4b: DÜNYA AI TRANSFER PİYASASI (sezon geçişinde, kulüpler-arası, KALICI).
//  Heuristik + DETERMİNİSTİK (slot+sezon+oyuncu tohumlu → reload tutarlı). O(n):
//  fringe/sözleşmesi bitmek üzere oyuncular hedef güç-bandı kulübe taşınır. WorldDB
//  `transfers` store'una yazılır (WorldState overlay squadSync'te uygular) + oyuncunun
//  teamId/leagueId güncellenir. Dünya geneli CAP ile sınırlı (performans + gerçekçilik).
//  Fire-and-forget: hata olsa da oyun çalışır (additive).
// ============================================================================
function _pickTransferDestination(p, byPower, inC, rng) {
    const ovr = p.ovr || 60, lo = ovr - 8, hi = ovr + 7;
    for (let k = 0; k < 7; k++) {
        const t = byPower[Math.floor(rng() * byPower.length)];
        if (!t || t.id === p.teamId) continue;
        const tp = t.power || 60;
        if (tp < lo - 4 || tp > hi + 9) continue;     // benzer/biraz üst seviye kulüp
        if ((inC[t.id] || 0) >= 4) continue;          // kulüp başına en çok 4 alım
        return t;
    }
    return null;
}
function runWorldTransferMarket(slot, season) {
    if (slot == null || typeof WorldDB === 'undefined' || typeof DB === 'undefined' || typeof WorldSim === 'undefined')
        return Promise.resolve(0);
    const CAP = 900;   // dünya geneli yaz penceresi tavanı
    return WorldDB.getAllByIndex('players', 'bySlot', IDBKeyRange.only(slot)).then(players => {
        const active = (players || []).filter(p => !p.retired);
        if (!active.length) return 0;
        const teams = DB.teams().filter(t => t && t.id);
        const byPower = teams.slice().sort((a, b) => (a.power || 60) - (b.power || 60));
        const byTeam = {};
        for (const p of active) (byTeam[p.teamId] || (byTeam[p.teamId] = [])).push(p);
        const inC = {};
        const moves = [];   // {p, toTeam, toLeague}
        for (const teamId in byTeam) {
            const arr = byTeam[teamId].sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
            for (let idx = 0; idx < arr.length; idx++) {
                const p = arr[idx];
                let moveP = 0;
                if (idx >= 13) moveP += 0.18;                       // ilk 13 dışı (fringe → daha çok hareket)
                if ((p.contractYears || 2) <= 1) moveP += 0.12;     // sözleşme bitmek üzere
                if ((p.age || 24) >= 30) moveP += 0.04;
                if ((p.age || 24) <= 21 && (p.potential || 0) - (p.ovr || 0) >= 8) moveP += 0.06;  // genç yetenek üst kulübe
                // YILDIZLAR nadiren taşınır (sadakat/yüksek bonservis) → olasılığı güçlü sönümle
                if ((p.ovr || 60) >= 82) moveP *= 0.28;
                if ((p.ovr || 60) >= 88) moveP *= 0.30;
                if (moveP <= 0) continue;
                const rng = WorldSim._rngFor(slot + '|tr|' + season + '|' + p.id);
                if (rng() > moveP) continue;
                const dest = _pickTransferDestination(p, byPower, inC, rng);
                if (dest && dest.id !== p.teamId) { moves.push({ p, toTeam: dest.id, toLeague: dest.leagueId, moveP: moveP }); inC[dest.id] = (inC[dest.id] || 0) + 1; }
            }
        }
        // CAP: taşınma olasılığı YÜKSEK olanlar (fringe/sözleşme biten) öncelik → yıldız kayması bias'ı yok
        moves.sort((a, b) => b.moveP - a.moveP || (a.p.id - b.p.id));
        const applied = moves.slice(0, CAP);
        const changed = [], trecs = [];
        for (const m of applied) {
            const fromTeam = m.p.teamId, fromT = DB.getTeam(fromTeam), toT = DB.getTeam(m.toTeam);
            const rng = WorldSim._rngFor(slot + '|trc|' + season + '|' + m.p.id);
            m.p.teamId = m.toTeam;
            m.p.leagueId = m.toLeague || (toT && toT.leagueId) || m.p.leagueId;
            m.p.contractYears = 2 + Math.floor(rng() * 4);
            changed.push(m.p);
            trecs.push({
                slot: slot, season: season, playerId: m.p.id, name: m.p.name, pos: m.p.pos, ovr: m.p.ovr,
                fromTeam: fromTeam, fromName: fromT ? fromT.name : '', toTeam: m.toTeam, toName: toT ? toT.name : '',
                fee: m.p.value || 0, type: 'transfer'
            });
        }
        if (!changed.length) return 0;
        // chunk'lı yaz (büyük yazım UI'yi bloklamasın)
        const CH = 1000;
        function writePlayers(i) {
            const slice = changed.slice(i, i + CH);
            if (!slice.length) return Promise.resolve();
            return WorldDB.putAll('players', slice).then(() => new Promise(r => setTimeout(r, 0))).then(() => writePlayers(i + CH));
        }
        return writePlayers(0).then(() => WorldDB.putAll('transfers', trecs)).then(() => trecs.length);
    }).catch(() => 0);
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        clubBudget, _clubBudgetFormula, transferWindowKind, isTransferWindowOpen,
        generateFreeAgentPool, generateTransferNews, maybeRunMarket, fillSquadIfNeeded, renderMarketUI,
        runWorldTransferMarket,
    });
}
