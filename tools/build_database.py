# -*- coding: utf-8 -*-
"""
build_database.py — Footballers.csv (EA Sports FC 26) -> oyun veritabani.

Cikti:
  data/leagues.js   (window.DB_LEAGUES)  - 45 lig/kupa metadata
  data/teams.js     (window.DB_TEAMS)    - 644 takim (power/attack/defense/prestige/renk/logo)
  data/nations.js   (window.DB_NATIONS)  - milliyet -> bayrak emoji
  data/players/<ligId>.json              - lig basina oyuncu detaylari (lazy fetch)
  data/players/index.json                - ligId -> dosya + takim listesi

Calistirma:  python tools/build_database.py
Bagimliliklar: pandas, pycountry  (pip install pandas pycountry)
"""
import csv, json, re, os, ast, math, zlib, difflib
from collections import defaultdict
import pandas as pd
import pycountry

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "Footballers.csv")
STAD_PATH = os.path.join(ROOT, "Football Stadiums.csv")
DATA_DIR = os.path.join(ROOT, "data")
PLAYERS_DIR = os.path.join(DATA_DIR, "players")
COEF_PATH = os.path.join(ROOT, "tools", "ovr_coefficients.json")

# ----------------------------------------------------------------------------
# 1) EA mevki -> oyun mevki (12 oynanabilir pozisyon)
# ----------------------------------------------------------------------------
POS_MAP = {
    'GK': 'Kaleci', 'CB': 'Stoper', 'RB': 'Sağ Bek', 'LB': 'Sol Bek',
    'CDM': 'DOS', 'CM': 'Merkez OS', 'CAM': 'Ofansif OS',
    'RM': 'Sağ Açık', 'LM': 'Sol Açık', 'RW': 'Sağ Kanat', 'LW': 'Sol Kanat',
    'ST': 'Santrfor',
}

# CSV alt-stat sutunu -> oyun alt-stat anahtari (Turkce camelCase)
SUB_COLS = [
    ('Acceleration', 'hizlanma'), ('Sprint Speed', 'sprintHizi'),
    ('Positioning', 'pozisyonAlma'), ('Finishing', 'bitiricilik'),
    ('Shot Power', 'sutGucu'), ('Long Shots', 'uzaktanSut'),
    ('Volleys', 'vole'), ('Penalties', 'penalti'),
    ('Vision', 'vizyon'), ('Crossing', 'ortaPas'),
    ('Free Kick Accuracy', 'serbestVurus'), ('Short Passing', 'kisaPas'),
    ('Long Passing', 'uzunPas'), ('Curve', 'falso'),
    ('Dribbling', 'topSurme'), ('Agility', 'ceviklik'),
    ('Balance', 'denge'), ('Reactions', 'reaksiyon'),
    ('Ball Control', 'topKontrol'), ('Composure', 'sogukkanlilik'),
    ('Interceptions', 'topKapma'), ('Heading Accuracy', 'kafaVurusu'),
    ('Def Awareness', 'defansFarkindaligi'), ('Standing Tackle', 'ayaktaMudahale'),
    ('Sliding Tackle', 'kayarakMudahale'), ('Jumping', 'ziplama'),
    ('Stamina', 'dayaniklilik'), ('Strength', 'guc'), ('Aggression', 'agresiflik'),
]
GK_COLS = [
    ('GK Diving', 'gkUcus'), ('GK Handling', 'gkTopTutma'), ('GK Kicking', 'gkVurus'),
    ('GK Positioning', 'gkYerTutma'), ('GK Reflexes', 'gkRefleks'), ('Reactions', 'reaksiyon'),
]

