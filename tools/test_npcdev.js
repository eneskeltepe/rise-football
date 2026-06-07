// Phase E: YAŞAYAN NPC GELİŞİMİ — deterministik özellik gelişimi (buildNpcDevHistory) +
//  profil "Gelişim" sekmesi (özellik-bazlı base→şimdi + sakatlık + OVR eğrisi).
//   http-server :3000 ayakta iken: node tools/test_npcdev.js
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
        document.getElementById('player-firstname').value = 'Dev';
        document.getElementById('player-lastname').value = 'Track';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');
        const squad = DB.squadSync('tur-super-lig__galatasaray').filter(p => p.attrs && !p.isYouth);
        const young = squad.filter(p => p.age && p.age <= 21 && p.pos !== 'Kaleci').sort((a, b) => (b.potential || b.ovr) - (a.potential || a.ovr))[0]
            || squad.slice().sort((a, b) => a.age - b.age)[0];
        const old = squad.filter(p => p.age >= 32).sort((a, b) => b.age - a.age)[0] || squad.slice().sort((a, b) => b.age - a.age)[0];

        const dY = buildNpcDevHistory(young, 5);
        const dY2 = buildNpcDevHistory(young, 5);
        res.youngAge = young.age; res.youngOvr = young.ovr;
        res.curveLen = dY.curve.length;
        res.youngGrew = ((dY.mains.teknik - dY.baseMains.teknik) + (dY.mains.fizik - dY.baseMains.fizik)) > 0;
        res.youngOvrCalib = dY.ovr === ageAdjustedOvr(young, 5);
        res.deterministic = JSON.stringify([dY.mains, dY.curve, dY.injuries]) === JSON.stringify([dY2.mains, dY2.curve, dY2.injuries]);

        const dO = buildNpcDevHistory(old, 5);
        res.oldAge = old.age;
        res.oldPhysDecline = (dO.mains.hiz - dO.baseMains.hiz) <= 0;

        // Profil entegrasyonu: 4 sezon geçmiş → Gelişim sekmesi özellik satırları
        gameState.currentSeason = (typeof START_SEASON !== 'undefined' ? START_SEASON : 2026) + 4;
        openPlayerProfile(young.id, 'tur-super-lig__galatasaray');
        await new Promise(r => setTimeout(r, 300));
        const devHtml = (document.getElementById('pp-devcurve') || {}).innerHTML || '';
        res.devRows = document.querySelectorAll('#pp-devcurve .pp-dev-row').length;
        res.devHasDelta = /pp-dev-d/.test(devHtml);
        res.devHasCurve = /pp-devcurve-wrap/.test(devHtml);
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Gelişim eğrisi noktaları (6 = base+5 sezon)', out.curveLen === 6, `=${out.curveLen}`]);
    c.push(['Genç oyuncu gelişti (teknik+fizik ↑)', out.youngGrew === true, `yaş=${out.youngAge}`]);
    c.push(['Final OVR ageAdjustedOvr ile hizalı (kalibrasyon)', out.youngOvrCalib === true, '']);
    c.push(['Deterministik (aynı tohum → aynı sonuç)', out.deterministic === true, '']);
    c.push(['Yaşlı oyuncuda hız geriledi', out.oldPhysDecline === true, `yaş=${out.oldAge}`]);
    c.push(['Profil Gelişim: 6 özellik satırı', out.devRows === 6, `=${out.devRows}`]);
    c.push(['Profil Gelişim: delta (±) gösterimi', out.devHasDelta === true, '']);
    c.push(['Profil Gelişim: OVR eğrisi', out.devHasCurve === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== PHASE E — YAŞAYAN NPC GELİŞİMİ ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
