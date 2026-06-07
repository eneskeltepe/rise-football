// ============================================================================
//  25-career.js  —  Gelisim/yas egrisi, altyapi, sakatlik, kariyer rastgeleligi
//  Abartiya kacmadan, hafif rastgelelikle.
// ============================================================================

function _rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
function _clamp(v, lo = 1, hi = 99) { return Math.max(lo, Math.min(hi, v)); }

// ---- Kariyer basinda gizli ozellikler (her kariyer biraz farkli) ----
function rollCareerTraits(startOvr) {
    const talent = Math.random();                       // 0..1 yetenek tohumu
    const headroom = Math.round(8 + talent * 26 + _rnd(-3, 3)); // potansiyel boslugu
    return {
        potential: _clamp(startOvr + headroom, startOvr + 4, 94),
        peakAge: Math.round(_rnd(26, 30)),
        injuryProneness: +_rnd(0.6, 1.5).toFixed(2),    // <1 saglam, >1 cam
        consistency: +_rnd(0.72, 0.98).toFixed(2),       // mac performans tutarliligi
        talent: +talent.toFixed(2),
    };
}

// ---- Bir alt-ozellik grubuna delta uygula ----
function _adjustGroup(player, mainKey, delta) {
    const grp = (mainKey === 'teknik' && player.position === 'Kaleci')
        ? GK_ATTR_GROUP : (ATTR_GROUPS[mainKey] || []);
    for (const [k] of grp) {
        player.attrs[k] = _clamp(Math.round((player.attrs[k] || 0) + delta + _rnd(-0.6, 0.6)));
    }
}

// ---- Kullanici oyuncusu: sezon basi dogal gelisim/dususi ----
// perf: 0.5(kotu)..1.5(harika) sezon performansi | facility: kulup antrenman tesisi 40..96
function developPlayerSeason(player, facility = 70, perf = 1.0) {
    if (!player.attrs) return { note: '' };
    const age = player.age;
    const peak = player.peakAge || 27;
    const pot = player.potential || (player.ovr + 10);
    const facB = 0.7 + facility / 100;                  // 0.7..1.66
    const beforeOvr = player.ovr;

    if (age < peak) {
        const youthF = (peak - age) / Math.max(6, peak - 15);   // gence yaklastikca buyuk
        const gap = Math.max(0, pot - player.ovr);
        const mag = (0.5 + youthF * 1.8) * facB * (0.6 + perf * 0.6) * (gap / 14);
        // genc oyuncu: fizik/hiz erken, teknik/pas surekli gelisir
        _adjustGroup(player, 'fizik', mag * (age < 21 ? 1.2 : 0.7));
        _adjustGroup(player, 'hiz', mag * (age < 20 ? 0.9 : 0.4));
        _adjustGroup(player, 'teknik', mag * 1.0);
        _adjustGroup(player, 'pas', mag * 0.9);
        _adjustGroup(player, 'sut', mag * 0.8);
        _adjustGroup(player, 'defans', mag * 0.8);
    } else if (age <= peak + 1) {
        for (const m of MAIN_STAT_KEYS) _adjustGroup(player, m, _rnd(-0.4, 0.5));
    } else {
        const d = age - peak;                            // dusus siddeti
        _adjustGroup(player, 'hiz', -(0.8 + d * 0.7));
        _adjustGroup(player, 'fizik', -(0.5 + d * 0.5));
        _adjustGroup(player, 'defans', -(0.15 + d * 0.18));
        _adjustGroup(player, 'sut', -(0.1 + d * 0.15));
        _adjustGroup(player, 'teknik', -(0.1 + d * 0.12));
        _adjustGroup(player, 'pas', d > 4 ? -(d * 0.1) : 0.05); // tecrube pasi korur
    }
    recomputeMainStats(player);
    // potansiyeli asma
    let ovr = calculateOVR(player);
    if (age < peak && ovr > pot) {
        const scale = pot / ovr;
        for (const k in player.attrs) player.attrs[k] = _clamp(Math.round(player.attrs[k] * scale));
        recomputeMainStats(player);
        ovr = calculateOVR(player);
    }
    player.ovr = ovr;
    return { delta: ovr - beforeOvr };
}

