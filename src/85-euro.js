// ============================================================================
//  85-euro.js  —  Oyuncunun OYNANABILIR kıtasal kupa kampanyası (2024+ İsviçre modeli).
//  Lig fazı: 36 takımlı TEK tablo (UCL/UEL 8 maç, UECL 6 maç). İlk 8 → Son 16;
//  9-24 → çift-ayaklı playoff; 25-36 elenir. Son16/Çeyrek/Yarı ÇİFT-AYAKLI, Final tek.
//  Diğer takımların sonuçları DETERMINISTIK (detScore, careerSalt tohumlu) üretilir →
//  tam standings + diğer sonuçlar depolama gerektirmeden tutarlı. Lig mantığına DOKUNMAZ.
// ============================================================================

const COMP_INFO = {
    ucl:  { name: 'Şampiyonlar Ligi', conf: 'UEFA', band: [0, 50], lp: 8 },
    uel:  { name: 'Avrupa Ligi', conf: 'UEFA', band: [40, 110], lp: 8 },
    uecl: { name: 'Konferans Ligi', conf: 'UEFA', band: [92, 200], lp: 6 },
    acl:  { name: 'AFC Şampiyonlar Ligi', conf: 'AFC', band: [0, 36], lp: 8 },
    lib:  { name: 'Copa Libertadores', conf: 'CONMEBOL', band: [0, 36], lp: 8 },
    sud:  { name: 'Copa Sudamericana', conf: 'CONMEBOL', band: [30, 90], lp: 6 },
};
const KO_AFTER = ['Son 16', 'Çeyrek Final', 'Yarı Final', 'Final'];

// ---- deterministik [0,1) (kariyer+sezon tohumlu; opp seçimi / penaltı kararları) ----
function _eHash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function _eRand01(str) { return (_eHash((gameState.careerSalt || 0) + '|' + gameState.currentSeason + '|' + str) % 100000) / 100000; }

// ---- Konfederasyon havuzu (güce göre sıralı) ----
function _confTeams(conf) {
    return DB.teams().filter(t => { const l = DB.getLeague(t.leagueId); return l && l.type === 'league' && l.confederation === conf; })
        .slice().sort((a, b) => b.power - a.power);
}

// ---- Pozisyon + konfederasyona göre hangi kupa? ----
function _pickComp(lg, pos) {
    const conf = lg.confederation;
    if (conf === 'UEFA') {
        if (lg.avgPower >= 76) { if (pos <= 4) return 'ucl'; if (pos === 5) return 'uel'; if (pos === 6) return 'uecl'; return null; }
        if (lg.avgPower >= 70) { if (pos === 1) return 'ucl'; if (pos === 2) return 'uel'; if (pos <= 4) return 'uecl'; return null; }
        if (pos === 1) return 'uel'; if (pos <= 3) return 'uecl'; return null;
    }
    if (conf === 'AFC') return pos <= 2 ? 'acl' : null;
    if (conf === 'CONMEBOL') { if (pos <= 4) return 'lib'; if (pos <= 8) return 'sud'; return null; }
    return null;
}

// ---- Önceki sezon sırası (yoksa güce göre) ----
function _teamPosition(team) {
    const prev = gameState._prevStandingPos && gameState._prevStandingPos[team.id];
    if (prev) return prev;
    const ranked = DB.teamsInLeague(team.leagueId).slice().sort((a, b) => b.power - a.power);
    const i = ranked.findIndex(t => t.id === team.id);
    return i >= 0 ? i + 1 : ranked.length;
}

// ---- Artan tamsayı hafta listesi [lo..hi] aralığında, count adet ----
function _spread(count, lo, hi) {
    if (count <= 1) return [Math.round((lo + hi) / 2)];
    const out = [];
    for (let i = 0; i < count; i++) out.push(Math.round(lo + (hi - lo) * i / (count - 1)));
    // artan ve benzersiz kalsın
    for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
    return out;
}

// ---- Daire (circle) yöntemiyle lig fazı fikstürü: her takım `rounds` farklı rakip ----
function _circleSchedule(ids, rounds) {
    const n = ids.length;            // çift olmalı
    const fixed = ids[0];
    let rot = ids.slice(1);
    const out = [];
    for (let r = 0; r < rounds; r++) {
        const row = [fixed].concat(rot);
        const md = [];
        for (let i = 0; i < n / 2; i++) {
            let home = row[i], away = row[n - 1 - i];
            if (r % 2 === 1) { const t = home; home = away; away = t; }   // ev/dep dengele
            md.push({ homeId: home, awayId: away });
        }
        out.push(md);
        rot.unshift(rot.pop());       // döndür
    }
    return out;
}

