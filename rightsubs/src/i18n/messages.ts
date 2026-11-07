import type { Language } from '../languages/languages.ts';

/**
 * Every text the addon shows to the viewer (in Stremio's addon list, its subtitle menu and on
 * screen), in the viewer's primary language. Fixed translations, one per language in
 * `LANGUAGES`, reviewed by people; any other language falls back to English.
 *
 * Placeholders: `{languages}`, `{primary}`, `{secondary}`. On-screen texts say "video", never
 * "episode", so they fit a movie as well as an episode. `\n` breaks the on-screen line.
 */
export interface Messages {
  /** Stremio's addon list. */
  manifestDescription: string;
  /** How `{languages}` reads in `manifestDescription` when there is a secondary language. */
  manifestLanguages: string;
  /** Subtitle menu entry while a translation is being prepared. */
  statusLabel: string;
  /** On screen, when that entry is picked and the translation is still being prepared. */
  statusPending: string;
  /** On screen, when that entry is picked and the translation is ready. */
  statusReady: string;
  /** Provisional subtitle served while the translation is still being prepared. */
  placeholder: string;
  /** Subtitle menu entry when the video already has a subtitle in the viewer's language. */
  embeddedLabel: string;
  /** On screen, when that entry is picked. */
  embeddedNotice: string;
  /** Shown now and then inside a machine-translated subtitle. */
  translated: string;
  /** The same, when the timing of the source subtitle could not be checked against the video. */
  translatedUnconfirmed: string;
}

const en: Messages = {
  manifestDescription: 'The right subtitle, synced automatically — {languages}.',
  manifestLanguages: '{primary} (secondary: {secondary})',
  statusLabel: 'RightSubs: preparing subtitle, wait 30 s',
  statusPending:
    '[RightSubs] Preparing the translated subtitle (first time for this video).\nWait about 30 s. If it does not show up, leave and open the video again.',
  statusReady: '[RightSubs] The translated subtitle is ready.\nPick it in the subtitle menu or leave and open the video again.',
  placeholder: '[RightSubs] Preparing the translated subtitle (first time for this video).\nLeave the video and open it again in about 30 s.',
  embeddedLabel: 'RightSubs: the video already has an embedded subtitle in your language, pick it in the menu',
  embeddedNotice: '[RightSubs] This video contains an embedded subtitle in your language.\nPick it in the subtitle menu (the one from the video itself).',
  translated: '[Subtitles machine-translated by AI (DeepL)]',
  translatedUnconfirmed: '[Subtitles machine-translated by AI (DeepL) - timing not confirmed]',
};

const ptBR: Messages = {
  manifestDescription: 'Legenda certa, sincronizada automaticamente — {languages}.',
  manifestLanguages: '{primary} (secundária: {secondary})',
  statusLabel: 'RightSubs: legenda em preparo, aguarde 30 s',
  statusPending:
    '[RightSubs] Preparando a legenda traduzida (primeira vez deste vídeo).\nAguarde cerca de 30 s. Se ela não aparecer, saia e abra o vídeo de novo.',
  statusReady: '[RightSubs] A legenda traduzida já está pronta.\nEscolha-a no menu de legendas ou saia e abra o vídeo de novo.',
  placeholder: '[RightSubs] Preparando a legenda traduzida (primeira vez deste vídeo).\nSaia do vídeo e abra de novo em cerca de 30 s.',
  embeddedLabel: 'RightSubs: o vídeo já tem legenda embutida no seu idioma, escolha-a no menu',
  embeddedNotice: '[RightSubs] Este vídeo contém a legenda embutida no seu idioma.\nEscolha-a no menu de legendas (a do próprio vídeo).',
  translated: '[Legenda traduzida por IA (DeepL)]',
  translatedUnconfirmed: '[Legenda traduzida por IA (DeepL) - tempo não confirmado]',
};

const ptPT: Messages = {
  manifestDescription: 'Legenda certa, sincronizada automaticamente — {languages}.',
  manifestLanguages: '{primary} (secundária: {secondary})',
  statusLabel: 'RightSubs: legenda em preparação, aguarde 30 s',
  statusPending:
    '[RightSubs] A preparar a legenda traduzida (primeira vez deste vídeo).\nAguarde cerca de 30 s. Se não aparecer, saia e abra o vídeo novamente.',
  statusReady: '[RightSubs] A legenda traduzida já está pronta.\nEscolha-a no menu de legendas ou saia e abra o vídeo novamente.',
  placeholder: '[RightSubs] A preparar a legenda traduzida (primeira vez deste vídeo).\nSaia do vídeo e abra-o novamente dentro de cerca de 30 s.',
  embeddedLabel: 'RightSubs: o vídeo já tem legenda incorporada no seu idioma, escolha-a no menu',
  embeddedNotice: '[RightSubs] Este vídeo contém legenda incorporada no seu idioma.\nEscolha-a no menu de legendas (a do próprio vídeo).',
  translated: '[Legenda traduzida por IA (DeepL)]',
  translatedUnconfirmed: '[Legenda traduzida por IA (DeepL) - tempo não confirmado]',
};

