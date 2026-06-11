// KRITIK FIX — Dünya kalıcılığı + reload fikstür koruması:
//  (K1) evolveWorld deterministik (careerSalt+sezon+takım tohumlu) → restoreWorldState
//       reload'da güç evrimini AYNEN tekrar kurar; terfi/küme düşme sonuçları
//       gameState.teamLeagues overlay'i ile kalıcıdır (runPromotionRelegation yazar).
//  (K2) loadFromSlot kayıttaki fikstürü (oynanmış skorlarla) KORUR; oynanan maç
//       reload sonrası yeniden "bugünün maçı" olarak sunulmaz.
//   http-server :3000 ayakta iken: node tools/test_worldpersist.js
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
        document.getElementById('player-firstname').value = 'World';
        document.getElementById('player-lastname').value = 'Persist';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    // ---- Bölüm 1: oturum içi (determinizm + overlay + terfi yazımı + skor kaydı) ----
    const s1 = await page.evaluate(() => {
        const r = {};
        const sample = DB.teams().slice(0, 25).map(t => t.id);
        const powers = () => sample.map(id => DB.getTeam(id).power);

        // (a) evolveWorld determinizmi: aynı sezon → aynı kayma; farklı sezon → farklı
        resetWorldToBase(); evolveWorld(2026); const p1 = powers();
        resetWorldToBase(); evolveWorld(2026); const p2 = powers();
        r.evoDet = JSON.stringify(p1) === JSON.stringify(p2);
        resetWorldToBase(); evolveWorld(2027); const p3 = powers();
        r.evoSeasonVaries = JSON.stringify(p1) !== JSON.stringify(p3);

        // (b) restoreWorldState: 2 biten sezonun evrimini tabandan AYNEN tekrar kurar
        resetWorldToBase(); evolveWorld(2026); evolveWorld(2027);
        const expected = powers();
        DB.teams().slice(0, 25).forEach(t => t.power = 50);   // dünyayı boz (bayat/yanlış değerler)
        gameState.currentSeason = 2028;
        restoreWorldState(gameState);
        r.replayOk = JSON.stringify(expected) === JSON.stringify(powers());
        gameState.currentSeason = 2026;
        restoreWorldState(gameState);   // sezona uygun hale dön (taban)

        // (c) teamLeagues overlay'i uygulanır + geri alınır
        const chTeam = DB.teamsInLeague('eng-championship')[0];
        const chId = chTeam && chTeam.id;
        gameState.teamLeagues[chId] = 'eng-premier-league';
        restoreWorldState(gameState);
        r.overlayApplied = DB.getTeam(chId).leagueId === 'eng-premier-league';
        r.overlayInIdx = DB.teamsInLeague('eng-premier-league').some(t => t.id === chId);
        delete gameState.teamLeagues[chId];
        restoreWorldState(gameState);
        r.overlayReverted = DB.getTeam(chId).leagueId === 'eng-championship';

        // (d) runPromotionRelegation hamleleri kalıcı overlay'e YAZAR
        const moves = runPromotionRelegation();
        r.movesN = moves.length;
        r.movesRecorded = moves.length > 0 && moves.every(m => gameState.teamLeagues[m.id] === m.league);
        r.dbMoved = moves.length > 0 && DB.getTeam(moves[0].id).leagueId === moves[0].league;
        r.moveId = moves.length ? moves[0].id : null;
        r.moveLg = moves.length ? moves[0].league : null;

        // (e) oynanmış maç skorları + maç günü işareti → kaydet (reload bunları korumalı)
        const wk0 = gameState.fixtures[0];
        const my = wk0.find(m => !m.isBay && (m.home === gameState.player.teamId || m.away === gameState.player.teamId));
        my.scoreHome = 3; my.scoreAway = 1;
        const other = wk0.find(m => !m.isBay && m !== my);
        other.scoreHome = 2; other.scoreAway = 2;
        gameState.matchesPlayedThisWeek = true;
        gameState.gameDate = 5;   // lig maç günü (oynanmış maç yeniden sunulmamalı)
        r.myHome = my.home; r.myAway = my.away; r.otherHome = other.home;
        saveGame();
        r.slot = gameState._slot;
        return r;
    });

    // ---- Bölüm 2: RELOAD → kayıt yüklenince dünya + fikstür aynen geri gelmeli ----
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));
    const s2 = await page.evaluate((ctx) => {
        const r = {};
        r.loaded = loadFromSlot(ctx.slot) === true;
        const wk0 = gameState.fixtures[0] || [];
        const my = wk0.find(m => m.home === ctx.myHome && m.away === ctx.myAway);
        r.myScoreKept = !!my && my.scoreHome === 3 && my.scoreAway === 1;
        const other = wk0.find(m => m.home === ctx.otherHome);
        r.otherScoreKept = !!other && other.scoreHome === 2 && other.scoreAway === 2;
        // oynanan lig maçı reload sonrası yeniden "bugünün maçı" DEĞİL (skor korunduğu için)
        const today = (typeof matchToday === 'function') ? matchToday() : null;
        r.noReplay = !(today && today.kind === 'league');
        // terfi/küme düşme reload sonrası DB'ye yeniden uygulanır
        r.moveKept = ctx.moveId ? (DB.getTeam(ctx.moveId).leagueId === ctx.moveLg) : false;
        r.fxLeagueOk = gameState._fxLeague === activeLeagueId();
        // yeni-kariyer izolasyonu: resetWorldToBase taşınan takımı orijinal ligine döndürür
        resetWorldToBase();
        r.resetIsolation = ctx.moveId ? (DB.getTeam(ctx.moveId).leagueId !== ctx.moveLg) : false;
        return r;
    }, s1);

    await browser.close();

    const c = [];
    c.push(['evolveWorld deterministik (aynı sezon → aynı güçler)', s1.evoDet === true, '']);
    c.push(['evolveWorld sezona göre değişir', s1.evoSeasonVaries === true, '']);
    c.push(['restoreWorldState 2 sezonluk evrimi AYNEN kurar', s1.replayOk === true, '']);
    c.push(['teamLeagues overlay uygulanır (leagueId + indeks)', s1.overlayApplied === true && s1.overlayInIdx === true, '']);
    c.push(['Overlay silinince taban lige döner', s1.overlayReverted === true, '']);
    c.push(['runPromotionRelegation hamle üretir', s1.movesN > 0, `=${s1.movesN}`]);
    c.push(['Hamleler kalıcı overlay\'e yazıldı', s1.movesRecorded === true, '']);
    c.push(['Hamleler DB\'ye uygulandı', s1.dbMoved === true, '']);
    c.push(['Reload: kayıt yüklendi', s2.loaded === true, '']);
    c.push(['Reload: kullanıcının maç skoru KORUNDU (3-1)', s2.myScoreKept === true, '']);
    c.push(['Reload: diğer maç skoru korundu (2-2)', s2.otherScoreKept === true, '']);
    c.push(['Reload: oynanan maç yeniden sunulMUYOR', s2.noReplay === true, '']);
    c.push(['Reload: terfi/küme düşme korundu', s2.moveKept === true, `${s1.moveId} → ${s1.moveLg}`]);
    c.push(['Reload: _fxLeague aktif lige eşit', s2.fxLeagueOk === true, '']);
    c.push(['resetWorldToBase izolasyonu (yeni kariyer sızıntısız)', s2.resetIsolation === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== KRITIK FIX — DÜNYA KALICILIĞI + RELOAD FİKSTÜR ===`);
    console.log(JSON.stringify({ s1: { evoDet: s1.evoDet, replayOk: s1.replayOk, movesN: s1.movesN }, s2 }).slice(0, 400) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
