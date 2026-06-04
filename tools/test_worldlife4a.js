// Faz 4a doğrulama — sezon geçişinde EMEKLİLİK + REGEN + squadSync overlay (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_worldlife4a.js
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
        document.getElementById('player-lastname').value = 'Life4a';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot, season = gameState.currentSeason;
        const lg = 'tur-super-lig';
        await DB.ensureLeagues([lg]);
        await WorldDB.seedCareer(slot);

        // Emeklilik öncesi: kaç oyuncu yaşı 36+ (emekli adayı)?
        const all = await WorldDB.getAllByIndex('players', 'bySlot', IDBKeyRange.only(slot));
        r.totalPlayers = all.length;
        r.aged36plus = all.filter(p => (p.age || 0) >= 36 && !p.retired).length;

        // SEZON EVRİMİ (emeklilik + regen)
        const ev = await WorldDB.evolveWorldPlayersSeason(slot, season);
        r.evolveResult = ev;

        // Emekliler + regenler
        const retired = await WorldDB.getAllByIndex('players', 'bySlotRetired', IDBKeyRange.only([slot, 1]));
        r.retiredCount = retired.length;
        const all2 = await WorldDB.getAllByIndex('players', 'bySlot', IDBKeyRange.only(slot));
        const regens = all2.filter(p => p.isRegen);
        r.regenCount = regens.length;
        r.regenNumericIds = regens.every(p => /^\d+$/.test(String(p.id)) && Number(p.id) >= 900000000);
        r.regenSample = regens[0] ? { id: regens[0].id, name: regens[0].name, age: regens[0].age, ovr: regens[0].ovr, team: regens[0].teamId, pot: regens[0].potential } : null;

        // Overlay yükle
        await WorldState.ensure(slot, true);
        r.overlayStats = WorldState._stats();

        // tur-super-lig'de emekli olan birini bul → squadSync onu DÖNDÜRMEMELİ
        const retInTur = retired.find(p => p.leagueId === lg && p.teamId);
        if (retInTur) {
            const sq = DB.squadSync(retInTur.teamId);
            r.retiredExcluded = !sq.some(p => p.id === retInTur.id);
            r.retiredTeam = retInTur.teamId;
        } else r.retiredExcluded = 'turda-emekli-yok';

        // tur-super-lig'de regen bul → squadSync onu DÖNDÜRMELİ + playerByIdSync ad çözmeli
        const regInTur = regens.find(p => p.leagueId === lg && p.teamId);
        if (regInTur) {
            const sq = DB.squadSync(regInTur.teamId);
            r.regenIncluded = sq.some(p => p.id === regInTur.id);
            r.regenNameResolved = !!(DB.playerByIdSync(regInTur.id));
            r.regenAgeAdj = (typeof ageAdjustedOvr === 'function') ? ageAdjustedOvr(regInTur, season - 2026) : null;
            r.regenRawOvr = regInTur.ovr;
        } else { r.regenIncluded = 'turda-regen-yok'; }

        // Reversibility: overlay invalidate → squadSync v2.0 gibi (emekli geri döner)
        if (retInTur) {
            WorldState.invalidate();
            const sq2 = DB.squadSync(retInTur.teamId);
            r.reversible = sq2.some(p => p.id === retInTur.id);   // overlay kapalı → ham JSON'da var
        }
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Dünya tohumlandı (>10k oyuncu)', out.totalPlayers > 10000, `${out.totalPlayers} oyuncu`]);
    c.push(['Emeklilik gerçekleşti (>0)', out.retiredCount > 0, `${out.retiredCount} emekli (36+ aday: ${out.aged36plus})`]);
    c.push(['Regen üretildi (>0)', out.regenCount > 0, `${out.regenCount} regen`]);
    c.push(['Regen id sayısal + ≥900M (playerSeasons çalışır)', out.regenNumericIds === true, JSON.stringify(out.regenSample)]);
    c.push(['Overlay yüklendi (retired+regen)', out.overlayStats && out.overlayStats.retired > 0 && out.overlayStats.regenTeams > 0, JSON.stringify(out.overlayStats)]);
    c.push(['squadSync emekliyi ÇIKARIYOR', out.retiredExcluded === true, `team=${out.retiredTeam}`]);
    c.push(['squadSync regeni EKLİYOR', out.regenIncluded === true, '']);
    c.push(['Regen adı çözülüyor (playerByIdSync)', out.regenNameResolved === true, '']);
    c.push(['Regen ageAdjustedOvr = ham OVR (çift yaşlanma yok)', out.regenAgeAdj === out.regenRawOvr, `adj=${out.regenAgeAdj} ham=${out.regenRawOvr}`]);
    c.push(['Reversible: overlay kapalı → emekli geri döner', out.reversible === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 4a — emeklilik + regen + squadSync overlay ===`);
    console.log(JSON.stringify(out, null, 0).slice(0, 600) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