const es: Messages = {
  manifestDescription: 'Los subtítulos correctos, sincronizados automáticamente — {languages}.',
  manifestLanguages: '{primary} (secundario: {secondary})',
  statusLabel: 'RightSubs: preparando subtítulos, espera 30 s',
  statusPending:
    '[RightSubs] Preparando los subtítulos traducidos (primera vez para este vídeo).\nEspera unos 30 s. Si no aparecen, sal y vuelve a abrir el vídeo.',
  statusReady: '[RightSubs] Los subtítulos traducidos ya están listos.\nElígelos en el menú de subtítulos o sal y vuelve a abrir el vídeo.',
  placeholder: '[RightSubs] Preparando los subtítulos traducidos (primera vez para este vídeo).\nSal del vídeo y vuelve a abrirlo en unos 30 s.',
  embeddedLabel: 'RightSubs: el vídeo ya tiene subtítulos integrados en tu idioma, elígelos en el menú',
  embeddedNotice: '[RightSubs] Este vídeo contiene subtítulos integrados en tu idioma.\nElígelos en el menú de subtítulos (los del propio vídeo).',
  translated: '[Subtítulos traducidos automáticamente por IA (DeepL)]',
  translatedUnconfirmed: '[Subtítulos traducidos automáticamente por IA (DeepL) - sincronización no confirmada]',
};

const fr: Messages = {
  manifestDescription: 'Les bons sous-titres, synchronisés automatiquement — {languages}.',
  manifestLanguages: '{primary} (secondaire : {secondary})',
  statusLabel: 'RightSubs : sous-titres en préparation, patientez 30 s',
  statusPending:
    "[RightSubs] Préparation des sous-titres traduits (première fois pour cette vidéo).\nPatientez environ 30 s. S'ils n'apparaissent pas, quittez puis rouvrez la vidéo.",
  statusReady: '[RightSubs] Les sous-titres traduits sont prêts.\nChoisissez-les dans le menu des sous-titres ou quittez puis rouvrez la vidéo.',
  placeholder: '[RightSubs] Préparation des sous-titres traduits (première fois pour cette vidéo).\nQuittez la vidéo et rouvrez-la dans environ 30 s.',
  embeddedLabel: 'RightSubs : la vidéo contient déjà des sous-titres intégrés dans votre langue, choisissez-les dans le menu',
  embeddedNotice:
    '[RightSubs] Cette vidéo contient des sous-titres intégrés dans votre langue.\nChoisissez-les dans le menu des sous-titres (ceux de la vidéo elle-même).',
  translated: '[Sous-titres traduits automatiquement par IA (DeepL)]',
  translatedUnconfirmed: '[Sous-titres traduits automatiquement par IA (DeepL) - synchronisation non confirmée]',
};

const de: Messages = {
  manifestDescription: 'Die richtigen Untertitel, automatisch synchronisiert — {languages}.',
  manifestLanguages: '{primary} (sekundär: {secondary})',
  statusLabel: 'RightSubs: Untertitel werden vorbereitet, bitte 30 s warten',
  statusPending:
    '[RightSubs] Die übersetzten Untertitel werden vorbereitet (erstes Mal für dieses Video).\nBitte etwa 30 s warten. Falls sie nicht erscheinen, das Video verlassen und erneut öffnen.',
  statusReady: '[RightSubs] Die übersetzten Untertitel sind bereit.\nIm Untertitelmenü auswählen oder das Video verlassen und erneut öffnen.',
  placeholder: '[RightSubs] Die übersetzten Untertitel werden vorbereitet (erstes Mal für dieses Video).\nDas Video verlassen und in etwa 30 s erneut öffnen.',
  embeddedLabel: 'RightSubs: Das Video hat bereits eingebettete Untertitel in deiner Sprache, wähle sie im Menü',
  embeddedNotice: '[RightSubs] Dieses Video enthält eingebettete Untertitel in deiner Sprache.\nWähle sie im Untertitelmenü (die des Videos selbst).',
  translated: '[Untertitel per KI maschinell übersetzt (DeepL)]',
  translatedUnconfirmed: '[Untertitel per KI maschinell übersetzt (DeepL) - Timing nicht bestätigt]',
};

