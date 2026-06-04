// ============================================================================
//  40-match.js  —  Gercek kadrodan dizilis + fotograf + YEDEK KULUBESI +
//  canli kondisyon + mac ici oyuncu degisikligi.
// ============================================================================

// slot (eski makro key) -> uyumlu gercek-pozisyon aileleri
const SLOT_FAMS = {
    'Kaleci': ['GK'], 'Stoper': ['CB'], 'Bek': ['FB'],
    'DOS': ['DM', 'CM'], 'Merkez OS': ['CM', 'AM', 'DM'], 'Ofansif OS': ['AM', 'WM', 'CM'],
    'Kanat': ['W', 'WM'], 'Santrfor': ['ST'],
};
// pozisyon ailesi -> yedek/kart icin kisa slot etiketi
const FAM_LABEL = { GK: 'KL', CB: 'STP', FB: 'BEK', DM: 'DOS', CM: 'MÖ', AM: 'OOS', WM: 'KAN', W: 'KAN', ST: 'SNT' };
function _famLabel(pos) { return FAM_LABEL[posFamily(pos)] || 'MÖ'; }

function _slotMatches(slotKey, playerPos) {
    return (SLOT_FAMS[slotKey] || []).includes(posFamily(playerPos));
}

// ---- B2: Mevki yakinlik matrisi (0..1). 1=birebir, 0=oynayamaz ----
const FAM_AFFINITY = {
    GK: { GK: 1 },
    CB: { CB: 1, FB: 0.55, DM: 0.45 },
    FB: { FB: 1, WM: 0.6, CB: 0.5, W: 0.4, DM: 0.35 },
    DM: { DM: 1, CM: 0.8, CB: 0.5 },
    CM: { CM: 1, DM: 0.8, AM: 0.75 },
    AM: { AM: 1, CM: 0.75, WM: 0.6, W: 0.55, ST: 0.45 },
    WM: { WM: 1, W: 0.85, AM: 0.6, FB: 0.5 },
    W: { W: 1, WM: 0.85, AM: 0.55, ST: 0.55 },
    ST: { ST: 1, W: 0.55, AM: 0.45 },
};
// Bir SQUAD_SLOTS slotu, bir oyuncu pozisyonu icin ne kadar uygun (0..1)
function _slotAffinity(slotKey, playerPos) {
    const fams = SLOT_FAMS[slotKey] || [];
    const pf = posFamily(playerPos);
    let best = 0;
    for (const sf of fams) { const a = (FAM_AFFINITY[sf] || {})[pf] || 0; if (a > best) best = a; }
    return best;
}
// İki SLOT arası uygunluk (0..1) — XI oyuncuları .position'da SLOT anahtarı taşır
// (gerçek pozisyon değil); slot-slot karşılaştırma için aile listelerini kullan.
function _slotToSlotAffinity(targetSlot, playerSlot) {
    const tf = SLOT_FAMS[targetSlot] || [];
    const pf = SLOT_FAMS[playerSlot] || [posFamily(playerSlot)];
    let best = 0;
    for (const t of tf) for (const pfam of pf) { const a = (FAM_AFFINITY[t] || {})[pfam] || 0; if (a > best) best = a; }
    return best;
}
// Kullanicinin mevkisi icin en uygun SQUAD_SLOTS anahtari
function _userSlotKey(pos) {
    let best = null, bestA = -1;
    SQUAD_SLOTS.forEach(s => { const a = _slotAffinity(s.key, pos); if (a > bestA) { bestA = a; best = s.key; } });
    return best || 'Santrfor';
}
// Bu maca ozel deterministik RNG (maca/sezona gore cesitli, ama tutarli)
function _matchRng(extra) {
    const p = gameState.player;
    const salt = (gameState.careerSalt != null ? gameState.careerSalt : 12345);
    const key = salt + ':' + (p && p.id != null ? p.id : 'USER') + ':' + gameState.currentSeason + ':' + gameState.currentWeek + ':' + (activeMatch && activeMatch.isCup ? 'C' : 'L') + ':' + (extra || '');
    if (typeof _detRng === 'function') return _detRng(key);
    let s = 0; for (let i = 0; i < key.length; i++) s = (s * 31 + key.charCodeAt(i)) >>> 0;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// ---- B1/B4: Kullanicinin bu mactaki statusune karar ver ----
// Donus: { status:'starting'|'bench'|'excluded', reason, entryMinute? }
function decideUserMatchStatus(myTeamId, oppPower, isCup) {
    const p = gameState.player;
    const seasons = (gameState.currentSeason || START_SEASON) - START_SEASON;
    const trust = p.managerTrust != null ? p.managerTrust : 60;
    const rng = _matchRng('status');

    const squad = myTeamId ? DB.squadSync(myTeamId).filter(pl => pl.id !== p.id) : [];
    const slotKey = _userSlotKey(p.position);
    const rivals = squad
        .filter(pl => _slotAffinity(slotKey, pl.pos) >= 0.6)
        .map(pl => ageAdjustedOvr(pl, seasons))
        .sort((a, b) => b - a);
    const betterRivals = rivals.filter(r => r >= p.ovr + 2).length;

    let startScore = trust;
    startScore -= betterRivals * 18;
    startScore += Math.max(-15, (p.ovr - (rivals[0] || p.ovr)) * 1.5);
    if (isCup) startScore += 20;                       // kupada rotasyon -> oynama sansi artar
    if (oppPower != null) {
        const teamPower = (getTeamById(myTeamId) || {}).power || 70;
        if (oppPower <= teamPower - 8) startScore += 10;   // zayif rakip -> rotasyon
    }
    // rotasyon dengesi: ust uste yedek kaldiysa sans artsin
    const benched = p.seasonBenched || 0, starts = p.seasonStarts || 0;
    if (benched - starts >= 2) startScore += 12;
    if (starts - benched >= 4) startScore -= 8;

    const noise = (rng() - 0.5) * 18;
    const s = startScore + noise;

    if (!isCup && trust < 25 && s < 18) return { status: 'excluded', reason: 'guvensizlik' };
    if (s >= 50) return { status: 'starting', reason: null };

    let entry;
    if (s >= 34) entry = 55 + Math.floor(rng() * 12);          // 55-66
    else if (s >= 22) entry = 66 + Math.floor(rng() * 16);     // 66-81
    else entry = rng() < 0.5 ? 76 + Math.floor(rng() * 11) : null;  // bazen hic girmez
    return { status: 'bench', reason: betterRivals > 0 ? 'rotasyon' : 'forma', entryMinute: entry };
}
function _shortName(full) {
    if (!full) return '—';
    const parts = full.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return parts[0][0] + '. ' + parts.slice(1).join(' ');
}
function _photoHtml(img, fallbackLabel, size, color) {
    if (img) return `<img src="${img}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;background:#222;vertical-align:middle;" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';"><span style="display:none;width:${size}px;height:${size}px;border-radius:50%;background:${color || '#444'};color:#fff;font-size:${size * 0.4}px;font-weight:700;align-items:center;justify-content:center;vertical-align:middle;">${fallbackLabel}</span>`;
    return `<span style="display:inline-flex;width:${size}px;height:${size}px;border-radius:50%;background:${color || '#444'};color:#fff;font-size:${size * 0.4}px;font-weight:700;align-items:center;justify-content:center;vertical-align:middle;">${fallbackLabel}</span>`;
}

// Baslangic kondisyonu: OVR ve yas ile hafif degisken (88..100)
function _startCondition(ovr) {
    return Math.max(82, Math.min(100, Math.round(92 + (ovr - 75) * 0.15 + (Math.random() * 8 - 4))));
}

// Bir takimin gercek kadrosundan en iyi 11 + yedek kulubesi (B2: affinity-bazli yerlesim)
function _buildXI(squad, seasonsElapsed, fallbackPower, userPlayer) {
    const pool = (squad || []).map(pl => ({ ...pl, _ovr: ageAdjustedOvr(pl, seasonsElapsed) }))
        .sort((a, b) => b._ovr - a._ovr);
    const used = new Set();
    const xi = new Array(SQUAD_SLOTS.length).fill(null);

    // 1) Kullanici varsa: mevkisine en uygun slotu ona ayir (santrfor -> kanat/OOS de olabilir)
    if (userPlayer) {
        let bestSlot = -1, bestA = -1;
        SQUAD_SLOTS.forEach((s, i) => { const a = _slotAffinity(s.key, userPlayer.position); if (a > bestA) { bestA = a; bestSlot = i; } });
        if (bestSlot < 0) bestSlot = SQUAD_SLOTS.length - 1;
        const slot = SQUAD_SLOTS[bestSlot];
        xi[bestSlot] = {
            name: `${userPlayer.firstname ? userPlayer.firstname[0] + '. ' : ''}${userPlayer.lastname || userPlayer.name}`,
            position: slot.key, label: slot.label, ovr: userPlayer.ovr, matchRating: 6.0,
            isUser: true, img: userPlayer.img || '',
            condition: Math.round(userPlayer.energy != null ? userPlayer.energy : 100),
            goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: userPlayer.id || 'USER',
        };
    }

    // 2) Kaleci slotunu once doldur, sonra digerleri; her slot icin ovr*affinity en yuksek aday
    const order = SQUAD_SLOTS.map((s, i) => i).sort((a, b) =>
        (SQUAD_SLOTS[a].key === 'Kaleci' ? 0 : 1) - (SQUAD_SLOTS[b].key === 'Kaleci' ? 0 : 1));
    order.forEach(i => {
        if (xi[i]) return;                       // kullanici slotu
        const slot = SQUAD_SLOTS[i];
        let pick = null, pickScore = -1;
        for (const pl of pool) {
            if (used.has(pl.id)) continue;
            const aff = _slotAffinity(slot.key, pl.pos);
            if (slot.key === 'Kaleci' && aff <= 0) continue;   // kaleci slotuna kaleci olmayani koyma
            const sc = pl._ovr * (0.35 + 0.65 * Math.max(aff, 0.05));
            if (sc > pickScore) { pickScore = sc; pick = pl; }
        }
        if (pick) {
            used.add(pick.id);
            xi[i] = {
                name: _shortName(pick.name), position: slot.key, label: slot.label,
                ovr: pick._ovr, matchRating: 6.0 + (Math.random() * 0.4 - 0.2),
                isUser: false, img: pick.img || '', condition: _startCondition(pick._ovr),
                goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: pick.id,
            };
        } else {
            const f = generateFictionalPlayer(slot.key, fallbackPower);
            xi[i] = { ...f, label: slot.label, isUser: false, img: '', condition: _startCondition(f.ovr), pid: 'fic_' + i };
        }
    });
    return { xi, usedIds: used, pool };
}

// XI'da kullanilmayan en iyi 7 oyuncudan yedek kulubesi (en az 1 kaleci)
function _buildBench(pool, usedIds, seasonsElapsed) {
    const bench = [];
    const avail = pool.filter(pl => !usedIds.has(pl.id));
    const gk = avail.find(pl => posFamily(pl.pos) === 'GK');
    const pushBench = (pl) => {
        usedIds.add(pl.id);
        bench.push({
            name: _shortName(pl.name), position: pl.pos, label: _famLabel(pl.pos),
            ovr: pl._ovr, matchRating: 6.0, isUser: false, img: pl.img || '',
            condition: 100, goals: 0, assists: 0, saves: 0, yellow: false, red: false,
            pid: pl.id, fam: posFamily(pl.pos),
        });
    };
    if (gk) pushBench(gk);
    for (const pl of avail) { if (bench.length >= 7) break; if (usedIds.has(pl.id)) continue; pushBench(pl); }
    return bench;
}

function generateMatchLineups(myTeamPower, oppTeamPower) {
    const p = gameState.player;
    const seasons = (gameState.currentSeason || START_SEASON) - START_SEASON;
    matchLineups.myFormation = '4-2-3-1';
    matchLineups.oppFormation = '4-2-3-1';
    const myId = activeMatch.myTeam && activeMatch.myTeam.id !== 'FREE' ? activeMatch.myTeam.id : null;
    const oppId = activeMatch.oppTeam ? activeMatch.oppTeam.id : null;
    // Yetersiz kadrolu kuluplere seviyeye uygun dolgu oyuncu ekle (squadSync bunlari da dondurur)
    try { if (typeof fillSquadIfNeeded === 'function') { if (myId) fillSquadIfNeeded(myId); if (oppId) fillSquadIfNeeded(oppId); } } catch (e) { console.warn(e); }
    const mySquad = myId ? DB.squadSync(myId).filter(pl => !p || pl.id !== p.id) : [];
    const oppSquad = oppId ? DB.squadSync(oppId) : [];
    // Kullanici yalniz 'starting' ise ilk 11'e; yedek/kadro-disi ise XI'da yer almaz (sonradan girer)
    const userForXI = (activeMatch.playerStatus === 'starting') ? p : null;
    const my = _buildXI(mySquad, seasons, myTeamPower, userForXI);
    const opp = _buildXI(oppSquad, seasons, oppTeamPower, null);
    matchLineups.myTeam = my.xi;
    matchLineups.oppTeam = opp.xi;
    matchLineups.myBench = _buildBench(my.pool, my.usedIds, seasons);
    matchLineups.oppBench = _buildBench(opp.pool, opp.usedIds, seasons);
    // Kullanıcı YEDEKTE başlıyorsa: yedek kulübesinde KENDİSİ de görünsün (hoca ilerleyen
    // dakikalarda alabilir). 'excluded' (kadro dışı) ise kulübede de yer almaz.
    if (p && activeMatch.playerStatus === 'bench') {
        matchLineups.myBench.unshift({
            name: `${p.firstname ? p.firstname[0] + '. ' : ''}${p.lastname || p.name}`,
            position: p.position, label: _famLabel(p.position), ovr: p.ovr, matchRating: 6.0,
            isUser: true, img: p.img || '', condition: Math.round(p.energy != null ? p.energy : 100),
            goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: p.id || 'USER', fam: posFamily(p.position),
        });
    }
    // mac ici degisiklik sayaclari (her takim 5)
    activeMatch.mySubsLeft = 5;
    activeMatch.oppSubsLeft = 5;
    activeMatch.subLog = [];
}

// ---- Kondisyon rengi ----
function _condColor(c) { return c >= 70 ? '#00e676' : c >= 45 ? '#ffca28' : c >= 25 ? '#ff9800' : '#ef5350'; }
function _condBar(c) {
    c = Math.max(0, Math.min(100, Math.round(c)));
    return `<span class="l-cond" title="Kondisyon %${c}"><span class="l-cond-fill" style="width:${c}%;background:${_condColor(c)};"></span></span>`;
}

// A5: Diziliste oyuncuya tiklayinca profil ac (gercek oyuncular icin)
function _bindLineupClick(row, player, isMy) {
    const pid = player.pid;
    if (player.isUser || !pid || pid === 'USER' || String(pid).startsWith('fic_') || String(pid).startsWith('gen_')) return;
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
        const teamId = isMy ? (activeMatch.myTeam && activeMatch.myTeam.id) : (activeMatch.oppTeam && activeMatch.oppTeam.id);
        if (typeof openPlayerProfile === 'function') openPlayerProfile(pid, teamId);
    });
}

