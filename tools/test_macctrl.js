// Items 7+8: kompakt maç kontrolleri (sağ-üst, ikon-döngü) + canlı anlatım DEFAULT KAPALI.
//   http-server :3000 ayakta iken: node tools/test_macctrl.js
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
        document.getElementById('player-firstname').value = 'Ctrl';
        document.getElementById('player-lastname').value = 'Test';
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
        const stopTicker = () => { if (activeMatch && activeMatch.timerId) { clearInterval(activeMatch.timerId); activeMatch.timerId = null; } };
        stopTicker();

        // Eski büyük paneller kalktı
        res.oldPanelsGone = !document.querySelector('.match-speed-panel') && document.querySelectorAll('.effort-panel').length === 0;
        // Kompakt bar var
        res.quickBar = !!document.getElementById('match-quick-controls');

        // (7) Canlı anlatım DEFAULT kapalı
        const cpanel = document.querySelector('.match-commentary-panel');
        res.commentaryHiddenDefault = cpanel && cpanel.style.display === 'none';

        // (8a) Hız döngüsü: normal → fast
        document.getElementById('mqc-speed').click(); stopTicker();
        res.speedCycled = gameState.settings.matchSpeed === 'fast' && /Hızlı/.test(document.getElementById('mqc-speed').textContent);

        // (8b) Efor döngüsü: normal → high (efor YALNIZ sahadayken ayarlanır → önce sahadaymış gibi etkinleştir;
        //      v2.15.0: sahada değilken #mqc-effort kilitli, _cycleEffort tıklamayı yok sayar)
        if (window._setEffortEnabled) window._setEffortEnabled(true);
        activeMatch.effortLevel = 'normal';
        document.getElementById('mqc-effort').click(); stopTicker();
        res.effortCycled = activeMatch.effortLevel === 'high' && /Pres/.test(document.getElementById('mqc-effort').textContent);

        // (7b) Anlatım toggle → açılır
        document.getElementById('mqc-commentary').click();
        res.commentaryToggledOn = cpanel.style.display !== 'none' && document.getElementById('mqc-commentary').classList.contains('active');
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Eski büyük hız/efor panelleri kalktı', out.oldPanelsGone === true, '']);
    c.push(['Kompakt kontrol barı var', out.quickBar === true, '']);
    c.push(['Canlı anlatım DEFAULT kapalı', out.commentaryHiddenDefault === true, '']);
    c.push(['Hız döngüsü (normal→Hızlı)', out.speedCycled === true, '']);
    c.push(['Efor döngüsü (normal→Pres)', out.effortCycled === true, '']);
    c.push(['Anlatım toggle açılıyor', out.commentaryToggledOn === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== KOMPAKT MAÇ KONTROLLERİ + ANLATIM ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
