// YUKSEK FIX (Y3) — Canlı kupa maçında enerji ÇİFT düşmez (ticker zaten dakika
//  dakika düşürdü; endEuroMatch artık üstüne sabit −30 kesmiyor, yalnız canlıya
//  yansımayan dakikalar için ek düşüş). Ve kupada yedek soyunup HİÇ oynamayan
//  oyuncuya maç/reyting/güven YAZILMAZ (lig yolundaki neverPlayed guard'ının
//  kupa karşılığı).
//   http-server :3000 ayakta iken: node tools/test_cupenergy.js
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
        document.getElementById('player-firstname').value = 'Cup';
        document.getElementById('player-lastname').value = 'Energy';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        const p = gameState.player;
        if (!gameState.euro) {
            gameState._prevStandingPos = {}; gameState._prevStandingPos[p.teamId] = 1;
            qualifyPlayerEuro();
        }
        const e = gameState.euro;
        r.hasEuro = !!e;
        if (!e) return r;

        // Canlı kupa maçı bağlamını kur (startMatchDay'in kurduğu activeMatch durumu)
        function setupLive(fx, opts) {
            e._current = { phase: 'lp', fx, round: null, roundLabel: 'Lig Fazı' };
            activeMatch.isCup = true;
            activeMatch.myTeam = DB.getTeam(e._team);
            activeMatch.oppTeam = DB.getTeam(fx.oppId) || { id: fx.oppId, name: 'Rakip', power: 75 };
            activeMatch.isHome = !!fx.home;
            // takım 2-1 kazansın (myScore=2)
            activeMatch.scoreHome = fx.home ? 2 : 1;
            activeMatch.scoreAway = fx.home ? 1 : 2;
            activeMatch.playerStatus = opts.status;
            activeMatch.startedXI = opts.status === 'starting';
            activeMatch.isSubbedOut = false;
            activeMatch.userOnPitchSince = 0;
            activeMatch.actualPlayedMinutes = opts.liveMins;
            activeMatch.effortLevel = 'normal';
            activeMatch.playerStats = { goals: opts.goals || 0, assists: 0, saves: 0, rating: opts.rating || 6.5, yellow: false, red: false };
        }

        // ---- 1) TAM CANLI 90 dk: ticker enerjiyi zaten düşürdü → endEuroMatch EK kesinti yapmaz ----
        p.energy = 70;
        const car0 = p.careerStats.matches;
        setupLive(e.myLp[0], { status: 'starting', liveMins: 90, rating: 7.8, goals: 1 });
        endEuroMatch();
        r.liveNoDoubleDrain = p.energy === 70;                 // eski bug: 70 − 30 = 40 olurdu
        r.liveMatchCounted = p.careerStats.matches === car0 + 1;
        r.liveFxRecorded = e.myLp[0].played === true && e.myLp[0].gf === 2 && e.myLp[0].ga === 1;
        r.liveEuroCounter = e.matches === 1;

        // ---- 2) YEDEK + HİÇ GİRMEDİ: stat/reyting İŞLENMEZ, hafif dinlenme (+12) ----
        p.energy = 60;
        const car1 = p.careerStats.matches, em1 = e.matches;
        const log0 = (p.matchLog || []).length;
        setupLive(e.myLp[1], { status: 'bench', liveMins: 0, rating: 6.5 });
        endEuroMatch();
        r.benchEnergyRest = p.energy === 72;                   // +12 dinlenme (eski bug: 60 − 30 = 30)
        r.benchNoStats = p.careerStats.matches === car1 && e.matches === em1;
        const lastLog = (p.matchLog || [])[ (p.matchLog || []).length - 1] || {};
        r.benchDnpLogged = (p.matchLog || []).length === log0 + 1 && lastLog.dnp === 1;
        r.benchFxRecorded = e.myLp[1].played === true;         // takım sonucu yine işlenir

        // ---- 3) HIZLI-SİM KALAN DK: yalnız canlıya yansımayan dakikalar düşer ----
        // 30 dk canlı oynandı, kalan 60 dk hızlı-simlendi → ek düşüş = 60 × 0.32 ≈ 19
        p.energy = 70;
        setupLive(e.myLp[2], { status: 'starting', liveMins: 30, rating: 7.0 });
        endEuroMatch();
        r.partialDrain = p.energy === Math.max(5, Math.round(70 - 60 * 0.32));   // = 51
        r.partialVal = p.energy;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['Euro kampanyası kuruldu', out.hasEuro === true, '']);
    c.push(['Canlı 90 dk: enerji ÇİFT düşmedi', out.liveNoDoubleDrain === true, '']);
    c.push(['Canlı: maç kariyere işlendi', out.liveMatchCounted === true, '']);
    c.push(['Canlı: fikstür sonucu kaydedildi (2-1)', out.liveFxRecorded === true, '']);
    c.push(['Canlı: kampanya maç sayacı arttı', out.liveEuroCounter === true, '']);
    c.push(['Yedek/hiç girmedi: +12 dinlenme (stat cezası yok)', out.benchEnergyRest === true, '']);
    c.push(['Yedek/hiç girmedi: maç/reyting İŞLENMEDİ', out.benchNoStats === true, '']);
    c.push(['Yedek/hiç girmedi: maç geçmişine "oynamadı" yazıldı', out.benchDnpLogged === true, '']);
    c.push(['Yedek/hiç girmedi: takım sonucu yine kaydedildi', out.benchFxRecorded === true, '']);
    c.push(['Hızlı-sim kalan dk: yalnız eksik dakikalar düştü (70→51)', out.partialDrain === true, `=${out.partialVal}`]);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== YUKSEK FIX — KUPA ENERJİ + OYNAMAYAN YEDEK ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
