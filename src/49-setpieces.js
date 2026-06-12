// ============================================================================
//  49-setpieces.js  —  DURAN TOP SİSTEMİ.
//  (A4) Penaltıcı/Frikikçi GÖREVİ: hoca, penalti/serbestVurus alt-statı + güvene
//       göre görevi verir/alır (histerezisli; advanceWeek'ten haftalık kontrol).
//       Canlı maçta görevli KULLANICI penaltı/frikik kullanır; kaleciysen rakip
//       penaltısını kurtarmaya çalışırsın — karar-anı modalıyla.
//  (A5) KUPA ELEMESİNDE BERABERLİK: tek zar yerine UZATMA (güç-bazlı kısa sim)
//       + hâlâ eşitse SERİ PENALTI. Kullanıcı sahada bitirdiyse ETKİLEŞİMLİ
//       (atışını/köşeni seç; kaleciysen her atışta tahmin); değilse hızlı sim.
//       Sonuç rd.penScore'a yazılır, özette ve eleme listesinde görünür.
//  45-matchengine (ticker hook + resolvePlayerDecision) ve 85-euro (beraberlik
//  çözümü) üzerine çalışır; 48-awards'tan sonra yüklenir.
// ============================================================================

// ---- A4a: Görev atama (histerezis: kazanmak için yüksek, kaybetmek için düşük eşik) ----
function updateSetPieceDuty(quiet) {
    const p = gameState.player;
    if (!p) return null;
    if (!p.setPieceDuty) p.setPieceDuty = { pen: false, fk: false };
    const d = p.setPieceDuty;
    if (!p.teamId || p.position === 'Kaleci') { d.pen = false; d.fk = false; return d; }
    const a = p.attrs || {};
    const trust = p.managerTrust || 50;
    const before = { pen: d.pen, fk: d.fk };
    if (!d.pen && (a.penalti || 0) >= 70 && trust >= 55) d.pen = true;
    else if (d.pen && ((a.penalti || 0) < 66 || trust < 45)) d.pen = false;
    if (!d.fk && (a.serbestVurus || 0) >= 72 && trust >= 55) d.fk = true;
    else if (d.fk && ((a.serbestVurus || 0) < 68 || trust < 45)) d.fk = false;
    if (!quiet && typeof showToast === 'function') {
        if (d.pen && !before.pen) showToast('Hoca: "Penaltıları artık SEN kullanıyorsun!" ⚽', 'success');
        if (!d.pen && before.pen) showToast('Hoca penaltı görevini başka oyuncuya verdi.', 'info');
        if (d.fk && !before.fk) showToast('Hoca: "Frikikler senin sorumluluğunda!" 🎯', 'success');
        if (!d.fk && before.fk) showToast('Hoca frikik görevini başka oyuncuya verdi.', 'info');
    }
    return d;
}

// ---- A4b: şans formülleri (gösterilen % = gerçek şans; saf, test edilebilir) ----
function _penKickChance(attrs) { return Math.max(45, Math.min(92, Math.round(58 + (((attrs || {}).penalti || 50) - 50) * 0.75))); }
function _fkGoalChance(attrs) { return Math.max(12, Math.min(62, Math.round(20 + (((attrs || {}).serbestVurus || 50) - 50) * 0.8))); }
function _gkPenSaveChance(attrs) { return Math.max(18, Math.min(55, Math.round(28 + (((attrs || {}).gkRefleks || 50) - 50) * 0.45))); }

// ---- Karar modalını duran-top seçenekleriyle doldur (triggerPlayerDecision ile aynı DOM) ----
function _openSetPieceDecision(text, options) {
    const decisionBox = document.getElementById('match-decision-box');
    const decisionText = document.getElementById('decision-text');
    const optionsContainer = document.getElementById('decision-options');
    if (!decisionBox || !decisionText || !optionsContainer) return false;
    decisionText.textContent = text;
    optionsContainer.innerHTML = '';
    options.forEach(o => {
        const btn = document.createElement('button');
        btn.className = 'btn-decision';
        btn.innerHTML = `<span>${o.name}</span><span class="desc-chance">%${o.chance} ${o.label}</span>`;
        btn.addEventListener('click', () => o.onPick());
        optionsContainer.appendChild(btn);
    });
    decisionBox.style.display = 'flex';
    return true;
}

