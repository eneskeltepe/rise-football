// Faz 2a doğrulama — dünya oyuncuları yaşlanma/OVR evrimi (Puppeteer, gerçek IDB).
//   http-server :3000 ayakta iken: node tools/test_worldlife.js
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE.ERR: ' + m.text()); });

    await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(async () => {
        localStorage.clear();
        await new Promise(res => { const r = indexedDB.deleteDatabase('fc_world_db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Life';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot;
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));
        await WorldDB.seedCareer(slot);

        const all = await WorldDB.getAllByIndex('players', 'bySlot', IDBKeyRange.only(slot));
        r.total = all.length;
        // örnek oyuncular
        const young = all.find(p => p.age <= 19 && p.potential > p.ovr + 4 && !p.retired);
        const old = all.find(p => p.age >= 34 && !p.retired);
        const peak = all.find(p => p.age >= 26 && p.age <= 28 && p.ovr >= 75);
        const snap = x => x ? { id: x.id, name: x.name, age: x.age, ovr: x.ovr, pot: x.potential } : null;
        r.youngBefore = snap(young); r.oldBefore = snap(old); r.peakBefore = snap(peak);

        // 3 sezon evrim (perf: ilk sezonu ölç)
        const t0 = Date.now(); await WorldDB.evolveWorldPlayersSeason(slot); r.oneSeasonMs = Date.now() - t0;
        await WorldDB.evolveWorldPlayersSeason(slot);
        await WorldDB.evolveWorldPlayersSeason(slot);

        const reget = async (x) => x ? snap(await WorldDB.get('players', [slot, x.id])) : null;
        r.youngAfter = await reget(young); r.oldAfter = await reget(old); r.peakAfter = await reget(peak);

        // tüm yaşlar +3 mü (örneklem 200)
        let ageOk = 0, ageBad = 0;
        const byId = {}; for (const p of all) byId[p.id] = p;
        const after = await WorldDB.getAllByIndex('players', 'bySlot', IDBKeyRange.only(slot));
        let checked = 0;
        for (const p of after) {
            if (p.retired) continue;
            const b = byId[p.id]; if (!b) continue;
            if (p.age === b.age + 3) ageOk++; else ageBad++;
            if (++checked >= 4000) break;
        }
        r.ageOk = ageOk; r.ageBad = ageBad;
        // OVR sınırlar içinde mi
        r.ovrOutOfRange = after.filter(p => p.ovr < 40 || p.ovr > 99).length;
        return r;
    });

    await browser.close();

    const checks = [];
    checks.push(['~15k oyuncu mevcut', out.total > 14000, `${out.total}`]);
    checks.push(['Yaşlar +3 arttı (tutarlı)', out.ageBad === 0 && out.ageOk > 3000, `ok=${out.ageOk} bad=${out.ageBad}`]);
    checks.push(['Genç oyuncu gelişti (OVR arttı)', out.youngBefore && out.youngAfter && out.youngAfter.ovr > out.youngBefore.ovr,
        out.youngBefore ? `${out.youngBefore.ovr}→${out.youngAfter.ovr} (yaş ${out.youngBefore.age}→${out.youngAfter.age}, pot ${out.youngBefore.pot})` : 'örnek yok']);
    checks.push(['Yaşlı oyuncu geriledi (OVR düştü)', out.oldBefore && out.oldAfter && out.oldAfter.ovr < out.oldBefore.ovr,
        out.oldBefore ? `${out.oldBefore.ovr}→${out.oldAfter.ovr} (yaş ${out.oldBefore.age}→${out.oldAfter.age})` : 'örnek yok']);
    checks.push(['OVR sınır içinde (40–99)', out.ovrOutOfRange === 0, `${out.ovrOutOfRange} aykırı`]);
    checks.push(['Perf: sezon evrimi (arka plan, chunk\'lı, <9000ms / 15k)', out.oneSeasonMs < 9000, `${out.oneSeasonMs}ms (sezon başına 1 kez, UI bloklamaz)`]);
    checks.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 2a — dünya oyuncu evrimi (${out.total} oyuncu) ===`);
    console.log(`Genç: ${JSON.stringify(out.youngBefore)} → ${JSON.stringify(out.youngAfter)}`);
    console.log(`Yaşlı: ${JSON.stringify(out.oldBefore)} → ${JSON.stringify(out.oldAfter)}`);
    console.log(`Zirve: ${JSON.stringify(out.peakBefore)} → ${JSON.stringify(out.peakAfter)}`);
    console.log(`Sezon evrimi: ${out.oneSeasonMs}ms\n`);
    let pass = 0;
    for (const [name, ok, info] of checks) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${checks.length} geçti.`);
    process.exit(pass === checks.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
