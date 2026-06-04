// ============================================================================
//  92-creation.js  —  Karakter olusturma: baslangic stat onizlemesi
//  (updateCreationStatsPreview) + olusturma formu submit (oyuncu yaratimi).
//  Ekran/dropdown kurulumu 90-main'de (setupCreationScreen).
//  (05-core'dan ayristirildi.)
// ============================================================================
// ================= INITIALIZE CHARACTER CREATION =================

function updateCreationStatsPreview() {
    const checkedRadio = document.querySelector('input[name="position"]:checked');
    if (!checkedRadio) return;
    const pos = checkedRadio.value;
    
    const heightInput = document.getElementById('player-height');
    const weightInput = document.getElementById('player-weight');
    
    const height = heightInput ? parseInt(heightInput.value) : 180;
    const weight = weightInput ? parseInt(weightInput.value) : 75;
    
    const previewContainer = document.getElementById('starting-stats-list');
    if (!previewContainer) return;
    
    let baseRanges = getStartingStatsRange(pos);
    let modifiers = getStatModifierFromHeightWeight(height, weight, pos);
    
    // Uygulanmış hali
    function applyModifier(rangeStr, mod) {
        const [min, max] = rangeStr.split('-').map(Number);
        const newMin = Math.min(99, Math.max(10, min + mod));
        const newMax = Math.min(99, Math.max(10, max + mod));
        return `${newMin}-${newMax}`;
    }
    
    let stats = {
        hiz: applyModifier(baseRanges.hiz, modifiers.hiz),
        sut: baseRanges.sut,
        pas: baseRanges.pas,
        defans: baseRanges.defans,
        fizik: applyModifier(baseRanges.fizik, modifiers.fizik),
        teknik: applyModifier(baseRanges.teknik, pos === 'Kaleci' ? modifiers.teknik : 0)
    };
    
    previewContainer.innerHTML = `
        <div class="stat-item-mini">
            <span class="s-label">Hız</span>
            <div class="s-val-row">
                <span class="stat-dot" style="background-color: var(--accent);"></span>
                <span class="s-val">${stats.hiz}</span>
            </div>
        </div>
        <div class="stat-item-mini">
            <span class="s-label">Şut</span>
            <div class="s-val-row">
                <span class="stat-dot" style="background-color: var(--danger);"></span>
                <span class="s-val">${stats.sut}</span>
            </div>
        </div>
        <div class="stat-item-mini">
            <span class="s-label">Pas</span>
            <div class="s-val-row">
                <span class="stat-dot" style="background-color: var(--info);"></span>
                <span class="s-val">${stats.pas}</span>
            </div>
        </div>
        <div class="stat-item-mini">
            <span class="s-label">Savunma</span>
            <div class="s-val-row">
                <span class="stat-dot" style="background-color: var(--df-color);"></span>
                <span class="s-val">${stats.defans}</span>
            </div>
        </div>
        <div class="stat-item-mini">
            <span class="s-label">Fizik</span>
            <div class="s-val-row">
                <span class="stat-dot" style="background-color: var(--text-muted);"></span>
                <span class="s-val">${stats.fizik}</span>
            </div>
        </div>
        <div class="stat-item-mini">
            <span class="s-label">${pos === 'Kaleci' ? 'Kalecilik' : 'Teknik'}</span>
            <div class="s-val-row">
                <span class="stat-dot" style="background-color: var(--gk-color);"></span>
                <span class="s-val">${stats.teknik}</span>
            </div>
        </div>
    `;
}