// ---- DB oyuncusu: sezon farkina gore OVR yas-kaymasi (gosterim/mac) ----
// DETERMINISTIK: ayni oyuncu+sezon icin her render'da AYNI deger (istatistik/dizilis
// titremesin). Tohum: oyuncu id + sezon indeksi + kariyer tohumu (kariyere gore cesitli).
function _ageDriftR(dbPlayer, i, lo, hi) {
    const salt = (typeof gameState !== 'undefined' && gameState && gameState.careerSalt != null) ? gameState.careerSalt : 0;
    const s = salt + '|' + (dbPlayer.id != null ? dbPlayer.id : 'x') + '|' + i;
    let h = 2166136261;
    for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
    return lo + ((h >>> 0) % 100000) / 100000 * (hi - lo);
}
function ageAdjustedOvr(dbPlayer, seasonsElapsed) {
    // Altyapi oyunculari MANUEL gelistirilir (developClubYouth) → ovr gunceldir, yas-kaymasi UYGULAMA.
    // FAZ 4: regen'ler WorldDB'de evolveWorldPlayersSeason ile yaşlanır → ham OVR (çift yaşlanma yok).
    if (dbPlayer && (dbPlayer.isYouth || dbPlayer.isRegen)) return Math.max(40, Math.min(99, Math.round(dbPlayer.ovr || 50)));
    if (!seasonsElapsed) return dbPlayer.ovr;
    const baseAge = dbPlayer.age;
    let ovr = dbPlayer.ovr;
    const pot = dbPlayer.ovr + Math.max(0, (23 - baseAge)) * 1.1; // genc => boslukk
    for (let i = 1; i <= seasonsElapsed; i++) {
        const a = baseAge + i;
        if (a <= 23) ovr += Math.min(2.2, Math.max(0, (pot - ovr)) * 0.4 + 0.4);
        else if (a <= 28) ovr += _ageDriftR(dbPlayer, i, -0.2, 0.5);
        else if (a <= 31) ovr -= _ageDriftR(dbPlayer, i, 0.4, 1.0);
        else ovr -= _ageDriftR(dbPlayer, i, 1.0, 2.2);
    }
    return Math.max(40, Math.min(99, Math.round(ovr)));
}

