// ============================================================================
//  70-save.js  —  Kayit/Yukleme (v2) + v1->v2 migrasyon.
// ============================================================================

// Eski Super Lig takim ID -> yeni DB takim ID
const OLD_TEAM_ID_MAP = {
    GS: 'tur-super-lig__galatasaray', FB: 'tur-super-lig__fenerbahce',
    BJK: 'tur-super-lig__besiktas', TS: 'tur-super-lig__trabzonspor',
    IBFK: 'tur-super-lig__basaksehir', EYU: 'tur-super-lig__eyupspor',
    GOZ: 'tur-super-lig__goztepe', SAM: 'tur-super-lig__samsunspor',
    ANT: 'tur-super-lig__antalyaspor', KAS: 'tur-super-lig__kasimpasa',
    RIZ: 'tur-super-lig__caykur-rizespor', ALA: 'tur-super-lig__alanyaspor',
    KON: 'tur-super-lig__konyaspor', GFK: 'tur-super-lig__gaziantep',
    KAY: 'tur-super-lig__kayserispor',
};

// ---- Çoklu kayıt slotu (10 kariyer) ----
const SLOT_COUNT = 10;   // menü/README "10 kariyer slotu" vaat eder (eskiden 9'du)
const SLOT_PREFIX = 'football_career_slot_';
const ACTIVE_SLOT_KEY = 'football_career_active_slot';
function slotKey(i) { return SLOT_PREFIX + i; }

function saveGame() {
    try {
        gameState._savedAt = Date.now();
        if (gameState._slot !== undefined && gameState._slot !== null && gameState._slot >= 0) {
            const json = JSON.stringify(gameState);
            localStorage.setItem(slotKey(gameState._slot), json);
            localStorage.setItem(ACTIVE_SLOT_KEY, String(gameState._slot));
            if (typeof storeMirrorSave === 'function') storeMirrorSave(gameState._slot, json);   // IndexedDB yedek
        } else {
            localStorage.setItem(SAVE_KEY, JSON.stringify(gameState));   // legacy/yedek
        }
    } catch (e) { console.error('Kayit hatasi', e); }
}

// Bir slotun özet bilgisi (menüde kart göstermek için) — yoksa null
function slotMeta(i) {
    const raw = localStorage.getItem(slotKey(i));
    if (!raw) return null;
    try {
        const gs = JSON.parse(raw); const p = gs.player;
        if (!p) return null;
        return {
            index: i, name: `${p.firstname} ${p.lastname}`,
            club: p.teamName || 'Serbest Oyuncu', teamId: p.teamId || null,
            img: p.img || '', ovr: p.ovr, pos: p.position, age: p.age,
            season: gs.currentSeason, week: gs.currentWeek, savedAt: gs._savedAt || 0,
        };
    } catch (e) { return null; }
}
function listSaveSlots() { return Array.from({ length: SLOT_COUNT }, (_, i) => ({ index: i, meta: slotMeta(i) })); }
function firstEmptySlot() { for (let i = 0; i < SLOT_COUNT; i++) if (!localStorage.getItem(slotKey(i))) return i; return null; }
function activeSlotIndex() { const v = localStorage.getItem(ACTIVE_SLOT_KEY); return v === null ? null : parseInt(v); }
function deleteSlot(i) {
    localStorage.removeItem(slotKey(i));
    if (activeSlotIndex() === i) localStorage.removeItem(ACTIVE_SLOT_KEY);
    // IndexedDB aynasini da temizle; yoksa boot'ta storeHydrateMissingSlots geri yukler.
    if (typeof storeDeleteSlot === 'function') storeDeleteSlot(i);
    // Kalici dunya veritabanindaki (fc_world_db) bu slota ait kayitlari da sil.
    try { if (window.WorldDB && typeof WorldDB.clearSlot === 'function') WorldDB.clearSlot(i); } catch (e) {/* sessiz */}
}

function loadFromSlot(i) {
    const raw = localStorage.getItem(slotKey(i));
    if (!raw) return false;
    try {
        gameState = JSON.parse(raw);
        gameState._slot = i;
        _ensurePlayerFields(gameState.player);
        _ensureGameStateFields(gameState);
        // Dunya durumunu kayda gore yeniden kur: taban + deterministik guc evrimi
        // replay + terfi/kume dusme overlay'i (teamLeagues). initAllStandings /
        // setActiveLeagueFixtures / activeLeagueId BUNDAN SONRA dogru uyelikle calisir.
        try { if (typeof restoreWorldState === 'function') restoreWorldState(gameState); } catch (e) { console.warn(e); }
        if (gameState.player && !gameState.standings) initAllStandings();
        if (gameState.player) {
            const lid = activeLeagueId();
            // OYNANMIS SKORLARI KORU: kayittaki fikstur ayni lige aitse AYNEN kullan.
            // (Eskiden her yuklemede setActiveLeagueFixtures cagrilip skorlar siliniyordu;
            //  kullanicinin gercek mac sonucu listede deterministik "yanlis" skora donuyor,
            //  ayni gun maci yeniden oynanabilir hale geliyordu.)
            const fxOk = Array.isArray(gameState.fixtures) && gameState.fixtures.length > 0 && gameState._fxLeague === lid;
            if (!fxOk) setActiveLeagueFixtures();
            gameState._fxLeague = lid;
            if (lid) DB.loadPlayers(lid);
            // Fikstur hafta navigasyonu guncel haftadan baslasin (eskiden 1'de kaliyordu;
            // ekran guncel haftayi gosterirken ok tuslari 1'den devam ediyordu)
            fixtureViewingWeek = gameState.currentWeek || 1;
        }
        localStorage.setItem(ACTIVE_SLOT_KEY, String(i));
        return true;
    } catch (e) { console.error('slot yukleme hatasi', e); return false; }
}

