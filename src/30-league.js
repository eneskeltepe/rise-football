// ============================================================================
//  30-league.js  —  Lig sistemi: fikstur, puan durumu, TUM DUNYA haftalik sim
//  Model: standings[ligId][takimId] TUM ligler icin saklanir.
//         Fikstur deterministik uretilir (saklanmaz); aktif ligin fiksturu
//         gameState.fixtures'ta tutulur (skor gosterimi icin).
// ============================================================================

const _fixtureCache = {};   // ligId -> [week][match]  (deterministik, persist edilmez)

// ---- Deterministik cift devreli fikstur (BAY ile) ----
function buildRoundRobin(teamIds) {
    let list = teamIds.slice();
    if (list.length % 2 !== 0) list.push('BAY');
    const n = list.length, half = [];
    for (let round = 0; round < n - 1; round++) {
        const matches = [];
        for (let i = 0; i < n / 2; i++) {
            const h = list[i], a = list[n - 1 - i];
            if (h === 'BAY' || a === 'BAY')
                matches.push({ home: h === 'BAY' ? a : h, away: 'BAY', scoreHome: null, scoreAway: null, isBay: true });
            else
                matches.push({ home: h, away: a, scoreHome: null, scoreAway: null, isBay: false });
        }
        half.push(matches);
        list = [list[0], list[n - 1], ...list.slice(1, n - 1)];
    }
    const second = half.map(rnd => rnd.map(m => m.isBay
        ? { home: m.home, away: 'BAY', scoreHome: null, scoreAway: null, isBay: true }
        : { home: m.away, away: m.home, scoreHome: null, scoreAway: null, isBay: false }));
    return [...half, ...second];
}

function leagueFixtures(leagueId) {
    if (_fixtureCache[leagueId]) return _fixtureCache[leagueId];
    const ids = DB.teamsInLeague(leagueId).map(t => t.id);
    const fx = ids.length ? buildRoundRobin(ids) : [];
    _fixtureCache[leagueId] = fx;
    return fx;
}
// Terfi/kume dusme sonrasi: kadrolar degisti, fiksturleri yeniden uret
function resetFixtureCache() { for (const k in _fixtureCache) delete _fixtureCache[k]; }

// ---- Puan durumu (ayrintili sema; mevcut UI ile uyumlu) ----
function blankRow(teamId) {
    return { id: teamId, played: 0, won: 0, drawn: 0, lost: 0,
             goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 };
}

function initAllStandings() {
    const st = {};
    for (const lg of DB.leagues()) {
        if (lg.type !== 'league') continue;     // kupalar Faz 7'de
        st[lg.id] = {};
        for (const t of DB.teamsInLeague(lg.id)) st[lg.id][t.id] = blankRow(t.id);
    }
    gameState.standings = st;
}

function recordResult(leagueId, home, away, sh, sa) {
    const tbl = gameState.standings[leagueId]; if (!tbl) return;
    const H = tbl[home], A = tbl[away]; if (!H || !A) return;
    H.played++; A.played++;
    H.goalsFor += sh; H.goalsAgainst += sa; A.goalsFor += sa; A.goalsAgainst += sh;
    H.goalDiff = H.goalsFor - H.goalsAgainst; A.goalDiff = A.goalsFor - A.goalsAgainst;
    if (sh > sa) { H.won++; A.lost++; H.points += 3; }
    else if (sh < sa) { A.won++; H.lost++; A.points += 3; }
    else { H.drawn++; A.drawn++; H.points++; A.points++; }
}

// Tek mac skoru (takim guc formulu — eski motorla uyumlu, RASTGELE)
// Kullanicinin kendi maci/atlanan maci icin; sonuc gameState.fixtures'a yazilip saklanir.
function simScore(homeId, awayId) {
    const h = DB.getTeam(homeId), a = DB.getTeam(awayId);
    const hp = (h ? h.power : 65) + 3, ap = (a ? a.power : 65);   // ev sahibi avantaji
    const diff = hp - ap;
    let hg = 0, ag = 0;
    const chances = 2 + Math.floor(Math.random() * 3);
    for (let c = 0; c < chances; c++) {
        if (Math.random() < 0.5 + diff / 120) { if (Math.random() < hp / 180) hg++; }
        else { if (Math.random() < ap / 180) ag++; }
    }
    return [hg, ag];
}