// Handle Form Submit (Creation)
document.getElementById('creation-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const firstname = document.getElementById('player-firstname').value.trim();
    const lastname = document.getElementById('player-lastname').value.trim();
    const position = document.querySelector('input[name="position"]:checked').value;
    const isFreeAgent = !!(document.getElementById('start-free-agent') && document.getElementById('start-free-agent').checked);
    const teamId = isFreeAgent ? null : document.getElementById('player-team').value;
    const avatarImg = (document.getElementById('player-img') && document.getElementById('player-img').value) || '';

    // Yeni alanlar
    const nationality = document.getElementById('player-nationality').value;
    const number = parseInt(document.getElementById('player-number').value) || 10;
    let birthdate = document.getElementById('player-birthdate').value;
    if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) birthdate = `${new Date().getFullYear() - 18}-02-25`;   // güvenli varsayılan
    const height = parseInt(document.getElementById('player-height').value) || 180;
    const weight = parseInt(document.getElementById('player-weight').value) || 75;

    if (!isFreeAgent && !teamId) { showToast('Lütfen bir lig ve takım seç (veya kulüpsüz başla)!', 'error'); return; }

    // Alt-ozellik tabanli baslangic statlari (12 mevki)
    const attrs = rollStartingAttrs(position, height, weight);
    const startingTeam = getTeamById(teamId);

    // Yas (dogum tarihinden)
    const birthDateObj = new Date(birthdate);
    const today = new Date();
    let calculatedAge = today.getFullYear() - birthDateObj.getFullYear();
    const mMonth = today.getMonth() - birthDateObj.getMonth();
    if (mMonth < 0 || (mMonth === 0 && today.getDate() < birthDateObj.getDate())) calculatedAge--;
    calculatedAge = Math.max(15, Math.min(40, calculatedAge));

    const player = {
        firstname, lastname, position, teamId,
        teamName: startingTeam.name, nationality, number, birthdate,
        height, weight, age: calculatedAge,
        contractDuration: 3,
        listingStatus: 'normal', listingRequested: 'none',
        lastContractRenewalWeek: 1, negotiationBlockUntil: 0,
        joinedClubWeek: 0, weeksAtCurrentClub: 0, lastTeamId: null, leftClubAtWeek: 0,
        energy: 100, form: 70, managerTrust: 50, fansLove: 40,
        injury: null, youthProspects: [], img: avatarImg,
        attrs,
        yellowAccum: 0, suspension: null, seasonHistory: [],
        careerStats: { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, saves: 0, yellowCards: 0, redCards: 0, cleanSheets: 0, motm: 0, ratings: [], cup: { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, motm: 0 } },
        currentSeasonStats: { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, saves: 0, yellowCards: 0, redCards: 0, cleanSheets: 0, motm: 0, ratings: [], cup: { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, motm: 0 } }
    };
    if (isFreeAgent) { player.teamName = 'Serbest Oyuncu'; }
    recomputeMainStats(player);
    player.ovr = calculateOVR(player);
    Object.assign(player, rollCareerTraits(player.ovr));
    player.wage = isFreeAgent ? 0 : calcWage(player.ovr, startingTeam.prestige);
    player.contractDuration = isFreeAgent ? 0 : 3;
    player.value = calcMarketValue(player.ovr, player.age, startingTeam.prestige || 2);
    gameState.player = player;

    gameState.currentSeason = START_SEASON;
    gameState.currentWeek = 1;
    gameState._lastSimWeek = -1;
    gameState.matchesPlayedThisWeek = false;
    gameState.hasDoneActionThisWeek = false;
    gameState.actionsDoneThisWeek = 0;
    gameState.careerHistory = [];
    gameState.trophies = [];
    gameState.transferOffers = [];
    gameState.freeAgents = [];
    gameState.transferNews = [];
    gameState.clubSpend = {};
    gameState.genFillers = {};
    // Altyapi: kulubun genc yetenekleri (gercek kadro uyesi; squadSync dondurur, her sezon gelisir/oynar)
    gameState.clubYouth = {};
    try { if (!isFreeAgent && startingTeam && startingTeam.id) gameState.clubYouth[startingTeam.id] = generateYouthProspects(startingTeam, START_SEASON); } catch (e) {}
    gameState._lastMarketKey = null;
    gameState.worldTransferLog = [];
    // Kariyer tohumu: deterministik dunya skorlari her kariyerde farkli, ama o kariyer icinde tutarli
    gameState.careerSalt = (Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    // Takvim: sezon basi gun 0, gercek tarih (15 Agustos)
    gameState.gameDate = 0;
    gameState.seasonStartDate = START_SEASON + '-08-08';
    gameState.viewStandingsLeague = startingTeam.leagueId || 'tur-super-lig';

    // Mac & transfer gecmisi (kalici, kompakt)
    player.matchLog = [];
    player.transferHistory = [];
    // Gelisim takibi: kariyer baslangic anlik goruntusu
    player.trainingHistory = [];
    if (typeof recordDevSnapshot === 'function') recordDevSnapshot(player, 'başlangıç', 'Kariyer başlangıcı');

    // Kayıt slotu ata
    gameState._slot = (gameState._pendingSlot !== undefined && gameState._pendingSlot !== null)
        ? gameState._pendingSlot
        : (typeof firstEmptySlot === 'function' ? (firstEmptySlot() !== null ? firstEmptySlot() : 0) : 0);
    gameState._pendingSlot = null;

    initAllStandings();
    setActiveLeagueFixtures();
    gameState._fxLeague = activeLeagueId();
    if (activeLeagueId()) DB.loadPlayers(activeLeagueId());

    saveGame();
    showToast(`Kariyer başarıyla başladı! Hoş geldin, ${firstname} ${lastname}!`, 'success');

    // Panele geç
    if (typeof showScreen === 'function') showScreen('game-interface');
    else { document.getElementById('creation-screen').classList.remove('active'); document.getElementById('game-interface').classList.add('active'); }

    updateUI();

    // FAZ 0: Kalıcı dünya veritabanını (tüm 45 lig oyuncu/takım-sezon) arka planda
    // tohumla. Engellemez — kullanıcı hemen oynar; okuyucular henüz bu DB'yi
    // kullanmaz (sonraki fazlar bağlar). IndexedDB yoksa sessizce geçilir.
    try {
        if (window.WorldDB && typeof WorldDB.seedCareer === 'function' && gameState._slot != null) {
            const _seedSlot = gameState._slot;
            if (typeof showToast === 'function') showToast('Dünya veritabanı hazırlanıyor (arka planda)…', 'info');
            WorldDB.seedCareer(_seedSlot, {
                onProgress: (done, total) => {
                    if (done === total && typeof showToast === 'function')
                        showToast(`Dünya veritabanı hazır (${total} lig).`, 'success');
                }
            }).catch(() => {/* IDB yoksa/başarısızsa oyun yine de çalışır */});
        }
    } catch (e) {/* sessiz */}
});

