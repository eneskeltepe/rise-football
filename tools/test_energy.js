// N3: Maç-sonu ENERJİ tutarlılığı — canlı ticker düşüşünün üstüne endMatch'in TEKRAR düşmesi
//  ("90'da %83 → panelde %53" çift-sayım) düzeltmesi. Ayrıca hızlı-sim ve yedek senaryosu.
//   http-server :3000 ayakta iken: node tools/test_energy.js
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
        document.getElementById('player-firstname').value = 'En';
        document.getElementById('player-lastname').value = 'Erji';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');
        function freshMatch() {
            gameState.player.managerTrust = 70; gameState.currentWeek = 1; gameState.matchesPlayedThisWeek = false;
            window.setActiveLeagueFixtures(); gameState._fxLeague = window.activeLeagueId();
            window.startMatchDay();
            if (activeMatch && activeMatch.timerId) clearInterval(activeMatch.timerId);
        }
        // Senaryo 1: CANLI 90 dk oynandı (enerji zaten 83'e indi) → endMatch ÇİFT düşmemeli
        freshMatch();
        gameState.player.energy = 83;
        activeMatch.playerStatus = 'starting'; activeMatch.isSubbedOut = false;
        activeMatch.actualPlayedMinutes = 90; activeMatch.userOnPitchSince = 0;
        activeMatch.effortLevel = 'normal'; activeMatch.minute = 90;
        try { (window.endMatch || endMatch)(); } catch (e) { res.err1 = String(e); }
        res.live90 = Math.round(gameState.player.energy);

        // Senaryo 2: HIZLI SİM (canlı düşüş yok) → ~90×0.32≈29 düşmeli (≈71), çift (~39) değil
        freshMatch();
        gameState.player.energy = 100;
        activeMatch.playerStatus = 'starting'; activeMatch.isSubbedOut = false;
        activeMatch.actualPlayedMinutes = 0; activeMatch.userOnPitchSince = 0; activeMatch.effortLevel = 'normal';
        try { (window.simulateRemainingMatchFast || simulateRemainingMatchFast)(); } catch (e) { res.err2 = String(e); }
        res.fastSim = Math.round(gameState.player.energy);

        // Senaryo 3: YEDEKTE kaldı (hiç girmedi) → hafif dinlenme (+12)
        freshMatch();
        gameState.player.energy = 70;
        activeMatch.playerStatus = 'bench'; activeMatch.isSubbedOut = false;
        activeMatch.actualPlayedMinutes = 0; activeMatch.userOnPitchSince = 0; activeMatch.minute = 90;
        try { (window.endMatch || endMatch)(); } catch (e) { res.err3 = String(e); }
        res.bench = Math.round(gameState.player.energy);
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Canlı 90dk: panel ≈ canlı enerji (çift düşüm YOK)', out.live90 >= 80 && out.live90 <= 86, `=${out.live90} (bug'da ~53)`]);
    c.push(['Hızlı-sim: tek hesap (~71), çift (~39) değil', out.fastSim >= 60 && out.fastSim <= 76, `=${out.fastSim}`]);
    c.push(['Yedekte kaldı: hafif dinlenme (≈82)', out.bench >= 79 && out.bench <= 84, `=${out.bench}`]);
    c.push(['endMatch/sim hatasız çalıştı', !out.err1 && !out.err2 && !out.err3, [out.err1, out.err2, out.err3].filter(Boolean).join(' | ')]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== N3 ENERJİ TUTARLILIĞI ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
