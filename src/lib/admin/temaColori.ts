/**
 * I COLORI DEL TEMA, COMPRESI QUELLI CHE NESSUNO SCEGLIE.
 *
 * ⚠️ ZERO IMPORT, DI PROPOSITO. Questo file lo carica il server (adminBoot),
 * lo carica il browser (AdminNav, login, reset-password) e lo carica il test.
 * Un solo `import` da qui dentro — anche indiretto, anche solo di tipi che si
 * portano dietro `db.ts` — e il test non parte piu': vitest direbbe "0 test",
 * cioe' verde, e nessuno se ne accorgerebbe. Vedi ENGINE.md, "Test unitari".
 *
 * IL PROBLEMA CHE RISOLVE. Il tema ha NOVE colori scelti a mano, e fra questi
 * `header` e `bg` sono indipendenti: la barra in alto puo' essere di un colore
 * e la pagina di un altro. Ma il TESTO e' uno solo — `text` e `muted` — e vale
 * in tutti e due i posti. Finche' i temi sono stati tutti scuri nessuno se n'e'
 * accorto. Il giorno che un cliente ha chiesto header rosso e pagina bianca, il
 * testo giusto per la pagina (quasi nero) e' finito dentro una barra rossa:
 * illeggibile, e senza un errore da nessuna parte.
 *
 * LA CURA. Il colore del testo dell'header non si sceglie: si CALCOLA dalla
 * luminanza dell'header. Barra scura -> testo bianco. Barra chiara -> il testo
 * della pagina. Due variabili in piu', `--c-htext` e `--c-hmuted`, che l'header
 * e la barra di navigazione usano al posto di `--c-text` e `--c-muted`.
 *
 * Stesso ragionamento per `--c-hactive`: la voce attiva della barra si colora
 * di `accent`, e se l'accent e' quasi uguale all'header la pillola sparisce
 * dentro lo sfondo. Quando i due colori sono troppo vicini si ripiega sul
 * testo dell'header, che per costruzione un contrasto ce l'ha.
 */

/** Un colore del tema e' SEMPRE #rrggbb: niente nomi, niente rgb(), niente 3 cifre. */
export const RE_HEX = /^#[0-9a-fA-F]{6}$/;

/** Le nove chiavi scelte a mano in Réglages → Design. */
export const CHIAVI_COLORE = [
  "accent", "hover", "bg", "header", "card", "input", "line", "muted", "text",
] as const;

