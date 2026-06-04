// ============================================================================
//  45-matchengine.js  —  Mac motoru: gun simulasyonu (startMatchDay), canli
//  ticker, karar anlari, gol/olay isleme, instant-sim ve saha dizilisi. Mac
//  durumu (activeMatch / matchLineups) burada tutulur. 40-match (kadro) +
//  42-matchux (UX) uzerine calisir; 90-main startMatchDay'i sarmalar.
//  (05-core'dan ayristirildi.)
// ============================================================================
// ================= MATCH ENGINE & DAY SIMULATOR =================

// Turkish Names Generator for Fictional Teammates and Opponents
const TURKISH_FIRSTNAMES = ["Mert", "Barış", "Yunus", "Kerem", "Hakan", "Emre", "Hasan", "Cengiz", "Çağlar", "Zeki", "Umut", "Yusuf", "Semih", "Salih", "Berkan", "Kaan", "Taylan", "İrfan", "Enes", "Kenan", "Arda", "Ferdi", "Altay", "Uğurcan", "Merih", "Orkun", "Okay", "Dorukhan", "Halil", "Cenk"];
const TURKISH_SURNAMES = ["Yılmaz", "Demir", "Kaya", "Çelik", "Şahin", "Yıldız", "Kılıç", "Öztürk", "Aydın", "Özdemir", "Arslan", "Doğan", "Bulut", "Avcı", "Karaca", "Sarı", "Aslan", "Çetin", "Kocaman", "Güler", "Kabak", "Söyüncü", "Yazıcı", "Aktürkoğlu", "Müldür", "Bardakcı", "Kökçü", "Ünder", "Tosun", "Yüksek"];

const SQUAD_SLOTS = [
    { key: 'Kaleci', label: 'KL' },
    { key: 'Bek', label: 'BEK' },
    { key: 'Stoper', label: 'STP' },
    { key: 'Stoper', label: 'STP' },
    { key: 'Bek', label: 'BEK' },
    { key: 'DOS', label: 'DOS' },
    { key: 'Merkez OS', label: 'MÖ' },
    { key: 'Ofansif OS', label: 'OOS' },
    { key: 'Kanat', label: 'KAN' },
    { key: 'Kanat', label: 'KAN' },
    { key: 'Santrfor', label: 'SNT' }
];

let matchLineups = {
    myTeam: [],
    oppTeam: [],
    myFormation: "4-2-3-1",
    oppFormation: "4-3-3",
    currentTab: 'myteam'
};

function generateFictionalPlayer(position, baseOvr) {
    const fn = TURKISH_FIRSTNAMES[Math.floor(Math.random() * TURKISH_FIRSTNAMES.length)];
    const sn = TURKISH_SURNAMES[Math.floor(Math.random() * TURKISH_SURNAMES.length)];
    const name = `${fn.substring(0, 1)}. ${sn}`;
    
    // Rating is team power +/- random roll
    const rating = Math.min(99, Math.max(45, Math.round(baseOvr + (Math.random() * 8) - 4)));
    
    return {
        name: name,
        position: position,
        ovr: rating,
        matchRating: 6.0 + (Math.random() * 0.4 - 0.2), // start around 5.8 - 6.2
        goals: 0,
        assists: 0,
        saves: 0,
        yellow: false,
        red: false
    };
}

// Bind lineup tab buttons (idempotent — DOMContentLoaded'da VE her maç başında çağrılır,
// böylece binding herhangi bir zamanlama kenar durumunda kaçırılsa bile garanti bağlanır).
function bindLineupTabs() {
    const btnMy = document.getElementById('btn-lineup-myteam');
    const btnOpp = document.getElementById('btn-lineup-oppteam');
    if (!btnMy || !btnOpp || btnMy._tabBound) return;
    btnMy._tabBound = true;
    btnMy.addEventListener('click', () => {
        matchLineups.currentTab = 'myteam';
        btnMy.classList.add('active');
        btnOpp.classList.remove('active');
        renderMatchLineups();
    });
    btnOpp.addEventListener('click', () => {
        matchLineups.currentTab = 'oppteam';
        btnOpp.classList.add('active');
        btnMy.classList.remove('active');
        renderMatchLineups();
    });
}
window.addEventListener('DOMContentLoaded', bindLineupTabs);
if (typeof window !== 'undefined') window.bindLineupTabs = bindLineupTabs;

let activeMatch = {
    myTeam: null,
    oppTeam: null,
    isHome: false,
    scoreHome: 0,
    scoreAway: 0,
    minute: 0,
    commentary: [],
    timerId: null,
    isPaused: false,
    isHalfTime: false,
    addedTime: 0,
    currentHalf: 1, // 1: First half, 2: Second half
    addedTimePlayed: 0,
    isAddedTimeActive: false,
    effortLevel: 'normal', // 'low', 'normal', 'high'
    isSubbedOut: false,
    playerStatus: 'starting', // 'starting', 'bench', 'excluded'
    actualPlayedMinutes: 0,
    playerStats: {
        goals: 0,
        assists: 0,
        saves: 0,
        rating: 6.0,
        shots: 0,
        passes: 0,
        tackles: 0,
        yellow: false,
        red: false
    }
};

// Efor seviyesi butonları yalnız oyuncu SAHADAYKEN seçilebilir olmalı (yedekken/
// kadro dışıyken/oyundan çıkınca kilitli). on=false → kilitli + açıklayıcı ipucu.
function _setEffortEnabled(on) {
    const panel = document.querySelector('.effort-panel:not(.match-speed-panel)');
    if (panel) panel.classList.toggle('effort-locked', !on);
    document.querySelectorAll('.effort-btn[data-effort]').forEach(b => {
        b.disabled = !on;
        b.title = on ? '' : 'Efor seviyesi yalnız sahadayken ayarlanabilir.';
    });
    const lbl = panel && panel.querySelector('.effort-title-label');
    if (lbl) lbl.innerHTML = on
        ? `<i class="fa-solid fa-gauge-simple-high"></i> Maç İçi Efor Seviyen`
        : `<i class="fa-solid fa-lock"></i> Maç İçi Efor Seviyen (sahada değilsin)`;
}

// Maç bitince / yedekteyken anlamsız olan kontrolleri göster/gizle (review modu vs aktif maç)
function _setMatchControlsActive(active) {
    ['btn-match-pause', 'btn-match-sim-rest'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = active ? 'inline-flex' : 'none';
    });
    const rh = document.getElementById('btn-match-resume-half'); if (rh && !active) rh.style.display = 'none';
    // hız + efor panelleri yalnız maç sürerken görünür
    document.querySelectorAll('.effort-panel').forEach(el => el.style.display = active ? '' : 'none');
}
if (typeof window !== 'undefined') { window._setEffortEnabled = _setEffortEnabled; window._setMatchControlsActive = _setMatchControlsActive; }

function startMatchDay() {
    const cup = window._euroMatchCtx || null;     // kupa maci baglami (85-euro)
    window._euroMatchCtx = null;                   // tek seferlik
    const weekIndex = gameState.currentWeek - 1;
    const matches = gameState.fixtures[weekIndex] || [];
    const playerTeam = gameState.player.teamId;

    let myMatch, isHome, opponentId;
    if (cup) {
        isHome = cup.isHome; opponentId = cup.oppId; myMatch = null;
    } else {
        myMatch = matches.find(m => m.home === playerTeam || m.away === playerTeam);
        if (!myMatch || myMatch.isBay) { advanceWeek(); return; }
        isHome = myMatch.home === playerTeam;
        opponentId = isHome ? myMatch.away : myMatch.home;
    }

    activeMatch.isCup = !!cup;
    activeMatch.cupRound = cup ? cup.round : null;
    activeMatch.myTeam = getTeamById(playerTeam);
    activeMatch.oppTeam = getTeamById(opponentId);
    activeMatch.isHome = isHome;
    activeMatch.scoreHome = 0;
    activeMatch.scoreAway = 0;
    activeMatch.minute = 0;
    activeMatch.commentary = [];
    activeMatch.isPaused = false;
    activeMatch.isHalfTime = false;
    activeMatch.addedTime = 0;
    activeMatch.currentHalf = 1;
    activeMatch.addedTimePlayed = 0;
    activeMatch.isAddedTimeActive = false;
    activeMatch.isSubbedOut = false;
    activeMatch.effortLevel = 'normal';
    activeMatch.actualPlayedMinutes = 0;
    // Karar-anı sayaçları HER MAÇ sıfırlanmalı. (activeMatch kalıcı nesne — yoksa 1. maçtan
    // sonra decisionCount 4'te takılı kalıp sonraki maçlarda HİÇ karar anı tetiklenmezdi → gol gelmezdi.)
    activeMatch.decisionCount = 0;
    activeMatch.lastDecisionMin = -99;
    activeMatch.playerStats = {
        goals: 0,
        assists: 0,
        saves: 0,
        rating: 6.0,
        shots: 0,
        passes: 0,
        tackles: 0,
        yellow: false,
        red: false
    };

    // KULLANICININ BU MAÇTAKİ STATÜSÜ (B1): rotasyon/yedek/kadro-dışı (deterministik+çeşitli)
    const _ud = (typeof decideUserMatchStatus === 'function')
        ? decideUserMatchStatus(playerTeam, activeMatch.oppTeam.power, !!cup)
        : { status: gameState.player.managerTrust < 30 && !cup ? 'excluded' : (gameState.player.managerTrust < 50 && !cup ? 'bench' : 'starting') };
    activeMatch.playerStatus = _ud.status;
    activeMatch.startedXI = (_ud.status === 'starting');   // FM-tarzı: ilk-11 başlangıcı mı (yedek-girişten ayırt için)
    activeMatch.userEntryMinute = _ud.entryMinute || null;
    activeMatch.userBenchReason = _ud.reason || null;
    // Rotasyon dengesi sayaçları (her maç güncellenir)
    if (_ud.status === 'starting') gameState.player.seasonStarts = (gameState.player.seasonStarts || 0) + 1;
    else gameState.player.seasonBenched = (gameState.player.seasonBenched || 0) + 1;

    // KADRO DIŞI (yalnız lig maçı): maçı arka planda simüle et
    if (!cup && _ud.status === 'excluded') {
        showToast("Hoca seni bu maçın kadrosuna almadı. Maçı tribünden takip ettin.", "error");
        const diff = activeMatch.myTeam.power - activeMatch.oppTeam.power;
        const myTeamChance = 0.5 + (diff / 100);
        let myScore = 0, oppScore = 0;
        for (let c = 0; c < 3; c++) {
            if (Math.random() < myTeamChance) { if (Math.random() < (activeMatch.myTeam.power / 185)) myScore++; }
            else { if (Math.random() < (activeMatch.oppTeam.power / 185)) oppScore++; }
        }
        myMatch.scoreHome = isHome ? myScore : oppScore;
        myMatch.scoreAway = isHome ? oppScore : myScore;
        updateTeamStandingsRecord(myMatch.home, myMatch.away, myMatch.scoreHome, myMatch.scoreAway);
        simulateOtherWeekMatches(weekIndex);
        gameState.matchesPlayedThisWeek = true;
        gameState.player.energy = Math.min(100, gameState.player.energy + 12);
        saveGame();
        updateUI();
        return;
    }
    if (_ud.status === 'bench') {
        showToast(_ud.entryMinute ? "Hoca seni yedek soyundurdu. Fırsat kollayacaksın!"
            : "Hoca seni yedek soyundurdu — bugün oyuna girme ihtimalin düşük.", "info");
    }

    // Maç UX durumunu sıfırla (olay akışı + istatistik + hız butonu)
    if (typeof resetMatchUX === 'function') resetMatchUX();

    // Generate lineups
    generateMatchLineups(activeMatch.myTeam.power, activeMatch.oppTeam.power);
    matchLineups.currentTab = 'myteam';
    
    // Switch Screen
    document.getElementById('game-interface').classList.remove('active');
    document.getElementById('matchday-screen').classList.add('active');
    
    // Geniş Ekran Sınıfını Ekle (Full screen mode)
    document.querySelector('.app-container').classList.add('matchday-active');
    
    // Render lineups
    setTimeout(renderMatchLineups, 50);
    
    // Setup Scoreboard
    const homeTeam = isHome ? activeMatch.myTeam : activeMatch.oppTeam;
    const awayTeam = isHome ? activeMatch.oppTeam : activeMatch.myTeam;
    
    document.getElementById('match-home-name').textContent = homeTeam.name;
    document.getElementById('match-away-name').textContent = awayTeam.name;
    
    const homeShield = document.getElementById('match-home-shield');
    const awayShield = document.getElementById('match-away-shield');
    if (homeShield) {
        homeShield.innerHTML = getTeamLogoHtml(homeTeam.id, 50);
        homeShield.style.background = 'none';
        homeShield.style.border = 'none';
    }
    if (awayShield) {
        awayShield.innerHTML = getTeamLogoHtml(awayTeam.id, 50);
        awayShield.style.background = 'none';
        awayShield.style.border = 'none';
    }
    
    // Dinamik Takım İsmi Güncellemesi
    const lineupMyTeamName = document.getElementById('lineup-myteam-name');
    if (lineupMyTeamName) {
        lineupMyTeamName.textContent = activeMatch.myTeam.name;
    }
    const btnMy = document.getElementById('btn-lineup-myteam');
    const btnOpp = document.getElementById('btn-lineup-oppteam');
    if (btnMy) {
        btnMy.innerHTML = `<span style="display:inline-flex; align-items:center; gap:7px;">${getTeamLogoHtml(activeMatch.myTeam.id, 22)} <span id="lineup-myteam-name">${activeMatch.myTeam.name}</span></span>`;
    }
    if (btnOpp) {
        btnOpp.innerHTML = `<span style="display:inline-flex; align-items:center; gap:7px;">${getTeamLogoHtml(activeMatch.oppTeam.id, 22)} <span>${activeMatch.oppTeam.name}</span></span>`;
    }
    
    document.getElementById('match-score').textContent = "0 - 0";
    document.getElementById('match-time').textContent = "00:00";
    document.getElementById('match-player-rating').textContent = "6.0";
    
    const actionStatLabel = document.getElementById('match-player-action-label');
    const actionStatVal = document.getElementById('match-player-action-val');
    
    if (gameState.player.position === 'Kaleci') {
        actionStatLabel.textContent = "Kurtarış";
        actionStatVal.textContent = "0";
    } else {
        actionStatLabel.textContent = "Gol / Asist";
        actionStatVal.textContent = "0 / 0";
    }
    
    // Handle Energy and condition penalty
    document.getElementById('match-player-condition').textContent = `${Math.round(gameState.player.energy)}%`;
    if (gameState.player.energy < 50) {
        showToast("Enerjin çok düşük! Maçta yorgun hissedebilirsin.", "error");
        activeMatch.playerStats.rating = 5.5; 
    }
    
    document.getElementById('commentary-log').innerHTML = '';
    document.getElementById('match-decision-box').style.display = 'none';
    document.getElementById('match-summary-box').style.display = 'none';
    
    // BIND MATCH CONTROL BUTTONS
    const pauseBtn = document.getElementById('btn-match-pause');
    const subOutBtn = document.getElementById('btn-match-sub-out');
    const resumeHalfBtn = document.getElementById('btn-match-resume-half');
    const statusBadge = document.getElementById('match-status-badge');
    
    if (pauseBtn) {
        pauseBtn.style.display = 'inline-flex';
        pauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i> Duraklat`;
        
        const newPauseBtn = pauseBtn.cloneNode(true);
        pauseBtn.parentNode.replaceChild(newPauseBtn, pauseBtn);
        
        newPauseBtn.addEventListener('click', () => {
            if (activeMatch.isHalfTime || activeMatch.minute >= 90) return;
            
            activeMatch.isPaused = !activeMatch.isPaused;
            if (activeMatch.isPaused) {
                newPauseBtn.innerHTML = `<i class="fa-solid fa-play"></i> Devam Et`;
                if (statusBadge) statusBadge.innerHTML = `<i class="fa-solid fa-circle-pause text-info"></i> Maç Duraklatıldı`;
                clearInterval(activeMatch.timerId);
            } else {
                newPauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i> Duraklat`;
                if (statusBadge) statusBadge.innerHTML = `<i class="fa-solid fa-circle-play text-success"></i> Maç Oynanıyor`;
                runMatchTicker();
            }
        });
    }
    
    if (resumeHalfBtn) {
        resumeHalfBtn.style.display = 'none';
        const newResumeBtn = resumeHalfBtn.cloneNode(true);
        resumeHalfBtn.parentNode.replaceChild(newResumeBtn, resumeHalfBtn);
        
        newResumeBtn.addEventListener('click', () => {
            newResumeBtn.style.display = 'none';
            // pauseBtn/subOutBtn yukarıda cloneNode ile DEĞİŞTİRİLDİ → eski referanslar DOM'dan kopuk.
            // Canlı butonları ID ile yeniden sorgula, yoksa 2. yarıda Duraklat butonu görünmez.
            const livePause = document.getElementById('btn-match-pause');
            const liveSubOut = document.getElementById('btn-match-sub-out');
            if (livePause) livePause.style.display = 'inline-flex';
            if (liveSubOut && activeMatch.playerStatus !== 'bench') liveSubOut.style.display = 'inline-flex';

            activeMatch.isHalfTime = false;
            activeMatch.minute = 46;
            activeMatch.currentHalf = 2;
            activeMatch.isAddedTimeActive = false;
            activeMatch.addedTime = 0;
            activeMatch.addedTimePlayed = 0;
            
            if (statusBadge) statusBadge.innerHTML = `<i class="fa-solid fa-circle-play text-success"></i> Maç Oynanıyor`;
            addCommentary(45, "İkinci yarı başladı! İki takıma da başarılar.", 'info');
            runMatchTicker();
        });
    }
    
    if (subOutBtn) {
        subOutBtn.style.display = activeMatch.playerStatus === 'bench' ? 'none' : 'inline-flex';
        const newSubOutBtn = subOutBtn.cloneNode(true);
        subOutBtn.parentNode.replaceChild(newSubOutBtn, subOutBtn);
        
        newSubOutBtn.addEventListener('click', () => {
            gameConfirm({ title: 'Oyundan Çık', danger: true, confirmText: 'Çık', cancelText: 'Sahada Kal',
                message: "Oyundan çıkmak istediğine emin misin? Bu durum hocanı ve takım arkadaşlarını kızdırabilir." })
                .then(ok => { if (ok) requestPlayerSubOut(); });
        });
    }

    // BIND EFFORT LEVEL BUTTONS
    // ÖNEMLİ: yalnız [data-effort] taşıyan efor butonlarını seç. Maç hızı butonları
    // (.match-speed-btn) görsel stil için '.effort-btn' sınıfını paylaşır; onları
    // bu mantığa dahil etmek hız dinleyicilerini silip yanlış "Efor: Standart"
    // toast'ı tetikliyordu. data-effort filtresi ikisini tamamen ayırır.
    const effortBtns = document.querySelectorAll('.effort-btn[data-effort]');
    effortBtns.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });

    document.querySelectorAll('.effort-btn[data-effort]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.effort-btn[data-effort]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeMatch.effortLevel = btn.getAttribute('data-effort');
            showToast(`Efor seviyesi ayarlandı: ${activeMatch.effortLevel === 'low' ? 'Rölanti' : activeMatch.effortLevel === 'high' ? 'Pres' : 'Standart'}`, 'info');
        });

        if (btn.getAttribute('data-effort') === 'normal') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Kadro sekmesi (Bizim/Rakip) + görünüm geçişi (Liste/Saha) binding'lerini garantiye al
    // (idempotent guard'lı; DOMContentLoaded'da kaçırılmış olsa bile maç başında bağlanır).
    if (typeof bindLineupTabs === 'function') bindLineupTabs();
    if (typeof bindLineupViewToggle === 'function') bindLineupViewToggle();

    // Maç kontrollerini aktif maç moduna al; efor yalnız sahadaysan açık (yedekte kilitli)
    _setMatchControlsActive(true);
    _setEffortEnabled(activeMatch.playerStatus === 'starting');

    if (statusBadge) {
        statusBadge.innerHTML = `<i class="fa-solid fa-circle-play text-success"></i> Maç Oynanıyor`;
    }
    
    if (activeMatch.playerStatus === 'bench') {
        addCommentary(0, "Mücadele başladı. Maça yedek kulübesinde başladın.", 'info');
    } else {
        addCommentary(0, "Mücadele başladı. İki takıma da başarılar!", 'info');
    }
    
    // Start simulation ticker
    runMatchTicker();
}

