// N2: KULLANICININ maçlarındaki oyuncuların kondisyonu maçtan maça TAŞINIR (kalıcı) ve
//  günlerle iyileşir. Eskiden her maç taze 82-100 geliyordu ("2 gün sonra full").
//   http-server :3000 ayakta iken: node tools/test_fitness.js
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
        document.getElementById('player-firstname').value = 'Fit';
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
        function freshMatch() {
            gameState.player.managerTrust = 70; gameState.currentWeek = 1; gameState.matchesPlayedThisWeek = false;
            window.setActiveLeagueFixtures(); gameState._fxLeague = window.activeLeagueId();
            window.startMatchDay();
            if (activeMatch && activeMatch.timerId) clearInterval(activeMatch.timerId);
        }
        function findPid(pid) {
            for (const k in matchLineups) { const arr = matchLineups[k]; if (Array.isArray(arr)) { const f = arr.find(p => p && String(p.pid) === String(pid)); if (f) return f; } }
            return null;
        }
        const mates = () => matchLineups.myTeam.filter(p => !p.isUser && p.pid != null && String(p.pid).indexOf('fic_') !== 0);

        // (1) Taze kondisyon makul aralıkta
        gameState.squadFitness = {};
        freshMatch();
        const m0 = mates();
        res.mateCount = m0.length;
        res.freshInRange = m0[0].condition >= 80 && m0[0].condition <= 100;

        // (4) Saklı kondisyon maç başında KULLANILIYOR (taze gelmiyor)
        const pid = m0[0].pid;
        gameState.squadFitness[pid] = 55;
        freshMatch();
        const f = findPid(pid);
        res.persistedStart = f ? f.condition === 55 : null;

        // (5) persistSquadFitness: yorgunu saklar, dinç olanı (≥98) budar
        gameState.squadFitness = {};
        const m2 = mates();
        m2[0].condition = 62; m2[1].condition = 99;
        persistSquadFitness();
        res.persistDrain = gameState.squadFitness[m2[0].pid] === 62;
        res.persistPrune = gameState.squadFitness[m2[1].pid] === undefined;

        // (6) recoverSquadFitness: günlerle iyileşir, dolunca budanır
        gameState.squadFitness = { 'X': 50 };
        recoverSquadFitness(2);
        res.recover2 = gameState.squadFitness['X'];
        recoverSquadFitness(10);
        res.recoverFull = gameState.squadFitness['X'] === undefined;
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Maç dizilişinde takım arkadaşları var', out.mateCount >= 7, `=${out.mateCount}`]);
    c.push(['Taze kondisyon makul (80-100)', out.freshInRange === true, '']);
    c.push(['Saklı kondisyon maç başında kullanılıyor (55)', out.persistedStart === true, ''],);
    c.push(['persist: yorgun (62) saklandı', out.persistDrain === true, '']);
    c.push(['persist: dinç (99≥98) budandı', out.persistPrune === true, '']);
    c.push(['recover(2): 50→~78', out.recover2 >= 76 && out.recover2 <= 80, `=${out.recover2}`]);
    c.push(['recover(10): dolunca budandı', out.recoverFull === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== N2 KALICI KONDİSYON + İYİLEŞME ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