// Eski tek-kayıt (v2/v1) varsa ve hiç slot yoksa slot 0'a taşı
function migrateLegacyToSlots() {
    const hasAnySlot = Array.from({ length: SLOT_COUNT }, (_, i) => localStorage.getItem(slotKey(i))).some(Boolean);
    if (hasAnySlot) return;
    const v2 = localStorage.getItem(SAVE_KEY);
    if (v2) {
        try {
            const gs = JSON.parse(v2); gs._slot = 0; gs._savedAt = gs._savedAt || Date.now();
            localStorage.setItem(slotKey(0), JSON.stringify(gs));
            localStorage.setItem(ACTIVE_SLOT_KEY, '0');
            localStorage.removeItem(SAVE_KEY);
            return;
        } catch (e) { /* yoksay */ }
    }
    const v1 = localStorage.getItem(LEGACY_SAVE_KEY);
    if (v1) {
        try {
            _migrateV1(JSON.parse(v1));   // gameState'i doldurur
            gameState._slot = 0;
            localStorage.setItem(slotKey(0), JSON.stringify(gameState));
            localStorage.setItem(ACTIVE_SLOT_KEY, '0');
            localStorage.removeItem(LEGACY_SAVE_KEY);
        } catch (e) { /* yoksay */ }
    }
}

// Yeni alanlari (eksikse) doldur — ileri uyumluluk
function _ensurePlayerFields(p) {
    if (!p) return;
    const d = (k, v) => { if (p[k] === undefined) p[k] = v; };
    d('listingStatus', 'normal'); d('listingRequested', 'none');
    d('lastContractRenewalWeek', 1); d('negotiationBlockUntil', 0);
    d('joinedClubWeek', 0);
    d('lastTeamId', null); d('leftClubAtWeek', 0);
    d('injury', null); d('youthProspects', []);
    d('yellowAccum', 0); d('suspension', null);
    d('onLoan', false); d('loanReturn', null);
    d('trainingHistory', []);
    d('matchLog', []); d('transferHistory', []);
    d('seasonStarts', 0); d('seasonBenched', 0);
    d('seasonHistory', []);
    d('monthlyAwards', []); d('_lastMonthlyKey', null);   // Ayın Oyuncusu (48-awards)
    d('setPieceDuty', { pen: false, fk: false });         // Penaltıcı/Frikikçi görevi (49-setpieces)
    ['currentSeasonStats', 'careerStats'].forEach(k => {
        if (p[k]) {
            const s = p[k];
            if (s.cleanSheets === undefined) s.cleanSheets = 0;
            if (s.motm === undefined) s.motm = 0;
            if (s.starts === undefined) s.starts = 0;
            if (s.subApps === undefined) s.subApps = 0;
            if (!s.cup) s.cup = { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, motm: 0 };
        }
    });
    if (!p.peakAge || !p.potential) Object.assign(p, rollCareerTraits(p.ovr || 65));
    // attrs yoksa ana statlardan turet (eski kayit)
    if (!p.attrs || !Object.keys(p.attrs).length) _statsToAttrs(p);
}