// ---- Kampanya kur ----
function _buildCampaign(compId, team, totalWeeks) {
    const info = COMP_INFO[compId];
    let band = _confTeams(info.conf).slice(info.band[0], info.band[1]).filter(t => t.id !== team.id);
    if (band.length < 24) band = _confTeams(info.conf).filter(t => t.id !== team.id);
    // 36 takım hedefi (havuz küçükse mevcutla; çift sayı şart)
    let others = band.slice(0, 35);
    let teamsArr = [team].concat(others).sort((a, b) => b.power - a.power);
    if (teamsArr.length % 2 === 1) teamsArr = teamsArr.slice(0, -1);
    if (teamsArr.findIndex(t => t.id === team.id) < 0) teamsArr[teamsArr.length - 1] = team;   // oyuncu mutlaka içeride
    const teams = teamsArr.map(t => t.id);
    const N = teams.length;
    const lpGames = Math.min(info.lp, N - 1);

    // Lig fazı haftaları + tam fikstür (daire). Oyuncuyu ilk sıraya alıp 'fixed' yap
    const ordered = [team.id].concat(teams.filter(id => id !== team.id));
    const schedule = _circleSchedule(ordered, lpGames);
    const lpWeeks = _spread(lpGames, 2, Math.max(lpGames + 1, Math.floor(totalWeeks * 0.52)));

    // Oyuncunun lig-fazı fikstürleri (her matchday'de bir maçı var)
    const myLp = schedule.map((md, m) => {
        const mm = md.find(x => x.homeId === team.id || x.awayId === team.id);
        const home = mm.homeId === team.id;
        return { md: m, week: lpWeeks[m], dayOffset: 2, oppId: home ? mm.awayId : mm.homeId, home, played: false, gf: 0, ga: 0 };
    });

    return {
        compId, compName: info.name, conf: info.conf, season: gameState.currentSeason, _team: team.id,
        format: 'swiss', teams, lpGames, lpWeeks, schedule, myLp,
        lpDone: false, myRank: null,
        phase: 'league', ko: [], koIndex: 0,
        eliminated: false, eliminatedRound: null, champion: false, championTeamId: null, championName: null, done: false,
        goals: 0, assists: 0, matches: 0, _current: null, _lastGains: null,
        _totalWeeks: totalWeeks,
    };
}

// ---- Kota belirle + kampanya kur ----
function qualifyPlayerEuro() {
    const p = gameState.player;
    if (!p || !p.teamId) { gameState.euro = null; return; }
    const team = DB.getTeam(p.teamId);
    const lg = team && DB.getLeague(team.leagueId);
    if (!team || !lg || lg.type !== 'league') { gameState.euro = null; return; }
    const compId = _pickComp(lg, _teamPosition(team));
    if (!compId) { gameState.euro = null; return; }
    gameState.euro = _buildCampaign(compId, team, activeLeagueWeeks() || 34);
}

function captureFinalPositions() {
    const m = {};
    for (const lg of DB.leagues()) {
        if (lg.type !== 'league') continue;
        standingsSorted(lg.id).forEach((r, i) => { m[r.id] = i + 1; });
    }
    gameState._prevStandingPos = m;
}

function ensureEuroForCurrentTeam() {
    const p = gameState.player;
    if (!p) return;
    const e = gameState.euro;
    const tid = p.teamId || null;
    if (!tid) { if (e) gameState.euro = null; return; }
    if (e && e._team === tid && e.season === gameState.currentSeason && e.format === 'swiss') return;
    qualifyPlayerEuro();
}

// ============================================================================
//  Lig fazı standings (deterministik; oynanan matchday'leri sayar)
// ============================================================================
function _lpStandings(e, forceAll) {
    const T = {}; e.teams.forEach(id => { T[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }; });
    for (let md = 0; md < e.lpGames; md++) {
        const week = e.lpWeeks[md];
        const weekDone = forceAll || week <= (gameState.currentWeek || 0) || e.lpDone;
        e.schedule[md].forEach(mtch => {
            const isPlayer = (mtch.homeId === e._team || mtch.awayId === e._team);
            let sh, sa;
            if (isPlayer) {
                const fx = e.myLp[md];
                if (fx && fx.played) { sh = mtch.homeId === e._team ? fx.gf : fx.ga; sa = mtch.homeId === e._team ? fx.ga : fx.gf; }
                else if (weekDone) { const r = detScore(mtch.homeId, mtch.awayId, e.compId, md); sh = r[0]; sa = r[1]; }
                else return;
            } else {
                if (!weekDone) return;
                const r = detScore(mtch.homeId, mtch.awayId, e.compId, md); sh = r[0]; sa = r[1];
            }
            const H = T[mtch.homeId], A = T[mtch.awayId]; if (!H || !A) return;
            H.p++; A.p++; H.gf += sh; H.ga += sa; A.gf += sa; A.ga += sh;
            if (sh > sa) { H.w++; A.l++; H.pts += 3; } else if (sh < sa) { A.w++; H.l++; A.pts += 3; } else { H.d++; A.d++; H.pts++; A.pts++; }
        });
    }
    Object.values(T).forEach(r => r.gd = r.gf - r.ga);
    return Object.values(T).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || (DB.getTeam(b.id).power - DB.getTeam(a.id).power));
}

