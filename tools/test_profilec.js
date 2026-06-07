// Phase C: kaleci profili (Genel'de Gol+Clean Sheet, Geçmiş'te C.Sheet sütunu) +
//  Maçlar satırlarında dakika/rating/yedek (render birim testi).
//   http-server :3000 ayakta iken: node tools/test_profilec.js
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
        document.getElementById('player-firstname').value = 'Pro';
        document.getElementById('player-lastname').value = 'FilC';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const res = {};
        await window.DB.loadPlayers('tur-super-lig');
        const squad = DB.squadSync('tur-super-lig__galatasaray');
        const gk = squad.find(p => p.pos === 'Kaleci');
        const fw = squad.find(p => p.pos !== 'Kaleci');
        const paneTxt = name => (document.querySelector(`.pp-pane[data-pane="${name}"]`) || {}).textContent || '';

        // KALECİ profili
        openPlayerProfile(gk.id, 'tur-super-lig__galatasaray');
        await new Promise(r => setTimeout(r, 350));
        const genelGK = paneTxt('genel');
        res.gkGenelCleanSheet = /Clean Sheet/i.test(genelGK);
        res.gkGenelGol = /Gol/i.test(genelGK);
        res.gkHistCSheet = /C\.Sheet/i.test((document.getElementById('pp-history') || {}).innerHTML || '');
        document.getElementById('player-profile-modal').style.display = 'none';

        // FORVET profili → Geçmiş'te C.Sheet OLMAMALI
        openPlayerProfile(fw.id, 'tur-super-lig__galatasaray');
        await new Promise(r => setTimeout(r, 350));
        res.fwHistNoCSheet = !/C\.Sheet/i.test((document.getElementById('pp-history') || {}).innerHTML || '');
        document.getElementById('player-profile-modal').style.display = 'none';

        // Maç satırı render birim testleri (dakika + rating + yedek)
        const T = 'tur-super-lig__galatasaray', T2 = 'tur-super-lig__fenerbahce';
        const uStart = _ppMatchRowUser({ season: 1, week: 3, leagueId: 'tur-super-lig', home: T, away: T2, sh: 2, sa: 1, rating: 7.4, g: 1, a: 0, motm: 0, mins: 90, started: true });
        const uSub = _ppMatchRowUser({ season: 1, week: 4, leagueId: 'tur-super-lig', home: T, away: T2, sh: 1, sa: 1, rating: 6.6, g: 0, a: 1, motm: 0, mins: 22, started: false });
        const nStart = _ppMatchRowNpc({ week: 2, leagueId: 'tur-super-lig', home: T, away: T2, sh: 3, sa: 0, g: 2, a: 0, y: 0, r: 0, started: true, sub: false, rating: 8.3, mins: 90 });
        res.userMinsShown = /90'/.test(uStart);
        res.userSubLabel = /Yedek/i.test(uSub) && /22'/.test(uSub);
        res.npcRatingShown = /8\.3/.test(nStart) && /İlk 11/.test(nStart) && /90'/.test(nStart);
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Kaleci Genel: Clean Sheet kutusu', out.gkGenelCleanSheet === true, '']);
    c.push(['Kaleci Genel: Gol kutusu da var', out.gkGenelGol === true, '']);
    c.push(['Kaleci Geçmiş: C.Sheet sütunu', out.gkHistCSheet === true, '']);
    c.push(['Forvet Geçmiş: C.Sheet sütunu YOK', out.fwHistNoCSheet === true, '']);
    c.push(['Kullanıcı maç satırı: dakika (90\')', out.userMinsShown === true, '']);
    c.push(['Kullanıcı maç satırı: yedek + dakika (22\')', out.userSubLabel === true, '']);
    c.push(['NPC maç satırı: rating + İlk11 + dakika', out.npcRatingShown === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== PHASE C — KALECİ PROFİLİ + MAÇ SATIRLARI ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
