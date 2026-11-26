export interface VenueInfo {
  id: string;
  shortName: string;
  fullName: string;
  courtType: 'indoor' | 'outdoor';
}

/** Known Okayama/Kurashiki pickleball venues with indoor/outdoor court metadata. */
export const VENUES: VenueInfo[] = [
  {
    id: 'fukuda',
    shortName: '福田公園',
    fullName: 'シマダみらいアリーナ水島（福田公園）',
    courtType: 'indoor',
  },
  {
    id: 'mizushima',
    shortName: '水島体育館',
    fullName: '水島体育館',
    courtType: 'indoor',
  },
  {
    id: 'kurashiki_gym',
    shortName: '倉敷体育館',
    fullName: '倉敷体育館',
    courtType: 'indoor',
  },
  {
    id: 'kurashiki_weightlifting',
    shortName: '倉敷運動公園WL場',
    fullName: '倉敷運動公園 ウエイトリフティング場',
    courtType: 'indoor',
  },
  {
    id: 'mizushima_fureai',
    shortName: '水島ふれあいセンター',
    fullName: '水島ふれあいセンター 体育館',
    courtType: 'indoor',
  },
  {
    id: 'mabi',
    shortName: '真備総合公園',
    fullName: '真備総合公園 体育館',
    courtType: 'indoor',
  },
  {
    id: 'tamashima',
    shortName: '玉島の森',
    fullName: '玉島の森 体育館',
    courtType: 'indoor',
  },
  {
    id: 'nakayama',
    shortName: '中山公園',
    fullName: '中山公園 体育館',
    courtType: 'indoor',
  },
  {
    id: 'nadasaki',
    shortName: '灘崎体育センター',
    fullName: '灘崎体育センター',
    courtType: 'indoor',
  },
  {
    id: 'futsukaichi',
    shortName: '二日市公園テニス',
    fullName: '二日市公園テニスコート（照明あり）',
    courtType: 'outdoor',
  },
  {
    id: 'yoshiigawa_1',
    shortName: '吉井川第1緑地',
    fullName: '吉井川第1緑地 テニスコート（〜17:00）',
    courtType: 'outdoor',
  },
  {
    id: 'hyakkengawa_a',
    shortName: '百間川緑地(A・東川原)',
    fullName: '百間川緑地 テニスコートA（東川原・ハードコート・〜17:00）',
    courtType: 'outdoor',
  },
  {
    id: 'hyakkengawa_c',
    shortName: '百間川緑地(C・神下)',
    fullName: '百間川緑地 テニスコートC（神下・ハードコート・〜17:00）',
    courtType: 'outdoor',
  },
];

const VENUE_MAP = new Map<string, VenueInfo>(VENUES.map((v) => [v.id, v]));

/** Resolves a venue ID or manual venue name into structured venue metadata with court type. */
export function resolveVenue(
  venueId: string,
  manualVenueName?: string | null,
  fallbackCourtType: 'indoor' | 'outdoor' = 'indoor'
): VenueInfo {
  if (venueId && venueId !== 'other') {
    const found = VENUE_MAP.get(venueId);
    if (found) return found;
  }
  const cleanName = manualVenueName?.trim() || venueId || 'Custom Venue';
  return {
    id: venueId || 'other',
    shortName: cleanName,
    fullName: cleanName,
    courtType: fallbackCourtType,
  };
}
