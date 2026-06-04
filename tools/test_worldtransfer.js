// Faz 4b doğrulama — DÜNYA AI transfer piyasası: kulüpler-arası taşıma + squadSync relokasyon (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_worldtransfer.js
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
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Tr4b';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot, season = gameState.currentSeason;
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));   // tüm ligler (relokasyon testi)
        await WorldDB.seedCareer(slot);

        // PİYASA
        const n = await runWorldTransferMarket(slot, season + 1);
        r.transferN = n;

        const transfers = await WorldDB.getAllByIndex('transfers', 'bySlot', IDBKeyRange.only(slot));
        r.storeCount = transfers.length;
        r.withinCap = transfers.length <= 900;
        const tr = transfers[0] || null;
        r.sample = tr ? { pid: tr.playerId, name: tr.name, from: tr.fromTeam, to: tr.toTeam, fee: tr.fee } : null;
        r.fieldsOk = !!(tr && tr.playerId != null && tr.fromTeam && tr.toTeam && tr.fromTeam !== tr.toTeam && tr.type === 'transfer');

        // Oyuncunun WorldDB kaydı yeni kulübe geçti mi?
        if (tr) {
            const rec = await WorldDB.get('players', [slot, tr.playerId]);
            r.recTeamUpdated = !!(rec && rec.teamId === tr.toTeam);
        }

        // Overlay yükle → squadSync relokasyon
        await WorldState.ensure(slot, true);
        r.overlay = WorldState._stats();
        if (tr) {
            const toSq = DB.squadSync(tr.toTeam);
            const fromSq = DB.squadSync(tr.fromTeam);
            r.inNewClub = toSq.some(p => p.id === tr.playerId);
            r.outOldClub = !fromSq.some(p => p.id === tr.playerId);
        }
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Transfer gerçekleşti (>0)', out.transferN > 0, `${out.transferN} transfer`]);
    c.push(['transfers store yazıldı = dönüş', out.storeCount === out.transferN && out.storeCount > 0, `${out.storeCount}`]);
    c.push(['CAP (≤900) aşılmadı', out.withinCap === true, '']);
    c.push(['Transfer kaydı alanları doğru', out.fieldsOk === true, JSON.stringify(out.sample)]);
    c.push(['Oyuncu WorldDB kaydı yeni kulübe geçti', out.recTeamUpdated === true, '']);
    c.push(['Overlay transferi yükledi (moved>0)', out.overlay && out.overlay.moved > 0, JSON.stringify(out.overlay)]);
    c.push(['squadSync: oyuncu YENİ kulüpte', out.inNewClub === true, '']);
    c.push(['squadSync: oyuncu ESKİ kulüpte DEĞİL', out.outOldClub === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 4b — dünya AI transfer piyasası ===`);
    console.log(JSON.stringify(out, null, 0).slice(0, 500) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
