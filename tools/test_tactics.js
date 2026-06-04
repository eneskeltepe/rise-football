// Faz B doğrulama — taktik çeşitliliği (gerçek formasyonlar) + mantalite + dinamik AI (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_tactics.js
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

    const out = await page.evaluate(() => {
        const r = {};
        // 1) Tüm formasyonlar 11 slot, tam 1 kaleci, koordinatlar hizalı
        let allValid = true, gkOne = true;
        for (const name of FORMATION_NAMES) {
            const f = FORMATIONS[name];
            if (f.length !== 11) allValid = false;
            if (f.filter(s => s.key === 'Kaleci').length !== 1) gkOne = false;
            if (formationSlots(name).length !== 11 || formationCoords(name).length !== 11) allValid = false;
        }
        r.formationCount = FORMATION_NAMES.length;
        r.allValid = allValid; r.gkOne = gkOne;

        // 2) Gerçek kompozisyon: 4-4-2 → 2 Santrfor slotu; 3-5-2 → 3 Stoper; 5-4-1 → 3 Stoper+1 ST
        const cnt = (name, key) => FORMATIONS[name].filter(s => s.key === key).length;
        r.f442_2st = cnt('4-4-2', 'Santrfor') === 2;
        r.f352_3cb = cnt('3-5-2', 'Stoper') === 3 && cnt('3-5-2', 'Santrfor') === 2;
        r.f541_def = cnt('5-4-1', 'Stoper') === 3 && cnt('5-4-1', 'Santrfor') === 1;

        // 3) _buildXI gerçek kompozisyon üretir (4-4-2 → XI'da 2 Santrfor)
        const A = {}; ['bitiricilik', 'kisaPas', 'ayaktaMudahale', 'guc'].forEach(k => A[k] = 60);
        function mk(id, pos, ovr) { return { id, name: 'P' + id, pos, ovr, attrs: A, age: 25 }; }
        const squad = [mk(1, 'Kaleci', 80), mk(2, 'Kaleci', 70),
            mk(3, 'Stoper', 80), mk(4, 'Stoper', 79), mk(5, 'Stoper', 75), mk(6, 'Sağ Bek', 78), mk(7, 'Sol Bek', 78),
            mk(8, 'Merkez OS', 80), mk(9, 'Merkez OS', 79), mk(10, 'DOS', 78), mk(11, 'Ofansif OS', 80),
            mk(12, 'Sağ Kanat', 81), mk(13, 'Sol Kanat', 81), mk(14, 'Santrfor', 84), mk(15, 'Santrfor', 82)];
        const xi442 = _buildXI(squad, 0, 70, null, formationSlots('4-4-2')).xi;
        r.buildXI442 = xi442.filter(p => p.position === 'Santrfor').length === 2;
        const xi352 = _buildXI(squad, 0, 70, null, formationSlots('3-5-2')).xi;
        r.buildXI352 = xi352.filter(p => p.position === 'Stoper').length === 3;

        // 4) pickFormation çeşitlilik (farklı güç/takımlar → ≥3 farklı formasyon)
        const got = {};
        for (let i = 0; i < 16; i++) {
            const power = 60 + i * 2;
            const fname = pickFormation(squad, { id: 'team_' + i, power });
            got[fname] = 1;
        }
        r.formationVariety = Object.keys(got).length;

        // 5) Mantalite
        r.facBalanced1 = mentalityFactor('balanced') === 1.0;
        r.facOrder = mentalityFactor('attack') > 1.0 && mentalityFactor('defend') < 1.0;
        r.mentStrong = pickMentality({ power: 85 }, { power: 70 }, true) === 'attack';
        r.mentWeak = pickMentality({ power: 65 }, { power: 82 }, false) === 'defend';

        // 6) Dinamik AI: geride + geç dakika → hücum
        activeMatch.isHome = true; activeMatch.scoreHome = 0; activeMatch.scoreAway = 1;
        activeMatch.myMentality = 'balanced'; activeMatch.oppMentality = 'balanced';
        const ad = adaptTactics('MY', 72);
        r.adaptToAttack = !!(ad && ad.mentality === 'attack') && activeMatch.myMentality === 'attack';
        // önde + son dakika → koru
        activeMatch.scoreHome = 2; activeMatch.scoreAway = 0; activeMatch.myMentality = 'balanced';
        const ad2 = adaptTactics('MY', 80);
        r.adaptToDefend = !!(ad2 && ad2.mentality === 'defend');

        // 7) Saha render (3-5-2) hatasız + 11 düğüm
        matchLineups.currentTab = 'myteam';
        matchLineups.myTeam = xi352; matchLineups.myFormation = '3-5-2';
        try { renderMatchLineupPitch(); r.renderOk = true; } catch (e) { r.renderOk = false; r.renderErr = e.message; }
        r.pitchNodes = document.querySelectorAll('#match-lineup-pitch .pitch-player-node').length;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['6 formasyon tanımlı', out.formationCount === 6, `${out.formationCount}`]);
    c.push(['Tüm formasyonlar 11 slot + koordinat hizalı', out.allValid === true, '']);
    c.push(['Her formasyonda tam 1 kaleci', out.gkOne === true, '']);
    c.push(['4-4-2 → 2 forvet kompozisyonu', out.f442_2st === true, '']);
    c.push(['3-5-2 → 3 stoper + 2 forvet', out.f352_3cb === true, '']);
    c.push(['5-4-1 → 3 stoper + 1 forvet', out.f541_def === true, '']);
    c.push(['_buildXI 4-4-2 → XI\'da 2 forvet', out.buildXI442 === true, '']);
    c.push(['_buildXI 3-5-2 → XI\'da 3 stoper', out.buildXI352 === true, '']);
    c.push(['Formasyon çeşitliliği (≥3 farklı)', out.formationVariety >= 3, `${out.formationVariety} farklı`]);
    c.push(['Mantalite: dengeli=1.0 (denge korunur)', out.facBalanced1 === true, '']);
    c.push(['Mantalite çarpan sırası (hücum>1>savunma)', out.facOrder === true, '']);
    c.push(['Güçlü ev sahibi → hücum mantalitesi', out.mentStrong === true, '']);
    c.push(['Zayıf deplasman → savunma mantalitesi', out.mentWeak === true, '']);
    c.push(['Dinamik AI: geride+geç → hücum', out.adaptToAttack === true, '']);
    c.push(['Dinamik AI: önde+son dk → koru', out.adaptToDefend === true, '']);
    c.push(['Saha render hatasız + 11 düğüm', out.renderOk === true && out.pitchNodes === 11, `${out.pitchNodes} düğüm ${out.renderErr || ''}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ B — taktik çeşitliliği + mantalite + dinamik AI ===`);
    console.log(JSON.stringify(out).slice(0, 600) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
