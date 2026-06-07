// ============================================================================
//  94-bindings.js  —  DOM olay baglama + oyun akisi gecisleri: antrenman/dinlenme
//  butonlari, hafta ilerleme, sezon sonu, emeklilik (triggerRetirement), kariyer
//  sifirlama (resetCareer), nav sekmeleri ve tum modal binding'leri + boot girisi.
//  En sonlarda yuklenir; referans verdigi tum fonksiyonlar runtime'da cozulur.
//  (05-core'dan ayristirildi.)
// ============================================================================
// ================= TRAINING & REST LOGIC =================

// Bind training click buttons
document.querySelectorAll('.btn-train').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.target.getAttribute('data-type');
        performTraining(type);
    });
});

document.getElementById('btn-quick-training').addEventListener('click', () => {
    const p = gameState.player;
    // AKILLI seçim: mevki + yaş + hoca güveni + mevcut stat seviyeleri (zayıf-ama-önemliyi geliştir)
    const type = (typeof _smartQuickTrainingType === 'function')
        ? _smartQuickTrainingType(p)
        : (p.position === 'Kaleci' ? 'goalkeeping' : 'physical');

    performTraining(type);
});

// Rest logic
document.getElementById('btn-quick-rest').addEventListener('click', () => {
    const p = gameState.player;
    if ((gameState.actionsDoneThisWeek || 0) >= 2) {
        showToast("Bu hafta maksimum 2 eylem (Antrenman/Dinlenme) yapabilirsin!", "error");
        return;
    }
    if (p.energy >= 100) {
        showToast("Zaten enerjin tamamen dolu!", "info");
        return;
    }
    
    p.energy = Math.min(100, p.energy + 40);
    p.form = Math.min(100, p.form + 8);
    gameState.actionsDoneThisWeek = (gameState.actionsDoneThisWeek || 0) + 1;
    gameState.hasDoneActionThisWeek = (gameState.actionsDoneThisWeek >= 2); // eylem yapıldı
    
    showToast("Güzelce dinlendin. Enerjin toplandı! (+40 Enerji, +8% Form)", "success");
    saveGame();
    updateUI();
});

// ================= WEEK ADVANCING =================

document.getElementById('btn-next-week').addEventListener('click', () => {
    const p = gameState.player;
    if (p.teamId === null) {
        // Serbest oyuncu: maçı yok → TAM HAFTA ilerle (gün gün değil)
        const bw = gameState.currentWeek;
        if (typeof advanceWeek === 'function') advanceWeek(); else if (typeof advanceDay === 'function') advanceDay('one');
        if (gameState.currentWeek !== bw && typeof weekToDay === 'function') gameState.gameDate = weekToDay(gameState.currentWeek);
        return;
    }
    // Bugün maç günü mü? (takvim)
    const today = (typeof matchToday === 'function') ? matchToday() : null;
    if (today && today.kind === 'league') { startMatchDay(); return; }
    if (today && today.kind === 'cup') { if (typeof startEuroMatch === 'function') startEuroMatch(); return; }

    // Sezon bitti mi?
    const lastWeek = (typeof activeLeagueWeeks === 'function') ? activeLeagueWeeks() : 38;
    if (gameState.currentWeek > lastWeek) { openSeasonEndModal(); return; }

    // Maç günü değil: bir sonraki maça/olaya kadar ilerle
    if (typeof advanceDay === 'function') advanceDay('event'); else advanceWeek();
});

// Tek gün ilerle
(function () {
    const b = document.getElementById('btn-advance-day');
    if (b) b.addEventListener('click', () => {
        if (typeof advanceDay === 'function') advanceDay('one'); else advanceWeek();
    });
})();

// Profil Detayı modalı (statik bio + disiplin) aç/kapa
(function () {
    const open = document.getElementById('btn-profile-detail');
    const modal = document.getElementById('profile-detail-modal');
    const close = document.getElementById('btn-close-profile-detail');
    if (open && modal) open.addEventListener('click', () => { modal.style.display = 'flex'; });
    if (close && modal) close.addEventListener('click', () => { modal.style.display = 'none'; });
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
})();

// ================= SEASON END LOGIC =================