function _myLpRank(e) {
    const s = _lpStandings(e, true);
    const i = s.findIndex(r => r.id === e._team);
    return i >= 0 ? i + 1 : e.teams.length;
}

// ---- Eleme rakibi seç (deterministik; tur ilerledikçe güçlü) ----
function _pickKoOpp(e, faced, roundIdx) {
    const pool = e.teams.filter(id => id !== e._team && !faced.has(id));
    if (!pool.length) return e.teams.find(id => id !== e._team);
    const sorted = pool.slice().sort((x, y) => ((DB.getTeam(y) || {}).power || 0) - ((DB.getTeam(x) || {}).power || 0));
    const frac = Math.min(0.9, 0.2 + roundIdx * 0.18);             // tur ↑ → güçlü uç
    let idx = Math.floor((1 - frac) * (sorted.length - 1));
    idx = Math.max(0, idx - Math.floor(_eRand01(e.compId + '|ko|' + roundIdx + '|' + e.koIndex) * 3));
    return sorted[idx] || sorted[0];   // e.teams ID dizisi → doğrudan ID döndür
}

// ---- Lig fazı bitti → eleme kur ----
function _setupKnockout(e) {
    e.lpDone = true;
    const rank = _myLpRank(e); e.myRank = rank;
    if (rank >= 25) { e.eliminated = true; e.eliminatedRound = 'Lig Fazı'; e.phase = 'done'; _finalize(e); return; }
    const rounds = [];
    if (rank >= 9) rounds.push('Playoff Turu');     // 9-24 → çift-ayaklı playoff
    KO_AFTER.forEach(r => rounds.push(r));          // Son 16 → Final
    const seededTop = rank <= 8;                     // ilk 8: avantajlı eşleşme (rövanş evde)
    // KO leg sayısı: final tek, diğerleri çift
    const legCount = rounds.reduce((s, r) => s + (r === 'Final' ? 1 : 2), 0);
    const koWeeks = _spread(legCount, Math.max((e.lpWeeks[e.lpGames - 1] || 18) + 1, Math.floor(e._totalWeeks * 0.56)), e._totalWeeks);
    let wi = 0;
    const faced = new Set(e.myLp.map(f => f.oppId));
    e.ko = rounds.map((rd, i) => {
        const single = rd === 'Final';
        const oppId = _pickKoOpp(e, faced, i); faced.add(oppId);
        let legs;
        if (single) legs = [{ leg: 0, oppId, week: koWeeks[wi++], dayOffset: 3, home: true, neutral: true, played: false, gf: 0, ga: 0 }];
        else legs = [
            { leg: 1, oppId, week: koWeeks[wi++], dayOffset: 3, home: !seededTop, played: false, gf: 0, ga: 0 },
            { leg: 2, oppId, week: koWeeks[wi++], dayOffset: 3, home: seededTop, played: false, gf: 0, ga: 0 },
        ];
        return { round: rd, oppId, single, legs, decided: false, won: false, aggGf: 0, aggGa: 0, pen: false };
    });
    e.koIndex = 0;
    e.phase = (rank >= 9) ? 'playoff' : 'r16';
}

// ---- Bu hafta oynanacak oyuncu kupa maçı (lig fazı veya eleme bacağı) var mı? ----
function euroFixtureDueThisWeek() {
    const e = gameState.euro;
    if (!e || e.done || e.eliminated) return null;
    if (!e.lpDone) {
        const g = e.myLp.find(f => !f.played);
        if (g) return g.week <= gameState.currentWeek ? { phase: 'lp', fx: g } : null;
        return null;   // lig fazı bitti ama henüz KO kurulmadı (endEuroMatch kurar)
    }
    const rd = e.ko[e.koIndex];
    if (!rd || rd.decided) return null;
    const leg = rd.legs.find(l => !l.played);
    if (leg) return leg.week <= gameState.currentWeek ? { phase: 'ko', fx: leg, round: rd } : null;
    return null;
}

// ---- Maçı başlat (canlı) ----
function startEuroMatch() {
    const due = euroFixtureDueThisWeek();
    if (!due) return;
    const p = gameState.player;
    if (p.injury) { showToast(`Sakatsın (${p.injury.name}) — bu kupa maçında forma giyemezsin; takımın oynar, sana reyting/değerlendirme YOK.`, 'warning'); simEuroMatch(due.fx, due.phase, due.round, false, true); return; }
    const roundLabel = due.phase === 'lp' ? `Lig Fazı ${due.fx.md + 1}. Maç` : (due.round.single ? 'Final' : `${due.round.round} ${due.fx.leg}. Maç`);
    gameState.euro._current = { phase: due.phase, fx: due.fx, round: due.round || null, roundLabel };
    window._euroMatchCtx = { oppId: due.fx.oppId, isHome: !!due.fx.home, round: roundLabel };
    // Rakip GERÇEK oyuncularıyla gelsin: rakibin ligini (ve terfi/kaynak ligini) önce yükle,
    // yoksa squadSync boş döner ve fillSquadIfNeeded rastgele dolgu oyuncu üretir.
    const oppTeam = DB.getTeam(due.fx.oppId) || {};
    const oppLeagues = [String(due.fx.oppId).split('__')[0]];
    if (oppTeam.srcLeague) oppLeagues.push(oppTeam.srcLeague);
    const _go = () => startMatchDay();
    if (typeof DB.loadPlayers === 'function') {
        Promise.all(oppLeagues.map(l => DB.loadPlayers(l).catch(() => {}))).then(_go);
    } else { _go(); }
}

