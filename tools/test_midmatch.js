// ORTA FIX — Maç içi üç düzeltme:
//  (O1) XI slot anahtarları için aile eşlemesi: _slotPrimaryFam('Bek')=FB, ('Kanat')=W
//       (eski posFamily 'CM'e düşüyordu → değişiklik AI'ı bek/kanatları yanlış sınıflıyordu).
//  (O7) Kullanıcı KIRMIZI KART: ikinci sarı → kesin kırmızı; sert faulde ~%8 direkt kırmızı;
//       atılan oyuncu sahadan çıkar, yerine kimse giremez (eskiden red ölü koddu).
//  (O10) Değişiklik hakkı 0 iken kullanıcı çıkışı → takım 10 kişi, sayaç NEGATİFE düşmez.
//   http-server :3000 ayakta iken: node tools/test_midmatch.js
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
        document.getElementById('player-firstname').value = 'Mid';
        document.getElementById('player-lastname').value = 'Match';
        const r = document.querySelector('input[name="position"][value="Santrfor"]'); if (r) r.checked = true;
        document.getElementById('player-league').value = 'tur-super-lig';
        document.getElementById('player-team').value = 'tur-super-lig__galatasaray';
        document.getElementById('creation-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 400));

    const out = await page.evaluate(async () => {
        const r = {};
        // ---- O1: slot anahtarı → birincil aile ----
        r.famBek = _slotPrimaryFam('Bek') === 'FB';
        r.famKanat = _slotPrimaryFam('Kanat') === 'W';
        r.famDos = _slotPrimaryFam('DOS') === 'DM';
        r.famGk = _slotPrimaryFam('Kaleci') === 'GK';
        r.famReal = _slotPrimaryFam('Sağ Bek') === 'FB';   // gerçek mevki adı da çalışır

        // ---- O7: kırmızı kart yolları ----
        function setupDecision(yellowAlready) {
            activeMatch.isCup = false; activeMatch.isHome = true;
            activeMatch.scoreHome = 0; activeMatch.scoreAway = 0;
            activeMatch.minute = 55; activeMatch.playerStatus = 'starting';
            activeMatch.isSubbedOut = false; activeMatch.mySubsLeft = 3; activeMatch.subLog = [];
            activeMatch.myTeam = DB.getTeam(gameState.player.teamId);
            activeMatch.oppTeam = DB.getTeam('tur-super-lig__fenerbahce');
            activeMatch.events = [];
            activeMatch.playerStats = { goals: 0, assists: 0, saves: 0, rating: 6.5, yellow: yellowAlready, red: false };
            matchLineups.myTeam = [{ isUser: true, name: 'M. Match', position: 'Santrfor', label: 'SNT', ovr: 70, matchRating: 6.5, condition: 90, goals: 0, assists: 0, saves: 0, yellow: yellowAlready, red: false, pid: 'USER' }];
            matchLineups.oppTeam = []; matchLineups.myBench = []; matchLineups.oppBench = [];
        }
        const OPT = { name: 'Sert kayarak müdahale', stat: 'defans', difficulty: 15, success: 'ok', fail: 'fail', isSlideTackle: true };

        // a) İKİNCİ SARI → kesin kırmızı + oyundan atılma
        setupDecision(true);
        let vals = [0.999];   // zar=100 → başarısız müdahale
        let _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        resolvePlayerDecision(OPT, 50);
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.secondYellowRed = activeMatch.playerStats.red === true;
        r.sentOff = activeMatch.isSubbedOut === true;
        r.xiMarked = matchLineups.myTeam[0].red === true && matchLineups.myTeam[0].subbedOut === true;
        r.redEvent = (activeMatch.events || []).some(ev => ev.type === 'red');

        // b) DİREKT KIRMIZI (~%8): sarısı yokken sert faul + düşük zar
        setupDecision(false);
        vals = [0.999, 0.0];   // başarısız + direkt-kırmızı zarı tutar
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        resolvePlayerDecision(OPT, 50);
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.directRed = activeMatch.playerStats.red === true && activeMatch.isSubbedOut === true;

        // c) Normal sarı yolu DEĞİŞMEDİ (kırmızı zarı tutmaz)
        setupDecision(false);
        vals = [0.999, 0.9];   // başarısız + kırmızı zarı tutmaz → sarı
        _mr = Math.random; Math.random = () => (vals.length ? vals.shift() : 0.5);
        resolvePlayerDecision(OPT, 50);
        Math.random = _mr; clearInterval(activeMatch.timerId);
        r.yellowOnly = activeMatch.playerStats.yellow === true && activeMatch.playerStats.red === false && activeMatch.isSubbedOut === false;

        // ---- O10: değişiklik hakkı 0 → kullanıcı çıkar, takım 10 kişi, sayaç negatif olmaz ----
        setupDecision(false);
        activeMatch.mySubsLeft = 0;
        matchLineups.myBench = [{ name: 'Yedek F', position: 'Santrfor', label: 'SNT', ovr: 64, matchRating: 6.5, condition: 95, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 111111, img: '' }];
        _subInForUser(70);
        r.tenMen = matchLineups.myTeam[0].isUser === true && matchLineups.myTeam[0].subbedOut === true;
        r.benchUntouched = matchLineups.myBench.length === 1 && !matchLineups.myBench[0].subbedIn;
        r.subsNotNegative = activeMatch.mySubsLeft === 0;

        // O10 sağlama: hak VARKEN normal değişiklik aynen çalışır
        setupDecision(false);
        activeMatch.mySubsLeft = 2;
        matchLineups.myBench = [{ name: 'Yedek F', position: 'Santrfor', label: 'SNT', ovr: 64, matchRating: 6.5, condition: 95, goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: 111112, img: '' }];
        _subInForUser(70);
        r.normalSubWorks = matchLineups.myTeam[0].isUser === false && activeMatch.mySubsLeft === 1;
        return r;
    });

    await browser.close();

    const c = [];
    c.push(['O1: Bek→FB, Kanat→W, DOS→DM, Kaleci→GK', out.famBek && out.famKanat && out.famDos && out.famGk, '']);
    c.push(['O1: gerçek mevki adı da çözülür (Sağ Bek→FB)', out.famReal === true, '']);
    c.push(['O7: ikinci sarı → KIRMIZI', out.secondYellowRed === true, '']);
    c.push(['O7: atılan oyuncu sahadan çıktı (10 kişi)', out.sentOff === true && out.xiMarked === true, '']);
    c.push(['O7: kırmızı kart olayı akışa yazıldı', out.redEvent === true, '']);
    c.push(['O7: direkt kırmızı yolu çalışıyor (~%8)', out.directRed === true, '']);
    c.push(['O7: normal sarı yolu değişmedi', out.yellowOnly === true, '']);
    c.push(['O10: hak 0 → takım 10 kişi, yedek girmedi', out.tenMen === true && out.benchUntouched === true, '']);
    c.push(['O10: sayaç negatife düşmüyor', out.subsNotNegative === true, '']);
    c.push(['O10: hak varken normal değişiklik çalışıyor', out.normalSubWorks === true, '']);
    c.push(['Konsol/sayfa hatası yok', errors.length === 0, errors.slice(0, 4).join(' | ')]);

    console.log(`\n=== ORTA FIX — SLOT AİLESİ + KIRMIZI KART + DEĞİŞİKLİK HAKKI ===`);
    console.log(JSON.stringify(out) + '\n');
    let pass = 0;
    for (const [n, ok, info] of c) { console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${n}${info ? '  — ' + info : ''}`); if (ok) pass++; }
    console.log(`\nSONUÇ: ${pass}/${c.length} geçti.`);
    process.exit(pass === c.length ? 0 : 1);
})().catch(e => { console.error('TEST ÇÖKTÜ:', e); process.exit(2); });
