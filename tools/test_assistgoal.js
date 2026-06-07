// Bug fix: kullanıcı ASİST yapınca golü ATAN takım arkadaşı + gol olayı (animasyon) görünmeli.
//  Eskiden sadece "Asist [user]" olayı vardı; golcü ve animasyon yoktu.
//   http-server :3000 ayakta iken: node tools/test_assistgoal.js
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
        document.getElementById('player-firstname').value = 'Enes';
        document.getElementById('player-lastname').value = 'Keltepe';
        const r = document.querySelector('input[name="position"][value="Ofansif OS"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');
        gameState.player.managerTrust = 70; gameState.currentWeek = 1; gameState.matchesPlayedThisWeek = false;
        window.setActiveLeagueFixtures(); gameState._fxLeague = window.activeLeagueId();
        window.startMatchDay();
        if (activeMatch && activeMatch.timerId) clearInterval(activeMatch.timerId);

        const userFull = `${gameState.player.firstname} ${gameState.player.lastname}`;

        // --- ASİST senaryosu ---
        activeMatch.events = []; activeMatch.minute = 34;
        const sh0 = activeMatch.scoreHome, sa0 = activeMatch.scoreAway, as0 = activeMatch.playerStats.assists;
        resolvePlayerDecision({ name: 'Ara pas', stat: 'pas', difficulty: 20, success: 'ASİST!', fail: 'x', isAssist: true }, 100);
        const ev = activeMatch.events;
        const goalEv = ev.find(e => e.type === 'goal' && e.team === 'MY');
        const assistEv = ev.find(e => e.type === 'assist' && e.team === 'MY');
        res.assistGoalEvent = !!goalEv;
        res.assistScorerNotUser = goalEv ? (goalEv.playerName && goalEv.playerName !== userFull) : false;
        res.assistEvent = !!assistEv;
        res.assistScoreUp = (activeMatch.scoreHome + activeMatch.scoreAway) === (sh0 + sa0 + 1);
        res.assistStatUp = activeMatch.playerStats.assists === as0 + 1;

        // --- GOL senaryosu (regresyon: direkt gol hâlâ olay + animasyon) ---
        activeMatch.events = []; activeMatch.minute = 50;
        const g0 = activeMatch.playerStats.goals, t0 = activeMatch.scoreHome + activeMatch.scoreAway;
        resolvePlayerDecision({ name: 'Şut çek', stat: 'sut', difficulty: 20, success: 'GOL!', fail: 'x', isGoal: true }, 100);
        const gEv = activeMatch.events.find(e => e.type === 'goal' && e.team === 'MY' && e.playerName === userFull);
        res.goalEventUser = !!gEv;
        res.goalScoreUp = (activeMatch.scoreHome + activeMatch.scoreAway) === t0 + 1;
        res.goalStatUp = activeMatch.playerStats.goals === g0 + 1;
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Asist → "Gol [X]" olayı var', out.assistGoalEvent === true, '']);
    c.push(['Golcü kullanıcı DEĞİL (takım arkadaşı)', out.assistScorerNotUser === true, '']);
    c.push(['Asist olayı (kullanıcı) var', out.assistEvent === true, '']);
    c.push(['Asistte skor +1', out.assistScoreUp === true, '']);
    c.push(['Asist istatistiği +1', out.assistStatUp === true, '']);
    c.push(['Gol senaryosu: kullanıcı gol olayı', out.goalEventUser === true, '']);
    c.push(['Gol senaryosu: skor +1', out.goalScoreUp === true, '']);
    c.push(['Gol senaryosu: gol istatistiği +1', out.goalStatUp === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ASİST → GOL + ANİMASYON ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
