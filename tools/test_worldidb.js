// Faz 1b doğrulama — dünya maçları IDB'ye yazılıyor + tutarlılık + perf (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_worldidb.js
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

    // Kariyer oluştur (Galatasaray / tur-super-lig)
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Dunya';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        const slot = gameState._slot;
        const season = gameState.currentSeason;
        const userLg = activeLeagueId();
        const userTeam = gameState.player.teamId;
        const otherLg = 'eng-premier-league';
        const W = 6;

        // tüm kadrolar + tohum hazır olsun (deterministik test)
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));
        await WorldDB.seedCareer(slot);

        // Gerçek akışı taklit et: her hafta simulateWorldWeek (standings) + recordWorldWeekDetails (IDB)
        const t0 = Date.now();
        for (let w = 0; w < W; w++) {
            simulateWorldWeek(w, userLg, userTeam);
            await recordWorldWeekDetails(slot, w, season, userLg, userTeam);
        }
        r.perMs = Math.round((Date.now() - t0) / W);
        r.totalMs = Date.now() - t0;

        r.matchCount = await WorldDB.count('matches', slot);

        // --- Bir maçın olay/skor değişmezi + örnek olaylar ---
        const wk0 = await WorldDB.matchesOfWeek(slot, season, otherLg, 0);
        r.wk0Count = wk0.length;
        let invFail = 0, withGoalEvents = 0, sampleEv = null;
        for (const m of wk0) {
            let gh = 0, ga = 0;
            for (const ev of m.events) { if (ev.type === 'goal') { if (ev.teamId === m.home) gh++; else ga++; } }
            if (gh !== m.sh || ga !== m.sa) invFail++;
            if (m.events.some(e => e.type === 'goal')) withGoalEvents++;
            if (!sampleEv && m.events.length) sampleEv = { score: m.sh + '-' + m.sa, events: m.events.slice(0, 4) };
        }
        r.invFail = invFail; r.withGoalEvents = withGoalEvents; r.sampleEv = sampleEv;

        // --- Tutarlılık: otherLg için Σ maç GF == teamSeasons GF == standings GF ---
        let matchGF = 0;
        for (let w = 0; w < W; w++) { const ms = await WorldDB.matchesOfWeek(slot, season, otherLg, w); for (const m of ms) matchGF += m.sh + m.sa; }
        const ts = await WorldDB.getAllByIndex('teamSeasons', 'bySlotSeasonLeague', IDBKeyRange.only([slot, season, otherLg]));
        let tsGF = 0; for (const t of ts) tsGF += t.GF;
        let stGF = 0; const tbl = gameState.standings[otherLg]; for (const k in tbl) stGF += tbl[k].goalsFor;
        r.matchGF = matchGF; r.tsGF = tsGF; r.stGF = stGF;
        r.tsCount = ts.length;

        // --- rank snapshot mantıklı mı (1..N) ---
        const ranks = ts.map(t => t.rank).sort((a, b) => a - b);
        r.ranksOk = ranks[0] === 1 && ranks[ranks.length - 1] === ts.length;

        // --- Entegre yol: advanceWeek HENÜZ KAYDEDİLMEMİŞ bir haftayı tetikliyor mu? ---
        // (elle 0..5 kaydedildi; advanceWeek currentWeek-1'i kaydeder → taze hafta 7 seç)
        gameState.currentWeek = 8; gameState._lastSimWeek = 6;
        const before = await WorldDB.count('matches', slot);
        advanceWeek();
        await new Promise(res => setTimeout(res, 1500));   // fire-and-forget bitsin
        r.afterAdvance = await WorldDB.count('matches', slot);
        r.advanceGrew = r.afterAdvance > before;

        return r;
    });

    await browser.close();

    const checks = [];
    checks.push(['Maçlar IDB\'ye yazıldı (>1500)', out.matchCount > 1500, `${out.matchCount} maç / 6 hafta (~${Math.round(out.matchCount / 6)}/hafta)`]);
    checks.push(['Premier Lig hafta 0 maçları var', out.wk0Count >= 8, `${out.wk0Count} maç`]);
    checks.push(['Değişmez: gol olayı = skor (0 ihlal)', out.invFail === 0, `${out.invFail} ihlal`]);
    checks.push(['Tutarlılık: Σ maç GF == teamSeasons GF', out.matchGF === out.tsGF, `maç=${out.matchGF} ts=${out.tsGF}`]);
    checks.push(['Tutarlılık: teamSeasons GF == standings GF', out.tsGF === out.stGF, `ts=${out.tsGF} st=${out.stGF}`]);
    checks.push(['teamSeasons rank 1..N tutarlı', out.ranksOk, `${out.tsCount} takım`]);
    checks.push(['advanceWeek IDB kaydını tetikliyor', out.advanceGrew, `${out.afterAdvance} maç`]);
    checks.push(['Perf: hafta başına makul (<1500ms)', out.perMs < 1500, `${out.perMs}ms/hafta (toplam ${out.totalMs}ms/6)`]);
    checks.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 1b — dünya maçları IDB ===`);
    console.log(`Perf: ${out.perMs}ms/hafta | Maç sayısı: ${out.matchCount} | Örnek (Premier wk0):`, JSON.stringify(out.sampleEv));
    console.log(`Tutarlılık (Premier): Σmaç=${out.matchGF}  teamSeasons=${out.tsGF}  standings=${out.stGF}\n`);
    let pass = 0;
    for (const [name, ok, info] of checks) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${checks.length} geçti.`);
    process.exit(pass === checks.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
