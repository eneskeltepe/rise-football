// Item 1 (liste görünümü): çıkan oyuncunun dakikası+rating'i GÖRÜNÜR + sakatlık ikonu +
//  sarı/kırmızı kart göstergeleri (yedek kulübesi + ilk 11).
//   http-server :3000 ayakta iken: node tools/test_lineupinfo.js
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
        document.getElementById('player-firstname').value = 'Lin';
        document.getElementById('player-lastname').value = 'Eup';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
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
        if (activeMatch && activeMatch.timerId) { clearInterval(activeMatch.timerId); activeMatch.timerId = null; }
        matchLineups.currentTab = 'myteam';

        // Bir XI oyuncusunu sakat+sarı kart ile 60'ta çıkar
        const xi = matchLineups.myTeam;
        const idx = xi.findIndex(p => !p.isUser && posFamily(p.position) !== 'GK');
        const victim = xi[idx];
        victim.matchRating = 7.2; victim.yellow = true; victim.injured = true;
        res.subOk = _doSub('MY', idx, 60, true);
        // İlk 11'de kalan birine sarı kart
        const xiYellow = matchLineups.myTeam.find(p => !p.isUser && !p.subbedOut);
        if (xiYellow) xiYellow.yellow = true;
        renderMatchLineups();

        const benchRows = [...document.querySelectorAll('#match-lineup-players-list .bench-row')];
        const offRow = benchRows.find(r => r.querySelector('.bench-offinfo'));
        res.offInfoShown = !!offRow;
        res.offMinShown = offRow ? /60'/.test(offRow.textContent) : false;
        res.offRatingShown = offRow ? /7\.2/.test(offRow.textContent) : false;
        res.injIconShown = offRow ? !!offRow.querySelector('.bench-inj') : false;
        res.yellowOnBench = offRow ? !!offRow.querySelector('.ev-yellow-card') : false;
        res.yellowInXI = !!document.querySelector('#match-lineup-players-list .lineup-player-row:not(.bench-row) .ev-yellow-card');
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Değişiklik yapıldı', out.subOk === true, '']);
    c.push(['Çıkan oyuncu bilgisi görünüyor', out.offInfoShown === true, '']);
    c.push(['Çıkış dakikası görünür (60\')', out.offMinShown === true, '']);
    c.push(['Çıkış rating\'i görünür (7.2)', out.offRatingShown === true, '']);
    c.push(['Sakatlık ikonu (yedekte)', out.injIconShown === true, '']);
    c.push(['Sarı kart (yedekte çıkan)', out.yellowOnBench === true, '']);
    c.push(['Sarı kart (ilk 11\'de)', out.yellowInXI === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== DİZİLİŞ LİSTE: KART/SUB/SAKATLIK ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