// Kullanıcı PENALTI kullanır (görevli + sahada) — resolvePlayerDecision gol yolunu işletir.
function _userPenaltyMoment() {
    const a = (gameState.player.attrs) || {};
    const base = _penKickChance(a);
    addCommentary(activeMatch.minute, 'PENALTI! Hakem noktayı gösterdi — topun başına penaltıcımız olarak SEN geçiyorsun!', 'interactive');
    const mk = (name, chance, success, fail) => {
        const ch = Math.max(30, Math.min(94, chance));
        const opt = { name, stat: 'sut', difficulty: 0, isGoal: true, isPenalty: true, success, fail };
        return { name, chance: ch, label: 'Gol Şansı (PENALTI)', onPick: () => resolvePlayerDecision(opt, ch) };
    };
    _openSetPieceDecision('Penaltı noktasındasın. Nasıl vuracaksın?', [
        mk('Köşeye sert vur', base, 'GOOOL! Penaltıyı köşeye çakıp ağları havalandırdın!', 'Sert vurdun ama kaleci köşeye uzanıp penaltını KURTARDI!'),
        mk('Plase ile yerleştir', base + 4, 'GOOOL! Kaleci ters köşede — topu zarif bir plaseyle ağlara bıraktın!', 'Plase vuruşun yumuşak kaldı, kaleci topu kucakladı.'),
        mk('Panenka çip dene', base - 14, 'GOOOL! PANENKA! Kaleci köşeye uçtu, sen topu ortaya kondurdun — tribünler çıldırdı!', 'Panenka denedin ama kaleci ortada bekledi... Top ellerinde. Büyük risk geri tepti!'),
    ]);
}

// Kullanıcı FRİKİK kullanır (görevli + sahada).
function _userFreeKickMoment() {
    const a = (gameState.player.attrs) || {};
    const direct = _fkGoalChance(a);
    const cross = Math.max(18, Math.min(60, Math.round(30 + ((a.ortaPas || 50) - 50) * 0.55)));
    addCommentary(activeMatch.minute, 'Ceza sahası önünde tehlikeli FRİKİK kazandık! Topun başına frikikçimiz olarak SEN geçiyorsun.', 'interactive');
    const goalOpt = (name, chance, success, fail) => {
        const ch = Math.max(8, Math.min(70, chance));
        const opt = { name, stat: 'sut', difficulty: 0, isGoal: true, success, fail };
        return { name, chance: ch, label: 'Gol Şansı', onPick: () => resolvePlayerDecision(opt, ch) };
    };
    const assistOpt = (name, chance, success, fail) => {
        const ch = Math.max(10, Math.min(68, chance));
        const opt = { name, stat: 'pas', difficulty: 0, isAssist: true, success, fail };
        return { name, chance: ch, label: 'Asist Şansı', onPick: () => resolvePlayerDecision(opt, ch) };
    };
    _openSetPieceDecision('Frikik senin. Nasıl kullanacaksın?', [
        goalOpt('Direkt sert şut çek', direct, 'GOOOL! Frikiği barajın üzerinden doksana çaktın! Muhteşem vuruş!', 'Sert vurdun ama top barajdan sekti.'),
        goalOpt('Kavisli köşeye gönder', direct + 4, 'GOOOL! Topa müthiş falso verdin — kavisli vuruş uzak köşeden ağlara süzüldü!', 'Kavisli vuruş az farkla direğin yanından auta gitti.'),
        assistOpt('Ceza sahasına ortala', cross, 'Mükemmel orta! Arka direkte takım arkadaşın yükseldi ve topu ağlara gönderdi — ASİST!', 'Ortan savunmada kafayla uzaklaştırıldı.'),
    ]);
}