const it: Messages = {
  manifestDescription: 'I sottotitoli giusti, sincronizzati automaticamente — {languages}.',
  manifestLanguages: '{primary} (secondaria: {secondary})',
  statusLabel: 'RightSubs: sottotitoli in preparazione, attendi 30 s',
  statusPending:
    '[RightSubs] Preparazione dei sottotitoli tradotti (prima volta per questo video).\nAttendi circa 30 s. Se non compaiono, esci e riapri il video.',
  statusReady: '[RightSubs] I sottotitoli tradotti sono pronti.\nSceglili nel menu dei sottotitoli oppure esci e riapri il video.',
  placeholder: '[RightSubs] Preparazione dei sottotitoli tradotti (prima volta per questo video).\nEsci dal video e riaprilo tra circa 30 s.',
  embeddedLabel: 'RightSubs: il video ha già sottotitoli incorporati nella tua lingua, sceglili nel menu',
  embeddedNotice: '[RightSubs] Questo video contiene sottotitoli incorporati nella tua lingua.\nSceglili nel menu dei sottotitoli (quelli del video stesso).',
  translated: "[Sottotitoli tradotti automaticamente dall'IA (DeepL)]",
  translatedUnconfirmed: "[Sottotitoli tradotti automaticamente dall'IA (DeepL) - sincronizzazione non confermata]",
};

const nl: Messages = {
  manifestDescription: 'De juiste ondertitels, automatisch gesynchroniseerd — {languages}.',
  manifestLanguages: '{primary} (secundair: {secondary})',
  statusLabel: 'RightSubs: ondertitels worden voorbereid, wacht 30 s',
  statusPending:
    '[RightSubs] De vertaalde ondertitels worden voorbereid (eerste keer voor deze video).\nWacht ongeveer 30 s. Verschijnen ze niet, sluit de video dan en open hem opnieuw.',
  statusReady: '[RightSubs] De vertaalde ondertitels zijn klaar.\nKies ze in het ondertitelmenu of sluit de video en open hem opnieuw.',
  placeholder: '[RightSubs] De vertaalde ondertitels worden voorbereid (eerste keer voor deze video).\nSluit de video en open hem over ongeveer 30 s opnieuw.',
  embeddedLabel: 'RightSubs: de video heeft al ingebouwde ondertitels in jouw taal, kies ze in het menu',
  embeddedNotice: '[RightSubs] Deze video bevat ingebouwde ondertitels in jouw taal.\nKies ze in het ondertitelmenu (die van de video zelf).',
  translated: '[Ondertitels automatisch vertaald door AI (DeepL)]',
  translatedUnconfirmed: '[Ondertitels automatisch vertaald door AI (DeepL) - timing niet bevestigd]',
};

const pl: Messages = {
  manifestDescription: 'Właściwe napisy, automatycznie zsynchronizowane — {languages}.',
  manifestLanguages: '{primary} (dodatkowy: {secondary})',
  statusLabel: 'RightSubs: przygotowywanie napisów, poczekaj 30 s',
  statusPending:
    '[RightSubs] Przygotowywanie przetłumaczonych napisów (pierwszy raz dla tego wideo).\nPoczekaj około 30 s. Jeśli się nie pojawią, wyjdź i otwórz wideo ponownie.',
  statusReady: '[RightSubs] Przetłumaczone napisy są gotowe.\nWybierz je w menu napisów albo wyjdź i otwórz wideo ponownie.',
  placeholder: '[RightSubs] Przygotowywanie przetłumaczonych napisów (pierwszy raz dla tego wideo).\nWyjdź z wideo i otwórz je ponownie za około 30 s.',
  embeddedLabel: 'RightSubs: wideo ma już wbudowane napisy w twoim języku, wybierz je w menu',
  embeddedNotice: '[RightSubs] To wideo zawiera wbudowane napisy w twoim języku.\nWybierz je w menu napisów (te z samego wideo).',
  translated: '[Napisy przetłumaczone maszynowo przez AI (DeepL)]',
  translatedUnconfirmed: '[Napisy przetłumaczone maszynowo przez AI (DeepL) - synchronizacja niepotwierdzona]',
};