document.getElementById('btn-start-next-season').addEventListener('click', () => {
    document.getElementById('season-end-modal').style.display = 'none';
    
    const p = gameState.player;
    
    // Emeklilik kontrolu (yas + form/seviye)
    const _ret = retirementRecommendation(p);
    if (_ret.retire) { triggerRetirement(); return; }

    // Kiralik bitti: ana kulube don (sozlesme azalmadan ONCE)
    if (p.onLoan && p.loanReturn) {
        const lr = p.loanReturn;
        // Ayrıldığı kiralık kulübü, ana kulübe geri yazmadan ÖNCE yakala (from/to doğru olsun)
        const _loanClubName = p.teamName, _loanClubId = p.teamId;
        if (typeof recordTransferHistory === 'function')
            recordTransferHistory({ type: 'return', from: _loanClubName, fromId: _loanClubId, to: lr.clubName, toId: lr.clubId, fee: 0, wage: lr.wage });
        p.teamId = lr.clubId; p.teamName = lr.clubName;
        p.wage = lr.wage; p.contractDuration = lr.contractDuration;
        p.onLoan = false; p.loanReturn = null;
        showToast(`Kiralık dönemin bitti, ${lr.clubName}'e geri döndün.`, 'info');
    }

    // FM-tarzı SEZON ARŞİVİ (sıfırlamadan ÖNCE; currentSeason++ ve initAllStandings bu noktadan SONRA çalışır,
    // yani gameState.currentSeason = biten sezon, standings = bitmiş sezon → sıra doğru yakalanır).
    try {
        const _lgId = (typeof activeLeagueId === 'function') ? activeLeagueId() : null;
        const _sorted = (typeof standingsSorted === 'function' && _lgId) ? standingsSorted(_lgId) : [];
        const _rank = p.teamId ? (_sorted.findIndex(t => t.id === p.teamId) + 1) : 0;
        const _c = p.currentSeasonStats || {};
        const _rt = _c.ratings || [];
        const _avg = _rt.length ? +(_rt.reduce((a, b) => a + b, 0) / _rt.length).toFixed(2) : 0;
        const _cup = _c.cup || { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, motm: 0 };
        if (!p.seasonHistory) p.seasonHistory = [];
        p.seasonHistory.push({
            season: gameState.currentSeason, teamId: p.teamId, teamName: p.teamName, leagueId: _lgId, leagueRank: _rank,
            league: {
                matches: _c.matches || 0, starts: _c.starts || 0, subApps: _c.subApps || 0,
                goals: _c.goals || 0, assists: _c.assists || 0, saves: _c.saves || 0,
                yellowCards: _c.yellowCards || 0, redCards: _c.redCards || 0,
                cleanSheets: _c.cleanSheets || 0, motm: _c.motm || 0, avgRating: _avg,
            },
            cup: { matches: _cup.matches || 0, starts: _cup.starts || 0, subApps: _cup.subApps || 0, goals: _cup.goals || 0, assists: _cup.assists || 0, motm: _cup.motm || 0 },
        });
        if (p.seasonHistory.length > 60) p.seasonHistory = p.seasonHistory.slice(-60);
    } catch (e) { /* arşiv hatası oyunu durdurmasın */ }

    // Move season stats to career summary (LİG alanları; kupa toplamları 85-euro'da canlı işlenir → burada .cup'a dokunma)
    p.careerStats.matches += p.currentSeasonStats.matches;
    p.careerStats.starts = (p.careerStats.starts || 0) + (p.currentSeasonStats.starts || 0);
    p.careerStats.subApps = (p.careerStats.subApps || 0) + (p.currentSeasonStats.subApps || 0);
    p.careerStats.goals += p.currentSeasonStats.goals;
    p.careerStats.assists += p.currentSeasonStats.assists;
    p.careerStats.saves += p.currentSeasonStats.saves;
    p.careerStats.yellowCards += p.currentSeasonStats.yellowCards;
    p.careerStats.redCards += p.currentSeasonStats.redCards;
    p.careerStats.cleanSheets = (p.careerStats.cleanSheets || 0) + (p.currentSeasonStats.cleanSheets || 0);
    p.careerStats.motm = (p.careerStats.motm || 0) + (p.currentSeasonStats.motm || 0);
    p.careerStats.ratings.push(...p.currentSeasonStats.ratings);

    // Clear season stats (yeni alanlar dahil)
    p.currentSeasonStats = {
        matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, saves: 0,
        yellowCards: 0, redCards: 0, cleanSheets: 0, motm: 0, ratings: [],
        cup: { matches: 0, starts: 0, subApps: 0, goals: 0, assists: 0, motm: 0 }
    };
    p.yellowAccum = 0; p.suspension = null;
    p.seasonStarts = 0; p.seasonBenched = 0;   // rotasyon dengesi sayaçları

    // Yas + sozlesme
    p.age++;
    p.contractDuration = Math.max(0, p.contractDuration - 1);
    const _contractExpired = (p.contractDuration === 0 && p.teamId);   // bu sezon sonu bitti mi?

    // Boy/kilo abartisiz artis (genc oyuncu)
    let physicalMessage = "";
    if (p.age <= 21) { const g = +(Math.random() * 0.8 + 0.3).toFixed(1); p.height = Math.round(p.height + g); physicalMessage += ` Boyun ${g} cm uzadı.`; }
    if (p.age <= 24) { const g = +(Math.random() * 1.4 + 0.6).toFixed(1); p.weight = Math.round(p.weight + g); }

    // Yas egrisi: gelisim/dususi (antrenman tesisi + sezon formu)
    const _team = getTeamById(p.teamId);
    const _fac = (_team.facilities && _team.facilities.training) || 65;
    const _perf = Math.max(0.5, Math.min(1.5, 0.6 + ((p.form || 60) - 50) / 90));
    const _dev = developPlayerSeason(p, _fac, _perf);
    if (_dev.delta > 0) physicalMessage += ` Gelişim: +${_dev.delta} OVR (${p.ovr}).`;
    else if (_dev.delta < 0) physicalMessage += ` Yaş etkisi: ${_dev.delta} OVR (${p.ovr}).`;
    p.value = calcMarketValue(p.ovr, p.age, _team.prestige || 2);
    // Gelisim takibi: sezon yas-egrisi anlik goruntusu
    if (typeof recordDevSnapshot === 'function') recordDevSnapshot(p, 'sezon', `${gameState.currentSeason} sezon gelişimi`);

    // Altyapi: kulubun genc yetenekleri GERCEK kadro uyesi (squadSync onlari da dondurur) — gelisir, kimi zaman oynar.
    if (p.teamId) {
        if (!gameState.clubYouth) gameState.clubYouth = {};
        let _yt = gameState.clubYouth[p.teamId] || [];
        if (typeof developClubYouth === 'function') developClubYouth(_yt, (_team.facilities && _team.facilities.youth) || 60);
        const _pros = generateYouthProspects(_team, gameState.currentSeason + 1);          // yeni mezunlar
        _yt = _yt.concat(_pros).sort((a, b) => (b.ovr || 0) - (a.ovr || 0)).slice(0, 8);   // en iyi 8 (kadro sismesin)
        gameState.clubYouth[p.teamId] = _yt;
        p.youthProspects = _pros;
        if (_pros.length) physicalMessage += ` Altyapıdan ${_pros.length} genç A takıma yükseldi.`;
    }

    // Dunya hafif evrilir (altyapi + rastgelelik)
    evolveWorld();
    // FAZ 2: biten sezonun oyuncu istatistiklerini maçlardan agregat et (playerSeasons),
    // ARDINDAN kalıcı dünya oyuncularını bir sezon yaşlandır/geliştir (IDB) — fire-and-forget.
    // Sıra önemli: agregat BİTEN sezonun maçlarını okur (currentSeason++ ÖNCESİ).
    try {
        if (window.WorldDB && gameState._slot != null) {
            const _wslot = gameState._slot, _endedSeason = gameState.currentSeason;
            Promise.resolve()
                .then(() => WorldDB.aggregatePlayerSeasons ? WorldDB.aggregatePlayerSeasons(_wslot, _endedSeason) : null)
                // FAZ 4c: tüm liglerin sezon özeti (şampiyon + ödüller) → kalıcı (Faz 5 geçmiş okur)
                .then(() => WorldDB.computeSeasonSummary ? WorldDB.computeSeasonSummary(_wslot, _endedSeason) : null)
                // FAZ 4a: emeklilik + regen (biten sezon tohumu). FAZ 4b: AI transfer piyasası.
                .then(() => WorldDB.evolveWorldPlayersSeason ? WorldDB.evolveWorldPlayersSeason(_wslot, _endedSeason) : null)
                .then(() => (typeof runWorldTransferMarket === 'function') ? runWorldTransferMarket(_wslot, _endedSeason + 1) : null)
                // overlay'i tazele (squadSync emekli/regen/transfer'i hemen yansıtsın) + krallık cache bayatladı
                .then(() => (window.WorldState) ? WorldState.ensure(_wslot, true) : null)
                .then(() => { if (window.WorldStats) WorldStats.invalidate(); })
                .catch(() => {});
        }
    } catch (e) { /* sessiz */ }

    // Biten sezonun kitasal kupalarini simule et (lig mantigina dokunmaz)
    if (typeof runSeasonCups === 'function') runSeasonCups(gameState.currentSeason);

    // Biten sezonun bitis siralamalarini sakla (Avrupa kotasi icin) — kume dusmeden ONCE
    if (typeof captureFinalPositions === 'function') captureFinalPositions();

    // Kume dusme / yukselme (yalniz cok kademeli ulkeler)
    let _promoMoves = [];
    if (typeof runPromotionRelegation === 'function') _promoMoves = runPromotionRelegation();

    // (Sözleşme bitişi artık otomatik uzatılmıyor — sezon kurulumundan sonra _handleContractExpiry işler.)

    // Yeni sezon
    gameState.currentSeason++;
    gameState.currentWeek = 1;
    gameState._lastSimWeek = -1;
    gameState.matchesPlayedThisWeek = false;
    gameState.hasDoneActionThisWeek = false;
    gameState.transferOffers = [];
    p.injury = null;
    // Takvim: yeni sezon gün 0, tarih bir sonraki yıla ilerler
    gameState.gameDate = 0;
    gameState.seasonStartDate = gameState.currentSeason + '-08-08';

    // Transfer piyasasini yeni sezona hazirla (yaz penceresi tekrar acilsin)
    gameState._lastMarketKey = null;
    if (typeof generateFreeAgentPool === 'function') generateFreeAgentPool(16);

    initAllStandings();
    setActiveLeagueFixtures();
    gameState._fxLeague = activeLeagueId();

    // Yeni sezon Avrupa kupasi kotasini belirle
    if (typeof qualifyPlayerEuro === 'function') { try { qualifyPlayerEuro(); } catch (e) { console.warn(e); } }

    saveGame();
    updateUI();
    if (typeof announcePromotionForPlayer === 'function') announcePromotionForPlayer(_promoMoves);
    showToast(`Yeni futbol sezonuna başladın! Yıl: ${gameState.currentSeason}.${physicalMessage}`, 'success');
    if (_contractExpired) _handleContractExpiry(p);   // sözleşme bitti → yenileme öner veya serbest bırak
});

