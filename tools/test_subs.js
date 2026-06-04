// Faz A doğrulama — değişiklik bugları: erken-alma engeli, kaleci kuralı, acil pozisyon kaydırma (Puppeteer).
//   http-server :3000 ayakta iken: node tools/test_subs.js
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
        // ---- yardımcılar ----
        const XI = (pos, label, pid, extra) => Object.assign({ name: 'X' + pid, position: pos, label: label || pos, ovr: 75, matchRating: 7.0, isUser: false, img: '', condition: 100, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: pid }, extra || {});
        const BN = (realPos, pid, extra) => Object.assign({ name: 'B' + pid, position: realPos, label: 'YD', ovr: 70, matchRating: 6.0, isUser: false, img: '', condition: 100, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: pid, fam: posFamily(realPos) }, extra || {});
        function baseXI() {
            return [
                XI('Kaleci', 'KL', 1), XI('Bek', 'BEK', 2), XI('Stoper', 'STP', 3), XI('Stoper', 'STP', 4), XI('Bek', 'BEK', 5),
                XI('DOS', 'DOS', 6), XI('Merkez OS', 'MÖ', 7), XI('Ofansif OS', 'OOS', 8),
                XI('Kanat', 'KAN', 9), XI('Kanat', 'KAN', 10), XI('Santrfor', 'SNT', 11)
            ];
        }
        function setup(xi, bench) {
            matchLineups.myTeam = xi; matchLineups.myBench = bench;
            matchLineups.oppTeam = baseXI(); matchLineups.oppBench = [];
            activeMatch.mySubsLeft = 5; activeMatch.oppSubsLeft = 5;
            activeMatch.isHome = true; activeMatch.scoreHome = 0; activeMatch.scoreAway = 0;
            activeMatch.myTeam = { name: 'Bizim' }; activeMatch.oppTeam = { name: 'Rakip' };
            activeMatch.subLog = [];
        }

        // === SENARYO 1: erken-alma engeli (yeni giren <20dk performansla alınmaz) ===
        {
            const xi = baseXI();
            // 7 numara YENİ girmiş (70'), berbat kondisyon/rating → tek aday O; diğerleri sağlam
            xi[6] = XI('Merkez OS', 'MÖ', 7, { subbedIn: true, enteredMin: 70, condition: 8, matchRating: 4.5 });
            setup(xi, [BN('Merkez OS', 20)]);
            // pencere İÇİNDE (75): 300 deneme, ASLA alınmamalı
            let subbed = false;
            for (let k = 0; k < 300; k++) { _autoSubsForTeam('MY', 75); if (matchLineups.myTeam[6].subbedOut || matchLineups.myTeam[6].pid !== 7) { subbed = true; break; } }
            r.s1_blockedInWindow = !subbed && activeMatch.mySubsLeft === 5;
        }
        {
            const xi = baseXI();
            xi[6] = XI('Merkez OS', 'MÖ', 7, { subbedIn: true, enteredMin: 70, condition: 8, matchRating: 4.5 });
            setup(xi, [BN('Merkez OS', 20)]);
            // pencere DIŞINDA (95, 95-70=25>=20): bir noktada alınabilmeli
            let subbed = false;
            for (let k = 0; k < 400; k++) { _autoSubsForTeam('MY', 95); if (matchLineups.myTeam[6].pid !== 7) { subbed = true; break; } }
            r.s1_allowedAfterWindow = subbed;
        }

        // === SENARYO 2: KALECİ KURALI — yedekte sadece kaleci varken outfield'e GK girmez ===
        {
            const xi = baseXI();
            setup(xi, [BN('Kaleci', 30)]);   // yedekte sadece kaleci
            const ok = _doSub('MY', 10, 80, false);   // 10 = Santrfor; emergencyOk=false (sadece GK kuralını test et)
            r.s2_noGKtoOutfield = (ok === false) && matchLineups.myTeam[10].pid === 11;   // ST yerinde, GK girmedi
            // ayrıca XI'da hiç GK-aile outfield slotunda olmamalı (Kaleci slotu hariç)
            r.s2_noGKinOutfield = !matchLineups.myTeam.some((p, i) => i !== 0 && posFamily(p.position) === 'GK');
        }

        // === SENARYO 3: ACİL POZİSYON KAYDIRMA — ST gidiyor, yedekte forvet yok, sadece defans var ===
        {
            const xi = baseXI();
            setup(xi, [BN('Stoper', 40)]);   // yedekte sadece stoper (forvet/kanat yok)
            const before = JSON.parse(JSON.stringify(matchLineups.myTeam.map(p => ({ pid: p.pid, pos: p.position }))));
            const ok = _doSub('MY', 10, 80);   // ST (pid 11) çıkıyor; emergency tetiklenmeli
            const xiNow = matchLineups.myTeam;
            // ST slotu (idx 10) artık BAŞKA bir sahadaki oyuncu (kaydırılan) ile dolu, GK değil, 11 kişi
            r.s3_shifted = ok === true;
            r.s3_stSlotFilled = xiNow[10] && !xiNow[10].subbedOut && posFamily(xiNow[10].position) !== 'GK';
            r.s3_movedPlayerWasOnPitch = before.some(b => b.pid === xiNow[10].pid && b.pid !== 11);   // kaydırılan eskiden sahadaydı (ST değil)
            r.s3_benchDefenderEntered = xiNow.some(p => p.pid === 40);   // yedek stoper sahaya girdi
            r.s3_count11 = xiNow.length === 11 && xiNow.filter(p => !p.subbedOut).length === 11;
            r.s3_noGKmoved = posFamily(xiNow[0].position) === 'GK' && xiNow[0].pid === 1;   // kaleci yerinde
        }

        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Yeni giren <20dk performansla ALINMAZ (300 deneme)', out.s1_blockedInWindow === true, '']);
    c.push(['20dk dolunca alınabilir', out.s1_allowedAfterWindow === true, '']);
    c.push(['Kaleci outfield\'e GİRMEZ (yedekte sadece GK)', out.s2_noGKtoOutfield === true, '']);
    c.push(['Sahada GK outfield slotunda yok', out.s2_noGKinOutfield === true, '']);
    c.push(['Acil kaydırma tetiklendi', out.s3_shifted === true, '']);
    c.push(['ST slotu doldu (GK değil)', out.s3_stSlotFilled === true, '']);
    c.push(['Kaydırılan oyuncu sahadaydı (kanat→ST)', out.s3_movedPlayerWasOnPitch === true, '']);
    c.push(['Yedek defans boşalan slota girdi', out.s3_benchDefenderEntered === true, '']);
    c.push(['11 kişi korundu', out.s3_count11 === true, '']);
    c.push(['Kaleci yerinde kaldı', out.s3_noGKmoved === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== FAZ A — değişiklik bugları + acil pozisyon kaydırma ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
