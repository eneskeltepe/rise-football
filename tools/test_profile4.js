// FM-tarzı GEÇMİŞ sekmesi: transfer geçmişi (kullanıcı + NPC WorldDB) + NPC yaş-bazlı gelişim eğrisi.
//   http-server :3000 ayakta iken: node tools/test_profile4.js
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
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Test';
        document.getElementById('player-lastname').value = 'Forvet';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 300));

    const out = await page.evaluate(async () => {
        const r = {}, body = () => document.getElementById('player-profile-body');
        await DB.loadPlayers('tur-super-lig');
        const gala = 'tur-super-lig__galatasaray', fener = 'tur-super-lig__fenerbahce';
        const slot = gameState._slot, season = gameState.currentSeason;

        // --- NPC: WorldDB'ye transfer + kiralık kaydı yaz ---
        const npc = DB.squadSync(gala).find(p => p.attrs && /^\d+$/.test(String(p.id)) && p.pos !== 'Kaleci');
        await WorldDB.putAll('transfers', [
            { slot, season: season - 1, playerId: npc.id, fromTeam: fener, toTeam: gala, fromName: 'Fenerbahçe', toName: 'Galatasaray', fee: 12000000, type: 'transfer' },
            { slot, season: season - 2, playerId: npc.id, fromTeam: gala, toTeam: fener, fromName: 'Galatasaray', toName: 'Fenerbahçe', fee: 0, type: 'loan' },
        ]);
        openPlayerProfile(npc.id, gala);
        await new Promise(res => setTimeout(res, 350));
        const b = body();
        // Geçmiş sekmesine geç
        b.querySelector('.pp-tab[data-pane="gecmis"]').click();
        const trHost = b.querySelector('#pp-transfers');
        r.npcTransferRows = trHost ? trHost.querySelectorAll('.pp-tr-row').length : 0;
        r.npcHasFee = trHost ? /12[.,]?0?M|12\.0M|12M|12\.000\.000/.test(trHost.textContent) || /M €|M$|Milyon/i.test(trHost.textContent) : false;
        r.npcHasLoan = trHost ? trHost.textContent.includes('Kiralık') : false;
        r.npcFeeText = trHost ? trHost.textContent.replace(/\s+/g, ' ').slice(0, 160) : '';
        // Gelişim sekmesi: NPC için GERÇEK özellik gelişimi (base→şimdi delta satırları).
        // (Taze kariyerde 0 sezon geçtiği için OVR eğrisi yok ama 6 özellik satırı her zaman var.)
        b.querySelector('.pp-tab[data-pane="gelisim"]').click();
        r.npcDevRows = b.querySelectorAll('#pp-devcurve .pp-dev-row').length;
        r.npcDevDelta = !!b.querySelector('#pp-devcurve .pp-dev-d');
        document.getElementById('player-profile-modal').style.display = 'none';

        // --- KULLANICI: transferHistory göster ---
        gameState.player.transferHistory = [
            { season: season - 1, from: 'Beşiktaş', to: 'Galatasaray', fee: 8000000, type: 'transfer' },
            { season: season - 2, from: 'Altyapı', to: 'Beşiktaş', fee: 0, type: 'free' },
        ];
        openPlayerProfile('USER', gameState.player.teamId);
        await new Promise(res => setTimeout(res, 200));
        const ub = body();
        ub.querySelector('.pp-tab[data-pane="gecmis"]').click();
        const uTr = ub.querySelector('#pp-transfers');
        r.userTransferRows = uTr ? uTr.querySelectorAll('.pp-tr-row').length : 0;
        r.userHasGala = uTr ? uTr.textContent.includes('Galatasaray') : false;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['NPC transfer geçmişi 2 satır (WorldDB)', out.npcTransferRows === 2, `=${out.npcTransferRows}`]);
    c.push(['NPC bonservis tutarı görünüyor', out.npcHasFee === true, out.npcFeeText]);
    c.push(['NPC kiralık etiketi görünüyor', out.npcHasLoan === true, '']);
    c.push(['NPC gelişim: 6 özellik satırı (base→şimdi)', out.npcDevRows === 6, '=' + out.npcDevRows]);
    c.push(['NPC gelişim: delta (±) gösterimi', out.npcDevDelta === true, '']);
    c.push(['Kullanıcı transfer geçmişi 2 satır', out.userTransferRows === 2, `=${out.userTransferRows}`]);
    c.push(['Kullanıcı geçmişinde Galatasaray var', out.userHasGala === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== PROFİL GEÇMİŞ SEKMESİ: TRANSFER + YAŞ EĞRİSİ ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