// Sözleşme sona erdiğinde: kulüp memnunsa yenileme önerir; oyuncu reddederse veya
// kulüp istemezse oyuncu SERBEST kalır (otomatik uzatma yok).
function _becomeFreeAgent(p, msg) {
    const totalWeeks = ((gameState.currentSeason - 2026) * 36) + gameState.currentWeek;
    p.lastTeamId = p.teamId; p.leftClubAtWeek = totalWeeks;
    p.teamId = null; p.teamName = 'Serbest Oyuncu';
    p.wage = 0; p.contractDuration = 0;
    p.listingStatus = 'normal'; p.listingRequested = 'none'; p.managerTrust = 50;
    gameState.transferOffers = [];
    if (typeof showToast === 'function') showToast(msg, 'warning');
    saveGame(); if (typeof updateUI === 'function') updateUI();
}
function _handleContractExpiry(p) {
    const team = (typeof getTeamById === 'function') ? getTeamById(p.teamId) : null;
    const teamName = (team && team.name) || 'Kulüp';
    // Kulüp memnun değilse (düşük güven) yenilemez → serbest
    if ((p.managerTrust || 50) < 55) {
        _becomeFreeAgent(p, `Sözleşmen sona erdi ve ${teamName} yenilemek istemedi. Artık serbest oyuncusun — tekliflerini bekle.`);
        return;
    }
    // Memnun → yenileme teklifi (oyuncu kabul/ret)
    const offerDur = 2 + Math.floor(Math.random() * 2);                       // 2-3 yıl
    const offerWage = Math.max(2000, Math.round((p.wage || 10000) * (1.05 + Math.random() * 0.25)));
    const ask = (typeof gameConfirm === 'function')
        ? gameConfirm({ title: 'Sözleşmen Sona Erdi', icon: 'fa-file-signature', confirmText: 'Yenile', cancelText: 'Reddet (Serbest Kal)',
            message: `${teamName} sözleşmeni uzatmak istiyor: <strong>${offerDur} yıl</strong>, <strong>${offerWage.toLocaleString('tr-TR')} €/hafta</strong>. Kabul ediyor musun? Reddedersen serbest oyuncu olursun.` })
        : Promise.resolve(window.confirm(`${teamName} ${offerDur} yıl ${offerWage} €/hf öneriyor. Kabul?`));
    ask.then(ok => {
        if (ok) {
            p.contractDuration = offerDur; p.wage = offerWage;
            if (typeof showToast === 'function') showToast(`${teamName} ile ${offerDur} yıllık yeni sözleşme imzaladın!`, 'success');
            saveGame(); if (typeof updateUI === 'function') updateUI();
        } else {
            _becomeFreeAgent(p, 'Yenilemeyi reddettin — serbest oyuncu oldun. Yeni kulübünü tekliflerle seç.');
        }
    });
}

