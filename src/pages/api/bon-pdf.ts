import type { APIRoute } from "astro";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabaseAdmin } from "../../lib/db";
import { datiRistorante } from "../../lib/ristorante";
import { ambitoDiRiga } from "../../lib/admin/sede";
import { caricaBootAdmin } from "../../lib/admin/adminBoot";
import { euroPdf, pulisciPdf, hexPdf, inchiostroPdf, suFondoPdf, tintaPdf } from "../../lib/pdfTesto";
import { temaEmail } from "../../lib/temaBrand";

export const prerender = false;

// PDF pubblico di un buono regalo, protetto dal pay_token (uuid non indovinabile).
// GET /api/bon-pdf?t=<pay_token>
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `euro` e `pulisci` vivono in `lib/pdfTesto.ts`: le usa anche il releve'
// contabile dei buoni. Due copie della stessa regola divergono sempre.
const euro = euroPdf;
const pulisci = pulisciPdf;

function fmtData(d: string | null): string {
  return d ? String(d).split("-").reverse().join("/") : "";
}


type LangPdf = "fr" | "en" | "it" | "nl" | "es";
const LANGS_PDF: LangPdf[] = ["fr", "en", "it", "nl", "es"];
function norm5Pdf(x: unknown): LangPdf | "" {
  if (typeof x !== "string") return "";
  const c = x.trim().toLowerCase();
  return (LANGS_PDF as string[]).includes(c) ? (c as LangPdf) : "";
}
interface TxtPdf { bonCadeau: string; votreCode: string; beneficiaire: string; offertPar: string; valeur: string; soldeRestant: string; aUtiliser: string; footNote: string; per: string; daParteDi: string; }
const PDF_TXT: Record<LangPdf, TxtPdf> = {
  fr: { bonCadeau: "BON CADEAU", votreCode: "VOTRE CODE", beneficiaire: "Bénéficiaire", offertPar: "Offert par", valeur: "Valeur", soldeRestant: "Solde restant", aUtiliser: "À utiliser avant le", footNote: "Présentez ce code sur place ou saisissez-le lors de votre commande en ligne.", per: "Pour", daParteDi: "de la part de" },
  en: { bonCadeau: "GIFT CARD", votreCode: "YOUR CODE", beneficiaire: "Recipient", offertPar: "From", valeur: "Value", soldeRestant: "Remaining balance", aUtiliser: "Valid until", footNote: "Show this code on site or enter it when ordering online.", per: "For", daParteDi: "from" },
  it: { bonCadeau: "BUONO REGALO", votreCode: "IL TUO CODICE", beneficiaire: "Destinatario", offertPar: "Offerto da", valeur: "Valore", soldeRestant: "Saldo residuo", aUtiliser: "Da usare entro il", footNote: "Presenta questo codice sul posto o inseriscilo al momento dell'ordine online.", per: "Per", daParteDi: "da parte di" },
  nl: { bonCadeau: "CADEAUBON", votreCode: "JE CODE", beneficiaire: "Begunstigde", offertPar: "Aangeboden door", valeur: "Waarde", soldeRestant: "Resterend saldo", aUtiliser: "Te gebruiken vóór", footNote: "Toon deze code ter plaatse of voer hem in bij je online bestelling.", per: "Voor", daParteDi: "van" },
  es: { bonCadeau: "TARJETA REGALO", votreCode: "TU CÓDIGO", beneficiaire: "Beneficiario", offertPar: "Ofrecido por", valeur: "Valor", soldeRestant: "Saldo restante", aUtiliser: "Usar antes del", footNote: "Muestra este código en el local o introdúcelo al hacer tu pedido online.", per: "Para", daParteDi: "de parte de" },
};