// ---- Oyuncunun canlı maç sonucu ----
function endEuroMatch() {
    const e = gameState.euro;
    const cur = e && e._current;
    if (!cur) { saveGame(); return; }
    const myScore = activeMatch.isHome ? activeMatch.scoreHome : activeMatch.scoreAway;
    const oppScore = activeMatch.isHome ? activeMatch.scoreAway : activeMatch.scoreHome;
    const ps = activeMatch.playerStats;
    addCommentary(90, 'Hakem son düdüğü çalıyor! Kupa maçı sona erdi.', 'info');
    _applyPlayerCupOutcome(ps);
    _recordCupMatchLog(cur, myScore, oppScore, ps);
    _recordEuro(cur, myScore, oppScore);
    _showCupSummary(myScore, oppScore, ps, cur.roundLabel);
    e._current = null;
    saveGame();
}

// ---- Hızlı simülasyon ----
// quiet=true: hafta ilerlerken otomatik simüle edilen (oyuncunun atladığı) maçlar → haber akışına yaz.
// quiet=false (varsayılan): oyuncu BİZZAT simüle etti → normal maç gibi maç-sonu özet modalını göster.
function simEuroMatch(fx, phase, round, quiet, didNotPlay) {
    const e = gameState.euro;
    const team = DB.getTeam(e._team), opp = DB.getTeam(fx.oppId);
    const sc = simScore(fx.home ? team.id : opp.id, fx.home ? opp.id : team.id);
    const myScore = fx.home ? sc[0] : sc[1], oppScore = fx.home ? sc[1] : sc[0];
    let ps;
    if (didNotPlay) {
        // Sakat / oynamadı: takım oynar ama oyuncuya reyting/gol/güven YAZILMAZ (yalnız dinlenme).
        ps = { goals: 0, assists: 0, saves: 0, rating: 0, didNotPlay: true };
    } else {
        ps = { goals: 0, assists: 0, saves: 0, rating: +(6.0 + Math.random() * 1.4).toFixed(1) };
        if (gameState.player.position !== 'Kaleci' && Math.random() < 0.35) { ps.goals = 1; ps.rating = Math.min(10, ps.rating + 0.8); }
    }
    const cur = { phase, fx, round: round || null, roundLabel: phase === 'lp' ? 'Lig Fazı' : (round && round.single ? 'Final' : (round ? round.round : 'Eleme')) };
    _applyPlayerCupOutcome(ps, true);
    _recordCupMatchLog(cur, myScore, oppScore, ps, team, opp);
    _recordEuro(cur, myScore, oppScore);
    if (quiet) {
        // Otomatik (atlanan) maç: sağ-üst toast ile kısa sonuç bildirimi
        showToast(`${e.compName}: ${team.name} ${myScore}-${oppScore} ${opp.name}`, myScore > oppScore ? 'success' : (myScore < oppScore ? 'error' : 'info'));
    } else {
        // Oyuncu bizzat simüle etti (veya sakat): normal maç gibi maç-sonu özet ekranını göster
        activeMatch.myTeam = team; activeMatch.oppTeam = opp; activeMatch.isHome = !!fx.home;
        activeMatch.scoreHome = fx.home ? myScore : oppScore;
        activeMatch.scoreAway = fx.home ? oppScore : myScore;
        activeMatch.playerStats = ps;
        // Simüle edilen kupa maçında CANLI maç ekranı yok → "İncele" maç detayını açsın (donma fix'i).
        activeMatch._cupNoLive = true;
        activeMatch._cupDetail = {
            home: fx.home ? team.id : opp.id, away: fx.home ? opp.id : team.id,
            sh: activeMatch.scoreHome, sa: activeMatch.scoreAway, seedKey: cur.roundLabel + '|' + e.season,
        };
        _showCupSummary(myScore, oppScore, ps, cur.roundLabel);
    }
    saveGame();
}