// Kaleci kullanıcı: rakip PENALTISINI kurtarmaya çalış (özel çözümleme; başarısızlık = gol).
function _gkPenaltySaveMoment() {
    const a = (gameState.player.attrs) || {};
    const base = _gkPenSaveChance(a);
    addCommentary(activeMatch.minute, 'Hakem ceza sahamızda PENALTI noktasını gösterdi! Rakip forvet topun başında — kalede SEN varsın!', 'interactive');
    const userFull = `${gameState.player.firstname} ${gameState.player.lastname}`;
    const resolveSave = (ch) => {
        const box = document.getElementById('match-decision-box'); if (box) box.style.display = 'none';
        if (typeof bumpStat === 'function') { bumpStat('OPP', 'shots'); bumpStat('OPP', 'shotsOnTarget'); }
        if (Math.random() * 100 < ch) {
            activeMatch.playerStats.saves = (activeMatch.playerStats.saves || 0) + 1;
            adjustPlayerRating(1.2);
            addCommentary(activeMatch.minute, `PENALTIYI KURTARDIN! ${userFull} köşeye uzanıp topu çeliyor — STADYUM YIKILIYOR!`, 'goal');
            if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'save', team: 'MY', playerName: userFull });
            const v = document.getElementById('match-player-action-val');
            if (v) v.textContent = activeMatch.playerStats.saves;
        } else {
            if (activeMatch.isHome) activeMatch.scoreAway++; else activeMatch.scoreHome++;
            const sc = document.getElementById('match-score');
            if (sc) sc.textContent = `${activeMatch.scoreHome} - ${activeMatch.scoreAway}`;
            adjustPlayerRating(-0.2);
            addCommentary(activeMatch.minute, 'Penaltı golle sonuçlandı. Ters köşeye iyi vurdu, yapacak bir şey yoktu.', 'card-red');
            if (typeof pushMatchEvent === 'function') pushMatchEvent({ type: 'penalty-scored', team: 'OPP', playerName: (activeMatch.oppTeam || {}).name || 'Rakip' });
        }
        runMatchTicker();
    };
    const pick = (name, ch) => ({ name, chance: ch, label: 'Kurtarış Şansı', onPick: () => resolveSave(ch) });
    _openSetPieceDecision('Penaltıda hangi tarafa gideceksin?', [
        pick('Sol köşeye uç', base),
        pick('Ortada kal ve bekle', Math.max(10, base - 8)),
        pick('Sağ köşeye uç', base),
    ]);
}

// ---- A4c: Ticker hook'u — duran top anı tetiklendi mi? (45-matchengine her dk sorar) ----
// Yalnız KULLANICIYI ilgilendiren anlar tetiklenir (görevli penaltı/frikik, kaleci kurtarışı);
// diğer her şey genel olay simülasyonunun içinde zaten örtük.
function maybeSetPieceMoment() {
    if (typeof activeMatch === 'undefined' || !activeMatch || activeMatch.isHalfTime) return false;
    const p = gameState.player;
    if (!p) return false;
    if (activeMatch.playerStatus !== 'starting' || activeMatch.isSubbedOut) return false;
    const m = activeMatch.minute;
    if (m < 8 || m > 88) return false;
    const duty = p.setPieceDuty || {};
    const isGK = p.position === 'Kaleci';
    const trigger = (counterKey, fn) => {
        activeMatch[counterKey] = (activeMatch[counterKey] || 0) + 1;
        activeMatch.lastDecisionMin = m;   // normal karar anları hemen üstüne binmesin
        clearInterval(activeMatch.timerId);
        fn();
        return true;
    };
    if (!isGK && duty.pen && !(activeMatch.penMomentsUsed) && Math.random() < 0.0025)
        return trigger('penMomentsUsed', _userPenaltyMoment);
    if (!isGK && duty.fk && (activeMatch.fkMomentsUsed || 0) < 2 && Math.random() < 0.004)
        return trigger('fkMomentsUsed', _userFreeKickMoment);
    if (isGK && !(activeMatch.oppPenMomentsUsed) && Math.random() < 0.0025)
        return trigger('oppPenMomentsUsed', _gkPenaltySaveMoment);
    return false;
}

// ============================================================================
//  A5 — KUPA UZATMA + SERİ PENALTI
// ============================================================================

// Bu maç turu BİTİREN maç mı ve (bu skorla) eşitlik var mı?
function _cupTieDeciding(cur, my, opp) {
    if (!cur || cur.phase === 'lp') return false;
    const e = gameState.euro;
    const rd = cur.round || (e && e.ko && e.ko[e.koIndex]);
    if (!rd || rd.decided) return false;
    if (rd.single) return my === opp;
    const others = rd.legs.filter(l => l !== cur.fx);
    if (!others.every(l => l.played)) return false;
    const gf = others.reduce((s, l) => s + l.gf, 0) + my;
    const ga = others.reduce((s, l) => s + l.ga, 0) + opp;
    return gf === ga;
}