# ----------------------------------------------------------------------------
# 2) Lig metadata: CSV lig adi -> {id, name, short, country, conf, tier, type}
#    tier: 1=elit .. 4=alt | type: league|cup | conf: UEFA/CONMEBOL/AFC/CONCACAF
# ----------------------------------------------------------------------------
LEAGUE_META = {
    'Premier League':       ('eng-premier-league', 'Premier League', 'England', 'UEFA', 1, 'league'),
    'LALIGA EA SPORTS':     ('esp-laliga', 'LALIGA', 'Spain', 'UEFA', 1, 'league'),
    'Bundesliga':           ('ger-bundesliga', 'Bundesliga', 'Germany', 'UEFA', 1, 'league'),
    'Serie A Enilive':      ('ita-serie-a', 'Serie A', 'Italy', 'UEFA', 1, 'league'),
    "Ligue 1 McDonald's":   ('fra-ligue-1', 'Ligue 1', 'France', 'UEFA', 1, 'league'),
    'Trendyol Süper Lig':   ('tur-super-lig', 'Süper Lig', 'Turkey', 'UEFA', 2, 'league'),
    'Liga Portugal':        ('por-liga-portugal', 'Liga Portugal', 'Portugal', 'UEFA', 2, 'league'),
    'Eredivisie':           ('ned-eredivisie', 'Eredivisie', 'Holland', 'UEFA', 2, 'league'),
    'ROSHN Saudi League':   ('sau-pro-league', 'Saudi Pro League', 'Saudi Arabia', 'AFC', 2, 'league'),
    '1A Pro League':        ('bel-pro-league', 'Pro League', 'Belgium', 'UEFA', 2, 'league'),
    'LALIGA HYPERMOTION':   ('esp-laliga2', 'LALIGA 2', 'Spain', 'UEFA', 3, 'league'),
    'EFL Championship':     ('eng-championship', 'Championship', 'England', 'UEFA', 2, 'league'),
    'Serie BKT':            ('ita-serie-b', 'Serie B', 'Italy', 'UEFA', 3, 'league'),
    'Bundesliga 2':         ('ger-bundesliga-2', '2. Bundesliga', 'Germany', 'UEFA', 3, 'league'),
    'Ligue 2 BKT':          ('fra-ligue-2', 'Ligue 2', 'France', 'UEFA', 3, 'league'),
    '3. Liga':              ('ger-3-liga', '3. Liga', 'Germany', 'UEFA', 4, 'league'),
    'EFL League One':       ('eng-league-one', 'League One', 'England', 'UEFA', 4, 'league'),
    'EFL League Two':       ('eng-league-two', 'League Two', 'England', 'UEFA', 4, 'league'),
    'MLS':                  ('usa-mls', 'MLS', 'United States', 'CONCACAF', 3, 'league'),
    'LPF':                  ('arg-lpf', 'Liga Profesional', 'Argentina', 'CONMEBOL', 3, 'league'),
    'CSL':                  ('chn-super-league', 'Super League', 'China PR', 'AFC', 3, 'league'),
    'K League 1':           ('kor-k-league', 'K League 1', 'Korea Republic', 'AFC', 3, 'league'),
    'Scottish Prem':        ('sco-premiership', 'Premiership', 'Scotland', 'UEFA', 3, 'league'),
    'SUPERLIGA':            ('rou-superliga', 'SuperLiga', 'Romania', 'UEFA', 3, 'league'),
    'PKO BP Ekstraklasa':   ('pol-ekstraklasa', 'Ekstraklasa', 'Poland', 'UEFA', 3, 'league'),
    'Brack Super League':   ('sui-super-league', 'Super League', 'Switzerland', 'UEFA', 3, 'league'),
    'Ö. Bundesliga':        ('aut-bundesliga', 'Bundesliga', 'Austria', 'UEFA', 3, 'league'),
    'Eliteserien':          ('nor-eliteserien', 'Eliteserien', 'Norway', 'UEFA', 3, 'league'),
    'Allsvenskan':          ('swe-allsvenskan', 'Allsvenskan', 'Sweden', 'UEFA', 3, 'league'),
    '3F Superliga':         ('den-superliga', 'Superliga', 'Denmark', 'UEFA', 3, 'league'),
    'Hellas Liga':          ('gre-super-league', 'Super League', 'Greece', 'UEFA', 3, 'league'),
    'Česká Liga':           ('cze-fortuna-liga', 'Fortuna Liga', 'Czech Republic', 'UEFA', 3, 'league'),
    'Liga Hrvatska':        ('cro-hnl', 'HNL', 'Croatia', 'UEFA', 3, 'league'),
    'Ukrayina Liha':        ('ukr-premier-league', 'Premier League', 'Ukraine', 'UEFA', 3, 'league'),
    'Magyar Liga':          ('hun-nb1', 'NB I', 'Hungary', 'UEFA', 4, 'league'),
    'Liga Cyprus':          ('cyp-first-division', 'First Division', 'Cyprus', 'UEFA', 4, 'league'),
    'Liga Azerbaijan':      ('aze-premier-league', 'Premyer Liqa', 'Azerbaijan', 'UEFA', 4, 'league'),
    'Finnliiga':            ('fin-veikkausliiga', 'Veikkausliiga', 'Finland', 'UEFA', 4, 'league'),
    'United Emirates League': ('uae-pro-league', 'Pro League', 'United Arab Emirates', 'AFC', 4, 'league'),
    'ISL':                  ('ind-super-league', 'Super League', 'India', 'AFC', 4, 'league'),
    'A-League':             ('aus-a-league', 'A-League', 'Australia', 'AFC', 4, 'league'),
    'SSE Airtricity PD':    ('irl-premier-division', 'Premier Division', 'Republic of Ireland', 'UEFA', 4, 'league'),
    'Liga Chile':           ('chi-primera', 'Primera División', 'Chile', 'CONMEBOL', 4, 'league'),
    # --- Kitasal kupalar (Faz 7'de gercek format; simdilik type=cup isaretli) ---
    'Libertadores':         ('conmebol-libertadores', 'Copa Libertadores', 'South America', 'CONMEBOL', 2, 'cup'),
    'Sudamericana':         ('conmebol-sudamericana', 'Copa Sudamericana', 'South America', 'CONMEBOL', 3, 'cup'),
}