const ru: Messages = {
  manifestDescription: 'Правильные субтитры с автоматической синхронизацией — {languages}.',
  manifestLanguages: '{primary} (дополнительный: {secondary})',
  statusLabel: 'RightSubs: субтитры готовятся, подождите 30 с',
  statusPending:
    '[RightSubs] Готовим переведённые субтитры (первый раз для этого видео).\nПодождите около 30 с. Если они не появятся, выйдите и откройте видео снова.',
  statusReady: '[RightSubs] Переведённые субтитры готовы.\nВыберите их в меню субтитров или выйдите и откройте видео снова.',
  placeholder: '[RightSubs] Готовим переведённые субтитры (первый раз для этого видео).\nВыйдите из видео и откройте его снова примерно через 30 с.',
  embeddedLabel: 'RightSubs: в видео уже есть встроенные субтитры на вашем языке, выберите их в меню',
  embeddedNotice: '[RightSubs] В этом видео есть встроенные субтитры на вашем языке.\nВыберите их в меню субтитров (из самого видео).',
  translated: '[Субтитры переведены ИИ (DeepL)]',
  translatedUnconfirmed: '[Субтитры переведены ИИ (DeepL) - синхронизация не подтверждена]',
};

const tr: Messages = {
  manifestDescription: 'Doğru altyazı, otomatik olarak senkronize — {languages}.',
  manifestLanguages: '{primary} (ikincil: {secondary})',
  statusLabel: 'RightSubs: altyazı hazırlanıyor, 30 sn bekleyin',
  statusPending:
    '[RightSubs] Çevrilmiş altyazı hazırlanıyor (bu video için ilk kez).\nYaklaşık 30 sn bekleyin. Görünmezse videodan çıkıp yeniden açın.',
  statusReady: '[RightSubs] Çevrilmiş altyazı hazır.\nAltyazı menüsünden seçin ya da videodan çıkıp yeniden açın.',
  placeholder: '[RightSubs] Çevrilmiş altyazı hazırlanıyor (bu video için ilk kez).\nVideodan çıkın ve yaklaşık 30 sn sonra yeniden açın.',
  embeddedLabel: 'RightSubs: videoda zaten sizin dilinizde gömülü altyazı var, menüden seçin',
  embeddedNotice: '[RightSubs] Bu videoda sizin dilinizde gömülü altyazı var.\nAltyazı menüsünden seçin (videonun kendi altyazısı).',
  translated: '[Yapay zekâ ile makine çevirisi altyazı (DeepL)]',
  translatedUnconfirmed: '[Yapay zekâ ile makine çevirisi altyazı (DeepL) - zamanlama doğrulanmadı]',
};

const ar: Messages = {
  manifestDescription: 'الترجمة المناسبة، مُزامَنة تلقائيًا — {languages}.',
  manifestLanguages: '{primary} (الثانوية: {secondary})',
  statusLabel: 'RightSubs: جارٍ تجهيز الترجمة، انتظر 30 ثانية',
  statusPending:
    '[RightSubs] جارٍ تجهيز الترجمة الآلية (أول مرة لهذا الفيديو).\nانتظر نحو 30 ثانية. إن لم تظهر، اخرج من الفيديو وافتحه مجددًا.',
  statusReady: '[RightSubs] الترجمة الآلية جاهزة.\nاخترها من قائمة الترجمات أو اخرج من الفيديو وافتحه مجددًا.',
  placeholder: '[RightSubs] جارٍ تجهيز الترجمة الآلية (أول مرة لهذا الفيديو).\nاخرج من الفيديو وافتحه مجددًا بعد نحو 30 ثانية.',
  embeddedLabel: 'RightSubs: الفيديو يحتوي بالفعل على ترجمة مدمجة بلغتك، اخترها من القائمة',
  embeddedNotice: '[RightSubs] هذا الفيديو يحتوي على ترجمة مدمجة بلغتك.\nاخترها من قائمة الترجمات (ترجمة الفيديو نفسه).',
  translated: '[ترجمة آلية بالذكاء الاصطناعي (DeepL)]',
  translatedUnconfirmed: '[ترجمة آلية بالذكاء الاصطناعي (DeepL) - التوقيت غير مؤكد]',
};

const ja: Messages = {
  manifestDescription: '正しい字幕を自動で同期 — {languages}。',
  manifestLanguages: '{primary}（第2言語: {secondary}）',
  statusLabel: 'RightSubs: 字幕を準備中、30 秒お待ちください',
  statusPending:
    '[RightSubs] 翻訳字幕を準備しています（この動画では初回）。\n30 秒ほどお待ちください。表示されない場合は、動画を閉じてもう一度開いてください。',
  statusReady: '[RightSubs] 翻訳字幕の準備ができました。\n字幕メニューで選ぶか、動画を閉じてもう一度開いてください。',
  placeholder: '[RightSubs] 翻訳字幕を準備しています（この動画では初回）。\n動画を閉じて、30 秒ほど後にもう一度開いてください。',
  embeddedLabel: 'RightSubs: この動画にはお使いの言語の字幕がすでに埋め込まれています。メニューで選択してください',
  embeddedNotice: '[RightSubs] この動画にはお使いの言語の埋め込み字幕があります。\n字幕メニューで選択してください（動画に含まれている字幕）。',
  translated: '[AI による機械翻訳字幕 (DeepL)]',
  translatedUnconfirmed: '[AI による機械翻訳字幕 (DeepL) - タイミング未確認]',
};

