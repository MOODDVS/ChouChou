import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { ambitoPubblicoChiesto } from "../../lib/admin/sede";
import { opzioniTavolo, tavoliDiSala } from "../../lib/ordiniOpzioni";
import { servizioInCorso } from "../../lib/ordiniRegole";
import { configSala } from "../../lib/schedule";
import { fusoDi } from "../../lib/fuso";
import { normalizzaNome } from "../../lib/normalizzaNome";
import { registraCliente } from "../../lib/registraCliente";
import { linkBaseTavolo } from "../../lib/admin/linkTavolo";
import { linkTavolo } from "../../lib/qrRegole";
import { qrSvg } from "../../lib/qrSvg";
import { hannoOrdinato, inizialeDi, PARAM_CODICE } from "../../lib/contoRegole";
import {
  addizione, aggiungiTavolo, apriConto, contoDelTavolo, rilasciaInviiScaduti, togliOrdine, verificaCodice, type ContoRiga,
} from "../../lib/contoServer";

/**
 * IL CONTO APERTO AL TAVOLO, dal telefono del cliente (conto-aperto.md).
 *
 * POST { azione: "stato", table, reservation_id?, code?, miei? }
 *   → { attivo, conto: null }                      nessun conto su questo tavolo
 *   → { attivo, conto: { membro: false, … } }      c'e' un conto, non e' il mio
 *   → { attivo, conto: { membro: true, … } }       il mio: codice, QR «Inviter»,
 *                                                  «Votre addition»
 * POST { azione: "apri", table, people, name, email?, lang }
 *   → { reservation_id, code, table_id }  | 409 { error: "deja ouvert", iniziale }
 * POST { azione: "unisciti", table, code }
 *   → { reservation_id, code, table_id }  | 403 { error: "code" | "bloque" }
 * POST { azione: "togli", table, code, token }   un PROPRIO ordine, finche'
 *   → { ok }                                     il suo invio non e' partito
 *
 * ⚠️ TUTTO IN POST, anche lo stato: porta il codice e i token dei propri
 * ordini, che in un indirizzo finirebbero nei log e nella cronologia.
 * ⚠️ Il codice e' l'autorizzazione: ogni azione su un conto lo porta, e il
 * server conta i tentativi sbagliati (5 → 10 minuti di blocco).
 * ⚠️ Il server risponde in una lingua sola: i messaggi sono per i log. La
 * pagina traduce i casi che il cliente puo' incontrare.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const POST: APIRoute = async ({ request }) => {
  const ambito = await ambitoPubblicoChiesto(request);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "requete invalide" }, 400);
  }
  const azione = String(body.azione ?? "");

  /* ⚠️ Il conto c'e' solo con la sala accesa, il tavolo scelto e
     l'interruttore acceso (`opzioniTavolo().conto`): spento, la pagina si
     comporta come prima e questa rotta non apre niente. */
  const opz = await opzioniTavolo(ambito);
  if (!opz.conto) return json({ attivo: false, conto: null }, azione === "stato" ? 200 : 403);
  // Gli invii la cui finestra e' scaduta partono adesso (nessun cron: vedi
  // `rilasciaInviiScaduti`). Mai bloccante per chi e' al tavolo.
  void rilasciaInviiScaduti(ambito);

  const chiesto = String(body.table ?? "").trim();
  const tavolo = chiesto ? (await tavoliDiSala(ambito)).find((t) => t.id === chiesto) ?? null : null;
  if (!tavolo) return json({ error: "table inconnue" }, 404);

  const fuso = await fusoDi(ambito);
  const adessoDt = DateTime.now();
  const ora = adessoDt.setZone(fuso);
  const oggi = ora.toFormat("yyyy-MM-dd");
  const adesso = adessoDt.toJSDate();

  if (azione === "stato") {
    const conto = await contoDelTavolo(ambito, tavolo.id, oggi);
    if (!conto) return json({ attivo: true, conto: null });
    const base = {
      stato: conto.tab_status,
      iniziale: inizialeDi(conto.first_name),
      tavolo_id: conto.tab_table_id,
    };
    /* ⚠️ Il codice si controlla solo sul conto a cui il telefono crede di
       appartenere (`reservation_id`): chi ha cambiato tavolo non deve
       consumare, a sua insaputa, i tentativi del conto di un altro tavolo. */
    const perQuesto = String(body.reservation_id ?? "") === conto.id;
    if (body.code === undefined || body.code === null || body.code === "" || !perQuesto) {
      return json({ attivo: true, conto: { ...base, membro: false } });
    }
    const esito = await verificaCodice(ambito, conto, body.code, adesso);
    if (esito !== "ok") {
      return json({ attivo: true, conto: { ...base, membro: false, errore: esito } });
    }
    const miei = Array.isArray(body.miei) ? (body.miei as unknown[]).map(String).slice(0, 50) : [];
    return json({ attivo: true, conto: await vistaMembro(request, ambito, conto, miei, adesso) });
  }

  // Aprire e unirsi solo a servizio aperto, come ordinare.
  if (azione === "apri" || azione === "unisciti") {
    const cfg = await configSala(adessoDt, ambito);
    if (!servizioInCorso(cfg, ora.toFormat("HH:mm"))) return json({ error: "service ferme" }, 409);
  }

  if (azione === "apri") {
    const nome = normalizzaNome(body.name);
    if (nome.length < 2) return json({ error: "nom manquant" }, 400);
    const people = Math.round(Number(body.people));
    if (!Number.isFinite(people) || people < 1 || people > 100) {
      return json({ error: "nombre de personnes invalide" }, 400);
    }
    const email = String(body.email ?? "").trim().toLowerCase();
    if (opz.avvisa && !email) return json({ error: "email requise" }, 400);
    const lang = String(body.lang ?? "fr").slice(0, 5) || "fr";
    const cfg = await configSala(adessoDt, ambito);
    const servizio = servizioInCorso(cfg, ora.toFormat("HH:mm")) ?? "";
    const r = await apriConto(ambito, {
      tavolo, persone: people, nome, email, lang, servizio, oggi,
      heure: ora.toFormat("HH:mm"), adessoIso: ora.toISO() ?? "",
    });
    if ("gia" in r) return json({ error: "deja ouvert", iniziale: inizialeDi(r.gia.first_name) }, 409);
    if ("errore" in r) return json({ error: r.errore }, 500);
    if (email) void registraCliente({ name: nome, email, phone: null, lang });
    return json({ reservation_id: r.conto.id, code: r.conto.tab_code, table_id: tavolo.id });
  }

  if (azione === "unisciti" || azione === "togli") {
    const conto = await contoDelTavolo(ambito, tavolo.id, oggi);
    if (!conto) return json({ error: "pas de compte" }, 404);
    const esito = await verificaCodice(ambito, conto, body.code, adesso);
    if (esito === "bloccato") return json({ error: "bloque" }, 429);
    if (esito !== "ok") return json({ error: "code" }, 403);
    if (azione === "unisciti") {
      await aggiungiTavolo(ambito, conto, tavolo.id);
      return json({ reservation_id: conto.id, code: conto.tab_code, table_id: tavolo.id });
    }
    const r = await togliOrdine(ambito, conto, String(body.token ?? ""), adesso);
    if (r === "tardi") return json({ error: "deja envoye" }, 409);
    if (r !== "ok") return json({ error: "commande inconnue" }, 404);
    return json({ ok: true });
  }

  return json({ error: "action inconnue" }, 400);
};