// ---- Render: liste (gercek foto + isim + canli kondisyon) + yedek kulubesi ----
function renderMatchLineups() {
    const list = document.getElementById('match-lineup-players-list');
    const subtitle = document.getElementById('match-lineup-subtitle');
    if (!list || !subtitle) return;
    const isMy = matchLineups.currentTab === 'myteam';
    const squad = isMy ? matchLineups.myTeam : matchLineups.oppTeam;
    const bench = (isMy ? matchLineups.myBench : matchLineups.oppBench) || [];
    const subsLeft = isMy ? activeMatch.mySubsLeft : activeMatch.oppSubsLeft;
    const formation = isMy ? matchLineups.myFormation : matchLineups.oppFormation;
    subtitle.textContent = `Diziliş: ${formation}`;
    list.innerHTML = '';

    squad.forEach(player => {
        const row = document.createElement('div');
        row.className = `lineup-player-row ${player.isUser ? 'user-highlight' : ''}${player.subbedOut ? ' subbed-off' : ''}`;
        const rating = player.isUser ? activeMatch.playerStats.rating : player.matchRating;
        let ratingClass = rating >= 7.5 ? 'high' : rating <= 5.8 ? 'low' : '';
        const cond = player.isUser ? Math.round(gameState.player.energy) : player.condition;
        const st = player.isUser ? {
            goals: activeMatch.playerStats.goals, assists: activeMatch.playerStats.assists,
            saves: activeMatch.playerStats.saves, yellow: activeMatch.playerStats.yellow,
        } : player;
        let ev = '';
        if (st.goals > 0) ev += `<i class="fa-solid fa-futbol goal-icon"></i>`.repeat(st.goals);
        if (st.assists > 0) ev += ` <i class="fa-solid fa-handshake-angle text-info"></i>`.repeat(st.assists);
        if (st.saves > 0) ev += ` <i class="fa-solid fa-hand-fist text-warning"></i>`.repeat(st.saves);
        if (st.yellow) ev += ` <i class="fa-solid fa-square-full card-icon"></i>`;
        if (player.subbedIn) ev += ` <i class="fa-solid fa-arrow-up text-success" title="Oyuna girdi"></i>`;
        const posClass = `pos-${(player.label || '').toLowerCase()}`;
        row.innerHTML = `
            <div class="l-player-info" style="display:flex;align-items:center;gap:8px;">
                <span class="l-player-pos ${posClass}">${player.label}</span>
                ${_photoHtml(player.img, player.label, 26, '#555')}
                <span class="l-player-name">${player.name} (${player.ovr})</span>
            </div>
            <div class="l-player-stats" style="display:flex;align-items:center;gap:8px;">
                ${_condBar(cond)}
                <span class="l-player-events">${ev}</span>
                <span class="l-player-rating ${ratingClass}">${rating.toFixed(1)}</span>
            </div>`;
        _bindLineupClick(row, player, isMy);
        list.appendChild(row);
    });

    // Yedek kulubesi
    const benchWrap = document.createElement('div');
    benchWrap.className = 'lineup-bench';
    benchWrap.innerHTML = `<div class="lineup-bench-head"><i class="fa-solid fa-chair"></i> Yedek Kulübesi
        <span class="bench-subs-left">Değişiklik hakkı: ${subsLeft != null ? subsLeft : 5}</span></div>`;
    bench.forEach(pl => {
        const r = document.createElement('div');
        r.className = `lineup-player-row bench-row${pl.subbedOut ? ' subbed-off' : ''}${pl.isUser ? ' user-highlight' : ''}`;
        const offMark = pl.subbedOut ? ` <i class="fa-solid fa-arrow-down-long" style="color:#ef5350;" title="Oyundan çıktı${pl.subbedOutMin != null ? ' ' + pl.subbedOutMin + "'" : ''}"></i>` : '';
        const userTag = pl.isUser ? ` <span style="color:var(--accent);font-size:.7rem;">(Sen)</span>` : '';
        r.innerHTML = `
            <div class="l-player-info" style="display:flex;align-items:center;gap:8px;">
                <span class="l-player-pos pos-${(pl.label || '').toLowerCase()}">${pl.label}</span>
                ${_photoHtml(pl.img, pl.label, 22, '#444')}
                <span class="l-player-name">${pl.name} (${pl.ovr})${userTag}${offMark}</span>
            </div>
            <div class="l-player-stats">${_condBar(pl.condition)}</div>`;
        _bindLineupClick(r, pl, isMy);
        benchWrap.appendChild(r);
    });
    list.appendChild(benchWrap);

    const pitchView = document.getElementById('match-lineup-pitch');
    if (pitchView && pitchView.style.display === 'block') renderMatchLineupPitch();
}