// ============================================================================
//  Asagidakiler 90-main.js'ten tasindi (2026-05-31 modulerlestirme): olusturma
//  ekrani kurulumu — saha-uzeri pozisyon secici, lig/takim dropdown'lari.
// ============================================================================
// ---- Karakter olusturma: 12 pozisyon + lig/takim dropdown'lari ----
const _POS_FAM_CLASS = { GK: 'gk', CB: 'df', FB: 'df', DM: 'mf', CM: 'mf', AM: 'mf', WM: 'mf', W: 'fw', ST: 'fw' };
// Saha koordinatlari (yuzde): x 0=sol..100=sag | y 0=ust(hucum)..100=alt(kendi kale)
const _POS_COORDS = {
    'Kaleci': { x: 50, y: 92 }, 'Stoper': { x: 50, y: 77 },
    'Sağ Bek': { x: 84, y: 73 }, 'Sol Bek': { x: 16, y: 73 },
    'DOS': { x: 50, y: 61 }, 'Merkez OS': { x: 50, y: 49 }, 'Ofansif OS': { x: 50, y: 33 },
    'Sağ Açık': { x: 80, y: 41 }, 'Sol Açık': { x: 20, y: 41 },
    'Sağ Kanat': { x: 85, y: 22 }, 'Sol Kanat': { x: 15, y: 22 }, 'Santrfor': { x: 50, y: 13 },
};
function _renderPositionRadios() {
    const host = document.getElementById('position-selector');
    if (!host || host.children.length) return;
    host.classList.add('pitch-selector');
    host.innerHTML = `<div class="pitch-bg" aria-hidden="true"></div>` + POSITIONS.map((pp, i) => {
        const c = _POS_COORDS[pp.key] || { x: 50, y: 50 };
        const fam = _POS_FAM_CLASS[pp.fam] || 'mf';
        return `
        <label class="pitch-pos ${fam}" style="left:${c.x}%; top:${c.y}%;" title="${pp.key} (${pp.ea})">
            <input type="radio" name="position" value="${pp.key}" ${i === 0 ? 'checked' : ''}>
            <span class="pitch-dot">${pp.short}</span>
            <span class="pitch-label">${pp.key}</span>
        </label>`;
    }).join('');
}