function checkManagerSubOut() {
    if (activeMatch.isSubbedOut || activeMatch.playerStatus !== 'starting') return;
    
    const min = activeMatch.minute;
    const rating = activeMatch.playerStats.rating;
    const energy = gameState.player.energy;
    
    // 65. dakikadan sonra kötü reyting veya sıfıra yakın enerji
    if (min >= 65 && ((rating <= 5.4 && Math.random() < 0.3) || (energy < 15 && Math.random() < 0.6))) {
        clearInterval(activeMatch.timerId);
        activeMatch.isSubbedOut = true;
        _setEffortEnabled(false);   // oyundan alındın → efor kilitli

        let reason = "düşük performansın";
        if (energy < 15) reason = "yorgunluğun ve kondisyon yetersizliğin";
        
        addCommentary(min, `<strong>[OYUNDAN ALINDIN]</strong> Hoca, ${reason} nedeniyle seni oyundan çıkarıyor! Kalan süre tribünden izleniyor.`, 'interactive');

        if (rating <= 5.4) {
            gameState.player.managerTrust = Math.max(10, gameState.player.managerTrust - 4);
        }

        if (typeof _subInForUser === 'function') _subInForUser(min);
        _resumeAfterSubOut();   // maç bitmez; kullanıcı yedekten kalanı izler
    }
}

function requestPlayerSubOut() {
    clearInterval(activeMatch.timerId);
    activeMatch.isSubbedOut = true;
    _setEffortEnabled(false);   // oyundan çıktın → efor kilitli

    const min = activeMatch.minute;
    const p = gameState.player;
    
    let trustPenalty = 0;
    let fanPenalty = 0;
    
    const scoreDiff = activeMatch.isHome ? (activeMatch.scoreHome - activeMatch.scoreAway) : (activeMatch.scoreAway - activeMatch.scoreHome);
    
    addCommentary(min, `<strong>[OYUNDAN ÇIKIŞ]</strong> ${p.firstname} kenara değişiklik işareti yaptı ve oyundan çıktı.`, 'interactive');
    
    if (min < 75) {
        trustPenalty = -18;
        fanPenalty = -12;
        if (scoreDiff < 0) {
            trustPenalty = -25;
            fanPenalty = -20;
            addCommentary(min, "Yenik durumdayken maçı erken bırakıp çıkman hoca ve takım arkadaşlarını çileden çıkardı!", 'card-red');
        } else {
            addCommentary(min, "Erken dakikada oyundan çıkma kararın hoca tarafından tepkiyle karşılandı.", 'card');
        }
    } else {
        if (scoreDiff < 0) {
            trustPenalty = -8;
            fanPenalty = -8;
            addCommentary(min, "Yenik durumdayken oyundan çıkman taraftarlar arasında hoş karşılanmadı.", 'card');
        } else {
            trustPenalty = 0;
            fanPenalty = 5;
            addCommentary(min, "Mücadeleci oyunun için taraftarlar seni kenara gelirken alkışlıyor.", 'goal');
        }
    }
    
    p.managerTrust = Math.max(10, Math.min(100, p.managerTrust + trustPenalty));
    p.fansLove = Math.max(10, Math.min(100, p.fansLove + fanPenalty));

    if (typeof _subInForUser === 'function') _subInForUser(min);
    _resumeAfterSubOut();   // maç bitmez; kullanıcı yedekten kalanı izler
}

function simulateRemainingMatchFast() {
    const pauseBtn = document.getElementById('btn-match-pause');
    const subOutBtn = document.getElementById('btn-match-sub-out');
    const statusBadge = document.getElementById('match-status-badge');
    
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (subOutBtn) subOutBtn.style.display = 'none';
    if (statusBadge) statusBadge.innerHTML = `<i class="fa-solid fa-clock text-muted"></i> Hızlı Simülasyon`;

    while (activeMatch.minute < 90) {
        activeMatch.minute += Math.floor(Math.random() * 5) + 3;
        if (activeMatch.minute > 90) activeMatch.minute = 90;
        
        // Simülasyon sırasında gol/olay tetiklenebilir
        const eventRoll = Math.random();
        if (eventRoll < 0.18) {
            simulateGenericEvent();
        } else if (eventRoll < 0.3) {
            wiggleRatings();
        }
    }
    
    activeMatch.addedTime = Math.floor(Math.random() * 5) + 2;
    activeMatch.minute = 90;
    
    endMatch();
}

function addCommentary(minute, text, style = '') {
    const log = document.getElementById('commentary-log');
    const entry = document.createElement('div');
    entry.className = `commentary-entry ${style}`;
    
    const minText = minute === 0 ? "00'" : `${minute.toString().padStart(2, '0')}'`;
    entry.innerHTML = `<span class="minute">${minText}</span> <span>${text}</span>`;
    
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function wiggleRatings() {
    // slightly randomize ratings of all non-user players to simulate game flow
    matchLineups.myTeam.forEach(p => {
        if (p.isUser) return;
        const change = parseFloat((Math.random() * 0.3 - 0.14).toFixed(2));
        p.matchRating = Math.max(4.0, Math.min(9.8, p.matchRating + change));
    });
    matchLineups.oppTeam.forEach(p => {
        const change = parseFloat((Math.random() * 0.3 - 0.14).toFixed(2));
        p.matchRating = Math.max(4.0, Math.min(9.8, p.matchRating + change));
    });
}

// teamKey golcu/asistci atar. allowUser=true ise kullanici da golcu/asistci olabilir
// (A8: skor zaten simulateGenericEvent'te artirildi; burada SADECE istatistik+olay).
function simulateGoalForLineup(teamKey, allowUser) {
    const squad = teamKey === 'MY' ? matchLineups.myTeam : matchLineups.oppTeam;
    const userFull = `${gameState.player.firstname} ${gameState.player.lastname}`;

    const scorersPool = [];
    squad.forEach((player, idx) => {
        if (player.isUser && !allowUser) return;
        let weight = 1;
        if (player.label === 'SNT') weight = 8;
        else if (player.label === 'KAN') weight = 6;
        else if (player.label === 'OOS') weight = 4;
        else if (player.label === 'MÖ') weight = 2;
        if (player.isUser) weight = Math.max(1, Math.round(weight * 0.8));   // kullanici biraz daha dusuk
        for (let w = 0; w < weight; w++) scorersPool.push(idx);
    });
    if (!scorersPool.length) return;

    const scorerIdx = scorersPool[Math.floor(Math.random() * scorersPool.length)];
    const scorer = squad[scorerIdx];
    if (scorer.isUser) {
        activeMatch.playerStats.goals++;
        adjustPlayerRating(1.0);
        const av = document.getElementById('match-player-action-val');
        if (av && gameState.player.position !== 'Kaleci') av.textContent = `${activeMatch.playerStats.goals} / ${activeMatch.playerStats.assists}`;
        if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'goal', team: 'MY', playerName: userFull });
    } else {
        scorer.goals++;
        scorer.matchRating = Math.min(10.0, scorer.matchRating + 1.2);
        if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'goal', team: teamKey, playerName: scorer.name });
    }

    // Asistci (golcuden farkli)
    const assistantsPool = [];
    squad.forEach((player, idx) => {
        if (idx === scorerIdx) return;
        if (player.isUser && !allowUser) return;
        let weight = 1;
        if (player.label === 'OOS') weight = 6;
        else if (player.label === 'KAN') weight = 5;
        else if (player.label === 'MÖ') weight = 4;
        else if (player.label === 'BEK') weight = 3;
        else if (player.label === 'DOS') weight = 2;
        for (let w = 0; w < weight; w++) assistantsPool.push(idx);
    });
    if (assistantsPool.length) {
        const assistantIdx = assistantsPool[Math.floor(Math.random() * assistantsPool.length)];
        const assistant = squad[assistantIdx];
        if (assistant.isUser) {
            activeMatch.playerStats.assists++;
            adjustPlayerRating(0.7);
            const av = document.getElementById('match-player-action-val');
            if (av && gameState.player.position !== 'Kaleci') av.textContent = `${activeMatch.playerStats.goals} / ${activeMatch.playerStats.assists}`;
            if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'assist', team: 'MY', playerName: userFull });
        } else {
            assistant.assists++;
            assistant.matchRating = Math.min(10.0, assistant.matchRating + 0.8);
            if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'assist', team: teamKey, playerName: assistant.name });
        }
    }
}