// ================= RETIREMENT LOGIC =================
function triggerRetirement() {
    document.getElementById('season-end-modal').style.display = 'none';
    const modal = document.getElementById('retirement-modal');
    const p = gameState.player;
    
    const totalM = p.careerStats.matches + p.currentSeasonStats.matches;
    const totalG = p.careerStats.goals + p.currentSeasonStats.goals;
    const totalA = p.careerStats.assists + p.currentSeasonStats.assists;
    const totalS = p.careerStats.saves + p.currentSeasonStats.saves;
    const allRatings = [...p.careerStats.ratings, ...p.currentSeasonStats.ratings];
    const avgRating = allRatings.length > 0 ? (allRatings.reduce((a,b)=>a+b, 0) / allRatings.length).toFixed(2) : '0.00';
    
    document.getElementById('ret-total-matches').textContent = totalM;
    document.getElementById('ret-total-goals').textContent = p.position === 'Kaleci' ? totalS : totalG;
    document.getElementById('ret-total-goals-lbl').textContent = p.position === 'Kaleci' ? 'Kurtarış' : 'Gol';
    document.getElementById('ret-total-assists').textContent = totalA;
    document.getElementById('ret-total-rating').textContent = avgRating;
    
    const trophiesRow = document.getElementById('ret-trophies-row');
    trophiesRow.innerHTML = '';
    
    if (gameState.trophies.length === 0) {
        trophiesRow.innerHTML = `<span style="color: var(--text-muted);">Maalesef müzede kupa bulunmuyor.</span>`;
    } else {
        // Group trophies by title
        const counts = {};
        gameState.trophies.forEach(t => {
            counts[t.title] = (counts[t.title] || 0) + 1;
        });
        
        Object.keys(counts).forEach(title => {
            const badge = document.createElement('span');
            badge.className = 'trophy-badge';
            badge.innerHTML = `<i class="fa-solid fa-award"></i> ${title} x${counts[title]}`;
            trophiesRow.appendChild(badge);
        });
    }
    
    modal.style.display = 'flex';
}

