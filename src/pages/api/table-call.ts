import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { ambitoPubblicoChiesto, leggi, inserisci } from "../../lib/admin/sede";
import { opzioniTavolo, tavoliDiSala, attesaChiamataDi } from "../../lib/ordiniOpzioni";
import { servizioInCorso } from "../../lib/ordiniRegole";
import { configSala } from "../../lib/schedule";
import { fusoDi } from "../../lib/fuso";
import { decidiChiamata, chiaveChiamata, FINESTRA_CHIAMATE_MIN, type ChiamataAperta } from "../../lib/chiamateRegole";
import { normalizzaNome } from "../../lib/normalizzaNome";
import { inviaPushChiamata } from "../../lib/push";

/**
 * «APPELER LE SERVEUR» — il tavolo chiama.
 *
 * POST { table } oppure { name } → { ok: true, gia: boolean, riprova_tra: secondi }
 *
 * ⚠️ `riprova_tra`: fra quanto si potra' richiamare (l'attesa dei Réglages).
 * La pagina ci fa partire il suo conto alla rovescia: lo decide il server,
 * cosi' un telefono ricaricato o un secondo telefono allo stesso tavolo
 * ritrovano lo stesso tempo invece di ripartire da capo.
 *
 * ⚠️ TAVOLO O NOME, DECIDONO I DATI come per l'ordine (`table-session.ts`):
 * dove il piano sala ha dei tavoli si sceglie il proprio, dove non ne ha si
 * dice come ci si chiama, e sul tablet si legge «Marc appelle le serveur».
 * Si accende con l'interruttore dei Réglages (`orders_table_call`).
 *
 * Il cliente tocca la campanella, sceglie il suo tavolo, e qui nasce una riga
 * in `table_calls`: i tablet del locale la vedono al giro dopo (AdminNav) e
 * suonano, e i telefoni con le notifiche ricevono un push.
 *
 * ⚠️ IL TAVOLO SI CREDE SOLO SE E' NELLA SALA. L'id arriva dal browser, cioe'
 * da chiunque: si cerca fra i tavoli VERI del piano (`tavoliDiSala`, che
 * scarta anche quelli rimasti senza sezione), e il nome che finisce sul
 * tablet e' quello del database, mai una stringa del cliente — se no sul
 * tablet comparirebbe quello che uno sconosciuto ha deciso di scriverci.
 *
 * ⚠️ A SERVIZIO CHIUSO NON SI CHIAMA. Il QR resta sul tavolo anche di
 * mattina: nessuno guarda il tablet, e un cliente che chiama e non vede
 * arrivare nessuno e' peggio di un bottone che gli dice che e' chiuso.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const POST: APIRoute = async ({ request }) => {
  const ambito = await ambitoPubblicoChiesto(request);

  let body: { table?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "requete invalide" }, 400);
  }

  const opz = await opzioniTavolo(ambito);
  if (!opz.attivo || !opz.chiamata) return json({ error: "appel non active" }, 403);

  const chiesto = String(body.table ?? "").trim();
  const nome = normalizzaNome(body.name).slice(0, 40);
  if (opz.conTavoli && !chiesto) return json({ error: "table manquante" }, 400);
  if (!opz.conTavoli && nome.length < 2) return json({ error: "nom manquant" }, 400);

  const fuso = await fusoDi(ambito);
  const adesso = DateTime.now();
  const cfg = await configSala(adesso, ambito);
  if (!servizioInCorso(cfg, adesso.setZone(fuso).toFormat("HH:mm"))) {
    return json({ error: "service ferme" }, 409);
  }

  /* ⚠️ Col piano, il NOME non conta: si crede solo al tavolo, e il nome
     non finisce sul tablet. Senza piano, il tavolo non conta: non c'e' una
     sala dove cercarlo. Mai tutti e due — sul tablet si leggerebbe una
     frase che nessuno ha scelto. */
  let tavolo: { id: string; name: string } | null = null;
  if (opz.conTavoli) {
    tavolo = (await tavoliDiSala(ambito)).find((t) => t.id === chiesto) ?? null;
    if (!tavolo) return json({ error: "table inconnue" }, 404);
  }

  const da = adesso.minus({ minutes: FINESTRA_CHIAMATE_MIN }).toUTC().toISO() as string;
  /* Tutte, non solo le aperte: anche una chiamata gia' sbrigata fa contare
     l'attesa (vedi `decidiChiamata`). */
  const [{ data: righe, error: errLettura }, attesaMin] = await Promise.all([
    leggi("table_calls", ambito, "id, table_id, table_label, caller_name, status, created_at")
      .gte("created_at", da),
    attesaChiamataDi(ambito),
  ]);
  if (errLettura) {
    // ⚠️ Quasi sempre: la #83 non e' stata lanciata. Lo si scrive nei log
    // con il suo numero, perche' dal telefono del cliente si legge solo
    // «impossibile» e nessuno saprebbe da dove cominciare.
    console.error("[chiamata] table_calls illeggibile (migrazione #83?):", errLettura);
    return json({ error: "appel indisponible" }, 503);
  }

  const chiave = chiaveChiamata(tavolo ? { table_id: tavolo.id } : { caller_name: nome });
  const esito = decidiChiamata((righe ?? []) as unknown as ChiamataAperta[], chiave, adesso.toMillis(), attesaMin);
  if (esito.tipo === "gia") return json({ ok: true, gia: true, riprova_tra: esito.restanti });
  if (esito.tipo === "troppe") return json({ error: "trop d'appels" }, 429);

  const ins = await inserisci("table_calls", ambito, {
    table_id: tavolo?.id ?? null,
    table_label: tavolo?.name ?? "",
    caller_name: tavolo ? "" : nome,
    status: "open",
  });
  if (ins.error) {
    console.error("[chiamata] inserimento fallito (migrazione #83?):", ins.error);
    return json({ error: "appel indisponible" }, 503);
  }

  // Mai bloccante: il tablet la trova comunque al prossimo giro.
  void inviaPushChiamata(tavolo ? { tavolo: tavolo.name } : { nome }, ambito).catch(() => {});

  return json({ ok: true, gia: false, riprova_tra: attesaMin * 60 });
};