function runMatchTicker() {
    if (activeMatch.timerId) clearInterval(activeMatch.timerId);   // cifte interval koruması
    const _speed = (typeof currentSpeedMs === 'function') ? currentSpeedMs() : 1400;
    activeMatch.timerId = setInterval(() => {
        // Duraklatılmışsa işlem yapma
        if (activeMatch.isPaused) return;

        // A7/B4: YEDEK OYUNCU — maçı gerçek zamanlı izlersin; hoca seni giriş dakikasında alır
        if (activeMatch.playerStatus === 'bench') {
            const entry = activeMatch.userEntryMinute;          // null => hiç girmez
            if (entry && activeMatch.minute >= entry && activeMatch.currentHalf === 2) {
                activeMatch.playerStatus = 'starting';
                addCommentary(activeMatch.minute, `<strong>[OYUNA GİRİŞ]</strong> Hoca seni oyuna alıyor! Şansını iyi değerlendir.`, 'interactive');
                if (typeof _subUserIntoXI === 'function') _subUserIntoXI(activeMatch.minute);
                const sb = document.getElementById('btn-match-sub-out'); if (sb) sb.style.display = 'inline-flex';
                _setEffortEnabled(true);   // artık sahadasın → efor seçilebilir
                renderMatchLineups();
            }
            // entry yoksa ve maç bittiyse: tribünde geçti
        }

        // 2. DEVRE ARASI VE UZATMA SÜRESİ KONTROLLERİ
        if (activeMatch.minute === 45 && activeMatch.currentHalf === 1 && !activeMatch.isAddedTimeActive) {
            activeMatch.addedTime = Math.floor(Math.random() * 4) + 1; // 1-4 dk
            activeMatch.isAddedTimeActive = true;
            activeMatch.addedTimePlayed = 0;
            addCommentary(45, `İlk yarının sonuna <strong>+${activeMatch.addedTime}</strong> dakika uzatma ilave edildi.`, 'info');
        }

        // Dakika İlerletme (Normal veya Uzatma)
        let minDiff = 0;
        if (activeMatch.isAddedTimeActive) {
            minDiff = 1;
            activeMatch.addedTimePlayed += minDiff;
            
            const currentHalfEnd = activeMatch.currentHalf === 1 ? 45 : 90;
            document.getElementById('match-time').textContent = `${currentHalfEnd}:00 +${activeMatch.addedTimePlayed}'`;
        } else {
            const nextMin = Math.floor(Math.random() * 4) + 2; 
            const prevMin = activeMatch.minute;
            activeMatch.minute += nextMin;
            
            if (activeMatch.currentHalf === 1 && activeMatch.minute > 45) {
                activeMatch.minute = 45;
            } else if (activeMatch.currentHalf === 2 && activeMatch.minute > 90) {
                activeMatch.minute = 90;
            }
            
            minDiff = activeMatch.minute - prevMin;
            document.getElementById('match-time').textContent = `${activeMatch.minute.toString().padStart(2, '0')}:00`;
        }

        // Kondisyon/Enerji Tüketimi
        if (!activeMatch.isSubbedOut && activeMatch.playerStatus === 'starting') {
            let energyLoss = 0;
            if (activeMatch.effortLevel === 'low') {
                energyLoss = 0.12 * minDiff;
            } else if (activeMatch.effortLevel === 'high') {
                energyLoss = 0.72 * minDiff;
            } else {
                energyLoss = 0.32 * minDiff;
            }
            gameState.player.energy = Math.max(5, gameState.player.energy - energyLoss);
            activeMatch.actualPlayedMinutes += minDiff;
            document.getElementById('match-player-condition').textContent = `${Math.round(gameState.player.energy)}%`;
        }

        // Wiggle ratings + kondisyon dususu + hocanin otomatik degisiklikleri
        wiggleRatings();
        if (typeof onMatchTick === 'function') onMatchTick(minDiff, activeMatch.minute);
        renderMatchLineups();
        if (typeof renderMatchStats === 'function') renderMatchStats();

        // UZATMA SÜRESİ BİTİŞ KONTROLÜ
        if (activeMatch.isAddedTimeActive && activeMatch.addedTimePlayed >= activeMatch.addedTime) {
            activeMatch.isAddedTimeActive = false;
            
            if (activeMatch.currentHalf === 1) {
                clearInterval(activeMatch.timerId);
                activeMatch.isHalfTime = true;
                addCommentary(45, "Hakem ilk yarının son düdüğünü çalıyor. Devre Arası!", 'info');
                
                const pauseBtn = document.getElementById('btn-match-pause');
                const subOutBtn = document.getElementById('btn-match-sub-out');
                const resumeHalfBtn = document.getElementById('btn-match-resume-half');
                const statusBadge = document.getElementById('match-status-badge');
                
                if (pauseBtn) pauseBtn.style.display = 'none';
                if (subOutBtn) subOutBtn.style.display = 'none';
                if (resumeHalfBtn) resumeHalfBtn.style.display = 'inline-flex';
                if (statusBadge) statusBadge.innerHTML = `<i class="fa-solid fa-circle-pause text-info"></i> Devre Arası`;
                return;
            } else {
                endMatch();
                return;
            }
        } else if (!activeMatch.isAddedTimeActive && activeMatch.minute === 90 && activeMatch.currentHalf === 2) {
            activeMatch.addedTime = Math.floor(Math.random() * 5) + 2; // 2-6 dk
            activeMatch.isAddedTimeActive = true;
            activeMatch.addedTimePlayed = 0;
            addCommentary(90, `Mücadelenin sonuna <strong>+${activeMatch.addedTime}</strong> dakika uzatma ilave edildi.`, 'info');
            return;
        }

        // Normal Olay veya Karar Anı Simülasyonu
        if (!activeMatch.isHalfTime) {
            let actionChance = 0.15;
            if (activeMatch.effortLevel === 'low') actionChance = 0.05;
            else if (activeMatch.effortLevel === 'high') actionChance = 0.25;
            
            const eventRoll = Math.random();
            
            // Karar anı SIKLIK SINIRI: maç başına en çok 4, aralarında en az 12 dk.
            // (Eskiden her dakika ~%15 → maç başına ~13 karar anı; gol enflasyonunun ana nedeni.)
            const _decReady = (activeMatch.decisionCount || 0) < 4 &&
                (activeMatch.minute - (activeMatch.lastDecisionMin == null ? -99 : activeMatch.lastDecisionMin)) >= 12;
            if (_decReady && eventRoll < actionChance && !activeMatch.isSubbedOut && activeMatch.playerStatus === 'starting') {
                activeMatch.decisionCount = (activeMatch.decisionCount || 0) + 1;
                activeMatch.lastDecisionMin = activeMatch.minute;
                clearInterval(activeMatch.timerId);
                triggerPlayerDecision();
            } else if (eventRoll < 0.38) {
                simulateGenericEvent();
            } else {
                if (Math.random() < 0.20) {
                    const ambientPhrases = [
                        "Orta alanda büyük taktik mücadele var. İki takım da hata yapmak istemiyor.",
                        "Sert mücadeleler... Hakem oyunu akıcı oynatmaya gayret gösteriyor.",
                        "Tribünlerin inanılmaz bir uğultusu var. Maç temposu bu dakikalarda biraz düştü.",
                        "Savunma hatları çok dikkatli. Boşluk bulmak oldukça zorlaşıyor."
                    ];
                    addCommentary(activeMatch.minute, ambientPhrases[Math.floor(Math.random() * ambientPhrases.length)]);
                }
            }
            
            // Performans/Kondisyon kontrolü ile hocanın oyundan alması
            checkManagerSubOut();
        }
    }, _speed);
}

// Generate general match actions for commentary
function simulateGenericEvent() {
    const diff = activeMatch.myTeam.power - activeMatch.oppTeam.power;
    const myTeamChance = 0.5 + (diff / 100);
    
    const attackingTeam = Math.random() < myTeamChance ? 'MY' : 'OPP';
    
    if (attackingTeam === 'MY') {
        if (typeof bumpStat === 'function') bumpStat('MY', 'shots');
        const isGoal = Math.random() < (activeMatch.myTeam.power / 210);
        if (isGoal) {
            if (typeof bumpStat === 'function') bumpStat('MY', 'shotsOnTarget');
            if (activeMatch.isHome) activeMatch.scoreHome++;
            else activeMatch.scoreAway++;

            document.getElementById('match-score').textContent = `${activeMatch.scoreHome} - ${activeMatch.scoreAway}`;
            addCommentary(activeMatch.minute, `<strong>GOL!</strong> Takımımız organize atakla ceza sahasına girdi, düzgün vuruşla golü bulduk!`, 'goal');

            // Adjust player rating based on positive team event
            adjustPlayerRating(0.2);
            // AMBIENT (seçeneksiz) takım golü kullanıcıya YAZILMAZ — kullanıcının gol/asisti yalnız
            // karar anlarından gelir. (Eskiden allowUser=true idi → sen hiçbir şey yapmadan gol sayın artıyordu.)
            simulateGoalForLineup('MY', false);
        } else {
            if (typeof bumpStat === 'function' && Math.random() < 0.4) bumpStat('MY', 'corners');
            const phrases = [
                "Takımımız sol kanattan ceza sahasına yüklendi ama savunma kornere çeldi.",
                "Orta alandan ceza sahasına gönderilen ara pasında kaleci kalesini terk ederek topa sahip oldu.",
                "Takımımız duran top şansı kazandı. Yapılan ortaya kafa vuruşu geldi ama top az farkla dışarıda."
            ];
            addCommentary(activeMatch.minute, phrases[Math.floor(Math.random() * phrases.length)]);
        }
    } else {
        if (typeof bumpStat === 'function') bumpStat('OPP', 'shots');
        const isGoal = Math.random() < (activeMatch.oppTeam.power / 210);
        
        let goalkeeperSaves = false;
        if (gameState.player.position === 'Kaleci' && !isGoal) {
            goalkeeperSaves = true;
        } else if (!isGoal && Math.random() < 0.6) {
            // Teammate goalkeeper saves
            goalkeeperSaves = true;
        }
        
        if (isGoal && !goalkeeperSaves) {
            if (typeof bumpStat === 'function') bumpStat('OPP', 'shotsOnTarget');
            if (activeMatch.isHome) activeMatch.scoreAway++;
            else activeMatch.scoreHome++;

            document.getElementById('match-score').textContent = `${activeMatch.scoreHome} - ${activeMatch.scoreAway}`;
            addCommentary(activeMatch.minute, `<strong>GOL!</strong> Rakip ${activeMatch.oppTeam.name} ceza sahasına doldurduğu topta golü buldu. Skor değişiyor.`, 'card-red');

            // Conceded goal hurts rating
            adjustPlayerRating(-0.3);
            simulateGoalForLineup('OPP');
        } else {
            const phrases = [
                `Rakip ${activeMatch.oppTeam.name} kontra atağa kalktı ama savunmamız yerinde müdahaleyle topu kaptı.`,
                `Ceza sahası dışından sert şut! Top direğin üzerinden auta gidiyor.`,
                `Defansımızın hatasında rakip araya girdi, kaleciyle karşı karşıya pozisyon ama şut dışarıda!`
            ];
            
            if (goalkeeperSaves) {
                if (typeof bumpStat === 'function') bumpStat('OPP', 'shotsOnTarget');
                if (gameState.player.position === 'Kaleci' && activeMatch.playerStatus === 'starting' && !activeMatch.isSubbedOut) {
                    activeMatch.playerStats.saves++;
                    adjustPlayerRating(0.4);
                    document.getElementById('match-player-action-val').textContent = activeMatch.playerStats.saves;
                    if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'save', team: 'MY', playerName: `${gameState.player.firstname} ${gameState.player.lastname}` });
                } else {
                    const gk = matchLineups.myTeam.find(pl => pl.label === 'KL');
                    if (gk) {
                        gk.saves++;
                        gk.matchRating = Math.min(10.0, gk.matchRating + 0.4);
                        if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'save', team: 'MY', playerName: gk.name });
                    }
                }
                addCommentary(activeMatch.minute, `Rakip oyuncu kaleyi yokladı ama harika yer tutan kalecimiz gole izin vermedi! Kurtarış!`, 'goal');
            } else {
                addCommentary(activeMatch.minute, phrases[Math.floor(Math.random() * phrases.length)]);
            }
        }
    }
}

function adjustPlayerRating(val) {
    activeMatch.playerStats.rating = Math.max(3.0, Math.min(10.0, parseFloat((activeMatch.playerStats.rating + val).toFixed(1))));
    document.getElementById('match-player-rating').textContent = activeMatch.playerStats.rating.toFixed(1);
    renderMatchLineups();
}

