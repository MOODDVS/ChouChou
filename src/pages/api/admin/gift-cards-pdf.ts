import type { APIRoute } from "astro";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, elencoSedi, leggiConfig } from "../../../lib/admin/sede";
import { datiRistorante } from "../../../lib/ristorante";
import { relevePunto, type BuonoDelReleve, type RiscattoDelReleve } from "../../../lib/buoniRegole";
import { euroPdf, pulisciPdf, hexPdf, inchiostroPdf, suFondoPdf } from "../../../lib/pdfTesto";
import { temaEmail } from "../../../lib/temaBrand";

export const prerender = false;

/**
 * RELEVE' CONTABILE DEI BUONI REGALO — PDF.
 * GET /api/admin/gift-cards-pdf?from=AAAA-MM-GG&to=AAAA-MM-GG&lang=fr
 *
 * ⚠️ E' il documento DI UNA SOCIETA'. Con tre societa' e un contabile per
 * ognuna, un PDF che mostrasse anche i conti delle altre due sarebbe un
 * documento che non si puo' consegnare. Quindi: la sede selezionata, e
 * l'aggregato si rifiuta invece di produrre un misto.
 *
 * ⚠️ Le due liste si leggono INTERE e si filtrano dopo, in `relevePunto`.
 * La meta' interessante del documento e' proprio quello che e' successo
 * altrove — i nostri buoni onorati da un'altra societa'. Chiedendo al
 * database solo le righe di questa sede, quella parte sarebbe sempre vuota
 * e sembrerebbe un dato, non un buco.
 */

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type L = "fr" | "en" | "it" | "nl" | "es";
const LANGS: L[] = ["fr", "en", "it", "nl", "es"];
const norm5 = (x: unknown): L => {
  const c = String(x ?? "").trim().toLowerCase();
  return (LANGS as string[]).includes(c) ? (c as L) : "fr";
};

interface Txt {
  titolo: string; periodo: string; sede: string; generato: string;
  riepilogo: string; vendutiDaNoi: string; incassato: string; nonPagati: string;
  usatiDaNoi: string; diCuiNostri: string; diCuiAltrui: string;
  nostriAltrove: string; versoAltre: string; ciDeve: string; leDobbiamo: string;
  daOnorare: string; daOnorareNota: string;
  tabVendite: string; tabUsi: string; tabAltrove: string;
  cData: string; cCodice: string; cMetodo: string; cImporto: string;
  cVendutoDa: string; cDove: string; cTipo: string;
  online: string; sala: string; nonPagato: string; senzaSede: string;
  vuoto: string; totale: string; pagina: string;
}

