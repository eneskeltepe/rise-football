// ============================================================================
//  50-transfer.js  —  Dunya capi transfer/teklif.
//  Bonservis (fee), transfer pencereleri ve kiralama (loan) mantigi 52-market.js
//  ile birlikte calisir.
// ============================================================================

function _totalWeeks() {
    // Kariyer-haftası monotonik sayaç. leftClubAtWeek/joinedClubWeek HER YERDE *36 ile saklanıyor
    // (54-negotiation, 60-ui, 94-bindings); buradaki çarpan da 36 OLMALI yoksa sezon başına 2 hafta kayar.
    return ((gameState.currentSeason - START_SEASON) * 36) + gameState.currentWeek;
}

// OVR'a gore uygun kulup havuzu (TUM dunya, sadece ligler)
function _clubPoolForOvr(ovr, excludeId) {
    const all = DB.teams().filter(t => t.id !== excludeId && DB.getLeague(t.leagueId) &&
        DB.getLeague(t.leagueId).type === 'league');
    let lo = 40, hi = 99;
    if (ovr < 62) { hi = 67; }
    else if (ovr < 68) { hi = 73; }
    else if (ovr < 74) { lo = 64; hi = 82; }
    else if (ovr < 80) { lo = 72; hi = 88; }
    else { lo = 79; }
    let pool = all.filter(t => t.power >= lo && t.power <= hi);
    if (pool.length < 6) pool = all;   // emniyet
    return pool;
}

function calculateRealisticSquadRole(player, club) {
    const diff = (club.power || 70) - player.ovr;
    // Genç kapısı yalnız oyuncu kulüp seviyesinin ALTINDAYSA: 19 yaşında 85 OVR bir
    // yıldıza "altyapı" teklif edilmez. (Eskiden koşulsuzdu → güçlü kulüp havuzunda
    // OVR ne olursa olsun TÜM teklifler 'Altyapı / Rotasyon' görünüyordu.)
    if ((player.age || 24) <= 19 && (club.power || 70) > 75 && diff > 2) return 'Altyapı / Rotasyon';
    if (diff > 14) return 'Yedek Kadro';
    if (diff > 6) return 'Rotasyon';
    if (diff > -2) return 'İlk 11';
    return 'Kilit Oyuncu';
}

// Bonservis: oyuncu degeri + alici kulup hevesine gore (bir miktar rastgele)
function _calcFee(p, club) {
    const base = p.value || calcMarketValue(p.ovr, p.age, 2);
    const eager = 0.8 + Math.random() * 0.7;                 // 0.8 .. 1.5
    const presF = 0.85 + (club.prestige || 2) * 0.07;        // prestijli kulup biraz fazla oder
    return Math.max(100000, Math.round(base * eager * presF / 100000) * 100000);
}

// type: 'transfer' (kalici, bonservisli) | 'loan' (kiralik) | 'free' (serbest, bonservissiz)
function _makeOffer(club, p, wageMul, durMin, type) {
    type = type || 'transfer';
    const wage = Math.round(calcWage(p.ovr, club.prestige) * (0.85 + Math.random() * 0.4) * wageMul / 500) * 500;
    let fee = 0;
    if (type === 'transfer') fee = _calcFee(p, club);
    else if (type === 'loan') fee = Math.round(_calcFee(p, club) * 0.08 / 50000) * 50000; // kucuk kiralama bedeli
    return {
        clubId: club.id, clubName: club.name,
        wage: Math.max(2000, wage),
        duration: type === 'loan' ? 1 : durMin + Math.floor(Math.random() * 3),
        squadRole: calculateRealisticSquadRole(p, club),
        fee, type,
        isEurope: false,
        leagueName: (DB.getLeague(club.leagueId) || {}).name || '',
        leagueFlag: (DB.getLeague(club.leagueId) || {}).flag || '',
    };
}

// Sozlesmeli oyuncuya teklif (transfer/kiralik listesindeyken) — SADECE transfer penceresinde
function generateTransferOffers() {
    const p = gameState.player;
    const cs = p.currentSeasonStats;
    const avg = cs.ratings.length ? cs.ratings.reduce((a, b) => a + b, 0) / cs.ratings.length : 0;
    if (_totalWeeks() < 10) return;
    if (cs.matches < 5 && avg < 6.5) return;
    // Sozlesmeli oyuncu transferi yalniz pencere acikken olur
    if (typeof isTransferWindowOpen === 'function' && !isTransferWindowOpen()) return;

    const wantLoan = p.listingStatus === 'loan';
    let pool = _clubPoolForOvr(p.ovr, p.teamId);
    if (avg < 6.0 && cs.matches > 3) pool = pool.filter(t => t.power <= 80); // kotu form -> dev kulup yok

    // Bonservis/butce filtresi (kalici transferde alici bedeli karsilamali)
    if (!wantLoan && typeof clubBudget === 'function') {
        const fee0 = _calcFee(p, { prestige: 3 });
        pool = pool.filter(t => clubBudget(t) >= fee0 * 0.7);
    }
    if (!pool.length) { gameState.transferOffers = []; return; }

    const count = 1 + Math.floor(Math.random() * 3);
    const offers = [];
    const seen = new Set();
    for (let i = 0; i < count * 4 && offers.length < count; i++) {
        const club = pool[Math.floor(Math.random() * pool.length)];
        if (seen.has(club.id)) continue;
        seen.add(club.id);
        offers.push(_makeOffer(club, p, 1.0, 2, wantLoan ? 'loan' : 'transfer'));
    }
    gameState.transferOffers = offers;
}

// Kulupsuz (serbest) oyuncuya teklif — bonservissiz, her zaman olabilir; pencerede ilgi artar
function generateFreeAgentOffers() {
    const p = gameState.player;
    let offerChance = Math.min(0.9, p.ovr / 100);
    if (typeof isTransferWindowOpen === 'function' && isTransferWindowOpen()) offerChance = Math.min(0.97, offerChance + 0.25);
    if (Math.random() > offerChance) { gameState.transferOffers = []; return; }
    let pool = _clubPoolForOvr(p.ovr, null);
    // eski kulube en az 18 hafta ara
    if (p.lastTeamId && (_totalWeeks() - (p.leftClubAtWeek || 0)) < 18)
        pool = pool.filter(t => t.id !== p.lastTeamId);
    if (!pool.length) { gameState.transferOffers = []; return; }
    const count = 1 + Math.floor(Math.random() * 2);
    const offers = [];
    const seen = new Set();
    for (let i = 0; i < count * 4 && offers.length < count; i++) {
        const club = pool[Math.floor(Math.random() * pool.length)];
        if (seen.has(club.id)) continue;
        seen.add(club.id);
        offers.push(_makeOffer(club, p, 0.92, 1, 'free'));
    }
    gameState.transferOffers = offers;
}

if (typeof window !== 'undefined') {
    Object.assign(window, { generateTransferOffers, generateFreeAgentOffers, calculateRealisticSquadRole, _calcFee });
}
