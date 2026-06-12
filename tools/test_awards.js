// ÖZELLİK (A1-A3) — Rekorlar + Altın Top + Ayın Oyuncusu (48-awards.js):
//  A1 computeWorldRecords: WorldDB playerSeasons'tan tüm-zamanlar kariyer/tek-sezon
//     tabloları; kullanıcı gameState satırlarıyla birleşir (çift sayma yok).
//  A2 computeBallonDor: biten sezonun dünya geneli en iyisi (lig gücü ağırlıklı,
//     şampiyonluk bonusu); kazanırsan kupa + ballonHistory arşivi.
//  A3 maybeMonthlyAward: her 4 haftada son ayın lig maçları (≥3 maç, ort ≥7.5) → ödül.
//   http-server :3000 ayakta iken: node tools/test_awards.js
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PE: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CE: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(async () => {
        localStorage.clear();
        await new Promise(res => { const r = indexedDB.deleteDatabase('fc_world_db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Award';
        document.getElementById('player-lastname').value = 'Test';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));

    // Kaynak bağlantı kontrolleri (advanceWeek + sezon-devri zinciri çağrıları)
    const src = await page.evaluate(async () => {
        const main = await (await fetch('src/90-main.js')).text();
        const bind = await (await fetch('src/94-bindings.js')).text();
        return {
            weeklyHook: main.includes('maybeMonthlyAward'),
            seasonHook: bind.includes('computeBallonDor'),
        };
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        const slot = gameState._slot;
        const S = gameState.currentSeason;   // 2026

        // ---- Lig ağırlığı + skor formülü ----
        const wEng = _awLeagueWeight('eng-premier-league'), wTur = _awLeagueWeight('tur-super-lig');
        r.weightSane = wEng > wTur && wTur >= 0.75 && wEng <= 1.1;
        r.scoreMath = _ballonScore(30, 10, 0, 34, 1.0, true) === 30 * 2 + 10 * 1.4 + 34 * 0.05 + 8;

        // ---- Tohum: dünya yıldızı (2 sezon) + isim kaydı ----
        await WorldDB.putAll('players', [
            { slot, id: 5001, name: 'Test Star', teamId: 'eng-premier-league__arsenal', pos: 'Santrfor', ovr: 90, age: 26, retired: 0 },
            { slot, id: 5002, name: 'Test Mid', teamId: 'tur-super-lig__fenerbahce', pos: 'Merkez OS', ovr: 82, age: 27, retired: 0 },
        ]);
        await WorldDB.putAll('playerSeasons', [
            { slot, playerId: 5001, season: S, leagueId: 'eng-premier-league', teamId: 'eng-premier-league__arsenal', matches: 34, starts: 34, subApps: 0, goals: 28, assists: 6, yellows: 2, reds: 0, ownGoals: 0, cleanSheets: 0, motm: 0 },
            { slot, playerId: 5001, season: S + 1, leagueId: 'eng-premier-league', teamId: 'eng-premier-league__arsenal', matches: 33, starts: 33, subApps: 0, goals: 30, assists: 5, yellows: 1, reds: 0, ownGoals: 0, cleanSheets: 0, motm: 0 },
            { slot, playerId: 5002, season: S, leagueId: 'tur-super-lig', teamId: 'tur-super-lig__fenerbahce', matches: 32, starts: 30, subApps: 2, goals: 12, assists: 14, yellows: 4, reds: 0, ownGoals: 0, cleanSheets: 0, motm: 0 },
        ]);
        // Kullanıcının biten sezonu: şampiyon + 35 gol (dünya yıldızını geçmeli)
        p.seasonHistory.push({
            season: S, teamId: p.teamId, teamName: p.teamName, leagueId: 'tur-super-lig', leagueRank: 1,
            league: { matches: 30, starts: 30, subApps: 0, goals: 35, assists: 10, saves: 0, yellowCards: 2, redCards: 0, cleanSheets: 0, motm: 6, avgRating: 7.9 },
            cup: { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, motm: 0 },
        });
        p.careerStats.goals = 35; p.careerStats.assists = 10; p.careerStats.matches = 30;

        // ---- A2: Altın Top ----
        const entry = await computeBallonDor(slot, S);
        r.ballonEntry = !!entry && entry.season === S && entry.list.length > 0;
        r.userWon = !!entry && entry.userRank === 1 && entry.list[0].isUser === true;
        r.trophyGiven = (gameState.trophies || []).some(t => t.title === 'Altın Top' && t.season === S);
        r.namesResolved = !!entry && entry.list.some(x => x.name === 'Test Star');
        r.historyStored = (gameState.ballonHistory || []).filter(e => e.season === S).length === 1;
        // İkinci çağrı: arşiv ÇOĞALMAZ, kupa çiftlenmez
        await computeBallonDor(slot, S);
        r.noDup = (gameState.ballonHistory || []).filter(e => e.season === S).length === 1 &&
            (gameState.trophies || []).filter(t => t.title === 'Altın Top').length === 1;

        // ---- A1: Rekorlar ----
        const b = await computeWorldRecords(slot);
        r.recBoards = !!b && b.careerGoals.length >= 2;
        // Kariyer gol: Test Star 28+30=58 > kullanıcı 35
        r.recCareerOrder = !!b && b.careerGoals[0].name === 'Test Star' && b.careerGoals[0].v === 58 &&
            b.careerGoals.some(x => x.isUser && x.v === 35);
        // Tek sezon gol: kullanıcı 35 (sezon etiketi ile) > 30 > 28
        r.recSeasonTop = !!b && b.seasonGoals[0].isUser === true && b.seasonGoals[0].v === 35 && b.seasonGoals[0].season === S;
        const b2 = await computeWorldRecords(slot);
        r.recCached = b2 === b;

        // ---- A3: Ayın Oyuncusu ----
        p.matchLog = [
            { season: S, week: 1, leagueId: 'tur-super-lig', comp: null, rating: 8.2, g: 2, a: 0, mins: 90, started: true },
            { season: S, week: 2, leagueId: 'tur-super-lig', comp: null, rating: 7.6, g: 1, a: 1, mins: 90, started: true },
            { season: S, week: 3, leagueId: 'tur-super-lig', comp: null, rating: 7.8, g: 1, a: 0, mins: 90, started: true },
            { season: S, week: 4, leagueId: 'tur-super-lig', comp: null, rating: 8.0, g: 2, a: 1, mins: 90, started: true },
        ];
        gameState.currentWeek = 4;
        const fans0 = p.fansLove;
        const aw = maybeMonthlyAward();
        r.monthlyGiven = !!aw && p.monthlyAwards.length === 1 && p.fansLove === Math.min(100, fans0 + 3);
        r.monthlyOnce = maybeMonthlyAward() === null && p.monthlyAwards.length === 1;   // aynı ay tekrar yok
        // Düşük formlu ay → ödül yok
        p.matchLog = p.matchLog.concat([
            { season: S, week: 5, leagueId: 'tur-super-lig', comp: null, rating: 6.4, g: 0, a: 0, mins: 90, started: true },
            { season: S, week: 6, leagueId: 'tur-super-lig', comp: null, rating: 6.2, g: 0, a: 0, mins: 90, started: true },
            { season: S, week: 7, leagueId: 'tur-super-lig', comp: null, rating: 6.8, g: 0, a: 0, mins: 90, started: true },
        ]);
        gameState.currentWeek = 8;
        r.monthlyLowNo = maybeMonthlyAward() === null && p.monthlyAwards.length === 1;
        // Kupa maçları sayılmaz (comp dolu) → 3 lig maçı şartı sağlanmaz
        p.matchLog = p.matchLog.concat([
            { season: S, week: 9, leagueId: null, comp: 'ucl', rating: 9.0, g: 3, a: 0, mins: 90, started: true },
            { season: S, week: 10, leagueId: null, comp: 'ucl', rating: 9.0, g: 2, a: 1, mins: 90, started: true },
            { season: S, week: 11, leagueId: null, comp: 'ucl', rating: 9.0, g: 2, a: 0, mins: 90, started: true },
        ]);
        gameState.currentWeek = 12;
        r.monthlyCupNo = maybeMonthlyAward() === null && p.monthlyAwards.length === 1;
        return r;
    });

    // ---- UI: görünüm değiştirici (Krallıklar / Rekorlar / Altın Top) ----
    const ui = await page.evaluate(async () => {
        const r = {};
        // İstatistik sekmesini aç
        document.querySelector('.nav-btn[data-target="stats-tab"]').click();
        renderStatsTab();
        r.viewBtns = document.querySelectorAll('#stats-view-btns .stat-cat-btn').length === 3;
        // Rekorlar görünümü
        document.querySelector('#stats-view-btns [data-view="records"]').click();
        await new Promise(res => setTimeout(res, 700));
        const alt = document.getElementById('stats-alt-view');
        r.recordsView = !!alt && alt.textContent.includes('Kariyer Gol') && alt.textContent.includes('Test Star') && alt.textContent.includes('(Sen)');
        // Altın Top görünümü
        document.querySelector('#stats-view-btns [data-view="ballon"]').click();
        await new Promise(res => setTimeout(res, 300));
        const alt2 = document.getElementById('stats-alt-view');
        r.ballonView = !!alt2 && alt2.textContent.includes('Altın Top') && alt2.textContent.includes('(Sen)');
        // Krallıklar görünümüne geri dön
        document.querySelector('#stats-view-btns [data-view="leaders"]').click();
        await new Promise(res => setTimeout(res, 300));
        r.leadersBack = !!document.querySelector('#stats-content .stats-toolbar');
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Lig ağırlığı mantıklı (PL > Süper Lig, 0.75-1.1)', out.weightSane === true, '']);
    c.push(['Altın Top skor formülü doğru', out.scoreMath === true, '']);
    c.push(['A2: Altın Top hesaplandı (arşiv girdisi)', out.ballonEntry === true, '']);
    c.push(['A2: 35 gollü şampiyon kullanıcı KAZANDI (1.)', out.userWon === true, '']);
    c.push(['A2: Altın Top kupası verildi', out.trophyGiven === true, '']);
    c.push(['A2: dünya oyuncusu adı çözüldü (Test Star)', out.namesResolved === true, '']);
    c.push(['A2: tekrar hesaplama arşivi/kupayı çoğaltmaz', out.historyStored === true && out.noDup === true, '']);
    c.push(['A1: rekor tabloları doldu', out.recBoards === true, '']);
    c.push(['A1: kariyer gol sırası doğru (58 > 35, kullanıcı birleşik)', out.recCareerOrder === true, '']);
    c.push(['A1: tek-sezon gol zirvesi kullanıcıda (35, sezon etiketi)', out.recSeasonTop === true, '']);
    c.push(['A1: sezon içinde cache kullanılır', out.recCached === true, '']);
    c.push(['A3: güçlü ay → Ayın Oyuncusu + taraftar sevgisi', out.monthlyGiven === true, '']);
    c.push(['A3: aynı ay ikinci kez verilmez', out.monthlyOnce === true, '']);
    c.push(['A3: zayıf ay / kupa-maçı ayı ödül almaz', out.monthlyLowNo === true && out.monthlyCupNo === true, '']);
    c.push(['Bağlantılar: advanceWeek + sezon-devri zinciri', src.weeklyHook === true && src.seasonHook === true, '']);
    c.push(['UI: 3 görünüm butonu (Krallıklar/Rekorlar/Altın Top)', ui.viewBtns === true, '']);
    c.push(['UI: Rekorlar görünümü tablolari basıyor', ui.recordsView === true, '']);
    c.push(['UI: Altın Top görünümü arşivi basıyor', ui.ballonView === true, '']);
    c.push(['UI: Krallıklar görünümüne dönüş çalışıyor', ui.leadersBack === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ÖZELLİK — REKORLAR + ALTIN TOP + AYIN OYUNCUSU (A1-A3) ===`);
    console.log(JSON.stringify({ src, out, ui }).slice(0, 700) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