/** Quello che vede chi e' nel conto: il codice, il QR «Inviter», l'addizione. */
async function vistaMembro(request: Request, ambito: Parameters<typeof addizione>[0], conto: ContoRiga, miei: string[], adesso: Date) {
  const add = await addizione(ambito, conto, miei, adesso);
  /* ⚠️ IL QR «INVITER» LO DISEGNA IL SERVER, come i cartoncini: dal link
     della sede (`linkBaseTavolo`), il tavolo del conto e il codice. Chi lo
     inquadra entra senza scrivere niente. */
  const base = await linkBaseTavolo(request, ambito);
  let invito = "";
  if (base && conto.tab_table_id) {
    try {
      const u = new URL(linkTavolo(base, conto.tab_table_id));
      u.searchParams.set(PARAM_CODICE, String(conto.tab_code ?? ""));
      invito = u.toString();
    } catch { /* nessun invito: resta il codice */ }
  }
  const { ordinato, su } = hannoOrdinato(add.nomi, conto.tab_people ?? conto.people);
  return {
    membro: true,
    stato: conto.tab_status,
    reservation_id: conto.id,
    code: conto.tab_code,
    tavolo_id: conto.tab_table_id,
    invito_url: invito,
    invito_svg: invito ? qrSvg(invito) : "",
    ordinato,
    persone: su,
    invii: add.invii,
    totale_cents: add.totale_cents,
  };
}
