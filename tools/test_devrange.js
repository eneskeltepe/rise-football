// Item 3: Gelişim menüsünde zaman aralığı seçici (Son 1ay/3ay/6ay/1yıl/5yıl/Tümü + yıl çipleri).
//   http-server :3000 ayakta iken: node tools/test_devrange.js
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
        document.getElementById('player-lastname').value = 'Range';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(() => {
        const res = {};
        // 2 sezon × 38 hafta antrenman geçmişi enjekte et
        const TH = [];
        for (let s = 2026; s <= 2027; s++) for (let w = 1; w <= 38; w++) {
            TH.push({ season: s, week: w, ovr: 60 + (s - 2026) * 5 + Math.floor(w / 8), main: { hiz: 70, sut: 60, pas: 65, teknik: 68, defans: 50, fizik: 72 }, ovrDelta: 1, src: 'antrenman', note: '' });
        }
        gameState.player.trainingHistory = TH;
        gameState.currentSeason = 2027;

        window._devRange = 'all'; renderDevTrack();
        const content = document.getElementById('dev-track-content').textContent;
        res.chipCount = document.querySelectorAll('#dev-track-content .dev-range-chip').length;
        res.hasMonthChip = /Son 1 Ay/.test(content) && /Son 5 Yıl/.test(content);
        res.hasYearChip = /2026\/27/.test(content) && /2027\/28/.test(content);
        res.allRows = document.querySelectorAll('#dev-track-content .dev-row').length;

        window._devRange = '1m'; renderDevTrack();
        res.month1Rows = document.querySelectorAll('#dev-track-content .dev-row').length;

        window._devRange = '2026'; renderDevTrack();
        res.year2026Rows = document.querySelectorAll('#dev-track-content .dev-row').length;

        window._devRange = '1y'; renderDevTrack();
        res.year1Rows = document.querySelectorAll('#dev-track-content .dev-row').length;
        return res;
    });

    await browser.close();

    const c = [];
    c.push(['Zaman aralığı çipleri (≥8: 6 aralık + yıllar)', out.chipCount >= 8, `=${out.chipCount}`]);
    c.push(['Ay/yıl aralık çipleri (Son 1 Ay…Son 5 Yıl)', out.hasMonthChip === true, '']);
    c.push(['Dinamik yıl çipleri (2026/27, 2027/28)', out.hasYearChip === true, '']);
    c.push(['Tümü: 76 kayıt (2 sezon×38)', out.allRows === 76, `=${out.allRows}`]);
    c.push(['Son 1 Ay: ~4-5 kayıt (<76)', out.month1Rows > 0 && out.month1Rows <= 6, `=${out.month1Rows}`]);
    c.push(['Yıl 2026: 38 kayıt', out.year2026Rows === 38, `=${out.year2026Rows}`]);
    c.push(['Son 1 Yıl: ~38-39 kayıt', out.year1Rows >= 38 && out.year1Rows <= 40, `=${out.year1Rows}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== GELİŞİM ZAMAN ARALIĞI ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
