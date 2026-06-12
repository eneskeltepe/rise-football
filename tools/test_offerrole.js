// KULLANICI BİLDİRİMİ FIX — Teklif kadro rolü:
//  calculateRealisticSquadRole'daki genç kapısı (yaş≤19 + kulüp gücü>75) KOŞULSUZDU →
//  1 sezonda yıldızlaşan genç oyuncuya bile TÜM teklifler 'Altyapı / Rotasyon' geliyordu
//  (yüksek OVR'da kulüp havuzu zaten yalnız güçlü kulüpler → istisnasız her teklif).
//  Artık genç kapısı yalnız oyuncu kulüp seviyesinin ALTINDAYSA (diff > 2) uygulanır.
//   http-server :3000 ayakta iken: node tools/test_offerrole.js
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
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Offer';
        document.getElementById('player-lastname').value = 'Role';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(() => {
        const r = {};
        const role = (age, ovr, power) => calculateRealisticSquadRole({ age, ovr }, { power });

        // Genç YILDIZ artık altyapıya itilmez (asıl şikâyet)
        r.youngStar = role(19, 85, 80) === 'Kilit Oyuncu';
        r.youngStarter = role(19, 79, 80) === 'İlk 11';
        // Seviyesi yetmeyen genç hâlâ altyapı/rotasyon görür (kapı korunur)
        r.youngRaw = role(18, 65, 82) === 'Altyapı / Rotasyon';
        r.youngEdge = role(19, 76, 82) === 'Altyapı / Rotasyon';   // diff=6 > 2 → kapı
        // Yaş bağımsız eşikler değişmedi
        r.benchRole = role(24, 70, 86) === 'Yedek Kadro';          // diff=16
        r.rotationRole = role(24, 78, 85) === 'Rotasyon';          // diff=7
        r.keyRole = role(27, 88, 84) === 'Kilit Oyuncu';           // diff=-4

        // E2E: serbest + genç + yüksek OVR oyuncuya gelen tekliflerin HİÇBİRİ altyapı değil
        const p = gameState.player;
        p.teamId = null; p.teamName = 'Serbest Oyuncu';
        p.age = 19; p.ovr = 86;
        gameState.transferOffers = [];
        const _mr = Math.random; Math.random = () => 0.0;   // teklif şansı kesin tutsun
        generateFreeAgentOffers();
        Math.random = _mr;
        const offers = gameState.transferOffers || [];
        r.offersN = offers.length;
        r.noYouthRole = offers.length > 0 && offers.every(o => o.squadRole !== 'Altyapı / Rotasyon');
        r.properRole = offers.length > 0 && offers.every(o => o.squadRole === 'Kilit Oyuncu' || o.squadRole === 'İlk 11' || o.squadRole === 'Rotasyon');
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['19 yaş 85 OVR @ güç-80 kulüp → Kilit Oyuncu', out.youngStar === true, '']);
    c.push(['19 yaş 79 OVR @ güç-80 kulüp → İlk 11', out.youngStarter === true, '']);
    c.push(['18 yaş 65 OVR @ güç-82 kulüp → Altyapı/Rotasyon (kapı korunur)', out.youngRaw === true, '']);
    c.push(['19 yaş 76 OVR @ güç-82 kulüp → Altyapı/Rotasyon (sınırda)', out.youngEdge === true, '']);
    c.push(['Yaş bağımsız eşikler değişmedi (Yedek/Rotasyon/Kilit)', out.benchRole && out.rotationRole && out.keyRole, '']);
    c.push(['E2E: genç yıldıza gelen tekliflerde altyapı rolü YOK', out.noYouthRole === true, `${out.offersN} teklif`]);
    c.push(['E2E: roller OVR-kulüp farkını yansıtıyor', out.properRole === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FIX — TEKLİF KADRO ROLÜ (genç yıldız ≠ altyapı) ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