function _populateTeamDropdown(leagueId) {
    const el = document.getElementById('dropdown-team');
    if (!el || typeof setupDropdown !== 'function') return;
    const teams = DB.teamsInLeague(leagueId).slice().sort((a, b) => b.power - a.power);
    const _logo = (typeof getTeamLogoHtml === 'function') ? (id => `${getTeamLogoHtml(id, 20)} `) : (() => '');
    const opts = teams.map(t => ({ id: t.id, label: `<span style="display:inline-flex;align-items:center;gap:8px;">${_logo(t.id)}<span>${t.name} (Güç: ${t.power})</span></span>` }));
    const def = opts.length ? opts[0].id : '';
    // setupDropdown'a devret (lig/ülke dropdown'larıyla AYNI bileşen): açılışta listeyi
    // yeniden çizip doğru seçiliyi işaretler → "tekrar açınca en güçlü seçili görünüyor" bug'ı biter.
    setupDropdown(el, opts, def);
    const hidden = el.querySelector('input[type="hidden"]');
    if (hidden) { hidden.value = def; hidden.dispatchEvent(new Event('change', { bubbles: true })); }   // stat önizlemesini tetikle
}

function initCustomDropdowns() {
    const natDropdown = document.getElementById('dropdown-nationality');
    if (natDropdown && typeof NATIONALITIES !== 'undefined') {
        setupDropdown(natDropdown, NATIONALITIES.map(n => ({ id: n.name, label: `${flagImg(n.flag)} ${n.name}` })), 'Türkiye');
    }
    const leagueDropdown = document.getElementById('dropdown-league');
    if (leagueDropdown) {
        // Ligleri içlerindeki takımların ortalama gücüne göre sırala (güçlü ligler başta).
        // Alt ligler kendi güçlerine göre doğal olarak aşağıda kalır; dağınıklık biter.
        const _avgPow = l => {
            if (l.avgPower != null) return l.avgPower;
            const ts = DB.teamsInLeague(l.id);
            return ts.length ? ts.reduce((s, t) => s + (t.power || 0), 0) / ts.length : 0;
        };
        const leagues = DB.leagues().filter(l => l.startable)
            .slice().sort((a, b) => _avgPow(b) - _avgPow(a));
        const def = leagues.find(l => l.id === 'tur-super-lig') ? 'tur-super-lig' : (leagues[0] && leagues[0].id);
        setupDropdown(leagueDropdown, leagues.map(l => ({ id: l.id, label: `${flagImg(l.flag)} ${l.name} — ${l.country}` })), def);
        const hidden = document.getElementById('player-league');
        hidden.addEventListener('change', () => _populateTeamDropdown(hidden.value));
        _populateTeamDropdown(def);
    }
}