// 30 dk uzatma: güç-bazlı küçük gol olasılıkları (abartısız; çoğu uzatma golsüz biter).
function _etSim(myP, oppP) {
    const pm = Math.max(0.10, Math.min(0.42, 0.24 + ((myP || 70) - (oppP || 70)) / 300));
    const po = Math.max(0.10, Math.min(0.42, 0.24 + ((oppP || 70) - (myP || 70)) / 300));
    let mg = Math.random() < pm ? 1 : 0;
    let og = Math.random() < po ? 1 : 0;
    if (mg && Math.random() < 0.22) mg++;
    if (og && Math.random() < 0.22) og++;
    return { mg, og };
}

// Seri penaltı (hızlı sim): 5'er atış + seri ölüm; matematiksel erken bitiş.
// Her atıştan sonra İKİ YÖN de kontrol edilir (rakibin kaçırması da seriyi bitirebilir).
function _shootoutSim(pk) {
    pk = pk || 0.76;
    let my = 0, opp = 0, myT = 0, oppT = 0;
    const _decided = () => (my > opp + (5 - oppT)) ? 1 : (opp > my + (5 - myT)) ? -1 : 0;
    for (let r = 1; r <= 5; r++) {
        myT++; if (Math.random() < pk) my++;
        let d = _decided(); if (d) return { my, opp, won: d > 0 };
        oppT++; if (Math.random() < pk) opp++;
        d = _decided(); if (d) return { my, opp, won: d > 0 };
    }
    for (let r = 0; r < 5; r++) {
        const a = Math.random() < pk, b = Math.random() < pk;
        if (a) my++; if (b) opp++;
        if (a !== b) return { my, opp, won: a };
    }
    const w = Math.random() < 0.5; if (w) my++; else opp++;
    return { my, opp, won: w };
}

// Hızlı (senkron) beraberlik çözümü — sessiz/instant simler ve sahada olmayan kullanıcı için.
function cupTieBreakSync(my, opp, myP, oppP) {
    const et = _etSim(myP, oppP);
    my += et.mg; opp += et.og;
    if (my !== opp) return { my, opp, pen: null, et };
    const s = _shootoutSim(0.76);
    return { my, opp, pen: { won: s.won, score: s.my + '-' + s.opp }, et };
}

