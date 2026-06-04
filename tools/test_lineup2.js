// Ayak tercihi (sol/sağ savunma yerleşimi) + SAHA görünümünde oyuncuya tıklama doğrulaması.
//   http-server :3000 ayakta iken: node tools/test_lineup2.js
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

    const out = await page.evaluate(async () => {
        const r = {};
        await DB.loadPlayers('tur-super-lig');
        // 4-4-2 slot index'leri: [KL,Bek(x15 sol),Stoper(x38 sol),Stoper(x62 sağ),Bek(x85 sağ),MÖ,MÖ,Kanat,Kanat,SNT,SNT]
        const mkXI = (feet) => feet.map((f, i) => ({ name: 'P' + i, position: 'x', label: 'x', isUser: false, pid: 'p' + i, foot: f }));

        // S1: sol slotta sağ ayaklı, sağ slotta sol ayaklı → TAKAS olmalı
        let xi = mkXI(['Sağ', 'Sağ', 'Sağ', 'Sol', 'Sol', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ']);
        _applyFootedness(xi, '4-4-2');
        r.s1_bekLeft = xi[1].foot;     // Sol bekleniyor (takas)
        r.s1_bekRight = xi[4].foot;    // Sağ bekleniyor
        r.s1_stpLeft = xi[2].foot;     // Sol bekleniyor
        r.s1_stpRight = xi[3].foot;    // Sağ bekleniyor

        // S2: aynı ayak → takas YOK (OVR sırası korunur)
        let xi2 = mkXI(['Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ']);
        xi2[1].pid = 'A'; xi2[4].pid = 'B';
        _applyFootedness(xi2, '4-4-2');
        r.s2_sameNoSwap = xi2[1].pid === 'A' && xi2[4].pid === 'B';

        // S3: kullanıcı yerinden oynatılmaz
        let xi3 = mkXI(['Sağ', 'Sağ', 'Sağ', 'Sol', 'Sol', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ', 'Sağ']);
        xi3[1].isUser = true;
        _applyFootedness(xi3, '4-4-2');
        r.s3_userNotMoved = xi3[1].isUser === true && xi3[1].foot === 'Sağ';

        // S4: gerçek kadroda _buildXI çıktısında foot alanı var mı
        const built = _buildXI(DB.squadSync('tur-super-lig__galatasaray'), 0, 70, null, formationSlots('4-2-3-1'));
        r.s4_hasFoot = built.xi.filter(p => p.foot === 'Sol' || p.foot === 'Sağ').length >= 8;

        // S5: SAHA görünümünde oyuncuya tıklama → profil açılır
        activeMatch.myTeam = { id: 'tur-super-lig__galatasaray', name: 'Galatasaray' };
        activeMatch.oppTeam = { id: 'opp', name: 'Opp' };
        if (typeof matchLineups === 'undefined' || !matchLineups) matchLineups = {};
        matchLineups.currentTab = 'myteam';
        matchLineups.myFormation = '4-2-3-1';
        matchLineups.myTeam = built.xi;
        renderMatchLineupPitch();
        const pv = document.getElementById('match-lineup-pitch');
        const nodes = pv.querySelectorAll('.pitch-player-node');
        r.s5_nodeCount = nodes.length;
        let clicked = false;
        for (const n of nodes) { if (n.style.cursor === 'pointer') { n.click(); clicked = true; break; } }
        await new Promise(res => setTimeout(res, 150));
        r.s5_clickable = clicked;
        r.s5_profileOpen = document.getElementById('player-profile-modal').style.display === 'flex';

        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Ayak: sol slot → sol ayaklı', out.s1_bekLeft === 'Sol', `bekLeft=${out.s1_bekLeft}`]);
    c.push(['Ayak: sağ slot → sağ ayaklı', out.s1_bekRight === 'Sağ', `bekRight=${out.s1_bekRight}`]);
    c.push(['Ayak: stoper sol → sol ayaklı', out.s1_stpLeft === 'Sol', `stpLeft=${out.s1_stpLeft}`]);
    c.push(['Ayak: stoper sağ → sağ ayaklı', out.s1_stpRight === 'Sağ', `stpRight=${out.s1_stpRight}`]);
    c.push(['Aynı ayak → takas yok', out.s2_sameNoSwap === true, '']);
    c.push(['Kullanıcı yerinden oynatılmadı', out.s3_userNotMoved === true, '']);
    c.push(['_buildXI çıktısında foot alanı var', out.s4_hasFoot === true, '']);
    c.push(['Saha: 11 node render edildi', out.s5_nodeCount === 11, `=${out.s5_nodeCount}`]);
    c.push(['Saha: oyuncu node tıklanabilir', out.s5_clickable === true, '']);
    c.push(['Saha: tıklama profili açtı', out.s5_profileOpen === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== AYAK TERCİHİ + SAHA TIKLAMA ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