// ---- Deterministik dunya maci skoru ----
// Ayni (kariyer-tohumu, lig, sezon, hafta, ev, dep) icin HER ZAMAN ayni skor.
// Boylece puan durumu ile gosterilen skor birebir tutarli ve depolama gerekmez;
// eski fiksture tiklayinca maç detayi yeniden uretilebilir (E3/E4).
function _hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function _mulberry32(a) {
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function _detRng(key) { return _mulberry32(_hash32(key)); }

// Deterministik skor (dunya maclari icin simScore yerine kullanilir)
function detScore(homeId, awayId, leagueId, weekIdx) {
    const h = DB.getTeam(homeId), a = DB.getTeam(awayId);
    const hp = (h ? h.power : 65) + 3, ap = (a ? a.power : 65);
    const diff = hp - ap;
    const salt = (gameState.careerSalt != null ? gameState.careerSalt : 12345);
    const rng = _detRng(salt + '|' + leagueId + '|' + gameState.currentSeason + '|' + weekIdx + '|' + homeId + '|' + awayId);
    let hg = 0, ag = 0;
    const chances = 2 + Math.floor(rng() * 3);
    for (let c = 0; c < chances; c++) {
        if (rng() < 0.5 + diff / 120) { if (rng() < hp / 180) hg++; }
        else { if (rng() < ap / 180) ag++; }
    }
    return [hg, ag];
}
// Gecmis bir maci yeniden uret (UI: fikstur skoru + mac detayi). detScore ile ayni.
function worldMatchScore(leagueId, weekIdx, homeId, awayId) {
    return detScore(homeId, awayId, leagueId, weekIdx);
}

// Bir ligin verilen haftasini simule et. skipTeamId verilirse o takimin maci atlanir
// (oyuncunun maci 45-matchengine tarafindan ozel oynatilir) ve {home,away} olarak doner.
function simLeagueWeek(leagueId, weekIdx, skipTeamId) {
    const fx = leagueFixtures(leagueId);
    if (weekIdx < 0 || weekIdx >= fx.length) return null;
    let userMatch = null;
    for (const m of fx[weekIdx]) {
        if (m.isBay) continue;
        if (skipTeamId && (m.home === skipTeamId || m.away === skipTeamId)) { userMatch = m; continue; }
        const [sh, sa] = detScore(m.home, m.away, leagueId, weekIdx);   // deterministik -> UI ile birebir tutarli
        recordResult(leagueId, m.home, m.away, sh, sa);
    }
    return userMatch;
}

// TUM dunya: bu haftayi simule et (aktif ligde oyuncu maci HARIC)
function simulateWorldWeek(weekIdx, activeLeagueId, userTeamId) {
    for (const lg of DB.leagues()) {
        if (lg.type !== 'league') continue;
        const skip = (lg.id === activeLeagueId) ? userTeamId : null;
        simLeagueWeek(lg.id, weekIdx, skip);
    }
}

function standingsSorted(leagueId) {
    const tbl = gameState.standings[leagueId]; if (!tbl) return [];
    return Object.values(tbl).sort((a, b) =>
        b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);
}

function activeLeagueId() {
    const t = DB.getTeam(gameState.player && gameState.player.teamId);
    return t ? t.leagueId : (gameState.activeLeagueId || null);
}
function activeLeagueWeeks() {
    const lid = activeLeagueId();
    return lid ? leagueFixtures(lid).length : 38;
}

// gameState.fixtures = aktif ligin fiksturu (skor gosterimi icin)
function setActiveLeagueFixtures() {
    const lid = activeLeagueId();
    gameState.fixtures = lid ? leagueFixtures(lid).map(wk => wk.map(m => ({ ...m }))) : [];
    return gameState.fixtures;
}

// ============================================================================
//  FAZ 1b — Dünya haftasını DETAYLI (skor + olay dökümü) IndexedDB'ye yaz.
//  Mevcut simLeagueWeek/simulateWorldWeek (puan durumu) yoluna DOKUNMAZ; bu
//  AYRI bir kayıt geçişidir (fire-and-forget). Çok yavaşlarsa tek çağrı
//  kaldırılır → oyun aynen v1.0 gibi çalışır (geri-dönüş garantisi).
//  Skor WorldSim ile detScore PARİTESİNDE → standings ile birebir tutarlı.
//  Kullanıcının kendi maçı atlanır (endMatch ayrı yazar).
// ============================================================================
let _allLeaguesLoadedFor = null;   // tüm lig kadroları yüklendi mi (oturum-içi cache anahtarı)
async function _ensureAllLeagueSquads() {
    const key = gameState.careerSalt;
    if (_allLeaguesLoadedFor === key) return;
    const ids = DB.leagues().filter(l => l.type === 'league').map(l => l.id);
    await DB.ensureLeagues(ids);
    _allLeaguesLoadedFor = key;
}
async function recordWorldWeekDetails(slot, weekIdx, season, activeLg, userTeamId) {
    if (slot == null || typeof WorldDB === 'undefined' || typeof WorldSim === 'undefined') return;
    try {
        await _ensureAllLeagueSquads();   // dünya maçlarına oyuncu atfı için tüm kadrolar lazım
        const salt = (gameState.careerSalt != null) ? gameState.careerSalt : 12345;
        const recs = [];
        for (const lg of DB.leagues()) {
            if (lg.type !== 'league') continue;
            const fx = leagueFixtures(lg.id);
            if (weekIdx < 0 || weekIdx >= fx.length) continue;
            const skip = (lg.id === activeLg) ? userTeamId : null;
            for (const m of fx[weekIdx]) {
                if (m.isBay) continue;
                if (skip && (m.home === skip || m.away === skip)) continue;   // kullanıcı maçı: endMatch yazar
                const h = DB.getTeam(m.home), a = DB.getTeam(m.away);
                const res = WorldSim.simulateMatch({
                    homeId: m.home, awayId: m.away, leagueId: lg.id, weekIdx: weekIdx, season: season, salt: salt,
                    homePower: h ? h.power : 65, awayPower: a ? a.power : 65,
                    homeSquad: DB.squadSync(m.home), awaySquad: DB.squadSync(m.away)
                });
                recs.push({
                    slot: slot, id: season + ':' + lg.id + ':' + weekIdx + ':' + m.home + ':' + m.away,
                    season: season, week: weekIdx, leagueId: lg.id,
                    home: m.home, away: m.away, sh: res.sh, sa: res.sa, events: res.events,
                    homeXI: res.homeXI, homeSubs: res.homeSubs, awayXI: res.awayXI, awaySubs: res.awaySubs
                });
            }
        }
        await WorldDB.recordMatches(recs);
        await WorldDB.snapshotStandings(slot, season, gameState.standings);
    } catch (e) { /* IDB yoksa/başarısızsa oyun yine de çalışır (additive) */ }
}

// ---- Sezon sonu: dunya hafif evrilir (altyapi tesisi + tohumlu rastgelelik) ----
// DETERMINISTIK (careerSalt + sezon + takim tohumlu): ayni kariyer + ayni sezon icin
// her zaman ayni kayma. Boylece reload'da restoreWorldState gucleri AYNEN yeniden
// kurar -> detScore/puan durumu/fikstur gosterimi oturumlar arasi tutarli kalir.
// (Eski hali Math.random kullaniyordu ve kayda yazilmiyordu -> sezon 2+ reload'da
// gosterilen skorlar puan durumuyla celisebiliyordu.)
function evolveWorld(season) {
    const s = (season != null) ? season : ((typeof gameState !== 'undefined' && gameState && gameState.currentSeason) || 0);
    const salt = (typeof gameState !== 'undefined' && gameState && gameState.careerSalt != null) ? gameState.careerSalt : 12345;
    for (const t of DB.teams()) {
        const yf = (t.facilities && t.facilities.youth) || 55;
        const rng = _detRng(salt + '|evo|' + s + '|' + t.id);
        const drift = (yf - 62) * 0.04 + (rng() * 2 - 1);   // iyi altyapi -> yukseli
        t.power = Math.max(48, Math.min(92, Math.round((t.power + drift) * 10) / 10));
    }
}

// ============================================================================
//  DUNYA DURUMU KALICILIGI — terfi/kume dusme (t.leagueId) ve guc evrimi
//  (t.power) bellek-ici DB_TEAMS uzerinde yapilir; sayfa yenilenince kaybolurdu.
//  Cozum: (1) taban degerler modul yuklenirken yakalanir (_worldBase),
//  (2) kayit yuklenince resetWorldToBase + evolveWorld'u biten her sezon icin
//  deterministik TEKRAR OYNAT + gameState.teamLeagues overlay'ini (terfi/dusme
//  sonuclari; runPromotionRelegation yazar) uygula. Yeni kariyer baslarken de
//  resetWorldToBase cagrilir -> ayni oturumda slotlar arasi sizinti olmaz.
// ============================================================================
let _worldBase = null;   // teamId -> { leagueId, power } (sayfa yuklendigi andaki saf veri)
function captureWorldBase() {
    if (_worldBase) return;
    _worldBase = {};
    for (const t of DB.teams()) _worldBase[t.id] = { leagueId: t.leagueId, power: t.power };
}
function resetWorldToBase() {
    captureWorldBase();
    let changed = false;
    for (const t of DB.teams()) {
        const b = _worldBase[t.id]; if (!b) continue;
        if (t.leagueId !== b.leagueId) { t.leagueId = b.leagueId; changed = true; }
        if (t.power !== b.power) { t.power = b.power; changed = true; }
    }
    if (changed) { DB.invalidate(); resetFixtureCache(); }
    return changed;
}
// Kayit yuklenince dunyayi kayda gore yeniden kur (loadFromSlot/loadGame cagirir).
function restoreWorldState(gs) {
    gs = gs || ((typeof gameState !== 'undefined') ? gameState : null);
    resetWorldToBase();
    if (!gs || !gs.player) return;
    const start = (typeof START_SEASON !== 'undefined') ? START_SEASON : 2026;
    // Biten her sezonun guc evrimini deterministik tekrar oynat (zincir: taban -> bugun)
    for (let s = start; s < (gs.currentSeason || start); s++) evolveWorld(s);
    // Terfi/kume dusme sonuclari (kalici overlay; deterministik degil -> kayittan)
    const map = gs.teamLeagues || {};
    let moved = false;
    for (const id in map) {
        const t = DB.getTeam(id);
        if (t && map[id] && t.leagueId !== map[id]) { t.leagueId = map[id]; moved = true; }
    }
    if (moved) { DB.invalidate(); resetFixtureCache(); }
    // Lig gorunumu varsayilanlarini OVERLAY SONRASI lige esitle (_ensureGameStateFields
    // restore'dan ONCE kosar; terfi etmis takimda eski ligi gosterirdi).
    try {
        const ut = gs.player && DB.getTeam(gs.player.teamId);
        if (ut && ut.leagueId) {
            gs.viewStandingsLeague = ut.leagueId;
            if (gs.statsView) gs.statsView.league = ut.leagueId; else gs.statsView = { league: ut.leagueId, cat: 'g' };
        }
    } catch (e) { /* gorunum senkronu kritik degil */ }
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        buildRoundRobin, leagueFixtures, resetFixtureCache, initAllStandings, recordResult, simScore,
        detScore, worldMatchScore,
        simLeagueWeek, simulateWorldWeek, standingsSorted,
        activeLeagueId, activeLeagueWeeks, evolveWorld,
        captureWorldBase, resetWorldToBase, restoreWorldState,
        recordWorldWeekDetails,
    });
}

// Taban dunya degerlerini SAYFA YUKLENIRKEN yakala (henuz hicbir oyun kodu
// DB_TEAMS'i degistirmeden). restoreWorldState/resetWorldToBase buna dayanir.
try { captureWorldBase(); } catch (e) { /* DB hazir degilse ilk cagri lazy yakalar */ }