function _applyPlayerCupOutcome(ps, quiet) {
    const p = gameState.player, e = gameState.euro;
    if (ps && ps.didNotPlay) {
        // Oynamadı (sakat/kadro dışı): yalnız hafif dinlenme. Reyting/güven/değer/istatistik İŞLENMEZ.
        p.energy = Math.min(100, p.energy + 12);
        e._lastGains = { trust: 0, fan: 0, didNotPlay: true };
        return;
    }
    p.energy = Math.max(5, p.energy - (quiet ? 22 : 30));
    const r = ps.rating || 6.0;
    if (r >= 7.5) p.form = Math.min(100, p.form + 4); else if (r < 6.0) p.form = Math.max(40, p.form - 3);
    let trustGained, fanGained;
    if (r >= 8.0) { trustGained = 6; fanGained = 8; }
    else if (r >= 7.0) { trustGained = 3; fanGained = 4; }
    else if (r >= 6.0) { trustGained = 1; fanGained = 1; }
    else { trustGained = -3; fanGained = -2; }
    if ((ps.goals || 0) > 0 || (ps.assists || 0) > 0) {
        trustGained = Math.max(trustGained, (ps.goals || 0) * 2 + (ps.assists || 0));
        fanGained = Math.max(fanGained, (ps.goals || 0) * 3 + (ps.assists || 0) * 2);
    }
    p.managerTrust = Math.max(10, Math.min(100, p.managerTrust + trustGained));
    p.fansLove = Math.max(10, Math.min(100, p.fansLove + fanGained));
    e._lastGains = { trust: trustGained, fan: fanGained };
    // FM-tarzı: kupa maçları KARİYER toplamına + sezon/kariyer KUPA kırılımına işlenir (çift sayım yok:
    // kariyer toplamı burada artar; sezon devri yalnız LİG alanlarını ekler, .cup'a dokunmaz).
    const _isSub = (typeof activeMatch !== 'undefined' && activeMatch && activeMatch.startedXI === false);
    p.careerStats.matches += 1; p.careerStats.goals += ps.goals || 0; p.careerStats.assists += ps.assists || 0;
    p.careerStats.saves += ps.saves || 0; p.careerStats.ratings.push(r);
    if (_isSub) p.careerStats.subApps = (p.careerStats.subApps || 0) + 1; else p.careerStats.starts = (p.careerStats.starts || 0) + 1;
    const _accCup = (o) => {
        if (!o.cup) o.cup = { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, motm: 0 };
        o.cup.matches += 1; if (_isSub) o.cup.subApps += 1; else o.cup.starts += 1;
        o.cup.goals += ps.goals || 0; o.cup.assists += ps.assists || 0; if (r >= 8.0) o.cup.motm += 1;
    };
    if (p.currentSeasonStats) _accCup(p.currentSeasonStats);
    _accCup(p.careerStats);
    e.matches += 1; e.goals += ps.goals || 0; e.assists += ps.assists || 0;
    p.value = Math.max(300000, Math.round(p.value + ((r - 6.5) * 40000) + ((ps.goals || 0) * 70000)));
}

// Kupa maçını kullanıcı maç geçmişine ekle (kariyer geçmişinde görünür)
function _recordCupMatchLog(cur, myScore, oppScore, ps, team, opp) {
    const e = gameState.euro;
    const tId = e._team, oId = cur.fx.oppId;
    const home = !!cur.fx.home;
    const mm = {
        home: home ? tId : oId, away: home ? oId : tId,
        scoreHome: home ? myScore : oppScore, scoreAway: home ? oppScore : myScore,
    };
    if (ps && ps.didNotPlay) {
        // Oynamadı: maçı geçmişe ekle (detayı görülebilsin) ama reyting/gol YAZMA (dnp işaretli).
        const p = gameState.player;
        if (p) {
            if (!p.matchLog) p.matchLog = [];
            p.matchLog.push({
                season: gameState.currentSeason, week: gameState.currentWeek, leagueId: null, comp: e.compName,
                home: mm.home, away: mm.away, sh: mm.scoreHome, sa: mm.scoreAway,
                rating: null, g: 0, a: 0, motm: 0, dnp: 1,
            });
            if (p.matchLog.length > 240) p.matchLog = p.matchLog.slice(-240);
        }
        return;
    }
    if (typeof recordRealMatch !== 'function') return;
    recordRealMatch(mm, ps.rating, ps.goals, ps.assists, (ps.rating || 0) >= 8.0, e.compName);
}

// ---- Sonucu kampanyaya işle + ilerleme ----
function _recordEuro(cur, myScore, oppScore) {
    const e = gameState.euro;
    const fx = cur.fx;
    fx.played = true; fx.gf = myScore; fx.ga = oppScore;
    if (cur.phase === 'lp') {
        if (e.myLp.every(f => f.played)) _setupKnockout(e);
        return;
    }
    // eleme: bacak kaydedildi → tur kararını dene
    const rd = cur.round || e.ko[e.koIndex];
    if (!rd) return;
    if (rd.single) {
        const won = myScore > oppScore || (myScore === oppScore && _eRand01(e.compId + '|final|' + e.season) < _playerWinProb(rd.oppId));
        rd.decided = true; rd.won = won; rd.pen = (myScore === oppScore);
        rd.aggGf = myScore; rd.aggGa = oppScore;
        _advanceKo(e, rd, won);
        return;
    }
    if (rd.legs.every(l => l.played)) {
        rd.aggGf = rd.legs.reduce((s, l) => s + l.gf, 0);
        rd.aggGa = rd.legs.reduce((s, l) => s + l.ga, 0);
        let won;
        if (rd.aggGf > rd.aggGa) won = true;
        else if (rd.aggGf < rd.aggGa) won = false;
        else { rd.pen = true; won = _eRand01(e.compId + '|pen|' + rd.round + '|' + e.season) < _playerWinProb(rd.oppId); }   // uzatma→penaltı
        rd.decided = true; rd.won = won;
        _advanceKo(e, rd, won);
    }
}

