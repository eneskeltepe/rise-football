// ============================================================================
//  54-negotiation.js  —  Sozlesme + transfer pazarlik modallari: slider'li
//  karsi teklif, kabul olasiligi hesabi (negotiationState / transferNegotiationState).
//  (05-core'dan ayristirildi.)
// ============================================================================
// Yaş ve OVR'ye göre gerçekçi kadro rolü hesaplama

let negotiationState = {
    initialWage: 0,
    initialDuration: 3,
    initialRole: 'First11',
    proposedWage: 0,
    proposedDuration: 3,
    proposedRole: 'First11'
};

function requestContractNegotiation() {
    const p = gameState.player;
    const currentWeek = gameState.currentWeek;
    // TÜM hafta sayaçları KARİYER-TOPLAM hafta cinsinden (sezon başına 36; joinedClubWeek/
    // leftClubAtWeek ile aynı birim). Eskiden lastContractRenewalWeek/negotiationBlockUntil
    // sezon-içi currentWeek ile karşılaştırılıyordu → sezon devrinde fark NEGATİF oluyor
    // ("yakın zamanda yeniledin" yanlış engeli) ve hafta 30'da yenen 10 haftalık blok
    // (blockUntil=40) yeni sezonda currentWeek<40 diye TÜM SEZON sürüyordu.
    const totalWeeksInCareer = ((gameState.currentSeason - START_SEASON) * 36) + currentWeek;

    // Geriye dönük uyumluluk (eski kayıtlarda sezon-içi küçük değerler: toplam-hafta
    // karşılaştırmasında fark büyük çıkar → en kötü ihtimalle erken görüşmeye izin verir)
    if (!p.lastContractRenewalWeek) p.lastContractRenewalWeek = 1;

    const weeksSinceLastRenewal = totalWeeksInCareer - p.lastContractRenewalWeek;
    const weeksAtClub = totalWeeksInCareer - (p.joinedClubWeek || 0);
    const isBlocked = p.negotiationBlockUntil && totalWeeksInCareer < p.negotiationBlockUntil;
    
    const cs = p.currentSeasonStats;
    const avgRating = cs.ratings.length > 0 ? (cs.ratings.reduce((a,b)=>a+b, 0) / cs.ratings.length) : 0;
    const hasExceptionalPerformance = p.form > 90 || avgRating > 7.6;
    
    if (p.teamId === null) {
        showToast("Şu anda bir kulübün yok! Serbest oyuncusun.", "error");
        return;
    }
    
    // Kariyere yeni başlayan oyuncu kontrolü
    if (totalWeeksInCareer < 15 && !hasExceptionalPerformance) {
        showToast("Kariyerine daha yeni başladın! Kendini kanıtla, sonra sözleşme masasına oturursun.", "error");
        return;
    }
    
    // Kulüpte yeterli süre geçirmemiş oyuncu
    if (weeksAtClub < 15 && !hasExceptionalPerformance) {
        showToast("Bu kulübe henüz yeni katıldın! Sözleşme görüşmesi için en az 15 hafta geçmeli.", "error");
        return;
    }
    
    // Yeterince maç oynamamış oyuncu
    if (cs.matches < 5 && !hasExceptionalPerformance) {
        showToast("Yeterince maç oynamadın! Sözleşme görüşmesi için en az 5 maç oynaman gerek.", "error");
        return;
    }
    
    if (!hasExceptionalPerformance) {
        if (weeksSinceLastRenewal < 15) {
            showToast("Yakın zamanda zaten sözleşme yeniledin! Yeni görüşme için en az 15 hafta geçmesi gerek.", "error");
            return;
        }
        if (isBlocked) {
            showToast(`Yönetim seninle görüşmeyi reddetti! Yeni talep için ${p.negotiationBlockUntil - totalWeeksInCareer} hafta beklemen gerek.`, "error");
            return;
        }
    }
    
    // Hoca güveni çok düşükse direkt reddetsin
    if (p.managerTrust < 35) {
        showToast("Hoca güvenin çok düşük! Performansını artır, sonra masaya oturursun.", "error");
        return;
    }
    
    openContractNegotiationModal();
}