// Modern doğum tarihi seçici: native takvim yerine Gün/Ay/Yıl üçlü dropdown
// (FIFA/FM tarzı). #player-birthdate gizli input'u YYYY-MM-DD olarak beslenir;
// böylece form gönderimi (92-creation submit) ve profil gösterimi (60-ui) aynen çalışır.
function _setupBirthdateDropdowns() {
    const dayDd = document.getElementById('dropdown-bd-day');
    const monDd = document.getElementById('dropdown-bd-month');
    const yrDd = document.getElementById('dropdown-bd-year');
    const hidden = document.getElementById('player-birthdate');
    if (!dayDd || !monDd || !yrDd || !hidden || typeof setupDropdown !== 'function') return;

    const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    const nowY = new Date().getFullYear();
    const daysIn = (m, y) => new Date(y, m, 0).getDate();   // m: 1-12
    const monthOpts = MONTHS.map((m, i) => ({ id: String(i + 1), label: m }));
    const yearOpts = []; for (let y = nowY - 15; y >= nowY - 40; y--) yearOpts.push({ id: String(y), label: String(y) });
    const dayOpts = (m, y) => Array.from({ length: daysIn(m, y) }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }));

    // varsayılan: mevcut değer (yeniden açılışta) yoksa ~18 yaş, 25 Şubat
    let dY = nowY - 18, dM = 2, dD = 25;
    if (hidden.value && /^\d{4}-\d{2}-\d{2}$/.test(hidden.value)) {
        const parts = hidden.value.split('-').map(Number); dY = parts[0]; dM = parts[1]; dD = parts[2];
    }
    dD = Math.min(dD, daysIn(dM, dY));

    setupDropdown(yrDd, yearOpts, String(dY));
    setupDropdown(monDd, monthOpts, String(dM));
    setupDropdown(dayDd, dayOpts(dM, dY), String(dD));

    const dayHidden = document.getElementById('player-bd-day');
    const monHidden = document.getElementById('player-bd-month');
    const yrHidden = document.getElementById('player-bd-year');

    function compose() {
        const y = parseInt(yrHidden.value) || (nowY - 18);
        const m = parseInt(monHidden.value) || 1;
        let d = parseInt(dayHidden.value) || 1;
        d = Math.min(d, daysIn(m, y));   // 31 Şubat gibi geçersiz tarihleri engelle
        hidden.value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        hidden.dispatchEvent(new Event('change', { bubbles: true }));   // stat önizlemesini güncelle
    }
    function refreshDays() {
        const y = parseInt(yrHidden.value) || (nowY - 18);
        const m = parseInt(monHidden.value) || 1;
        const d = Math.min(parseInt(dayHidden.value) || 1, daysIn(m, y));
        setupDropdown(dayDd, dayOpts(m, y), String(d));   // ay/yıl değişince gün listesini güncelle
        compose();
    }
    // Listener'ları yalnız bir kez bağla (setupCreationScreen tekrar çağrılabilir)
    if (!dayHidden._bdBound) { dayHidden._bdBound = true; dayHidden.addEventListener('change', compose); }
    if (!monHidden._bdBound) { monHidden._bdBound = true; monHidden.addEventListener('change', refreshDays); }
    if (!yrHidden._bdBound) { yrHidden._bdBound = true; yrHidden.addEventListener('change', refreshDays); }
    compose();   // ilk birthdate değerini yaz
}

function setupCreationScreen() {
    _renderPositionRadios();
    initCustomDropdowns();
    _setupBirthdateDropdowns();
    updateCreationStatsPreview();
    document.querySelectorAll('input[name="position"]').forEach(r => r.addEventListener('change', updateCreationStatsPreview));
    const hookPreview = id => { const el = document.getElementById(id); if (el) el.addEventListener('change', updateCreationStatsPreview); };
    hookPreview('player-nationality'); hookPreview('player-team');
    const hs = document.getElementById('player-height'), ws = document.getElementById('player-weight');
    const hv = document.getElementById('height-val'), wv = document.getElementById('weight-val');
    if (hs && hv) { const f = e => { hv.textContent = e.target.value; updateCreationStatsPreview(); }; hs.addEventListener('input', f); }
    if (ws && wv) { const f = e => { wv.textContent = e.target.value; updateCreationStatsPreview(); }; ws.addEventListener('input', f); }
    if (typeof wireCreationExtras === 'function') wireCreationExtras();
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        updateCreationStatsPreview, setupCreationScreen, initCustomDropdowns,
        _populateTeamDropdown, _renderPositionRadios,
    });
}