const T: Record<L, Txt> = {
  fr: { titolo: "RELEVÉ DES BONS CADEAUX", periodo: "Période", sede: "Adresse", generato: "Établi le", riepilogo: "RÉCAPITULATIF", vendutiDaNoi: "Bons vendus", incassato: "dont encaissé", nonPagati: "dont en attente de paiement", usatiDaNoi: "Bons utilisés chez nous", diCuiNostri: "dont bons vendus par nous", diCuiAltrui: "dont bons vendus par une autre adresse", nostriAltrove: "Nos bons utilisés ailleurs", versoAltre: "SOLDE ENTRE ADRESSES", ciDeve: "nous doit", leDobbiamo: "nous lui devons", daOnorare: "Bons vendus par nous et non encore utilisés", daOnorareNota: "Dette envers les clients à la date de fin, pas un produit.", tabVendite: "VENTES", tabUsi: "UTILISATIONS CHEZ NOUS", tabAltrove: "NOS BONS UTILISÉS AILLEURS", cData: "Date", cCodice: "Code", cMetodo: "Paiement", cImporto: "Montant", cVendutoDa: "Vendu par", cDove: "Utilisé à", cTipo: "Type", online: "en ligne", sala: "en salle", nonPagato: "non payé", senzaSede: "sans adresse", vuoto: "Aucun mouvement sur la période.", totale: "Total", pagina: "Page" },
  en: { titolo: "GIFT CARD STATEMENT", periodo: "Period", sede: "Location", generato: "Issued on", riepilogo: "SUMMARY", vendutiDaNoi: "Gift cards sold", incassato: "of which collected", nonPagati: "of which awaiting payment", usatiDaNoi: "Redeemed at this location", diCuiNostri: "of which sold by us", diCuiAltrui: "of which sold by another location", nostriAltrove: "Our gift cards redeemed elsewhere", versoAltre: "BALANCE BETWEEN LOCATIONS", ciDeve: "owes us", leDobbiamo: "we owe", daOnorare: "Sold by us and not yet redeemed", daOnorareNota: "A liability towards customers at the end date, not revenue.", tabVendite: "SALES", tabUsi: "REDEEMED HERE", tabAltrove: "OUR CARDS REDEEMED ELSEWHERE", cData: "Date", cCodice: "Code", cMetodo: "Payment", cImporto: "Amount", cVendutoDa: "Sold by", cDove: "Redeemed at", cTipo: "Type", online: "online", sala: "in room", nonPagato: "unpaid", senzaSede: "no location", vuoto: "No movement in this period.", totale: "Total", pagina: "Page" },
  it: { titolo: "ESTRATTO CONTO DEI BUONI REGALO", periodo: "Periodo", sede: "Sede", generato: "Emesso il", riepilogo: "RIEPILOGO", vendutiDaNoi: "Buoni venduti", incassato: "di cui incassato", nonPagati: "di cui in attesa di pagamento", usatiDaNoi: "Buoni usati da noi", diCuiNostri: "di cui venduti da noi", diCuiAltrui: "di cui venduti da un'altra sede", nostriAltrove: "Nostri buoni usati altrove", versoAltre: "SALDO FRA LE SEDI", ciDeve: "ci deve", leDobbiamo: "le dobbiamo", daOnorare: "Venduti da noi e non ancora usati", daOnorareNota: "Debito verso i clienti alla data di fine, non un ricavo.", tabVendite: "VENDITE", tabUsi: "USATI DA NOI", tabAltrove: "NOSTRI BUONI USATI ALTROVE", cData: "Data", cCodice: "Codice", cMetodo: "Pagamento", cImporto: "Importo", cVendutoDa: "Venduto da", cDove: "Usato a", cTipo: "Tipo", online: "online", sala: "in sala", nonPagato: "non pagato", senzaSede: "senza sede", vuoto: "Nessun movimento nel periodo.", totale: "Totale", pagina: "Pagina" },
  nl: { titolo: "OVERZICHT CADEAUBONNEN", periodo: "Periode", sede: "Vestiging", generato: "Opgemaakt op", riepilogo: "SAMENVATTING", vendutiDaNoi: "Verkochte bonnen", incassato: "waarvan geïnd", nonPagati: "waarvan in afwachting van betaling", usatiDaNoi: "Bij ons gebruikte bonnen", diCuiNostri: "waarvan door ons verkocht", diCuiAltrui: "waarvan door een andere vestiging verkocht", nostriAltrove: "Onze bonnen elders gebruikt", versoAltre: "SALDO TUSSEN VESTIGINGEN", ciDeve: "is ons verschuldigd", leDobbiamo: "wij zijn verschuldigd", daOnorare: "Door ons verkocht en nog niet gebruikt", daOnorareNota: "Schuld aan klanten op de einddatum, geen opbrengst.", tabVendite: "VERKOOP", tabUsi: "HIER GEBRUIKT", tabAltrove: "ONZE BONNEN ELDERS GEBRUIKT", cData: "Datum", cCodice: "Code", cMetodo: "Betaling", cImporto: "Bedrag", cVendutoDa: "Verkocht door", cDove: "Gebruikt bij", cTipo: "Type", online: "online", sala: "in de zaal", nonPagato: "niet betaald", senzaSede: "zonder vestiging", vuoto: "Geen beweging in deze periode.", totale: "Totaal", pagina: "Pagina" },
  es: { titolo: "EXTRACTO DE BONOS REGALO", periodo: "Periodo", sede: "Dirección", generato: "Emitido el", riepilogo: "RESUMEN", vendutiDaNoi: "Bonos vendidos", incassato: "de los cuales cobrado", nonPagati: "de los cuales pendientes de pago", usatiDaNoi: "Bonos usados aquí", diCuiNostri: "de los cuales vendidos por nosotros", diCuiAltrui: "de los cuales vendidos por otra dirección", nostriAltrove: "Nuestros bonos usados en otra dirección", versoAltre: "SALDO ENTRE DIRECCIONES", ciDeve: "nos debe", leDobbiamo: "le debemos", daOnorare: "Vendidos por nosotros y aún no usados", daOnorareNota: "Deuda con los clientes en la fecha final, no un ingreso.", tabVendite: "VENTAS", tabUsi: "USADOS AQUÍ", tabAltrove: "NUESTROS BONOS USADOS EN OTRA PARTE", cData: "Fecha", cCodice: "Código", cMetodo: "Pago", cImporto: "Importe", cVendutoDa: "Vendido por", cDove: "Usado en", cTipo: "Tipo", online: "en línea", sala: "en sala", nonPagato: "sin pagar", senzaSede: "sin dirección", vuoto: "Sin movimientos en el periodo.", totale: "Total", pagina: "Página" },
};