// ============================================================================
//  Mac ici: kondisyon dususu + hocanin otomatik degisiklikleri
// ============================================================================
function _decayCondition(squad, minDiff, effort) {
    const mul = effort === 'high' ? 1.5 : effort === 'low' ? 0.6 : 1.0;
    squad.forEach(pl => {
        if (pl.isUser) return;  // kullanicinin kondisyonu = energy (ayrica isleniyor)
        const base = 0.42 * minDiff * mul * (0.7 + Math.random() * 0.7);
        const stamFactor = 1.15 - ((pl.ovr || 70) - 60) / 200;   // iyi oyuncu biraz daha dayanikli
        pl.condition = Math.max(8, pl.condition - base * stamFactor);
    });
}

// Bir takimda outIdx'teki oyuncuyu en uygun (affinity) yedekle degistir
// FAZ A: yeni giren oyuncu, en az bu kadar dk sahada kalmadan PERFORMANS gerekçesiyle alınamaz
// (sakatlık/kırmızı kart hariç → onlar _doSub'u doğrudan çağırır, bu filtreden geçmez).
const MIN_MIN_ON_PITCH = 20;

function _doSub(teamKey, outIdx, minute, emergencyOk) {
    const isMy = teamKey === 'MY';
    const xi = isMy ? matchLineups.myTeam : matchLineups.oppTeam;
    const bench = isMy ? matchLineups.myBench : matchLineups.oppBench;
    if (!bench || !bench.length) return false;
    const outP = xi[outIdx];
    if (!outP || outP.isUser || outP.subbedOut) return false;
    const outIsGK = posFamily(outP.position) === 'GK';
    // gelen: yalnız OYNAYABİLİR yedek; affinity>0 ŞART + KALECİ KURALI:
    // GK slotuna yalnız GK, outfield slotuna asla GK girmez (kaleci yalnız kalede oynar).
    let inIdx = -1, inA = 0;
    bench.forEach((b, k) => {
        if (b.subbedOut || b.isUser) return;
        if ((posFamily(b.position) === 'GK') !== outIsGK) return;   // GK ↔ GK, outfield ↔ outfield
        const a = _slotAffinity(outP.position, b.position);
        if (a > inA) { inA = a; inIdx = k; }
    });
    if (inIdx < 0) {
        // uygun yedek yok → ACİL POZİSYON KAYDIRMA (yalnız outfield; kalecide yapılmaz)
        if (emergencyOk !== false && !outIsGK) return _emergencyShift(teamKey, outIdx, minute);
        return false;
    }
    const inP = bench.splice(inIdx, 1)[0];
    xi[outIdx] = {
        name: inP.name, position: outP.position, label: outP.label, ovr: inP.ovr,
        matchRating: Math.max(6.0, (outP.matchRating + 6.0) / 2), isUser: false, img: inP.img,
        condition: inP.condition, goals: 0, assists: 0, saves: 0, yellow: false, red: false,
        pid: inP.pid, subbedIn: true, enteredMin: minute,
    };
    // çıkan oyuncu KAYBOLMASIN: yedek kulübesinde soluk + değişiklik oku ile kalsın
    bench.push({ ...outP, subbedOut: true, subbedOutMin: minute });
    if (isMy) activeMatch.mySubsLeft--; else activeMatch.oppSubsLeft--;
    const teamName = isMy ? (activeMatch.myTeam.name) : (activeMatch.oppTeam.name);
    if (!activeMatch.subLog) activeMatch.subLog = [];
    activeMatch.subLog.push({ minute, team: teamKey, outName: outP.name, inName: inP.name });
    if (typeof addCommentary === 'function')
        addCommentary(minute, `<strong>[DEĞİŞİKLİK — ${teamName}]</strong> ${outP.name} oyundan çıkıyor, yerine ${inP.name} giriyor.`, 'info');
    if (typeof pushMatchEvent === 'function') pushMatchEvent({ minute, type: 'sub', team: teamKey, subIn: inP.name, subOut: outP.name });
    return true;
}

