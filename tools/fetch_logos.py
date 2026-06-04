# -*- coding: utf-8 -*-
"""
fetch_logos.py — Takim logolarini TEK SEFERLIK indirip paketler.

Kaynak: GitHub luukhopman/football-logos (2024-25 sezonu, gercek crest PNG'leri,
lige gore klasorlenmis, rate-limit yok). Tek tarball indirilir, takim adlari
bulanik (fuzzy) eslestirilir, eslesen logolar assets/logos/<takimId>.png olarak
kaydedilir ve data/teams.js'teki logoUrl alani guncellenir:
  - eslesen takim  -> "assets/logos/<takimId>.png"
  - eslesmeyen     -> null  (oyun getTeamLogoHtml ile bas-harf rozetine duser;
                             boylece olu Wikimedia URL 404 gurultusu de temizlenir)

Calistir:  python tools/fetch_logos.py
Idempotent + yeniden calistirma guvenli. Bagimlilik yok (sadece stdlib).
"""
import os, sys, re, io, json, tarfile, unicodedata, urllib.request, difflib
try: sys.stdout.reconfigure(encoding='utf-8')  # Windows cp1252 konsol unicode hatasini onle
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARBALL = os.path.join(ROOT, 'tools', '_logos.tar.gz')
TEAMS_JS = os.path.join(ROOT, 'data', 'teams.js')
LOGO_DIR = os.path.join(ROOT, 'assets', 'logos')
SEASON = '2024-25'
TAR_URL = 'https://codeload.github.com/luukhopman/football-logos/tar.gz/refs/heads/master'

# Bizim ligId -> repo klasor adi (2024-25). Kapsanmayan ligler atlanir (bas-harf rozeti).
LEAGUE_MAP = {
    'aut-bundesliga': 'Austria - Bundesliga',
    'bel-pro-league': 'Belgium - Jupiler Pro League',
    'cro-hnl': 'Croatia - SuperSport HNL',
    'cze-fortuna-liga': 'Czech Republic - Chance Liga',
    'den-superliga': 'Denmark - Superliga',
    'eng-premier-league': 'England - Premier League',
    'fra-ligue-1': 'France - Ligue 1',
    'ger-bundesliga': 'Germany - Bundesliga',
    'gre-super-league': 'Greece - Super League 1',
    'hun-nb1': 'Hungary - Nemzeti Bajnoksag',  # accent strip ile eslesir
    'ita-serie-a': 'Italy - Serie A',
    'ned-eredivisie': 'Netherlands - Eredivisie',
    'nor-eliteserien': 'Norway - Eliteserien',
    'pol-ekstraklasa': 'Poland - PKO BP Ekstraklasa',
    'por-liga-portugal': 'Portugal - Liga Portugal',
    'rou-superliga': 'Romania - SuperLiga',
    'sco-premiership': 'Scotland - Scottish Premiership',
    'esp-laliga': 'Spain - LaLiga',
    'swe-allsvenskan': 'Sweden - Allsvenskan',
    'sui-super-league': 'Switzerland - Super League',
    'tur-super-lig': 'Turkiye - Super Lig',  # accent strip ile eslesir
    'ukr-premier-league': 'Ukraine - Premier Liga',
}

# Bulanik eslesmeyi kacirilan/yanlis bilinen takimlar icin elle eslestirme
# (anahtar: bizim takim adi normalize; deger: repo dosya adi normalize)
ALIASES = {
    'man utd': 'manchester united',
    'man city': 'manchester city',
    'spurs': 'tottenham hotspur',
    'wolves': 'wolverhampton wanderers',
    'paris sg': 'paris saint germain',
    'om': 'olympique de marseille',
    'ol': 'olympique lyonnais',
    'm gladbach': 'borussia monchengladbach',
    'odense bk': 'odense boldklub',
    'agf': 'aarhus gf',
    'stvv': 'sint truidense vv',
    'hamkam fotball': 'hamarkameratene',
    'internazionale': 'inter',
}

SUFFIX_TOKENS = {
    'fc','cf','sc','sk','ac','as','ss','us','usc','sd','ud','cd','cp','afc','bk','if',
    'fk','sv','vfb','vfl','tsg','rc','rcd','calcio','club','ats','fsv','bsc','spvgg',
    'kv','rsc','kaa','kvc','sk','os','gd','sl','scp','aj','og','rcd','de','do','the'
}

def norm(s):
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def strip_suffix(n):
    toks = [t for t in n.split(' ') if t not in SUFFIX_TOKENS]
    return ' '.join(toks).strip() or n