const ko: Messages = {
  manifestDescription: '알맞은 자막, 자동 동기화 — {languages}.',
  manifestLanguages: '{primary} (보조: {secondary})',
  statusLabel: 'RightSubs: 자막 준비 중, 30초 기다려 주세요',
  statusPending:
    '[RightSubs] 번역 자막을 준비하고 있습니다 (이 동영상은 처음).\n약 30초 기다려 주세요. 나타나지 않으면 동영상을 닫고 다시 여세요.',
  statusReady: '[RightSubs] 번역 자막이 준비되었습니다.\n자막 메뉴에서 선택하거나 동영상을 닫고 다시 여세요.',
  placeholder: '[RightSubs] 번역 자막을 준비하고 있습니다 (이 동영상은 처음).\n동영상을 닫고 약 30초 후에 다시 여세요.',
  embeddedLabel: 'RightSubs: 이 동영상에는 이미 사용자 언어의 내장 자막이 있습니다. 메뉴에서 선택하세요',
  embeddedNotice: '[RightSubs] 이 동영상에는 사용자 언어의 내장 자막이 있습니다.\n자막 메뉴에서 선택하세요 (동영상 자체 자막).',
  translated: '[AI 기계 번역 자막 (DeepL)]',
  translatedUnconfirmed: '[AI 기계 번역 자막 (DeepL) - 싱크 미확인]',
};

const zhCN: Messages = {
  manifestDescription: '合适的字幕，自动同步 — {languages}。',
  manifestLanguages: '{primary}（次要：{secondary}）',
  statusLabel: 'RightSubs：正在准备字幕，请等待 30 秒',
  statusPending: '[RightSubs] 正在准备翻译字幕（此视频首次）。\n请等待约 30 秒。如果没有出现，请退出并重新打开视频。',
  statusReady: '[RightSubs] 翻译字幕已准备好。\n请在字幕菜单中选择，或退出并重新打开视频。',
  placeholder: '[RightSubs] 正在准备翻译字幕（此视频首次）。\n请退出视频，约 30 秒后重新打开。',
  embeddedLabel: 'RightSubs：视频已内嵌您语言的字幕，请在菜单中选择',
  embeddedNotice: '[RightSubs] 此视频包含您语言的内嵌字幕。\n请在字幕菜单中选择（视频自带的字幕）。',
  translated: '[AI 机器翻译字幕 (DeepL)]',
  translatedUnconfirmed: '[AI 机器翻译字幕 (DeepL) - 时间轴未确认]',
};

const zhTW: Messages = {
  manifestDescription: '合適的字幕，自動同步 — {languages}。',
  manifestLanguages: '{primary}（次要：{secondary}）',
  statusLabel: 'RightSubs：正在準備字幕，請等待 30 秒',
  statusPending: '[RightSubs] 正在準備翻譯字幕（此影片首次）。\n請等待約 30 秒。如果沒有出現，請退出並重新開啟影片。',
  statusReady: '[RightSubs] 翻譯字幕已準備好。\n請在字幕選單中選擇，或退出並重新開啟影片。',
  placeholder: '[RightSubs] 正在準備翻譯字幕（此影片首次）。\n請退出影片，約 30 秒後重新開啟。',
  embeddedLabel: 'RightSubs：影片已內嵌您語言的字幕，請在選單中選擇',
  embeddedNotice: '[RightSubs] 此影片包含您語言的內嵌字幕。\n請在字幕選單中選擇（影片本身的字幕）。',
  translated: '[AI 機器翻譯字幕 (DeepL)]',
  translatedUnconfirmed: '[AI 機器翻譯字幕 (DeepL) - 時間軸未確認]',
};

/** By `Language.tag`. */
export const MESSAGES: Readonly<Record<string, Messages>> = {
  en,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  es,
  fr,
  de,
  it,
  nl,
  pl,
  ru,
  tr,
  ar,
  ja,
  ko,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

/** The texts in this language, or in English when there is no translation for it. */
export function messagesFor(language: Language): Messages {
  return MESSAGES[language.tag] ?? en;
}

/** Fills `{name}` placeholders. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