const gg = (iso: string): string => (iso ? iso.split("-").reverse().join("/") : "");

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const url = new URL(request.url);
  const oggi = new Date().toISOString().slice(0, 10);
  const da = RE_DATA.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : oggi.slice(0, 4) + "-01-01";
  const a = RE_DATA.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : oggi;
  if (da > a) return json({ error: "Période invalide." }, 400);
  const lng = norm5(url.searchParams.get("lang"));
  const t = T[lng];

  const ambito = await ambitoDiRichiesta(request, staff);
  if (ambito.modo === "tutte") {
    return json({ error: "Choisis une adresse d'abord.", code: "no_sede" }, 409);
  }
  const punto = ambito.modo === "sede" ? ambito.id : null;

  const [sedi, dati, cfg, tema] = await Promise.all([
    elencoSedi(),
    datiRistorante(ambito),
    leggiConfig(ambito, ["timezone"]),
    temaEmail(),
  ]);
  const nomiSede = new Map(sedi.map((s) => [s.id, s.name]));
  const fuso = cfg.valori.get("timezone") || "Europe/Brussels";
  const nomeDi = (id: string | null): string => (id ? (nomiSede.get(id) ?? t.senzaSede) : t.senzaSede);

  const [carte, riscatti] = await Promise.all([
    supabaseAdmin.from("gift_cards").select("id, code, initial_cents, paid, payment_method, sold_at_location, created_at"),
    supabaseAdmin.from("gift_card_redemptions").select("gift_card_id, amount_cents, kind, location_id, created_at"),
  ]);
  if (carte.error || riscatti.error) return json({ error: "Lecture impossible" }, 500);

  const rel = relevePunto({
    buoni: (carte.data ?? []) as unknown as BuonoDelReleve[],
    riscatti: (riscatti.data ?? []) as unknown as RiscattoDelReleve[],
    punto,
    da,
    a,
    fuso,
  });

  /* ---------------- il documento ---------------- */
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  // I COLORI SONO QUELLI DICHIARATI DAL CLIENTE (Réglages → Thème), non tre
  // costanti scritte a mano. La banda usa il fondo del tema col suo testo
  // leggibile; sulla CARTA, che e' sempre bianca, l'accento si scurisce
  // quanto basta — un tema scuro dichiara un accento chiaro, e stampato
  // tale e quale sparirebbe.
  const c = (x: { r: number; g: number; b: number }) => rgb(x.r, x.g, x.b);
  const banda = c(hexPdf(tema.card));
  const sullaBanda = c(suFondoPdf(tema.card));
  const accento = c(inchiostroPdf(tema.accent));
  const accentoSullaBanda = c(hexPdf(tema.accent));
  const scuro = rgb(0.137, 0.122, 0.126);
  const grigio = rgb(0.45, 0.43, 0.42);
  const linea = rgb(0.88, 0.87, 0.86);
  const W = 595.28;
  const H = 841.89;
  const M = 56; // margine

  let page = doc.addPage([W, H]);
  let y = 0;
  let nPag = 0;

  const testo = (s: string, x: number, size: number, font = reg, col = scuro) =>
    page.drawText(pulisciPdf(s), { x, y, size, font, color: col });
  const destra = (s: string, xFine: number, size: number, font = reg, col = scuro) => {
    const p = pulisciPdf(s);
    page.drawText(p, { x: xFine - font.widthOfTextAtSize(p, size), y, size, font, color: col });
  };

  function nuovaPagina(): void {
    nPag++;
    if (nPag > 1) page = doc.addPage([W, H]);
    y = H - M;
    if (nPag === 1) {
      page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: banda });
      y = H - 46;
      testo(dati.nome, M, 18, bold, sullaBanda);
      y = H - 68;
      testo(t.titolo, M, 10, reg, accentoSullaBanda);
      y = H - 130;
    }
  }

  /** Spazio per `n` righe, o pagina nuova. */
  const spazio = (n: number): void => {
    if (y - n * 16 < M + 30) nuovaPagina();
  };

  nuovaPagina();

  // Intestazione: sede e periodo
  if (punto) {
    testo(`${t.sede}: ${nomiSede.get(punto) ?? ""}`, M, 11, bold);
    y -= 16;
  }
  testo(`${t.periodo}: ${gg(da)} — ${gg(a)}`, M, 11, bold);
  y -= 16;
  testo(`${t.generato} ${gg(oggi)}`, M, 9, reg, grigio);
  y -= 30;

  // --- Riepilogo ---
  const voce = (etichetta: string, valore: string, forte = false, rientro = 0) => {
    spazio(1);
    testo(etichetta, M + rientro, forte ? 11 : 10, forte ? bold : reg, rientro ? grigio : scuro);
    destra(valore, W - M, forte ? 11 : 10, forte ? bold : reg, rientro ? grigio : scuro);
    y -= forte ? 20 : 16;
  };

  testo(t.riepilogo, M, 12, bold);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: accento });
  y -= 20;

  voce(t.vendutiDaNoi, euroPdf(rel.totali.venduto), true);
  voce(t.incassato, euroPdf(rel.totali.incassato), false, 14);
  if (rel.totali.venduto !== rel.totali.incassato) {
    voce(t.nonPagati, euroPdf(rel.totali.venduto - rel.totali.incassato), false, 14);
  }
  y -= 6;
  voce(t.usatiDaNoi, euroPdf(rel.totali.usatoQui), true);
  voce(t.diCuiNostri, euroPdf(rel.totali.usatoQuiNostri), false, 14);
  if (punto) voce(t.diCuiAltrui, euroPdf(rel.totali.usatoQuiAltrui), false, 14);
  if (punto) {
    y -= 6;
    voce(t.nostriAltrove, euroPdf(rel.totali.altrove), true);
  }

  // --- Saldo fra le sedi ---
  if (rel.totali.versoAltre.length) {
    y -= 14;
    spazio(2 + rel.totali.versoAltre.length);
    testo(t.versoAltre, M, 12, bold);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: accento });
    y -= 20;
    for (const v of rel.totali.versoAltre) {
      const verso = v.saldo > 0 ? t.ciDeve : t.leDobbiamo;
      voce(`${nomeDi(v.id)} — ${verso}`, euroPdf(Math.abs(v.saldo)), true);
    }
  }

  // --- Debito verso i clienti ---
  y -= 14;
  spazio(3);
  voce(t.daOnorare, euroPdf(rel.totali.daOnorare), true);
  testo(t.daOnorareNota, M, 8, reg, grigio);
  y -= 26;

  /* ---------------- le tabelle ---------------- */
  const tipoDi = (k: string): string => (k === "online" ? t.online : k === "manual" ? t.sala : k);

  function tabella(titolo: string, colonne: string[], larghe: number[], righe: string[][], totale: number): void {
    y -= 10;
    spazio(4);
    testo(titolo, M, 12, bold);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: accento });
    y -= 16;

    const intestazione = () => {
      let x = M;
      colonne.forEach((c, i) => {
        if (i === colonne.length - 1) { const s = pulisciPdf(c); page.drawText(s, { x: W - M - reg.widthOfTextAtSize(s, 8), y, size: 8, font: reg, color: grigio }); }
        else page.drawText(pulisciPdf(c), { x, y, size: 8, font: reg, color: grigio });
        x += larghe[i];
      });
      y -= 13;
    };
    intestazione();

    if (righe.length === 0) {
      testo(t.vuoto, M, 9, reg, grigio);
      y -= 18;
      return;
    }
    for (const r of righe) {
      if (y < M + 40) { nuovaPagina(); intestazione(); }
      let x = M;
      r.forEach((c, i) => {
        if (i === r.length - 1) destra(c, W - M, 9, reg);
        else page.drawText(pulisciPdf(c), { x, y, size: 9, font: reg, color: scuro });
        x += larghe[i];
      });
      page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.4, color: linea });
      y -= 15;
    }
    y -= 4;
    testo(t.totale, M, 10, bold);
    destra(euroPdf(totale), W - M, 10, bold);
    y -= 20;
  }

  tabella(
    t.tabVendite,
    [t.cData, t.cCodice, t.cMetodo, t.cImporto],
    [80, 180, 140, 80],
    rel.vendite.map((v) => [gg(v.giorno), v.codice, v.metodo + (v.pagato ? "" : ` (${t.nonPagato})`), euroPdf(v.valore)]),
    rel.totali.venduto,
  );

  tabella(
    t.tabUsi,
    [t.cData, t.cCodice, t.cVendutoDa, t.cTipo, t.cImporto],
    [70, 140, 130, 80, 60],
    rel.usi.map((u) => [gg(u.giorno), u.codice, nomeDi(u.vendutoDa), tipoDi(u.kind), euroPdf(u.importo)]),
    rel.totali.usatoQui,
  );

  if (punto) {
    tabella(
      t.tabAltrove,
      [t.cData, t.cCodice, t.cDove, t.cTipo, t.cImporto],
      [70, 140, 130, 80, 60],
      rel.altrove.map((u) => [gg(u.giorno), u.codice, nomeDi(u.usatoA), tipoDi(u.kind), euroPdf(u.importo)]),
      rel.totali.altrove,
    );
  }

  // Numero di pagina su tutte, alla fine: prima non si sa quante sono.
  const pagine = doc.getPages();
  pagine.forEach((p, i) => {
    const s = pulisciPdf(`${t.pagina} ${i + 1}/${pagine.length}`);
    p.drawText(s, { x: W - M - reg.widthOfTextAtSize(s, 8), y: 30, size: 8, font: reg, color: grigio });
    p.drawText(pulisciPdf(dati.nome + (punto ? " — " + (nomiSede.get(punto) ?? "") : "")), { x: M, y: 30, size: 8, font: reg, color: grigio });
  });

  const nome = `bons-${(punto ? (nomiSede.get(punto) ?? "") : dati.nome).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${da}_${a}.pdf`;
  const bytes = await doc.save();
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
};