// Interactive player decisions depending on position
function triggerPlayerDecision() {
    const pos = gameState.player.position;
    const stats = gameState.player.stats;
    const conditionMult = gameState.player.energy / 100; // Energy impacts chance
    
    const decisionBox = document.getElementById('match-decision-box');
    const decisionText = document.getElementById('decision-text');
    const optionsContainer = document.getElementById('decision-options');
    
    optionsContainer.innerHTML = '';
    
    const scenarioDatabase = {
        'Kaleci': [
            {
                text: "Rakip forvet defansın arkasına sarktı ve kaleyle karşı karşıya şutunu çekiyor!",
                options: [
                    { name: "Köşeye uza ve kurtar", stat: 'teknik', difficulty: 25, success: "İNANILMAZ KURTARIŞ! Kaleci harika uzandı ve topu kornere tokatladı!", fail: "GOL! Top tam köşeye gitti, müdahale yetersiz kaldı." },
                    { name: "Açıyı kapatmak için fırla", stat: 'hiz', difficulty: 20, success: "Mükemmel hız! Rakibin vuruş açısını tamamen kapattın, top sana çarpıp dışarı gitti!", fail: "Gözü kara bir çıkış ama rakip soğukkanlılıkla topu altından ağlara yolladı." },
                    { name: "Ayakta kalıp reflekslerini kullan", stat: 'fizik', difficulty: 30, success: "Kalede adeta devleştin! Çekilen sert şutu göğsünle bloke etmeyi başardın!", fail: "Pozisyonu okuyamadın, sert şut doğrudan ağlarla buluştu." }
                ]
            },
            {
                text: "Rakip köşe vuruşunda kalabalık ceza sahamızda kafa vuruşu yapıldı, top kaleye yöneldi!",
                options: [
                    { name: "Refleksle çizgide çel", stat: 'teknik', difficulty: 22, success: "Çizgi üzerinde inanılmaz refleksler! Kediler gibi topu son anda çelmeyi başardın!", fail: "Kafaya vuruldu, top ağlarda. Çok yakındı ama yetişemedin." },
                    { name: "Topu yumrukla uzaklaştır", stat: 'fizik', difficulty: 26, success: "Çok güçlü! Yumruklarınla topu ceza sahasının dışına fırlattın!", fail: "Topu boşa yumrukladın! Karambolde rakip topu tamamladı ve gol." },
                    { name: "Pozisyonunu koru ve açıyı kapa", stat: 'defans', difficulty: 30, success: "Harika yer tutuş! Top tam durduğun noktaya geldi, rahatça kontrol ettin.", fail: "Yerini yanlış aldın, top ters köşeden ağlara süzüldü." }
                ]
            },
            {
                text: "Ceza sahamızda verilen penaltı vuruşunda topun başına rakip forvet geçiyor! Kritik an!",
                options: [
                    { name: "Sağ köşeye doğru uç", stat: 'teknik', difficulty: 35, success: "SAĞA UZANDI VE KURTARDI! Penaltıda gole geçit vermedin! Muazzam kurtarış!", fail: "Sola vurdu! Kaleci ters köşede kalıyor, penaltı golle sonuçlandı." },
                    { name: "Sol köşeye doğru uç", stat: 'teknik', difficulty: 35, success: "SOLA UZANDI VE KURTARDI! Penaltıda gole geçit vermedin! Muazzam kurtarış!", fail: "Sağa vurdu! Kaleci ters köşede kalıyor, penaltı golle sonuçlandı." },
                    { name: "Ortada sabit kal ve bekle", stat: 'fizik', difficulty: 40, success: "ORTAYA VURDU VE YAKALADIN! Soğukkanlılığını korudun ve penaltıyı bloke ettin!", fail: "Köşeye gönderdi! Hareketsiz kaldın ve top ağlara gitti." }
                ]
            },
            {
                text: "Rakip forvetle bire bir karşı karşıyasın, forvet topu yana çekip seni geçmeye çalışıyor!",
                options: [
                    { name: "Yere yatıp topu sök", stat: 'teknik', difficulty: 26, success: "Nefis plonjon! Rakip çalım atamadan ellerinle topa uzanıp aldın!", fail: "Rakip sıyrıldı ve topu boş kaleye yuvarladı... Gol!" },
                    { name: "Ayakta kalıp rakibi dışarı it", stat: 'fizik', difficulty: 22, success: "Gücünü ve cüsseni kullandın. Rakibi dar açıya sürükledin, şutu yan ağlarda kaldı.", fail: "Rakip kıvrak bir hareketle etrafından dolanıp topu ağlara yolladı." },
                    { name: "Hızla geriye adımla", stat: 'hiz', difficulty: 25, success: "Harika geri adım! Dengeni kaybetmedin ve rakibin şutunu ayağınla kurtardın!", fail: "Dengen bozuldu, rakip şık plaseyle golü buldu." }
                ]
            },
            {
                text: "Ceza sahası dışından sert ve falso alan bir şut köşeye doğru gidiyor! Çok kritik!",
                options: [
                    { name: "Uzanıp topu kornere tokatla", stat: 'teknik', difficulty: 25, success: "İnanılmaz bir sıçrama! Parmaklarının ucuyla topu doksan köşesinden kornere çeldin!", fail: "Top eline çarptı ama hızı kesilmedi, ağlarla buluştu... Gol." },
                    { name: "Güçlü bir sıçrayışla topu çift yumrukla uzaklaştır", stat: 'fizik', difficulty: 22, success: "Kaya gibi! Uçarak gelen topu çift yumrukla ceza sahası dışına fırlattın!", fail: "Topu ıskaladın ve meşin yuvarlak doğrudan ağlarla buluştu." },
                    { name: "Hızlıca pozisyon alıp topu kontrol et", stat: 'hiz', difficulty: 32, success: "Hızlı ayaklar! Açıyı önceden kapayıp topu göğsünde yumuşatarak kontrol ettin.", fail: "Geciktin, top uzanamadığın köşeden filelere süzüldü." }
                ]
            }
        ],
        'Stoper': [
            {
                text: "Rakip hızlı kontra atakta savunmamızı eksik yakaladı ve ceza sahamıza doğru yöneldi!",
                options: [
                    { name: "Sert kayarak müdahale et (Kart Riski!)", stat: 'defans', difficulty: 15, success: "Kusursuz bir zamanlama! Topu tertemiz söküp aldın, tribünler ayağa kalktı!", fail: "Çok geç kaldın! Rakibi biçtin, hakem koşarak geliyor ve... SARI KART!", isSlideTackle: true },
                    { name: "Geri çekil, pas kanallarını kapa", stat: 'pas', difficulty: 24, success: "Çok akıllıca savunma. Araya girerek kritik bir pası kestin ve atağı başlattın!", fail: "Kararsız kaldın. Rakip aradan pasını geçirdi ve gol pozisyonu oldu." },
                    { name: "Fiziksel mücadeleye girip omuz vur", stat: 'fizik', difficulty: 20, success: "Gücünü kullandın! Rakibi adeta topla ezip geride bıraktın, topu kazandık!", fail: "Rakip kıvrak davrandı, omuz darbesinden sıyrılıp ceza sahamıza sızdı." }
                ]
            },
            {
                text: "Rakip kanattan ceza sahamıza doğru tehlikeli bir orta açıldı, rakip forvet havaya yükseliyor!",
                options: [
                    { name: "Yüksel ve kafayla uzaklaştır", stat: 'fizik', difficulty: 22, success: "Hava toplarının efendisi! Rakibin üzerinden yükselip kafayla topu uzaklaştırdın!", fail: "Forvet daha iyi yükseldi ve kafayı vurdu... GOL! Ağlarımız sarsıldı." },
                    { name: "Rakibi marke et ve boz", stat: 'defans', difficulty: 25, success: "Çok iyi yakın markaj! Rakibin düzgün kafa vuruşu yapmasını engelledin, top auta gitti.", fail: "Markajı kaçırdın, rakip bomboş vurdu ve golü attı." },
                    { name: "Hızla pozisyon alıp topu göğsünle indir", stat: 'teknik', difficulty: 32, success: "Harika soğukkanlılık! Ceza sahasında topu göğsünle indirip oyun kurdun.", fail: "Top göğsünden sekti, rakip kapıp vurdu... GOL!" }
                ]
            },
            {
                text: "Ceza sahası yayı üzerinde rakip forvet çalımla içeri girmeye çalışıyor, önünde tek kaldın!",
                options: [
                    { name: "Ayakta müdahale yap", stat: 'defans', difficulty: 20, success: "Zamanlama harika! Ayak koyup topu söktün ve tehlikeyi bitirdin.", fail: "Rakip nefis sıyrıldı, önü boşaldı... Vurdu ve GOL!" },
                    { name: "Hızını kullanıp rakibi çizgiye it", stat: 'hiz', difficulty: 24, success: "Hızınla rakibin önünü kestin, onu dar açıya sürükleyip topu kaybettirdin.", fail: "Rakip senden daha hızlı çıktı, içe kat edip vurdu ve gol." },
                    { name: "Pas kanalını kesmek için geriye adım at", stat: 'pas', difficulty: 28, success: "Pas açısını mükemmel kestin! Arkaya atmaya çalıştığı pası bloke ettin.", fail: "Rakip bunu tahmin etti ve direkt kaleye şut çekti... GOL!" }
                ]
            },
            {
                text: "Rakip orta saha havadan savunma arkasına sarkan top gönderdi, forvetle omuz omuza koşuyorsun!",
                options: [
                    { name: "Gücünü kullanıp rakibi toptan uzaklaştır", stat: 'fizik', difficulty: 18, success: "Muazzam fizik gücü! Rakibi omuz darbesiyle ekarte edip topu göğsünle kaleciye kazandırdın.", fail: "Rakip dengesini korudu ve omuz omuza mücadeleden sıyrılıp şutunu çekti... Gol!" },
                    { name: "Hızlanıp araya gir", stat: 'hiz', difficulty: 26, success: "Depar harika! Hızla araya girip topu çizgiden taca gönderdin.", fail: "Rakip daha hızlı davrandı, önüne aldığı topu kaleye yolladı... Gol." },
                    { name: "Taktiksel müdahaleyle topu kes", stat: 'defans', difficulty: 22, success: "Zekice müdahale! Top yere inmeden bacağını uzatarak tehlikeyi kestin.", fail: "Topu ıskaladın ve rakip kaleciyle karşı karşıya kaldı." }
                ]
            },
            {
                text: "Ceza sahası içinde rakip sol kanat sıfıra inip içeri sert pas çıkarmak üzere!",
                options: [
                    { name: "Açıyı kapatmak için kayarak blokla", stat: 'defans', difficulty: 20, success: "Mükemmel kayış! Pası bloke ettin ve top kornere çıktı.", fail: "Kaydın ama pas altından geçti. İçerideki oyuncu golü attı." },
                    { name: "Hızla pas alıcısını kapat", stat: 'hiz', difficulty: 25, success: "Çok hızlısın! Ceza sahasındaki pası alacak forveti hızla kapatıp topu uzaklaştırdın.", fail: "Forvet senden önce hareketlendi ve pası gole çevirdi." },
                    { name: "Kaleciyi uyarıp pas kanalını pasla kes", stat: 'pas', difficulty: 30, success: "Harika koordinasyon! Pası önceden sezip araya girdin ve atağı başlattın.", fail: "Araya giremedin, top arkadaki forvete ulaştı." }
                ]
            }
        ],
        'Bek': [
            {
                text: "Kanattan hızla bindirme yaptın ve arkadaşın topu önüne yuvarladı. Ne yapacaksın?",
                options: [
                    { name: "Ceza sahasına orta aç", stat: 'pas', difficulty: 20, success: "Mükemmel orta! Ön direğe kavisli ortan forvetimizin kafasına gitti ve GOL! ASİST!", fail: "Çok kötü orta. Top doğrudan kalecinin ellerinde kalıyor.", isAssist: true },
                    { name: "Hızını kullanıp sıfıra in", stat: 'hiz', difficulty: 24, success: "Fırtına gibi çizgiye indin! Defansı geride bırakıp içeri tehlikeli çevirdin ve gol!", fail: "Topu sürerken ayağından fazla açtın, top dışarı çıktı.", isAssist: true },
                    { name: "İçeri kat edip şut dene", stat: 'sut', difficulty: 30, success: "İçeri nefis kat ettin! Ceza sahası köşesinden uzak direğe müthiş vurdun... GOL!", fail: "Şutun defansa çarpıp kornere gidiyor.", isGoal: true }
                ]
            },
            {
                text: "Rakip takımın hızlı kanat oyuncusu çizgi boyunca topu sürerek üzerine geliyor!",
                options: [
                    { name: "Çizgiye doğru kapat", stat: 'hiz', difficulty: 20, success: "Çok hızlısın! Rakibin hızını kesip onu taç çizgisine hapsettin ve topu kaptın.", fail: "Rakip müthiş bir vites artırarak yanından geçti ve ceza sahasına girdi." },
                    { name: "Kayarak topu taça gönder", stat: 'defans', difficulty: 25, success: "Nefis kayarak müdahale! Topu taça atarak takımın yerleşmesini sağladın.", fail: "Boşa kaydın! Rakip çalımladı ve tehlikeli bir orta kesti." },
                    { name: "Omuz omuza fiziksel mücadele yap", stat: 'fizik', difficulty: 22, success: "Gücünü konuşturdun! Omuz darbesiyle rakibi topla ezip geride bıraktın.", fail: "Dengen bozuldu, rakip omuz mücadelesinden galip çıkıp içeri sıyrıldı." }
                ]
            },
            {
                text: "Kendi yarı alanında topu kazandın. Takımın hücuma çıkıyor. Tercihin?",
                options: [
                    { name: "Uzun diyagonal pas gönder", stat: 'pas', difficulty: 22, success: "Müthiş oyun görüşü! Sahayı enlemesine geçen pasın ters kanattaki arkadaşı buldu.", fail: "Pas çok kısa kaldı, rakip orta saha araya girdi." },
                    { name: "Güvenli kısa pas ver", stat: 'teknik', difficulty: 15, success: "Pas isabeti garanti. Takımı sakinleştirip pas trafiğini başlattın.", fail: "Pres altındayken pası ıskaladın ve rakip tehlikeli noktada topu kaptı." },
                    { name: "Topu sürerek alan kat et", stat: 'hiz', difficulty: 26, success: "Boş alanı çok iyi değerlendirdin. Topu sürerek takımını atağa kaldırdın.", fail: "Üç rakip oyuncu birden üzerine kapandı, topu kaybettin." }
                ]
            },
            {
                text: "Kanatta pası aldın, karşındaki rakip kanat oyuncusu sana sert bir pres uyguluyor!",
                options: [
                    { name: "Teknikle sıyrıl", stat: 'teknik', difficulty: 20, success: "Klas vücut çalımı! Presi geçip takımı kontra atağa kaldırdın.", fail: "Topu kaptırdın, rakip doğrudan ceza sahamıza yöneldi." },
                    { name: "Hızlı tek pasla pası aktar", stat: 'pas', difficulty: 16, success: "Harika tek pas! Pres gelmeden arkadaşına oynadın ve oyunu rahatlattın.", fail: "Pasi yavaş attın, rakip araya girdi." },
                    { name: "Fiziğinle topu sakla", stat: 'fizik', difficulty: 24, success: "Kalkan gibi gövden! Topu saklayıp faul almayı başardın.", fail: "Rakip arkadan topa dokunup söktü." }
                ]
            },
            {
                text: "Savunma çizgisinde rakip forvet arkaya kaçtı, ofsayt tuzağını bozmamak için hızlıca pozisyon almalısın!",
                options: [
                    { name: "Hızla geriye koşup çizgiye gir", stat: 'hiz', difficulty: 22, success: "Hızlı adımlar! Savunma hattına zamanında girip tehlikeyi önledin.", fail: "Geciktin, rakip ofsayt tuzağını aşarak kaleciyle karşı karşıya kaldı." },
                    { name: "Taktiksel yerleşimle ofsayt çizgisi çek", stat: 'defans', difficulty: 25, success: "Mükemmel taktik zeka! Çizgiyi korudun ve hakemin ofsayt bayrağı kalktı.", fail: "Çizgiyi kaçırdın ve rakip bomboş pozisyonda topla buluştu." },
                    { name: "Geriye pas atarak baskıyı kır", stat: 'pas', difficulty: 28, success: "Pas açısını mükemmel kestin! Arkaya atmaya çalıştığı pası bloke ettin.", fail: "Rakip bunu tahmin etti ve direkt kaleye şut çekti... GOL!" }
                ]
            }
        ],
        'DOS': [
            {
                text: "Rakip takım merkezden hızla geliyor, defans hattı önünde tek kaldın!",
                options: [
                    { name: "Taktik faul yap (Kart Riski!)", stat: 'defans', difficulty: 18, success: "Çok profesyonelce bir faul. Rakibin hızını kestin, hakem uyardı ama kart çıkmadı.", fail: "Sert müdahale! Rakibin bileğine bastın, hakem SARI KART gösteriyor.", isSlideTackle: true },
                    { name: "Pas kanalını kapatıp topu kes", stat: 'pas', difficulty: 26, success: "Mükemmel oyun okuma! Pası atacağı yeri tahmin edip topu kestin.", fail: "Pas bacaklarının arasından geçti, rakip hücum hattı pozisyona girdi." },
                    { name: "Sert ikili mücadeleye gir", stat: 'fizik', difficulty: 22, success: "Kaya gibi durdun! Rakibe omuz koyup topu kazandın ve takımı atağa kaldırdın.", fail: "Rakip senden daha güçlü çıktı, çalımlayıp önünü açtı." }
                ]
            },
            {
                text: "Rakip köşe vuruşu sonrası savunmamız topu uzaklaştırdı, ceza sahası yayında sahipsiz top var!",
                options: [
                    { name: "Gelişine kaleyi dene", stat: 'sut', difficulty: 32, success: "İNANILMAZ VURDUN! Havadan gelen topa gelişine mükemmel vurdun ve GOL!", fail: "Çok kötü vuruş, top auta gidiyor.", isGoal: true },
                    { name: "Topu kontrol edip sakla", stat: 'teknik', difficulty: 18, success: "Nefis kontrol! Topu saklayıp takımın hücuma yerleşmesini sağladın.", fail: "Kötü kontrol, rakip presle topu ceza sahası önünde kaptı." },
                    { name: "Tek pasla hızlı kanata aktar", stat: 'pas', difficulty: 24, success: "Harika tek pas! Beklemeden topu kanada açtın ve kontra atağı başlattın.", fail: "Pasın taca çıkıyor." }
                ]
            },
            {
                text: "Orta sahada kapılan topu aldın, oyun çok sıkıştı. Ne yapacaksın?",
                options: [
                    { name: "Ters kanata uzun pas at", stat: 'pas', difficulty: 24, success: "Klasını konuşturdun! Ters kanattaki boşluğu görüp milimetrik uzun pas gönderdin.", fail: "Pas çok yavaş gitti, rakip bek araya girdi." },
                    { name: "Geriye dönüp güvenli pas ver", stat: 'teknik', difficulty: 14, success: "En mantıklısı. Oyunu sakinleştirip pas ritmini korudun.", fail: "Pas hatası! Kaleciye yavaş pas gönderdin, rakip araya girdi!" },
                    { name: "Topu sürerek presi kır", stat: 'hiz', difficulty: 28, success: "Beklenmedik hareket! Çevikliğinle iki orta saha arasından sıyrılıp önünü açtın.", fail: "Presin ortasında kaldın, topu kaybettin." }
                ]
            },
            {
                text: "Savunmadan gelen topu orta sahada kontrol ettin, rakip orta sahalar seni ablukaya aldı!",
                options: [
                    { name: "Kıvrak dönüşle baskıyı kır", stat: 'teknik', difficulty: 22, success: "Nefis dönüş! Zarifçe dönüp ablukadan çıktın ve pasını verdin.", fail: "Ablukada topu kaptırdın ve tehlike yarattın." },
                    { name: "Gövdenle topu saklayıp pas ver", stat: 'fizik', difficulty: 18, success: "Fizik kaliteni kullandın! Rakipleri sırtında tutup arkadaşına pası aktardın.", fail: "Rakipler seni yere yıktı ama hakem faulü vermedi, top rakipte kaldı." },
                    { name: "Hızla topu çizgiye kaydır", stat: 'hiz', difficulty: 26, success: "Hızlı paslaşma. Pres gelmeden topu çizgideki beke aktardın.", fail: "Pas hatalı gitti, rakip kaptı." }
                ]
            },
            {
                text: "Rakip takım ceza sahamıza yakın bir bölgede tehlikeli bir pas trafiği yapıyor!",
                options: [
                    { name: "Alan kapatıp pası engelle", stat: 'defans', difficulty: 20, success: "Harika duruş! Rakibin kilit pas açısını kapatıp topu kornere çeldin.", fail: "Pas arandan geçti, rakip şut pozisyonu buldu." },
                    { name: "Fiziksel presle rakibi boz", stat: 'fizik', difficulty: 24, success: "Güçlü pres! Rakip oyun kurucuyu bozup topu kazanmayı başardın.", fail: "Rakip tek topla presinden sıyrıldı." },
                    { name: "Hızla atağı kesmek için topa fırla", stat: 'hiz', difficulty: 28, success: "Müthiş reaksiyon! Hızla araya girip tehlikeyi kestin.", fail: "Geç kaldın, rakip pası ceza sahasına aktardı." }
                ]
            }
        ],
        'Merkez OS': [
            {
                text: "Takımımız hücumdayken ceza sahası yayına doğru boş koşu yaptın ve pas geldi!",
                options: [
                    { name: "Gelişine şut çek", stat: 'sut', difficulty: 28, success: "MÜTHİŞ ŞUT! Yerden sert ve köşeye giden vuruşun ağlarla buluştu... GOL!", fail: "Şutun kalecinin üstüne gidiyor.", isGoal: true },
                    { name: "Verkaç yaparak içeri sız", stat: 'pas', difficulty: 20, success: "Mükemmel duvar pası! Tek pasla savunma arkasına sızdın ve vurdun... GOL!", fail: "Verkaçta atılan pas savunmanın ayağına çarptı.", isGoal: true },
                    { name: "Çalım atıp önünü boşalt", stat: 'teknik', difficulty: 24, success: "Zarif vücut çalımı! Önündeki stoperi oyundan düşürüp golünü attın!", fail: "Çalım denerken rakip stoper ayak koydu.", isGoal: true }
                ]
            },
            {
                text: "Rakip orta saha oyun kurmaya çalışırken üzerine doğru geliyor. Pres vakti!",
                options: [
                    { name: "Agresif pres yap", stat: 'fizik', difficulty: 20, success: "Harika baskı! Rakibe nefes aldırmayıp dengesini bozdun ve topu kaptın.", fail: "Rakip pasını aktardı, boşa çıktın." },
                    { name: "Gölge markajı yap", stat: 'defans', difficulty: 24, success: "Kusursuz savunma duruşu. Geçiş yolunu kapatarak rakibi geriye dönmeye zorladın.", fail: "Rakip vücut çalımıyla yanından sıyrılıp hücumu başlattı." },
                    { name: "Pas açısını kapat", stat: 'pas', difficulty: 22, success: "Harika alan daraltma. Pas atacağı arkadaşını gölgeleyip pası engelledin.", fail: "Pas arandan geçti, rakip tehlikeli şekilde çıktı." }
                ]
            },
            {
                text: "Orta sahada pası aldın, rakip savunma çizgi halinde önde yakalandı!",
                options: [
                    { name: "Savunma arkasına ara pası", stat: 'pas', difficulty: 20, success: "OLAĞANÜSTÜ ARA PASI! Forvetimiz kaleciyle karşı karşıya kaldı ve golü attı! ASİST!", fail: "Pas çok hızlı gitti, kaleci çıktı ve aldı.", isAssist: true },
                    { name: "Kanat koşucusuna pas ver", stat: 'teknik', difficulty: 15, success: "Pas tam isabet. Kanat oyuncusunu sıfıra inmesi için kaçırdın.", fail: "Hatalı pas, top doğrudan dışarı gidiyor." },
                    { name: "Uzaktan kaleyi dene", stat: 'sut', difficulty: 32, success: "MÜTHİŞ ŞUT! 30 metreden kalecinin uzanamayacağı köşeye gönderdin... GOL!", fail: "Şutun direğin üstünden auta gidiyor.", isGoal: true }
                ]
            },
            {
                text: "Kanattan ceza sahasına doğru dripling yaptın, iki savunmacı üzerine kapandı!",
                options: [
                    { name: "Çalımla aradan sıyrıl", stat: 'teknik', difficulty: 24, success: "Muazzam çalım! İki oyuncunun arasından topu geçirip ceza sahasına sızdın ve vurdun... Gol!", fail: "Topu sıkıştırıp kaptılar, kontra atağa çıktılar.", isGoal: true },
                    { name: "Boştaki arkadaşına ara pası bırak", stat: 'pas', difficulty: 18, success: "Akıllıca! Savunma üzerine gelince yaydaki arkadaşını gördün, o da tamamladı... Asist!", fail: "Pasın defansa çarpıp yön değiştirdi.", isAssist: true },
                    { name: "Hızınla sıyrılmayı dene", stat: 'hiz', difficulty: 26, success: "Ani ivmelenme! Rakipler reaksiyon veremeden aralarından fırladın.", fail: "Rakip stoper hızına yetişip topu söktü." }
                ]
            },
            {
                text: "Rakip ceza sahası dışında topla buluştun, kaleye yaklaşık 25 metre mesafedesin ve önün boş!",
                options: [
                    { name: "Sert şut çek", stat: 'sut', difficulty: 24, success: "FÜZE GÖNDERDİN! Kaleci çaresiz kaldı, top çatala gitti ve GOL!", fail: "Şutun kalecinin kucağına gitti.", isGoal: true },
                    { name: "Ceza sahası içine derin pas at", stat: 'pas', difficulty: 20, success: "Harika oyun zekası! Araya sarkan santrforu gördün, golü attırdın! ASİST!", fail: "Defans pası kesti.", isAssist: true },
                    { name: "Şık bir ayak dışı çalımla stoperi geç", stat: 'teknik', difficulty: 28, success: "Nefis estetik! Stoperi bacak arasıyla geçip kaleciyi de avladın!", fail: "Stoper geçit vermedi.", isGoal: true }
                ]
            }
        ],
        'Ofansif OS': [
            {
                text: "Ceza sahası dışında topla buluştun. Rakip savunma önünü kapatıyor!",
                options: [
                    { name: "Ara pası gönder", stat: 'pas', difficulty: 20, success: "MİLİMETRİK PAS! Defansın arasından geçen top forvetimizi golle buluşturdu! ASİST!", fail: "Savunma pası okudu ve topu uzaklaştırdı.", isAssist: true },
                    { name: "Dönerek şık bir çalım at", stat: 'teknik', difficulty: 24, success: "Nefis 360 derece dönüş! Rakipten sıyrılıp ceza sahasına girdin ve vurdun... GOL!", fail: "Rakip stoper dengesini kaybetmedi ve topu kaptı.", isGoal: true },
                    { name: "Plase şut dene", stat: 'sut', difficulty: 28, success: "HARİKA PLASE! Top falso alarak köşeye gitti... VE GOL!", fail: "Plase vuruşunda top direği yalayarak auta gitti.", isGoal: true }
                ]
            },
            {
                text: "Ceza sahasında seken top önünde kaldı. Çok az zamanın var!",
                options: [
                    { name: "Doğrudan şut çek", stat: 'sut', difficulty: 25, success: "Mükemmel bitiricilik! Kalabalığın arasından topu ağlara yolladın... GOL!", fail: "Şutun defanstan geri dönüyor.", isGoal: true },
                    { name: "Boştaki santrfora pas çıkar", stat: 'pas', difficulty: 15, success: "Çok akıllıca! Boştaki arkadaşını gördün, o da boş kaleye tamamladı! ASİST!", fail: "Pasın çok zayıf kaldı, aradaki defans topu kesti.", isAssist: true },
                    { name: "Fiziğini kullanıp topu koru", stat: 'fizik', difficulty: 22, success: "Gücünü kullandın. Rakip stoperi sırtında taşıyıp faul kazandırdın.", fail: "Fiziksel mücadelede topu kaybettin, rakip tehlikeyi uzaklaştırdı." }
                ]
            },
            {
                text: "Ceza sahası çizgisinin hemen dışında tehlikeli bir noktada serbest vuruş kazandık!",
                options: [
                    { name: "Doğrudan baraj üstünden şut çek", stat: 'sut', difficulty: 30, success: "NEFİS FRİKİK GOLÜ! Barajın üstünden süzülen top tam köşeden ağlarda!", fail: "Şut baraja çarpıyor.", isGoal: true },
                    { name: "Arka direğe orta aç", stat: 'pas', difficulty: 22, success: "Nefis orta! Kavisli pasın arka direkteki stoperimizin kafasıyla GOL oldu! ASİST!", fail: "Orta çok uzun gitti, doğrudan auta çıkıyor.", isAssist: true },
                    { name: "Paslaşarak organizasyon yap", stat: 'teknik', difficulty: 18, success: "Akıllıca paslaşma! Şut çekecek gibi yapıp arkadaşına çıkardın, o da golü attı!", fail: "Pas organizasyonu başarısız, rakip araya girdi.", isAssist: true }
                ]
            },
            {
                text: "Rakip kaleci köşe vuruşunu yumrukladı, dönen top ceza sahası dışında senin önüne indi!",
                options: [
                    { name: "Gelişine voleyi yapıştır", stat: 'sut', difficulty: 28, success: "İNANILMAZ BİR VOLE! Top mermi gibi ağlara gitti... GOL!", fail: "Vole gökyüzüne uçtu, auta gitti.", isGoal: true },
                    { name: "Havada göğsünle yumuşatıp çalım at", stat: 'teknik', difficulty: 24, success: "Harika kontrol! Topu göğsünle indirip önündeki defansı geçerek vurdun ve GOL!", fail: "İndirirken stoper araya girdi.", isGoal: true },
                    { name: "Yere inen topu ceza sahasına pas at", stat: 'pas', difficulty: 18, success: "Nefis tek pas! Topu bekletmeden ceza sahasındaki santrforra aktardın ve GOL! ASİST!", fail: "Pas rakipte kaldı.", isAssist: true }
                ]
            },
            {
                text: "Savunma arkasına kaçan santrfor ile aranda sadece bir stoper var!",
                options: [
                    { name: "Aşırtma ara pası gönder", stat: 'pas', difficulty: 22, success: "Nefis pas! Defansın üstünden aşırdığın top santrforla buluştu ve GOL! ASİST!", fail: "Pas çok uzun gitti, kaleci çıktı ve aldı.", isAssist: true },
                    { name: "Driblingle stoperin üzerine git ve çalımla", stat: 'teknik', difficulty: 25, success: "Nefis çalım! Stoperi oyundan düşürüp pasını boş kaleye yuvarladın... Asist!", fail: "Stoper topu söktü.", isAssist: true },
                    { name: "Hızınla stoperi ekarte edip şut at", stat: 'hiz', difficulty: 26, success: "Çok hızlısın! Stoperi geride bırakıp şutunu çektin ve GOL!", fail: "Şutun direğe çarptı.", isGoal: true }
                ]
            }
        ],
        'Kanat': [
            {
                text: "Kanatta topla buluştun, rakip bek oyuncusuyla bire bir karşı karşıyasın!",
                options: [
                    { name: "Hızınla çizgiye in", stat: 'hiz', difficulty: 20, success: "Müthiş ivmelenme! Rakibini arkanda bırakıp sıfıra indin ve içeri çevirdin... GOL! ASİST!", fail: "Rakip bek hızına yetişti ve kayarak topu kesti.", isAssist: true },
                    { name: "İçeri kat edip şut çek", stat: 'sut', difficulty: 26, success: "Nefis Robben tarzı gol! İçe kat edip uzak köşeye mükemmel vurdun ve GOL!", fail: "Şutun kalecide kalıyor.", isGoal: true },
                    { name: "Orta alana akıllıca pas ver", stat: 'pas', difficulty: 16, success: "Harika vizyon. Bindiren orta saha oyuncumuzu görüp gol pozisyonu yarattın.", fail: "Pas araya giden rakipte kaldı.", isChance: true }
                ]
            },
            {
                text: "Savunmamız uzun pas gönderdi, rakip savunma arkasında bomboş koşuyorsun!",
                options: [
                    { name: "Topu kontrol edip kaleye sür", stat: 'teknik', difficulty: 22, success: "Mükemmel ilk dokunuş! Topu önüne alıp kaleciyle karşı karşıya golü attın!", fail: "Kötü kontrol! Top ayağından sekti ve kaleci çıktı aldı.", isGoal: true },
                    { name: "Gelişine ceza sahasına orta aç", stat: 'pas', difficulty: 26, success: "Harika tek top! Bekletmeden yaptığın orta arka direkteki forvetin kafasıyla GOL oldu!", fail: "Orta doğrudan dışarı çıkıyor.", isAssist: true },
                    { name: "Tek dokunuşla kalecinin üstünden aşır", stat: 'sut', difficulty: 32, success: "HARİKA AŞIRTMA! Kalecinin çıktığını görüp üzerinden aşırdın ve GOL!", fail: "Aşırtma vuruşunda top üst ağlarda kaldı.", isGoal: true }
                ]
            },
            {
                text: "Ters kanattan takım arkadaşın harika bir orta kesti, arka direkte topa koşuyorsun!",
                options: [
                    { name: "Kafa vuruşu yap", stat: 'fizik', difficulty: 24, success: "Harika yükseliş! Kafayla topu yakın köşeden ağlara yolladın... GOL!", fail: "Kafa vuruşu üstten auta çıkıyor.", isGoal: true },
                    { name: "Gelişine vole vur", stat: 'sut', difficulty: 32, success: "MÜKEMMEL VOLE! Havada süzülen topa harika vurdun, fileler yırtılacak gibi! GOL!", fail: "Topu ıskaladın, büyük fırsat kaçtı.", isGoal: true },
                    { name: "Topu kontrol edip içeri çıkar", stat: 'teknik', difficulty: 18, success: "Çok soğukkanlı. Topu indirip boştaki arkadaşına pası verdin ve GOL! ASİST!", fail: "Topu indirirken savunma araya girip tehlikeyi önledi.", isAssist: true }
                ]
            },
            {
                text: "Topla birlikte hızla kontra atağa kalktın, önünde büyük bir boş alan var!",
                options: [
                    { name: "Topu sürerek hız rekoru kır", stat: 'hiz', difficulty: 18, success: "Fırtına gibi! Rakip bek arkandan yetişemedi, ceza sahasına girip golü attın!", fail: "Topu sürerken fazla açtın, stoper araya girdi.", isGoal: true },
                    { name: "İçeri kat edip arkadaşına orta yap", stat: 'pas', difficulty: 22, success: "Harika orta! Hızla giderken içeri kavisli kestin, santrfor tamamladı... Asist!", fail: "Orta kalecide kaldı.", isAssist: true },
                    { name: "Nefis bir şut plase yap", stat: 'sut', difficulty: 28, success: "Nefis plase! Ceza sahasına girer girmez köşeye bıraktın ve GOL!", fail: "Şutun auta gitti.", isGoal: true }
                ]
            },
            {
                text: "Ceza sahası dışında topla buluştun, arka direkte santrfor elini kaldırıyor!",
                options: [
                    { name: "Adrese teslim orta gönder", stat: 'pas', difficulty: 20, success: "Milimetrik orta! Santrfor yükseldi kafayı vurdu ve GOL! ASİST!", fail: "Orta çok yüksek gitti, arka direkte kimse dokunamadı.", isAssist: true },
                    { name: "Savunmayı çalımlayıp şut çek", stat: 'teknik', difficulty: 25, success: "Müthiş çalımlar! İki defansı geçip yakın köşeden golü buldun!", fail: "Çalım atarken topu kaptırdın.", isGoal: true },
                    { name: "Hızla çizgiye inip yerden sert kes", stat: 'hiz', difficulty: 22, success: "Hızlı bindirme! Sıfırdan yerden sert çevirdin, savunma kendi kalesine attı... Asist!", fail: "Yerden orta kalecide kaldı.", isAssist: true }
                ]
            }
        ],
        'Santrfor': [
            {
                text: "Defansın hatasında ceza sahası içinde topla buluştun, önünde sadece kaleci var!",
                options: [
                    { name: "Sert şut çek", stat: 'sut', difficulty: 20, success: "Bitiricilik dersi! Topu plase ile uzak köşeye gönderdin ve GOL!", fail: "Şutun direkten geri dönüyor.", isGoal: true },
                    { name: "Aşırtma vuruş yap", stat: 'teknik', difficulty: 25, success: "Müthiş aşırtma! Kaleden çıkan kalecinin üstünden aşırdın ve GOL!", fail: "Aşırtma vuruşu yavaş kaldı, kaleci geriye koşup çizgide yakaladı.", isGoal: true },
                    { name: "Kaleciyi çalımla", stat: 'hiz', difficulty: 28, success: "Müthiş çalım! Kaleciyi geçtin ve topu boş kaleye yolladın! GOL!", fail: "Kaleci uyanık davrandı, ayaklarına yatarak topa sahip oldu.", isGoal: true }
                ]
            },
            {
                text: "Kanattan gelen yüksek ortaya ceza sahası içinde yükseliyorsun!",
                options: [
                    { name: "Sert kafa vuruşu yap", stat: 'fizik', difficulty: 22, success: "Mükemmel kafa golü! Yer çekimine meydan okuyup köşeye vurdun... GOL!", fail: "Kafan az farkla direğin yanından auta çıkıyor.", isGoal: true },
                    { name: "Topu indirip arkadaşına ver", stat: 'pas', difficulty: 18, success: "Harika servis! Kafayla arkadan gelen arkadaşına indirdin, o da golü attı! ASİST!", fail: "İndirdiğin top savunmada kaldı.", isAssist: true },
                    { name: "Röveşata dene", stat: 'sut', difficulty: 38, success: "YILIN GOLÜ! Havada makas gibi açılıp muazzam bir röveşata attın! GOL!", fail: "Röveşata vuruşunda top ıskalandı, savunma uzaklaştırdı.", isGoal: true }
                ]
            },
            {
                text: "Sırtın kaleye dönük şekilde stoperle boğuşarak topu aldın!",
                options: [
                    { name: "Dönerek aniden şut çek", stat: 'sut', difficulty: 25, success: "Nefis dönüş! Stoperi sırtında döndürüp kaleye sert vurdun... GOL!", fail: "Şutun stoperin bacağına çarpıp kornere gidiyor.", isGoal: true },
                    { name: "Topu saklayıp geriye çıkar", stat: 'fizik', difficulty: 18, success: "Gücünü kullandın, topu koruyup geriden gelen orta sahaya verdin ve gol oldu! ASİST!", fail: "Topu saklarken faul yaptın, atak kesildi.", isAssist: true },
                    { name: "Çalım atarak sıyrıl", stat: 'teknik', difficulty: 24, success: "Harika çalım! Rakibi bacak arasıyla geçip önünü açtın ve golü attın!", fail: "Rakip stoper geçit vermedi, topu kaptı.", isGoal: true }
                ]
            },
            {
                text: "Köşe vuruşunda ceza sahası içinde ön direkte topla buluşmak üzere koştun!",
                options: [
                    { name: "Fizik kalitenle stoperi ezip kafayı vur", stat: 'fizik', difficulty: 20, success: "Kaya gibi! Rakip stoperin üzerinden yükselip kafayla ağları havalandırdın! GOL!", fail: "Stoper seni bozdu, düzgün kafa vuruşu gelmedi.", isGoal: true },
                    { name: "Gelişine şık bir topuk şutu çek", stat: 'sut', difficulty: 30, success: "KLAS HAREKET! Ön direkte topuğuyla dokundun ve kaleciyi avladın... GOL!", fail: "Topuk şutu auta gitti.", isGoal: true },
                    { name: "Hızınla ön direğe fırlayıp dokun", stat: 'hiz', difficulty: 22, success: "Çok hızlı depar! Ön direğe herkesten önce koşup topu ağlara yolladın! GOL!", fail: "Stoper senden önce ayak koydu.", isGoal: true }
                ]
            },
            {
                text: "Savunma arkasına atılan pası göğsünle indirip kaleciyi karşına aldın!",
                options: [
                    { name: "Kalecinin altından plase bırak", stat: 'sut', difficulty: 22, success: "Soğukkanlı bitiriş! Kalecinin altından topu yuvarlayıp GOLÜ attın!", fail: "Şutun kaleciden geri döndü.", isGoal: true },
                    { name: "Nefis bir vücut çalımıyla kaleciyi geç", stat: 'teknik', difficulty: 25, success: "Harika çalım! Kaleciyi yatırıp sıyrıldın ve topu boş kaleye yuvarladın... GOL!", fail: "Kaleci topu elleriyle söktü.", isGoal: true },
                    { name: "Fiziğinle stoper presini kalkanla göğüsle", stat: 'fizik', difficulty: 24, success: "Muazzam güç! Arkadan gelen stoperin presine rağmen şutunu çekip golü buldun!", fail: "Stoper presi dengeni bozdu, şutun dışarı gitti.", isGoal: true }
                ]
            }
        ]
    };
    
    // 12 mevkiyi senaryo setine AİLE bazlı eşle (Sağ/Sol Bek→Bek, Sağ/Sol Açık+Kanat→Kanat...).
    // Önceden eski 8-anahtar ('Bek'/'Kanat') kontrol ediliyordu; gerçek mevki adları uymadığı için
    // bek/açık/kanat oyuncuları yanlışlıkla SANTRFOR senaryoları görüyordu.
    const _fam = (typeof posFamily === 'function') ? posFamily(pos) : 'ST';
    const FAM_TO_KEY = { GK: 'Kaleci', CB: 'Stoper', FB: 'Bek', DM: 'DOS', CM: 'Merkez OS', AM: 'Ofansif OS', WM: 'Kanat', W: 'Kanat', ST: 'Santrfor' };
    const key = FAM_TO_KEY[_fam] || 'Santrfor';
    
    const scenarios = scenarioDatabase[key] || scenarioDatabase['Santrfor'];
    
    // Choose random scenario from the 3 scenarios available
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
    
    decisionText.textContent = scenario.text;
    addCommentary(activeMatch.minute, `TEHLİKELİ POZİSYON: ${gameState.player.firstname} oyuna ağırlığını koymak üzere!`, 'interactive');
    
    scenario.options.forEach(opt => {
        const playerStatVal = stats[opt.stat];
        let exec = Math.round((playerStatVal - opt.difficulty) * conditionMult);
        exec = Math.max(15, Math.min(92, exec));
        // Gol/asist seçeneklerinde GÖSTERİLEN % = GERÇEK gol/asist şansıdır (gizli ikinci
        // dönüşüm zarı YOK). Bitiricilik gerçekçiliği için icra şansı 0.75 ile ölçeklenir →
        // "gördüğün sayı = attığın sayı". Savunma/şans/kurtarış seçeneklerinde icra şansı aynen.
        const _goalType = !!(opt.isGoal || opt.isAssist);
        const chance = _goalType ? Math.max(12, Math.min(85, Math.round(exec * 0.75))) : exec;
        const label = opt.isGoal ? 'Gol Şansı' : (opt.isAssist ? 'Asist Şansı' : 'Başarı');

        const btn = document.createElement('button');
        btn.className = 'btn-decision';
        btn.innerHTML = `
            <span>${opt.name}</span>
            <span class="desc-chance">%${chance} ${label} (${opt.stat.toUpperCase()})</span>
        `;

        btn.addEventListener('click', () => {
            resolvePlayerDecision(opt, chance);
        });

        optionsContainer.appendChild(btn);
    });
    
    decisionBox.style.display = 'flex';
}

