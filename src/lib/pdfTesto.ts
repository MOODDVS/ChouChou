/**
 * TESTO E COLORI PER I PDF — le due funzioni che servono a chiunque disegni un PDF.
 *
 * Stanno qui e non dentro una pagina perche' erano gia' due: il buono
 * regalo e il releve' dei buoni ne avrebbero avuto una copia ciascuno, e
 * due copie della stessa regola divergono sempre — di solito sul carattere
 * che nessuno aveva previsto.
 */

/** Importo in centesimi, come lo legge un contabile belga. */
export function euroPdf(c: number): string {
  return (Math.round(Number(c) || 0) / 100).toFixed(2).replace(".", ",") + " EUR";
}

/**
 * ⚠️ pdf-lib con i font standard sa scrivere solo WinAnsi. Un carattere
 * fuori da quel repertorio non da' un quadratino: fa LANCIARE la generazione,
 * e il PDF non esce affatto. Le virgolette curve di un messaggio incollato
 * da Word bastano — per questo si normalizza prima e si taglia dopo.
 */
export function pulisciPdf(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x20-\xFF]/g, "");
}

/* ------------------------------------------------------------------
   I COLORI — quelli dichiarati dal cliente, non quelli di chi e' venuto
   prima.

   ⚠️ Fino al 16/09/2026 i PDF avevano tre costanti scritte a mano, prese
   dal tema di UN cliente: ogni altro riceveva un buono regalo con i
   colori di un altro ristorante. Non dava errore e non si vedeva in
   nessun log — si vedeva solo aprendo il PDF.
   ------------------------------------------------------------------ */

/** Luminanza relativa (WCAG). Serve a sapere se un colore si legge. */
function lum(hex: string): number {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** Un esadecimale come lo vuole pdf-lib. Valore non valido = nero. */
export function hexPdf(hex: string): { r: number; g: number; b: number } {
  const h = /^#?[0-9a-fA-F]{6}$/.test(String(hex ?? "")) ? String(hex).replace("#", "") : "000000";
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/**
 * LO STESSO COLORE, ma leggibile sulla CARTA.
 *
 * ⚠️ La carta e' sempre bianca, lo schermo no. Un tema scuro dichiara un
 * accento chiaro perche' li' sta su fondo nero: stampato tale e quale
 * sparisce. Si scurisce finche' non si legge — il colore resta riconoscibile,
 * cambia solo quanto basta. Un PDF illeggibile non e' un PDF piu' fedele.
 */
export function inchiostroPdf(hex: string, sogliaLum = 0.42): { r: number; g: number; b: number } {
  let c = hexPdf(hex);
  let giri = 0;
  const luminanza = (x: { r: number; g: number; b: number }) => {
    const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(x.r) + 0.7152 * f(x.g) + 0.0722 * f(x.b);
  };
  while (luminanza(c) > sogliaLum && giri < 24) {
    c = { r: c.r * 0.88, g: c.g * 0.88, b: c.b * 0.88 };
    giri++;
  }
  return c;
}

/** Il colore del testo che sta SOPRA un fondo pieno: bianco o quasi-nero. */
export function suFondoPdf(hexFondo: string): { r: number; g: number; b: number } {
  const valido = /^#?[0-9a-fA-F]{6}$/.test(String(hexFondo ?? ""));
  return lum(valido ? String(hexFondo) : "#000000") < 0.4
    ? { r: 1, g: 1, b: 1 }
    : { r: 0.102, g: 0.102, b: 0.102 };
}

/** Lo stesso colore annacquato nel bianco: il fondo tenue di un riquadro.
 *  `forza` 0 = bianco, 1 = il colore pieno. */
export function tintaPdf(hex: string, forza = 0.08): { r: number; g: number; b: number } {
  const c = hexPdf(hex);
  const f = Math.min(1, Math.max(0, forza));
  return { r: 1 - (1 - c.r) * f, g: 1 - (1 - c.g) * f, b: 1 - (1 - c.b) * f };
}