// ---- Altyapidan genc oyuncu cikarma ----
const _YOUTH_POS_WEIGHTS = [
    ['Stoper', 3], ['Sağ Bek', 2], ['Sol Bek', 2], ['Merkez OS', 3], ['DOS', 2],
    ['Ofansif OS', 2], ['Sağ Kanat', 2], ['Sol Kanat', 2], ['Santrfor', 3], ['Kaleci', 2],
    ['Sağ Açık', 1], ['Sol Açık', 1],
];
function _weightedPos() {
    const tot = _YOUTH_POS_WEIGHTS.reduce((s, x) => s + x[1], 0);
    let r = Math.random() * tot;
    for (const [k, w] of _YOUTH_POS_WEIGHTS) { if ((r -= w) <= 0) return k; }
    return 'Merkez OS';
}
// Tek 'name' alanını ad/soyad parçalarına böl (DB oyuncuları "Ángel Di María" gibi tek string).
function _nameParts(full) {
    const t = (full || '').trim().split(/\s+/).filter(Boolean);
    if (!t.length) return { first: 'Genç', last: 'Oyuncu' };
    if (t.length === 1) return { first: t[0], last: t[0] };
    return { first: t[0], last: t.slice(1).join(' ') };
}
// Lig oyuncuları yüklenememişse (ör. kreasyon anı) çok-uluslu gerçek isim yedeği.
const _YOUTH_FALLBACK = [
    { nation: 'Turkey', first: 'Emre', last: 'Yıldırım' }, { nation: 'Turkey', first: 'Arda', last: 'Demir' },
    { nation: 'France', first: 'Lucas', last: 'Moreau' }, { nation: 'France', first: 'Hugo', last: 'Lefèvre' },
    { nation: 'Spain', first: 'Pablo', last: 'Hernández' }, { nation: 'Spain', first: 'Diego', last: 'Ramírez' },
    { nation: 'Brazil', first: 'Gabriel', last: 'Souza' }, { nation: 'Brazil', first: 'Matheus', last: 'Oliveira' },
    { nation: 'England', first: 'Jack', last: 'Whitmore' }, { nation: 'England', first: 'Harry', last: 'Dawson' },
    { nation: 'Germany', first: 'Leon', last: 'Wagner' }, { nation: 'Italy', first: 'Marco', last: 'Conti' },
    { nation: 'Argentina', first: 'Tomás', last: 'Gómez' }, { nation: 'Portugal', first: 'João', last: 'Costa' },
    { nation: 'Netherlands', first: 'Daan', last: 'Visser' }, { nation: 'Belgium', first: 'Lars', last: 'Peeters' },
];
// Genç oyuncuya GERÇEK, ülkeye-uygun isim: kulübün ligindeki oyunculardan millet-eşli ad+soyad
// (millet, ligin oyuncu dağılımından seçilir → çoğunlukla yerli, bir kısmı yabancı; gerçekçi).
function _youthIdentity(leagueId) {
    let pool = [];
    try {
        if (typeof DB !== 'undefined') {
            if (leagueId && DB.playersInLeagueSync) pool = DB.playersInLeagueSync(leagueId) || [];
            if ((!pool || !pool.length) && DB.loadedPlayersSync) pool = DB.loadedPlayersSync() || [];
        }
    } catch (e) { pool = []; }
    if (pool && pool.length) {
        const nation = (pool[Math.floor(Math.random() * pool.length)] || {}).nation || 'Unknown';
        let src = pool.filter(p => p.nation === nation);
        if (src.length < 2) src = pool;
        const a = _nameParts((src[Math.floor(Math.random() * src.length)] || {}).name);
        const b = _nameParts((src[Math.floor(Math.random() * src.length)] || {}).name);
        return { nation, firstname: a.first, lastname: b.last, name: a.first + ' ' + b.last };
    }
    const fb = _YOUTH_FALLBACK[Math.floor(Math.random() * _YOUTH_FALLBACK.length)];
    return { nation: fb.nation, firstname: fb.first, lastname: fb.last, name: fb.first + ' ' + fb.last };
}
// team: DB takim nesnesi (facilities.youth, prestige). season: mevcut sezon.
function generateYouthProspects(team, season) {
    const yf = (team && team.facilities && team.facilities.youth) || 55;
    // tesise gore sayi: zayif 0-1, iyi 1-3
    const expected = (yf - 45) / 22;                    // ~0.45 .. 2.3
    let count = Math.floor(expected) + (Math.random() < (expected % 1) ? 1 : 0);
    count = Math.max(0, Math.min(3, count));
    const prospects = [];
    for (let i = 0; i < count; i++) {
        const pos = _weightedPos();
        const age = Math.floor(_rnd(16, 20));
        const height = Math.round(_rnd(pos === 'Kaleci' ? 186 : 172, pos === 'Kaleci' ? 197 : 190));
        const weight = Math.round(_rnd(64, 82));
        const attrs = rollStartingAttrs(pos, height, weight);
        // tesis kalitesi baslangic seviyesini yukseltir
        const boost = Math.round((yf - 60) / 6);
        for (const k in attrs) attrs[k] = _clamp(attrs[k] + boost + Math.floor(_rnd(-2, 3)));
        const ident = _youthIdentity(team ? (team.srcLeague || team.leagueId) : null);
        const pl = {
            id: 'youth_' + season + '_' + (team ? team.id : 'x') + '_' + i + '_' + Math.floor(Math.random() * 9999),
            firstname: ident.firstname, lastname: ident.lastname, name: ident.name,
            position: pos, pos: pos, teamId: team ? team.id : null, age, height, weight,
            nation: ident.nation, foot: Math.random() < 0.78 ? 'Sağ' : 'Sol',
            weakFoot: 2 + Math.floor(Math.random() * 2), skillMoves: 1 + Math.floor(Math.random() * 3),
            attrs, isYouth: true, img: '',
        };
        recomputeMainStats(pl);
        pl.ovr = calculateOVR(pl);
        Object.assign(pl, rollCareerTraits(pl.ovr));    // gizli potansiyel
        prospects.push(pl);
    }
    return prospects;
}