// ---- Etkileşimli seri penaltı (overlay modal; canlı kupa maçı + kullanıcı sahada) ----
function _interactiveShootout(ctx) {
    return new Promise((resolve) => {
        const rng = ctx.rng || Math.random;   // enjekte edilebilir zar (test determinizmi)
        const a = (gameState.player.attrs) || {};
        const isGK = gameState.player.position === 'Kaleci';
        const userKickRound = (gameState.player.setPieceDuty && gameState.player.setPieceDuty.pen) ? 1 : 3;
        const ov = document.createElement('div');
        ov.id = 'pen-shootout-overlay';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(4,10,18,.82);display:flex;align-items:center;justify-content:center;z-index:9999;';
        ov.innerHTML = `
            <div class="glass-card" style="max-width:440px;width:92%;padding:20px;text-align:center;">
                <h3 style="margin:0 0 4px;"><i class="fa-solid fa-bullseye"></i> SERİ PENALTILAR</h3>
                <div style="color:var(--text-muted);font-size:.82rem;margin-bottom:10px;">${ctx.myName} vs ${ctx.oppName}</div>
                <div id="pen-track" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;font-family:var(--font-heading);"></div>
                <div id="pen-msg" style="min-height:44px;font-size:.9rem;margin-bottom:10px;"></div>
                <div id="pen-actions" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;"></div>
            </div>`;
        document.body.appendChild(ov);
        const marks = { my: [], opp: [] };
        const track = () => {
            const row = (label, arr, score) => `<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
                <span style="font-size:.78rem;min-width:120px;text-align:left;">${label}</span>
                <span style="letter-spacing:3px;">${arr.map(x => x ? '🟢' : '🔴').join('')}${'·'.repeat(Math.max(0, 5 - arr.length))}</span>
                <strong>${score}</strong></div>`;
            ov.querySelector('#pen-track').innerHTML =
                row(ctx.myName, marks.my, marks.my.filter(Boolean).length) +
                row(ctx.oppName, marks.opp, marks.opp.filter(Boolean).length);
        };
        const msg = (t) => { ov.querySelector('#pen-msg').innerHTML = t; };
        const actions = ov.querySelector('#pen-actions');
        const buttons = (defs) => new Promise(res => {
            actions.innerHTML = '';
            defs.forEach(d => {
                const b = document.createElement('button');
                b.className = 'btn btn-primary';
                b.textContent = d.label;
                b.addEventListener('click', () => { actions.innerHTML = ''; res(d.value); });
                actions.appendChild(b);
            });
        });
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        const sides = () => { const r = rng(); return r < 0.4 ? 'sol' : r < 0.6 ? 'orta' : 'sağ'; };

        // Kullanıcı atışı: köşe seç → kaleci zıplar → sonuç
        async function userKick() {
            msg('<strong>Topun başındasın.</strong> Köşeyi seç:');
            const pick = await buttons([{ label: 'Sol köşe', value: 'sol' }, { label: 'Orta', value: 'orta' }, { label: 'Sağ köşe', value: 'sağ' }]);
            const gk = sides();
            let pr = _penKickChance(a) / 100;
            if (gk === pick) pr -= (pick === 'orta' ? 0.45 : 0.30); else pr += 0.08;
            pr = Math.max(0.05, Math.min(0.97, pr));
            const scored = rng() < pr;
            msg(scored ? `<strong style="color:var(--accent);">GOOOL!</strong> Kaleci ${gk} tarafa gitti, sen ${pick === 'orta' ? 'ortaya' : pick + ' köşeye'} vurdun!`
                : `<strong style="color:#ef5350;">KAÇIRDIN!</strong> Kaleci ${gk === pick ? 'köşeni okudu ve kurtardı' : 'şanslıydı — vuruşun isabetsiz'}.`);
            await delay(900);
            return scored;
        }
        // Kaleci kullanıcı: rakip atışında tarafı tahmin et
        async function userSave(kickNo) {
            msg(`<strong>Rakibin ${kickNo}. atışı.</strong> Hangi tarafa gideceksin?`);
            const guess = await buttons([{ label: 'Sola uç', value: 'sol' }, { label: 'Ortada kal', value: 'orta' }, { label: 'Sağa uç', value: 'sağ' }]);
            const side = sides();
            let saved = false;
            if (guess === side) saved = rng() < (side === 'orta' ? 0.62 : 0.50);
            const missedAnyway = !saved && guess !== side && rng() < 0.06;
            if (saved) {
                if (ctx.onSave) ctx.onSave();
                msg(`<strong style="color:var(--accent);">KURTARDIN!</strong> ${side === 'orta' ? 'Ortaya vurdu, yerinde kaldın' : side + ' köşeye doğru tarafı seçtin'} — top elinde!`);
            } else if (missedAnyway) {
                msg('<strong style="color:var(--accent);">DIŞARI!</strong> Ters köşeye gittin ama rakip topu auta vurdu!');
            } else {
                msg(`<strong style="color:#ef5350;">GOL.</strong> ${guess === side ? 'Tarafı bildin ama vuruş çok sertti' : 'Ters köşede kaldın'}.`);
            }
            await delay(900);
            return !(saved || missedAnyway);   // rakip attı mı?
        }
        const aiKick = async (who) => { await delay(650); return rng() < 0.76; };

        (async () => {
            track();
            msg('Seri penaltılar başlıyor…'); await delay(700);
            let myT = 0, oppT = 0, done = false, won = false;
            const myScore = () => marks.my.filter(Boolean).length;
            const oppScore = () => marks.opp.filter(Boolean).length;
            // Her atıştan sonra İKİ YÖN kontrol (rakibin kaçırması da seriyi erken bitirebilir)
            const _decided = () => (myScore() > oppScore() + (5 - oppT)) ? 1 : (oppScore() > myScore() + (5 - myT)) ? -1 : 0;
            for (let r = 1; r <= 5 && !done; r++) {
                const mk = (!isGK && r === userKickRound) ? await userKick() : await aiKick('my');
                marks.my.push(mk); myT++; track();
                if (!(!isGK && r === userKickRound)) { msg(`${ctx.myName} ${r}. atış: ${mk ? 'GOL' : 'kaçtı'}.`); await delay(500); }
                let d = _decided();
                if (d) { done = true; won = d > 0; break; }
                const ok = isGK ? await userSave(r) : await aiKick('opp');
                marks.opp.push(ok); oppT++; track();
                if (!isGK) { msg(`${ctx.oppName} ${r}. atış: ${ok ? 'gol' : 'KAÇIRDI!'}`); await delay(500); }
                d = _decided();
                if (d) { done = true; won = d > 0; break; }
            }
            // Seri ölüm (6.-10. atışlar), sonra zar
            for (let r = 6; r <= 10 && !done; r++) {
                const mk = await aiKick('my'); marks.my.push(mk); track(); await delay(350);
                const ok = isGK ? await userSave(r) : await aiKick('opp');
                marks.opp.push(ok); track();
                if (mk !== ok) { done = true; won = mk; }
            }
            if (!done) { won = rng() < 0.5; if (won) marks.my.push(true); else marks.opp.push(true); track(); }
            const score = myScore() + '-' + oppScore();
            msg(won ? `<strong style="color:var(--accent);">PENALTILARLA KAZANDINIZ! (${score})</strong>`
                : `<strong style="color:#ef5350;">Penaltılarda kaybettiniz. (${score})</strong>`);
            const p = gameState.player;
            p.managerTrust = Math.max(10, Math.min(100, p.managerTrust + (won ? 3 : -2)));
            p.fansLove = Math.max(10, Math.min(100, p.fansLove + (won ? 4 : -2)));
            await buttons([{ label: 'Devam', value: 1 }]);
            ov.remove();
            resolve({ won, score });
        })();
    });
}