document.getElementById('btn-restart-career').addEventListener('click', () => {
    document.getElementById('retirement-modal').style.display = 'none';
    // Emekli olan kariyer slotunu temizle, ana menüye dön
    if (gameState._slot !== undefined && gameState._slot !== null && typeof deleteSlot === 'function') deleteSlot(gameState._slot);
    gameState.player = null; gameState._slot = null;
    if (typeof bootGame === 'function') { bootGame(); return; }
    document.getElementById('game-interface').classList.remove('active');
    document.getElementById('creation-screen').classList.add('active');
    setupCreationScreen();
});

// Reset career button from header — bu kariyeri sil + ana menü
function resetCareer() {
    gameConfirm({ title: 'Kariyeri Sıfırla', danger: true, confirmText: 'Sıfırla', cancelText: 'Vazgeç',
        message: "Bu kariyeri silmek istediğine emin misin? Tüm ilerleme kaybolacak!" }).then(ok => {
        if (!ok) return;
        if (gameState._slot !== undefined && gameState._slot !== null && typeof deleteSlot === 'function') deleteSlot(gameState._slot);
        localStorage.removeItem('football_career_save_v1'); localStorage.removeItem('football_career_save_v2');
        gameState.player = null; gameState._slot = null;
        if (typeof bootGame === 'function') { bootGame(); return; }
        location.reload();
    });
}

