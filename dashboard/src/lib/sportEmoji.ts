const SPORT_LABEL_MAP: Record<string, string> = {
  'nfl': '🏈',
  'american football': '🏈',
  'nba': '🏀',
  'basketball': '🏀',
  'wnba': '🏀',
  'soccer': '⚽',
  'football': '⚽',
  'mlb': '⚾',
  'baseball': '⚾',
  'tennis': '🎾',
  'golf': '⛳',
  'pga': '⛳',
  'ufc': '🥊',
  'mma': '🥊',
  'boxing': '🥊',
  'nhl': '🏒',
  'hockey': '🏒',
  'cricket': '🏏',
  'ipl': '🏏',
  'rugby': '🏉',
  'formula 1': '🏎️',
  'f1': '🏎️',
  'racing': '🏎️',
  'nascar': '🏎️',
  'olympics': '🏅',
  'olympic': '🏅',
};

export function getSportEmoji(title: string, sport?: string | null): string {
  if (sport) {
    const key = sport.toLowerCase();
    if (SPORT_LABEL_MAP[key]) return SPORT_LABEL_MAP[key];
    // Partial match for labels like "NFL Football" or "NBA Basketball"
    for (const [label, emoji] of Object.entries(SPORT_LABEL_MAP)) {
      if (key.includes(label)) return emoji;
    }
  }

  // Fallback: title-based matching
  const t = title.toLowerCase();
  if (t.includes('nfl') || t.includes('super bowl') || (t.includes('football') && !t.includes('soccer'))) return '🏈';
  if (t.includes('nba') || t.includes('basketball')) return '🏀';
  if (t.includes('soccer') || t.includes('premier league') || t.includes('champions league') || t.includes('copa') || t.includes('la liga') || t.includes('serie a') || t.includes('bundesliga') || t.includes(' fc ') || t.includes(' united') || t.includes('world cup')) return '⚽';
  if (t.includes('mlb') || t.includes('baseball') || t.includes('world series')) return '⚾';
  if (t.includes('tennis') || t.includes('wimbledon') || t.includes('roland garros') || t.includes('australian open') || t.includes('us open')) return '🎾';
  if (t.includes('golf') || t.includes('pga') || t.includes('masters') || t.includes('the open')) return '⛳';
  if (t.includes('ufc') || t.includes('mma') || t.includes('boxing') || t.includes('fight')) return '🥊';
  if (t.includes('nhl') || t.includes('hockey')) return '🏒';
  if (t.includes('cricket') || t.includes('ipl')) return '🏏';
  if (t.includes('rugby')) return '🏉';
  if (t.includes('f1') || t.includes('formula') || t.includes('racing') || t.includes('nascar')) return '🏎️';
  if (t.includes('olympic') || t.includes('olympics')) return '🏅';
  return '🐋';
}
