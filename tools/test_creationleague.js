// FAZ B: YENİ KARİYER lig seçici — kıta gruplu (Avrupa/Asya/Amerika), ülke piramit sıralı,
//  KUPALAR YOK (kariyere kupadan başlanmaz), varsayılan tur-super-lig.
//   http-server :3000 ayakta iken: node tools/test_creationleague.js
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

    const out = await page.evaluate(() => {
        // creation dropdown'larını kur (menü akışından bağımsız doğrudan)
        if (typeof initCustomDropdowns === 'function') initCustomDropdowns();
        const dd = document.getElementById('dropdown-league');
        const r = {};
        r.exists = !!dd;
        r.groupHeaders = dd ? dd.querySelectorAll('.dropdown-group-header').length : 0;
        const txt = dd ? dd.textContent : '';
        r.hasAvrupa = /AVRUPA/.test(txt);
        r.hasOtherContinent = /(ASYA|AMERİKA)/.test(txt);
        r.noCups = !/🏆/.test(txt);   // kupa YOK
        r.optionCount = dd ? dd.querySelectorAll('.dropdown-option').length : 0;
        r.defaultLeague = (document.getElementById('player-league') || {}).value || '';
        // İngiltere kademeleri ardışık mı? (Premier → Championship → ... aynı blokta)
        const labels = dd ? [...dd.querySelectorAll('.dropdown-option')].map(e => e.textContent) : [];
        const pi = labels.findIndex(l => /Premier League/.test(l));
        const ci = labels.findIndex(l => /Championship/.test(l));
        r.englandTiersGrouped = pi >= 0 && ci >= 0 && Math.abs(ci - pi) <= 3;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Creation lig dropdown var', out.exists === true, '']);
    c.push(['KITA grup başlıkları (≥2)', out.groupHeaders >= 2, `=${out.groupHeaders}`]);
    c.push(['Avrupa + (Asya/Amerika) kıtaları', out.hasAvrupa && out.hasOtherContinent, '']);
    c.push(['KUPA YOK (🏆 listede değil)', out.noCups === true, '']);
    c.push(['Çok lig listeleniyor (≥30)', out.optionCount >= 30, `=${out.optionCount}`]);
    c.push(['Varsayılan tur-super-lig', out.defaultLeague === 'tur-super-lig', `=${out.defaultLeague}`]);
    c.push(['İngiltere kademeleri ardışık (Premier↔Championship)', out.englandTiersGrouped === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ B — YENİ KARİYER LİG SEÇİCİ ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
