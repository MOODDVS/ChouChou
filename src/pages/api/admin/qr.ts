import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggiConfig } from "../../../lib/admin/sede";
import { linkBaseTavolo } from "../../../lib/admin/linkTavolo";
import { tavoliDiSala, opzioniTavolo } from "../../../lib/ordiniOpzioni";
import { modoQr, linkSezione, linkTavolo, sezioniConTavoli } from "../../../lib/qrRegole";
import { qrSvg } from "../../../lib/qrSvg";

/**
 * I CARTONCINI DA STAMPARE — un QR per sezione, per tavolo, o uno solo.
 *
 * GET ?stato=1 → { attivo }   solo «l'ordine dal tavolo e' acceso?», senza
 *                              disegnare niente: Assets lo chiede all'apertura
 *                              per decidere se mostrare la scheda.
 * GET ?modo=unico|sezione|tavolo   (senza: il tipo scelto nei Réglages)
 *   → { modo, attivo, cartoncini: [{ titolo, sotto, link, svg }] }
 *
 * La chiama la scheda «QR codes» di Assets: li' si VEDONO i cartoncini,
 * si copiano i link e si stampano. `attivo` = l'ordine dal tavolo e' acceso
 * (se no la scheda lo dice invece di mostrare QR che portano a un 404).
 *
 * `titolo` e' quello che si legge in grande sul cartoncino (il numero del
 * tavolo, il nome della sezione); `sotto` la riga piccola (la sezione del
 * tavolo). Il QR arriva gia' disegnato (SVG): la pagina dei Réglages lo mette
 * in un foglio e lo manda in stampa, senza librerie nel browser.
 *
 * ⚠️ I link sono gli STESSI di `settings.ts` (`linkBaseTavolo`, `qrRegole`):
 * un cartoncino stampato da qui e uno fatto a mano col link copiato devono
 * aprire la stessa pagina.
 */
export const prerender = false;

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
    leggiConfig(ambito, ["orders_table_qr_mode"]),
  ]);
  const chiesto = url.searchParams.get("modo");
  /* ⚠️ Senza scelta del tavolo (sala senza piano, o scelta spenta) esiste un
     QR solo: un cartoncino «Table 7» porterebbe a una pagina che il tavolo
     non lo chiede. */
  const modo = sala.conTavoli ? modoQr(chiesto ?? cfg.valori.get("orders_table_qr_mode")) : "unico";
  // «Tutte le sedi»: nessun link, quindi nessun cartoncino da stampare.
  if (!base) return json({ modo, attivo: sala.attivo, cartoncini: [] });

  const tavoli = modo === "unico" ? [] : await tavoliDiSala(ambito);

  const cartoncini =
    modo === "tavolo"
      ? tavoli.map((t) => ({ titolo: t.name, sotto: t.zone, link: linkTavolo(base, t.id) }))
      : modo === "sezione"
        ? sezioniConTavoli(tavoli).map((z) => ({ titolo: z, sotto: "", link: linkSezione(base, z) }))
        : [{ titolo: "", sotto: "", link: base }];

  return json({ modo, attivo: sala.attivo, cartoncini: cartoncini.map((c) => ({ ...c, svg: qrSvg(c.link) })) });
};
