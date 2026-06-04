// Faz 3d doğrulama — KULLANICININ kendi maçı IDB matches'e tam atfla yazılıyor +
// kulüp arkadaşları krallıkta gerçek görünüyor + 'USER' çift sayılmıyor (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_usermatch.js
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE.ERR: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(async () => {
        localStorage.clear();
        await new Promise(res => { const r = indexedDB.deleteDatabase('fc_world_db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Kerem';
        document.getElementById('player-lastname').value = 'Yıldız';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot, season = gameState.currentSeason;
        const lgId = activeLeagueId(), userTeam = gameState.player.teamId;
        await DB.ensureLeagues([lgId]);
        await WorldDB.seedCareer(slot);

        // Kullanıcının 0. hafta maçını bul
        gameState.currentWeek = 1;
        const fx = leagueFixtures(lgId);
        const wk = fx[0];
        const myMatch = wk.find(m => m.home === userTeam || m.away === userTeam);
        const isHome = myMatch.home === userTeam;
        const oppId = isHome ? myMatch.away : myMatch.home;
        await DB.ensureLeagues([lgId]);

        // Senaryo: takımım 3 - 1 (ben 1 gol + 1 asist) — teammateGoals=2 (1'i benim asistim)
        const myScore = 3, oppScore = 1, userGoals = 1, userAssists = 1;
        myMatch.scoreHome = isHome ? myScore : oppScore;
        myMatch.scoreAway = isHome ? oppScore : myScore;
        r.scenario = { home: myMatch.home, away: myMatch.away, sh: myMatch.scoreHome, sa: myMatch.scoreAway, isHome, userGoals, userAssists };

        // Diziliş kur (canlı maç yolu gibi matchLineups dolu)
        const mySquad = DB.squadSync(userTeam), oppSquad = DB.squadSync(oppId);
        const lObj = p => ({ pid: p.id, position: p.pos, ovr: p.ovr });
        const userObj = { pid: 'USER', position: gameState.player.position, ovr: gameState.player.ovr, isUser: true };
        matchLineups.myTeam = [userObj].concat(mySquad.slice(0, 10).map(lObj));   // 11 (ben + 10)
        matchLineups.oppTeam = oppSquad.slice(0, 11).map(lObj);
        matchLineups.myBench = []; matchLineups.oppBench = [];
        activeMatch.myTeam = { id: userTeam }; activeMatch.oppTeam = { id: oppId };
        activeMatch.isHome = isHome; activeMatch.isCup = false;
        activeMatch.startedXI = true;
        activeMatch.playerStats = { goals: userGoals, assists: userAssists, yellow: true, red: false };

        // ÇAĞIR (interaktif yol: matchLineups GERÇEK → useLineups=true)
        _recordUserMatchToWorld(myMatch, userGoals, userAssists, true);
        await new Promise(res => setTimeout(res, 250));   // fire-and-forget yazımı bekle

        // 1) Saklı kayıt
        const matchId = season + ':' + lgId + ':0:' + myMatch.home + ':' + myMatch.away;
        const rec = await WorldDB.get('matches', [slot, matchId]);
        r.stored = !!rec;
        r.userMatchFlag = !!(rec && rec.userMatch);
        const evs = (rec && rec.events) || [];
        const myTeamId = userTeam, oppTeamId = oppId;
        const goalsMine = evs.filter(e => e.type === 'goal' && e.teamId === myTeamId);
        const goalsOpp = evs.filter(e => e.type === 'goal' && e.teamId === oppTeamId);
        r.myGoalCount = goalsMine.length; r.oppGoalCount = goalsOpp.length;
        r.userGoalEvents = evs.filter(e => e.type === 'goal' && e.playerId === 'USER').length;
        r.userAssistEvents = evs.filter(e => e.type === 'goal' && e.assistId === 'USER').length;
        r.teammateGoalEvents = goalsMine.filter(e => e.playerId !== 'USER' && /^\d+$/.test(String(e.playerId))).length;
        r.userYellow = evs.some(e => e.type === 'yellow' && e.playerId === 'USER');
        r.scoreParity = (goalsMine.length === (isHome ? myMatch.scoreHome : myMatch.scoreAway)) &&
            (goalsOpp.length === (isHome ? myMatch.scoreAway : myMatch.scoreHome));

        // Bir takım arkadaşı golcüsü seç (gerçek id)
        const tmScorer = goalsMine.find(e => e.playerId !== 'USER' && /^\d+$/.test(String(e.playerId)));
        r.tmScorerId = tmScorer ? tmScorer.playerId : null;

        // 2) Cache: USER atlanmalı, takım arkadaşı gerçek statla görünmeli
        WorldStats.invalidate();
        await WorldStats.ensureSeason(slot, season);
        r.cacheUserNull = (WorldStats.playerStat('USER') === null);
        if (r.tmScorerId != null) {
            const st = WorldStats.playerStat(r.tmScorerId);
            const derivedG = goalsMine.filter(e => e.playerId === r.tmScorerId).length;
            r.tmCacheG = st ? st.g : -1; r.tmDerivedG = derivedG;
            r.tmCacheMatchesGoal = !!(st && st.g === derivedG && derivedG >= 1);
        }
        // asistteki USER cache'e yazılmamalı; takım arkadaşı asisti varsa onlara yazılmalı
        const tmAssist = goalsMine.find(e => e.assistId != null && e.assistId !== 'USER');
        if (tmAssist) { const st = WorldStats.playerStat(tmAssist.assistId); r.tmAssistCached = !!(st && st.a >= 1); }
        else r.tmAssistCached = 'yok';

        // 3) aggregatePlayerSeasons: USER/NaN kaydı OLMAMALI; takım arkadaşı kaydı olmalı
        await WorldDB.aggregatePlayerSeasons(slot, season);
        const allPS = await WorldDB.playerSeasonsAll(slot, r.tmScorerId);
        r.tmHasSeasonRec = (allPS || []).some(x => x.season === season && x.goals >= 1);
        // 'USER'/NaN playerSeason kaydı tarama: tüm kayıtları gez (küçük sezon)
        let badRec = false;
        await WorldDB.iterateByIndex('playerSeasons', 'bySlotSeasonLeague', IDBKeyRange.only([slot, season, lgId]), (ps) => {
            if (ps.playerId === 'USER' || !Number.isFinite(ps.playerId)) badRec = true;
        });
        r.noBadPlayerSeason = !badRec;

        // 3b) INSTANT yol: matchLineups KURULMAZ → useLineups=false (squad fallback)
        gameState.currentWeek = 2;
        const wk2 = fx[1];
        const myMatch2 = wk2.find(m => m.home === userTeam || m.away === userTeam);
        const isHome2 = myMatch2.home === userTeam;
        myMatch2.scoreHome = isHome2 ? 2 : 0; myMatch2.scoreAway = isHome2 ? 0 : 2;
        matchLineups.myTeam = null; matchLineups.oppTeam = null;   // bayat/boş
        activeMatch.myTeam = { id: userTeam }; activeMatch.oppTeam = { id: isHome2 ? myMatch2.away : myMatch2.home };
        activeMatch.isHome = isHome2; activeMatch.isCup = false; activeMatch.startedXI = true;
        activeMatch.playerStats = { goals: 1, assists: 0, yellow: false, red: false };
        _recordUserMatchToWorld(myMatch2, 1, 0, false);
        await new Promise(res => setTimeout(res, 250));
        const id2 = season + ':' + lgId + ':1:' + myMatch2.home + ':' + myMatch2.away;
        const rec2 = await WorldDB.get('matches', [slot, id2]);
        const evs2 = (rec2 && rec2.events) || [];
        const mineG2 = evs2.filter(e => e.type === 'goal' && e.teamId === userTeam);
        r.instantStored = !!rec2;
        r.instantScoreParity = (mineG2.length === 2);
        r.instantXISize = (rec2 && (isHome2 ? rec2.homeXI : rec2.awayXI) || []).length;
        r.instantUserGoal = evs2.filter(e => e.type === 'goal' && e.playerId === 'USER').length === 1;

        // 4) Maç detayı: kullanıcının adı + "Senin maçın" etiketi
        openMatchDetail(lgId, 0, myMatch.home, myMatch.away, season);
        await new Promise(res => setTimeout(res, 400));
        const body = document.getElementById('match-detail-body');
        r.detailTag = body ? (body.querySelector('.md-tag') || {}).textContent : '';
        r.detailHasUserName = body ? body.textContent.includes('Yıldız') : false;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Kullanıcı maçı IDB matches\'e yazıldı', out.stored === true, '']);
    c.push(['userMatch:true bayrağı var', out.userMatchFlag === true, '']);
    c.push(['Skor paritesi (olay sayısı = skor)', out.scoreParity === true, `benim=${out.myGoalCount} rakip=${out.oppGoalCount}`]);
    c.push(['Kullanıcı golleri playerId=USER', out.userGoalEvents === out.scenario.userGoals, `${out.userGoalEvents}/${out.scenario.userGoals}`]);
    c.push(['Kullanıcı asistleri assistId=USER', out.userAssistEvents === out.scenario.userAssists, `${out.userAssistEvents}/${out.scenario.userAssists}`]);
    c.push(['Kalan takım golleri arkadaşlara atandı', out.teammateGoalEvents === (out.scenario.userGoals !== undefined ? (3 - out.scenario.userGoals) : -1), `${out.teammateGoalEvents}`]);
    c.push(['Kullanıcı sarı kartı olayda var', out.userYellow === true, '']);
    c.push(['Cache USER\'ı ATLIYOR (playerStat null)', out.cacheUserNull === true, '']);
    c.push(['Takım arkadaşı golü cache\'te gerçek', out.tmCacheMatchesGoal === true, `cache=${out.tmCacheG} türetilen=${out.tmDerivedG}`]);
    c.push(['aggregate USER/NaN kaydı YOK', out.noBadPlayerSeason === true, '']);
    c.push(['Takım arkadaşı playerSeasons kaydı var', out.tmHasSeasonRec === true, '']);
    c.push(['Maç detayı etiketi "Senin maçın"', /Senin maçın/.test(out.detailTag || ''), `"${out.detailTag}"`]);
    c.push(['Maç detayında kullanıcı adı görünüyor', out.detailHasUserName === true, '']);
    c.push(['INSTANT yol: maç yazıldı (squad fallback)', out.instantStored === true, '']);
    c.push(['INSTANT skor paritesi', out.instantScoreParity === true, `goller=${out.instantXISize ? '' : ''}`]);
    c.push(['INSTANT diziliş 11 (squad\'tan)', out.instantXISize === 11, `XI=${out.instantXISize}`]);
    c.push(['INSTANT kullanıcı golü USER', out.instantUserGoal === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 3d — kullanıcı maçı IDB'ye + USER çift sayılmıyor ===`);
    console.log(JSON.stringify(out, null, 0).slice(0, 500) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
