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
// FAZ B: Lig & Fikstür hub'ı artık SEZON de seçtirir (geçmiş sezonlar — ayrı "Tarihçe" sekmesi yok).
function currentStandingsSeason() {
    const s = gameState.viewStandingsSeason;
    const startS = (typeof START_SEASON !== 'undefined') ? START_SEASON : 0;
    return (s != null && s >= startS && s <= gameState.currentSeason) ? s : gameState.currentSeason;
}

// Tek satır render (canlı standings VEYA teamSeasons snapshot — alan adları normalize edilir).
function _standingsRow(row, pos, relZone, myTeam) {
    const tid = row.id || row.teamId;
    const team = DB.getTeam(tid) || { name: tid };
    const P = row.played != null ? row.played : (row.P || 0);
    const W = row.won != null ? row.won : (row.W || 0);
    const D = row.drawn != null ? row.drawn : (row.D || 0);
    const L = row.lost != null ? row.lost : (row.L || 0);
    const GD = row.goalDiff != null ? row.goalDiff : ((row.GF || 0) - (row.GA || 0));
    const PTS = row.points != null ? row.points : (row.Pts || 0);
    const tr = document.createElement('tr');
    tr.className = tid === myTeam ? 'team-highlight' : pos === 1 ? 'champion-row' : pos > relZone ? 'relegation-row' : '';
    tr.style.cursor = 'pointer';
    tr.innerHTML = `<td><strong>${pos}</strong></td>
        <td><span style="display:inline-flex;align-items:center;gap:8px;">${getTeamLogoHtml(tid, 18)}<span>${team.name}</span></span></td>
        <td style="text-align:center;">${P}</td><td style="text-align:center;">${W}</td>
        <td style="text-align:center;">${D}</td><td style="text-align:center;">${L}</td>
        <td style="text-align:center;">${GD > 0 ? '+' + GD : GD}</td>
        <td style="text-align:center;"><strong>${PTS}</strong></td>`;
    tr.addEventListener('click', () => { if (typeof openTeamSquad === 'function') openTeamSquad(tid); else showTeamRosterModal(tid); });
    return tr;
}