// Altyapi oyuncularini bir sezon gelistir (yas+1, developPlayerSeason ile) — kulup altyapi tesisine gore.
function developClubYouth(arr, facility) {
    if (!Array.isArray(arr)) return [];
    for (const y of arr) {
        y.age = (y.age || 18) + 1;
        if (typeof developPlayerSeason === 'function') developPlayerSeason(y, facility || 60, 0.95);
        else y.ovr = Math.min(y.potential || 99, (y.ovr || 60) + 1);
    }
    return arr;
}

// ============================================================================
//  YAŞAYAN NPC GELİŞİMİ — deterministik, saklamasız ÖZELLİK gelişimi
//  Bir DB oyuncusunun başlangıç (EA) özelliklerinden bugüne her sezon nasıl
//  geliştiğini/gerilediğini yeniden kurar (yaş + potansiyel + KULÜP TESİSİ + oynama
//  payı + SAKATLIK/sekte). Tohum = careerSalt+playerId → her yerde aynı sonuç.
//  Final OVR dünya geneliyle (ageAdjustedOvr — squad/maç bununla) hizalanır.
//  Profil "Gelişim" sekmesi bunu kullanır → "hangi özellik ne kadar gelişti".
// ============================================================================
function _npcDevRng(pid, k) {
    const salt = (typeof gameState !== 'undefined' && gameState && gameState.careerSalt) ? (gameState.careerSalt >>> 0) : 1;
    let h = (Math.imul((Number(pid) || 0) >>> 0, 2654435761) >>> 0) ^ (Math.imul((k || 0) + 1, 40503) >>> 0) ^ salt;
    h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0;
    return (h >>> 0) / 4294967296;
}
// Stat grubu başına zirve yaşı: fiziksel erken, teknik/pas geç → gerçekçi DİVERjans.
const _GROUP_PEAK = { hiz: 25, fizik: 27, sut: 29, defans: 30, pas: 31, teknik: 31 };
function _mainsFromAttrs(attrs, pos) {
    const m = {};
    for (const g in ATTR_GROUPS) {
        const grp = (g === 'teknik' && pos === 'Kaleci') ? GK_ATTR_GROUP : ATTR_GROUPS[g];
        let s = 0, n = 0; for (const [k] of grp) { s += (attrs[k] || 0); n++; }
        m[g] = n ? Math.round(s / n) : 0;
    }
    return m;
}
function buildNpcDevHistory(pl, seasonsElapsed) {
    seasonsElapsed = Math.max(0, seasonsElapsed | 0);
    const startSeason = (typeof START_SEASON !== 'undefined') ? START_SEASON : 2026;
    const pos = pl.pos;
    const attrs = {}; for (const k in (pl.attrs || {})) attrs[k] = pl.attrs[k];
    const baseMains = _mainsFromAttrs(attrs, pos);
    const baseAge = pl.age || 24;
    const facility = (((typeof DB !== 'undefined' && DB.getTeam(pl.teamId)) || {}).facilities || {}).training || 65;
    const facB = 0.75 + facility / 130;                                   // ~0.75..1.5
    const pot = pl.potential || (pl.ovr + Math.max(0, 23 - baseAge) * 1.1);
    const ovrOf = a => (typeof calculateOVR === 'function') ? calculateOVR({ position: pos, attrs: a }) : (pl.ovr || 60);
    const curve = [{ season: startSeason, age: baseAge, ovr: ovrOf(attrs) }];
    const injuries = [];
    let curOvr = pl.ovr || 60;
    for (let i = 1; i <= seasonsElapsed; i++) {
        const age = baseAge + i, season = startSeason + i;
        const r1 = _npcDevRng(pl.id, season), r2 = _npcDevRng(pl.id, season * 7 + 13);
        const playF = 0.7 + Math.min(0.5, Math.max(0, (curOvr - 60) / 60)) + (r2 - 0.5) * 0.15;   // kaliteli oyuncu çok oynar → çok gelişir
        const injChance = 0.12 + (age > 31 ? 0.10 : 0) + (age > 34 ? 0.10 : 0);
        const injured = r1 < injChance;
        const injPen = injured ? (0.4 + r2 * 0.4) : 0;                    // sakat sezon → gelişim sekteye uğrar
        if (injured) injuries.push(season);
        const gap = Math.max(0, pot - curOvr);
        for (const g in ATTR_GROUPS) {
            const peak = _GROUP_PEAK[g] || 28;
            let delta;
            if (age < peak) { const yf = (peak - age) / Math.max(6, peak - 16); delta = (0.4 + yf * 1.7) * facB * playF * (gap / 16) * (1 - injPen); }
            else if (age <= peak + 1) delta = (r2 - 0.5) * 0.6;
            else { const d = age - peak; const dr = (g === 'hiz' || g === 'fizik') ? 0.9 : (g === 'pas' || g === 'teknik') ? 0.25 : 0.5; delta = -(0.3 + d * dr) - injPen * 0.6; }
            const grp = (g === 'teknik' && pos === 'Kaleci') ? GK_ATTR_GROUP : ATTR_GROUPS[g];
            for (const [k] of grp) attrs[k] = _clamp(Math.round((attrs[k] || 0) + delta), 20, 99);
        }
        curOvr = ovrOf(attrs);
        curve.push({ season, age, ovr: curOvr });
    }
    // Final OVR'ı dünya geneliyle hizala (ageAdjustedOvr) → profil başlığı squad/maçla aynı kalır.
    const target = (typeof ageAdjustedOvr === 'function') ? ageAdjustedOvr(pl, seasonsElapsed) : curOvr;
    let guard = 0, cur = ovrOf(attrs);
    while (Math.abs(cur - target) > 0.4 && guard++ < 40) {
        const sh = (target - cur);
        for (const k in attrs) attrs[k] = _clamp(Math.round(attrs[k] + sh), 20, 99);
        cur = ovrOf(attrs);
    }
    const shift = target - curve[curve.length - 1].ovr;
    curve.forEach(p => p.ovr = Math.max(40, Math.min(99, Math.round(p.ovr + shift))));
    return { attrs, mains: _mainsFromAttrs(attrs, pos), baseMains, ovr: target, curve, injuries, seasons: seasonsElapsed };
}