// FAZ A: ACİL POZİSYON KAYDIRMA — outIdx'teki oyuncu çıkacak ama slotuna UYGUN yedek yok
// (ör. tüm forvetler gitti). Kaleciyi forvete koymak yerine: sahadaki EN UYGUN outfield
// oyuncuyu (en yüksek affinity → genelde kanat/bek) o slota KAYDIR, onun boşalttığı slota
// yedekten oyuncu al. 11 kişi korunur, mevkiler mantıklı kalır.
function _emergencyShift(teamKey, outIdx, minute) {
    const isMy = teamKey === 'MY';
    const xi = isMy ? matchLineups.myTeam : matchLineups.oppTeam;
    const bench = isMy ? matchLineups.myBench : matchLineups.oppBench;
    if (!bench || !bench.length) return false;
    const outP = xi[outIdx];
    // 1) sahada outP slotunu en iyi kapatabilecek oyuncu (GK/çıkmış/kullanıcı hariç).
    //    XI oyuncuları slot-anahtarı taşır → slot-slot affinity kullan (kanat→ST doğru değerlenir).
    let moverIdx = -1, moverA = 0;
    xi.forEach((pl, i) => {
        if (i === outIdx || pl.subbedOut || pl.isUser || posFamily(pl.position) === 'GK') return;
        const a = _slotToSlotAffinity(outP.position, pl.position);
        if (a > moverA) { moverA = a; moverIdx = i; }
    });
    if (moverIdx < 0) return false;   // kimse kapatamıyor → 10 kişi (üst katman halleder)
    const mover = xi[moverIdx];
    // 2) mover'ın boşalttığı slota yedekten outfield oyuncu — önce afinitesi yüksek;
    //    yoksa (gerçek acil durum) AFİNİTESİ olmayan ama outfield HERHANGİ bir yedek (10 kişiden iyi).
    let inIdx = -1, inA = 0;
    bench.forEach((b, k) => {
        if (b.subbedOut || b.isUser || posFamily(b.position) === 'GK') return;
        const a = _slotAffinity(mover.position, b.position);
        if (a > inA) { inA = a; inIdx = k; }
    });
    if (inIdx < 0) inIdx = bench.findIndex(b => !b.subbedOut && !b.isUser && posFamily(b.position) !== 'GK');
    if (inIdx < 0) return false;      // hiç outfield yedek yok → 10 kişi
    const inP = bench.splice(inIdx, 1)[0];
    const movedFromPos = mover.position, movedFromLabel = mover.label;
    // mover'ı outP slotuna taşı (aynı oyuncu, yeni slot)
    xi[outIdx] = Object.assign({}, mover, { position: outP.position, label: outP.label });
    // mover'ın eski slotuna gelen yedek
    xi[moverIdx] = {
        name: inP.name, position: movedFromPos, label: movedFromLabel, ovr: inP.ovr,
        matchRating: 6.0, isUser: false, img: inP.img, condition: inP.condition,
        goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: inP.pid, subbedIn: true, enteredMin: minute,
    };
    bench.push({ ...outP, subbedOut: true, subbedOutMin: minute });
    if (isMy) activeMatch.mySubsLeft--; else activeMatch.oppSubsLeft--;
    const teamName = isMy ? activeMatch.myTeam.name : activeMatch.oppTeam.name;
    if (!activeMatch.subLog) activeMatch.subLog = [];
    activeMatch.subLog.push({ minute, team: teamKey, outName: outP.name, inName: inP.name, shift: true });
    if (typeof addCommentary === 'function')
        addCommentary(minute, `<strong>[ZORUNLU DEĞİŞİKLİK — ${teamName}]</strong> ${outP.name} çıktı; ${mover.name} ${outP.label} mevkisine kaydı, yerine ${inP.name} girdi.`, 'info');
    if (typeof pushMatchEvent === 'function') pushMatchEvent({ minute, type: 'sub', team: teamKey, subIn: inP.name, subOut: outP.name });
    return true;
}

