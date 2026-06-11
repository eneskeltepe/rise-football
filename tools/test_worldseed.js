// YUKSEK FIX (Y4) — İçe aktarılan kayıt / temizlenmiş IndexedDB'de dünya artık ÖLÜ kalmaz:
//  (a) importSaveFromFile hedef slotun ESKİ dünya verisini (fc_world_db) temizler,
//  (b) loadCareerSlot tohumlanmamış slotu arka planda tohumlamaya başlar,
//  (c) seedCareerIfNeeded tohumlanmış slotta atlar (çifte tohum yok).
//   http-server :3000 ayakta iken: node tools/test_worldseed.js
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PE: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CE: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(async () => {
        localStorage.clear();
        await new Promise(res => { const r = indexedDB.deleteDatabase('fc_world_db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'World';
        document.getElementById('player-lastname').value = 'Seed';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 500));

    // ---- Bölüm 1: import hedef slotun eski dünya verisini temizler + skip mantığı ----
    const s1 = await page.evaluate(async () => {
        const r = {};
        const target = firstEmptySlot();
        r.target = target;
        // hedef slota SAHTE "eski kariyer" dünya verisi koy (üzerine import gelecek)
        await WorldDB.putAll('players', [{ slot: target, id: 999001, name: 'Stale Player', retired: 0, teamId: 'x__y', pos: 'Santrfor', ovr: 70 }]);
        await WorldDB.setMeta(target, 'seeded', 1);
        r.stalePlanted = (await WorldDB.count('players', target)) === 1;

        // mevcut kariyerin json'unu "içe aktarılan dosya" olarak ver
        const raw = localStorage.getItem(slotKey(gameState._slot));
        const file = new File([raw], 'fc_import_test.json', { type: 'application/json' });
        importSaveFromFile(file);

        // FileReader + clearSlot async → temizlenene kadar bekle (maks ~6sn)
        let cleared = false;
        for (let k = 0; k < 24 && !cleared; k++) {
            await new Promise(res => setTimeout(res, 250));
            const n = await WorldDB.count('players', target);
            const sd = await WorldDB.isSeeded(target);
            if (n === 0 && !sd) cleared = true;
        }
        r.imported = !!localStorage.getItem(slotKey(target));
        r.staleCleared = cleared;

        // seedCareerIfNeeded: tohumlanmış slotta ATLAR (çifte tohum koruması)
        await WorldDB.setMeta(7, 'seeded', 1);
        const sk = await WorldDB.seedCareerIfNeeded(7);
        r.skipWhenSeeded = !!(sk && sk.skipped);
        return r;
    });

    // ---- Bölüm 2: tohumsuz slotu yükle → tohumlama TETİKLENİR (oyuncular yazılmaya başlar) ----
    const s2 = await page.evaluate(async (target) => {
        const r = {};
        loadCareerSlot(target);
        r.activeSlot = gameState._slot === target;
        let started = false, n = 0;
        for (let k = 0; k < 120 && !started; k++) {        // 120 × 500ms = 60sn tavan
            await new Promise(res => setTimeout(res, 500));
            n = await WorldDB.count('players', target);
            if (n > 0) started = true;
        }
        r.seedStarted = started;
        r.seedCount = n;
        return r;
    }, s1.target);

    await browser.close();

    const c = [];
    c.push(['Sahte eski-dünya verisi ekildi', s1.stalePlanted === true, '']);
    c.push(['Kayıt içe aktarıldı', s1.imported === true, `slot ${s1.target}`]);
    c.push(['Import: hedef slotun ESKİ dünya verisi temizlendi', s1.staleCleared === true, '']);
    c.push(['seedCareerIfNeeded tohumlu slotta atlıyor', s1.skipWhenSeeded === true, '']);
    c.push(['Yükleme: içe aktarılan kariyer aktif', s2.activeSlot === true, '']);
    c.push(['Yükleme: tohumlama tetiklendi (oyuncular yazılıyor)', s2.seedStarted === true, `=${s2.seedCount} kayıt`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== YUKSEK FIX — DÜNYA DB TOHUMLAMA (IMPORT/YÜKLEME) ===`);
    console.log(JSON.stringify({ s1, s2 }) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