function updateStandingsTable() {
    const tableBody = document.getElementById('standings-body');
    if (!tableBody) return;
    const lid = currentStandingsLeagueId();
    const season = currentStandingsSeason();
    _renderStandingsLeaguePicker(lid);

    const layout = document.querySelector('#standings-tab .standings-layout');
    const euroCard = document.getElementById('euro-campaign-card');
    const cupInfo = document.getElementById('hub-cup-info');
    // KUPA/turnuva seçildiyse: lig tablosu+fikstür gizle. Kullanıcının turnuvası → kampanya; diğer → bilgi paneli.
    if (lid && lid.indexOf('__cup__') === 0) {
        const compId = lid.slice(7);
        window._hubShowCup = true; window._hubSelectedComp = compId;
        if (layout) layout.style.display = 'none';
        const e = gameState.euro;
        if (e && e.compId === compId) {
            if (cupInfo) cupInfo.style.display = 'none';
            if (typeof renderEuroCampaign === 'function') renderEuroCampaign();
        } else {
            if (euroCard) euroCard.style.display = 'none';
            const ci = ((typeof COMP_INFO !== 'undefined') ? COMP_INFO : {})[compId] || {};
            if (cupInfo) {
                cupInfo.style.display = 'block';
                cupInfo.innerHTML = `<div class="card-header"><h3><i class="fa-solid fa-trophy"></i> ${ci.name || 'Turnuva'}</h3></div>
                    <p style="color:var(--text-muted);padding:8px 2px;line-height:1.5;">Kulübün bu sezon bu turnuvada yer almıyor. Katıldığın turnuvanın kampanyası (fikstür, eşleşmeler, ilerleyiş) burada ayrıntılı görünür; diğer turnuvaların dünya sonuçları ileride eklenecek (yapı hazır).</p>`;
            }
        }
        return;
    }
    window._hubShowCup = false; window._hubSelectedComp = null;
    if (euroCard) euroCard.style.display = 'none';
    if (cupInfo) cupInfo.style.display = 'none';
    if (layout) layout.style.display = '';

    const lg = DB.getLeague(lid);
    const h3 = document.querySelector('#standings-tab .standings-table-card .card-header h3');
    if (h3) h3.textContent = `${(lg && lg.name) || 'Lig'} Puan Durumu${season < gameState.currentSeason ? ` — ${season}/${String((season + 1) % 100).padStart(2, '0')}` : ''}`;

    const myTeam = gameState.player ? gameState.player.teamId : null;
    const renderRows = (sorted) => {
        const relZone = Math.max(0, sorted.length - 3);
        tableBody.innerHTML = '';
        sorted.forEach((row, i) => tableBody.appendChild(_standingsRow(row, i + 1, relZone, myTeam)));
    };
    if (season >= gameState.currentSeason) {
        renderRows(standingsSorted(lid));   // canlı
    } else {
        tableBody.innerHTML = `<tr><td colspan="8" style="padding:14px;color:var(--text-muted);">Yükleniyor…</td></tr>`;
        const slot = gameState._slot;
        if (slot != null && window.WorldDB && typeof WorldDB.getAllByIndex === 'function') {
            WorldDB.getAllByIndex('teamSeasons', 'bySlotSeasonLeague', IDBKeyRange.only([slot, season, lid]))
                .then(ts => {
                    const sorted = (ts || []).slice().sort((a, b) => (a.rank || 99) - (b.rank || 99) || (b.Pts || 0) - (a.Pts || 0));
                    if (sorted.length) renderRows(sorted);
                    else tableBody.innerHTML = `<tr><td colspan="8" style="padding:14px;color:var(--text-muted);">Bu sezon için puan durumu kaydı yok.</td></tr>`;
                }).catch(() => { tableBody.innerHTML = `<tr><td colspan="8" style="padding:14px;color:var(--text-muted);">Yüklenemedi.</td></tr>`; });
        } else tableBody.innerHTML = `<tr><td colspan="8" style="padding:14px;color:var(--text-muted);">Geçmiş verisi yok.</td></tr>`;
    }
}

