import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggiConfig, scriviConfig } from "../../../lib/admin/sede";
import { linkBaseTavolo } from "../../../lib/admin/linkTavolo";
import { tavoliDiSala, opzioniTavolo } from "../../../lib/ordiniOpzioni";
import { sceltaQr, sceltaQrDaSalvare, cartonciniScelti } from "../../../lib/qrRegole";
import { qrSvg } from "../../../lib/qrSvg";
import { invalidaAppConfig } from "../../../lib/appConfigCache";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";

/**
 * I CARTONCINI DA STAMPARE — il QR unico, e le sezioni e i tavoli scelti.
 *
 * GET ?stato=1 → { attivo }   solo «l'ordine dal tavolo e' acceso?», senza
 *                              disegnare niente: Assets lo chiede all'apertura
 *                              per decidere se mostrare la scheda.
 * GET          → { attivo, cartoncini: [{ genere, titolo, sotto, link, svg }] }
 *                 il QR unico SEMPRE, poi le sezioni e i tavoli della scelta
 *                 salvata (`orders_table_qr_sel`), nell'ordine della sala.
 * PUT { sezioni: string[], tavoli: string[] } → { ok }
 *                 la scelta, salvata da «Générer» nei Réglages prima di aprire
 *                 Assets. Sezioni per NOME, tavoli per ID.
 *
 * ⚠️ LA SCELTA NON SPEGNE NIENTE: dice solo quali cartoncini si vedono e si
 * stampano. Un QR tolto dalla scelta continua ad aprire la sua pagina.
 *
 * `titolo` e' quello che si legge in grande sul cartoncino (il numero del
 * tavolo, il nome della sezione); `sotto` la riga piccola (la sezione del
 * tavolo). Il QR arriva gia' disegnato (SVG): Assets lo mette in un foglio e
 * lo manda in stampa, senza librerie nel browser.
 *
 * ⚠️ I link sono gli STESSI di `settings.ts` (`linkBaseTavolo`, `qrRegole`):
 * un cartoncino stampato da qui e uno fatto a mano col link copiato devono
 * aprire la stessa pagina.
 */
export const prerender = false;

async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const GET: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  if (url.searchParams.get("stato")) {
    return json({ attivo: (await opzioniTavolo(ambito)).attivo });
  }
  const [base, sala, cfg] = await Promise.all([
    linkBaseTavolo(request, ambito),
    opzioniTavolo(ambito),
    leggiConfig(ambito, ["orders_table_qr_sel"]),
  ]);
  // «Tutte le sedi»: nessun link, quindi nessun cartoncino da stampare.
  if (!base) return json({ attivo: sala.attivo, cartoncini: [] });

  const tavoli = sala.conTavoli ? await tavoliDiSala(ambito) : [];
  const scelta = sceltaQr(cfg.valori.get("orders_table_qr_sel"));
  const cartoncini = cartonciniScelti(base, tavoli, scelta, sala.conTavoli);
  return json({ attivo: sala.attivo, cartoncini: cartoncini.map((c) => ({ ...c, svg: qrSvg(c.link) })) });
};

export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.generalSave") }, 400);
  }
  const err = await scriviConfig(ambito, { orders_table_qr_sel: sceltaQrDaSalvare(body) });
  if (err) return json({ error: await msg("err.generalSave") }, 500);
  invalidaAppConfig();
  return json({ ok: true });
};