// gameState-seviyesi alanlar (calendar/market/history) icin geriye uyum default'lari
function _ensureGameStateFields(gs) {
    if (!gs) return;
    if (gs.careerSalt == null) {
        // eski kayitlar icin stabil bir tohum uret (slot + sezon)
        gs.careerSalt = ((gs._slot != null ? gs._slot + 1 : 1) * 7919 + (parseInt(gs.currentSeason) || 2026)) >>> 0;
    }
    if (!gs.worldTransferLog) gs.worldTransferLog = [];
    if (!gs.ballonHistory) gs.ballonHistory = [];   // Altın Top arşivi (48-awards yazar)
    if (!gs.teamLeagues) gs.teamLeagues = {};   // terfi/kume dusme kalici overlay'i (35-promotion yazar, restoreWorldState uygular)
    if (!gs.teamPowerDelta) gs.teamPowerDelta = {};   // transfer kaynakli kalici guc duzeltmeleri (52-market yazar, restoreWorldState uygular)
    if (!gs.freeAgents) gs.freeAgents = [];
    if (!gs.transferNews) gs.transferNews = [];
    if (!gs.clubSpend) gs.clubSpend = {};
    if (!gs.genFillers) gs.genFillers = {};
    if (!gs.clubYouth) gs.clubYouth = {};
    if (!gs.squadFitness) gs.squadFitness = {};
    if (!gs.clubFin) gs.clubFin = {};
    if (!gs.settings) gs.settings = {};
    // Lig & Fikstür + İstatistikler varsayılanını oyuncunun MEVCUT ligine sabitle (eski kayıtta
    // İngiltere'ye sıkışma fix'i). NOT: _fxLeague'e DOKUNMA — null yapmak reload'da
    // setActiveLeagueFixtures'ı tetikleyip oynanmış maç skorlarını cache'ten null'a çevirirdi.
    try {
        const _t = gs.player && (typeof DB !== 'undefined') && DB.getTeam(gs.player.teamId);
        const _alid = _t ? _t.leagueId : null;
        if (_alid) {
            gs.viewStandingsLeague = _alid;
            if (gs.statsView) gs.statsView.league = _alid; else gs.statsView = { league: _alid, cat: 'g' };
        }
    } catch (e) {}
    if (gs.settings.matchSpeed === undefined) gs.settings.matchSpeed = 'normal';
    // Takvim (gün-bazlı katman) — eski kayıtlarda currentWeek'ten türet
    if (!gs.seasonStartDate) { const y = parseInt(gs.currentSeason) || 2026; gs.seasonStartDate = y + '-08-08'; }
    if (gs.gameDate === undefined || gs.gameDate === null) gs.gameDate = (Math.max(1, gs.currentWeek || 1) - 1) * 7;
}

// 6 ana stat -> alt-ozellik dolumu (her alt = ilgili ana deger)
function _statsToAttrs(p) {
    const s = p.stats || {}; const attrs = {};
    const isGK = p.position === 'Kaleci';
    for (const main in ATTR_GROUPS) {
        if (isGK && main === 'teknik') continue;
        for (const [k] of ATTR_GROUPS[main]) attrs[k] = Math.round(s[main] || 60);
    }
    if (isGK) for (const [k] of GK_ATTR_GROUP) attrs[k] = Math.round(s.teknik || 65);
    else attrs.reaksiyon = Math.round(s.teknik || 60);
    p.attrs = attrs;
    recomputeMainStats(p);
}

function _migrateV1(old) {
    const p = old.player;
    if (p) {
        // pozisyon 8->12
        p.position = LEGACY_POS_MAP[p.position] || p.position;
        // takim ID donusumu
        let newTeam = OLD_TEAM_ID_MAP[p.teamId];
        if (!newTeam || !DB.getTeam(newTeam)) {
            // ad ile dene, yoksa serbest
            const byName = DB.teams().find(t => t.name === p.teamName);
            newTeam = byName ? byName.id : null;
        }
        p.teamId = newTeam;
        p.teamName = newTeam ? DB.getTeam(newTeam).name : 'Serbest Oyuncu';
        _statsToAttrs(p);
        Object.assign(p, rollCareerTraits(p.ovr || calculateOVR(p)));
        recalcPlayer(p);
        _ensurePlayerFields(p);
    }
    // sezon durumunu tazele (fikstur/puan tutarliligi icin)
    gameState = old;
    gameState.currentWeek = 1;
    gameState.transferOffers = [];
    gameState.matchesPlayedThisWeek = false;
    gameState.actionsDoneThisWeek = 0;
    gameState.careerHistory = old.careerHistory || [];
    gameState.trophies = old.trophies || [];
    initAllStandings();
    setActiveLeagueFixtures();
    return true;
}

function loadGame() {
    // v2
    const v2 = localStorage.getItem(SAVE_KEY);
    if (v2) {
        try {
            gameState = JSON.parse(v2);
            _ensurePlayerFields(gameState.player);
            _ensureGameStateFields(gameState);
            try { if (typeof restoreWorldState === 'function') restoreWorldState(gameState); } catch (e) { console.warn(e); }
            if (gameState.player && !gameState.standings) initAllStandings();
            if (gameState.player) {
                const lid = activeLeagueId();
                const fxOk = Array.isArray(gameState.fixtures) && gameState.fixtures.length > 0 && gameState._fxLeague === lid;
                if (!fxOk) setActiveLeagueFixtures();
                gameState._fxLeague = lid;
                fixtureViewingWeek = gameState.currentWeek || 1;
            }
            return true;
        } catch (e) { console.error('v2 yukleme hatasi', e); }
    }
    // v1 -> migrasyon
    const v1 = localStorage.getItem(LEGACY_SAVE_KEY);
    if (v1) {
        try {
            const ok = _migrateV1(JSON.parse(v1));
            if (ok) {
                saveGame();
                setTimeout(() => { try { showToast('Kayıt yeni sürüme taşındı (sezon yenilendi).', 'success'); } catch (e) {} }, 800);
            }
            return ok;
        } catch (e) { console.error('v1 migrasyon hatasi', e); }
    }
    return false;
}

if (typeof window !== 'undefined') Object.assign(window, {
    saveGame, loadGame, OLD_TEAM_ID_MAP,
    SLOT_COUNT, slotKey, slotMeta, listSaveSlots, firstEmptySlot, activeSlotIndex,
    deleteSlot, loadFromSlot, migrateLegacyToSlots,
});