// B3: Akilli hoca degisiklikleri — skor + kondisyon + performans + dakika (2-4 mantikli sub)
function _autoSubsForTeam(teamKey, minute) {
    const isMy = teamKey === 'MY';
    const xi = isMy ? matchLineups.myTeam : matchLineups.oppTeam;
    const bench = isMy ? matchLineups.myBench : matchLineups.oppBench;
    const subsLeft = isMy ? activeMatch.mySubsLeft : activeMatch.oppSubsLeft;
    if (subsLeft <= 0 || minute < 46 || !bench || !bench.length) return;

    // bu takimin skor farki
    const myHome = activeMatch.isHome;
    const ourScore = isMy ? (myHome ? activeMatch.scoreHome : activeMatch.scoreAway) : (myHome ? activeMatch.scoreAway : activeMatch.scoreHome);
    const oppScore = isMy ? (myHome ? activeMatch.scoreAway : activeMatch.scoreHome) : (myHome ? activeMatch.scoreHome : activeMatch.scoreAway);
    const diff = ourScore - oppScore;

    const used = 5 - subsLeft;
    if (used >= 4) return;                     // 4'ten fazlasi cok nadir
    if (used >= 2 && minute < 60) return;      // erken 2'den fazla yapma

    const cands = [];
    xi.forEach((pl, i) => {
        if (pl.isUser || pl.subbedOut) return;
        if (posFamily(pl.position) === 'GK') return;   // kaleci performans gerekçesiyle alınmaz (yalnız sakatlık/kırmızı)
        // FAZ A: yeni giren oyuncu, MIN_MIN_ON_PITCH dolmadan PERFORMANS subuyla tekrar alınamaz
        // (70'te girip 72'de çıkma / 2dk giriş-çıkış döngüsü engellenir).
        if (pl.subbedIn && pl.enteredMin != null && (minute - pl.enteredMin) < MIN_MIN_ON_PITCH) return;
        let need = 0;
        if (pl.condition < 45) need += (45 - pl.condition) * 0.8;
        if (minute >= 60 && pl.matchRating < 5.8) need += (5.8 - pl.matchRating) * 8;
        const fam = posFamily(pl.position);
        if (diff < 0 && minute >= 60 && (fam === 'CB' || fam === 'DM')) need *= 0.7;   // geride savunmaci cikarma
        if (diff > 0 && minute >= 70 && (fam === 'W' || fam === 'ST' || fam === 'AM')) need += 6; // ondeysek hucumcu dinlendir
        if (need > 0) cands.push({ i, need });
    });
    if (!cands.length) return;
    cands.sort((a, b) => b.need - a.need);
    const top = cands[0];
    const urgent = xi[top.i].condition < 25 || top.need > 30;
    let prob = urgent ? 0.7 : 0.18 + (minute - 46) * 0.006 + Math.min(0.25, top.need * 0.01);
    if (Math.random() < prob) _doSub(teamKey, top.i, minute);
}