// ---- Sakatlik (hafif) ----
const INJURIES = [
    ['Kas zorlanması', 1, 2], ['Bilek burkulması', 2, 4], ['Hamstring sakatlığı', 3, 6],
    ['Diz darbesi', 1, 3], ['Ayak bileği incinmesi', 2, 5], ['Kasık sakatlığı', 3, 7],
    ['Adale yırtığı', 4, 8],
];
// energy 0..100, intensity 0.5..1.5 (mac yogunlugu). proneness>1 daha riskli.
function rollInjury(player, energy = 100, intensity = 1.0) {
    const prone = player.injuryProneness || 1.0;
    let chance = 0.025 * prone * intensity;
    if (energy < 40) chance += 0.03;
    else if (energy < 60) chance += 0.012;
    if ((player.age || 24) > 31) chance += 0.01;
    if (Math.random() > chance) return null;
    const inj = INJURIES[Math.floor(Math.random() * INJURIES.length)];
    return { name: inj[0], weeks: Math.floor(_rnd(inj[1], inj[2] + 1)) };
}

// ---- Emeklilik onerisi ----
function retirementRecommendation(player) {
    const age = player.age || 30;
    if (age >= 40) return { retire: true, reason: 'Yaş ilerledi' };
    if (age >= RETIRE_AGE) {
        // dusuk OVR/form -> erken birak; cok iyi -> devam
        if (player.ovr < 68 || (player.form || 60) < 45) return { retire: true, reason: 'Form/seviye düştü' };
        if (player.ovr >= 80 && age < 39) return { retire: false, reason: 'Hâlâ üst seviye' };
        return { retire: Math.random() < (age - RETIRE_AGE + 1) * 0.28, reason: 'Yaş' };
    }
    return { retire: false, reason: '' };
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        rollCareerTraits, developPlayerSeason, ageAdjustedOvr,
        generateYouthProspects, developClubYouth, rollInjury, retirementRecommendation, INJURIES,
    });
}
