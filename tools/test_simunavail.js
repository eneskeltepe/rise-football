// YUKSEK FIX (Y1) — "Maçı Simüle Et" sakatlık/ceza tanır: sakat/cezalıyken
//  simulateMatchInstantly oyuncuyu OYNATMAZ (takım maçı oyuncusuz sonuçlanır,
//  ceza düşer). Eskiden hiçbir kontrol yoktu → sakatken istatistik kasılabiliyor,
//  ceza maçı hiç düşmüyordu. Sağlıklı yol aynen çalışmaya devam eder.
//   http-server :3000 ayakta iken: node tools/test_simunavail.js
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
        document.getElementById('player-firstname').value = 'Sim';
        document.getElementById('player-lastname').value = 'Unavail';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        const lid = activeLeagueId();
        const myRow = () => (gameState.standings[lid] || {})[p.teamId] || { played: 0 };

        // ---- 1) SAKAT: simüle et → oyuncu oynamaz, takım maçı yine de sonuçlanır ----
        p.injury = { name: 'Test sakatlık', weeks: 2 };
        simulateMatchInstantly();
        const wk1 = (gameState.fixtures[0] || []).find(m => !m.isBay && (m.home === p.teamId || m.away === p.teamId));
        r.injTeamPlayed = !!wk1 && wk1.scoreHome !== null && wk1.scoreAway !== null;
        r.injNoPlayerStats = p.currentSeasonStats.matches === 0;       // oyuncuya maç YAZILMAZ
        r.injWeekFlag = gameState.matchesPlayedThisWeek === true;
        r.injStandings = myRow().played === 1;
        r.injStillInjured = !!p.injury;                                 // sakatlık sim'le "iyileşmez"

        // ---- 2) CEZALI (hafta 2): ceza DÜŞER, oyuncu oynamaz ----
        p.injury = null;
        gameState.currentWeek = 2; gameState.matchesPlayedThisWeek = false;
        if (typeof _syncCalendarToWeek === 'function') _syncCalendarToWeek();
        p.suspension = { matches: 1, reason: 'test cezası' };
        simulateMatchInstantly();
        const wk2 = (gameState.fixtures[1] || []).find(m => !m.isBay && (m.home === p.teamId || m.away === p.teamId));
        r.susTeamPlayed = !!wk2 && wk2.scoreHome !== null;
        r.susCleared = p.suspension === null;                           // ceza maçı düştü
        r.susNoPlayerStats = p.currentSeasonStats.matches === 0;
        r.susStandings = myRow().played === 2;

        // ---- 3) SAĞLIKLI yol aynen çalışır (hafta 3) ----
        gameState.currentWeek = 3; gameState.matchesPlayedThisWeek = false;
        if (typeof _syncCalendarToWeek === 'function') _syncCalendarToWeek();
        simulateMatchInstantly();
        r.healthyPlayed = p.currentSeasonStats.matches === 1;           // şimdi oyuncu maç yaptı
        r.healthyStandings = myRow().played === 3;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Sakat: takım maçı sonuçlandı', out.injTeamPlayed === true, '']);
    c.push(['Sakat: oyuncuya maç/istatistik YAZILMADI', out.injNoPlayerStats === true, '']);
    c.push(['Sakat: hafta "oynandı" işaretlendi', out.injWeekFlag === true, '']);
    c.push(['Sakat: puan durumu işlendi (1 maç)', out.injStandings === true, '']);
    c.push(['Sakat: sakatlık durumu korunur', out.injStillInjured === true, '']);
    c.push(['Cezalı: takım maçı sonuçlandı', out.susTeamPlayed === true, '']);
    c.push(['Cezalı: ceza maçı DÜŞTÜ (suspension=null)', out.susCleared === true, '']);
    c.push(['Cezalı: oyuncuya maç yazılmadı', out.susNoPlayerStats === true, '']);
    c.push(['Cezalı: puan durumu işlendi (2 maç)', out.susStandings === true, '']);
    c.push(['Sağlıklı: instant-sim normal çalışıyor (oyuncu 1 maç)', out.healthyPlayed === true, '']);
    c.push(['Sağlıklı: puan durumu işlendi (3 maç)', out.healthyStandings === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== YUKSEK FIX — SAKAT/CEZALI İKEN "MAÇI SİMÜLE ET" ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