// runMatchTicker her dakika ilerlemesinde cagirir
function onMatchTick(minDiff, minute) {
    if (!matchLineups.myTeam || !matchLineups.myTeam.length) return;
    _decayCondition(matchLineups.myTeam, minDiff, activeMatch.effortLevel);
    _decayCondition(matchLineups.oppTeam, minDiff, 'normal');
    _autoSubsForTeam('MY', minute);
    _autoSubsForTeam('OPP', minute);
    // A10: nadir sakatlik (kullanici haric, gorsel + zorunlu degisiklik)
    if (minute > 10 && Math.random() < 0.004 * Math.max(1, minDiff)) {
        const team = Math.random() < 0.5 ? 'MY' : 'OPP';
        const xi = team === 'MY' ? matchLineups.myTeam : matchLineups.oppTeam;
        const cand = xi.filter(pl => !pl.isUser && !pl.subbedOut);
        if (cand.length) {
            const inj = cand[Math.floor(Math.random() * cand.length)];
            const idx = xi.indexOf(inj);
            if (typeof pushMatchEvent === 'function') pushMatchEvent({ minute, type: 'injury', team, playerName: inj.name });
            if (typeof addCommentary === 'function') addCommentary(minute, `<strong>[SAKATLIK]</strong> ${inj.name} sakatlandı.`, 'card');
            const left = team === 'MY' ? activeMatch.mySubsLeft : activeMatch.oppSubsLeft;
            if (idx >= 0 && left > 0) { if (!_doSub(team, idx, minute)) inj.subbedOut = true; }
            else if (idx >= 0) inj.subbedOut = true;   // hak/yedek yoksa 10 kisi
        }
    }
}

