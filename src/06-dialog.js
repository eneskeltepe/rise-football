// ============================================================================
//  06-dialog.js  —  Modern, Promise-tabanli onay/uyari modali (alert/confirm yerine)
//  05-core.js'ten SONRA yuklenir (showToast'a baglidir). Tum window.*'a export.
// ============================================================================
(function () {
    let _busy = false;          // ayni anda tek dialog
    let _escHandler = null;
    let _overlayCancel = function () {};

    function _els() {
        return {
            ov: document.getElementById('game-dialog-overlay'),
            icon: document.querySelector('#game-dialog-overlay .game-dialog-icon'),
            title: document.querySelector('#game-dialog-overlay .game-dialog-title'),
            msg: document.querySelector('#game-dialog-overlay .game-dialog-msg'),
            actions: document.querySelector('#game-dialog-overlay .game-dialog-actions'),
        };
    }

    function _open(e) {
        e.ov.style.display = 'flex';
        void e.ov.offsetWidth;              // reflow zorla -> gecis guvenilir tetiklenir
        e.ov.classList.add('visible');
        document.body.classList.add('dialog-open');
        e.ov.onclick = (ev) => { if (ev.target === e.ov) _overlayCancel(); };
    }
    function _bindEsc(cb) {
        _overlayCancel = cb;
        if (_escHandler) document.removeEventListener('keydown', _escHandler);
        _escHandler = (ev) => { if (ev.key === 'Escape') cb(); };
        document.addEventListener('keydown', _escHandler);
    }
    function _close() {
        const e = _els(); if (!e.ov) return;
        e.ov.classList.remove('visible');
        document.body.classList.remove('dialog-open');
        if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
        _overlayCancel = function () {};
        setTimeout(() => { e.ov.style.display = 'none'; _busy = false; }, 200);
    }

    // Mesaj gövdesi: html:true ise biçimli (yalnız kod-içi sabit metinler; kullanıcı girdisi verme)
    function _setMsg(e, o) {
        if (o.html) e.msg.innerHTML = o.message || '';
        else e.msg.textContent = o.message || '';
    }

    // opts: string | { title, message, html, confirmText, cancelText, danger, icon }
    function gameConfirm(opts) {
        const o = typeof opts === 'string' ? { message: opts } : (opts || {});
        return new Promise((resolve) => {
            const e = _els();
            if (!e.ov) { resolve(window.confirm(o.message || '')); return; }   // fallback
            if (_busy) { resolve(false); return; }
            _busy = true;
            e.icon.className = 'game-dialog-icon' + (o.danger ? ' danger' : '');
            e.icon.innerHTML = `<i class="fa-solid ${o.icon || (o.danger ? 'fa-triangle-exclamation' : 'fa-circle-question')}"></i>`;
            e.title.textContent = o.title || (o.danger ? 'Emin misin?' : 'Onay');
            _setMsg(e, o);
            e.actions.innerHTML = '';
            const cancel = document.createElement('button');
            cancel.className = 'btn btn-secondary';
            cancel.textContent = o.cancelText || 'Vazgeç';
            const ok = document.createElement('button');
            ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
            ok.textContent = o.confirmText || 'Onayla';
            const done = (val) => { _close(); resolve(val); };
            cancel.onclick = () => done(false);
            ok.onclick = () => done(true);
            e.actions.append(cancel, ok);
            _open(e); _bindEsc(() => done(false));
            setTimeout(() => ok.focus(), 30);
        });
    }

    // Tek butonlu bilgi modali (alert yerine). Promise<void>
    function gameAlert(opts) {
        const o = typeof opts === 'string' ? { message: opts } : (opts || {});
        return new Promise((resolve) => {
            const e = _els();
            if (!e.ov) { window.alert(o.message || ''); resolve(); return; }
            if (_busy) { resolve(); return; }
            _busy = true;
            e.icon.className = 'game-dialog-icon';
            e.icon.innerHTML = `<i class="fa-solid ${o.icon || 'fa-circle-info'}"></i>`;
            e.title.textContent = o.title || 'Bilgi';
            _setMsg(e, o);
            e.actions.innerHTML = '';
            const ok = document.createElement('button');
            ok.className = 'btn btn-primary';
            ok.textContent = o.confirmText || 'Tamam';
            const done = () => { _close(); resolve(); };
            ok.onclick = done;
            e.actions.append(ok);
            _open(e); _bindEsc(done);
            setTimeout(() => ok.focus(), 30);
        });
    }

    window.gameConfirm = gameConfirm;
    window.gameAlert = gameAlert;
})();
