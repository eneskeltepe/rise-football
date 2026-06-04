// Maç-motoru değişiklik/diziliş/reyting BUG-FIX doğrulaması (kullanıcı canlı bildirdi):
//  (1) kullanıcı çıkınca yerine KALECİ forvete ALINMAZ,
//  (2) santrfor kullanıcı MÖ'ye değil forvet/kanat slotuna girer,
//  (3) yeni giren kullanıcı 20dk dolmadan oyundan ALINMAZ,
//  (4) kullanıcı yedekteyken/çıkınca reytingi DONAR (sadece sahadayken değişir),
//  (5) _buildXI kaleciyi ASLA outfield slota koymaz + santrfor doğal slotuna gelir.
//   http-server :3000 ayakta iken: node tools/test_subfix.js
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
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Forvet';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        // renderMatchLineups DOM'a dokunmasın diye stub'la (mantığı test ediyoruz)
        const _rml = window.renderMatchLineups; window.renderMatchLineups = () => {};
        const fam = p => posFamily(p);
        const SNT = '3-5-2'; // 2 santrfor + DOS/MÖ/OOS
        const slots352 = ['Kaleci', 'Stoper', 'Stoper', 'Stoper', 'Bek', 'Bek', 'DOS', 'Merkez OS', 'Ofansif OS', 'Santrfor', 'Santrfor'];
        const mkXI = () => slots352.map((k, i) => ({
            name: 'N' + i, position: k, label: k, ovr: 75, matchRating: 7.0, condition: 80,
            isUser: false, pid: 'n' + i, goals: 0, assists: 0, saves: 0, yellow: false, red: false,
        }));
        const baseActive = () => ({
            myTeam: { id: 'tur-super-lig__galatasaray', name: 'Galatasaray' },
            oppTeam: { id: 'opp', name: 'Rakip' }, isHome: true, mySubsLeft: 5, oppSubsLeft: 5,
            playerStatus: 'starting', isSubbedOut: false, minute: 0, scoreHome: 0, scoreAway: 0,
            playerStats: { goals: 0, assists: 0, saves: 0, rating: 6.5, yellow: false, red: false }, subLog: [],
        });

        // ---- S1: kullanıcı çıkınca yerine KALECİ gelmez (yedekte sadece kaleci var) ----
        {
            activeMatch = baseActive();
            const xi = mkXI();
            const sntIdx = 9; xi[sntIdx] = { ...xi[sntIdx], isUser: true, pid: 'USER', name: 'Test Forvet' };
            matchLineups = { myTeam: xi, oppTeam: mkXI(), myBench: [{ name: 'Yedek KL', position: 'Kaleci', label: 'KL', ovr: 72, condition: 100, pid: 'gk2', fam: 'GK' }], oppBench: [], currentTab: 'myteam' };
            _subInForUser(72);
            const gkOutfield = matchLineups.myTeam.filter((p, i) => i !== 0 && fam(p.position) === 'GK').length;
            r.s1_noGkOutfield = gkOutfield === 0;
            r.s1_userOff = !!matchLineups.myTeam[sntIdx].subbedOut || !matchLineups.myTeam.some(p => p.isUser && !p.subbedOut);
        }

        // ---- S1b: yedekte outfield (kanat) varsa kullanıcı yerine O gelir, kaleci yine gelmez ----
        {
            activeMatch = baseActive();
            const xi = mkXI();
            const sntIdx = 10; xi[sntIdx] = { ...xi[sntIdx], isUser: true, pid: 'USER', name: 'Test Forvet' };
            matchLineups = {
                myTeam: xi, oppTeam: mkXI(), currentTab: 'myteam', oppBench: [],
                myBench: [
                    { name: 'Yedek SNT', position: 'Santrfor', label: 'SNT', ovr: 74, condition: 100, pid: 'st2', fam: 'ST' },
                    { name: 'Yedek KL', position: 'Kaleci', label: 'KL', ovr: 72, condition: 100, pid: 'gk2', fam: 'GK' },
                ],
            };
            _subInForUser(72);
            r.s1b_replacedByOutfield = fam(matchLineups.myTeam[sntIdx].position) !== 'GK' && matchLineups.myTeam[sntIdx].pid === 'st2';
            r.s1b_noGkOutfield = matchLineups.myTeam.filter((p, i) => i !== 0 && fam(p.position) === 'GK').length === 0;
        }

        // ---- S2: santrfor kullanıcı yedekten girince MÖ'ye DEĞİL forvet slotuna girer ----
        {
            activeMatch = baseActive();
            activeMatch.playerStatus = 'bench';
            const xi = mkXI();
            // MÖ oyuncusunu çok zayıf/yorgun yap (eski bug: en zayıf diye kullanıcı oraya sokulurdu)
            const moIdx = xi.findIndex(p => p.position === 'Merkez OS');
            xi[moIdx].condition = 20; xi[moIdx].matchRating = 4.5;
            // SNT'ler güçlü görünsün ki eski mantık MÖ'yü seçsin
            xi.forEach(p => { if (p.position === 'Santrfor') { p.condition = 90; p.matchRating = 7.5; } });
            matchLineups = { myTeam: xi, oppTeam: mkXI(), myBench: [], oppBench: [], currentTab: 'myteam' };
            gameState.player.position = 'Santrfor';
            _subUserIntoXI(67);
            const u = matchLineups.myTeam.find(p => p.isUser);
            r.s2_userSlot = u ? u.position : null;
            r.s2_playableSlot = u ? (_slotAffinity(u.position, 'Santrfor') >= 0.5) : false;
            r.s2_notMidfield = u ? (u.position !== 'Merkez OS' && u.position !== 'DOS') : false;
            r.s2_onPitchSince = activeMatch.userOnPitchSince;
        }

        // ---- S3: erken-alma koruması (20dk) ----
        {
            activeMatch = baseActive();
            const xi = mkXI(); xi[9] = { ...xi[9], isUser: true, pid: 'USER' };
            matchLineups = { myTeam: xi, oppTeam: mkXI(), myBench: [{ name: 'Y', position: 'Santrfor', label: 'SNT', ovr: 74, condition: 100, pid: 'st2', fam: 'ST' }], oppBench: [], currentTab: 'myteam' };
            activeMatch.minute = 72; activeMatch.userOnPitchSince = 67; activeMatch.playerStats.rating = 5.0;
            gameState.player.energy = 80;
            // _resumeAfterSubOut ticker başlatmasın diye stub
            const _ras = window._resumeAfterSubOut; window._resumeAfterSubOut = () => {};
            const _rnd = Math.random; Math.random = () => 0.01;   // alma şartını zorla
            checkManagerSubOut();
            r.s3_freshNotSubbed = activeMatch.isSubbedOut === false;   // 5dk oldu → alınmamalı
            // şimdi 20dk geçmiş olsun → alınabilmeli
            activeMatch.minute = 90; activeMatch.userOnPitchSince = 67; activeMatch.isSubbedOut = false;
            activeMatch.playerStats.rating = 5.0;
            checkManagerSubOut();
            r.s3_eligibleSubbed = activeMatch.isSubbedOut === true;
            Math.random = _rnd; window._resumeAfterSubOut = _ras;
        }

        // ---- S4: reyting yalnız sahadayken değişir ----
        {
            activeMatch = baseActive();
            matchLineups = { myTeam: mkXI(), oppTeam: mkXI(), myBench: [], oppBench: [], currentTab: 'myteam' };
            activeMatch.playerStatus = 'bench'; activeMatch.playerStats.rating = 6.5;
            adjustPlayerRating(-0.3);
            r.s4_benchFrozen = activeMatch.playerStats.rating === 6.5;
            activeMatch.playerStatus = 'starting'; activeMatch.isSubbedOut = true; activeMatch.playerStats.rating = 7.0;
            adjustPlayerRating(-0.3);
            r.s4_subbedOutFrozen = activeMatch.playerStats.rating === 7.0;
            activeMatch.isSubbedOut = false; activeMatch.playerStats.rating = 6.5;
            adjustPlayerRating(0.8);
            r.s4_onPitchChanges = Math.abs(activeMatch.playerStats.rating - 7.3) < 0.001;
        }

        // ---- S5: _buildXI gerçek kadro — kaleci asla outfield + santrfor doğal slotuna ----
        {
            await DB.loadPlayers('tur-super-lig');
            const squad = DB.squadSync('tur-super-lig__galatasaray');
            const slots = (typeof formationSlots === 'function') ? formationSlots('3-5-2') : null;
            const userP = { position: 'Santrfor', ovr: 80, firstname: 'Test', lastname: 'User', id: 'USER', energy: 100, img: '' };
            const built = _buildXI(squad, 0, 70, userP, slots);
            const xi = built.xi;
            r.s5_xiLen = xi.length;
            const gkSlotIdx = slots.findIndex(s => s.key === 'Kaleci');
            r.s5_noGkOutfield = xi.filter((p, i) => i !== gkSlotIdx && fam(p.position) === 'GK').length === 0;
            r.s5_keeperInGoal = fam(xi[gkSlotIdx].position) === 'GK';
            const u = xi.find(p => p.isUser);
            r.s5_userPlayable = u ? (_slotAffinity(u.position, 'Santrfor') >= 0.5) : false;
            r.s5_userSlot = u ? u.position : null;
        }

        window.renderMatchLineups = _rml;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['S1 kullanıcı çıktı → outfield slotta KALECİ yok', out.s1_noGkOutfield === true, '']);
    c.push(['S1 kullanıcı oyundan çıkmış (10 kişi/akıllı)', out.s1_userOff === true, '']);
    c.push(['S1b kullanıcı yerine outfield (kanat/forvet) geldi', out.s1b_replacedByOutfield === true, '']);
    c.push(['S1b yine outfield slotta kaleci yok', out.s1b_noGkOutfield === true, '']);
    c.push(['S2 santrfor kullanıcı OYNANABİLİR slota girdi', out.s2_playableSlot === true, `slot=${out.s2_userSlot}`]);
    c.push(['S2 kullanıcı orta sahaya (MÖ/DOS) SOKULMADI', out.s2_notMidfield === true, `slot=${out.s2_userSlot}`]);
    c.push(['S2 giriş dakikası kaydedildi (67)', out.s2_onPitchSince === 67, `=${out.s2_onPitchSince}`]);
    c.push(['S3 yeni giren (5dk) oyundan ALINMADI', out.s3_freshNotSubbed === true, '']);
    c.push(['S3 20dk sonra alınabilir oldu', out.s3_eligibleSubbed === true, '']);
    c.push(['S4 yedekteyken reyting DONDU', out.s4_benchFrozen === true, '']);
    c.push(['S4 çıktıktan sonra reyting DONDU', out.s4_subbedOutFrozen === true, '']);
    c.push(['S4 sahadayken reyting değişti (6.5→7.3)', out.s4_onPitchChanges === true, '']);
    c.push(['S5 _buildXI 11 oyuncu', out.s5_xiLen === 11, `=${out.s5_xiLen}`]);
    c.push(['S5 outfield slotta KALECİ yok', out.s5_noGkOutfield === true, '']);
    c.push(['S5 kaleci kalede', out.s5_keeperInGoal === true, '']);
    c.push(['S5 santrfor kullanıcı oynanabilir slotta', out.s5_userPlayable === true, `slot=${out.s5_userSlot}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== MAÇ-MOTORU DEĞİŞİKLİK/REYTİNG BUG-FIX ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
