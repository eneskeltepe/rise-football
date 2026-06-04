// ============================================================================
//  60-ui.js  —  Veri-tabanli UI render/override katmani.
// ============================================================================

// ---- Takim erisimi: artik DB'den ----
function getTeamById(id) {
    if (id === null || id === undefined)
        return { name: 'Serbest Oyuncu', id: 'FREE', power: 50, attack: 50, defense: 50, color: '#888', prestige: 0 };
    const t = DB.getTeam(id);
    if (t) return t;
    return { name: id, id: id, power: 68, attack: 68, defense: 68, color: '#888', prestige: 2 };
}
function isEuroTeam() { return false; } // dunya capi transfer: kisitlama yok

// ---- Puan durumu: aktif lig (veya secilen lig) ----

function currentStandingsLeagueId() {
    return gameState.viewStandingsLeague || activeLeagueId() || (DB.leagues()[0] && DB.leagues()[0].id);
}

function updateStandingsTable() {
    const tableBody = document.getElementById('standings-body');
    if (!tableBody) return;
    const lid = currentStandingsLeagueId();
    const lg = DB.getLeague(lid);
    _renderStandingsLeaguePicker(lid);
    const sorted = standingsSorted(lid);
    const myTeam = gameState.player ? gameState.player.teamId : null;
    const relZone = Math.max(0, sorted.length - 3);   // son 3 kume hatti
    tableBody.innerHTML = '';
    sorted.forEach((row, index) => {
        const pos = index + 1;
        const team = DB.getTeam(row.id) || { name: row.id };
        const tr = document.createElement('tr');
        tr.className = row.id === myTeam ? 'team-highlight'
            : pos === 1 ? 'champion-row'
            : pos > relZone ? 'relegation-row' : '';
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
            <td><strong>${pos}</strong></td>
            <td><span style="display:inline-flex;align-items:center;gap:8px;">${getTeamLogoHtml(row.id, 18)}<span>${team.name}</span></span></td>
            <td style="text-align:center;">${row.played}</td>
            <td style="text-align:center;">${row.won}</td>
            <td style="text-align:center;">${row.drawn}</td>
            <td style="text-align:center;">${row.lost}</td>
            <td style="text-align:center;">${row.goalDiff > 0 ? '+' + row.goalDiff : row.goalDiff}</td>
            <td style="text-align:center;"><strong>${row.points}</strong></td>`;
        tr.addEventListener('click', () => showTeamRosterModal(row.id));
        tableBody.appendChild(tr);
    });
}

// Puan durumu sekmesine lig seçici ekle (bir kez)
function _renderStandingsLeaguePicker(activeLid) {
    let picker = document.getElementById('standings-league-picker');
    const table = document.getElementById('standings-body');
    if (!table) return;
    const host = table.closest('.tab-pane') || table.parentElement;
    if (!picker) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin:0 0 12px 0; max-width:340px;';
        wrap.innerHTML = (typeof leagueDropdownHtml === 'function')
            ? leagueDropdownHtml('standings-league-picker', 'standings-ldd') : '';
        const tableWrap = table.closest('table') ? table.closest('table').parentElement : host;
        tableWrap.parentElement.insertBefore(wrap, tableWrap);
        if (typeof wireLeagueDropdown === 'function')
            wireLeagueDropdown('standings-league-picker', activeLid, (v) => { gameState.viewStandingsLeague = v; updateStandingsTable(); });
        picker = document.getElementById('standings-league-picker');
    }
    // Gösterilen değeri mevcut görünüm ligine eşitle (transfer sonrası yeni lig)
    const hidden = picker && picker.querySelector('input[type="hidden"]');
    if (hidden && hidden.value !== activeLid && typeof setLeagueDropdownValue === 'function')
        setLeagueDropdownValue('standings-league-picker', activeLid);
}

// ---- Mac sonucu puan durumuna isle (aktif lig) ----
function updateTeamStandingsRecord(homeId, awayId, homeScore, awayScore) {
    recordResult(activeLeagueId(), homeId, awayId, homeScore, awayScore);
}

// ---- 12 mevki baslangic ana-stat araliklari (string; olusturma onizleme icin) ----
function getStartingStatsRange(position) {
    const r = (STARTING_RANGES[position] || STARTING_RANGES['Merkez OS']);
    const s = (k) => `${r[k][0]}-${r[k][1]}`;
    return { hiz: s('hiz'), sut: s('sut'), pas: s('pas'), defans: s('defans'), fizik: s('fizik'), teknik: s('teknik') };
}

// ---- Kulup/Stadyum/Tesisler/Sakatlik/Altyapi/Detayli ozellikler karti ----
function _stars(n) { n = Math.max(0, Math.min(5, Math.round(n))); return '★'.repeat(n) + '<span style="opacity:.3">' + '★'.repeat(5 - n) + '</span>'; }
function _bar(v, color) {
    return `<div style="background:rgba(255,255,255,.08);border-radius:6px;height:8px;overflow:hidden;"><div style="width:${Math.max(0, Math.min(100, v))}%;height:100%;background:${color};"></div></div>`;
}
let _clubCardOpen = false;   // Kulüp bilgi kartı varsayılan KAPALI (collapse) — yer kazanır
function renderClubInfoCard() {
    const card = document.getElementById('club-info-card');
    if (!card || !gameState.player) return;
    const p = gameState.player;
    const team = getTeamById(p.teamId);
    const isFree = !p.teamId;
    const st = team.stadium;
    const fac = team.facilities || { training: 60, youth: 55 };
    const headroom = Math.max(0, (p.potential || p.ovr) - p.ovr);
    const potTxt = headroom >= 12 ? 'Çok Yüksek' : headroom >= 7 ? 'Yüksek' : headroom >= 3 ? 'Orta' : 'Sınırlı';

    // detayli alt-ozellikler (gruplu)
    const isGK = p.position === 'Kaleci';
    let attrsHtml = '';
    const groups = isGK
        ? { 'Kalecilik': GK_ATTR_GROUP, 'Fizik': ATTR_GROUPS.fizik, 'Hız': ATTR_GROUPS.hiz, 'Pas': ATTR_GROUPS.pas }
        : { 'Hız': ATTR_GROUPS.hiz, 'Şut': ATTR_GROUPS.sut, 'Pas': ATTR_GROUPS.pas, 'Teknik': ATTR_GROUPS.teknik, 'Defans': ATTR_GROUPS.defans, 'Fizik': ATTR_GROUPS.fizik };
    for (const gname in groups) {
        const items = groups[gname].map(([k, lbl]) => {
            const v = Math.round((p.attrs && p.attrs[k]) || 0);
            const col = v >= 80 ? 'var(--accent,#0f8)' : v >= 65 ? '#ffca28' : v >= 50 ? '#ff9800' : '#ef5350';
            return `<div style="display:flex;justify-content:space-between;gap:6px;font-size:.78rem;padding:1px 0;"><span style="color:var(--text-muted)">${lbl}</span><strong style="color:${col}">${v}</strong></div>`;
        }).join('');
        attrsHtml += `<div style="min-width:150px;flex:1;"><div style="font-weight:700;font-size:.8rem;margin-bottom:3px;color:#fff;">${gname}</div>${items}</div>`;
    }


    const injuryHtml = p.injury ? `
        <div style="margin-top:10px;background:rgba(239,83,80,.12);border:1px solid rgba(239,83,80,.4);border-radius:10px;padding:10px;color:#ef9a9a;">
            <i class="fa-solid fa-kit-medical"></i> <strong>Sakatlık:</strong> ${p.injury.name} — ${p.injury.weeks} hafta yok.
        </div>` : '';

    card.style.display = 'block';
    card.innerHTML = `
        <div class="card-header club-card-toggle" style="cursor:pointer;"><h3><i class="fa-solid fa-building-shield"></i> Kulüp & Gelişim</h3>
            <span style="display:flex;align-items:center;gap:10px;"><span class="badge">${isFree ? 'Serbest Oyuncu' : team.name}</span><i class="fa-solid fa-chevron-${_clubCardOpen ? 'up' : 'down'} club-card-chevron" style="color:var(--text-muted);"></i></span></div>
        <div class="club-card-body" style="display:${_clubCardOpen ? 'flex' : 'none'};flex-wrap:wrap;gap:16px;">
            <div style="flex:1;min-width:230px;display:flex;flex-direction:column;gap:10px;">
                ${isFree ? '<p style="color:var(--text-muted)">Şu an bir kulübün yok.</p>' : `
                <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-muted)"><i class="fa-solid fa-location-dot"></i> Stadyum</span><strong>${st ? st.name : '—'}</strong></div>
                <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-muted)"><i class="fa-solid fa-users"></i> Kapasite</span><strong>${st ? st.capacity.toLocaleString('tr-TR') : '—'}</strong></div>
                <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-muted)">Prestij</span><strong style="color:#ffca28">${_stars(team.prestige)}</strong></div>
                <div><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px;"><span style="color:var(--text-muted)"><i class="fa-solid fa-dumbbell"></i> Antrenman Tesisi</span><strong>${fac.training}</strong></div>${_bar(fac.training, '#42a5f5')}</div>
                <div><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px;"><span style="color:var(--text-muted)"><i class="fa-solid fa-seedling"></i> Altyapı Tesisi</span><strong>${fac.youth}</strong></div>${_bar(fac.youth, '#66bb6a')}</div>`}
                <div><div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px;"><span style="color:var(--text-muted)"><i class="fa-solid fa-arrow-trend-up"></i> Gelişim Potansiyeli</span><strong>${potTxt}</strong></div>${_bar((headroom / 20) * 100, '#ab47bc')}</div>
                ${injuryHtml}
            </div>
            <div style="flex:2;min-width:280px;">
                <div style="font-weight:700;margin-bottom:8px;"><i class="fa-solid fa-chart-simple"></i> Detaylı Özellikler</div>
                <div style="display:flex;flex-wrap:wrap;gap:14px;">${attrsHtml}</div>
            </div>
        </div>`;
    // aç/kapa: başlığa tıkla → gövdeyi göster/gizle (re-render etmeden)
    const hdr = card.querySelector('.club-card-toggle');
    if (hdr) hdr.addEventListener('click', () => {
        _clubCardOpen = !_clubCardOpen;
        const body = card.querySelector('.club-card-body');
        const chev = card.querySelector('.club-card-chevron');
        if (body) body.style.display = _clubCardOpen ? 'flex' : 'none';
        if (chev) chev.className = `fa-solid fa-chevron-${_clubCardOpen ? 'up' : 'down'} club-card-chevron`;
    });
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        getTeamById, isEuroTeam, updateStandingsTable,
        updateTeamStandingsRecord, getStartingStatsRange, currentStandingsLeagueId, renderClubInfoCard,
    });
}

// ============================================================================
//  Asagidakiler 05-core.js'ten tasindi (2026-05-31 modulerlestirme): ana UI
//  render dongusu (updateUI), aksiyon butonu durumlari, fikstur gosterimi +
//  hafta navigasyonu, transfer sekmesi + transfer teklif modali.
// ============================================================================
// ================= RENDERING / UI UPDATES =================
function updateUI() {
    if (!gameState.player) return;
    
    const p = gameState.player;
    const teamObj = getTeamById(p.teamId);
    
    // Hide/show goalkeeping training depending on position
    const gkTrain = document.getElementById('goalkeeping-training-card');
    if (gkTrain) {
        if (p.position === 'Kaleci') {
            gkTrain.style.display = 'flex';
        } else {
            gkTrain.style.display = 'none';
        }
    }
    
    // Headers
    document.getElementById('header-name').textContent = `${p.firstname} ${p.lastname}`;
    document.getElementById('header-team').textContent = p.teamName;
    document.getElementById('header-age').textContent = `${p.age} Yaş`;
    document.getElementById('header-ovr').textContent = p.ovr;
    document.getElementById('header-energy').textContent = `${Math.round(p.energy)}/100`;
    document.getElementById('header-energy-fill').style.width = `${p.energy}%`;
    document.getElementById('header-week').textContent = `${gameState.currentWeek} / ${typeof activeLeagueWeeks === 'function' ? activeLeagueWeeks() : 38}`;
    const headerDate = document.getElementById('header-date');
    if (headerDate) {
        headerDate.textContent = (typeof calFormat === 'function' && gameState.seasonStartDate)
            ? calFormat(gameState.gameDate || 0, true)
            : getWeekDateString(gameState.currentWeek);
    }

    // Transfer & Sözleşme nav rozeti (bekleyen teklif sayısı)
    if (typeof updateOffersBadge === 'function') updateOffersBadge();

    const _famCls = { GK: 'gk', CB: 'df', FB: 'df', DM: 'mf', CM: 'mf', AM: 'mf', WM: 'mf', W: 'fw', ST: 'fw' };
    const posBadges = {}, shortPos = {};
    (window.POSITIONS || []).forEach(pp => { posBadges[pp.key] = _famCls[pp.fam] || 'mf'; shortPos[pp.key] = pp.short; });
    
    const avatar = document.getElementById('header-avatar');
    if (avatar && !avatar._editBound) {
        avatar._editBound = true;
        avatar.style.cursor = 'pointer';
        avatar.title = 'Profil fotoğrafını değiştir';
        avatar.addEventListener('click', () => { if (typeof openProfileAvatarEditor === 'function') openProfileAvatarEditor(); });
    }
    if (avatar) {
        if (p.img) {
            avatar.innerHTML = `<img src="${p.img}" class="avatar-photo-img" onerror="this.style.display='none'; if(this.parentElement)this.parentElement.textContent='${shortPos[p.position] || ''}'">`;
            avatar.className = `profile-avatar has-photo`;
            avatar.style.padding = '0';
        } else if (teamObj && teamObj.logoUrl) {
            avatar.innerHTML = `<img src="${teamObj.logoUrl}" class="team-logo-img" onerror="this.style.display='none'; if(this.parentElement)this.parentElement.textContent='${shortPos[p.position] || ''}'">`;
            avatar.className = `profile-avatar pos-badge ${posBadges[p.position]}`;
            avatar.style.padding = '0';
        } else {
            avatar.textContent = shortPos[p.position];
            avatar.className = `profile-avatar pos-badge ${posBadges[p.position]}`;
        }
    }
    
    // Profile details card
    document.getElementById('card-fullname').textContent = `${p.firstname} ${p.lastname}`;
    
    const cardClub = document.getElementById('card-club');
    if (cardClub) {
        cardClub.innerHTML = `<span style="display:inline-flex; align-items:center; gap:7px;">${getTeamLogoHtml(p.teamId, 24)} <span>${p.teamName}</span></span>`;
    }
    
    document.getElementById('card-ovr').textContent = p.ovr;
    document.getElementById('card-pos').textContent = shortPos[p.position];
    document.getElementById('player-value').textContent = formatMoney(p.value);
    const cardPhoto = document.getElementById('card-photo');
    if (cardPhoto) cardPhoto.innerHTML = p.img ? `<img src="${p.img}" alt="">` : `<i class="fa-solid fa-user"></i>`;
    document.getElementById('card-wage').textContent = `${p.wage.toLocaleString('tr-TR')} € / Hafta`;
    document.getElementById('card-contract').textContent = `${p.contractDuration} Sezon`;
    
    // Render new profile metadata info
    const flagMap = {
        'Türkiye': '🇹🇷',
        'Almanya': '🇩🇪',
        'Hollanda': '🇳🇱',
        'Fransa': '🇫🇷',
        'İngiltere': '🏴%c2%a7%c3%a2%c2%81%c2%a0%c3%a2%c2%81%c2%a0%c3%a2%c2%81%c2%a7', // flag_england
        'İspanya': '🇪🇸',
        'İtalya': '🇮🇹',
        'Portekiz': '🇵🇹',
        'Brezilya': '🇧🇷',
        'Arjantin': '🇦🇷'
    };
    
    // Fixed England flag representation fallback
    const flag = flagMap[p.nationality] || '🇹🇷';
    let formattedBirthdate = p.birthdate;
    if (p.birthdate) {
        const parts = p.birthdate.split('-');
        if (parts.length === 3) formattedBirthdate = `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    
    const profNat = document.getElementById('profile-nationality');
    const profNum = document.getElementById('profile-number');
    const profBirth = document.getElementById('profile-birthdate');
    const profHeight = document.getElementById('profile-height');
    const profWeight = document.getElementById('profile-weight');
    const profAge = document.getElementById('profile-age');
    
    if (profNat) profNat.innerHTML = `${(typeof natFlagImg === 'function' ? natFlagImg(p.nationality) : flag)} ${p.nationality || 'Türkiye'}`;
    if (profNum) profNum.textContent = `#${p.number || 10}`;
    if (profBirth) profBirth.textContent = formattedBirthdate || '25.02.2009';
    if (profHeight) profHeight.textContent = `${p.height || 180} cm`;
    if (profWeight) profWeight.textContent = `${p.weight || 75} kg`;
    if (profAge) profAge.textContent = `${p.age || 17} Yaş`;
    
    // Render Stats list
    const statsList = document.getElementById('dashboard-stats-list');
    statsList.innerHTML = '';
    
    const statLabels = {
        hiz: 'Hız (PAC)',
        sut: 'Şut (SHO)',
        pas: 'Pas (PAS)',
        defans: 'Savunma (DEF)',
        fizik: 'Fizik (PHY)',
        teknik: p.position === 'Kaleci' ? 'Kalecilik (GK)' : 'Teknik (TEC)'
    };
    
    Object.keys(p.stats).forEach(key => {
        const val = Math.round(p.stats[key]);
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `
            <div class="stat-row-top">
                <span class="lbl">${statLabels[key]}</span>
                <span class="val">${val}</span>
            </div>
            <div class="stat-bar-outer">
                <div class="stat-bar-inner" style="width: ${val}%;"></div>
            </div>
        `;
        statsList.appendChild(row);
    });
    
    // Actions panel
    document.getElementById('player-form').textContent = `${Math.round(p.form)}%`;
    document.getElementById('player-manager-trust').textContent = `${Math.round(p.managerTrust)}%`;
    document.getElementById('player-fans').textContent = `${Math.round(p.fansLove)}%`;
    // Serbest oyuncuda hoca güveni / taraftar sevgisi ANLAMSIZ → kutularını gizle (kulüp yokken)
    const _isFree = (p.teamId === null || p.teamId === undefined);
    const _qsTrust = document.getElementById('qs-box-trust');
    const _qsFans = document.getElementById('qs-box-fans');
    if (_qsTrust) _qsTrust.style.display = _isFree ? 'none' : '';
    if (_qsFans) _qsFans.style.display = _isFree ? 'none' : '';
    
    // Season perform stats
    const cs = p.currentSeasonStats;
    const avgRating = cs.ratings.length > 0 ? (cs.ratings.reduce((a,b)=>a+b, 0) / cs.ratings.length).toFixed(2) : '0.00';
    
    document.getElementById('stats-matches').textContent = cs.matches;
    document.getElementById('stats-goals').textContent = p.position === 'Kaleci' ? cs.saves : cs.goals;
    document.getElementById('stats-goals-label').textContent = p.position === 'Kaleci' ? 'Kurtarış' : 'Gol';
    document.getElementById('stats-assists').textContent = cs.assists;
    document.getElementById('stats-yellow').textContent = cs.yellowCards;
    document.getElementById('stats-red').textContent = cs.redCards;
    document.getElementById('player-rating-badge').textContent = `Ort. Reyting: ${avgRating}`;
    
    // Next fixture action label
    setupNextActionLabel();
    
    // Tab update triggers
    updateStandingsTable();
    renderFixturesForWeek(gameState.currentWeek);
    renderTransferTab();
    updateActionButtonsState();
}

function updateActionButtonsState() {
    if (!gameState.player) return;
    const actionsDone = gameState.actionsDoneThisWeek || 0;
    const isLocked = actionsDone >= 2;
    
    const quickTrainBtn = document.getElementById('btn-quick-training');
    const quickRestBtn = document.getElementById('btn-quick-rest');
    const trainBtns = document.querySelectorAll('.btn-train');
    const actionDesc = document.getElementById('action-desc');
    const actionBadge = document.getElementById('action-remaining-badge');
    
    if (actionBadge) {
        actionBadge.textContent = `Kalan Eylem: ${2 - actionsDone} / 2`;
        if (isLocked) {
            actionBadge.className = "badge badge-danger";
        } else {
            actionBadge.className = "badge badge-warning";
        }
    }
    
    if (isLocked) {
        if (quickTrainBtn) quickTrainBtn.disabled = true;
        if (quickRestBtn) quickRestBtn.disabled = true;
        trainBtns.forEach(btn => btn.disabled = true);
        
        if (actionDesc && !gameState.matchesPlayedThisWeek) {
            actionDesc.innerHTML = `<span class="text-accent" style="font-weight:600;"><i class="fa-solid fa-circle-exclamation"></i> Bu haftaki eylem haklarını (Antrenman/Dinlenme) kullandın.</span> Sahaya çıkmak için hazır mısın? "Maça Çık" butonuna tıklayarak haftayı ilerlet!`;
        }
    } else {
        if (quickTrainBtn) quickTrainBtn.disabled = false;
        if (quickRestBtn) quickRestBtn.disabled = false;
        trainBtns.forEach(btn => btn.disabled = false);
        
        if (actionDesc && !gameState.matchesPlayedThisWeek) {
            actionDesc.textContent = `Haftalık maç öncesinde antrenman yapabilir veya dinlenebilirsin. Hazır olduğunda haftayı ilerlet!`;
        }
    }
}

function setupNextActionLabel() {
    const p = gameState.player;
    const actionTitle = document.getElementById('action-title');
    const actionDesc = document.getElementById('action-desc');
    const nextFixtureBadge = document.getElementById('next-fixture-match');
    const nextWeekBtn = document.getElementById('btn-next-week');
    const simBtn = document.getElementById('btn-simulate-match-instantly');
    
    if (p.teamId === null) {
        actionTitle.textContent = "Serbest Oyuncu Aşaması";
        actionDesc.textContent = "Herhangi bir kulüple sözleşmen yok. Bireysel antrenmanlar yapabilir ve gelen sözleşme tekliflerini değerlendirebilirsin.";
        nextFixtureBadge.textContent = "Kulüpsüz";
        nextWeekBtn.innerHTML = `Haftayı İlerlet <i class="fa-solid fa-forward"></i>`;
        if (simBtn) simBtn.style.display = 'none';
        return;
    }
    
    const weekIndex = gameState.currentWeek - 1;
    const matches = gameState.fixtures[weekIndex] || [];
    const playerTeam = p.teamId;
    const myMatch = matches.find(m => m.home === playerTeam || m.away === playerTeam);
    
    if (!myMatch) {
        actionTitle.textContent = "Sezon Tamamlandı!";
        actionDesc.textContent = "Lig sona erdi. Sezon Sonu Raporu'nu inceleyip yeni sezona geçiş yapabilirsin.";
        nextFixtureBadge.textContent = "Maç Yok";
        nextWeekBtn.innerHTML = `Sezonu Bitir <i class="fa-solid fa-flag-checkered"></i>`;
        if (simBtn) simBtn.style.display = 'none';
        return;
    }
    
    const today = (typeof matchToday === 'function') ? matchToday() : null;
    const dleft = (typeof daysUntilNextMatch === 'function') ? daysUntilNextMatch() : 0;

    if (today && today.kind === 'cup') {
        // Bugün kupa maçı — normal maç günüyle AYNI akış (ayrı "kupa maçına çık" butonu yok)
        const due = (typeof euroFixtureDueThisWeek === 'function') ? euroFixtureDueThisWeek() : null;
        const cupOpp = due ? getTeamById(due.fx.oppId) : null;
        const e = gameState.euro;
        nextFixtureBadge.textContent = cupOpp ? `${cupOpp.name} ${due.fx.home ? '(H)' : '(D)'}` : 'Kupa Maçı';
        actionTitle.textContent = "Maç Günü Geldi!";
        actionDesc.textContent = e
            ? `${e.compName} maçın var${cupOpp ? ` — Rakip: ${cupOpp.name}` : ''}. Hazırsan sahaya çık ya da simüle et!`
            : "Bugün kupa maçın var. Hazırsan sahaya çık!";
        nextWeekBtn.innerHTML = `Maça Çık! <i class="fa-solid fa-futbol"></i>`;
        if (simBtn) simBtn.style.display = 'block';
    } else if (today && today.kind === 'league') {
        const m = today.m;
        const isHome = m.home === playerTeam;
        const oppTeam = getTeamById(isHome ? m.away : m.home);
        nextFixtureBadge.textContent = `${oppTeam.name} ${isHome ? '(H)' : '(D)'}`;
        actionTitle.textContent = "Maç Günü Geldi!";
        actionDesc.textContent = `Maç gününe hazır mısın? Rakip: ${oppTeam.name}. Hazırlıklarını tamamladıysan sahaya çık!`;
        nextWeekBtn.innerHTML = `Maça Çık! <i class="fa-solid fa-futbol"></i>`;
        if (simBtn) simBtn.style.display = 'block';
    } else if (myMatch && myMatch.isBay) {
        nextFixtureBadge.textContent = "BAY Haftası";
        actionTitle.textContent = "BAY Haftası (Boş Geçiş)";
        actionDesc.textContent = "Bu hafta takımının maçı yok. Antrenman yap, dinlen ve ilerle.";
        nextWeekBtn.innerHTML = `İlerle <i class="fa-solid fa-forward"></i>`;
        if (simBtn) simBtn.style.display = 'none';
    } else {
        // Maç günü değil: sonraki maça kadar ilerlenebilir
        const isHome = myMatch.home === playerTeam;
        const oppTeam = getTeamById(isHome ? myMatch.away : myMatch.home);
        nextFixtureBadge.textContent = oppTeam ? `${oppTeam.name} ${isHome ? '(H)' : '(D)'}` : '—';
        actionTitle.textContent = gameState.matchesPlayedThisWeek ? "Maç Tamamlandı" : "Hazırlık Günleri";
        actionDesc.textContent = dleft > 0
            ? `Sıradaki maça ${dleft} gün var. Antrenman yapabilir, dinlenebilir veya günleri ilerletebilirsin.`
            : "Maça çıkmak için ilerle.";
        nextWeekBtn.innerHTML = `İlerle <i class="fa-solid fa-forward"></i>`;
        if (simBtn) simBtn.style.display = 'none';
    }
}

// ================= TRANSFER NAV ROZETİ =================
// Transfer & Sözleşme nav sekmesinde bekleyen teklif sayısı (1 ise 1, 2 ise 2...)
function updateOffersBadge() {
    const b = document.getElementById('nav-offers-badge');
    if (!b) return;
    const n = (gameState.transferOffers || []).length;
    b.textContent = n;
    b.style.display = n > 0 ? 'inline-flex' : 'none';
}

// ================= WEEK FIXTURES RENDERING =================
function renderFixturesForWeek(weekNum) {
    const listContainer = document.getElementById('fixtures-list');
    document.getElementById('fixture-week-display').textContent = `Hafta ${weekNum}`;
    listContainer.innerHTML = '';
    
    const weekIndex = weekNum - 1;
    const matches = gameState.fixtures[weekIndex] || [];
    
    if (matches.length === 0) {
        listContainer.innerHTML = '<div class="no-offers"><p>Fikstür bulunamadı.</p></div>';
        return;
    }
    
    matches.forEach(match => {
        const homeTeam = getTeamById(match.home);
        
        if (match.isBay) {
            const item = document.createElement('div');
            item.className = 'fixture-item';
            if (match.home === gameState.player.teamId) {
                item.className = 'fixture-item highlight';
            }
            item.innerHTML = `
                <span class="fix-team-home"><span style="display:inline-flex; align-items:center; gap:6px;">${homeTeam.name} ${getTeamLogoHtml(homeTeam.id, 16)}</span></span>
                <span class="fix-score" style="background: rgba(255, 255, 255, 0.05); color: #fff;">BAY</span>
                <span class="fix-team-away">-</span>
            `;
            listContainer.appendChild(item);
            return;
        }
        
        const awayTeam = getTeamById(match.away);
        
        const item = document.createElement('div');
        const isHighlight = match.home === gameState.player.teamId || match.away === gameState.player.teamId;
        item.className = `fixture-item ${isHighlight ? 'highlight' : ''}`;

        // Gecmis hafta ise TUM maclarin skoru gosterilir (deterministik dunya skoru / gercek skor)
        const isPast = weekNum < gameState.currentWeek;
        let scoreText = "- - -";
        if (match.scoreHome !== null && match.scoreAway !== null) {
            scoreText = `${match.scoreHome} - ${match.scoreAway}`;
        } else if (isPast && typeof worldMatchScore === 'function') {
            const r = worldMatchScore(activeLeagueId(), weekIndex, match.home, match.away);
            scoreText = `${r[0]} - ${r[1]}`;
        }

        const clickable = isPast || (match.scoreHome !== null);
        if (clickable) item.style.cursor = 'pointer';
        item.innerHTML = `
            <span class="fix-team-home"><span style="display:inline-flex; align-items:center; gap:6px;">${homeTeam.name} ${getTeamLogoHtml(homeTeam.id, 16)}</span></span>
            <span class="fix-score">${scoreText}</span>
            <span class="fix-team-away"><span style="display:inline-flex; align-items:center; gap:6px;">${getTeamLogoHtml(awayTeam.id, 16)} ${awayTeam.name}</span></span>
        `;
        if (clickable && typeof openMatchDetail === 'function')
            item.addEventListener('click', () => openMatchDetail(activeLeagueId(), weekIndex, match.home, match.away));
        listContainer.appendChild(item);
    });
}

// Navigation between fixture weeks
let fixtureViewingWeek = 1;
document.getElementById('btn-prev-fixture').addEventListener('click', () => {
    if (fixtureViewingWeek > 1) {
        fixtureViewingWeek--;
        renderFixturesForWeek(fixtureViewingWeek);
    }
});
document.getElementById('btn-next-fixture').addEventListener('click', () => {
    const _maxWk = (typeof activeLeagueWeeks === 'function') ? activeLeagueWeeks() : 38;
    if (fixtureViewingWeek < _maxWk) {
        fixtureViewingWeek++;
        renderFixturesForWeek(fixtureViewingWeek);
    }
});

// ================= TRANSFERS & OFFERS GENERATOR =================

function renderTransferTab() {
    const list = document.getElementById('offers-list');
    if (!list) return;
    list.innerHTML = '';
    
    const p = gameState.player;
    const contractClubName = document.getElementById('contract-club-name');
    const contractWage = document.getElementById('contract-wage-value');
    const contractDur = document.getElementById('contract-duration');
    const contractVal = document.getElementById('contract-market-value');
    const contractStatus = document.getElementById('contract-list-status');
    const prestigeEl = document.getElementById('contract-club-prestige');
    const btnTerminate = document.getElementById('btn-terminate-contract');
    const btnRenew = document.getElementById('btn-request-contract-negotiation');
    const btnTr = document.getElementById('btn-request-transfer');
    const btnLn = document.getElementById('btn-request-loan');
    
    if (p.teamId === null) {
        if (contractClubName) contractClubName.textContent = "Serbest Oyuncu";
        if (contractWage) contractWage.textContent = "0 € / Hafta";
        if (contractDur) contractDur.textContent = "Sözleşme Yok";
        if (contractVal) contractVal.textContent = formatMoney(p.value);
        if (contractStatus) {
            contractStatus.textContent = "Serbest Oyuncu";
            contractStatus.className = "value text-muted";
        }
        if (prestigeEl) prestigeEl.textContent = "Derecesiz";
        if (btnTerminate) btnTerminate.style.display = 'none';
        if (btnRenew) btnRenew.style.display = 'none';
        if (btnTr) btnTr.style.display = 'none';
        if (btnLn) btnLn.style.display = 'none';
    } else {
        if (contractClubName) {
            contractClubName.innerHTML = `<span style="display:inline-flex; align-items:center; gap:6px;">${getTeamLogoHtml(p.teamId, 16)} <span>${p.teamName}</span></span>`;
        }
        if (contractWage) contractWage.textContent = `${p.wage.toLocaleString('tr-TR')} € / Hafta`;
        if (contractDur) contractDur.textContent = `${p.contractDuration} Yıl`;
        if (contractVal) contractVal.textContent = formatMoney(p.value);
        
        if (contractStatus) {
            if (p.listingStatus === 'transfer') {
                contractStatus.textContent = "Transfer Listesinde";
                contractStatus.className = "value text-danger";
            } else if (p.listingStatus === 'loan') {
                contractStatus.textContent = "Kiralık Listesinde";
                contractStatus.className = "value text-info";
            } else {
                contractStatus.textContent = "Normal";
                contractStatus.className = "value text-success";
            }
        }
        
        const currTeamObj = getTeamById(p.teamId);
        let stars = '★'.repeat(currTeamObj.prestige) + '☆'.repeat(5 - currTeamObj.prestige);
        if (prestigeEl) prestigeEl.textContent = stars;
        
        if (btnTerminate) btnTerminate.style.display = 'block';
        if (btnRenew) btnRenew.style.display = 'block';
        if (btnTr) { btnTr.style.display = 'block'; btnTr.innerHTML = p.listingStatus === 'transfer' ? '<i class="fa-solid fa-arrow-rotate-left"></i> Transfer Listesinden Çık' : '<i class="fa-solid fa-right-from-bracket"></i> Transfer Listesine Talep Et'; }
        if (btnLn) { btnLn.style.display = 'block'; btnLn.innerHTML = p.listingStatus === 'loan' ? '<i class="fa-solid fa-arrow-rotate-left"></i> Kiralık Listesinden Çık' : '<i class="fa-solid fa-handshake"></i> Kiralık Listesine Talep Et'; }
    }
    
    const offersCount = document.getElementById('offers-count');
    if (offersCount) offersCount.textContent = `${gameState.transferOffers.length} Teklif`;
    
    if (gameState.transferOffers.length === 0) {
        list.innerHTML = `
            <div class="no-offers">
                <i class="fa-solid fa-envelope-open-text"></i>
                <p>Şu anda aktif bir transfer teklifi bulunmuyor. Performansını artırarak veya transfer listesi isteyerek teklifler alabilirsin!</p>
            </div>
        `;
        return;
    }
    
    gameState.transferOffers.forEach((offer, idx) => {
        const item = document.createElement('div');
        item.className = 'offer-card';
        
        const clubObj = getTeamById(offer.clubId);
        const prestigeStars = '★'.repeat(clubObj.prestige) + '☆'.repeat(5 - clubObj.prestige);
        
        item.innerHTML = `
            <div class="offer-club-details">
                <h4>${offer.clubName} ${offer.isEurope ? `(${clubObj.league})` : ''}</h4>
                <p>${prestigeStars} • Rol: <strong>${offer.squadRole}</strong></p>
            </div>
            <div class="offer-wage">${offer.wage.toLocaleString('tr-TR')} € <span style="font-size: 0.7rem; color: var(--text-muted);">/hafta</span></div>
            <button class="btn btn-primary btn-sm btn-offer-view" data-index="${idx}">Teklifi İncele</button>
        `;
        list.appendChild(item);
    });
    
    // Bind modal triggers
    document.querySelectorAll('.btn-offer-view').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.target.getAttribute('data-index');
            openTransferModal(idx);
        });
    });
}