// B4/A7: Yedek kullaniciyi XI'a gercek bir oyuncu cikararak sok
function _subUserIntoXI(minute) {
    const xi = matchLineups.myTeam;
    if (xi.some(pl => pl.isUser)) return;
    const p = gameState.player;
    let outIdx = -1, worst = Infinity;
    xi.forEach((pl, i) => {
        if (pl.isUser || pl.subbedOut) return;
        const aff = _slotAffinity(pl.position, p.position);
        const score = pl.condition + pl.matchRating * 4 - aff * 25;   // benzer mevki + zayif oyuncu tercih
        if (score < worst) { worst = score; outIdx = i; }
    });
    if (outIdx < 0) outIdx = xi.findIndex(pl => !pl.isUser);
    if (outIdx < 0) return;
    const outP = xi[outIdx];
    xi[outIdx] = {
        name: `${p.firstname ? p.firstname[0] + '. ' : ''}${p.lastname || p.name}`,
        position: outP.position, label: outP.label, ovr: p.ovr,
        matchRating: activeMatch.playerStats.rating, isUser: true, img: p.img || '',
        condition: Math.round(p.energy), goals: 0, assists: 0, saves: 0, yellow: false, red: false,
        pid: p.id || 'USER', subbedIn: true, enteredMin: minute,
    };
    if (activeMatch.mySubsLeft != null && activeMatch.mySubsLeft > 0) activeMatch.mySubsLeft--;
    // kullanıcının yedek kulübesindeki DISPLAY kaydını kaldır (artık sahada) + çıkan oyuncu soluk kalsın
    if (matchLineups.myBench) {
        const bi = matchLineups.myBench.findIndex(b => b.isUser);
        if (bi >= 0) matchLineups.myBench.splice(bi, 1);
        matchLineups.myBench.push({ ...outP, subbedOut: true, subbedOutMin: minute });
    }
    if (!activeMatch.subLog) activeMatch.subLog = [];
    activeMatch.subLog.push({ minute, team: 'MY', outName: outP.name, inName: `${p.firstname} ${p.lastname}` });
    if (typeof pushMatchEvent === 'function') pushMatchEvent({ minute, type: 'sub', team: 'MY', subIn: `${p.firstname} ${p.lastname}`, subOut: outP.name });
    if (typeof renderMatchLineups === 'function') renderMatchLineups();
}