// Canlı kupa maçı beraberlik çözümü (async): uzatma + (gerekirse) etkileşimli/sim penaltı.
function cupTieBreak(opts) {
    const e = gameState.euro;
    const myTeam = DB.getTeam(e._team) || {}, oppTeam = activeMatch.oppTeam || {};
    let my = opts.my, opp = opts.opp;
    const et = _etSim(myTeam.power, oppTeam.power);
    my += et.mg; opp += et.og;
    // Canlı skorboardu uzatma skoruyla güncelle + anlatım
    if (opts.live && typeof addCommentary === 'function') {
        addCommentary(90, 'Eşitlik bozulmadı — maç UZATMALARA gidiyor!', 'info');
        if (et.mg) addCommentary(105, `UZATMA GOLÜ! ${myTeam.name} uzatmalarda ${et.mg} gol buldu!`, 'goal');
        if (et.og) addCommentary(105, `Uzatmada rakip ${oppTeam.name} ${et.og} gol attı.`, 'card-red');
        if (!et.mg && !et.og) addCommentary(118, 'Uzatmalar da golsüz geçti. Turu SERİ PENALTILAR belirleyecek!', 'info');
        if (activeMatch.isHome) { activeMatch.scoreHome = my; activeMatch.scoreAway = opp; }
        else { activeMatch.scoreHome = opp; activeMatch.scoreAway = my; }
        const sc = document.getElementById('match-score');
        if (sc) sc.textContent = `${activeMatch.scoreHome} - ${activeMatch.scoreAway}`;
    }
    if (my !== opp) return Promise.resolve({ my, opp, pen: null });
    // Penaltılar: kullanıcı maçı sahada bitirdiyse ETKİLEŞİMLİ; değilse hızlı sim
    const userIn = opts.live && opts.ps && !opts.ps.didNotPlay && !activeMatch.isSubbedOut;
    if (userIn && typeof document !== 'undefined') {
        return _interactiveShootout({
            myName: myTeam.name || 'Takımın', oppName: oppTeam.name || 'Rakip',
            onSave: () => { if (activeMatch.playerStats) activeMatch.playerStats.saves = (activeMatch.playerStats.saves || 0) + 1; },
        }).then(pen => ({ my, opp, pen }));
    }
    const s = _shootoutSim(0.76);
    return Promise.resolve({ my, opp, pen: { won: s.won, score: s.my + '-' + s.opp } });
}

if (typeof window !== 'undefined') {
    Object.assign(window, {
        updateSetPieceDuty, maybeSetPieceMoment,
        _penKickChance, _fkGoalChance, _gkPenSaveChance,
        _userPenaltyMoment, _userFreeKickMoment, _gkPenaltySaveMoment,
        _cupTieDeciding, _etSim, _shootoutSim, cupTieBreakSync, cupTieBreak, _interactiveShootout,
    });
}