def best_match(team_name, candidates):
    """candidates: list of (norm_name, norm_core, member). returns (member, ratio)."""
    tn = norm(team_name); tc = strip_suffix(tn)
    if tn in ALIASES: tn = ALIASES[tn]; tc = strip_suffix(tn)
    best = (None, 0.0)
    for cn, cc, member in candidates:
        r = max(
            difflib.SequenceMatcher(None, tn, cn).ratio(),
            difflib.SequenceMatcher(None, tc, cc).ratio(),
        )
        # icerme bonusu: biri digerini kapsiyorsa guclendir
        if tc and cc and (tc in cc or cc in tc):
            r = max(r, 0.90)
        if r > best[1]:
            best = (member, r)
    return best

def load_teams():
    txt = open(TEAMS_JS, 'r', encoding='utf-8').read()
    m = re.search(r'window\.DB_TEAMS\s*=\s*(\[.*\]);?\s*$', txt, re.S)
    if not m: raise SystemExit('teams.js parse edilemedi')
    return json.loads(m.group(1))

def write_teams(teams):
    out = 'window.DB_TEAMS = ' + json.dumps(teams, ensure_ascii=False, separators=(',', ':')) + ';\n'
    out = '// OTOMATIK URETILDI - tools/build_database.py (logoUrl: tools/fetch_logos.py)\n' + out
    open(TEAMS_JS, 'w', encoding='utf-8').write(out)

def main():
    if not os.path.exists(TARBALL) or os.path.getsize(TARBALL) < 100000:
        print('Tarball indiriliyor...')
        urllib.request.urlretrieve(TAR_URL, TARBALL)
    print('Tarball:', os.path.getsize(TARBALL), 'bytes')

    # repo: klasor(normalize) -> [(norm_name, norm_core, member)]
    folders = {}
    norm_target = {norm(v): v for v in LEAGUE_MAP.values()}
    with tarfile.open(TARBALL, 'r:gz') as tf:
        for m in tf.getmembers():
            if not m.isfile() or not m.name.lower().endswith('.png'): continue
            parts = m.name.split('/')
            # <root>/history/<season>/<League>/<Team>.png
            if len(parts) < 5 or parts[1] != 'history' or parts[2] != SEASON: continue
            league_folder = parts[3]; fn = parts[4][:-4]
            nf = norm(league_folder)
            if nf not in norm_target: continue
            folders.setdefault(nf, []).append((norm(fn), strip_suffix(norm(fn)), m.name))
        # eslestirme
        if not os.path.isdir(LOGO_DIR): os.makedirs(LOGO_DIR)
        teams = load_teams()
        by_league = {}
        for t in teams:
            by_league.setdefault(t.get('leagueId') or t['id'].split('__')[0], []).append(t)

        matched = 0; unmatched = []; covered_total = 0
        # tarball uyelerini path->member cache
        member_by_name = {m.name: m for m in tf.getmembers()}
        for lid, repo_folder in LEAGUE_MAP.items():
            cand = folders.get(norm(repo_folder), [])
            if not cand:
                print('  ! repo klasor bos/eksik:', repo_folder); continue
            for t in by_league.get(lid, []):
                covered_total += 1
                member_name, ratio = best_match(t['name'], cand)
                if member_name and ratio >= 0.60:
                    data = tf.extractfile(member_by_name[member_name]).read()
                    open(os.path.join(LOGO_DIR, t['id'] + '.png'), 'wb').write(data)
                    t['logoUrl'] = 'assets/logos/' + t['id'] + '.png'
                    matched += 1
                else:
                    t['logoUrl'] = None
                    unmatched.append('%s [%s] (en iyi %.2f)' % (t['name'], lid, ratio))
        # kapsanmayan liglerdeki takimlar: olu URL temizle -> null
        cleaned = 0
        covered_leagues = set(LEAGUE_MAP.keys())
        for t in teams:
            lid = t.get('leagueId') or t['id'].split('__')[0]
            if lid not in covered_leagues and t.get('logoUrl'):
                t['logoUrl'] = None; cleaned += 1

        write_teams(teams)
        print('\n=== SONUC ===')
        print('Kapsanan lig:', len(LEAGUE_MAP), '| kapsanan takim:', covered_total)
        print('Eslesen logo:', matched, '| eslesmeyen:', len(unmatched))
        print('Kapsanmayan liglerde olu URL temizlendi:', cleaned)
        print('Toplam takim:', len(teams))
        if unmatched:
            print('\n--- ESLESMEYENLER (%d) ---' % len(unmatched))
            for u in unmatched: print('  ', u)

if __name__ == '__main__':
    main()
