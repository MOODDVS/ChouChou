import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { ambitoPubblicoChiesto, ambitoDiRiga, leggi, aggiorna } from "../../lib/admin/sede";
import { opzioniTavolo, tavoliDiSala, modiDiPagamento, manceDi } from "../../lib/ordiniOpzioni";
import { servizioInCorso } from "../../lib/ordiniRegole";
import { configSala } from "../../lib/schedule";
import { fusoDi } from "../../lib/fuso";
import { normalizzaNome } from "../../lib/normalizzaNome";
import { registraCliente } from "../../lib/registraCliente";
import { linkBaseTavolo } from "../../lib/admin/linkTavolo";
import { linkTavolo } from "../../lib/qrRegole";
import { qrSvg } from "../../lib/qrSvg";
import { hannoOrdinato, inizialeDi, sceltaPagamento, PARAM_CODICE, PARAM_PAGATO, PARAM_LASCIATO } from "../../lib/contoRegole";
import {
  addizione, aggiungiTavolo, apriConto, contoDelTavolo, lasciaPagamento, pagamentoPerToken, prenotaPagamento,
  rilasciaInviiScaduti, segnaPagato, statoPagamenti, togliOrdine, verificaCodice, type ContoRiga,
} from "../../lib/contoServer";
import { creaCheckoutConto, stripeDi, type VoceCheckout } from "../../lib/stripe";
import { importoMancia } from "../../lib/manceRegole";
import { sedeDettaDa, PARAM_SEDE } from "../../lib/admin/sedeRegole";
import { prefissoLingua } from "../../lib/linguaUrl";
import { defaultLang } from "../../i18n/ui";

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
 * POST { azione: "paga", table, code, scelta, tip?, miei, lang }   (fase 4)
 *   → { url }   la sessione Stripe per «ce que j'ai commandé» (`mine`), «une
 *               part égale» (`share`) o «tout le reste» (`rest`)
 *   | 409 { error: "en cours" }   la parte e' gia' in pagamento da un altro
 *   | 409 { error: "rien" }       non resta niente da pagare con quella scelta
 * POST { azione: "pagato", pagamento, session_id }   il ritorno da Stripe
 *   → { pagato, chiuso }
 * POST { azione: "annulla", pagamento }   indietro da Stripe: l'importo torna
 *   → { ok }                              libero per gli altri
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

  /* ⚠️ IL RITORNO DA STRIPE NON PASSA DAL CONTO: il webhook puo' averlo gia'
     chiuso (saldato), e il telefono deve poter leggere «payé» lo stesso.
     L'autorizzazione e' il `token` del pagamento, che conosce solo il
     telefono che ha pagato, piu' la SUA sessione. */
  if (azione === "pagato" || azione === "annulla") {
    const p = await pagamentoPerToken(ambito, String(body.pagamento ?? ""));
    if (!p) return json({ error: "paiement inconnu" }, 404);
    const suo = ambitoDiRiga(p.location_id);
    if (azione === "annulla") {
      if (p.status === "pending") {
        await lasciaPagamento(suo, p);
        // La sessione non si deve piu' poter pagare: l'importo e' tornato libero.
        if (p.stripe_session_id) {
          try { await (await stripeDi(suo)).checkout.sessions.expire(p.stripe_session_id); } catch { /* gia' scaduta o pagata */ }
        }
      }
      return json({ ok: true });
    }
    let pagato = p.status === "paid";
    const sid = String(body.session_id ?? "").trim();
    if (!pagato && sid.startsWith("cs_") && sid === p.stripe_session_id) {
      try {
        const sess = await (await stripeDi(suo)).checkout.sessions.retrieve(sid);
        if (sess.payment_status === "paid") {
          await segnaPagato(suo, p.id, { sessionId: sid, email: sess.customer_details?.email ?? null });
          pagato = true;
        }
      } catch (e) {
        // Non e' grave: ci pensa il webhook, e la pagina ricontrolla.
        console.error("[conto] verifica Stripe al ritorno:", e);
      }
    }
    const { data: cr } = await leggi("reservations", suo, "tab_status").eq("id", p.reservation_id).maybeSingle();
    return json({ pagato, chiuso: (cr as { tab_status?: string } | null)?.tab_status === "closed" });
  }

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

  if (azione === "paga") {
    const conto = await contoDelTavolo(ambito, tavolo.id, oggi);
    if (!conto) return json({ error: "pas de compte" }, 404);
    const esito = await verificaCodice(ambito, conto, body.code, adesso);
    if (esito === "bloccato") return json({ error: "bloque" }, 429);
    if (esito !== "ok") return json({ error: "code" }, 403);
    // ⚠️ Un conto ancora da validare non si paga: la cucina non ha cominciato,
    // e il cameriere potrebbe ancora rifiutarlo.
    if (conto.tab_status !== "open") return json({ error: "a valider" }, 409);
    if (!(await modiDiPagamento(ambito)).online) return json({ error: "paiement en ligne indisponible" }, 403);
    const scelta = sceltaPagamento(body.scelta);
    if (!scelta) return json({ error: "choix invalide" }, 400);
    const miei = Array.isArray(body.miei) ? (body.miei as unknown[]).map(String).slice(0, 50) : [];
    const lang = String(body.lang ?? "fr").slice(0, 5) || "fr";
    const nome = await nomeDaiMiei(ambito, conto.id, miei);
    const r = await prenotaPagamento(ambito, conto, { scelta, miei, nome, adesso });
    if ("errore" in r) {
      if (r.errore === "in_corso") return json({ error: "en cours" }, 409);
      if (r.errore === "niente") return json({ error: "rien" }, 409);
      return json({ error: "paiement indisponible" }, 503);
    }
    /* LA MANCIA: dal telefono arriva solo QUALE bottone, la cifra si calcola
       qui, sulla parte pagata, con i valori della sala. Spente nel frattempo
       → nessuna, senza errore. */
    let mancia = 0;
    if (body.tip !== undefined && body.tip !== null) {
      const m = await manceDi(ambito, { sala: true });
      if (m) mancia = importoMancia(body.tip, m.tipo, m.valori, r.importo);
    }
    const TXT_VOCE: Record<string, (t: string) => string> = {
      fr: (t) => `Addition — table ${t}`, en: (t) => `Bill — table ${t}`, it: (t) => `Conto — tavolo ${t}`,
      nl: (t) => `Rekening — tafel ${t}`, es: (t) => `Cuenta — mesa ${t}`,
    };
    const TXT_MANCIA: Record<string, string> = { fr: "Pourboire", en: "Tip", it: "Mancia", nl: "Fooi", es: "Propina" };
    const voci: VoceCheckout[] = [{ name: (TXT_VOCE[lang] ?? TXT_VOCE.fr)(tavolo.name), price_cents: r.importo, qty: 1 }];
    if (mancia > 0) voci.push({ name: TXT_MANCIA[lang] ?? TXT_MANCIA.fr, price_cents: mancia, qty: 1 });

    /* Si torna sulla pagina del tavolo, nella lingua e con la sede da cui si
       era arrivati (come il checkout). ⚠️ `{CHECKOUT_SESSION_ID}` scritto
       COSI': e' Stripe a sostituirlo, e `searchParams` lo rovinerebbe. */
    const siteUrl = process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321";
    const pagina = (k: string, v: string) => {
      const u = new URL(`${siteUrl.replace(/\/$/, "")}${prefissoLingua(lang, defaultLang)}/table`);
      const sedeChiesta = sedeDettaDa(request);
      if (sedeChiesta) u.searchParams.set(PARAM_SEDE, sedeChiesta);
      u.searchParams.set(k, v);
      return u.toString();
    };
    try {
      const sess = await creaCheckoutConto({
        ambito,
        pagamentoId: r.id,
        voci,
        successUrl: `${pagina(PARAM_PAGATO, r.token)}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: pagina(PARAM_LASCIATO, r.token),
        expiresAt: r.scade,
      });
      const upd = await aggiornaPagamento(ambito, r.id, { stripe_session_id: sess.id, tip_cents: mancia });
      if (!upd) throw new Error("sessione non salvata");
      return json({ url: sess.url, pagamento: r.token });
    } catch (e) {
      console.error("[conto] Stripe:", e);
      await aggiornaPagamento(ambito, r.id, { status: "cancelled" });
      return json({ error: "paiement indisponible" }, 502);
    }
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

/** Il nome di chi paga: quello dei suoi ordini (lo ha scritto ordinando). */
async function nomeDaiMiei(ambito: Parameters<typeof addizione>[0], contoId: string, miei: string[]): Promise<string> {
  if (miei.length === 0) return "";
  const { data } = await leggi("orders", ambito, "customer_name, cancel_token")
    .eq("reservation_id", contoId)
    .in("cancel_token", miei)
    .limit(1);
  return String(((data ?? []) as unknown as { customer_name?: string }[])[0]?.customer_name ?? "").trim();
}

async function aggiornaPagamento(ambito: Parameters<typeof addizione>[0], id: string, campi: Record<string, unknown>): Promise<boolean> {
  const r = await aggiorna("table_payments", ambito, campi).eq("id", id);
  return !r.error;
}

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
  /* ⚠️ «PAYER L'ADDITION» solo con la #88, il pagamento online acceso e
     Stripe pronto (`modiDiPagamento`), e a conto validato. Le cifre delle tre
     scelte le calcola il server: la pagina le mostra e basta. */
  const st = await statoPagamenti(ambito, conto, miei, adesso);
  const online = st !== null && conto.tab_status === "open" && (await modiDiPagamento(ambito)).online;
  const mance = online ? await manceDi(ambito, { sala: true }) : null;
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
    pagamento: st
      ? {
          online,
          pagato_cents: st.quadro.pagato,
          in_corso_cents: st.quadro.inCorso,
          resto_cents: st.quadro.resto,
          scelte: online ? st.scelte : { mine: 0, share: 0, rest: 0 },
          mance,
        }
      : null,
  };
}
