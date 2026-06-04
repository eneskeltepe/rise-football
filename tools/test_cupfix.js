// Kupa/sakatlık/profil BUG-FIX doğrulaması (kullanıcı bildirdi):
//  (A) SAKATKEN kupa maçında reyting/güven/taraftar ALINMAZ (saçma "6.2 reyting" fix),
//  (B) simüle edilen kupa maçında "İncele" maç detayını açar (ekran DONMAZ),
//  (C) kadroda/dizilişte KENDİNE tıklayınca kendi profil modalı açılır.
//   http-server :3000 ayakta iken: node tools/test_cupfix.js
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
        const T = 'tur-super-lig__galatasaray', O = 'tur-super-lig__fenerbahce';
        const mkEuro = () => ({
            _team: T, compName: 'Şampiyonlar Ligi', compId: 'ucl', season: gameState.currentSeason,
            matches: 0, goals: 0, assists: 0, _lastGains: null, ko: [], koIndex: 0, lpDone: false,
            myLp: [], teams: [T, O], lpGames: 8,
        });

        // ---- A: SAKATKEN kupa maçı → reyting/güven YOK ----
        {
            gameState.euro = mkEuro();
            const fx = { oppId: O, home: true, played: false, gf: 0, ga: 0, md: 0, week: gameState.currentWeek };
            gameState.euro.myLp = [fx, { oppId: O, played: false }];   // every() false → _setupKnockout tetiklenmesin
            gameState.player.injury = { name: 'Kas zorlanması', weeks: 5 };
            const t0 = gameState.player.managerTrust, f0 = gameState.player.fansLove;
            const cm0 = gameState.player.careerStats.matches;
            const log0 = (gameState.player.matchLog || []).length;
            simEuroMatch(fx, 'lp', null, false, true);
            r.a_didNotPlay = activeMatch.playerStats.didNotPlay === true;
            r.a_ratingZero = !activeMatch.playerStats.rating;
            r.a_trustSame = gameState.player.managerTrust === t0;
            r.a_fanSame = gameState.player.fansLove === f0;
            r.a_careerMatchesSame = gameState.player.careerStats.matches === cm0;
            r.a_euroMatchesZero = gameState.euro.matches === 0;
            const last = (gameState.player.matchLog || [])[gameState.player.matchLog.length - 1];
            r.a_logDnp = (gameState.player.matchLog.length === log0 + 1) && last && last.dnp === 1 && last.rating === null;
            r.a_summaryShown = document.getElementById('match-summary-box').style.display === 'flex';
            r.a_perfText = document.getElementById('summary-player-performance').textContent;
            r.a_perfIsInjury = /[Ss]akat/.test(r.a_perfText);
            gameState.player.injury = null;
        }

        // ---- B: simüle kupa maçı → "İncele" detay açar (donma yok) ----
        {
            gameState.euro = mkEuro();
            const fx = { oppId: O, home: true, played: false, gf: 0, ga: 0, md: 1, week: gameState.currentWeek };
            gameState.euro.myLp = [fx, { oppId: O, played: false }];
            simEuroMatch(fx, 'lp', null, false);   // normal simülasyon (sakat değil)
            r.b_cupNoLive = activeMatch._cupNoLive === true;
            r.b_cupDetailSet = !!(activeMatch._cupDetail && activeMatch._cupDetail.home && activeMatch._cupDetail.away);
            // "İncele" butonuna bas → maç detay modalı açılmalı, özet kutusu açık kalmalı
            const detModal = document.getElementById('match-detail-modal');
            detModal.style.display = 'none';
            document.getElementById('btn-close-summary').click();
            r.b_detailOpened = detModal.style.display === 'flex';
            r.b_detailHasHead = !!document.querySelector('#match-detail-body .md-head');
            r.b_summaryStillOpen = document.getElementById('match-summary-box').style.display === 'flex';
        }

        // ---- C: kendi profilini açma (USER) ----
        {
            // doğrudan çağrı
            openPlayerProfile('USER', gameState.player.teamId);
            await new Promise(res => setTimeout(res, 200));
            const pm = document.getElementById('player-profile-modal');
            r.c_modalOpen = pm && pm.style.display === 'flex';
            const body = document.getElementById('player-profile-body');
            r.c_hasName = body && /Forvet/.test(body.textContent);
            r.c_hasFam = body && body.textContent.includes('Mevki Yetkinliği');
            if (pm) pm.style.display = 'none';

            // dizilişte kendi satırına tıklama (binding)
            const row = document.createElement('div');
            _bindLineupClick(row, { isUser: true, pid: 'USER', name: 'Test Forvet' }, true);
            r.c_rowPointer = row.style.cursor === 'pointer';
            row.click();
            await new Promise(res => setTimeout(res, 150));
            r.c_rowOpensProfile = document.getElementById('player-profile-modal').style.display === 'flex';
        }

        return r;
    });

    await browser.close();

    const c = [];
    c.push(['A sakatken oynamadı işaretlendi', out.a_didNotPlay === true, '']);
    c.push(['A reyting verilmedi (0/yok)', out.a_ratingZero === true, '']);
    c.push(['A hoca güveni DEĞİŞMEDİ', out.a_trustSame === true, '']);
    c.push(['A taraftar sevgisi DEĞİŞMEDİ', out.a_fanSame === true, '']);
    c.push(['A kariyer maç sayısı artmadı', out.a_careerMatchesSame === true, '']);
    c.push(['A kupa maç sayacı artmadı', out.a_euroMatchesZero === true, '']);
    c.push(['A maç geçmişe dnp olarak eklendi', out.a_logDnp === true, '']);
    c.push(['A özet "sakat/oynamadın" gösterdi', out.a_perfIsInjury === true, out.a_perfText]);
    c.push(['B simüle kupa _cupNoLive bayrağı', out.b_cupNoLive === true, '']);
    c.push(['B kupa detay verisi kuruldu', out.b_cupDetailSet === true, '']);
    c.push(['B "İncele" maç detayını açtı (donma yok)', out.b_detailOpened === true, '']);
    c.push(['B detayda golcü/skor başlığı var', out.b_detailHasHead === true, '']);
    c.push(['B özet kutusu açık kaldı (üstte detay)', out.b_summaryStillOpen === true, '']);
    c.push(['C kendi profil modalı açıldı', out.c_modalOpen === true, '']);
    c.push(['C profilde kullanıcı adı var', out.c_hasName === true, '']);
    c.push(['C profilde Mevki Yetkinliği var', out.c_hasFam === true, '']);
    c.push(['C dizilişte kendi satırı tıklanabilir', out.c_rowPointer === true, '']);
    c.push(['C kendi satırına tıklama profili açtı', out.c_rowOpensProfile === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== KUPA / SAKATLIK / PROFİL BUG-FIX ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
