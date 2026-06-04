// Faz 5 doğrulama — TARİHÇE sekmesi: sezon+lig seç, puan durumu, şampiyon/ödül, maç drill-down (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_historyui.js
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
        document.getElementById('player-lastname').value = 'Hist5';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    // Veri hazırla: 12 hafta simüle + agregat + özet
    await page.evaluate(async () => {
        const slot = gameState._slot, season = gameState.currentSeason;
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));
        await WorldDB.seedCareer(slot);
        const userLg = activeLeagueId(), userTeam = gameState.player.teamId;
        for (let w = 0; w < 12; w++) { simulateWorldWeek(w, userLg, userTeam); await recordWorldWeekDetails(slot, w, season, userLg, userTeam); }
        await WorldDB.aggregatePlayerSeasons(slot, season);
        await WorldDB.computeSeasonSummary(slot, season);
        gameState.historyView = { season: season, league: 'eng-premier-league', week: 0 };
    });

    // NAV: Tarihçe sekmesine tıkla (wiring testi)
    await page.click('.nav-btn[data-target="history-tab"]');
    await new Promise(r => setTimeout(r, 1200));   // async yükleme (loadPlayers + sorgular)

    const out = await page.evaluate(() => {
        const r = {};
        r.tabActive = document.getElementById('history-tab').classList.contains('active');
        r.standRows = document.querySelectorAll('#history-standings table.hist-standings tbody tr').length;
        const sum = document.getElementById('history-summary');
        r.summaryText = sum ? sum.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
        r.hasChampion = !!(sum && sum.querySelector('.hist-champ-val'));
        r.fxRows = document.querySelectorAll('#hist-fx-list .hist-fx-row').length;
        r.weekLabel = (document.getElementById('hist-fx-week') || {}).textContent || '';
        return r;
    });

    // Bir maça tıkla → detay modalı
    let detail = {};
    if (out.fxRows > 0) {
        await page.click('#hist-fx-list .hist-fx-row');
        await new Promise(r => setTimeout(r, 600));
        detail = await page.evaluate(() => {
            const m = document.getElementById('match-detail-modal');
            const body = document.getElementById('match-detail-body');
            return {
                open: m && getComputedStyle(m).display === 'flex',
                hasScore: !!(body && body.querySelector('.md-score')),
                tag: body ? ((body.querySelector('.md-tag') || {}).textContent || '') : ''
            };
        });
    }

    // Hafta ileri navigasyonu
    await page.evaluate(() => { const b = document.getElementById('match-detail-close'); if (b) b.click(); const m = document.getElementById('match-detail-modal'); if (m) m.style.display = 'none'; });
    const nav = await page.evaluate(async () => {
        const before = (document.getElementById('hist-fx-week') || {}).textContent;
        const nx = document.getElementById('hist-fx-next'); if (nx) nx.click();
        await new Promise(r => setTimeout(r, 500));
        const after = (document.getElementById('hist-fx-week') || {}).textContent;
        return { before, after, changed: before !== after };
    });

    await browser.close();

    const c = [];
    c.push(['Tarihçe sekmesi aktifleşti (nav wiring)', out.tabActive === true, '']);
    c.push(['Puan durumu render edildi (>10 satır)', out.standRows > 10, `${out.standRows} satır`]);
    c.push(['Şampiyon/ödül banner\'ı var', out.hasChampion === true, out.summaryText]);
    c.push(['Hafta maçları listelendi (>0)', out.fxRows > 0, `${out.fxRows} maç — ${out.weekLabel}`]);
    c.push(['Maça tıklayınca detay modalı açıldı', detail.open === true, `tag="${detail.tag}"`]);
    c.push(['Detayda skor var', detail.hasScore === true, '']);
    c.push(['Hafta ileri navigasyonu çalışıyor', nav.changed === true, `${nav.before} → ${nav.after}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 5 — Tarihçe (geçmiş sezonlar) UI ===`);
    console.log(JSON.stringify(out, null, 0) + '\n' + JSON.stringify(detail) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