// Bind reset button in header
document.getElementById('btn-header-reset-career').addEventListener('click', resetCareer);

// ================= NAV TABS BINDINGS =================
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.getAttribute('data-target');
        
        // Remove active class from buttons and tabs
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(tab => tab.classList.remove('active'));
        
        // Add active classes
        e.currentTarget.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
        // (FAZ B: "Tarihçe" + "Kupalar" sekmeleri kaldırıldı; işlevleri "Lig & Fikstür" hub'ında.)
    });
});

// Lineup görünüm geçişi (Liste / Saha) — idempotent; DOMContentLoaded'da VE maç
// başında (startMatchDay) çağrılır. Guard sayesinde iki kez bağlanmaz (çift tıklama yok).
function bindLineupViewToggle() {
    const btnList = document.getElementById('btn-lineup-view-list');
    const btnPitch = document.getElementById('btn-lineup-view-pitch');
    if (!btnList || !btnPitch || btnList._viewBound) return;
    btnList._viewBound = true;
    btnList.addEventListener('click', () => {
        btnList.classList.add('active');
        btnPitch.classList.remove('active');
        const l = document.getElementById('match-lineup-players-list');
        const p = document.getElementById('match-lineup-pitch');
        if (l) l.style.display = '';        // '' → CSS'teki flex düzenine dön
        if (p) p.style.display = 'none';
    });
    btnPitch.addEventListener('click', () => {
        btnPitch.classList.add('active');
        btnList.classList.remove('active');
        const l = document.getElementById('match-lineup-players-list');
        const p = document.getElementById('match-lineup-pitch');
        if (l) l.style.display = 'none';
        if (p) p.style.display = 'block';
        if (typeof renderMatchLineupPitch === 'function') renderMatchLineupPitch();
    });
}
if (typeof window !== 'undefined') window.bindLineupViewToggle = bindLineupViewToggle;