// Karar anı sonuç TÜRÜ — yalnız AÇIK etiketlerden (artık metin-tahmini YOK; her hücum seçeneğinde
// isGoal/isAssist/isChance açıkça tanımlı). Etiketsiz saha-içi seçenek = savunma/top koruma (gol yok).
function _decisionOutcome(option, pos) {
    if (option.isGoal) return 'goal';
    if (option.isAssist) return 'assist';
    if (option.isChance) return 'chance';
    if (pos === 'Kaleci') return 'save';
    return 'none';
}

// Oyundan çıkış (kullanıcı talebi VEYA hoca kararı) sonrası: maç BİTMEZ — kullanıcı
// yedekten kalanı izler, ticker normal akışında devam eder (istenirse "Kalanı Simüle Et" hızlandırır).
function _resumeAfterSubOut() {
    const subOutBtn = document.getElementById('btn-match-sub-out');
    if (subOutBtn) subOutBtn.style.display = 'none';
    const statusBadge = document.getElementById('match-status-badge');
    if (statusBadge) statusBadge.innerHTML = `<i class="fa-solid fa-eye text-info"></i> Oyundan çıktın — kalanı izliyorsun`;
    if (typeof renderMatchLineups === 'function') renderMatchLineups();
    runMatchTicker();
}

