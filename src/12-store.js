// ============================================================================
//  12-store.js  —  IndexedDB kayıt aynası (dayanıklılık) + .json dışa/içe aktarma.
//  Çekirdek kayıt hâlâ localStorage'da (senkron, hızlı). IndexedDB write-through
//  ile yedeklenir; localStorage temizlenirse boot'ta geri yüklenir. Tarayıcıda
//  hazır gelir, kurulum gerektirmez. Dünya maç/oyuncu geçmişi DETERMINISTIK
//  üretildiği için ayrıca saklanmaz (boyut sıfır).
// ============================================================================
(function () {
    const DB_NAME = 'fc_saves_db', STORE = 'saves', VER = 1;
    let _dbp = null;

    function _open() {
        if (_dbp) return _dbp;
        _dbp = new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB yok')); return; }
            const req = indexedDB.open(DB_NAME, VER);
            req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' }); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return _dbp;
    }
    function _tx(mode) { return _open().then(db => db.transaction(STORE, mode).objectStore(STORE)); }

    // localStorage anahtar uretici (70-save ile ayni); runtime'da slotKey varsa onu kullan
    function _slotKey(i) { return (typeof slotKey === 'function') ? slotKey(i) : ('football_career_slot_' + i); }

    // Write-through: bir slotun JSON'unu IndexedDB'ye yansit (fire-and-forget)
    function storeMirrorSave(slot, jsonStr) {
        if (slot == null) return;
        _tx('readwrite').then(os => os.put({ slot: slot, data: jsonStr, ts: Date.now() }))
            .catch(() => {/* IndexedDB yoksa sessizce gec — localStorage zaten birincil */});
    }

    // Bir slotu IndexedDB aynasindan da sil (deleteSlot ile birlikte cagrilir).
    // Aksi halde silinen kariyer boot'ta storeHydrateMissingSlots ile geri gelir.
    function storeDeleteSlot(slot) {
        if (slot == null) return Promise.resolve();
        return _tx('readwrite').then(os => new Promise((resolve) => {
            const req = os.delete(slot);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        })).catch(() => false);
    }

    // Boot: localStorage'da olmayan ama IndexedDB'de olan slotlari geri yukle
    function storeHydrateMissingSlots() {
        return _tx('readonly').then(os => new Promise((resolve) => {
            const out = [];
            const req = os.openCursor();
            req.onsuccess = (e) => {
                const cur = e.target.result;
                if (cur) {
                    const rec = cur.value;
                    try {
                        if (rec && rec.data && !localStorage.getItem(_slotKey(rec.slot))) {
                            localStorage.setItem(_slotKey(rec.slot), rec.data);
                            out.push(rec.slot);
                        }
                    } catch (_) {}
                    cur.continue();
                } else resolve(out);
            };
            req.onerror = () => resolve(out);
        })).catch(() => []);
    }

    // ---- .json dışa aktarma (aktif/verilen slot) ----
    function exportSaveToFile(slot) {
        slot = (slot != null) ? slot : (typeof activeSlotIndex === 'function' ? activeSlotIndex() : (gameState && gameState._slot));
        let raw = (slot != null) ? localStorage.getItem(_slotKey(slot)) : null;
        if (!raw && gameState && gameState.player) raw = JSON.stringify(gameState);
        if (!raw) { if (typeof showToast === 'function') showToast('Dışa aktarılacak kayıt bulunamadı.', 'error'); return; }
        let name = 'kariyer', season = '';
        try { const o = JSON.parse(raw); if (o.player) name = `${o.player.firstname || ''}_${o.player.lastname || ''}`.trim() || 'kariyer'; season = o.currentSeason || ''; } catch (_) {}
        const blob = new Blob([raw], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `fc_${name}_S${season}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (typeof showToast === 'function') showToast('Kariyer .json olarak indirildi.', 'success');
    }

    // ---- .json içe aktarma -> bos slota (veya ilk bos) ----
    function importSaveFromFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            let obj;
            try { obj = JSON.parse(reader.result); } catch (e) { if (typeof showToast === 'function') showToast('Geçersiz dosya (JSON okunamadı).', 'error'); return; }
            if (!obj || !obj.player) { if (typeof showToast === 'function') showToast('Bu dosya bir kariyer kaydı değil.', 'error'); return; }
            const empty = (typeof firstEmptySlot === 'function') ? firstEmptySlot() : null;
            const write = (target) => {
                obj._slot = target;
                const jsonStr = JSON.stringify(obj);
                try { localStorage.setItem(_slotKey(target), jsonStr); } catch (e) { if (typeof showToast === 'function') showToast('Kayıt yazılamadı (depolama dolu olabilir).', 'error'); return; }
                storeMirrorSave(target, jsonStr);
                // Bu slotun ESKİ kariyerine ait dünya verisini (fc_world_db) temizle —
                // yoksa eski maç/oyuncu kayıtları içe aktarılan kariyere karışır. İçe
                // aktarılan kariyer ilk yüklemede (loadCareerSlot) yeniden tohumlanır.
                try { if (window.WorldDB && typeof WorldDB.clearSlot === 'function') WorldDB.clearSlot(target); } catch (e) { /* sessiz */ }
                if (typeof renderMainMenu === 'function') renderMainMenu();
                if (typeof showToast === 'function') showToast(`Kariyer içe aktarıldı (Slot ${target + 1}).`, 'success');
            };
            if (empty !== null && empty !== undefined) { write(empty); return; }
            // Boş slot yok: üzerine yazmadan önce onay iste (veri kaybı koruması)
            const ask = (typeof gameConfirm === 'function')
                ? gameConfirm({ title: 'Tüm Slotlar Dolu', danger: true, confirmText: '1. Slotun Üzerine Yaz', cancelText: 'Vazgeç', message: 'Boş kariyer slotu yok. İçe aktarmak için 1. slottaki kariyerin üzerine yazılsın mı? Bu işlem geri alınamaz.' })
                : Promise.resolve(window.confirm('Boş slot yok. 1. slotun üzerine yazılsın mı?'));
            ask.then(ok => { if (ok) write(0); });
        };
        reader.readAsText(file);
    }

    // ---- Boot bağlama: hydrate + export/import butonları ----
    function _wire() {
        storeHydrateMissingSlots().then(restored => {
            if (restored && restored.length && typeof renderMainMenu === 'function') {
                const mm = document.getElementById('main-menu-screen');
                if (mm && mm.classList.contains('active')) renderMainMenu();
            }
        });
        const exp = document.getElementById('btn-export-save');
        const imp = document.getElementById('btn-import-save');
        const impInput = document.getElementById('import-save-input');
        if (exp && !exp._bound) {
            exp._bound = true;
            exp.addEventListener('click', () => {
                // İşaretli kariyer(ler)i dışa aktar; her biri ayrı .json. Seçim yoksa aktif slotu dene.
                let slots = Array.from(document.querySelectorAll('.slot-export-check:checked')).map(c => parseInt(c.dataset.slot));
                if (!slots.length) {
                    const active = (typeof activeSlotIndex === 'function') ? activeSlotIndex() : null;
                    if (active != null && localStorage.getItem(_slotKey(active))) slots = [active];
                }
                if (!slots.length) {
                    if (typeof showToast === 'function') showToast('Önce dışa aktarmak istediğin kariyerin kutucuğunu işaretle.', 'info');
                    return;
                }
                // Birden fazla indirme tarayıcıda boğulmasın diye küçük aralıkla tetikle
                slots.forEach((s, i) => setTimeout(() => exportSaveToFile(s), i * 400));
                if (slots.length > 1 && typeof showToast === 'function') showToast(`${slots.length} kariyer ayrı .json olarak indiriliyor…`, 'success');
            });
        }
        if (imp && impInput && !imp._bound) { imp._bound = true; imp.addEventListener('click', () => impInput.click()); }
        if (impInput && !impInput._bound) { impInput._bound = true; impInput.addEventListener('change', (e) => { if (e.target.files && e.target.files[0]) importSaveFromFile(e.target.files[0]); e.target.value = ''; }); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire); else _wire();

    window.storeMirrorSave = storeMirrorSave;
    window.storeDeleteSlot = storeDeleteSlot;
    window.storeHydrateMissingSlots = storeHydrateMissingSlots;
    window.exportSaveToFile = exportSaveToFile;
    window.importSaveFromFile = importSaveFromFile;
})();
