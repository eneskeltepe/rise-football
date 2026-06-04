// Faz 0 doğrulama — fc_world_db tohumlama + slot izolasyonu (Puppeteer, gerçek IndexedDB).
// Çalıştırma: http-server :3000 ayakta iken `node tools/test_worlddb.js`
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
        // taze dünya DB: varsa sil ki şema temiz kurulsun
        await new Promise(res => { const r = indexedDB.deleteDatabase('fc_world_db'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));

    const out = await page.evaluate(async () => {
        const r = {};
        // --- Store şeması kuruldu mu ---
        const db = await WorldDB.open();
        r.stores = Array.from(db.objectStoreNames).sort();

        // --- Slot 0 tohumla ---
        const t0 = Date.now();
        r.seed0 = await WorldDB.seedCareer(0);
        r.seed0ms = Date.now() - t0;

        // --- Beklenen oyuncu sayısı: tüm 'league' liglerinin DISTINCT id'leri ---
        const leagues = DB.leagues().filter(l => l.type !== 'cup');
        let sum = 0; const ids = new Set();
        for (const l of leagues) { const ps = DB.playersInLeagueSync(l.id); sum += ps.length; for (const p of ps) ids.add(p.id); }
        r.leagueCount = leagues.length;
        r.sumPlayers = sum;
        r.distinctIds = ids.size;
        r.count0 = await WorldDB.count('players', 0);
        r.teamSeasons0 = await WorldDB.count('teamSeasons', 0);
        r.expectedTeams = leagues.reduce((a, l) => a + DB.teamsInLeague(l.id).length, 0);

        // --- Örnek kayıt şekli (Galatasaray) ---
        const gsq = await WorldDB.squadFromDB(0, 'tur-super-lig__galatasaray');
        const s = gsq[0] || null;
        r.galaSquad = gsq.length;
        r.sampleRec = s ? {
            name: s.name, slot: s.slot, retired: s.retired, fitness: s.fitness, form: s.form,
            hasPotential: typeof s.potential === 'number', potGEovr: s.potential >= s.ovr,
            hasAttrs: !!(s.attrs && Object.keys(s.attrs).length >= 20),
            hasStats: !!(s.stats && typeof s.stats.hiz === 'number'),
            contractYears: s.contractYears, leagueId: s.leagueId,
            valueNum: typeof s.value === 'number', wageNum: typeof s.wage === 'number',
            injuryNull: s.injury === null, suspNull: s.suspension === null
        } : null;

        // --- Meta ---
        r.seeded0 = await WorldDB.isSeeded(0);
        r.season0 = await WorldDB.getMeta(0, 'season');
        r.schemaVer0 = await WorldDB.getMeta(0, 'schemaVersion');

        // --- Slot izolasyonu: slot 1 tohumla, sonra clearSlot(1) ---
        r.seed1 = await WorldDB.seedCareer(1);
        r.count1 = await WorldDB.count('players', 1);
        r.cleared1 = await WorldDB.clearSlot(1);
        r.count1after = await WorldDB.count('players', 1);
        r.count0after = await WorldDB.count('players', 0);   // slot 0 bozulmamalı
        r.seeded1after = await WorldDB.isSeeded(1);           // slot 1 meta da silinmeli

        // --- İdempotent yeniden tohumlama: slot 0'ı tekrar tohumla, sayı sabit kalmalı ---
        await WorldDB.seedCareer(0);
        r.count0reseed = await WorldDB.count('players', 0);

        return r;
    });

    await browser.close();

    // ---- Değerlendirme ----
    const checks = [];
    const need = ['players', 'playerSeasons', 'matches', 'teamSeasons', 'transfers', 'meta'];
    checks.push(['Tüm store\'lar kuruldu', need.every(s => out.stores.includes(s)), out.stores.join(',')]);
    checks.push(['Oyuncu sayısı = distinct id (slot 0)', out.count0 === out.distinctIds, `count=${out.count0} distinct=${out.distinctIds} (toplam satır=${out.sumPlayers})`]);
    checks.push(['teamSeasons = takım sayısı', out.teamSeasons0 === out.expectedTeams, `ts=${out.teamSeasons0} takım=${out.expectedTeams}`]);
    checks.push(['Galatasaray kadrosu > 0', out.galaSquad > 0, `${out.galaSquad} oyuncu`]);
    checks.push(['Örnek kayıt: slot=0', out.sampleRec && out.sampleRec.slot === 0, JSON.stringify(out.sampleRec)]);
    checks.push(['Örnek kayıt: potansiyel sayısal & >= ovr', out.sampleRec && out.sampleRec.hasPotential && out.sampleRec.potGEovr, '']);
    checks.push(['Örnek kayıt: 20+ özellik + stats', out.sampleRec && out.sampleRec.hasAttrs && out.sampleRec.hasStats, '']);
    checks.push(['Örnek kayıt: yaşam alanları (retired=0, fitness=100, injury/susp=null)', out.sampleRec && out.sampleRec.retired === 0 && out.sampleRec.fitness === 100 && out.sampleRec.injuryNull && out.sampleRec.suspNull, '']);
    checks.push(['Meta: seeded=true, season set, schemaVer=1', out.seeded0 === true && !!out.season0 && out.schemaVer0 === 1, `season=${out.season0} ver=${out.schemaVer0}`]);
    checks.push(['Slot izolasyonu: slot1 sayısı = slot0', out.count1 === out.count0, `s1=${out.count1} s0=${out.count0}`]);
    checks.push(['clearSlot(1): slot1 boşaldı', out.count1after === 0, `kalan=${out.count1after}, silinen=${out.cleared1}`]);
    checks.push(['clearSlot(1): slot0 BOZULMADI', out.count0after === out.count0, `s0=${out.count0after}`]);
    checks.push(['clearSlot(1): slot1 meta silindi', out.seeded1after === false, '']);
    checks.push(['İdempotent reseed: slot0 sayısı sabit', out.count0reseed === out.count0, `reseed=${out.count0reseed}`]);
    checks.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 5).join(' | ')]);

    console.log(`\n=== FAZ 0 — fc_world_db DOĞRULAMA ===`);
    console.log(`Tohumlama: ${out.seed0.leagues} lig, ${out.seed0.players} oyuncu, sezon ${out.seed0.season} (${out.seed0ms}ms)\n`);
    let pass = 0;
    for (const [name, ok, info] of checks) {
        console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${info ? '  — ' + info : ''}`);
        if (ok) pass++;
    }
    console.log(`\nSONUÇ: ${pass}/${checks.length} geçti.`);
    process.exit(pass === checks.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
