// DÜŞÜK FIX dalgası — kozmetik/ölü kod/tutarlılık düzeltmeleri:
//  (D2) SLOT_COUNT=10 (menü/README "10 kariyer slotu" vaadiyle uyumlu; eskiden 9).
//  (D3) Bozuk İngiltere bayrak literali düzeltildi ('%c2%a7…' kalıntısı yok).
//  (D4) ageGenFillers: dolgu oyuncular sezon devrinde yaşlanır; 34+ emekli olur,
//       yerine genç dolgu gelir (eskiden kariyer boyunca hiç yaşlanmıyorlardı).
//  (D5) Karar anı golü/asisti şut istatistiğini de artırır (eskiden yalnız isabetli
//       şut artıyordu → "isabetli şut > toplam şut" görülebiliyordu).
//  (D6) Ölü alanlar temizlendi: weeksAtCurrentClub, SLOT_N, lids.
//  (D7) _doSub'da oyuna giren yedek mevki-yetkinlik çarpanıyla oynar (FAZ C ile tutarlı).
//  (D8) Karar-anı başarısızlığında yenen golün golcüsü GERÇEK rakip oyuncu (takım adı değil).
//  (D9) Kariyer-hafta hesaplarında 2026 hardcode → START_SEASON.
//  (D1) loadFromSlot fikstür hafta navigasyonunu güncel haftaya senkronlar.
//   http-server :3000 ayakta iken: node tools/test_lowfixes.js
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PE: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CE: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(async () => { localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Low';
        document.getElementById('player-lastname').value = 'Fix';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    // ---- Kaynak kontrolleri (ölü kod / bozuk literal / hardcode) ----
    const src = await page.evaluate(async () => {
        const get = async f => (await fetch('src/' + f)).text();
        const ui = await get('60-ui.js'), bind = await get('94-bindings.js'),
            store = await get('12-store.js'), market = await get('52-market.js'),
            neg = await get('54-negotiation.js');
        return {
            flagFixed: !ui.includes('%c2%a7'),
            no2026Weeks: !/- 2026\) \* 36/.test(ui) && !/- 2026\) \* 36/.test(bind),
            noSlotN: !store.includes('SLOT_N'),
            noLids: !/const lids\b/.test(market),
            noWeeksAtClub: !neg.includes('weeksAtCurrentClub'),
        };
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;

        // ---- D2: 10 kariyer slotu ----
        r.slotCount = SLOT_COUNT === 10 && listSaveSlots().length === 10;

        // ---- D9 + D6: taze durum START_SEASON; weeksAtCurrentClub artık üretilmiyor ----
        r.startSeason = gameState.currentSeason === START_SEASON;
        r.noDeadField = !('weeksAtCurrentClub' in p);

        // ---- D4: ageGenFillers — genç gelişir, orta sabit, 34+ yenilenir ----
        const tid = 'tur-super-lig__galatasaray';
        gameState.genFillers = {};
        gameState.genFillers[tid] = [
            { id: 'gen_t_0', name: 'Genç', pos: 'Santrfor', position: 'Santrfor', ovr: 60, age: 20, teamId: tid, img: '', isGen: true },
            { id: 'gen_t_1', name: 'Orta', pos: 'Stoper', position: 'Stoper', ovr: 65, age: 27, teamId: tid, img: '', isGen: true },
            { id: 'gen_t_2', name: 'Yaşlı', pos: 'DOS', position: 'DOS', ovr: 62, age: 34, teamId: tid, img: '', isGen: true },
        ];
        ageGenFillers();
        const gf = gameState.genFillers[tid];
        r.fillerYoung = gf[0].age === 21 && gf[0].ovr === 61;
        r.fillerMid = gf[1].age === 28 && gf[1].ovr === 65;
        r.fillerRetired = gf[2].id !== 'gen_t_2' && gf[2].age <= 23 && gf[2].isGen === true;

        // ---- D7: _doSub'da giren yedek EFEKTİF OVR ile oynar ----
        function freshMatch() {
            activeMatch.isCup = false; activeMatch.isHome = true;
            activeMatch.scoreHome = 0; activeMatch.scoreAway = 0;
            activeMatch.minute = 60; activeMatch.playerStatus = 'starting';
            activeMatch.isSubbedOut = false; activeMatch.mySubsLeft = 3; activeMatch.oppSubsLeft = 3;
            activeMatch.subLog = []; activeMatch.events = [];
            activeMatch.myTeam = DB.getTeam('tur-super-lig__galatasaray');
            activeMatch.oppTeam = DB.getTeam('tur-super-lig__fenerbahce');
            activeMatch.playerStats = { goals: 0, assists: 0, saves: 0, rating: 6.5, yellow: false, red: false };
            if (typeof initMatchStats === 'function') initMatchStats();
            matchLineups.myTeam = [
                { isUser: true, name: 'L. Fix', position: 'Santrfor', label: 'SNT', ovr: 70, matchRating: 6.5, condition: 90, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 'USER' },
                { isUser: false, name: 'Forvet A', position: 'Santrfor', label: 'SNT', ovr: 72, matchRating: 6.5, condition: 80, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 201 },
            ];
            matchLineups.oppTeam = [
                { isUser: false, name: 'Rakip Forvet', position: 'Santrfor', label: 'SNT', ovr: 74, matchRating: 6.5, condition: 85, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 301 },
                { isUser: false, name: 'Rakip Stoper', position: 'Stoper', label: 'STP', ovr: 73, matchRating: 6.5, condition: 85, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 302 },
            ];
            matchLineups.myBench = []; matchLineups.oppBench = [];
        }

        // a) Aynı mevkiden yedek: çarpan 1.0 → ham OVR korunur
        freshMatch();
        matchLineups.myBench = [{ name: 'Yedek SNT', position: 'Santrfor', label: 'SNT', ovr: 64, matchRating: 6.5, condition: 95, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 401, img: '' }];
        _doSub('MY', 1, 60);
        const inSame = matchLineups.myTeam[1];
        r.subSamePos = inSame.pid === 401 && inSame.ovr === 64 && inSame.baseOvr === 64 && inSame.famFactor === 1;

        // b) Mevki dışı yedek: efektif OVR = ham × yetkinlik çarpanı (<1)
        freshMatch();
        matchLineups.myBench = [{ name: 'Yedek OOS', position: 'Ofansif OS', label: 'OOS', ovr: 70, matchRating: 6.5, condition: 95, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 402, img: '' }];
        _doSub('MY', 1, 60);
        const inOff = matchLineups.myTeam[1];
        const aff = _slotAffinity('Santrfor', 'Ofansif OS');
        const famF = familiarityFactorFromAffinity(aff);
        r.subOffPos = inOff.pid === 402 && famF < 1 && inOff.ovr === Math.max(40, Math.round(70 * famF)) && inOff.baseOvr === 70 && inOff.famFactor === famF;

        // ---- D5: karar anı golü → şut + isabetli şut BİRLİKTE artar ----
        const OPT_GOAL = { name: 'Şut', stat: 'sut', difficulty: 10, success: 'GOL! Ağlarla buluştu!', fail: 'Kaçtı', isGoal: true };
        freshMatch();
        let s0 = { ...activeMatch.teamStats.MY };
        let vals = [0.0];   // zar düşük → başarı
        let _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        resolvePlayerDecision(OPT_GOAL, 60);
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.goalShots = activeMatch.teamStats.MY.shots === s0.shots + 1 && activeMatch.teamStats.MY.shotsOnTarget === s0.shotsOnTarget + 1;
        r.goalCounted = activeMatch.playerStats.goals === 1;

        // ---- D5: karar anı asisti → takım şutu da sayılır + golcü olayı ----
        const OPT_AST = { name: 'Ara pası', stat: 'pas', difficulty: 10, success: 'Asist! Takım arkadaşın tamamladı', fail: 'Kaçtı', isAssist: true };
        freshMatch();
        s0 = { ...activeMatch.teamStats.MY };
        vals = [0.0];
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        resolvePlayerDecision(OPT_AST, 60);
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.assistShots = activeMatch.teamStats.MY.shots === s0.shots + 1 && activeMatch.teamStats.MY.shotsOnTarget === s0.shotsOnTarget + 1;
        r.assistScorer = matchLineups.myTeam[1].goals === 1;   // golü takım arkadaşı attı

        // ---- D8: başarısızlıkta yenen golün golcüsü GERÇEK rakip oyuncu ----
        const OPT_DEF = { name: 'Müdahale', stat: 'defans', difficulty: 15, success: 'Kestin', fail: 'Geçildin' };
        const oldPos = p.position; p.position = 'Stoper';      // concede yolu yalnız savunma/GK
        freshMatch();
        s0 = { ...activeMatch.teamStats.OPP };
        vals = [0.999, 0.0];   // zar=100 başarısız + concede zarı tutar (0 < 0.4)
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        resolvePlayerDecision(OPT_DEF, 50);
        Math.random = _mr; clearInterval(activeMatch.timerId);
        p.position = oldPos;
        const oppGoal = (activeMatch.events || []).filter(ev => ev.type === 'goal' && ev.team === 'OPP').pop();
        const oppNames = matchLineups.oppTeam.map(x => x.name);
        r.concededScorerReal = !!oppGoal && oppNames.includes(oppGoal.playerName) && oppGoal.playerName !== activeMatch.oppTeam.name;
        r.concededScorerStats = matchLineups.oppTeam.some(x => x.goals === 1);
        r.concededShots = activeMatch.teamStats.OPP.shots === s0.shots + 1 && activeMatch.teamStats.OPP.shotsOnTarget === s0.shotsOnTarget + 1;

        // ---- D1: loadFromSlot fikstür hafta navigasyonunu senkronlar ----
        gameState.currentWeek = 9;
        saveGame();
        fixtureViewingWeek = 1;   // bayat değer (eski bug: yüklemede 1'de kalıyordu)
        loadFromSlot(gameState._slot);
        r.fixWeekSynced = fixtureViewingWeek === 9;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['D2: 10 kariyer slotu (SLOT_COUNT + menü listesi)', out.slotCount === true, '']);
    c.push(['D3: bozuk İngiltere bayrak literali temizlendi', src.flagFixed === true, '']);
    c.push(['D9: kariyer-hafta hesaplarında 2026 hardcode yok', src.no2026Weeks === true, '']);
    c.push(['D9: taze kariyer START_SEASON ile başlar', out.startSeason === true, '']);
    c.push(['D6: SLOT_N / lids / weeksAtCurrentClub ölü kodu silindi', src.noSlotN && src.noLids && src.noWeeksAtClub, '']);
    c.push(['D6: yeni oyuncuda weeksAtCurrentClub alanı üretilmiyor', out.noDeadField === true, '']);
    c.push(['D4: genç dolgu gelişir (+1 yaş, +1 OVR)', out.fillerYoung === true, '']);
    c.push(['D4: orta yaş dolgu sabit OVR (+1 yaş)', out.fillerMid === true, '']);
    c.push(['D4: 34+ dolgu emekli → yerine genç dolgu', out.fillerRetired === true, '']);
    c.push(['D7: aynı mevki yedek ham OVR ile girer (çarpan 1.0)', out.subSamePos === true, '']);
    c.push(['D7: mevki dışı yedek EFEKTİF OVR ile girer (çarpan <1)', out.subOffPos === true, '']);
    c.push(['D5: karar golü şut + isabetli şutu birlikte artırır', out.goalShots === true && out.goalCounted === true, '']);
    c.push(['D5: karar asisti takım şutunu sayar + golcü işlenir', out.assistShots === true && out.assistScorer === true, '']);
    c.push(['D8: yenen golün golcüsü gerçek rakip oyuncu (takım adı değil)', out.concededScorerReal === true && out.concededScorerStats === true, '']);
    c.push(['D8: yenen gol rakip şut istatistiğine işlenir', out.concededShots === true, '']);
    c.push(['D1: loadFromSlot fikstür haftasını güncel haftaya çeker', out.fixWeekSynced === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== DÜŞÜK FIX — KOZMETİK/ÖLÜ KOD/TUTARLILIK DALGASI ===`);
    console.log(JSON.stringify({ src, out }).slice(0, 600) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
