export interface Language {
  /** Canonical tag shown to the user (e.g. "pt-BR"). */
  tag: string;
  name: string;
  /** Code used in Stremio subtitle objects (OpenSubtitles legacy 3-letter code). */
  stremio: string;
  /** Code used by the OpenSubtitles REST API. */
  opensubtitles: string;
  /** Other spellings accepted in config.yaml. */
  aliases: string[];
}

// The stremio/opensubtitles codes follow OpenSubtitles conventions; `pob`/`por`/`eng`
// were confirmed in the official OpenSubtitles v3 addon responses (docs/DESCOBERTAS.md).
export const LANGUAGES: readonly Language[] = [
  { tag: 'pt-BR', name: 'Português (Brasil)', stremio: 'pob', opensubtitles: 'pt-br', aliases: ['pob', 'ptbr', 'brazilian'] },
  { tag: 'pt-PT', name: 'Português (Portugal)', stremio: 'por', opensubtitles: 'pt-pt', aliases: ['por'] },
  { tag: 'en', name: 'English', stremio: 'eng', opensubtitles: 'en', aliases: ['en-us', 'en-gb', 'eng', 'english'] },
  { tag: 'es', name: 'Español', stremio: 'spa', opensubtitles: 'es', aliases: ['es-es', 'spa', 'spanish'] },
  { tag: 'fr', name: 'Français', stremio: 'fre', opensubtitles: 'fr', aliases: ['fr-fr', 'fre', 'fra', 'french'] },
  { tag: 'de', name: 'Deutsch', stremio: 'ger', opensubtitles: 'de', aliases: ['de-de', 'ger', 'deu', 'german'] },
  { tag: 'it', name: 'Italiano', stremio: 'ita', opensubtitles: 'it', aliases: ['it-it', 'ita', 'italian'] },
  { tag: 'nl', name: 'Nederlands', stremio: 'dut', opensubtitles: 'nl', aliases: ['nl-nl', 'dut', 'nld', 'dutch'] },
  { tag: 'pl', name: 'Polski', stremio: 'pol', opensubtitles: 'pl', aliases: ['pl-pl', 'pol', 'polish'] },
  { tag: 'ru', name: 'Русский', stremio: 'rus', opensubtitles: 'ru', aliases: ['ru-ru', 'rus', 'russian'] },
  { tag: 'tr', name: 'Türkçe', stremio: 'tur', opensubtitles: 'tr', aliases: ['tr-tr', 'tur', 'turkish'] },
  { tag: 'ar', name: 'العربية', stremio: 'ara', opensubtitles: 'ar', aliases: ['ara', 'arabic'] },
  { tag: 'ja', name: '日本語', stremio: 'jpn', opensubtitles: 'ja', aliases: ['ja-jp', 'jpn', 'japanese'] },
  { tag: 'ko', name: '한국어', stremio: 'kor', opensubtitles: 'ko', aliases: ['ko-kr', 'kor', 'korean'] },
  { tag: 'zh-CN', name: '中文 (简体)', stremio: 'chi', opensubtitles: 'zh-cn', aliases: ['chi', 'zho', 'chinese'] },
  { tag: 'zh-TW', name: '中文 (繁體)', stremio: 'zht', opensubtitles: 'zh-tw', aliases: ['zht'] },
];

export const LANGUAGE_EXAMPLES = ['pt-BR', 'pt-PT', 'en-US', 'es', 'fr'];

const normalize = (value: string) => value.trim().toLowerCase().replaceAll('_', '-');

export function findLanguage(value: string): Language | undefined {
  const wanted = normalize(value);
  return LANGUAGES.find((lang) => normalize(lang.tag) === wanted || lang.aliases.includes(wanted));
}

/** Language of a Stremio subtitle object (`lang`), e.g. `pob` → pt-BR. */
export function findByStremioCode(code: string): Language | undefined {
  const wanted = normalize(code);
  return LANGUAGES.find((lang) => lang.stremio === wanted);
}

/** Language of an OpenSubtitles API result (`language`), e.g. `pt-BR` → pt-BR. */
export function findByOpenSubtitlesCode(code: string): Language | undefined {
  const wanted = normalize(code);
  return LANGUAGES.find((lang) => lang.opensubtitles === wanted);
}