function openContractNegotiationModal() {
    const p = gameState.player;
    const team = getTeamById(p.teamId);
    
    document.getElementById('neg-club-subtitle').textContent = `${team.name} ile sözleşme masasına oturuyorsun.`;
    
    const baseWage = Math.round(p.ovr * 150 * (team.prestige * 0.4) + Math.random() * 1000);
    negotiationState.initialWage = baseWage;
    negotiationState.initialDuration = 3;
    negotiationState.initialRole = 'First11';
    
    negotiationState.proposedWage = baseWage;
    negotiationState.proposedDuration = 3;
    negotiationState.proposedRole = 'First11';
    
    document.getElementById('neg-initial-offer-desc').innerHTML = `
        Kulübün Teklifi: Haftalık <strong>${baseWage.toLocaleString('tr-TR')} €</strong> maaş, 
        <strong>3 yıl</strong> sözleşme süresi ve <strong>İlk 11 Oyuncusu</strong> rolü öneriyoruz.
    `;
    
    const wageSlider = document.getElementById('neg-slider-wage');
    wageSlider.min = Math.max(500, Math.round(baseWage * 0.4));
    wageSlider.max = Math.round(baseWage * 3.5);
    wageSlider.step = 500;
    wageSlider.value = baseWage;
    
    const durationSlider = document.getElementById('neg-slider-duration');
    durationSlider.value = 3;
    
    const roleSelect = document.getElementById('neg-select-role');
    roleSelect.value = 'First11';
    
    document.getElementById('neg-val-wage').textContent = `${baseWage.toLocaleString('tr-TR')} €`;
    document.getElementById('neg-val-duration').textContent = '3 Yıl';
    
    updateNegotiationProbability();
    
    document.getElementById('contract-negotiation-modal').style.display = 'flex';
}

function updateNegotiationProbability() {
    const p = gameState.player;
    const team = getTeamById(p.teamId);
    
    const wage = parseInt(document.getElementById('neg-slider-wage').value) || 5000;
    const duration = parseInt(document.getElementById('neg-slider-duration').value) || 3;
    const role = document.getElementById('neg-select-role').value || 'First11';
    
    negotiationState.proposedWage = wage;
    negotiationState.proposedDuration = duration;
    negotiationState.proposedRole = role;
    
    let chance = 75;
    
    const wageRatio = wage / negotiationState.initialWage;
    if (wageRatio > 1) {
        chance -= (wageRatio - 1) * 75;
    } else {
        chance += (1 - wageRatio) * 20;
    }
    
    if (duration > 3) {
        chance += (duration - 3) * 5;
    } else if (duration < 3) {
        chance -= (3 - duration) * 8;
    }
    
    const powerDiff = p.ovr - team.power;
    if (role === 'Star') {
        if (powerDiff < -3) {
            chance -= 25;
        } else {
            chance -= 10;
        }
    } else if (role === 'Rotation') {
        chance += 10;
    }
    
    const managerTrustBonus = (p.managerTrust - 50) * 0.4;
    const formBonus = (p.form - 70) * 0.2;
    
    chance += managerTrustBonus + formBonus;
    chance = Math.max(5, Math.min(99, Math.round(chance)));
    
    document.getElementById('neg-chance-percent').textContent = `%${chance}`;
    document.getElementById('neg-chance-fill').style.width = `${chance}%`;
}

function submitCounterOffer() {
    const chanceText = document.getElementById('neg-chance-percent').textContent;
    const chance = parseInt(chanceText.replace('%', '')) || 50;
    
    const roll = Math.floor(Math.random() * 100) + 1;
    const isAccepted = roll <= chance;
    
    const p = gameState.player;
    const modal = document.getElementById('contract-negotiation-modal');
    const totalWeeks = ((gameState.currentSeason - START_SEASON) * 36) + gameState.currentWeek;   // kariyer-toplam hafta (requestContractNegotiation ile aynı birim)

    modal.style.display = 'none';

    if (isAccepted) {
        p.wage = negotiationState.proposedWage;
        p.contractDuration = negotiationState.proposedDuration;
        p.lastContractRenewalWeek = totalWeeks;
        
        let roleName = "İlk 11 Oyuncusu";
        if (negotiationState.proposedRole === 'Star') roleName = "Takımın Yıldızı";
        else if (negotiationState.proposedRole === 'Rotation') roleName = "Yedek / Rotasyon";
        
        showToast(`Tebrikler! Kulübün teklifini kabul etti. Yeni maaşın: ${p.wage.toLocaleString('tr-TR')} € (Rol: ${roleName})`, 'success');
        
        p.managerTrust = Math.min(100, p.managerTrust + 5);
        p.value = Math.round(p.value * 1.1);
    } else {
        showToast("Yönetim teklifini reddetti ve masadan kalktı!", "error");
        p.managerTrust = Math.max(10, p.managerTrust - 8);
        p.negotiationBlockUntil = totalWeeks + 10;   // kariyer-toplam hafta → sezon devrinde blok doğru sona erer
    }
    
    saveGame();
    updateUI();
}