function _playerWinProb(oppId) {
    const pp = (DB.getTeam(gameState.euro._team) || {}).power || 70;
    const op = (DB.getTeam(oppId) || {}).power || 70;
    return Math.max(0.2, Math.min(0.8, 0.5 + (pp - op) / 200));
}

function _advanceKo(e, rd, won) {
    if (!won) { e.eliminated = true; e.eliminatedRound = rd.round; e.phase = 'done'; _finalize(e); return; }
    if (rd.round === 'Final') { e.champion = true; e.phase = 'done'; _finalize(e); return; }
    e.koIndex += 1;
    const next = e.ko[e.koIndex];
    e.phase = next ? (next.round === 'Son 16' ? 'r16' : next.round === 'Çeyrek Final' ? 'qf' : next.round === 'Yarı Final' ? 'sf' : 'final') : 'done';
    setTimeout(() => { try { showToast(`${e.compName}: ${rd.round} turunu geçtin!`, 'success'); } catch (x) {} }, 500);
}

// ---- Kampanya bitti ----
function _finalize(e) {
    e.done = true;
    if (e.champion) {
        e.championTeamId = e._team; e.championName = (DB.getTeam(e._team) || {}).name;
        gameState.trophies.push({ season: e.season, title: e.compName + ' Şampiyonluğu' });
        setTimeout(() => { try { showToast(`🏆 ${e.compName} ŞAMPİYONU oldun! Tarihe geçtin!`, 'success'); } catch (x) {} }, 800);
    } else {
        // dünya şampiyonu: lig fazı tablosunun en güçlülerinden ağırlıklı
        const top = _lpStandings(e, true).slice(0, 8).map(r => r.id).filter(id => id !== e._team);
        const champ = top[Math.floor(Math.pow(_eRand01(e.compId + '|wc|' + e.season), 2) * top.length)] || top[0];
        if (champ) { e.championTeamId = champ; e.championName = (DB.getTeam(champ) || {}).name; }
    }
}

// ---- Gecikmiş (oynanmamış) oyuncu kupa maçlarını otomatik simüle et ----
function autoSimDueEuro(uptoWeek) {
    const e = gameState.euro;
    if (!e) return;
    let guard = 0;
    while (guard++ < 20) {
        if (e.done || e.eliminated) return;
        if (!e.lpDone) {
            const g = e.myLp.find(f => !f.played);
            if (g) { if (g.week < uptoWeek) { simEuroMatch(g, 'lp', null, true); continue; } else return; }
            _setupKnockout(e); continue;   // lig fazı doldu ama KO kurulmamış
        }
        const rd = e.ko[e.koIndex];
        if (!rd || rd.decided) return;
        const leg = rd.legs.find(l => !l.played);
        if (leg) { if (leg.week < uptoWeek) { simEuroMatch(leg, 'ko', rd, true); continue; } else return; }
        return;
    }
}

// ============================================================================
//  UI
// ============================================================================
function _cupMatchDayLabel(due) {
    if (due.phase === 'lp') return `Lig Fazı — ${due.fx.md + 1}. Maç`;
    if (due.round.single) return 'Final';
    return `${due.round.round} — ${due.fx.leg}. Maç`;
}