// BIND ALL NEW EVENTS
window.addEventListener('DOMContentLoaded', () => {
    // 1. Lineup layout toggle buttons
    bindLineupViewToggle();

    // 2. Modals close buttons
    const closeRoster = document.getElementById('btn-close-roster-modal');
    if (closeRoster) {
        closeRoster.addEventListener('click', () => {
            document.getElementById('team-roster-modal').style.display = 'none';
        });
    }
    
    const closeNeg = document.getElementById('btn-close-negotiation-modal');
    if (closeNeg) {
        closeNeg.addEventListener('click', () => {
            document.getElementById('contract-negotiation-modal').style.display = 'none';
        });
    }
    
    const cancelNeg = document.getElementById('btn-cancel-negotiation');
    if (cancelNeg) {
        cancelNeg.addEventListener('click', () => {
            document.getElementById('contract-negotiation-modal').style.display = 'none';
            showToast("Sözleşme görüşmesinden çekildin.", "info");
        });
    }
    
    // 3. Actions request buttons
    const btnReqNeg = document.getElementById('btn-request-contract-negotiation');
    if (btnReqNeg) {
        btnReqNeg.addEventListener('click', requestContractNegotiation);
    }
    
    const btnReqTr = document.getElementById('btn-request-transfer');
    if (btnReqTr) {
        btnReqTr.addEventListener('click', () => {
            const p = gameState.player;
            if (p.teamId === null) {
                showToast("Şu anda bir kulübün yok!", "error");
                return;
            }
            if (p.listingStatus === 'transfer') {
                p.listingRequested = 'normal';
                showToast("Transfer listesinden ÇIKMA talebini hocaya ilettin. Haftalık ilerlemede karar belli olacak.", "info");
            } else {
                p.listingRequested = 'transfer';
                showToast("Transfer listesine konma talebini hocaya ilettin. Haftalık ilerlemede hocanın kararı belli olacak.", "info");
            }
            saveGame();
            updateUI();
        });
    }

    const btnReqLn = document.getElementById('btn-request-loan');
    if (btnReqLn) {
        btnReqLn.addEventListener('click', () => {
            const p = gameState.player;
            if (p.teamId === null) {
                showToast("Şu anda bir kulübün yok!", "error");
                return;
            }
            if (p.listingStatus === 'loan') {
                p.listingRequested = 'normal';
                showToast("Kiralık listesinden ÇIKMA talebini hocaya ilettin. Haftalık ilerlemede karar belli olacak.", "info");
            } else {
                p.listingRequested = 'loan';
                showToast("Kiralık listesine konma talebini hocaya ilettin. Haftalık ilerlemede hocanın kararı belli olacak.", "info");
            }
            saveGame();
            updateUI();
        });
    }
    
    const btnTerm = document.getElementById('btn-terminate-contract');
    if (btnTerm) {
        btnTerm.addEventListener('click', () => {
            const p = gameState.player;
            if (p.teamId === null) {
                showToast("Zaten serbest oyuncusun!", "error");
                return;
            }
            gameConfirm({ title: 'Sözleşmeyi Feshet', danger: true, confirmText: 'Feshet', cancelText: 'Vazgeç',
                message: "Sözleşmeni tek taraflı feshetmek istediğine emin misin? Serbest oyuncu kalacaksın ve hiçbir kulüpten maaş alamayacaksın!" }).then(ok => {
                if (!ok) return;
                // Eski takımı kaydet (ileride tekrar teklif engellemek için)
                const totalWeeks = ((gameState.currentSeason - 2026) * 36) + gameState.currentWeek;
                p.lastTeamId = p.teamId;
                p.leftClubAtWeek = totalWeeks;

                p.teamId = null;
                p.teamName = "Serbest Oyuncu";
                p.wage = 0;
                p.contractDuration = 0;
                p.listingStatus = 'normal';
                p.listingRequested = 'none';
                p.managerTrust = 50;

                gameState.transferOffers = [];

                showToast("Sözleşmeni feshettin ve serbest oyuncu kaldın!", "warning");
                saveGame();
                updateUI();
            });
        });
    }
    
    const btnSubNeg = document.getElementById('btn-submit-counter-offer');
    if (btnSubNeg) {
        btnSubNeg.addEventListener('click', submitCounterOffer);
    }
    
    // 4. Slider listeners for Counter Offer modal
    const negWage = document.getElementById('neg-slider-wage');
    if (negWage) {
        const updateWageLabel = (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('neg-val-wage').textContent = `${val.toLocaleString('tr-TR')} €`;
            updateNegotiationProbability();
        };
        negWage.addEventListener('input', updateWageLabel);
        negWage.addEventListener('change', updateWageLabel);
    }
    
    const negDur = document.getElementById('neg-slider-duration');
    if (negDur) {
        const updateDurLabel = (e) => {
            const val = e.target.value;
            document.getElementById('neg-val-duration').textContent = `${val} Yıl`;
            updateNegotiationProbability();
        };
        negDur.addEventListener('input', updateDurLabel);
        negDur.addEventListener('change', updateDurLabel);
    }
    
    const negRol = document.getElementById('neg-select-role');
    if (negRol) {
        negRol.addEventListener('change', updateNegotiationProbability);
    }
    
    // 5. Transfer Modal: Kapatma ve Pazarlık butonları
    const btnCloseTransfer = document.getElementById('btn-close-transfer-modal');
    if (btnCloseTransfer) {
        btnCloseTransfer.addEventListener('click', () => {
            document.getElementById('transfer-modal').style.display = 'none';
            // Teklif silinmez, sadece modal kapanır
        });
    }
    
    const btnNegotiateTransfer = document.getElementById('btn-negotiate-transfer');
    if (btnNegotiateTransfer) {
        btnNegotiateTransfer.addEventListener('click', () => {
            if (selectedOfferIndex !== null) {
                openTransferNegotiationModal(selectedOfferIndex);
            }
        });
    }
    
    // 6. Transfer Pazarlık Modal: Slider'lar, rol, submit, cancel, close
    const tnegWage = document.getElementById('tneg-slider-wage');
    if (tnegWage) {
        const updateTnegWage = (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('tneg-val-wage').textContent = `${val.toLocaleString('tr-TR')} €`;
            updateTransferNegotiationProbability();
        };
        tnegWage.addEventListener('input', updateTnegWage);
        tnegWage.addEventListener('change', updateTnegWage);
    }
    
    const tnegDur = document.getElementById('tneg-slider-duration');
    if (tnegDur) {
        const updateTnegDur = (e) => {
            document.getElementById('tneg-val-duration').textContent = `${e.target.value} Yıl`;
            updateTransferNegotiationProbability();
        };
        tnegDur.addEventListener('input', updateTnegDur);
        tnegDur.addEventListener('change', updateTnegDur);
    }
    
    const tnegRol = document.getElementById('tneg-select-role');
    if (tnegRol) {
        tnegRol.addEventListener('change', updateTransferNegotiationProbability);
    }
    
    const btnSubmitTneg = document.getElementById('btn-submit-transfer-counter');
    if (btnSubmitTneg) {
        btnSubmitTneg.addEventListener('click', submitTransferCounterOffer);
    }
    
    const btnCancelTneg = document.getElementById('btn-cancel-transfer-negotiation');
    if (btnCancelTneg) {
        btnCancelTneg.addEventListener('click', () => {
            document.getElementById('transfer-negotiation-modal').style.display = 'none';
            showToast("Pazarlık masasından kalktın. Teklif hala geçerli.", "info");
        });
    }
    
    const btnCloseTneg = document.getElementById('btn-close-transfer-negotiation');
    if (btnCloseTneg) {
        btnCloseTneg.addEventListener('click', () => {
            document.getElementById('transfer-negotiation-modal').style.display = 'none';
        });
    }
    
    // 7. Instantly Simulate Match dashboard button (kupa gününde kupa maçını simüle eder)
    const btnSimInst = document.getElementById('btn-simulate-match-instantly');
    if (btnSimInst) {
        btnSimInst.addEventListener('click', () => {
            const today = (typeof matchToday === 'function') ? matchToday() : null;
            if (today && today.kind === 'cup' && typeof euroFixtureDueThisWeek === 'function') {
                const due = euroFixtureDueThisWeek();
                if (due) { simEuroMatch(due.fx, due.phase, due.round); return; }   // interaktif → maç-sonu özet modalı
            }
            simulateMatchInstantly();
        });
    }
    
    // 8. Simulate Rest match button
    const btnSimRest = document.getElementById('btn-match-sim-rest');
    if (btnSimRest) {
        btnSimRest.addEventListener('click', () => {
            if (activeMatch.minute >= 90) return;
            gameConfirm({ title: 'Kalanı Simüle Et', confirmText: 'Simüle Et', cancelText: 'Devam Et', icon: 'fa-bolt',
                message: "Maçın kalan dakikalarını hızlıca simüle etmek istiyor musun?" })
                .then(ok => { if (ok) simulateRemainingMatchFast(); });
        });
    }
});

// ================= ON LOAD APP ENTRY =================
window.addEventListener('load', () => {
    // Yeni boot: 95-menu.js açılış menüsünü gösterir (10 kayıt slotu).
    if (typeof bootGame === 'function') { bootGame(); return; }
    // Yedek (eski davranış): tek kayıt yükle veya oluşturma ekranı
    const hasSave = loadGame();
    if (hasSave && gameState.player) {
        document.getElementById('creation-screen').classList.remove('active');
        document.getElementById('game-interface').classList.add('active');
        updateUI();
    } else {
        document.getElementById('creation-screen').classList.add('active');
        document.getElementById('game-interface').classList.remove('active');
        setupCreationScreen();
    }
});