# ----------------------------------------------------------------------------
# 3) Eski Super Lig + dev kulup renk/logo (oyun kimligini koru). slug -> (renk, logoUrl|None)
# ----------------------------------------------------------------------------
TEAM_STYLE = {
    'galatasaray': ('#ff2a2a', 'https://upload.wikimedia.org/wikipedia/commons/3/37/Galatasaray_Star_Logo.svg'),
    'fenerbahce': ('#ffd600', 'https://upload.wikimedia.org/wikipedia/commons/f/f7/Fenerbah%C3%A7e_SK.svg'),
    'besiktas': ('#37474f', 'https://upload.wikimedia.org/wikipedia/commons/1/14/Besiktas_Logo_Star.svg'),
    'trabzonspor': ('#880e4f', 'https://upload.wikimedia.org/wikipedia/commons/d/df/Trabzonspor_Logo.svg'),
    'basaksehir': ('#ff6d00', 'https://upload.wikimedia.org/wikipedia/tr/6/61/Ba%C5%9fak%C5%9fehir_FK_logo.png'),
    'eyupspor': ('#e65100', None), 'goztepe': ('#ffd600', None),
    'samsunspor': ('#d50000', None), 'antalyaspor': ('#ff1744', None),
    'kasimpasa': ('#2962ff', None), 'caykur-rizespor': ('#00c853', None),
    'alanyaspor': ('#ffd600', None), 'konyaspor': ('#1b5e20', None),
    'gaziantep': ('#212121', None), 'kayserispor': ('#ffca28', None),
    'kocaelispor': ('#1b5e20', None), 'genclerbirligi': ('#d50000', None),
    'karagumruk-sk': ('#c62828', None),
    # dunya devleri
    'real-madrid': ('#dedede', 'https://upload.wikimedia.org/wikipedia/commons/5/56/Real_Madrid_CF.svg'),
    'fc-barcelona': ('#7c4dff', 'https://upload.wikimedia.org/wikipedia/commons/4/47/FC_Barcelona_%28crested%29.svg'),
    'manchester-city': ('#80d8ff', 'https://upload.wikimedia.org/wikipedia/commons/e/eb/Manchester_City_FC_badge.svg'),
    'liverpool': ('#d50000', None), 'arsenal': ('#ff1744', None),
    'manchester-utd': ('#da291c', None), 'chelsea': ('#1a47b8', None),
    'fc-bayern-munchen': ('#d50000', None), 'paris-sg': ('#1a237e', None),
    'inter': ('#2962ff', None), 'ac-milan': ('#d50000', None), 'juventus': ('#222', None),
    'borussia-dortmund': ('#ffd600', None), 'atletico-madrid': ('#cb3524', None),
    'lazio': ('#87ceeb', None), 'atalanta': ('#1a47b8', None),
}