// ================= TRANSFER PAZARLIK SİSTEMİ =================
let transferNegotiationState = {
    offerIndex: null,
    originalOffer: null,
    proposedWage: 0,
    proposedDuration: 3,
    proposedRole: 'İlk 11'
};

function openTransferNegotiationModal(offerIndex) {
    const offer = gameState.transferOffers[offerIndex];
    if (!offer) return;
    
    const p = gameState.player;
    const club = getTeamById(offer.clubId);
    
    transferNegotiationState.offerIndex = offerIndex;
    transferNegotiationState.originalOffer = { ...offer };
    transferNegotiationState.proposedWage = offer.wage;
    transferNegotiationState.proposedDuration = offer.duration;
    transferNegotiationState.proposedRole = offer.squadRole;
    
    // Modal içeriğini doldur
    document.getElementById('tneg-club-subtitle').textContent = `${offer.clubName} ile masaya oturuyorsun.`;
    document.getElementById('tneg-initial-offer-desc').innerHTML = `
        Kulübün Teklifi: Haftalık <strong>${offer.wage.toLocaleString('tr-TR')} €</strong> maaş, 
        <strong>${offer.duration} yıl</strong> sözleşme süresi ve <strong>${offer.squadRole}</strong> rolü öneriyoruz.
    `;
    
    // Slider'ları ayarla
    const wageSlider = document.getElementById('tneg-slider-wage');
    wageSlider.min = Math.max(500, Math.round(offer.wage * 0.3));
    wageSlider.max = Math.round(offer.wage * 4);
    wageSlider.step = 500;
    wageSlider.value = offer.wage;
    
    const durationSlider = document.getElementById('tneg-slider-duration');
    durationSlider.value = offer.duration;
    
    // Rol dropdown'ını ayarla
    const roleSelect = document.getElementById('tneg-select-role');
    roleSelect.value = offer.squadRole;
    
    // Değerleri göster
    document.getElementById('tneg-val-wage').textContent = `${offer.wage.toLocaleString('tr-TR')} €`;
    document.getElementById('tneg-val-duration').textContent = `${offer.duration} Yıl`;
    
    updateTransferNegotiationProbability();
    
    // Transfer modal'ını kapat, pazarlık modal'ını aç
    document.getElementById('transfer-modal').style.display = 'none';
    document.getElementById('transfer-negotiation-modal').style.display = 'flex';
}