/** Componenti 0-255 di un #rrggbb. `null` se non e' un colore valido. */
export function rgb(hex: unknown): [number, number, number] | null {
  if (typeof hex !== "string" || !RE_HEX.test(hex.trim())) return null;
  const h = hex.trim().slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Luminanza percepita, 0 (nero) → 1 (bianco). Pesi ITU-R BT.601: l'occhio
 * vede il verde molto piu' del blu, quindi una media semplice sbaglierebbe —
 * un blu pieno risulterebbe "medio" e si prenderebbe il testo nero.
 */
export function luminanza(hex: unknown): number | null {
  const c = rgb(hex);
  if (!c) return null;
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

/**
 * Sopra questa luminanza lo sfondo e' "chiaro" e vuole testo scuro.
 * 0.6 e' la soglia che l'header usava gia' per il nome dell'utente: resta
 * quella, cosi' non ci sono due idee diverse di "chiaro" nello stesso schermo.
 */
export const SOGLIA_CHIARO = 0.6;

/** Distanza fra due colori (0-1). Serve solo a dire "troppo simili", non e' una metrica fine. */
export function distanza(a: unknown, b: unknown): number | null {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return null;
  return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 765;
}

/**
 * Sotto questa distanza due colori si confondono a vista su uno schermo.
 * ⚠️ 0.18 e non 0.12: il caso che ha fatto nascere questa regola e' BROS, con
 * header rosso #e30613 e accent bordeaux #840008 — distanza 0.15. Non sono lo
 * stesso colore, ma sono due rossi scuri vicini, e una pillola bordeaux dentro
 * una barra rossa non si legge come "sono qui". Meglio sbagliare per eccesso:
 * il ripiego e' il testo dell'header, che un contrasto ce l'ha per costruzione.
 */
export const SOGLIA_SIMILI = 0.18;

/** Le tre derivate: calcolate, mai scelte, mai salvate in app_config. */
export const CHIAVI_DERIVATE = ["--c-htext", "--c-hmuted", "--c-hactive", "--c-hactive-text"] as const;

/**
 * TUTTI i nomi di variabile che questo file puo' dichiarare. Serve a chi
 * applica il tema nel browser: prima si tolgono tutte, poi si rimettono solo
 * quelle che il tema nuovo dichiara — altrimenti un colore di un tema vecchio
 * resterebbe appiccicato al <html> finche' non si ricarica la pagina.
 */
export const NOMI_VARIABILI: string[] = [
  ...CHIAVI_COLORE.map((k) => `--c-${k}`),
  ...CHIAVI_DERIVATE,
];

const BIANCO = "#ffffff";
const BIANCO_SMORZATO = "rgba(255,255,255,0.72)";

/**
 * Le variabili CSS del tema: le nove salvate piu' le tre derivate.
 * Dichiara SOLO quello che sa: una chiave assente o malformata resta il
 * default della pagina, che e' il comportamento di sempre.
 */
export function variabiliTema(theme: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const k of CHIAVI_COLORE) {
    const v = theme[k];
    if (typeof v === "string" && RE_HEX.test(v)) out.push([`--c-${k}`, v.toLowerCase()]);
  }

  // Lo sfondo della barra in alto: `header` se c'e', altrimenti `bg` — la
  // stessa catena di ripiego che i CSS scrivono come var(--c-header, var(--c-bg)).
  const sfondo = (typeof theme.header === "string" && RE_HEX.test(theme.header))
    ? theme.header
    : (typeof theme.bg === "string" && RE_HEX.test(theme.bg) ? theme.bg : null);
  const lum = luminanza(sfondo);
  if (lum === null) return out; // tema senza header ne' bg: niente da derivare

  const chiaro = lum > SOGLIA_CHIARO;
  const testo = typeof theme.text === "string" && RE_HEX.test(theme.text) ? theme.text.toLowerCase() : null;
  const smorzato = typeof theme.muted === "string" && RE_HEX.test(theme.muted) ? theme.muted.toLowerCase() : null;

  // Barra chiara: il testo della pagina va bene. Barra scura: bianco.
  out.push(["--c-htext", chiaro ? (testo ?? "#111111") : BIANCO]);
  out.push(["--c-hmuted", chiaro ? (smorzato ?? "#6b7075") : BIANCO_SMORZATO]);

  // Voce attiva della barra: accent, salvo quando si confonde con l'header.
  const acc = typeof theme.accent === "string" && RE_HEX.test(theme.accent) ? theme.accent.toLowerCase() : null;
  const d = distanza(acc, sfondo);
  const confuso = acc !== null && d !== null && d < SOGLIA_SIMILI;
  out.push(["--c-hactive", confuso ? (chiaro ? (testo ?? "#111111") : BIANCO) : (acc ?? "")]);
  if (out[out.length - 1][1] === "") out.pop(); // nessun accent salvato: lascia il default

  // Il testo DENTRO la pillola attiva: deve contrastare con la pillola stessa,
  // non con l'header. Pillola scura -> bianco, pillola chiara -> testo scuro.
  const pillola = confuso ? (chiaro ? testo : BIANCO) : acc;
  const lumP = luminanza(pillola);
  if (lumP !== null) out.push(["--c-hactive-text", lumP > SOGLIA_CHIARO ? (testo ?? "#111111") : BIANCO]);

  return out;
}
