// ÖZELLİK (A4+A5) — Duran top sistemi (49-setpieces.js):
//  A4: Penaltıcı/Frikikçi GÖREVİ (histerezisli atama) + canlı maçta görevli kullanıcı
//      penaltı/frikik kullanır, kaleci kullanıcı rakip penaltısını kurtarmaya çalışır.
//  A5: Kupa elemesinde beraberlik tek zar yerine UZATMA + SERİ PENALTI; kullanıcı
//      sahadaysa ETKİLEŞİMLİ atış; sonuç rd.penScore'a yazılır.
//   http-server :3000 ayakta iken: node tools/test_setpieces.js
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
        document.getElementById('player-firstname').value = 'Set';
        document.getElementById('player-lastname').value = 'Piece';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    // Kaynak bağlantı kontrolleri
    const src = await page.evaluate(async () => {
        const me = await (await fetch('src/45-matchengine.js')).text();
        const main = await (await fetch('src/90-main.js')).text();
        const html = await (await fetch('index.html')).text();
        return {
            tickerHook: me.includes('maybeSetPieceMoment'),
            counterReset: me.includes('penMomentsUsed = 0') && me.includes('fkMomentsUsed = 0'),
            weeklyDuty: main.includes('updateSetPieceDuty'),
            scriptTag: html.includes('49-setpieces.js'),
        };
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;

        // ---- A4: görev atama (histerezis) ----
        p.attrs.penalti = 50; p.attrs.serbestVurus = 50; p.managerTrust = 60;
        updateSetPieceDuty(true);
        r.noDutyLow = !p.setPieceDuty.pen && !p.setPieceDuty.fk;
        p.attrs.penalti = 80; p.attrs.serbestVurus = 75;
        updateSetPieceDuty(true);
        r.dutyGained = p.setPieceDuty.pen === true && p.setPieceDuty.fk === true;
        p.managerTrust = 40;                       // güven düştü → görevler gider
        updateSetPieceDuty(true);
        r.dutyLost = !p.setPieceDuty.pen && !p.setPieceDuty.fk;
        p.managerTrust = 60; updateSetPieceDuty(true);   // geri ver (sonraki testler için)
        const oldPos = p.position; p.position = 'Kaleci';
        updateSetPieceDuty(true);
        r.gkNoDuty = !p.setPieceDuty.pen && !p.setPieceDuty.fk;
        p.position = oldPos; updateSetPieceDuty(true);

        // ---- Şans formülleri (gösterilen % = gerçek şans) ----
        r.chanceFormulas = _penKickChance({ penalti: 50 }) === 58 && _penKickChance({ penalti: 90 }) === 88 &&
            _penKickChance({ penalti: 10 }) === 45 && _penKickChance({ penalti: 99 }) === 92 &&
            _fkGoalChance({ serbestVurus: 90 }) === 52 && _gkPenSaveChance({ gkRefleks: 90 }) === 46;

        // ---- Canlı maç kurulumu yardımcısı ----
        function freshMatch() {
            activeMatch.isCup = false; activeMatch.isHome = true;
            activeMatch.scoreHome = 0; activeMatch.scoreAway = 0;
            activeMatch.minute = 40; activeMatch.playerStatus = 'starting';
            activeMatch.isSubbedOut = false; activeMatch.isHalfTime = false;
            activeMatch.mySubsLeft = 3; activeMatch.subLog = []; activeMatch.events = [];
            activeMatch.penMomentsUsed = 0; activeMatch.fkMomentsUsed = 0; activeMatch.oppPenMomentsUsed = 0;
            activeMatch.decisionCount = 0; activeMatch.lastDecisionMin = -99;
            activeMatch.myTeam = DB.getTeam('tur-super-lig__galatasaray');
            activeMatch.oppTeam = DB.getTeam('tur-super-lig__fenerbahce');
            activeMatch.playerStats = { goals: 0, assists: 0, saves: 0, rating: 6.5, yellow: false, red: false };
            if (typeof initMatchStats === 'function') initMatchStats();
            matchLineups.myTeam = [{ isUser: true, name: 'S. Piece', position: 'Santrfor', label: 'SNT', ovr: 75, matchRating: 6.5, condition: 90, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 'USER' }];
            matchLineups.oppTeam = []; matchLineups.myBench = []; matchLineups.oppBench = [];
        }

        // ---- A4: kullanıcı PENALTI anı (görevli) — başarı → gol + penalty-scored ----
        freshMatch();
        _userPenaltyMoment();
        const box = document.getElementById('match-decision-box');
        r.penModalOpen = box.style.display === 'flex' && document.querySelectorAll('#decision-options .btn-decision').length === 3;
        let vals = [0.0];   // zar=1 → kesin başarı
        let _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        document.querySelectorAll('#decision-options .btn-decision')[0].click();
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.penGoal = activeMatch.playerStats.goals === 1 && activeMatch.scoreHome === 1 &&
            (activeMatch.events || []).some(ev => ev.type === 'penalty-scored' && ev.team === 'MY');

        // ---- A4: FRİKİK anı — asist seçeneği başarı → asist + takım golü ----
        freshMatch();
        matchLineups.myTeam.push({ isUser: false, name: 'Forvet B', position: 'Santrfor', label: 'SNT', ovr: 72, matchRating: 6.5, condition: 80, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 202 });
        _userFreeKickMoment();
        r.fkModalOpen = box.style.display === 'flex' && document.querySelectorAll('#decision-options .btn-decision').length === 3;
        vals = [0.0];
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        document.querySelectorAll('#decision-options .btn-decision')[2].click();   // 'Ceza sahasına ortala' (asist)
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.fkAssist = activeMatch.playerStats.assists === 1 && activeMatch.scoreHome === 1;

        // ---- A4: KALECİ penaltı kurtarışı ----
        p.position = 'Kaleci';
        freshMatch();
        _gkPenaltySaveMoment();
        vals = [0.0];   // kurtarış zarı tutar
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        document.querySelectorAll('#decision-options .btn-decision')[0].click();
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.gkSave = activeMatch.playerStats.saves === 1 && activeMatch.scoreAway === 0 &&
            (activeMatch.events || []).some(ev => ev.type === 'save');
        freshMatch();
        _gkPenaltySaveMoment();
        vals = [0.999];   // kurtaramadı → gol
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        document.querySelectorAll('#decision-options .btn-decision')[0].click();
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.gkConcede = activeMatch.scoreAway === 1 && (activeMatch.events || []).some(ev => ev.type === 'penalty-scored' && ev.team === 'OPP');
        p.position = oldPos;

        // ---- A4: maybeSetPieceMoment tetikleme + per-maç tavan ----
        updateSetPieceDuty(true);   // pen+fk görevleri geri (attr 80/75, trust 60)
        freshMatch();
        vals = [0.0001];   // penaltı zarı tutar
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        const t1 = maybeSetPieceMoment();
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.momentTriggered = t1 === true && activeMatch.penMomentsUsed === 1 && box.style.display === 'flex';
        box.style.display = 'none';
        vals = [0.0001, 0.9, 0.9];   // pen kullanıldı → fk zarı da ver (0.0001 fk'ya gider)
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        const t2 = maybeSetPieceMoment();   // pen kapalı (used), fk 0.0001 < 0.004 → frikik tetiklenir
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.momentCap = t2 === true && activeMatch.penMomentsUsed === 1 && activeMatch.fkMomentsUsed === 1;
        box.style.display = 'none';

        // ---- A5: _shootoutSim — erken bitiş + seri ölüm ----
        vals = [0.1, 0.9, 0.1, 0.9, 0.1, 0.9];   // my hep atar, opp hep kaçırır → 3-0'da biter
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        const s1 = _shootoutSim(0.76);
        Math.random = _mr;
        r.shootEarly = s1.won === true && s1.my === 3 && s1.opp === 0;
        // 5-5 sonrası seri ölüm: round6 my atar, opp kaçırır
        vals = [];
        for (let i = 0; i < 5; i++) vals.push(0.1, 0.1);   // 5'er atışta herkes atar (5-5)
        vals.push(0.1, 0.9);                               // seri ölüm: my gol, opp kaçtı
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        const s2 = _shootoutSim(0.76);
        Math.random = _mr;
        r.shootSudden = s2.won === true && s2.my === 6 && s2.opp === 5;

        // ---- A5: cupTieBreakSync — uzatma golsüz → penaltılar ----
        vals = [0.99, 0.99, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9];   // ET: gol yok; pen 3-0
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        const tb = cupTieBreakSync(1, 1, 80, 80);
        Math.random = _mr;
        r.tieBreakSync = tb.my === 1 && tb.opp === 1 && !!tb.pen && tb.pen.won === true && tb.pen.score === '3-0';
        // Uzatmada gol → penaltı YOK
        vals = [0.01, 0.9, 0.99];   // my ET golü (0.01<pm), 2. gol yok, opp yok
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        const tb2 = cupTieBreakSync(1, 1, 80, 80);
        Math.random = _mr;
        r.etDecides = tb2.my === 2 && tb2.opp === 1 && tb2.pen === null;

        // ---- A5: _cupTieDeciding ----
        const rdS = { round: 'Final', oppId: 'x', single: true, legs: [], decided: false };
        r.decSingle = _cupTieDeciding({ phase: 'final', fx: {}, round: rdS }, 1, 1) === true &&
            _cupTieDeciding({ phase: 'final', fx: {}, round: rdS }, 2, 1) === false;
        const leg1 = { played: true, gf: 1, ga: 1 }, leg2 = { played: false };
        const rdL = { round: 'Yarı Final', oppId: 'x', single: false, legs: [leg1, leg2], decided: false };
        r.decLegs = _cupTieDeciding({ phase: 'sf', fx: leg2, round: rdL }, 2, 2) === true &&
            _cupTieDeciding({ phase: 'sf', fx: leg2, round: rdL }, 2, 1) === false &&
            _cupTieDeciding({ phase: 'sf', fx: leg1, round: rdL }, 1, 1) === false;   // diğer bacak oynanmamış

        // ---- A5: _recordEuro penShootout sonucunu kullanır (Final + kupa) ----
        const myT = 'tur-super-lig__galatasaray';
        gameState.euro = {
            compId: 'test-cup', compName: 'Test Kupası', season: gameState.currentSeason, _team: myT,
            ko: [], koIndex: 0, myLp: [], matches: 0, goals: 0, assists: 0, lpDone: true, phase: 'final',
        };
        const rdF = { round: 'Final', oppId: 'tur-super-lig__fenerbahce', single: true, legs: [{ oppId: 'tur-super-lig__fenerbahce', home: true }], decided: false, won: false, aggGf: 0, aggGa: 0, pen: false };
        gameState.euro.ko = [rdF];
        const curF = { phase: 'final', fx: rdF.legs[0], round: rdF, roundLabel: 'Final', penShootout: { won: true, score: '5-4' } };
        const tr0 = gameState.trophies.length;
        _recordEuro(curF, 2, 2);
        r.recordPen = rdF.decided === true && rdF.won === true && rdF.pen === true && rdF.penScore === '5-4';
        r.championOnPen = gameState.euro.champion === true && gameState.trophies.length === tr0 + 1;
        return r;
    });

    // ---- A5: ETKİLEŞİMLİ seri penaltı (overlay + buton akışı; enjekte RNG ile deterministik) ----
    await page.evaluate(() => {
        const p = gameState.player;
        p.setPieceDuty = { pen: true, fk: true };
        p.attrs.penalti = 80;
        activeMatch.playerStats = { goals: 0, assists: 0, saves: 0, rating: 6.5 };
        // Sıra: [kaleci tarafı=sağ(0.7), kullanıcı atışı=gol(0.1)] sonra AI atışları: my atar(0.1)/opp kaçırır(0.9)...
        const vals = [0.7, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9];
        window.__penDone = null;
        _interactiveShootout({
            myName: 'Galatasaray', oppName: 'Fenerbahçe', onSave: () => {},
            rng: () => (vals.length ? vals.shift() : 0.5),
        }).then(res => { window.__penDone = res; });
    });
    await new Promise(r => setTimeout(r, 1400));   // "başlıyor…" + kullanıcı atışı butonları
    const uiMid = await page.evaluate(() => {
        const ov = document.getElementById('pen-shootout-overlay');
        const btns = ov ? ov.querySelectorAll('#pen-actions button') : [];
        const ok = !!ov && btns.length === 3;
        if (btns.length) btns[0].click();   // Sol köşe
        return ok;
    });
    // AI atışları + erken bitiş + Devam butonu
    let uiDone = null;
    for (let i = 0; i < 40 && !uiDone; i++) {
        await new Promise(r => setTimeout(r, 400));
        uiDone = await page.evaluate(() => {
            const ov = document.getElementById('pen-shootout-overlay');
            if (!ov) return window.__penDone ? { resolved: true } : null;
            const btns = Array.from(ov.querySelectorAll('#pen-actions button'));
            const devam = btns.find(b => b.textContent === 'Devam');
            if (devam) devam.click();
            return null;
        });
    }
    const ui = await page.evaluate(() => {
        const res = window.__penDone;
        return {
            overlayShown: true,
            resolved: !!res && res.won === true && res.score === '3-0',
            overlayClosed: !document.getElementById('pen-shootout-overlay'),
        };
    });

    await browser.close();

    const c = [];
    c.push(['A4: düşük stat/güven → görev yok', out.noDutyLow === true, '']);
    c.push(['A4: penalti 80 + güven 60 → Penaltıcı + Frikikçi', out.dutyGained === true, '']);
    c.push(['A4: güven düşünce görevler alınır (histerezis)', out.dutyLost === true, '']);
    c.push(['A4: kaleci duran-top görevi almaz', out.gkNoDuty === true, '']);
    c.push(['A4: şans formülleri (taban/eğim/sınırlar)', out.chanceFormulas === true, '']);
    c.push(['A4: penaltı anı — 3 seçenekli modal', out.penModalOpen === true, '']);
    c.push(['A4: penaltı golü → skor + penalty-scored olayı', out.penGoal === true, '']);
    c.push(['A4: frikik anı modalı', out.fkModalOpen === true, '']);
    c.push(['A4: frikik ortası → asist + takım golü', out.fkAssist === true, '']);
    c.push(['A4: kaleci penaltı KURTARDI (save olayı)', out.gkSave === true, '']);
    c.push(['A4: kaleci kurtaramazsa gol (OPP penalty-scored)', out.gkConcede === true, '']);
    c.push(['A4: ticker anı tetiklenir (sayaç + modal)', out.momentTriggered === true, '']);
    c.push(['A4: per-maç tavan (pen 1 → frikiğe geçer)', out.momentCap === true, '']);
    c.push(['A5: seri penaltı erken bitiş (3-0)', out.shootEarly === true, '']);
    c.push(['A5: seri ölüm (6-5)', out.shootSudden === true, '']);
    c.push(['A5: uzatma golsüz → penaltılar (sync)', out.tieBreakSync === true, '']);
    c.push(['A5: uzatma golü turu bitirir (penaltı yok)', out.etDecides === true, '']);
    c.push(['A5: _cupTieDeciding tek maç + çift bacak', out.decSingle === true && out.decLegs === true, '']);
    c.push(['A5: _recordEuro penaltı sonucunu kullanır (penScore)', out.recordPen === true, '']);
    c.push(['A5: finalde penaltıyla ŞAMPİYONLUK + kupa', out.championOnPen === true, '']);
    c.push(['A5: etkileşimli seri — köşe seçimi butonları', uiMid === true, '']);
    c.push(['A5: etkileşimli seri 3-0 kazanıldı + overlay kapandı', ui.resolved === true && ui.overlayClosed === true, '']);
    c.push(['Bağlantılar: ticker hook + sayaç reset + haftalık görev + script', src.tickerHook && src.counterReset && src.weeklyDuty && src.scriptTag, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ÖZELLİK — DURAN TOP SİSTEMİ (A4+A5) ===`);
    console.log(JSON.stringify({ src, out, ui }).slice(0, 700) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