function resolvePlayerDecision(option, chance) {
    document.getElementById('match-decision-box').style.display = 'none';
    
    const roll = Math.floor(Math.random() * 100) + 1;
    const isSuccess = roll <= chance;
    
    const userFull = `${gameState.player.firstname} ${gameState.player.lastname}`;
    if (isSuccess) {
        const _out = _decisionOutcome(option, gameState.player.position);

        if (_out === 'goal' || _out === 'assist') {
            // Gösterilen % ZATEN gerçek gol/asist şansıdır (triggerPlayerDecision'da dönüşüm
            // folded edildi) → gizli ikinci zar YOK: başarılı zar = gol/asist. "Gördüğün sayı,
            // attığın sayı" → 60 görüp 31 atma sorunu biter; aktif oynamak ödüllü.
            addCommentary(activeMatch.minute, option.success, 'goal');
            adjustPlayerRating(0.8);
            if (_out === 'goal') {
                activeMatch.playerStats.goals++;
                if (activeMatch.isHome) activeMatch.scoreHome++;
                else activeMatch.scoreAway++;
                document.getElementById('match-score').textContent = `${activeMatch.scoreHome} - ${activeMatch.scoreAway}`;
                adjustPlayerRating(1.2);
                if (typeof bumpStat === 'function') bumpStat('MY', 'shotsOnTarget');
                if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: option.isPenalty ? 'penalty-scored' : 'goal', team: 'MY', playerName: userFull });
            } else {
                activeMatch.playerStats.assists++;
                if (activeMatch.isHome) activeMatch.scoreHome++;
                else activeMatch.scoreAway++;
                document.getElementById('match-score').textContent = `${activeMatch.scoreHome} - ${activeMatch.scoreAway}`;
                adjustPlayerRating(0.9);
                if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'assist', team: 'MY', playerName: userFull });
            }
        } else if (_out === 'save') {
            addCommentary(activeMatch.minute, option.success, 'goal');
            activeMatch.playerStats.saves++;
            adjustPlayerRating(0.6);
            if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'save', team: 'MY', playerName: userFull });
        } else {
            // Savunma / top koruma / şans yaratma — başarılı icra, gol yok, makul puan.
            addCommentary(activeMatch.minute, option.success, 'goal');
            adjustPlayerRating(0.7);
        }

    } else {
        const _outF = _decisionOutcome(option, gameState.player.position);
        if (_outF === 'goal' || _outF === 'assist') {
            // Net şans kaçtı — blunder DEĞİL, normal kaçan gol/asist (hafif puan etkisi, gol yeme yok).
            addCommentary(activeMatch.minute, option.fail, 'interactive');
            adjustPlayerRating(-0.15);
            if (typeof bumpStat === 'function') bumpStat('MY', 'shots');
            if (option.isPenalty && typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'penalty-missed', team: 'MY', playerName: userFull });
        } else {
            addCommentary(activeMatch.minute, option.fail, 'card-red');
            adjustPlayerRating(-0.4);
            if (option.isPenalty && typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'penalty-missed', team: 'MY', playerName: userFull });

            if (option.isSlideTackle) {
                activeMatch.playerStats.yellow = true;
                addCommentary(activeMatch.minute, `Hakem faul kararı veriyor ve ${userFull} oyuncumuza <strong>SARI KART</strong> gösteriyor.`, 'card');
                adjustPlayerRating(-1.0);
                if (typeof bumpStat === 'function') { bumpStat('MY', 'fouls'); bumpStat('MY', 'yellows'); }
                if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'yellow', team: 'MY', playerName: userFull });
            }

            // Başarısızlıkta gol yeme ihtimali — yalnız savunma/kaleci pozisyonları (hücum kaçırması gol getirmez)
            const _fam = (typeof posFamily === 'function') ? posFamily(gameState.player.position) : '';
            const _concedeProb = _fam === 'GK' ? 0.85 : ((_fam === 'CB' || _fam === 'FB' || _fam === 'DM') ? 0.4 : 0);
            if (_concedeProb && Math.random() < _concedeProb) {
                if (activeMatch.isHome) activeMatch.scoreAway++;
                else activeMatch.scoreHome++;
                document.getElementById('match-score').textContent = `${activeMatch.scoreHome} - ${activeMatch.scoreAway}`;
                addCommentary(activeMatch.minute, `Pozisyonun devamında rakip hücum hattı topu ağlarımıza gönderiyor! Gol!`, 'card-red');
                if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'goal', team: 'OPP', playerName: activeMatch.oppTeam.name });
            }
        }
    }
    
    // Update player performance stats row
    const actionStatVal = document.getElementById('match-player-action-val');
    if (gameState.player.position === 'Kaleci') {
        actionStatVal.textContent = activeMatch.playerStats.saves;
    } else {
        actionStatVal.textContent = `${activeMatch.playerStats.goals} / ${activeMatch.playerStats.assists}`;
    }
    
    // Resume match ticker
    runMatchTicker();
}