let selectedOfferIndex = null;
function openTransferModal(index) {
    selectedOfferIndex = index;
    const offer = gameState.transferOffers[index];
    if (!offer) return;
    
    const p = gameState.player;
    
    document.getElementById('comp-current-team').textContent = p.teamName;
    document.getElementById('comp-current-wage').textContent = `${p.wage.toLocaleString('tr-TR')} €`;
    document.getElementById('comp-current-duration').textContent = `${p.contractDuration} Yıl`;
    
    document.getElementById('comp-offer-team').textContent = offer.clubName;
    document.getElementById('comp-offer-wage').textContent = `${offer.wage.toLocaleString('tr-TR')} €`;
    document.getElementById('comp-offer-duration').textContent = offer.type === 'loan' ? 'Sezon sonu (kiralık)' : `${offer.duration} Yıl`;
    document.getElementById('comp-offer-role').textContent = offer.squadRole;

    // Bonservis + teklif turu (kiralik / serbest / kalici)
    const feeEl = document.getElementById('comp-offer-fee');
    if (feeEl) feeEl.textContent = offer.fee ? formatMoney(offer.fee) : 'Bonservissiz';
    const titleEl = document.getElementById('transfer-modal-title');
    const subEl = document.getElementById('transfer-modal-subtitle');
    if (titleEl && subEl) {
        if (offer.type === 'loan') {
            titleEl.innerHTML = `<i class="fa-solid fa-arrows-spin text-accent"></i> Kiralık Teklifi!`;
            subEl.textContent = `${offer.clubName} seni sezon sonuna kadar kiralamak istiyor.`;
        } else if (offer.type === 'free') {
            titleEl.innerHTML = `<i class="fa-solid fa-file-signature text-accent"></i> Serbest Transfer Teklifi!`;
            subEl.textContent = `Serbest oyuncu olarak ${offer.clubName} ile bonservissiz sözleşme imzalayabilirsin.`;
        } else {
            titleEl.innerHTML = `<i class="fa-solid fa-file-contract text-accent"></i> Yeni Transfer Teklifi!`;
            subEl.textContent = `${offer.clubName}, kulübüne ${formatMoney(offer.fee || 0)} bonservis ödemeyi teklif ediyor.`;
        }
    }

    document.getElementById('transfer-modal').style.display = 'flex';
}