// ---- Maç sonu özet (kupa) ----
function _showCupSummary(myScore, oppScore, ps, roundLabel) {
    const e = gameState.euro;
    const team = DB.getTeam(e._team) || { name: 'Takımın' };
    const opp = activeMatch.oppTeam || {};
    const box = document.getElementById('match-summary-box');
    const sScore = document.getElementById('summary-final-score');
    const sPerf = document.getElementById('summary-player-performance');
    const sGains = document.getElementById('summary-gains');
    const homeName = activeMatch.isHome ? team.name : opp.name;
    const awayName = activeMatch.isHome ? opp.name : team.name;
    if (sScore) sScore.textContent = `${homeName} ${activeMatch.scoreHome} - ${activeMatch.scoreAway} ${awayName}`;
    if (ps && ps.didNotPlay) {
        // Sakat/oynamadı: reyting GÖSTERME, güven/taraftar kazanımı YOK (saçma "6.2 reyting" bug fix'i).
        if (sPerf) sPerf.textContent = `${e.compName} • ${roundLabel} — Sakat olduğun için bu maçta forma giyemedin. (Reyting/değerlendirme yok)`;
        if (sGains) sGains.innerHTML = `<span class="text-muted"><i class="fa-solid fa-briefcase-medical"></i> Sakatlık — maç değerlendirilmedi</span>`;
        if (box) box.style.display = 'flex';
        return;
    }
    const rt = (ps.rating || 6).toFixed(1);
    let msg = `${e.compName} • ${roundLabel} — ${rt} reyting.`;
    if ((ps.goals || 0) > 0 || (ps.assists || 0) > 0) msg = `${e.compName} • ${roundLabel} — ${ps.goals} gol, ${ps.assists} asist, ${rt} reyting!`;
    if (sPerf) sPerf.textContent = msg;
    const gains = e._lastGains || { trust: 0, fan: 0 };
    if (sGains) sGains.innerHTML = `
        <span class="text-info"><i class="fa-solid fa-trophy"></i> ${e.compName}</span>
        <span class="${gains.trust >= 0 ? 'text-success' : 'text-danger'}"><i class="fa-solid ${gains.trust >= 0 ? 'fa-plus' : 'fa-minus'}"></i> ${Math.abs(gains.trust)} Hoca</span>
        <span class="${gains.fan >= 0 ? 'text-success' : 'text-danger'}"><i class="fa-solid ${gains.fan >= 0 ? 'fa-plus' : 'fa-minus'}"></i> ${Math.abs(gains.fan)} Taraftar</span>`;
    if (box) box.style.display = 'flex';
}

// ---- Dashboard istemi (BİLGİ banner'ı — ayrı "kupa maçına çık" butonu YOK;
//      maça çıkma/simüle etme normal maç günü akışıyla aynı "Sıradaki Aktivite" kartından) ----
function renderEuroPrompt() {
    const host = document.getElementById('euro-match-prompt');
    if (!host) return;
    const e = gameState.euro;
    const due = e && euroFixtureDueThisWeek();
    if (!e || !due) { host.style.display = 'none'; host.innerHTML = ''; return; }
    // Bugün zaten kupa maç günüyse: "Sıradaki Aktivite" kartı işi görüyor → banner'ı gizle (tekrar olmasın)
    const today = (typeof matchToday === 'function') ? matchToday() : null;
    if (today && today.kind === 'cup') { host.style.display = 'none'; host.innerHTML = ''; return; }
    const opp = DB.getTeam(due.fx.oppId) || { name: '?' };
    host.style.display = 'block';
    host.innerHTML = `
        <div class="euro-prompt-inner">
            <div class="euro-prompt-head"><i class="fa-solid fa-trophy"></i> ${e.compName} — ${_cupMatchDayLabel(due)}</div>
            <div class="euro-prompt-opp">${getTeamLogoHtml(due.fx.oppId, 22)} <span>${opp.name}</span> <span class="euro-ha">${due.fx.neutral ? '(Nötr)' : (due.fx.home ? '(Ev)' : '(Dep)')}</span></div>
            <div class="euro-prompt-note">Bu hafta kupa maçın var. Maç gününe geldiğinde "İlerle" butonu "Maça Çık!"a dönüşür.</div>
        </div>`;
}