// Kullanici oyundan cikinca yerine yedek al (gorsel olarak 11'i koru)
function _subInForUser(minute) {
    const xi = matchLineups.myTeam;
    const idx = xi.findIndex(pl => pl.isUser);
    if (idx < 0) return;
    const bench = matchLineups.myBench || [];
    const outP = xi[idx];
    // gelen: yalnız OYNAYABİLİR yedek (oyundan çıkmış/kullanıcı-display hariç), mevkiye uygun
    let inIdx = bench.findIndex(b => !b.subbedOut && !b.isUser && _slotMatches(outP.position, b.position));
    if (inIdx < 0) inIdx = bench.findIndex(b => !b.subbedOut && !b.isUser);
    if (inIdx < 0) { outP.subbedOut = true; if (typeof renderMatchLineups === 'function') renderMatchLineups(); return; }   // yedek yok → 10 kişi
    const inP = bench.splice(inIdx, 1)[0];
    xi[idx] = {
        name: inP.name, position: outP.position, label: outP.label, ovr: inP.ovr,
        matchRating: 6.0, isUser: false, img: inP.img, condition: inP.condition,
        goals: 0, assists: 0, saves: 0, yellow: false, red: false, pid: inP.pid, subbedIn: true, enteredMin: minute,
    };
    // kullanıcı KAYBOLMASIN: yedek kulübesinde soluk + değişiklik oku ile kalsın
    bench.push({ ...outP, isUser: true, subbedOut: true, subbedOutMin: minute });
    if (activeMatch.mySubsLeft != null) activeMatch.mySubsLeft--;
    if (typeof renderMatchLineups === 'function') renderMatchLineups();
}

// ---- Takim kadrosu modali: gercek kadro ----
function showTeamRosterModal(teamId) {
    const team = getTeamById(teamId);
    if (!team) return;
    const modal = document.getElementById('team-roster-modal');
    const bodyEl = document.getElementById('roster-modal-body');
    if (!modal || !bodyEl) return;
    document.getElementById('roster-modal-team-name').textContent = team.name;
    const pw = document.getElementById('roster-modal-team-power'); if (pw) pw.textContent = team.power;
    const pr = document.getElementById('roster-modal-team-prestige');
    if (pr) { pr.textContent = '★'.repeat(team.prestige) + '☆'.repeat(5 - team.prestige); pr.style.color = '#ffca28'; }

    const seasons = (gameState.currentSeason || START_SEASON) - START_SEASON;
    const p = gameState.player;
    let squad = DB.squadSync(teamId).map(pl => ({
        name: _shortName(pl.name), pos: pl.pos, ovr: ageAdjustedOvr(pl, seasons),
        img: pl.img, age: (pl.age || 0) + seasons, isUser: false, id: pl.id,
    }));
    if (p && p.teamId === teamId) {
        squad.push({ name: `${p.firstname} ${p.lastname}`, pos: p.position, ovr: p.ovr, img: p.img || '', age: p.age, isUser: true });
    }
    squad.sort((a, b) => b.ovr - a.ovr);
    bodyEl.innerHTML = '';
    if (!squad.length) {
        bodyEl.innerHTML = `<tr><td colspan="3" style="padding:14px;color:var(--text-muted);">Kadro verisi yükleniyor… (lig henüz yüklenmedi)</td></tr>`;
        DB.loadPlayers((DB.getTeam(teamId) || {}).srcLeague || (DB.getTeam(teamId) || {}).leagueId).then(() => { if (modal.style.display === 'flex') showTeamRosterModal(teamId); });
    }
    squad.slice(0, 26).forEach(pl => {
        const short = (POS_BY_KEY[pl.pos] || { short: pl.pos }).short;
        const tr = document.createElement('tr');
        if (pl.isUser) { tr.style.background = 'rgba(0,255,136,0.08)'; tr.style.fontWeight = '600'; }
        tr.style.cursor = pl.isUser ? 'default' : 'pointer';
        tr.innerHTML = `
            <td style="padding:8px;"><span class="l-player-pos">${short}</span></td>
            <td style="padding:8px;color:${pl.isUser ? 'var(--accent)' : '#fff'};">
                <span style="display:inline-flex;align-items:center;gap:8px;">${_photoHtml(pl.img, short, 24, team.color)}<span>${pl.name} ${pl.isUser ? '(Sen)' : ''}</span></span>
            </td>
            <td style="padding:8px;text-align:right;font-weight:700;">${pl.ovr}</td>`;
        if (!pl.isUser && pl.id && typeof openPlayerProfile === 'function')
            tr.addEventListener('click', () => openPlayerProfile(pl.id, teamId));
        bodyEl.appendChild(tr);
    });
    modal.style.display = 'flex';
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        generateMatchLineups, renderMatchLineups, showTeamRosterModal, _shortName,
        onMatchTick, _subInForUser, _doSub, _autoSubsForTeam, _emergencyShift, _slotToSlotAffinity,
        decideUserMatchStatus, _subUserIntoXI, _slotAffinity, _userSlotKey,
    });
}
