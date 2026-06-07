// Item 4: maç olaylarında oyuncu adına tıkla → profil açılır (kullanıcı + takım arkadaşı).
//   http-server :3000 ayakta iken: node tools/test_eventclick.js
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
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const poll = async (fn, ms = 5000, step = 100) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, step)); } return fn(); };
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');
        gameState.player.managerTrust = 70; gameState.currentWeek = 1; gameState.matchesPlayedThisWeek = false;
        window.setActiveLeagueFixtures(); gameState._fxLeague = window.activeLeagueId();
        window.startMatchDay();
        if (activeMatch && activeMatch.timerId) { clearInterval(activeMatch.timerId); activeMatch.timerId = null; }

        const mate = (matchLineups.myTeam || []).find(p => !p.isUser && p.pid != null && String(p.pid).indexOf('fic_') !== 0);
        res.mateName = mate ? mate.name : '';

        // (a) Takım arkadaşı olayına tıkla → profil
        activeMatch.events = [];
        pushMatchEvent({ type: 'goal', team: 'MY', playerName: mate.name });
        const span = [...document.querySelectorAll('#match-events-log .me-name-click')].find(e => e.textContent === mate.name);
        res.spanClickable = !!span;
        if (span) span.click();
        res.mateProfileOpened = await poll(() => { const m = document.getElementById('player-profile-modal'); return m && m.style.display === 'flex'; });
        document.getElementById('player-profile-modal').style.display = 'none';

        // (b) Kullanıcı olayına tıkla → KENDİ profili
        const userFull = `${gameState.player.firstname} ${gameState.player.lastname}`;
        activeMatch.events = [];
        pushMatchEvent({ type: 'goal', team: 'MY', playerName: userFull });
        const uspan = [...document.querySelectorAll('#match-events-log .me-name-click')].find(e => e.textContent === userFull);
        if (uspan) uspan.click();
        res.userProfileOpened = await poll(() => { const m = document.getElementById('player-profile-modal'); return m && m.style.display === 'flex'; });
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Olay adı tıklanabilir (.me-name-click)', out.spanClickable === true, `mate=${out.mateName}`]);
    c.push(['Takım arkadaşı olayına tıkla → profil açıldı', out.mateProfileOpened === true, '']);
    c.push(['Kullanıcı olayına tıkla → kendi profili açıldı', out.userProfileOpened === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== MAÇ OLAYI → PROFİL ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
