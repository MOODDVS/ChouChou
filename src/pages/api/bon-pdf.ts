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
interface TxtPdf { bonCadeau: string; votreCode: string; beneficiaire: string; offertPar: string; valeur: string; soldeRestant: string; aUtiliser: string; footNote: string; }
const PDF_TXT: Record<LangPdf, TxtPdf> = {
  fr: { bonCadeau: "BON CADEAU", votreCode: "VOTRE CODE", beneficiaire: "Bénéficiaire", offertPar: "Offert par", valeur: "Valeur", soldeRestant: "Solde restant", aUtiliser: "À utiliser avant le", footNote: "Présentez ce code sur place ou saisissez-le lors de votre commande en ligne." },
  en: { bonCadeau: "GIFT CARD", votreCode: "YOUR CODE", beneficiaire: "Recipient", offertPar: "From", valeur: "Value", soldeRestant: "Remaining balance", aUtiliser: "Valid until", footNote: "Show this code on site or enter it when ordering online." },
  it: { bonCadeau: "BUONO REGALO", votreCode: "IL TUO CODICE", beneficiaire: "Destinatario", offertPar: "Offerto da", valeur: "Valore", soldeRestant: "Saldo residuo", aUtiliser: "Da usare entro il", footNote: "Presenta questo codice sul posto o inseriscilo al momento dell'ordine online." },
  nl: { bonCadeau: "CADEAUBON", votreCode: "JE CODE", beneficiaire: "Begunstigde", offertPar: "Aangeboden door", valeur: "Waarde", soldeRestant: "Resterend saldo", aUtiliser: "Te gebruiken vóór", footNote: "Toon deze code ter plaatse of voer hem in bij je online bestelling." },
  es: { bonCadeau: "TARJETA REGALO", votreCode: "TU CÓDIGO", beneficiaire: "Beneficiario", offertPar: "Ofrecido por", valeur: "Valor", soldeRestant: "Saldo restante", aUtiliser: "Usar antes del", footNote: "Muestra este código en el local o introdúcelo al hacer tu pedido online." },
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
  const page = doc.addPage([595.28, 841.89]); // A4
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  // ⚠️ I COLORI SONO QUELLI DEL CLIENTE (Réglages → Thème). Fino al
  // 16/09/2026 erano tre costanti scritte a mano — il tema di UN cliente —
  // e ogni ristorante mandava ai suoi clienti un buono regalo con i colori
  // di un altro. Non dava errore: si vedeva solo aprendo il PDF.
  const tema = await temaEmail();
  const c = (x: { r: number; g: number; b: number }) => rgb(x.r, x.g, x.b);
  const banda = c(hexPdf(tema.card));
  const sullaBanda = c(suFondoPdf(tema.card));
  const oro = c(inchiostroPdf(tema.accent)); // sulla carta bianca
  const oroSullaBanda = c(hexPdf(tema.accent));
  const scuro = rgb(0.137, 0.122, 0.126);
  const grigio = rgb(0.45, 0.43, 0.42);
  const W = 595.28;

  const centra = (txt: string, y: number, size: number, font = reg, col = scuro) => {
    const s = pulisci(txt);
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: (W - w) / 2, y, size, font, color: col });
  };

  // Fascia superiore
  page.drawRectangle({ x: 0, y: 731, width: W, height: 111, color: banda });
  centra(dati.nome, 785, 22, bold, sullaBanda);
  centra(T.bonCadeau, 757, 11, reg, oroSullaBanda);

  // Riquadro del codice
  page.drawRectangle({
    x: 60, y: 520, width: W - 120, height: 165,
    borderColor: oro, borderWidth: 2, color: c(tintaPdf(tema.accent)),
  });
  centra(T.votreCode, 645, 10, reg, grigio);
  centra(data.code, 605, 26, bold, scuro);
  centra(euro(data.initial_cents), 560, 30, bold, oro);

  // Dettagli
  let y = 470;
  const riga = (k: string, v: string) => {
    if (!v) return;
    page.drawText(pulisci(k), { x: 70, y, size: 11, font: reg, color: grigio });
    const s = pulisci(v);
    page.drawText(s, { x: W - 70 - bold.widthOfTextAtSize(s, 11), y, size: 11, font: bold, color: scuro });
    page.drawLine({ start: { x: 70, y: y - 8 }, end: { x: W - 70, y: y - 8 }, thickness: 0.5, color: rgb(0.88, 0.87, 0.86) });
    y -= 28;
  };
  riga(T.beneficiaire, String(data.recipient_name ?? ""));
  riga(T.offertPar, String(data.sender_name ?? ""));
  riga(T.valeur, euro(data.initial_cents));
  if (data.balance_cents !== data.initial_cents) riga(T.soldeRestant, euro(data.balance_cents));
  riga(T.aUtiliser, fmtData(data.expires_at as string | null));

  // Messaggio
  if (data.message) {
    y -= 10;
    page.drawText(pulisci(`" ${data.message} "`), { x: 70, y, size: 12, font: reg, color: grigio });
    y -= 30;
  }

  // Nota d'uso + piè di pagina
  centra(T.footNote, 150, 10, reg, grigio);
  centra(dati.nome + (dati.indirizzo ? " - " + dati.indirizzo : ""), 110, 10, reg, grigio);
  if (dati.tel) centra(dati.tel, 94, 10, reg, grigio);

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