export const GET: APIRoute = async ({ url }) => {
  const t = url.searchParams.get("t") ?? "";
  if (!RE_UUID.test(t)) return new Response("Lien invalide", { status: 404 });

  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .select("code, initial_cents, balance_cents, expires_at, recipient_name, sender_name, message, paid, recipient_lang, sold_at_location")
    .eq("pay_token", t)
    .maybeSingle();
  if (error || !data) return new Response("Bon introuvable", { status: 404 });
  if (data.paid === false) return new Response("Bon non encore payé", { status: 402 });

  // ⚠️ LA SEDE LA DICE IL BUONO, non la richiesta e non il ripiego.
  //
  // Questo PDF si apre con un token e basta: nessuno «sceglie un punto»
  // aprendolo. Il punto giusto e' quello che l'ha VENDUTO — e' il suo
  // indirizzo e il suo telefono che il cliente deve trovarsi in mano quando
  // va a spendere il buono. Con `ambitoPubblico()` un buono venduto a
  // Jourdan usciva con la via di Schaerbeek: nessun errore, e il cliente si
  // presentava nel posto sbagliato.
  //
  // Vecchio (senza `sold_at_location`) o installazione a punto unico:
  // `ambitoDiRiga(null)` rende SEDE_UNICA, cioe' il comportamento di sempre.
  const dati = await datiRistorante(ambitoDiRiga((data as { sold_at_location?: string | null }).sold_at_location ?? null));
  const rlPdf = norm5Pdf((data as { recipient_lang?: unknown }).recipient_lang);
  let lng: LangPdf;
  if (rlPdf) lng = rlPdf;
  else { try { lng = norm5Pdf((await caricaBootAdmin()).publicLangDefault) || "fr"; } catch { lng = "fr"; } }
  const T = PDF_TXT[lng];
  const doc = await PDFDocument.create();

  /* ------------------------------------------------------------------
     IL TAGLIANDO — 21 x 10 cm (deciso 16/09/2026)

     Era un A4 con il contenuto sparso su tutta l'altezza. Un buono regalo
     non e' un documento: e' una cosa che si tiene in mano, si infila in una
     busta e si mostra al cameriere. In dieci centimetri non ci stanno
     valore, codice, nomi, scadenza, contatti E il messaggio dell'offrente —
     il messaggio e' uscito. Se un giorno lo si rivuole, il suo posto e' il
     retro, cioe' una seconda pagina.

     ⚠️ La PAGINA e' 21x10, non un A4 col taglio. 21 cm e' largo quanto un
     A4: una stampante di casa non arriva ai bordi, quindi su A4 il
     tagliando avrebbe dovuto scendere a ~19 cm o farsi tagliare i lati.
     Cosi' invece chi stampa mette «adatta alla pagina» e viene giusto.

     Le misure sono quelle del mockup (794 x 378 px a 96 dpi) x 0,75, che e'
     il rapporto esatto fra pixel a 96 dpi e punti PDF.
     ------------------------------------------------------------------ */
  const W = 595.28; // 21 cm
  const H = 283.46; // 10 cm
  const page = doc.addPage([W, H]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  // ⚠️ I COLORI SONO QUELLI DEL CLIENTE (Réglages → Thème). Fino al
  // 16/09/2026 erano tre costanti scritte a mano — il tema di UN cliente —
  // e ogni ristorante mandava ai suoi clienti un buono regalo con i colori
  // di un altro. Non dava errore: si vedeva solo aprendo il PDF.
  const tema = await temaEmail();
  const c = (x: { r: number; g: number; b: number }) => rgb(x.r, x.g, x.b);
  const accento = c(hexPdf(tema.accent));          // la fascia del codice
  const suAccento = c(suFondoPdf(tema.accent));    // il testo che ci sta sopra
  const accentoSuCarta = c(inchiostroPdf(tema.accent)); // leggibile sul chiaro
  const carta = c(tintaPdf(tema.accent, 0.05));    // un bianco appena toccato
  const inchiostro = rgb(0.086, 0.137, 0.169);
  const grigio = rgb(0.49, 0.54, 0.57);

  const PANNELLO = 196.5; // la fascia del codice, a destra
  const M = 31.5;         // margine interno
  const LARG = W - PANNELLO - M * 2; // spazio utile a sinistra

  /**
   * TESTO SPAZIATO. pdf-lib non conosce la spaziatura fra le lettere, e
   * qui serve: e' quello che rende un codice leggibile carattere per
   * carattere a chi lo deve ricopiare. Si disegna una lettera per volta.
   */
  const largSpaziata = (t: string, size: number, font: typeof reg, sp: number): number =>
    font.widthOfTextAtSize(t, size) + Math.max(0, t.length - 1) * sp;

  const spaziato = (t: string, x: number, y: number, size: number, font: typeof reg, col: ReturnType<typeof rgb>, sp: number) => {
    let cx = x;
    for (const ch of t) {
      page.drawText(ch, { x: cx, y, size, font, color: col });
      cx += font.widthOfTextAtSize(ch, size) + sp;
    }
  };

  /** Le parole che ci stanno in `max`, spezzate in righe. */
  const righeDa = (t: string, size: number, font: typeof reg, max: number): string[] => {
    const parole = t.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let riga = "";
    for (const p of parole) {
      const prova = riga ? riga + " " + p : p;
      if (riga && font.widthOfTextAtSize(prova, size) > max) { out.push(riga); riga = p; }
      else riga = prova;
    }
    if (riga) out.push(riga);
    return out;
  };

  /** Il corpo piu' grande che ci sta in `max`, mai sotto `min`. Serve al
   *  codice e ai nomi: un buono con un codice lungo non deve uscire dalla
   *  fascia — deve rimpicciolirsi. */
  const corpoCheCiSta = (t: string, ideale: number, min: number, font: typeof reg, max: number, sp = 0): number => {
    let s = ideale;
    while (s > min && largSpaziata(t, s, font, sp * (s / ideale)) > max) s -= 0.5;
    return s;
  };

  /* ---------------- carta e fascia ---------------- */
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: carta });
  page.drawRectangle({ x: W - PANNELLO, y: 0, width: PANNELLO, height: H, color: accento });
  page.drawLine({
    start: { x: W - PANNELLO - 1.5, y: 0 },
    end: { x: W - PANNELLO - 1.5, y: H },
    thickness: 1.5,
    color: c(hexPdf(tema.accent)),
    opacity: 0.35,
    dashArray: [6, 6],
  });

  /* ---------------- sinistra: marchio, valore, chi e quando ---------------- */
  let y = H - 28.5 - 11.8;
  spaziato(pulisci(dati.nome).toUpperCase(), M, y, 15.75, bold, inchiostro, 1.9);
  y -= 17;
  spaziato(pulisci(T.bonCadeau), M, y, 8.25, reg, accentoSuCarta, 1.9);

  // Il numero grande e' il SALDO, non il valore iniziale: e' quello che il
  // cliente puo' ancora spendere. Se e' stato usato in parte, il valore
  // pieno resta scritto sotto, piccolo.
  const saldo = Number(data.balance_cents ?? 0);
  const iniziale = Number(data.initial_cents ?? 0);
  const cifra = pulisci(euro(saldo).replace(" EUR", ""));
  const corpoCifra = corpoCheCiSta(cifra, 61.5, 34, bold, LARG - 34);
  y = 108;
  page.drawText(cifra, { x: M, y, size: corpoCifra, font: bold, color: inchiostro });
  page.drawText("EUR", {
    x: M + bold.widthOfTextAtSize(cifra, corpoCifra) + 7,
    y,
    size: corpoCifra * 0.3,
    font: bold,
    color: accentoSuCarta,
  });
  if (saldo !== iniziale) {
    page.drawText(pulisci(`${T.valeur} ${euro(iniziale)}`), { x: M, y: y - 14, size: 8.25, font: reg, color: grigio });
  }

  // Chi l'ha ricevuto e da chi. Una riga sola: in dieci centimetri due
  // righe di etichette mangerebbero il posto della scadenza.
  const dest = pulisci(String(data.recipient_name ?? "")).trim();
  const offr = pulisci(String(data.sender_name ?? "")).trim();
  const persone = [
    dest ? `${T.per} ${dest}` : "",
    offr ? `${T.daParteDi} ${offr}` : "",
  ].filter(Boolean).join(" - ");
  y = 58;
  if (persone) {
    page.drawText(persone, { x: M, y, size: corpoCheCiSta(persone, 11.25, 8, reg, LARG), font: reg, color: inchiostro });
    y -= 15;
  }
  if (data.expires_at) {
    const scad = pulisci(`${T.aUtiliser} ${fmtData(data.expires_at as string | null)}`);
    page.drawText(scad, { x: M, y, size: corpoCheCiSta(scad, 9.75, 7, reg, LARG), font: reg, color: grigio });
    y -= 15;
  }
  // ⚠️ DOVE SI VA A SPENDERLO. Chi riceve un buono spesso non conosce il
  // posto: senza indirizzo, «presentalo sul posto» non vuol dire niente.
  // Ed e' l'indirizzo della sede che l'ha VENDUTO — vedi sopra.
  // Senza il nome: e' gia' scritto grande in cima, e ripeterlo qui mangia
  // lo spazio dell'indirizzo, che e' l'unica cosa che manca a chi legge.
  const dove = [dati.indirizzo, dati.tel].filter(Boolean).join(" - ");
  if (dove) {
    const d = pulisci(dove);
    page.drawText(d, { x: M, y, size: corpoCheCiSta(d, 9, 6.5, reg, LARG), font: reg, color: grigio });
  }

  /* ---------------- destra: il codice ---------------- */
  const cx = W - PANNELLO / 2;      // centro della fascia
  const dentro = PANNELLO - 39;     // larghezza utile

  // ⚠️ IL BLOCCO SI CENTRA, non si appende in alto. La nota d'uso e' lunga
  // in modo diverso in ogni lingua — due righe in inglese, tre in francese —
  // quindi un punto di partenza fisso lascia un vuoto che cambia da lingua a
  // lingua. Si misura l'altezza e si mette in mezzo.
  const nota = righeDa(pulisci(T.footNote), 9, reg, dentro).slice(0, 5);
  const altezza = 28 + 18 + 24 + Math.max(0, nota.length - 1) * 12;
  let yp = H / 2 + altezza / 2 - 2;

  const etich = pulisci(T.votreCode).toUpperCase();
  spaziato(etich, cx - largSpaziata(etich, 8.25, reg, 2) / 2, yp, 8.25, reg, suAccento, 2);
  yp -= 28;

  const codice = pulisci(String(data.code ?? ""));
  const corpoCodice = corpoCheCiSta(codice, 18.75, 9, bold, dentro, 1.6);
  const spCodice = 1.6 * (corpoCodice / 18.75);
  spaziato(codice, cx - largSpaziata(codice, corpoCodice, bold, spCodice) / 2, yp, corpoCodice, bold, suAccento, spCodice);
  yp -= 18;

  page.drawRectangle({ x: cx - 16.5, y: yp, width: 33, height: 1.5, color: suAccento, opacity: 0.55 });
  yp -= 24;

  for (const r of nota) {
    page.drawText(r, { x: cx - reg.widthOfTextAtSize(r, 9) / 2, y: yp, size: 9, font: reg, color: suAccento, opacity: 0.93 });
    yp -= 12;
  }

  const bytes = await doc.save();
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="bon-cadeau-${data.code}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
};
