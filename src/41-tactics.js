// ============================================================================
//  41-tactics.js  —  FAZ B: TAKTİK ÇEŞİTLİLİĞİ (gerçek kompozisyonlu formasyonlar)
//  + dinamik hoca AI + mantalite. Eskiden tüm takımlar sabit 4-2-3-1 dizilişiyle
//  AYNI 11-slot kompozisyonunu kullanıyordu (formasyon yalnız görseldi). Artık her
//  formasyonun GERÇEK kompozisyonu var (3 stoper, 2 forvet vb.) → _buildXI farklı
//  personel seçer. Saha koordinatları slot sırasıyla hizalı (tek dizi: key+label+x+y).
//  40-match (_buildXI) ve 45-matchengine (renderMatchLineupPitch) bunu kullanır.
// ============================================================================

// Her slot: { key (SLOT_FAMS anahtarı), label (kısa), x, y } (y: 90=kendi kale, 15=hücum)
const FORMATIONS = {
    '4-2-3-1': [
        { key: 'Kaleci', label: 'KL', x: 50, y: 90 },
        { key: 'Bek', label: 'BEK', x: 15, y: 72 }, { key: 'Stoper', label: 'STP', x: 38, y: 78 },
        { key: 'Stoper', label: 'STP', x: 62, y: 78 }, { key: 'Bek', label: 'BEK', x: 85, y: 72 },
        { key: 'DOS', label: 'DOS', x: 35, y: 58 }, { key: 'Merkez OS', label: 'MÖ', x: 65, y: 58 },
        { key: 'Ofansif OS', label: 'OOS', x: 50, y: 38 },
        { key: 'Kanat', label: 'KAN', x: 20, y: 35 }, { key: 'Kanat', label: 'KAN', x: 80, y: 35 },
        { key: 'Santrfor', label: 'SNT', x: 50, y: 15 },
    ],
    '4-3-3': [
        { key: 'Kaleci', label: 'KL', x: 50, y: 90 },
        { key: 'Bek', label: 'BEK', x: 15, y: 72 }, { key: 'Stoper', label: 'STP', x: 38, y: 78 },
        { key: 'Stoper', label: 'STP', x: 62, y: 78 }, { key: 'Bek', label: 'BEK', x: 85, y: 72 },
        { key: 'DOS', label: 'DOS', x: 50, y: 60 }, { key: 'Merkez OS', label: 'MÖ', x: 32, y: 48 },
        { key: 'Merkez OS', label: 'MÖ', x: 68, y: 48 },
        { key: 'Kanat', label: 'KAN', x: 18, y: 26 }, { key: 'Kanat', label: 'KAN', x: 82, y: 26 },
        { key: 'Santrfor', label: 'SNT', x: 50, y: 15 },
    ],
    '4-4-2': [
        { key: 'Kaleci', label: 'KL', x: 50, y: 90 },
        { key: 'Bek', label: 'BEK', x: 15, y: 72 }, { key: 'Stoper', label: 'STP', x: 38, y: 78 },
        { key: 'Stoper', label: 'STP', x: 62, y: 78 }, { key: 'Bek', label: 'BEK', x: 85, y: 72 },
        { key: 'Merkez OS', label: 'MÖ', x: 35, y: 52 }, { key: 'Merkez OS', label: 'MÖ', x: 65, y: 52 },
        { key: 'Kanat', label: 'KAN', x: 14, y: 42 }, { key: 'Kanat', label: 'KAN', x: 86, y: 42 },
        { key: 'Santrfor', label: 'SNT', x: 38, y: 16 }, { key: 'Santrfor', label: 'SNT', x: 62, y: 16 },
    ],
    '3-5-2': [
        { key: 'Kaleci', label: 'KL', x: 50, y: 90 },
        { key: 'Stoper', label: 'STP', x: 30, y: 80 }, { key: 'Stoper', label: 'STP', x: 50, y: 82 },
        { key: 'Stoper', label: 'STP', x: 70, y: 80 },
        { key: 'Bek', label: 'KB', x: 10, y: 52 }, { key: 'Bek', label: 'KB', x: 90, y: 52 },
        { key: 'DOS', label: 'DOS', x: 50, y: 62 }, { key: 'Merkez OS', label: 'MÖ', x: 35, y: 46 },
        { key: 'Ofansif OS', label: 'OOS', x: 65, y: 46 },
        { key: 'Santrfor', label: 'SNT', x: 38, y: 16 }, { key: 'Santrfor', label: 'SNT', x: 62, y: 16 },
    ],
    '4-1-2-1-2': [
        { key: 'Kaleci', label: 'KL', x: 50, y: 90 },
        { key: 'Bek', label: 'BEK', x: 15, y: 72 }, { key: 'Stoper', label: 'STP', x: 38, y: 78 },
        { key: 'Stoper', label: 'STP', x: 62, y: 78 }, { key: 'Bek', label: 'BEK', x: 85, y: 72 },
        { key: 'DOS', label: 'DOS', x: 50, y: 62 }, { key: 'Merkez OS', label: 'MÖ', x: 30, y: 48 },
        { key: 'Merkez OS', label: 'MÖ', x: 70, y: 48 }, { key: 'Ofansif OS', label: 'OOS', x: 50, y: 34 },
        { key: 'Santrfor', label: 'SNT', x: 38, y: 16 }, { key: 'Santrfor', label: 'SNT', x: 62, y: 16 },
    ],
    '5-4-1': [
        { key: 'Kaleci', label: 'KL', x: 50, y: 90 },
        { key: 'Bek', label: 'KB', x: 10, y: 66 }, { key: 'Stoper', label: 'STP', x: 30, y: 80 },
        { key: 'Stoper', label: 'STP', x: 50, y: 82 }, { key: 'Stoper', label: 'STP', x: 70, y: 80 },
        { key: 'Bek', label: 'KB', x: 90, y: 66 },
        { key: 'Kanat', label: 'KAN', x: 18, y: 44 }, { key: 'Merkez OS', label: 'MÖ', x: 40, y: 50 },
        { key: 'Merkez OS', label: 'MÖ', x: 60, y: 50 }, { key: 'Kanat', label: 'KAN', x: 82, y: 44 },
        { key: 'Santrfor', label: 'SNT', x: 50, y: 18 },
    ],
};
const FORMATION_NAMES = Object.keys(FORMATIONS);