function updateTransferNegotiationProbability() {
    const p = gameState.player;
    const offer = transferNegotiationState.originalOffer;
    if (!offer) return;
    
    const club = getTeamById(offer.clubId);
    
    const wage = parseInt(document.getElementById('tneg-slider-wage').value) || 5000;
    const duration = parseInt(document.getElementById('tneg-slider-duration').value) || 3;
    const role = document.getElementById('tneg-select-role').value || 'İlk 11';
    
    transferNegotiationState.proposedWage = wage;
    transferNegotiationState.proposedDuration = duration;
    transferNegotiationState.proposedRole = role;
    
    // Kabul olasılığı hesaplama
    let chance = 70;
    
    // Maaş oranı: orijinal teklife göre ne kadar fazla istiyorsun?
    const wageRatio = wage / offer.wage;
    if (wageRatio > 1) {
        chance -= (wageRatio - 1) * 80; // Fazla istersen şans düşer
    } else {
        chance += (1 - wageRatio) * 25; // Az istersen şans artar
    }
    
    // Süre etkisi: uzun süre kulübe avantajlı
    if (duration > offer.duration) {
        chance += (duration - offer.duration) * 6;
    } else if (duration < offer.duration) {
        chance -= (offer.duration - duration) * 10;
    }
    
    // Rol etkisi: yüksek rol talebi
    const roleHierarchy = { 'Yedek Kadro': 0, 'Altyapı / Rotasyon': 1, 'Rotasyon': 2, 'İlk 11': 3, 'Kilit Oyuncu': 4 };
    const offeredRoleVal = roleHierarchy[offer.squadRole] || 2;
    const requestedRoleVal = roleHierarchy[role] || 2;
    if (requestedRoleVal > offeredRoleVal) {
        chance -= (requestedRoleVal - offeredRoleVal) * 15;
    } else if (requestedRoleVal < offeredRoleVal) {
        chance += (offeredRoleVal - requestedRoleVal) * 8;
    }
    
    // OVR bonus/malus
    const ovrDiff = p.ovr - club.power;
    if (ovrDiff > 0) {
        chance += ovrDiff * 1.5; // Oyuncu takımdan iyiyse şans artar
    } else {
        chance += ovrDiff * 0.8; // Oyuncu takımdan kötüyse şans azalır
    }
    
    // Yaş etkisi: genç oyunculara takımlar daha hoşgörülü değil
    if (p.age <= 19) {
        chance -= 10; // Genç oyuncuya yüksek maaş vermek istemezler
    }
    
    chance = Math.max(3, Math.min(98, Math.round(chance)));
    
    // Renk değişimi
    const percentEl = document.getElementById('tneg-chance-percent');
    const fillEl = document.getElementById('tneg-chance-fill');
    
    percentEl.textContent = `%${chance}`;
    fillEl.style.width = `${chance}%`;
    
    // Renk: düşük ihtimal kırmızı, yüksek yeşil
    if (chance < 25) {
        percentEl.style.color = 'var(--danger)';
        fillEl.style.background = 'linear-gradient(90deg, #ff1744, #ff5252)';
    } else if (chance < 50) {
        percentEl.style.color = '#ffa726';
        fillEl.style.background = 'linear-gradient(90deg, #ff9800, #ffb74d)';
    } else {
        percentEl.style.color = 'var(--accent)';
        fillEl.style.background = 'var(--accent-gradient)';
    }
}

function submitTransferCounterOffer() {
    const chanceText = document.getElementById('tneg-chance-percent').textContent;
    const chance = parseInt(chanceText.replace('%', '')) || 50;
    
    const roll = Math.floor(Math.random() * 100) + 1;
    const isAccepted = roll <= chance;
    
    const p = gameState.player;
    const modal = document.getElementById('transfer-negotiation-modal');
    const offer = transferNegotiationState.originalOffer;
    
    modal.style.display = 'none';
    
    if (isAccepted) {
        // ORTAK kabul yolu (60-ui acceptTransferOffer): bonservis (applyTransferFee +
        // clubSpend), kiralık/kalıcı ayrımı (onLoan/loanReturn) ve transfer geçmişi
        // doğrudan kabulle BİREBİR aynı işler. (Eskiden bu blok kendi başına taşıma
        // yapıyordu: bonservis ödenmiyor, kiralık teklif kalıcı transfere dönüşüyordu.)
        if (typeof acceptTransferOffer === 'function') {
            acceptTransferOffer(offer, {
                wage: transferNegotiationState.proposedWage,
                duration: transferNegotiationState.proposedDuration,
                viaNegotiation: true,
            });
        }
    } else {
        showToast(`${offer.clubName} karşı teklifini reddetti! Şartlarını kabul etmediler.`, 'error');
        
        // Reddedilen teklifte maaşı biraz düşür (kulüp kızar)
        if (transferNegotiationState.offerIndex !== null && gameState.transferOffers[transferNegotiationState.offerIndex]) {
            gameState.transferOffers[transferNegotiationState.offerIndex].wage = Math.round(offer.wage * 0.85);
            showToast(`${offer.clubName} orijinal teklifini de düşürdü. Yeni maaş teklifi: ${gameState.transferOffers[transferNegotiationState.offerIndex].wage.toLocaleString('tr-TR')} €`, 'warning');
        }
    }
    
    transferNegotiationState.offerIndex = null;
    transferNegotiationState.originalOffer = null;
    
    saveGame();
    updateUI();
}