// FAZ 3d: KULLANICININ kendi maçını da dünya IDB'sine (matches) yaz — böylece
// kulüp ARKADAŞLARI gol krallığında/profilde GERÇEK statla görünür ve maç geçmişte
// detaylı saklanır. Dünyanın diğer maçları recordWorldWeekDetails ile yazılır (kullanıcı
// maçını ATLAR); bunu burada tamamlarız. Skor parçalaması: kullanıcının golleri 'USER'
// (cache/aggregate USER'ı ATLAR → çift sayma yok; kullanıcı zaten gameState'ten gelir),
// kalan takım golleri arkadaşlara (WorldSim ağırlığı), rakip golleri rakip kadroya atanır.
// Additive + fire-and-forget: IDB yoksa/başarısızsa oyun aynen çalışır.
// useLineups: canlı maçta matchLineups GERÇEKTİR (startMatchDay kurdu) → onu kullan.
// instant-sim'de matchLineups KURULMAZ (bayat olabilir) → squad'tan en iyi 11 seç.
function _recordUserMatchToWorld(myMatch, userGoals, userAssists, useLineups) {
    if (!myMatch || myMatch.isBay) return;
    if (activeMatch && activeMatch.isCup) return;          // kupa maçı lig matches'e yazılmaz
    if (typeof WorldDB === 'undefined' || typeof WorldSim === 'undefined') return;
    const slot = gameState._slot; if (slot == null) return;
    const p = gameState.player;
    const myTeamId = p.teamId; if (!myTeamId || myTeamId === 'FREE') return;
    const home = myMatch.home, away = myMatch.away;
    const sh = myMatch.scoreHome, sa = myMatch.scoreAway;
    if (sh == null || sa == null) return;
    const isHome = (home === myTeamId);
    const oppTeamId = isHome ? away : home;
    const season = gameState.currentSeason;
    const weekIdx = gameState.currentWeek - 1;
    const lgId = (typeof activeLeagueId === 'function') ? activeLeagueId() : String(myTeamId).split('__')[0];

    // Oynayan diziliş id'leri + atıf havuzu ({id,position,ovr}). Canlı maçta matchLineups
    // GERÇEK kadrodur (kullanıcının gördüğü); instant-sim'de stale → squad'tan en iyi 11 seç.
    function _lineupFor(isUserTeam, teamId) {
        const luXI = isUserTeam ? matchLineups.myTeam : matchLineups.oppTeam;
        const luBench = isUserTeam ? matchLineups.myBench : matchLineups.oppBench;
        const luTeamId = ((isUserTeam ? activeMatch.myTeam : activeMatch.oppTeam) || {}).id;
        if (useLineups && luXI && luXI.length && luTeamId === teamId) {
            const cameOn = (luBench || []).filter(b => b.subbedIn);
            return {
                xi: luXI.map(x => x.pid).filter(Boolean),
                subs: cameOn.map(x => x.pid).filter(Boolean),
                pool: luXI.concat(cameOn).map(x => ({ id: x.pid, position: x.position, ovr: x.ovr || 65 }))
            };
        }
        const lu = WorldSim.pickLineup(DB.squadSync(teamId));
        return {
            xi: lu.xi.map(pl => pl.id), subs: lu.subs.map(pl => pl.id),
            pool: lu.onPitch.map(pl => ({ id: pl.id, position: pl.pos || pl.position, ovr: pl.ovr || 65 }))
        };
    }
    // Atıf havuzu: gerçek sayısal id öncelik (maç detayında isim çözülsün); yoksa USER hariç hepsi.
    function _realPool(pool) {
        const real = pool.filter(o => o.id && /^\d+$/.test(String(o.id)));
        return real.length ? real : pool.filter(o => o.id && o.id !== 'USER');
    }
    const myLU = _lineupFor(true, myTeamId), oppLU = _lineupFor(false, oppTeamId);
    const myPool = _realPool(myLU.pool), oppPool = _realPool(oppLU.pool);

    // Deterministik rng (reload'da aynı atıf). detScore/WorldSim ile aynı hash ailesinden.
    const salt = (gameState.careerSalt != null) ? gameState.careerSalt : 12345;
    const rng = WorldSim._rngFor(salt + '|USER|' + season + ':' + lgId + ':' + weekIdx + ':' + home + ':' + away);
    const M = () => 1 + Math.floor(rng() * 90);

    const myScore = isHome ? sh : sa, oppScore = isHome ? sa : sh;
    const ug = Math.max(0, Math.min(userGoals || 0, myScore));      // kullanıcının golleri (skoru aşamaz)
    const teammateGoals = Math.max(0, myScore - ug);
    let uAssists = Math.max(0, Math.min(userAssists || 0, teammateGoals));

    const events = [];
    for (let i = 0; i < ug; i++) events.push({ min: M(), type: 'goal', teamId: myTeamId, playerId: 'USER', assistId: null });
    for (let i = 0; i < teammateGoals; i++) {
        const scorer = myPool.length ? WorldSim.pickScorer(myPool, rng) : null;
        const ev = { min: M(), type: 'goal', teamId: myTeamId, playerId: scorer ? scorer.id : null, assistId: null };
        if (uAssists > 0) { ev.assistId = 'USER'; uAssists--; }      // kullanıcının asisti
        else if (scorer && rng() < 0.6) { const a = WorldSim.pickAssister(myPool, rng, scorer.id); if (a) ev.assistId = a.id; }
        events.push(ev);
    }
    for (let i = 0; i < oppScore; i++) {
        const scorer = oppPool.length ? WorldSim.pickScorer(oppPool, rng) : null;
        const ev = { min: M(), type: 'goal', teamId: oppTeamId, playerId: scorer ? scorer.id : null, assistId: null };
        if (scorer && rng() < 0.6) { const a = WorldSim.pickAssister(oppPool, rng, scorer.id); if (a) ev.assistId = a.id; }
        events.push(ev);
    }
    // Kullanıcının kartları maç detayında görünsün (USER stat'ta atlanır, çift sayma yok).
    if (activeMatch.playerStats && activeMatch.playerStats.yellow) events.push({ min: M(), type: 'yellow', teamId: myTeamId, playerId: 'USER' });
    if (activeMatch.playerStats && activeMatch.playerStats.red) events.push({ min: M(), type: 'red', teamId: myTeamId, playerId: 'USER' });
    events.sort((a, b) => a.min - b.min);

    const rec = {
        slot: slot, id: season + ':' + lgId + ':' + weekIdx + ':' + home + ':' + away,
        season: season, week: weekIdx, leagueId: lgId,
        home: home, away: away, sh: sh, sa: sa, events: events,
        homeXI: isHome ? myLU.xi : oppLU.xi, homeSubs: isHome ? myLU.subs : oppLU.subs,
        awayXI: isHome ? oppLU.xi : myLU.xi, awaySubs: isHome ? oppLU.subs : myLU.subs,
        userMatch: true
    };
    try { WorldDB.recordMatches([rec]).then(() => { if (window.WorldStats) WorldStats.invalidate(); }).catch(() => {}); }
    catch (e) { /* additive, sessiz */ }
}

function endMatch() {
    clearInterval(activeMatch.timerId);

    // Kupa maçı ise ayrı sonuçlandır (lig puan durumuna dokunma)
    if (activeMatch.isCup && typeof endEuroMatch === 'function') { endEuroMatch(); return; }

    addCommentary(90, "Hakem son düdüğü çalıyor! Maç sona erdi.", 'info');
    
    // Determine player outcome
    const p = gameState.player;

    // Oyuncunun bu maçta sahada geçirdiği süre (yedek girince birikir; ilk-11 ~90)
    const playedMins = Math.max(0, Math.round(activeMatch.actualPlayedMinutes || 0));
    // Hiç oyuna girmediyse: enerji/istatistik/ceza işlenmez (sadece takım sonucu)
    const neverPlayed = activeMatch.playerStatus === 'bench' && playedMins === 0;
    // Değerlendirme ağırlığı: 90 dk = tam değerlendirme. Kısa süre girene tam ceza/ödül verilmez.
    const playWeight = Math.max(0, Math.min(1, playedMins / 90));

    // Enerji: oynamadıysa hafif dinlenme; oynadıysa SÜREYLE ORANTILI tüketim
    // (88'de girip 2 dk oynayan tüm enerjisini kaybetmemeli).
    p.energy = neverPlayed
        ? Math.min(100, p.energy + 12)
        : Math.max(5, Math.round(p.energy - Math.max(6, 32 * playWeight)));

    const rating = activeMatch.playerStats.rating;
    const _goals = activeMatch.playerStats.goals, _assists = activeMatch.playerStats.assists;

    // Hoca güveni / taraftar sevgisi: reyting tabanı × oynama süresi.
    // Kısa cameo'da reyting kaynaklı etki ~0'a iner (son dakika girip kötü reyting alan
    // -5 yemez); somut katkı (gol/asist) ise süreden bağımsız küçük bir taban kazandırır.
    let trustGained = 0, fanGained = 0;
    if (!neverPlayed) {
        let baseTrust, baseFan;
        if (rating >= 8.0) { baseTrust = 8; baseFan = 10; p.form = Math.min(100, p.form + Math.round(6 * playWeight)); }
        else if (rating >= 7.0) { baseTrust = 4; baseFan = 5; p.form = Math.min(100, p.form + Math.round(2 * playWeight)); }
        else if (rating >= 6.0) { baseTrust = 1; baseFan = 1; }
        else { baseTrust = -5; baseFan = -3; p.form = Math.max(40, p.form - Math.round(5 * playWeight)); }
        trustGained = Math.round(baseTrust * playWeight);
        fanGained = Math.round(baseFan * playWeight);
        if (_goals > 0 || _assists > 0) {
            trustGained = Math.max(trustGained, _goals * 2 + _assists);
            fanGained = Math.max(fanGained, _goals * 3 + _assists * 2);
        }
    }
    
    // Update player stats (yalnız oynadıysa)
    if (!neverPlayed) {
        p.currentSeasonStats.matches++;
        if (activeMatch.startedXI) p.currentSeasonStats.starts = (p.currentSeasonStats.starts || 0) + 1;
        else p.currentSeasonStats.subApps = (p.currentSeasonStats.subApps || 0) + 1;   // yedekten girdi
        p.currentSeasonStats.goals += activeMatch.playerStats.goals;
        p.currentSeasonStats.assists += activeMatch.playerStats.assists;
        p.currentSeasonStats.saves += activeMatch.playerStats.saves;
        p.currentSeasonStats.ratings.push(rating);

        // Maçın adamı (yüksek reyting) + kaleci clean sheet
        if (rating >= 8.0) p.currentSeasonStats.motm = (p.currentSeasonStats.motm || 0) + 1;
        const oppScored = activeMatch.isHome ? activeMatch.scoreAway : activeMatch.scoreHome;
        if (p.position === 'Kaleci' && oppScored === 0) p.currentSeasonStats.cleanSheets = (p.currentSeasonStats.cleanSheets || 0) + 1;

        // Sarı kart birikimi (4 sarı = 1 maç ceza) + kırmızı kart cezası
        if (activeMatch.playerStats.yellow) {
            p.currentSeasonStats.yellowCards++;
            p.yellowAccum = (p.yellowAccum || 0) + 1;
            if (p.yellowAccum >= 4) {
                p.suspension = { matches: 1, reason: 'sarı kart birikimi' }; p.yellowAccum = 0;
                showToast('4. sarı kartını gördün! Bir sonraki lig maçında cezalı olacaksın.', 'warning');
            }
        }
        if (activeMatch.playerStats.red) {
            p.currentSeasonStats.redCards = (p.currentSeasonStats.redCards || 0) + 1;
            p.suspension = { matches: 1, reason: 'kırmızı kart' }; p.yellowAccum = 0;
            showToast('Kırmızı kart! Bir sonraki lig maçında cezalısın.', 'error');
        }

        p.managerTrust = Math.max(10, Math.min(100, p.managerTrust + trustGained));
        p.fansLove = Math.max(10, Math.min(100, p.fansLove + fanGained));

        const ratingPerf = rating - 6.5;
        p.value = Math.max(300000, Math.round(p.value + (ratingPerf * 50000) + (activeMatch.playerStats.goals * 75000)));
    } else {
        showToast('Bütün maç yedek kulübesinde geçti — hoca bugün sana şans vermedi.', 'info');
    }
    
    // Save match score to fixtures
    const weekIndex = gameState.currentWeek - 1;
    const matches = gameState.fixtures[weekIndex] || [];
    const myMatch = matches.find(m => m.home === p.teamId || m.away === p.teamId);
    
    if (myMatch) {
        myMatch.scoreHome = activeMatch.scoreHome;
        myMatch.scoreAway = activeMatch.scoreAway;
    }
    
    // Update standings for this match
    updateTeamStandingsRecord(myMatch.home, myMatch.away, myMatch.scoreHome, myMatch.scoreAway);
    
    // Simulate other matches in the league for this week
    simulateOtherWeekMatches(weekIndex);

    // Kullanicinin oynadigi maci kalici kaydet (mac gecmisi / detay) — oynadiysa
    if (myMatch && !neverPlayed && typeof recordRealMatch === 'function')
        recordRealMatch(myMatch, rating, activeMatch.playerStats.goals, activeMatch.playerStats.assists, rating >= 8.0);

    // FAZ 3d: maçı dünya IDB'sine de yaz (kulüp arkadaşları krallıkta gerçek görünür).
    // neverPlayed olsa bile yazılır (takım arkadaşları oynadı); kullanıcının gol/asisti 0 olur.
    try { _recordUserMatchToWorld(myMatch, _goals, _assists, true); } catch (e) { /* sessiz */ }

    // Maç "oynandı" işaretini kayıttan ÖNCE koy — yoksa "İncele"de kalıp sayfa
    // yenilenince maç oynanmamış görünüyordu (saveGame eski false değerini yazıyordu),
    // ve enerji düşmüş kaydedildiği için maça yeniden girince düşük kondisyon görülüyordu.
    gameState.matchesPlayedThisWeek = true;

    // Maç bittiğinde kaydet (A6: kullanıcı özeti kapatıp inceleyebilir, veri zaten kayıtlı)
    saveGame();
    
    // Display summary overlay
    const summaryBox = document.getElementById('match-summary-box');
    const summaryScore = document.getElementById('summary-final-score');
    const summaryPerf = document.getElementById('summary-player-performance');
    const summaryGains = document.getElementById('summary-gains');
    
    const teamHomeName = getTeamById(myMatch.home).name;
    const teamAwayName = getTeamById(myMatch.away).name;
    
    summaryScore.textContent = `${teamHomeName} ${myMatch.scoreHome} - ${myMatch.scoreAway} ${teamAwayName}`;
    
    let perfMsg;
    if (neverPlayed) {
        perfMsg = 'Bu maçta forma giyemedin — maçı yedek kulübesinde izledin. (Reyting/değerlendirme yok)';
    } else if (playedMins > 0 && playedMins < 20) {
        const ent = activeMatch.userEntryMinute;
        perfMsg = `${ent ? ent + ". dakikada" : "Maç sonlarında"} oyuna girdin, ${playedMins} dk forma giydin (${rating.toFixed(1)} reyting).`;
        if (_goals > 0 || _assists > 0) perfMsg += ` Kısa sürede ${_goals} gol, ${_assists} asist — etkili bir giriş!`;
    } else if (p.position === 'Kaleci') {
        perfMsg = `Maç boyu ${activeMatch.playerStats.saves} kurtarış yaptın ve ${rating.toFixed(1)} reyting aldın.`;
    } else if (_goals > 0 || _assists > 0) {
        perfMsg = `Maç boyu ${_goals} gol, ${_assists} asist ile ${rating.toFixed(1)} reyting aldın. Harika performans!`;
    } else {
        perfMsg = `Maçı ${rating.toFixed(1)} reyting ile tamamladın.`;
    }
    summaryPerf.textContent = perfMsg;

    if (neverPlayed) {
        summaryGains.innerHTML = `<span class="text-muted"><i class="fa-solid fa-minus"></i> Bu maç değerlendirilmedi (forma giymedin)</span>`;
    } else {
        summaryGains.innerHTML = `
            <span class="${trustGained >= 0 ? 'text-success' : 'text-danger'}">
                <i class="fa-solid ${trustGained >= 0 ? 'fa-plus' : 'fa-minus'}"></i> ${Math.abs(trustGained)} Hoca Güveni
            </span>
            <span class="${fanGained >= 0 ? 'text-success' : 'text-danger'}">
                <i class="fa-solid ${fanGained >= 0 ? 'fa-plus' : 'fa-minus'}"></i> ${Math.abs(fanGained)} Taraftar Sevgisi
            </span>
        `;
    }
    
    summaryBox.style.display = 'flex';
}

// Panele dönüş (hem "Panele Dön" hem inceleme sonrası kullanılır)
function _returnToPanel() {
    document.getElementById('matchday-screen').classList.remove('active');
    document.getElementById('game-interface').classList.add('active');
    document.getElementById('match-summary-box').style.display = 'none';
    const appContainer = document.querySelector('.app-container');
    if (appContainer) appContainer.classList.remove('matchday-active');

    // Sezon ortası / sonu transfer teklifleri: nav rozeti + sağ-üst toast bildirimi
    if (gameState.currentWeek === 18 || gameState.currentWeek === 36) {
        const _b = (gameState.transferOffers || []).length;
        generateTransferOffers();
        const _n = (gameState.transferOffers || []).length - _b;
        if (_n > 0) showToast(`${_n} yeni transfer teklifi geldi! Transfer & Sözleşme sekmesine bak.`, 'success');
    }
    saveGame();
    updateUI();
}
document.getElementById('btn-finish-match-overlay').addEventListener('click', _returnToPanel);