// ---- Kupalar sekmesi: standings + oyuncu fikstürleri + eleme ----
function renderEuroCampaign() {
    const card = document.getElementById('euro-campaign-card');
    if (!card) return;
    const e = gameState.euro;
    // FAZ B: euro kartı "Lig & Fikstür" hub'ının içinde; YALNIZ dropdown'dan KULLANICININ turnuvası seçilince görünür.
    if (!e || !window._hubShowCup || (window._hubSelectedComp && window._hubSelectedComp !== e.compId)) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const teamName = (DB.getTeam(e._team) || {}).name || 'Takımın';

    // Durum
    let status;
    if (e.champion) status = `<span class="euro-champ"><i class="fa-solid fa-trophy"></i> ŞAMPİYON!</span>`;
    else if (e.eliminated) status = `<span class="euro-out">Elendin: ${e.eliminatedRound}</span>`;
    else if (e.lpDone) status = `<span class="euro-live">Eleme turları • ${e.myRank}. sıradan</span>`;
    else status = `<span class="euro-live">Lig fazı • ${e.myLp.filter(f => f.played).length}/${e.lpGames} maç</span>`;

    // Standings (36)
    const st = _lpStandings(e);
    const cut = (i) => i < 8 ? 'q-top' : i < 24 ? 'q-po' : 'q-out';
    const rows = st.map((r, i) => `
        <tr class="${r.id === e._team ? 'euro-me' : ''} ${cut(i)}">
            <td>${i + 1}</td>
            <td class="euro-st-team">${getTeamLogoHtml(r.id, 16)} <span>${(DB.getTeam(r.id) || {}).name || '?'}</span></td>
            <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><strong>${r.pts}</strong></td>
        </tr>`).join('');
    const standingsHtml = `
        <div class="euro-standings-wrap">
            <table class="euro-standings">
                <thead><tr><th>#</th><th>Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th>AV</th><th>P</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="euro-legend"><span class="lg q-top"></span> İlk 8 → Son 16 &nbsp; <span class="lg q-po"></span> 9-24 → Playoff &nbsp; <span class="lg q-out"></span> Elenir</div>
        </div>`;

    // Oyuncu lig-fazı fikstürleri
    const lpFix = e.myLp.map((f, i) => `
        <div class="euro-fix-row ${f.played ? (f.gf > f.ga ? 'win' : f.gf < f.ga ? 'loss' : 'draw') : 'pending'}">
            <span class="euro-fix-rd">M${i + 1}${f.home ? ' (E)' : ' (D)'}</span>
            <span class="euro-fix-opp">${getTeamLogoHtml(f.oppId, 16)} ${(DB.getTeam(f.oppId) || {}).name || '?'}</span>
            <span class="euro-fix-res">${f.played ? `${f.gf}-${f.ga}` : `Hf ${f.week}`}</span>
        </div>`).join('');

    // Eleme turları (çift-ayaklı)
    let koHtml = '';
    if (e.lpDone && e.ko.length) {
        koHtml = e.ko.map(rd => {
            const legs = rd.legs.map(l => l.played ? `${l.gf}-${l.ga}` : `Hf ${l.week}`).join(' / ');
            let res = legs;
            if (rd.decided) res = `${rd.single ? '' : 'Toplam ' + rd.aggGf + '-' + rd.aggGa + ' • '}${rd.won ? 'Geçti' : 'Elendi'}${rd.pen ? ' (pen)' : ''}`;
            return `<div class="euro-fix-row ${rd.decided ? (rd.won ? 'win' : 'loss') : 'pending'}">
                <span class="euro-fix-rd">${rd.round}</span>
                <span class="euro-fix-opp">${getTeamLogoHtml(rd.oppId, 16)} ${(DB.getTeam(rd.oppId) || {}).name || '?'}</span>
                <span class="euro-fix-res">${res}</span></div>`;
        }).join('');
    }

    let champLine = '';
    if (e.done && e.championName && !e.champion) champLine = `<div class="euro-world-champ"><i class="fa-solid fa-trophy" style="color:#ffca28"></i> Kupayı kazanan: <strong>${e.championName}</strong></div>`;

    card.innerHTML = `
        <div class="card-header"><h3><i class="fa-solid fa-earth-europe"></i> ${e.compName}</h3>${status}</div>
        <p style="color:var(--text-muted);font-size:.82rem;margin-bottom:10px;">${teamName} • ${e.season} sezonu • ${e.matches} maç, ${e.goals} gol${e.myRank ? ' • Lig fazı: ' + e.myRank + '.' : ''}</p>
        ${standingsHtml}
        <div class="euro-fix-grid" style="margin-top:12px;">
            <div><div class="euro-fix-sub">Lig Fazı Maçların</div>${lpFix}</div>
            ${koHtml ? `<div><div class="euro-fix-sub">Eleme Turları (çift-ayaklı)</div>${koHtml}</div>` : ''}
        </div>
        ${champLine}`;
}

// Simüle edilen kupa maçı için MAÇ DETAYI (golcü/kart) — canlı ekran yok, "İncele" bunu açar.
// 58-history'deki _detTeamEvents/_renderMatchDetail global yardımcılarını kullanır (deterministik).
// Özet kutusunun ÜSTÜNDE açılır; detayı kapatınca "Panele Dön" çalışmaya devam eder.
function _openCupMatchDetail() {
    const cd = (typeof activeMatch !== 'undefined' && activeMatch) ? activeMatch._cupDetail : null;
    if (!cd) return;
    const modal = document.getElementById('match-detail-modal');
    const body = document.getElementById('match-detail-body');
    if (!modal || !body || typeof _detTeamEvents !== 'function' || typeof _renderMatchDetail !== 'function') return;
    const hT = getTeamById(cd.home), aT = getTeamById(cd.away);
    if (!hT || !aT) return;
    const salt = (gameState.careerSalt != null ? gameState.careerSalt : 12345);
    const seedBase = salt + '|cup|' + cd.seedKey + '|' + cd.home + '|' + cd.away;
    const d = {
        home: cd.home, away: cd.away, sh: cd.sh, sa: cd.sa, realUser: true,
        homeEv: _detTeamEvents(cd.home, cd.sh, seedBase + '|H'),
        awayEv: _detTeamEvents(cd.away, cd.sa, seedBase + '|A'),
    };
    modal.style.zIndex = '100000';        // maç-sonu özet overlay'inin ÜSTÜNDE
    modal.style.display = 'flex';
    _renderMatchDetail(body, cd.home, cd.away, hT, aT, d);
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        COMP_INFO, qualifyPlayerEuro, ensureEuroForCurrentTeam, euroFixtureDueThisWeek,
        startEuroMatch, endEuroMatch, simEuroMatch, autoSimDueEuro, captureFinalPositions,
        renderEuroPrompt, renderEuroCampaign, _openCupMatchDetail,
    });
}
