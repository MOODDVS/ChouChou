import type { APIRoute } from "astro";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabaseAdmin } from "../../lib/db";
import { datiRistorante } from "../../lib/ristorante";

export const prerender = false;

// PDF pubblico di un buono regalo, protetto dal pay_token (uuid non indovinabile).
// GET /api/bon-pdf?t=<pay_token>
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function euro(c: number): string {
  return (Math.round(Number(c) || 0) / 100).toFixed(2).replace(".", ",") + " EUR";
}

function fmtData(d: string | null): string {
  return d ? String(d).split("-").reverse().join("/") : "";
}

/** pdf-lib (font standard) non gestisce i caratteri fuori WinAnsi: si ripulisce. */
function pulisci(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x20-\xFF]/g, "");
}

export const GET: APIRoute = async ({ url }) => {
  const t = url.searchParams.get("t") ?? "";
  if (!RE_UUID.test(t)) return new Response("Lien invalide", { status: 404 });

  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .select("code, initial_cents, balance_cents, expires_at, recipient_name, sender_name, message, paid")
    .eq("pay_token", t)
    .maybeSingle();
  if (error || !data) return new Response("Bon introuvable", { status: 404 });
  if (data.paid === false) return new Response("Bon non encore payé", { status: 402 });

  const dati = await datiRistorante();
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const oro = rgb(0.874, 0.671, 0.306);
  const scuro = rgb(0.137, 0.122, 0.126);
  const grigio = rgb(0.45, 0.43, 0.42);
  const W = 595.28;

  const centra = (txt: string, y: number, size: number, font = reg, col = scuro) => {
    const s = pulisci(txt);
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: (W - w) / 2, y, size, font, color: col });
  };

  // Fascia superiore
  page.drawRectangle({ x: 0, y: 731, width: W, height: 111, color: scuro });
  centra(dati.nome, 785, 22, bold, rgb(1, 1, 1));
  centra("BON CADEAU", 757, 11, reg, oro);

  // Riquadro del codice
  page.drawRectangle({
    x: 60, y: 520, width: W - 120, height: 165,
    borderColor: oro, borderWidth: 2, color: rgb(0.99, 0.97, 0.93),
  });
  centra("VOTRE CODE", 645, 10, reg, grigio);
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
  riga("Beneficiaire", String(data.recipient_name ?? ""));
  riga("Offert par", String(data.sender_name ?? ""));
  riga("Valeur", euro(data.initial_cents));
  if (data.balance_cents !== data.initial_cents) riga("Solde restant", euro(data.balance_cents));
  riga("A utiliser avant le", fmtData(data.expires_at as string | null));

  // Messaggio
  if (data.message) {
    y -= 10;
    page.drawText(pulisci(`" ${data.message} "`), { x: 70, y, size: 12, font: reg, color: grigio });
    y -= 30;
  }

  // Nota d'uso + piè di pagina
  centra("Presentez ce code sur place ou saisissez-le lors de votre commande en ligne.", 150, 10, reg, grigio);
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
