// Faz 3a doğrulama — maç detayı saklı olaylardan render ediliyor (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_matchdetail.js
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
        document.getElementById('player-lastname').value = 'MD';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const setup = await page.evaluate(async () => {
        const slot = gameState._slot, season = gameState.currentSeason;
        const userLg = activeLeagueId(), userTeam = gameState.player.teamId;
        await DB.ensureLeagues(DB.leagues().filter(l => l.type === 'league').map(l => l.id));
        await WorldDB.seedCareer(slot);
        for (let w = 0; w < 4; w++) { simulateWorldWeek(w, userLg, userTeam); await recordWorldWeekDetails(slot, w, season, userLg, userTeam); }
        // gollü bir Premier maçı bul
        const otherLg = 'eng-premier-league';
        for (let w = 0; w < 4; w++) {
            const ms = await WorldDB.matchesOfWeek(slot, season, otherLg, w);
            const g = ms.find(m => m.sh + m.sa >= 2);
            if (g) return { found: true, lg: otherLg, w, home: g.home, away: g.away, sh: g.sh, sa: g.sa, season,
                goalEvents: g.events.filter(e => e.type === 'goal').length };
        }
        return { found: false };
    });

    let dom = {};
    if (setup.found) {
        await page.evaluate((s) => { openMatchDetail(s.lg, s.w, s.home, s.away, s.season); }, setup);
        await new Promise(r => setTimeout(r, 700));   // async IDB + render
        dom = await page.evaluate(() => {
            const body = document.getElementById('match-detail-body');
            const tag = body.querySelector('.md-tag') ? body.querySelector('.md-tag').textContent.trim() : '';
            const goalEvs = body.querySelectorAll('.md-ev:not(.md-card)').length;
            const score = body.querySelector('.md-score') ? body.querySelector('.md-score').textContent.replace(/\s+/g, '') : '';
            const hasAssist = body.innerHTML.includes('(') && /\(/.test(body.innerHTML);
            return { tag, goalEvs, score, sample: body.querySelector('.md-ev') ? body.querySelector('.md-ev').textContent.trim() : '' };
        });
    }

    await browser.close();

    const checks = [];
    checks.push(['Gollü saklı maç bulundu', setup.found, setup.found ? `${setup.home} ${setup.sh}-${setup.sa} ${setup.away}` : '']);
    checks.push(['Detay "saklı" etiketiyle (tahmini DEĞİL)', dom.tag === 'Maç detayı', `etiket: "${dom.tag}"`]);
    checks.push(['Render edilen gol olayı = skor', dom.goalEvs === (setup.sh + setup.sa), `dom=${dom.goalEvs} skor=${setup.sh + setup.sa}`]);
    checks.push(['Skor başlıkta doğru', dom.score === `${setup.sh}-${setup.sa}`, `"${dom.score}"`]);
    checks.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ 3a — maç detayı saklı olaylardan ===`);
    console.log(`Maç: ${setup.found ? `${setup.home} ${setup.sh}-${setup.sa} ${setup.away}` : 'yok'} | etiket="${dom.tag}" | gol olayı render=${dom.goalEvs} | örnek="${dom.sample}"\n`);
    let pass = 0;
    for (const [name, ok, info] of checks) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${checks.length} geçti.`);
    process.exit(pass === checks.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
