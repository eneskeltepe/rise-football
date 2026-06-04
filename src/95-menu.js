// ============================================================================
//  95-menu.js  —  Açılış ekranı / 10 kayıt slotu UI + boot yönlendirme + avatar
//  En son yüklenir; oyunun giriş noktası (boot) burada yönetilir.
// ============================================================================

const ALL_SCREENS = ['main-menu-screen', 'creation-screen', 'game-interface', 'matchday-screen'];
function showScreen(id) {
    ALL_SCREENS.forEach(s => { const el = document.getElementById(s); if (el) el.classList.toggle('active', s === id); });
}

// ---- Avatar galerisi (FM-tarzı gerçekçi yüzler + sade çizim alternatifleri) ----
// Gerçek portre fotoğrafları (anahtarsız, FM "regen" hissine en yakın). 70 farklı yüz.
function _faceUrl(n) { return `https://i.pravatar.cc/200?img=${((n - 1) % 70) + 1}`; }
// Karikatür/emoji/robot stiller çıkarıldı; sade & gerçekçiye yakın DiceBear stilleri kaldı.
const AVATAR_STYLES = ['lorelei', 'notionists', 'personas', 'adventurer'];
function _avatarUrl(style, seed) {
    return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=50`;
}
function buildAvatarGallery() {
    const out = [];
    for (let i = 1; i <= 14; i++) out.push(_faceUrl(i));        // 14 gerçek portre
    const seeds = ['Aslan', 'Kartal', 'Yildiz', 'Efsane', 'Kaptan', 'Sahin'];
    for (let i = 0; i < 6; i++) out.push(_avatarUrl(AVATAR_STYLES[i % AVATAR_STYLES.length], seeds[i] + i)); // 6 sade çizim
    return out;
}

// Yüklenen resmi 128px kare'ye küçült (kayıt boyutu için JPEG ~8KB)
function _resizeToDataUrl(dataUrl, size, cb) {
    const img = new Image();
    img.onload = () => {
        try {
            const c = document.createElement('canvas'); c.width = size; c.height = size;
            const ctx = c.getContext('2d');
            const s = Math.min(img.width, img.height);
            const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
            ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
            cb(c.toDataURL('image/jpeg', 0.85));
        } catch (e) { cb(dataUrl); }
    };
    img.onerror = () => cb(dataUrl);
    img.src = dataUrl;
}

function _setAvatarPreview(url) {
    const prev = document.getElementById('avatar-preview');
    const clearBtn = document.getElementById('btn-avatar-clear');
    const hidden = document.getElementById('player-img');
    if (hidden) hidden.value = url || '';
    if (prev) {
        if (url) { prev.innerHTML = `<img src="${url}" alt="avatar">`; prev.classList.add('has-img'); }
        else { prev.innerHTML = '<i class="fa-solid fa-user"></i>'; prev.classList.remove('has-img'); }
    }
    if (clearBtn) clearBtn.style.display = url ? '' : 'none';
}

function _renderAvatarGallery() {
    const g = document.getElementById('avatar-gallery');
    if (!g || g.dataset.built) return;
    g.dataset.built = '1';
    buildAvatarGallery().forEach(url => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'avatar-choice';
        b.innerHTML = `<img src="${url}" loading="lazy" alt="">`;
        b.addEventListener('click', () => {
            _setAvatarPreview(url);
            g.querySelectorAll('.avatar-choice').forEach(x => x.classList.remove('sel'));
            b.classList.add('sel');
        });
        g.appendChild(b);
    });
}

let _creationExtrasWired = false;
function wireCreationExtras() {
    if (_creationExtrasWired) return;
    _creationExtrasWired = true;
    const galBtn = document.getElementById('btn-avatar-gallery');
    const upBtn = document.getElementById('btn-avatar-upload');
    const clrBtn = document.getElementById('btn-avatar-clear');
    const fileIn = document.getElementById('avatar-file-input');
    const gallery = document.getElementById('avatar-gallery');

    if (galBtn && gallery) galBtn.addEventListener('click', () => {
        const show = gallery.style.display === 'none' || !gallery.style.display;
        gallery.style.display = show ? 'grid' : 'none';
        if (show) _renderAvatarGallery();
    });
    if (upBtn && fileIn) {
        upBtn.addEventListener('click', () => fileIn.click());
        fileIn.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0]; if (!f) return;
            if (f.size > 6 * 1024 * 1024) { showToast('Resim çok büyük (maks 6MB).', 'error'); return; }
            const reader = new FileReader();
            reader.onload = ev => _resizeToDataUrl(ev.target.result, 128, url => _setAvatarPreview(url));
            reader.readAsDataURL(f);
            fileIn.value = '';
        });
    }
    if (clrBtn) clrBtn.addEventListener('click', () => {
        _setAvatarPreview('');
        if (gallery) gallery.querySelectorAll('.avatar-choice').forEach(x => x.classList.remove('sel'));
    });

    const freeChk = document.getElementById('start-free-agent');
    if (freeChk) freeChk.addEventListener('change', () => {
        document.querySelectorAll('.club-field').forEach(el => el.style.display = freeChk.checked ? 'none' : '');
    });

    const back = document.getElementById('btn-creation-back');
    if (back) back.addEventListener('click', () => { renderMainMenu(); showScreen('main-menu-screen'); });
    const hMenu = document.getElementById('btn-header-menu');
    if (hMenu) hMenu.addEventListener('click', goToMainMenu);
}

// ---- Ana menü ----
function renderMainMenu() {
    const grid = document.getElementById('career-slots-grid');
    if (!grid) return;
    grid.innerHTML = '';
    listSaveSlots().forEach(({ index, meta }) => {
        const card = document.createElement('div');
        if (meta) {
            card.className = 'career-slot filled';
            const date = meta.savedAt ? new Date(meta.savedAt).toLocaleDateString('tr-TR') : '';
            const logo = (typeof getTeamLogoHtml === 'function') ? getTeamLogoHtml(meta.teamId, 20) : '';
            const avatar = meta.img
                ? `<img src="${meta.img}" class="slot-avatar-img" alt="">`
                : `<div class="slot-avatar-fallback"><i class="fa-solid fa-user"></i></div>`;
            const posShort = (POS_BY_KEY[meta.pos] || {}).short || meta.pos;
            card.innerHTML = `
                <label class="slot-export-pick" title="Dışa aktarmak için seç">
                    <input type="checkbox" class="slot-export-check" data-slot="${index}">
                </label>
                <button class="slot-delete" title="Sil" data-del="${index}"><i class="fa-solid fa-trash"></i></button>
                <div class="slot-main" data-load="${index}">
                    <div class="slot-avatar">${avatar}</div>
                    <div class="slot-info">
                        <div class="slot-name">${meta.name}</div>
                        <div class="slot-club">${logo}<span>${meta.club}</span></div>
                        <div class="slot-meta-row">
                            <span class="slot-ovr">${meta.ovr} OVR</span>
                            <span class="slot-badge">${posShort}</span>
                            <span class="slot-age">${meta.age} yaş</span>
                        </div>
                        <div class="slot-foot">${meta.season} Sezonu • Hafta ${meta.week}${date ? ' • ' + date : ''}</div>
                    </div>
                </div>`;
        } else {
            card.className = 'career-slot empty';
            card.dataset.new = index;
            card.innerHTML = `<div class="slot-empty-inner"><i class="fa-solid fa-plus"></i><span>Yeni Kariyer</span><small>Slot ${index + 1}</small></div>`;
        }
        grid.appendChild(card);
    });
    grid.querySelectorAll('[data-load]').forEach(el => el.addEventListener('click', () => loadCareerSlot(parseInt(el.dataset.load))));
    grid.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteSlot(parseInt(el.dataset.del)); }));
    grid.querySelectorAll('.career-slot.empty').forEach(el => el.addEventListener('click', () => startNewCareer(parseInt(el.dataset.new))));
    // Dışa aktarma seçim kutuları: kart yüklemesini tetiklemesin
    grid.querySelectorAll('.slot-export-pick').forEach(el => el.addEventListener('click', (e) => e.stopPropagation()));

    const cont = document.getElementById('btn-menu-continue');
    const act = activeSlotIndex();
    const actMeta = act !== null ? slotMeta(act) : null;
    if (cont) {
        if (actMeta) {
            cont.style.display = '';
            const lbl = document.getElementById('btn-menu-continue-label');
            if (lbl) lbl.textContent = `Devam Et — ${actMeta.name}`;
            cont.onclick = () => loadCareerSlot(act);
        } else { cont.style.display = 'none'; }
    }
}

function confirmDeleteSlot(i) {
    const m = slotMeta(i);
    if (!m) return;
    gameConfirm({ title: 'Kariyeri Sil', danger: true, confirmText: 'Sil', cancelText: 'Vazgeç',
        message: `"${m.name}" kariyerini silmek istediğine emin misin? Bu işlem geri alınamaz.` }).then(ok => {
        if (!ok) return;
        deleteSlot(i);
        renderMainMenu();
        showToast('Kariyer silindi.', 'info');
    });
}

function startNewCareer(slotIndex) {
    const target = (slotIndex !== undefined && slotIndex !== null && !isNaN(slotIndex)) ? slotIndex : firstEmptySlot();
    if (target === null) { showToast('Tüm slotlar dolu! Önce bir kariyer sil.', 'error'); return; }
    gameState.player = null;
    gameState._slot = null;
    gameState._pendingSlot = target;
    showScreen('creation-screen');
    setupCreationScreen();
    // formu sıfırla
    _setAvatarPreview('');
    const freeChk = document.getElementById('start-free-agent');
    if (freeChk) { freeChk.checked = false; document.querySelectorAll('.club-field').forEach(el => el.style.display = ''); }
    const g = document.getElementById('avatar-gallery'); if (g) { g.style.display = 'none'; g.querySelectorAll('.avatar-choice').forEach(x => x.classList.remove('sel')); }
}

function loadCareerSlot(i) {
    if (loadFromSlot(i)) {
        showScreen('game-interface'); updateUI();
        // FAZ 4: yaşayan dünya overlay'ini yükle (emekli/regen/transfer) → hazır olunca yeniden render.
        try {
            if (window.WorldState && gameState._slot != null)
                WorldState.ensure(gameState._slot).then(() => { if (typeof updateUI === 'function') updateUI(); });
        } catch (e) { /* overlay yoksa oyun v2.0 gibi çalışır */ }
    }
    else showToast('Kayıt yüklenemedi.', 'error');
}

function goToMainMenu() {
    if (gameState.player) saveGame();
    renderMainMenu();
    showScreen('main-menu-screen');
}

// ---- Boot (giriş noktası; 05-core load handler buraya delege eder) ----
function bootGame() {
    try { migrateLegacyToSlots(); } catch (e) { console.warn(e); }
    try { setupCreationScreen(); } catch (e) { console.warn(e); }   // formu arka planda hazırla
    try { wireCreationExtras(); } catch (e) { console.warn(e); }
    renderMainMenu();
    showScreen('main-menu-screen');
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        showScreen, bootGame, renderMainMenu, startNewCareer, loadCareerSlot,
        goToMainMenu, confirmDeleteSlot, wireCreationExtras, buildAvatarGallery, _setAvatarPreview,
    });
}