# ----------------------------------------------------------------------------
# Lisanssiz EA kulup adlarini gercek adlara esle (best-effort).
# EA FC 26'da lisanssiz Serie A takimlari uydurma adlarla gelir; yildiz
# kadrolarindan dogrulandi. team_id slug'i da duzeltilmis addan uretilir,
# boylece renk/logo/stadyum eslesmesi de gercek kulube isabet eder.
# ----------------------------------------------------------------------------
TEAM_NAME_FIXES = {
    'Lombardia FC':   'Inter',       # Lautaro, Bastoni, Barella, Çalhanoğlu
    'Milano FC':      'AC Milan',    # Maignan, Leão, Pulisic, Modrić
    'Latium':         'Lazio',       # Zaccagni, Provedel, Romagnoli
    'Bergamo Calcio': 'Atalanta',    # Lookman, De Ketelaere, de Roon
}

# Lig/konfederasyona gore yedek renk paleti (slug yoksa)
PALETTE = ['#00bcd4', '#7e57c2', '#26a69a', '#ec407a', '#5c6bc0', '#66bb6a',
           '#ffa726', '#ef5350', '#42a5f5', '#ab47bc', '#9ccc65', '#ff7043',
           '#29b6f6', '#8d6e63', '#78909c', '#d4e157']

# ----------------------------------------------------------------------------
# Yardimcilar
# ----------------------------------------------------------------------------
def slugify(s):
    s = s.lower()
    tr = {'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a',
          'é': 'e', 'í': 'i', 'ó': 'o', 'á': 'a', 'ú': 'u', 'ñ': 'n', 'ø': 'o',
          'å': 'a', 'æ': 'ae', 'ß': 'ss', 'è': 'e', 'ê': 'e', 'ã': 'a', 'õ': 'o'}
    for k, v in tr.items():
        s = s.replace(k, v)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s

# Milliyet -> bayrak emoji (pycountry + ozel adlar)
NATION_OVERRIDES = {
    'Turkey': '🇹🇷', 'Türkiye': '🇹🇷',
    'England': '🏴\U000e0067\U000e0062\U000e0065\U000e006e\U000e0067\U000e007f',
    'Scotland': '🏴\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f',
    'Wales': '🏴\U000e0067\U000e0062\U000e0077\U000e006c\U000e0073\U000e007f',
    'Northern Ireland': '🇬🇧', 'Holland': '🇳🇱', 'England ': '🏴',
    'Korea Republic': '🇰🇷', 'China PR': '🇨🇳', 'Chinese Taipei': '🇹🇼',
    'Republic of Ireland': '🇮🇪', "Côte d'Ivoire": '🇨🇮', 'Curaçao': '🇨🇼',
    'Cape Verde Islands': '🇨🇻', 'Congo DR': '🇨🇩', 'Congo': '🇨🇬',
    'Kosovo': '🇽🇰', 'Russia': '🇷🇺', 'Iran': '🇮🇷', 'Syria': '🇸🇾',
    'Bolivia': '🇧🇴', 'Venezuela': '🇻🇪', 'Tanzania': '🇹🇿', 'Moldova': '🇲🇩',
    'North Macedonia': '🇲🇰', 'St. Kitts and Nevis': '🇰🇳', 'St. Lucia': '🇱🇨',
    'Antigua and Barbuda': '🇦🇬', 'Trinidad and Tobago': '🇹🇹',
    'Bosnia and Herzegovina': '🇧🇦', 'Palestine': '🇵🇸', 'Hong Kong': '🇭🇰',
}
def nation_flag(name):
    if name in NATION_OVERRIDES:
        return NATION_OVERRIDES[name]
    try:
        c = pycountry.countries.lookup(name)
        cc = c.alpha_2
        return ''.join(chr(0x1F1E6 + ord(ch) - ord('A')) for ch in cc)
    except Exception:
        try:
            res = pycountry.countries.search_fuzzy(name)
            cc = res[0].alpha_2
            return ''.join(chr(0x1F1E6 + ord(ch) - ord('A')) for ch in cc)
        except Exception:
            return '🏳️'