function formationSlots(name) { return (FORMATIONS[name] || FORMATIONS['4-2-3-1']).map(s => ({ key: s.key, label: s.label })); }
function formationCoords(name) { return (FORMATIONS[name] || FORMATIONS['4-2-3-1']).map(s => ({ x: s.x, y: s.y, label: s.label })); }

// deterministik [0,1) — takıma/sezona göre çeşitli ama tutarlı (formasyon sezon sezon değişebilir)
function _tacRand(key) {
    const salt = (typeof gameState !== 'undefined' && gameState && gameState.careerSalt != null) ? gameState.careerSalt : 0;
    const s = salt + '|tac|' + key + '|' + ((typeof gameState !== 'undefined' && gameState) ? gameState.currentSeason : 0);
    let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
}

// Takımın gücüne + kadro kompozisyonuna göre formasyon seç (deterministik).
function pickFormation(squad, team) {
    if (!squad || !squad.length) return '4-2-3-1';
    const fam = {};
    for (const p of squad) { const f = (typeof posFamily === 'function') ? posFamily(p.pos || p.position) : 'CM'; fam[f] = (fam[f] || 0) + 1; }
    const power = (team && team.power) || 70;
    const strikers = fam.ST || 0, wingers = (fam.W || 0) + (fam.WM || 0), cbs = fam.CB || 0;
    let pool;
    if (power >= 79) pool = ['4-3-3', '4-2-3-1', '4-3-3', '4-2-3-1'];
    else if (power >= 70) pool = ['4-2-3-1', '4-3-3', '4-4-2', '3-5-2'];
    else pool = ['4-4-2', '5-4-1', '4-2-3-1', '5-4-1'];
    if (strikers >= 2) pool = pool.concat(['4-4-2', '4-1-2-1-2']);
    if (strikers >= 2 && cbs >= 5) pool = pool.concat(['3-5-2']);
    if (wingers >= 3 && power >= 74) pool = pool.concat(['4-3-3']);
    if (cbs >= 5 && power < 74) pool = pool.concat(['5-4-1', '3-5-2']);
    const idx = Math.floor(_tacRand((team && team.id) || 'x') * pool.length);
    return pool[idx] || '4-2-3-1';
}

// ---- Mantalite (Hücum/Dengeli/Savunma) ----
const MENTALITY_FACTOR = { attack: 1.12, balanced: 1.0, defend: 0.88 };
const MENTALITY_LABEL = { attack: 'Hücum', balanced: 'Dengeli', defend: 'Savunma' };
function pickMentality(team, oppTeam, isHome) {
    const d = (((team && team.power) || 70) - ((oppTeam && oppTeam.power) || 70)) + (isHome ? 3 : 0);
    if (d >= 8) return 'attack';
    if (d <= -8) return 'defend';
    return 'balanced';
}
function mentalityFactor(m) { return MENTALITY_FACTOR[m] || 1.0; }

// ---- Dinamik hoca AI: skor + süreye göre mantalite/diziliş uyarlar ----
// Döner: değişiklik yapıldıysa { mentality, formation? } değilse null.
function adaptTactics(teamKey, minute) {
    if (typeof activeMatch === 'undefined' || minute < 60) return null;
    const isMy = teamKey === 'MY';
    const ourScore = isMy ? (activeMatch.isHome ? activeMatch.scoreHome : activeMatch.scoreAway) : (activeMatch.isHome ? activeMatch.scoreAway : activeMatch.scoreHome);
    const oppScore = isMy ? (activeMatch.isHome ? activeMatch.scoreAway : activeMatch.scoreHome) : (activeMatch.isHome ? activeMatch.scoreHome : activeMatch.scoreAway);
    const diff = ourScore - oppScore;
    const cur = isMy ? activeMatch.myMentality : activeMatch.oppMentality;
    let next = cur;
    if (minute >= 70 && diff <= -1) next = 'attack';        // geride → hücum
    else if (minute >= 75 && diff >= 2) next = 'defend';     // rahat önde → koru
    else if (minute >= 80 && diff === 1) next = 'defend';    // dar önde, son dakikalar → koru
    if (next === cur) return null;
    if (isMy) activeMatch.myMentality = next; else activeMatch.oppMentality = next;
    return { mentality: next };
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        FORMATIONS, FORMATION_NAMES, formationSlots, formationCoords, pickFormation,
        MENTALITY_FACTOR, MENTALITY_LABEL, pickMentality, mentalityFactor, adaptTactics,
    });
}
