// Item 2 (saha görünümü): marker'da gol/kart/sakatlık göstergeleri + FM tarzı alt yedek kulübesi
//  + top/foto cursor:pointer + yedek çipi tıkla → profil.
//   http-server :3000 ayakta iken: node tools/test_pitchview.js
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
        document.getElementById('player-firstname').value = 'Sa';
        document.getElementById('player-lastname').value = 'Ha';
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
        matchLineups.currentTab = 'myteam';

        const xi = matchLineups.myTeam;
        const subIdx = xi.findIndex(p => !p.isUser && posFamily(p.position) !== 'GK');
        const badgeP = xi.find((p, i) => i !== subIdx && !p.isUser && posFamily(p.position) !== 'GK');
        if (badgeP) { badgeP.goals = 2; badgeP.yellow = true; }
        _doSub('MY', subIdx, 70, true);

        if (typeof bindLineupViewToggle === 'function') bindLineupViewToggle();
        document.getElementById('btn-lineup-view-pitch').click();
        await new Promise(r => setTimeout(r, 100));

        res.nodes = document.querySelectorAll('#match-lineup-pitch .pitch-player-node').length;
        res.badges = document.querySelectorAll('#match-lineup-pitch .ppb').length;
        res.goalBadge = !!document.querySelector('#match-lineup-pitch .ppb-goal');
        res.benchVisible = document.getElementById('pitch-bench').style.display === 'block';
        res.benchChips = document.querySelectorAll('#pitch-bench .pb-chip').length;
        res.benchOff = !!document.querySelector('#pitch-bench .pb-chip.subbed-off .pb-off');
        res.markerCursor = getComputedStyle(document.querySelector('.pitch-player-marker')).cursor;

        const chip = document.querySelector('#pitch-bench .pb-chip');
        if (chip) chip.click();
        res.chipProfile = await poll(() => { const m = document.getElementById('player-profile-modal'); return m && m.style.display === 'flex'; });

        // Liste görünümüne dön → yedek bar gizlenir
        document.getElementById('player-profile-modal').style.display = 'none';
        document.getElementById('btn-lineup-view-list').click();
        res.benchHiddenInList = document.getElementById('pitch-bench').style.display === 'none';
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Saha oyuncu node\'ları (11)', out.nodes >= 11, `=${out.nodes}`]);
    c.push(['Marker rozetleri (gol/kart) var', out.badges >= 2, `=${out.badges}`]);
    c.push(['Gol rozeti var', out.goalBadge === true, '']);
    c.push(['Alt yedek kulübesi görünür', out.benchVisible === true, '']);
    c.push(['Yedek çipleri var', out.benchChips >= 5, `=${out.benchChips}`]);
    c.push(['Çıkan oyuncu çipinde dakika', out.benchOff === true, '']);
    c.push(['Marker cursor: pointer (top/foto tıklanır)', out.markerCursor === 'pointer', `=${out.markerCursor}`]);
    c.push(['Yedek çipi tıkla → profil', out.chipProfile === true, '']);
    c.push(['Liste görünümünde yedek bar gizli', out.benchHiddenInList === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== SAHA GÖRÜNÜMÜ: ROZET + YEDEK + CURSOR ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