def parse_int_prefix(s, unit):
    if not isinstance(s, str):
        return None
    m = re.search(r'(\d+)\s*' + unit, s)
    return int(m.group(1)) if m else None

def parse_list(s):
    if not isinstance(s, str) or not s.strip():
        return []
    try:
        v = ast.literal_eval(s)
        return [str(x) for x in v] if isinstance(v, list) else []
    except Exception:
        return []

def fnum(v):
    try:
        return float(v)
    except Exception:
        return 0.0

def stable_jitter(seed, lo, hi):
    """Tekrarlanabilir (deterministik) pseudo-random aralik degeri."""
    h = zlib.crc32(seed.encode('utf-8')) & 0xffffffff
    return lo + (h % 10000) / 10000.0 * (hi - lo)

# ---- Stadyum eslestirme ----
COUNTRY_ALIAS = {
    'China PR': 'China', 'Holland': 'Netherlands', 'Korea Republic': 'South Korea',
    'Republic of Ireland': 'Ireland', 'United States': 'United States of America',
}
CLUB_AFFIX = re.compile(r'\b(fc|sc|sk|cf|ac|as|afc|cd|ssc|club|kf|fk|bk|if|sv|vfb|vfl|tsg|'
                        r'rc|ud|us|ca|spor|kulubu|1\d{3}|cd|rcd|ogc|fsv|tsv|de|el|la|el)\b')
def norm_team(s):
    s = slugify(s).replace('-', ' ')
    s = CLUB_AFFIX.sub(' ', ' ' + s + ' ')
    return re.sub(r'\s+', ' ', s).strip()

TIER_DEFAULT_CAP = {1: 42000, 2: 28000, 3: 16000, 4: 9000}

STAD_NAME_PATTERNS = ['{} Stadyumu', '{} Arena', '{} Stadı', '{} Park', '{} Stadı']
def gen_stadium_name(team, seed):
    i = zlib.crc32((seed + 'stad').encode('utf-8')) % len(STAD_NAME_PATTERNS)
    return STAD_NAME_PATTERNS[i].format(team)

def load_stadiums():
    df = pd.read_csv(STAD_PATH, encoding='cp1252', dtype=str, keep_default_na=False)
    by_country = defaultdict(list)
    for _, r in df.iterrows():
        cap = re.sub(r'[^0-9]', '', r['Capacity'])
        cap = int(cap) if cap else 0
        rec_country = r['Country']
        for ht in r['HomeTeams'].split(','):
            nm = norm_team(ht)
            if not nm:
                continue
            by_country[rec_country].append({
                'norm': nm, 'name': r['Stadium'].strip(),
                'city': r['City'].strip(), 'cap': cap,
            })
    return by_country