// Lig & Fikstür hub kontrolleri: SEZON (custom dropdown) + LİG/KUPA (kıta gruplu) dropdown.
// Kontroller standings-tab'ın EN ÜSTÜne enjekte edilir → kupa seçilince aşağı kaymaz.
function _seasonLabel(s) { return `${s}/${String((s + 1) % 100).padStart(2, '0')}${s === gameState.currentSeason ? ' (güncel)' : ''}`; }
function _renderStandingsLeaguePicker(activeLid) {
    const tab = document.getElementById('standings-tab');
    if (!tab || !document.getElementById('standings-body')) return;
    let controls = document.getElementById('standings-hub-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'standings-hub-controls';
        controls.style.cssText = 'display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:0 0 12px 0;';
        controls.innerHTML = ((typeof customDropdownShell === 'function') ? customDropdownShell('standings-season-picker', 'season-dd', false) : '')
            + ((typeof leagueDropdownHtml === 'function') ? leagueDropdownHtml('standings-league-picker', 'standings-ldd') : '');
        tab.insertBefore(controls, tab.firstChild);   // EN ÜSTE
        if (typeof wireLeagueDropdown === 'function')
            wireLeagueDropdown('standings-league-picker', activeLid, (v) => {
                gameState.viewStandingsLeague = v; fixtureViewingWeek = 1;
                updateStandingsTable(); renderFixturesForWeek(fixtureViewingWeek);
            }, true);   // includeCups (kıtasal turnuvalar dahil)
        // sezon dropdown değişim dinleyicisi (bir kez; hidden input setupDropdown ile klonlanmaz)
        const sdd = document.getElementById('standings-season-picker');
        const sh = sdd && sdd.querySelector('input[type="hidden"]');
        if (sh) sh.addEventListener('change', () => {
            gameState.viewStandingsSeason = parseInt(sh.value, 10) || gameState.currentSeason;
            fixtureViewingWeek = 1; updateStandingsTable(); renderFixturesForWeek(fixtureViewingWeek);
        });
    }
    // Sezon seçeneklerini (yeni sezon eklenince) tazele — custom dropdown
    const sdd = document.getElementById('standings-season-picker');
    if (sdd && typeof setupDropdown === 'function') {
        const startS = (typeof START_SEASON !== 'undefined') ? START_SEASON : gameState.currentSeason;
        const sel = currentStandingsSeason();
        if (sdd.dataset.n !== String(gameState.currentSeason)) {
            const sOpts = [];
            for (let s = gameState.currentSeason; s >= startS; s--) sOpts.push({ id: String(s), label: _seasonLabel(s) });
            setupDropdown(sdd, sOpts, String(sel));
            sdd.dataset.n = String(gameState.currentSeason);
        } else {
            const sh = sdd.querySelector('input[type="hidden"]'), lbl = sdd.querySelector('.dropdown-selected-value');
            if (sh && sh.value !== String(sel)) { sh.value = String(sel); if (lbl) lbl.textContent = _seasonLabel(sel); }
        }
    }
    // Lig dropdown gösterilen değeri (transfer sonrası aktif lige eşitle; kupa(__cup__) ise dokunma)
    const lp = document.getElementById('standings-league-picker');
    const hidden = lp && lp.querySelector('input[type="hidden"]');
    if (hidden && hidden.value !== activeLid && DB.getLeague(activeLid) && typeof setLeagueDropdownValue === 'function')
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

// ================= WEEK FIXTURES RENDERING (FAZ B: lig + sezon farkındalıklı, herkesin fikstürü) =================
// Tek fikstür satırı DOM'u (canlı / geçmiş / BAY hepsi için ortak görünüm).
function _fixtureItem(homeId, awayId, isBay, scoreText, clickable, myTeam) {
    const homeTeam = getTeamById(homeId);
    const item = document.createElement('div');
    const isHi = (homeId === myTeam || awayId === myTeam);
    item.className = `fixture-item ${isHi ? 'highlight' : ''}`;
    if (isBay) {
        item.innerHTML = `<span class="fix-team-home"><span style="display:inline-flex;align-items:center;gap:6px;">${homeTeam.name} ${getTeamLogoHtml(homeId, 16)}</span></span>
            <span class="fix-score" style="background:rgba(255,255,255,0.05);color:#fff;">BAY</span><span class="fix-team-away">-</span>`;
        return item;
    }
    const awayTeam = getTeamById(awayId);
    if (clickable) item.style.cursor = 'pointer';
    item.innerHTML = `<span class="fix-team-home"><span style="display:inline-flex;align-items:center;gap:6px;">${homeTeam.name} ${getTeamLogoHtml(homeId, 16)}</span></span>
        <span class="fix-score">${scoreText}</span>
        <span class="fix-team-away"><span style="display:inline-flex;align-items:center;gap:6px;">${getTeamLogoHtml(awayId, 16)} ${awayTeam.name}</span></span>`;
    return item;
}

function renderFixturesForWeek(weekNum) {
    const listContainer = document.getElementById('fixtures-list');
    if (!listContainer) return;
    const lid = currentStandingsLeagueId();
    const season = currentStandingsSeason();
    if (lid === '__euro__') return;   // kupa: euro kartı kendi fikstürünü gösterir
    const wkDisp = document.getElementById('fixture-week-display');
    if (wkDisp) wkDisp.textContent = `Hafta ${weekNum}`;
    const weekIndex = weekNum - 1;
    const myTeam = gameState.player ? gameState.player.teamId : null;

    // GEÇMİŞ sezon → WorldDB'de saklı GERÇEK maçlar (golcü/kart detayı tıklamada)
    if (season < gameState.currentSeason) {
        listContainer.innerHTML = '<div class="no-offers"><p>Yükleniyor…</p></div>';
        const slot = gameState._slot;
        if (slot == null || !window.WorldDB || typeof WorldDB.matchesOfWeek !== 'function') { listContainer.innerHTML = '<div class="no-offers"><p>Geçmiş verisi yok.</p></div>'; return; }
        WorldDB.matchesOfWeek(slot, season, lid, weekIndex).then(matches => {
            if (!matches || !matches.length) { listContainer.innerHTML = '<div class="no-offers"><p>Bu hafta maç kaydı yok.</p></div>'; return; }
            listContainer.innerHTML = '';
            matches.forEach(m => {
                const it = _fixtureItem(m.home, m.away, false, `${m.sh} - ${m.sa}`, true, myTeam);
                if (typeof openMatchDetail === 'function') it.addEventListener('click', () => openMatchDetail(lid, weekIndex, m.home, m.away, season));
                listContainer.appendChild(it);
            });
        }).catch(() => { listContainer.innerHTML = '<div class="no-offers"><p>Yüklenemedi.</p></div>'; });
        return;
    }

    // GÜNCEL sezon: aktif lig → gameState.fixtures (canlı user skoru); diğer ligler → leagueFixtures + deterministik skor
    const isActive = (lid === activeLeagueId());
    const src = isActive ? (gameState.fixtures[weekIndex] || [])
        : ((typeof leagueFixtures === 'function' && (leagueFixtures(lid)[weekIndex])) || []);
    if (!src.length) { listContainer.innerHTML = '<div class="no-offers"><p>Fikstür bulunamadı.</p></div>'; return; }
    listContainer.innerHTML = '';
    const isPastWeek = weekNum < gameState.currentWeek;
    src.forEach(match => {
        if (match.isBay) { listContainer.appendChild(_fixtureItem(match.home, null, true, 'BAY', false, myTeam)); return; }
        let scoreText = '- - -';
        if (match.scoreHome != null && match.scoreAway != null) scoreText = `${match.scoreHome} - ${match.scoreAway}`;
        else if (isPastWeek && typeof worldMatchScore === 'function') { const r = worldMatchScore(lid, weekIndex, match.home, match.away); scoreText = `${r[0]} - ${r[1]}`; }
        const clickable = isPastWeek || (match.scoreHome != null);
        const it = _fixtureItem(match.home, match.away, false, scoreText, clickable, myTeam);
        if (clickable && typeof openMatchDetail === 'function') it.addEventListener('click', () => openMatchDetail(lid, weekIndex, match.home, match.away, season));
        listContainer.appendChild(it);
    });
}

// Hafta navigasyonu — seçili ligin hafta sayısına göre
function _hubMaxWeek() {
    const lid = currentStandingsLeagueId();
    if (lid === '__euro__') return 1;
    if (typeof leagueFixtures === 'function' && lid) { const f = leagueFixtures(lid); if (f && f.length) return f.length; }
    return (typeof activeLeagueWeeks === 'function') ? activeLeagueWeeks() : 38;
}
let fixtureViewingWeek = 1;
document.getElementById('btn-prev-fixture').addEventListener('click', () => {
    if (fixtureViewingWeek > 1) { fixtureViewingWeek--; renderFixturesForWeek(fixtureViewingWeek); }
});
document.getElementById('btn-next-fixture').addEventListener('click', () => {
    if (fixtureViewingWeek < _hubMaxWeek()) { fixtureViewingWeek++; renderFixturesForWeek(fixtureViewingWeek); }
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
        // GERÇEK kasa akışı: alıcı kulüp bonservisi öder, satan kulüp alır (53-finance).
        if (offer.fee && typeof applyTransferFee === 'function') applyTransferFee(offer.clubId, oldTeamId, offer.fee);

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