// A6: "İncele" — özeti kapat, maç ekranında kal (canlı anlatım/olaylar/istatistik incelenebilir)
(function () {
    const closeBtn = document.getElementById('btn-close-summary');
    if (closeBtn) closeBtn.addEventListener('click', () => {
        document.getElementById('match-summary-box').style.display = 'none';
        const badge = document.getElementById('match-status-badge');
        if (badge) badge.innerHTML = `<i class="fa-solid fa-flag-checkered"></i> Maç Bitti — İnceliyorsun`;
        // Maç bitti: simüle/duraklat/çık + hız/efor panellerini gizle (artık anlamsız)
        const sub = document.getElementById('btn-match-sub-out'); if (sub) sub.style.display = 'none';
        if (typeof _setMatchControlsActive === 'function') _setMatchControlsActive(false);
        let back = document.getElementById('btn-review-back');
        if (!back) {
            const panel = document.querySelector('.match-action-buttons');
            if (panel) {
                back = document.createElement('button');
                back.id = 'btn-review-back';
                back.className = 'btn-match-action';
                back.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Panele Dön`;
                back.addEventListener('click', _returnToPanel);
                panel.appendChild(back);
            }
        }
        if (back) back.style.display = 'inline-flex';
    });
})();

// ================= YENİ ÖZELLİKLER (TAKTIK, TRANSFER, SÖZLEŞME VE MODALLER) =================

const PITCH_COORDINATES = {
    "4-2-3-1": [
        { label: 'KL', x: 50, y: 90 },
        { label: 'BEK', x: 15, y: 72 },
        { label: 'STP', x: 38, y: 78 },
        { label: 'STP', x: 62, y: 78 },
        { label: 'BEK', x: 85, y: 72 },
        { label: 'DOS', x: 35, y: 58 },
        { label: 'Merkez OS', x: 65, y: 58 },
        { label: 'Ofansif OS', x: 50, y: 38 },
        { label: 'Kanat', x: 20, y: 35 },
        { label: 'Kanat', x: 80, y: 35 },
        { label: 'Santrfor', x: 50, y: 15 }
    ],
    "4-3-3": [
        { label: 'KL', x: 50, y: 90 },
        { label: 'BEK', x: 15, y: 72 },
        { label: 'STP', x: 38, y: 78 },
        { label: 'STP', x: 62, y: 78 },
        { label: 'BEK', x: 85, y: 72 },
        { label: 'DOS', x: 50, y: 60 },
        { label: 'Merkez OS', x: 32, y: 48 },
        { label: 'Ofansif OS', x: 68, y: 48 },
        { label: 'Kanat', x: 20, y: 25 },
        { label: 'Kanat', x: 80, y: 25 },
        { label: 'Santrfor', x: 50, y: 15 }
    ],
    "4-4-2": [
        { label: 'KL', x: 50, y: 90 },
        { label: 'BEK', x: 15, y: 72 },
        { label: 'STP', x: 38, y: 78 },
        { label: 'STP', x: 62, y: 78 },
        { label: 'BEK', x: 85, y: 72 },
        { label: 'DOS', x: 32, y: 55 },
        { label: 'Merkez OS', x: 68, y: 55 },
        { label: 'Ofansif OS', x: 18, y: 42 },
        { label: 'Kanat', x: 82, y: 42 },
        { label: 'Kanat', x: 38, y: 18 },
        { label: 'Santrfor', x: 62, y: 18 }
    ],
    "3-5-2": [
        { label: 'KL', x: 50, y: 90 },
        { label: 'BEK', x: 50, y: 78 },
        { label: 'STP', x: 25, y: 78 },
        { label: 'STP', x: 75, y: 78 },
        { label: 'BEK', x: 12, y: 52 },
        { label: 'DOS', x: 35, y: 56 },
        { label: 'Merkez OS', x: 65, y: 56 },
        { label: 'Ofansif OS', x: 50, y: 38 },
        { label: 'Kanat', x: 88, y: 52 },
        { label: 'Kanat', x: 35, y: 18 },
        { label: 'Santrfor', x: 65, y: 18 }
    ]
};

function renderMatchLineupPitch() {
    const pitch = document.getElementById('match-lineup-pitch');
    if (!pitch) return;
    
    pitch.innerHTML = `
        <div class="pitch-midline"></div>
        <div class="pitch-penalty-area-top"></div>
        <div class="pitch-penalty-area-bottom"></div>
    `;
    
    const activeSquad = matchLineups.currentTab === 'myteam' ? matchLineups.myTeam : matchLineups.oppTeam;
    const formation = matchLineups.currentTab === 'myteam' ? matchLineups.myFormation : matchLineups.oppFormation;
    
    const coords = PITCH_COORDINATES[formation] || PITCH_COORDINATES["4-2-3-1"];
    
    (activeSquad || []).forEach((player, idx) => {
        if (!player) return;
        const coord = coords[idx] || { x: 50, y: 50 };
        const node = document.createElement('div');
        node.className = 'pitch-player-node';
        node.style.left = `${coord.x}%`;
        node.style.top = `${coord.y}%`;

        // label eksik olabilir (ör. oyuna sonradan giren yedek) → güvenli fallback,
        // aksi halde toLowerCase() çağrısı saha görünümü render'ını çökertiyordu.
        const label = player.label || (POS_BY_KEY[player.pos] || {}).short || '?';
        const markerClass = player.isUser ? 'player-node-user' : label.toLowerCase();

        node.innerHTML = `
            <div class="pitch-player-marker ${markerClass}">${label}</div>
            <div class="pitch-player-name">${player.name || ''}</div>
        `;
        pitch.appendChild(node);
    });
}

function simulateMatchInstantly() {
    const weekIndex = gameState.currentWeek - 1;
    const matches = gameState.fixtures[weekIndex] || [];
    const playerTeam = gameState.player.teamId;
    const myMatch = matches.find(m => m.home === playerTeam || m.away === playerTeam);
    
    if (!myMatch || myMatch.isBay || gameState.matchesPlayedThisWeek) return;
    
    const isHome = myMatch.home === playerTeam;
    const opponentId = isHome ? myMatch.away : myMatch.home;
    
    activeMatch.myTeam = getTeamById(playerTeam);
    activeMatch.oppTeam = getTeamById(opponentId);
    activeMatch.isHome = isHome;
    activeMatch.scoreHome = 0;
    activeMatch.scoreAway = 0;
    activeMatch.minute = 90;
    activeMatch.playerStats = {
        goals: 0,
        assists: 0,
        saves: 0,
        rating: 6.0,
        shots: 0,
        passes: 0,
        tackles: 0,
        yellow: false,
        red: false
    };
    
    // Canlı maçla TUTARLI statü kararı (rotasyon/yedek/kadro-dışı) + rotasyon sayaçları
    const _ud = (typeof decideUserMatchStatus === 'function')
        ? decideUserMatchStatus(playerTeam, activeMatch.oppTeam.power, false)
        : { status: gameState.player.managerTrust < 30 ? 'excluded' : (gameState.player.managerTrust < 50 ? 'bench' : 'starting') };
    activeMatch.playerStatus = _ud.status;
    activeMatch.startedXI = (_ud.status === 'starting');
    activeMatch.userEntryMinute = _ud.entryMinute || null;
    if (_ud.status === 'starting') gameState.player.seasonStarts = (gameState.player.seasonStarts || 0) + 1;
    else gameState.player.seasonBenched = (gameState.player.seasonBenched || 0) + 1;
    if (_ud.status === 'excluded') showToast("Hoca seni bu maçın kadrosuna almadı. Maçı tribünden takip ettin.", "error");

    const diff = activeMatch.myTeam.power - activeMatch.oppTeam.power;
    const myTeamChance = 0.5 + (diff / 100);
    
    let myScore = 0;
    let oppScore = 0;
    
    const totalChances = Math.floor(Math.random() * 3) + 3;
    for (let c = 0; c < totalChances; c++) {
        if (Math.random() < myTeamChance) {
            if (Math.random() < (activeMatch.myTeam.power / 180)) myScore++;
        } else {
            if (Math.random() < (activeMatch.oppTeam.power / 180)) oppScore++;
        }
    }
    
    activeMatch.scoreHome = isHome ? myScore : oppScore;
    activeMatch.scoreAway = isHome ? oppScore : myScore;
    
    let playerRating = 6.0;
    let goals = 0;
    let assists = 0;
    let saves = 0;
    
    if (activeMatch.playerStatus !== 'excluded') {
        const isBench = activeMatch.playerStatus === 'bench';
        const playTimeRatio = isBench ? 0.3 : 1.0;
        
        playerRating = parseFloat((6.0 + (Math.random() * 3.2 - 1.2) * playTimeRatio).toFixed(1));
        
        const formMult = gameState.player.form / 100;
        const ovrMult = gameState.player.ovr / 75;
        
        if (gameState.player.position === 'Kaleci') {
            if (oppScore > 0) {
                saves = Math.floor(Math.random() * 4) + 1;
            }
            playerRating = Math.max(4.0, Math.min(10.0, playerRating + saves * 0.4 - oppScore * 0.3));
        } else {
            // KRİTİK: oyuncunun gol/asisti takımın ATTIĞI gollerin (myScore) bir ALT KÜMESİDİR.
            // Eskiden bağımsız hesaplanıyordu → oyuncu 2 atarken takım skoru 1 kalabiliyordu (mantık hatası).
            // Artık her takım golü için "bu golü oyuncu mu attı / asist mi yaptı" diye dönülür → gol ≤ takım skoru garanti.
            const _fam = (typeof posFamily === 'function') ? posFamily(gameState.player.position) : '';
            const goalShare = _fam === 'ST' ? 0.52 : _fam === 'W' ? 0.42
                : (_fam === 'AM' || _fam === 'CM') ? 0.20 : _fam === 'WM' ? 0.25 : 0.08;
            const assistShare = _fam === 'AM' ? 0.42 : (_fam === 'WM' || _fam === 'W') ? 0.38
                : _fam === 'CM' ? 0.30 : _fam === 'FB' ? 0.25 : _fam === 'ST' ? 0.18 : 0.12;
            const involve = Math.min(1.15, (isBench ? 0.35 : 1.0) * formMult * ovrMult);
            for (let k = 0; k < myScore; k++) {
                if (Math.random() < goalShare * involve) goals++;
                else if (Math.random() < assistShare * involve) assists++;
            }
            playerRating = Math.max(4.0, Math.min(10.0, playerRating + goals * 1.2 + assists * 0.8));
        }
    }
    
    activeMatch.playerStats.rating = playerRating;
    activeMatch.playerStats.goals = goals;
    activeMatch.playerStats.assists = assists;
    activeMatch.playerStats.saves = saves;
    
    const energyCost = activeMatch.playerStatus === 'excluded' ? -12 : (activeMatch.playerStatus === 'bench' ? 12 : 30);
    gameState.player.energy = Math.max(5, gameState.player.energy - energyCost);
    
    let trustGained = 1;
    let fanGained = 1;
    
    if (activeMatch.playerStatus !== 'excluded') {
        if (playerRating >= 8.0) {
            trustGained = 6;
            fanGained = 8;
            gameState.player.form = Math.min(100, gameState.player.form + 5);
        } else if (playerRating >= 7.0) {
            trustGained = 3;
            fanGained = 4;
            gameState.player.form = Math.min(100, gameState.player.form + 2);
        } else if (playerRating >= 6.0) {
            trustGained = 1;
            fanGained = 1;
        } else {
            trustGained = -4;
            fanGained = -2;
            gameState.player.form = Math.max(40, gameState.player.form - 4);
        }
    }
    
    if (activeMatch.playerStatus !== 'excluded') {
        const css = gameState.player.currentSeasonStats;
        css.matches++;
        if (activeMatch.startedXI) css.starts = (css.starts || 0) + 1;
        else css.subApps = (css.subApps || 0) + 1;
        css.goals += goals;
        css.assists += assists;
        css.saves += saves;
        css.ratings.push(playerRating);
        // Canli mac (endMatch) ile tutarli: MotM / clean sheet / sari kart
        if (playerRating >= 8.0) css.motm = (css.motm || 0) + 1;
        const _oppScored = activeMatch.isHome ? activeMatch.scoreAway : activeMatch.scoreHome;
        if (gameState.player.position === 'Kaleci' && _oppScored === 0) css.cleanSheets = (css.cleanSheets || 0) + 1;
        if (activeMatch.playerStats && activeMatch.playerStats.yellow) css.yellowCards++;
    }
    
    gameState.player.managerTrust = Math.max(10, Math.min(100, gameState.player.managerTrust + trustGained));
    gameState.player.fansLove = Math.max(10, Math.min(100, gameState.player.fansLove + fanGained));
    
    const ratingPerf = playerRating - 6.5;
    gameState.player.value = Math.max(300000, Math.round(gameState.player.value + (ratingPerf * 45000) + (goals * 60000)));
    
    myMatch.scoreHome = activeMatch.scoreHome;
    myMatch.scoreAway = activeMatch.scoreAway;
    
    updateTeamStandingsRecord(myMatch.home, myMatch.away, myMatch.scoreHome, myMatch.scoreAway);
    simulateOtherWeekMatches(weekIndex);

    if (myMatch && activeMatch.playerStatus !== 'excluded' && typeof recordRealMatch === 'function')
        recordRealMatch(myMatch, playerRating, goals, assists, playerRating >= 8.0);

    // FAZ 3d: instant-sim maçı da dünya IDB'sine yaz (kulüp arkadaşları krallıkta gerçek görünür).
    // useLineups=false → matchLineups kurulmadı, squad'tan en iyi 11 seçilir.
    try { _recordUserMatchToWorld(myMatch, goals, assists, false); } catch (e) { /* sessiz */ }

    gameState.matchesPlayedThisWeek = true;
    saveGame();

    const summaryBox = document.getElementById('match-summary-box');
    const summaryScore = document.getElementById('summary-final-score');
    const summaryPerf = document.getElementById('summary-player-performance');
    const summaryGains = document.getElementById('summary-gains');
    
    const teamHomeName = getTeamById(myMatch.home).name;
    const teamAwayName = getTeamById(myMatch.away).name;
    
    summaryScore.textContent = `${teamHomeName} ${myMatch.scoreHome} - ${myMatch.scoreAway} ${teamAwayName}`;
    
    let perfMsg = `Maç oynamadan simüle edildi.`;
    if (activeMatch.playerStatus === 'excluded') {
        perfMsg = "Bu maç kadro dışı kaldığın için oynamadın.";
    } else {
        perfMsg = `Maçı ${playerRating.toFixed(1)} reyting ile tamamladın.`;
        if (goals > 0 || assists > 0) {
            perfMsg = `Maçta ${goals} gol, ${assists} asist üreterek ${playerRating.toFixed(1)} reyting aldın.`;
        } else if (gameState.player.position === 'Kaleci') {
            perfMsg = `Maç boyu ${saves} kurtarış yaptın ve ${playerRating.toFixed(1)} reyting aldın.`;
        }
    }
    summaryPerf.textContent = perfMsg;
    
    summaryGains.innerHTML = `
        <span class="${trustGained >= 0 ? 'text-success' : 'text-danger'}">
            <i class="fa-solid ${trustGained >= 0 ? 'fa-plus' : 'fa-minus'}"></i> ${Math.abs(trustGained)} Hoca Güveni
        </span>
        <span class="${fanGained >= 0 ? 'text-success' : 'text-danger'}">
            <i class="fa-solid ${fanGained >= 0 ? 'fa-plus' : 'fa-minus'}"></i> ${Math.abs(fanGained)} Taraftar Sevgisi
        </span>
    `;
    
    summaryBox.style.display = 'flex';
}