document.getElementById('btn-reject-transfer').addEventListener('click', () => {
    document.getElementById('transfer-modal').style.display = 'none';
    if (selectedOfferIndex !== null) {
        const offer = gameState.transferOffers[selectedOfferIndex];
        showToast(`${offer.clubName} kulübünün teklifini reddettin.`, 'info');
        gameState.transferOffers.splice(selectedOfferIndex, 1);
        selectedOfferIndex = null;
        saveGame();
        updateUI();
    }
});

document.getElementById('btn-accept-transfer').addEventListener('click', () => {
    document.getElementById('transfer-modal').style.display = 'none';
    if (selectedOfferIndex !== null) {
        const offer = gameState.transferOffers[selectedOfferIndex];
        const p = gameState.player;
        if (!offer) { selectedOfferIndex = null; return; }

        // Avrupa takımlarına transfer engeli (fikstür sadece Süper Lig destekliyor)
        if (isEuroTeam(offer.clubId)) {
            showToast(`Üzgünüz, ${offer.clubName} şu anda lig sisteminde desteklenmiyor. Sadece Süper Lig takımlarına transfer olabilirsin.`, 'error');
            gameState.transferOffers.splice(selectedOfferIndex, 1);
            selectedOfferIndex = null;
            saveGame();
            updateUI();
            return;
        }
        
        // Yeni takıma transfer öncesi eski takım bilgisini kaydet
        const oldTeamName = p.teamName || 'Serbest Oyuncu';
        const oldTeamId = p.teamId;
        const totalWeeks = ((gameState.currentSeason - 2026) * 36) + gameState.currentWeek;

        // Al-sat (bonservis) verisi: alan kulup oder, satan kulup alir
        if (offer.fee && typeof gameState.clubSpend === 'object') {
            gameState.clubSpend = gameState.clubSpend || {};
            gameState.clubSpend[offer.clubId] = (gameState.clubSpend[offer.clubId] || 0) + offer.fee;
            if (oldTeamId) gameState.clubSpend[oldTeamId] = (gameState.clubSpend[oldTeamId] || 0) - offer.fee;
        } else if (offer.fee) {
            gameState.clubSpend = { [offer.clubId]: offer.fee };
            if (oldTeamId) gameState.clubSpend[oldTeamId] = -offer.fee;
        }

        if (offer.type === 'loan' && oldTeamId) {
            // KİRALIK: ana kulup/sozlesme saklanir, sezon sonu geri doner
            p.loanReturn = { clubId: oldTeamId, clubName: oldTeamName, wage: p.wage, contractDuration: p.contractDuration };
            p.onLoan = true;
            p.teamId = offer.clubId;
            p.teamName = offer.clubName;
            p.wage = offer.wage;            // kiralayan kulup maasi oder
            p.managerTrust = 50;
            p.listingStatus = 'normal';
            p.listingRequested = 'none';
            p.joinedClubWeek = totalWeeks;
            if (typeof recordTransferHistory === 'function')
                recordTransferHistory({ type: 'loan', from: oldTeamName, fromId: oldTeamId, to: offer.clubName, toId: offer.clubId, fee: 0, wage: offer.wage });
            showToast(`${offer.clubName} seni sezon sonuna kadar kiraladı! Sezon bitince ${oldTeamName}'e döneceksin.`, 'success');
        } else {
            // KALICI transfer veya serbest imza
            if (p.teamId !== null) {
                p.lastTeamId = p.teamId;
                p.leftClubAtWeek = totalWeeks;
            }
            p.onLoan = false;
            p.loanReturn = null;
            p.teamId = offer.clubId;
            p.teamName = offer.clubName;
            p.wage = offer.wage;
            p.contractDuration = offer.duration;
            p.managerTrust = 50;
            p.listingStatus = 'normal';
            p.listingRequested = 'none';
            p.lastContractRenewalWeek = gameState.currentWeek;
            p.joinedClubWeek = totalWeeks;
            const feeTxt = offer.fee ? ` (${formatMoney(offer.fee)} bonservis)` : ' (bonservissiz)';
            if (typeof recordTransferHistory === 'function')
                recordTransferHistory({ type: (oldTeamId ? 'transfer' : 'free'), from: oldTeamName, fromId: oldTeamId, to: offer.clubName, toId: offer.clubId, fee: offer.fee || 0, wage: offer.wage });
            showToast(`Hayırlı olsun! ${oldTeamName}'den ayrılarak ${offer.clubName} ile sözleşme imzaladın!${feeTxt}`, 'success');
        }

        gameState.transferOffers = [];
        selectedOfferIndex = null;

        saveGame();
        updateUI();
    }
});


if (typeof window !== 'undefined') {
    Object.assign(window, {
        updateUI, updateActionButtonsState, setupNextActionLabel,
        renderFixturesForWeek, renderTransferTab, openTransferModal,
    });
}
