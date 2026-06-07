// Match-UI Phase 1: kullanıcı kendi kadrosunda + aramada görünür; "ucuz hint" kalktı;
//  dinamik z-index (profil maç-detayının ÜSTÜnde açılır).
//   http-server :3000 ayakta iken: node tools/test_macui1.js
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
        const poll = async (fn, ms = 6000, step = 120) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, step)); } return fn(); };
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');

        // (1) Kendi kadromda KENDİMİ gör
        openTeamSquad('tur-super-lig__galatasaray');
        await poll(() => document.querySelectorAll('#team-squad-body .ts-row').length > 0);
        const meRow = document.querySelector('#team-squad-body .ts-row-me[data-pid="USER"]');
        res.meInSquad = !!meRow;
        res.meName = meRow ? /Keltepe/.test(meRow.textContent) : false;
        res.cheapHintGone = !document.querySelector('#team-squad-body .ts-foot');
        document.getElementById('team-squad-modal').style.display = 'none';

        // (2) Aramada KENDİMİ bul
        openGlobalSearch();
        const inp = document.getElementById('global-search-input');
        inp.value = 'keltepe'; inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 150));
        const meSearch = document.querySelector('#global-search-results .gs-row-me[data-pid="USER"]');
        res.meInSearch = !!meSearch;
        closeGlobalSearch();

        // (3) Dinamik z-index: maç detayı aç → profil aç → profil ÜSTTE
        openMatchDetail('tur-super-lig', 0, 'tur-super-lig__galatasaray', 'tur-super-lig__fenerbahce', gameState.currentSeason);
        await poll(() => { const m = document.getElementById('match-detail-modal'); return m && m.style.display === 'flex'; });
        const mdZ = parseInt(document.getElementById('match-detail-modal').style.zIndex, 10) || 0;
        openPlayerProfile('USER', gameState.player.teamId);
        await poll(() => { const m = document.getElementById('player-profile-modal'); return m && m.style.display === 'flex'; });
        const ppZ = parseInt(document.getElementById('player-profile-modal').style.zIndex, 10) || 0;
        res.mdZ = mdZ; res.ppZ = ppZ;
        res.profileAboveMatch = ppZ > mdZ;
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Kendi kadromda KENDİMİ görüyorum (data-pid=USER)', out.meInSquad === true, '']);
    c.push(['Kadro satırında adım (Keltepe)', out.meName === true, '']);
    c.push(['"Oyuncuya tıkla" ucuz hint kalktı', out.cheapHintGone === true, '']);
    c.push(['Aramada KENDİMİ buluyorum', out.meInSearch === true, '']);
    c.push(['Dinamik z: profil maç-detayının ÜSTÜnde', out.profileAboveMatch === true, `pp=${out.ppZ} md=${out.mdZ}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== MATCH-UI PHASE 1 ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