# ----------------------------------------------------------------------------
# Ana islem
# ----------------------------------------------------------------------------
def main():
    os.makedirs(PLAYERS_DIR, exist_ok=True)
    coefs = json.load(open(COEF_PATH, encoding='utf-8'))
    df = pd.read_csv(CSV_PATH, dtype=str, keep_default_na=False)
    print(f"CSV okundu: {len(df)} satir")

    players_by_league = defaultdict(list)   # ligId -> [player dict]
    teams_acc = {}                          # teamId -> aggregate accumulator
    nations = {}                            # nation -> flag
    skipped = 0
    ovr_abs_err = []

    foot_tr = {'Left': 'Sol', 'Right': 'Sağ'}

    for _, r in df.iterrows():
        ea_pos = r['Position']
        gpos = POS_MAP.get(ea_pos)
        league_name = r['League']
        meta = LEAGUE_META.get(league_name)
        if gpos is None or meta is None:
            skipped += 1
            continue
        lig_id, lig_disp, country, conf, tier, ltype = meta
        # Lisanssiz EA adini gercek adla degistir (varsa); slug da bundan uretilir
        team_name = TEAM_NAME_FIXES.get(r['Team'], r['Team'])
        team_id = f"{lig_id}__{slugify(team_name)}"

        # alt-statlar
        is_gk = (gpos == 'Kaleci')
        cols = GK_COLS if is_gk else SUB_COLS
        attrs = {}
        for csv_c, key in cols:
            attrs[key] = int(round(fnum(r.get(csv_c, 0))))

        # 6 ana stat (CSV dogrudan); GK icin teknik = 5 GK ortalamasi
        if is_gk:
            gk_avg = round(sum(int(round(fnum(r[c]))) for c in
                          ['GK Diving', 'GK Handling', 'GK Kicking', 'GK Positioning', 'GK Reflexes']) / 5)
            stats = {'hiz': int(round(fnum(r['PAC']))), 'sut': int(round(fnum(r['SHO']))),
                     'pas': int(round(fnum(r['PAS']))), 'teknik': gk_avg,
                     'defans': int(round(fnum(r['DEF']))), 'fizik': int(round(fnum(r['PHY'])))}
        else:
            stats = {'hiz': int(round(fnum(r['PAC']))), 'sut': int(round(fnum(r['SHO']))),
                     'pas': int(round(fnum(r['PAS']))), 'teknik': int(round(fnum(r['DRI']))),
                     'defans': int(round(fnum(r['DEF']))), 'fizik': int(round(fnum(r['PHY'])))}

        ovr = int(round(fnum(r['OVR'])))

        # OVR formul dogrulamasi (kullanici-oyuncu formulu alt-statlardan)
        c = coefs[gpos]
        pred = c['b'] + sum(c['w'].get(k, 0) * attrs.get(k, 0) for k in c['w'])
        ovr_abs_err.append(abs(pred - ovr))

        nation = r['Nation']
        if nation not in nations:
            nations[nation] = nation_flag(nation)

        alt = [POS_MAP[p] for p in parse_list(r['Alternative positions']) if p in POS_MAP]

        pdict = {
            'id': int(r['ID']),
            'name': r['Name'],
            'teamId': team_id,
            'pos': gpos,
            'eaPos': ea_pos,
            'altPos': alt,
            'ovr': ovr,
            'age': int(round(fnum(r['Age']))),
            'nation': nation,
            'foot': foot_tr.get(r['Preferred foot'], r['Preferred foot']),
            'weakFoot': int(round(fnum(r['Weak foot']))) or 3,
            'skillMoves': int(round(fnum(r['Skill moves']))) or 2,
            'height': parse_int_prefix(r['Height'], 'cm') or 180,
            'weight': parse_int_prefix(r['Weight'], 'kg') or 75,
            'img': r['card'] if r['card'].startswith('http') else '',
            'stats': stats,
            'attrs': attrs,
            'styles': parse_list(r['play style']),
        }
        players_by_league[lig_id].append(pdict)

        # takim toplayici
        if team_id not in teams_acc:
            teams_acc[team_id] = {'id': team_id, 'name': team_name, 'leagueId': lig_id,
                                  'players': []}
        teams_acc[team_id]['players'].append((gpos, ovr))

    # ---- takim guc/atak/def/prestij hesabi ----
    ATT = {'Santrfor', 'Sağ Kanat', 'Sol Kanat', 'Ofansif OS', 'Sağ Açık', 'Sol Açık'}
    DEFP = {'Kaleci', 'Stoper', 'Sağ Bek', 'Sol Bek', 'DOS'}
    tier_bonus = {1: 1.0, 2: 0.5, 3: 0.0, 4: -0.6}

    teams_out = []
    pidx = 0
    for tid, t in teams_acc.items():
        ovrs = sorted((o for _, o in t['players']), reverse=True)
        gk = sorted((o for p, o in t['players'] if p == 'Kaleci'), reverse=True)
        outfield = sorted((o for p, o in t['players'] if p != 'Kaleci'), reverse=True)
        xi = ([gk[0]] if gk else []) + outfield[:11 - (1 if gk else 0)]
        xi = xi[:11] if xi else ovrs[:11]
        power = round(sum(xi) / len(xi)) if xi else 60
        att = sorted((o for p, o in t['players'] if p in ATT), reverse=True)[:4]
        dfn = (([gk[0]] if gk else []) +
               sorted((o for p, o in t['players'] if p in DEFP and p != 'Kaleci'), reverse=True)[:4])
        attack = round(sum(att) / len(att)) if att else power
        defense = round(sum(dfn) / len(dfn)) if dfn else power
        meta = LEAGUE_META[next(k for k, v in LEAGUE_META.items() if v[0] == t['leagueId'])]
        tier = meta[4]
        prestige = max(1, min(5, round((power - 60) / 5.5 + tier_bonus.get(tier, 0))))
        slug = tid.split('__', 1)[1]
        color, logo = TEAM_STYLE.get(slug, (PALETTE[pidx % len(PALETTE)], None))
        pidx += 1
        # tesisler: buyuk/koklu kulupler daha iyi (altyapida ekstra varyans)
        training = round(max(40, min(96, 45 + prestige * 9 + (power - 65) * 0.5
                                     + stable_jitter(tid + 'tr', -4, 4))))
        youth = round(max(35, min(95, 40 + prestige * 8 + (3 if tier <= 2 else 0)
                                   + stable_jitter(tid + 'yt', -7, 7))))
        teams_out.append({
            'id': tid, 'name': t['name'], 'leagueId': t['leagueId'], 'tier': tier,
            'power': power, 'attack': attack, 'defense': defense,
            'prestige': prestige, 'color': color, 'logoUrl': logo,
            'squadSize': len(t['players']),
            'facilities': {'training': training, 'youth': youth},
            '_country': meta[2],
        })

    # ---- stadyum eslestirme (ulke-kisitli bulanik) + fallback uretim ----
    stad_by_country = load_stadiums()
    league_caps = defaultdict(list)
    matched_n = 0
    for t in teams_out:
        country = COUNTRY_ALIAS.get(t['_country'], t['_country'])
        cands = stad_by_country.get(country, [])
        tn = norm_team(t['name'])
        best, bestr = None, 0.0
        for s in cands:
            r = difflib.SequenceMatcher(None, tn, s['norm']).ratio()
            if r > bestr:
                bestr, best = r, s
        if best and bestr >= 0.80 and best['cap'] > 0:
            t['stadium'] = {'name': best['name'], 'city': best['city'], 'capacity': best['cap']}
            t['_matched'] = True
            matched_n += 1
            league_caps[t['leagueId']].append(best['cap'])
        else:
            t['_matched'] = False
    for t in teams_out:
        if t.pop('_matched', False):
            t.pop('_country', None)
            continue
        caps = league_caps.get(t['leagueId'])
        base = (sum(caps) / len(caps)) if caps else TIER_DEFAULT_CAP.get(t['tier'], 12000)
        factor = 0.65 + 0.13 * t['prestige']               # 1*→0.78 .. 5*→1.30
        cap = base * factor * (0.9 + stable_jitter(t['id'] + 'cap', 0, 0.25))
        cap = int(max(2000, min(90000, round(cap / 500) * 500)))
        t['stadium'] = {'name': gen_stadium_name(t['name'], t['id']), 'city': '',
                        'capacity': cap, 'generated': True}
        t.pop('_country', None)

    teams_out.sort(key=lambda x: (x['leagueId'], -x['power']))

    # ---- lig metadata ----
    leagues_out = []
    league_index = {}
    for lname, (lid, disp, country, conf, tier, ltype) in LEAGUE_META.items():
        teamlist = [t for t in teams_out if t['leagueId'] == lid]
        if not teamlist:
            continue
        n = len(teamlist)
        weeks = 2 * (n - 1) if n % 2 == 0 else 2 * n
        avg_power = round(sum(t['power'] for t in teamlist) / n)
        leagues_out.append({
            'id': lid, 'name': disp, 'csvName': lname, 'country': country,
            'flag': nation_flag(country) if country not in ('South America',) else '🌎',
            'confederation': conf, 'tier': tier, 'type': ltype,
            'teamCount': n, 'weeks': weeks, 'avgPower': avg_power,
            'startable': ltype == 'league' and n >= 8,  # kariyer baslatmaya uygun (tam lig)
        })
        league_index[lid] = {'file': f'players/{lid}.json', 'teamCount': n,
                             'teams': [t['id'] for t in teamlist]}

    leagues_out.sort(key=lambda x: (x['tier'], -x['avgPower']))

    # ---- dosyalari yaz ----
    def write_js(path, varname, obj):
        with open(path, 'w', encoding='utf-8') as f:
            f.write(f'// OTOMATIK URETILDI - tools/build_database.py\n')
            f.write(f'window.{varname} = ')
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
            f.write(';\n')

    write_js(os.path.join(DATA_DIR, 'leagues.js'), 'DB_LEAGUES', leagues_out)
    write_js(os.path.join(DATA_DIR, 'teams.js'), 'DB_TEAMS', teams_out)
    write_js(os.path.join(DATA_DIR, 'nations.js'), 'DB_NATIONS', nations)
    write_js(os.path.join(DATA_DIR, 'ovr_coef.js'), 'DB_OVR_COEF', coefs)  # OVR formul katsayilari

    total_players = 0
    for lid, plist in players_by_league.items():
        plist.sort(key=lambda x: -x['ovr'])
        with open(os.path.join(PLAYERS_DIR, f'{lid}.json'), 'w', encoding='utf-8') as f:
            json.dump(plist, f, ensure_ascii=False, separators=(',', ':'))
        total_players += len(plist)

    json.dump(league_index, open(os.path.join(PLAYERS_DIR, 'index.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))

    # ---- rapor ----
    mae = sum(ovr_abs_err) / len(ovr_abs_err)
    print("=" * 60)
    print(f"  Ligler/kupalar : {len(leagues_out)}")
    print(f"  Takimlar       : {len(teams_out)}")
    print(f"  Oyuncular      : {total_players}  (atlanan: {skipped})")
    print(f"  Stadyum eslesti: {matched_n}/{len(teams_out)}  (kalan: uretildi)")
    print(f"  Milliyetler    : {len(nations)}")
    print(f"  OVR formul MAE : {mae:.3f}  (hedef < 2.0)  {'OK' if mae < 2.0 else 'HATA!'}")
    print("=" * 60)
    big = sorted([t for t in teams_out], key=lambda x: -x['power'])[:8]
    print("  En guclu 8 takim:")
    for t in big:
        print(f"    {t['power']:3d} ({t['prestige']}*) {t['name']}  [{t['leagueId']}]")


if __name__ == '__main__':
    main()
