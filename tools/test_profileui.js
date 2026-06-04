// Faz D doğrulama — tam-ekran profil modalı + mevki yetkinliği & rol uygunluğu grid (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_profileui.js
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
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
        document.getElementById('player-firstname').value = 'Kerem';
        document.getElementById('player-lastname').value = 'Aktürk';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    const out = await page.evaluate(async () => {
        const r = {};
        await DB.loadPlayers('tur-super-lig');
        const gs = 'tur-super-lig__galatasaray';
        const npc = DB.squadSync(gs).find(p => p.attrs && /^\d+$/.test(String(p.id)));
        // --- NPC profili ---
        openPlayerProfile(npc.id, gs);
        await new Promise(res => setTimeout(res, 300));
        const mc = document.querySelector('#player-profile-modal .modal-content');
        r.fullscreenClass = !!(mc && mc.classList.contains('pp-modal-content'));
        const body = document.getElementById('player-profile-body');
        const txt = body ? body.textContent : '';
        r.hasFamSection = txt.includes('Mevki Yetkinliği');
        r.hasRoleSection = txt.includes('Roller');
        r.famChips = body.querySelectorAll('.pp-fam').length;
        r.roleRows = body.querySelectorAll('.pp-role').length;
        r.bestMarked = body.querySelectorAll('.pp-role-best').length === 1;
        r.hasStars = (body.querySelector('.pp-role-stars') || {}).textContent ? true : false;
        r.npcPos = npc.pos;

        // --- Kullanıcı profili de rol bölümü içermeli ---
        openPlayerProfile('USER', gameState.player.teamId);
        await new Promise(res => setTimeout(res, 250));
        const ub = document.getElementById('player-profile-body').textContent;
        r.userHasRoles = ub.includes('Roller') && ub.includes('Mevki Yetkinliği');
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Profil modalı tam-ekran sınıfı (pp-modal-content)', out.fullscreenClass === true, '']);
    c.push(['Mevki Yetkinliği bölümü var', out.hasFamSection === true, `pos=${out.npcPos}`]);
    c.push(['Roller (uygunluk) bölümü var', out.hasRoleSection === true, '']);
    c.push(['Yetkinlik çipleri render edildi', out.famChips > 0, `${out.famChips} çip`]);
    c.push(['Rol satırları render edildi (>1)', out.roleRows > 1, `${out.roleRows} rol`]);
    c.push(['En iyi rol işaretlendi (tam 1)', out.bestMarked === true, '']);
    c.push(['Rol yıldızları gösteriliyor', out.hasStars === true, '']);
    c.push(['Kullanıcı profilinde de rol/yetkinlik var', out.userHasRoles === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ D — tam-ekran profil + rol/yetkinlik grid ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
