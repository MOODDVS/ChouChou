import type { APIRoute } from "astro";
import { CLIENT } from "../../../config/client";
import { leggi, aggiorna, tutteLeSedi, ambitoDiRiga, leggiConfig } from "../../../lib/admin/sede";
import {
  ordineDaRiga, idStampante, CHIAVE_DESTINAZIONI, sommaPiatti, piattoBreve, tavoliInsieme, ticketAddizione,
  type RigaOrdine,
} from "../../../lib/stampaRegole";
import { ordiniDiInvio } from "../../../lib/stampaCoda";
import { piattiVeri, notaCliente } from "../../../lib/admin/ordiniConti";
import { defaultLang } from "../../../i18n/ui";
// ⚠️ Il DISEGNO del ticket si prende da `config/`, che e' del cliente: ogni
// ristorante lo vuole a modo suo, e un disegno dentro `lib/` vorrebbe dire
// modificare il motore per cambiarlo — cioe' un conflitto a ogni merge.
import { disegnaTicket } from "../../../config/ticket";
import { dividiPerStampante } from "../../../lib/stampaCoda";
import { componiTesto } from "../../../lib/escpos";
import { leggiProva, sembraProva, leggiChiamata } from "../../../lib/printToken";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
// ⚠️ TEMPORANEO: le bande della prova del logo. Si cancella con l'esperimento.
import { BANDE as PROVA } from "../../../lib/provaLogo";

/**
 * IL TICKET, COME LO LEGGE LA STAMPANTE.
 *
 * ⚠️ Questa rotta e' PUBBLICA, e deve esserlo: la chiama un servizio di stampa
 * che non sa fare login. Il token E' l'autorizzazione — stessa forma del link
 * di annullo del cliente. Per questo non risponde mai con un elenco, non
 * accetta filtri, e un token sbagliato non dice se esisteva: 404 e basta.
 *
 * ⚠️ NON e' una pagina. Rende i COMANDI della stampante (ESC/POS), in UTF-8 e
 * con `text/plain`: provato su carta il 05/10/2026, un HTML esce come sorgente
 * e un PDF esce come i suoi byte.
 */
export const prerender = false;

/* ⚠️ 400 e non 200: il biglietto di una chiamata porta dentro tavolo e nome
   (vedi `firmaChiamata`), ed e' piu' lungo di quello di una prova. */
const RE_TOKEN = /^[A-Za-z0-9~._-]{16,400}$/;

/** Il segreto che firma i biglietti di prova. `CRON_SECRET` c'e' gia' su ogni
 *  cliente; la chiave di servizio e' la rete di sicurezza per chi non l'ha
 *  ancora messo. Non esce mai di qui: si firma, non si spedisce. */
function segretoProva(): string {
  return String(import.meta.env.CRON_SECRET || import.meta.env.SUPABASE_SERVICE_KEY || "");
}

function ticket(testo: string): Response {
  return new Response(testo, {
    status: 200,
    headers: {
      // ⚠️ `text/plain`: e' quello che ha funzionato. L'app legge il corpo come
      // testo e lo passa alla stampante; un tipo binario le farebbe scaricare
      // un file invece di stamparlo.
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // Nessun motore di ricerca deve mai indicizzare un ticket.
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

const vuoto = () => new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** L'ora di ritiro nel fuso del ristorante. Fuori dal fuso giusto, un ordine
 *  delle 19:45 diventa le 17:45 e la cucina lo prepara due ore prima. */
function oraDi(iso: string | null | undefined, fuso: string): string {
  if (!iso) return "--:--";
  try {
    return new Date(iso).toLocaleTimeString("fr-BE", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "--:--";
  }
}

/** Il giorno del ritiro, solo se NON e' oggi (nel fuso del ristorante):
 *  «SAB 24/10». Oggi = null, e il ticket resta quello di sempre. */
function giornoDi(iso: string | null | undefined, fuso: string): string | null {
  if (!iso) return null;
  try {
    const quando = new Date(iso);
    const giorno = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: fuso });
    if (giorno(quando) === giorno(new Date())) return null;
    // ⚠️ In italiano come il resto del ticket del motore («RITIRO», «TAVOLO»),
    // e senza il punto delle abbreviazioni: la stampante non ne ha bisogno.
    const sett = quando.toLocaleDateString("it-IT", { weekday: "short", timeZone: fuso }).replace(".", "");
    const data = quando.toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", timeZone: fuso });
    return `${sett} ${data}`.toUpperCase();
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ params }) => {
  const token = String(params.token ?? "");
  if (!RE_TOKEN.test(token)) return vuoto();

  // ---- 0. La chiamata dal tavolo (`orders_table_call_print`): come la
  // prova, un biglietto firmato che porta dentro quello che deve dire.
  if (sembraProva(token)) {
    const c = leggiChiamata(token, segretoProva());
    if (c) {
      const ambito = c.sede ? ambitoDiRiga(c.sede) : tutteLeSedi();
      const [cfg, lingua] = await Promise.all([leggiConfig(ambito, ["timezone"]), adminLang().catch(() => "fr" as const)]);
      const tr = adminT(lingua);
      const fuso = String(cfg.valori.get("timezone") || "Europe/Brussels");
      const ora = oraDi(new Date(c.ora * 1000).toISOString(), fuso);
      const chi = c.tavolo || c.nome || "—";
      const frase = c.tavolo
        ? tr(c.conto ? "nav.toastBill" : "nav.toastCall").replace("{t}", c.tavolo)
        : tr("nav.toastCallName").replace("{nome}", c.nome);
      return ticket(
        componiTesto([
          { testo: tr(c.conto ? "tk.billTitle" : "tk.callTitle"), taglia: "grande", grassetto: true, centrato: true, inverso: true },
          { testo: chi, taglia: "gigante", grassetto: true, centrato: true },
          { testo: ora, taglia: "grande", grassetto: true, centrato: true, linea: true },
          { testo: frase, taglia: "normale", centrato: true },
        ]),
      );
    }
  }

  // ---- 1. Il biglietto di prova: non ha un ordine, e scade da solo.
  if (sembraProva(token)) {
    const p = leggiProva(token, segretoProva());
    if (!p) return vuoto();
    const ambito = p.sede ? ambitoDiRiga(p.sede) : tutteLeSedi();
    const cfg = await leggiConfig(ambito, ["timezone"]);
    const fuso = String(cfg.valori.get("timezone") || "Europe/Brussels");
    const adesso = new Date().toLocaleTimeString("fr-BE", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hour12: false });
    return ticket(
      componiTesto([
        { testo: "TEST", taglia: "grande", grassetto: true, centrato: true, inverso: true },
        { testo: adesso, taglia: "gigante", grassetto: true, centrato: true },
        { testo: "RestoHub", taglia: "normale", centrato: true, linea: true },
        { testo: "Cette imprimante est bien reliee.", taglia: "normale", grassetto: true },
        { testo: "123456789012345678901234567890123456789012345678", taglia: "piccolo" },
        // ---- ESPERIMENTO DEL LOGO, SECONDO GIRO — DA TOGLIERE ----
        // ⚠️ Il primo biglietto si e' interrotto ESATTAMENTE dove cominciava
        // la prima banda: dopo «1 · CP437» la carta era tagliata, e le altre
        // tre — compresa quella di controllo — non sono mai uscite. Quindi la
        // domanda non era quella giusta: prima di sapere QUALE tabella usa
        // l'app, bisogna sapere se un comando del genere attraversa il tubo.
        //
        // L'indiziato e' IL BYTE ZERO. L'intestazione di `GS v 0` ne porta
        // due, e se l'app tratta il corpo come una stringa che finisce al
        // primo zero, il lavoro muore li' e la taglierina parte perche' il
        // taglio lo aggiunge lei. Torna col fatto che il ticket di tutti i
        // giorni funziona: il suo unico zero sta nel comando di taglio, in
        // fondo, dove troncare non si vede.
        //
        // Qui sotto le domande sono tre, e le prime due sono di solo TESTO —
        // quelle escono di sicuro, qualunque cosa succeda dopo:
        //
        //   1. Quali caratteri alti escono giusti? Dice se l'app converte, e
        //      verso quale tabella. L'euro lo sappiamo gia' (05/10): esce. In
        //      CP437 e CP850 l'euro NON esiste — se esce, la tabella e'
        //      un'altra, e le bande scritte in CP437 non potevano funzionare.
        //   2. Una riga, un byte zero, un'altra riga. ⚠️ Se la riga DOPO non
        //      c'e', lo zero tronca — e allora la strada e' chiusa per
        //      sempre, non per la tabella: il bianco di un disegno sono byte
        //      zero a mucchi, e quelli non si tolgono.
        //   3. Solo allora le bande: prima quella di CONTROLLO (tutti byte
        //      sotto il 128), poi il disegno pieno. Nell'ordine giusto,
        //      stavolta: la prima volta la banda che doveva uscire era quarta,
        //      dietro tre che potevano far saltare il ticket. Una prova che
        //      si auto-impedisce di rispondere non e' una prova.
        { testo: "", linea: true },
        { testo: "PROVA 2", taglia: "normale", grassetto: true, centrato: true },
        { testo: "1) EUR \u20ac | CP437 \u2554 \u2591 | lat \u00f1 \u00b0 \u00a7" },
        { testo: "2) riga PRIMA dello zero" },
        // Il byte zero, da solo. Se quello che segue non si stampa, e' lui.
        { grezzo: "\u0000", testo: "" },
        { testo: "3) riga DOPO lo zero — se la vedi, passa" },
        { testo: "4) banda di CONTROLLO (deve uscire a righe)" },
        { grezzo: PROVA.sette, testo: "" },
        { testo: "5) banda piena in CP437" },
        { grezzo: PROVA.cp437, testo: "" },
        { testo: "6) FINE — se leggi questa, e' passato tutto" },
      ]),
    );
  }

  // ---- 2. Il ticket di un ordine: il token sta nella riga della coda.
  // ⚠️ AGGREGATO, come l'annullo pubblico: il token e' gia' l'autorizzazione,
  // e filtrare per sede romperebbe la stampa di ogni punto che non sia il
  // primo — il ticket semplicemente non uscirebbe, senza dirlo a nessuno.
  const { data: riga } = await leggi("print_tickets", tutteLeSedi(), "id, order_id, location_id, status, created_at, dest, kind")
    .eq("token", token)
    .maybeSingle();
  if (!riga) return vuoto();

  // Un token vecchio non stampa piu'. Una comanda di ieri che esce stanotte
  // perche' qualcuno ha riaperto un indirizzo e' una pizza che nessuno ha
  // ordinato.
  const eta = Date.now() - new Date(String(riga.created_at ?? 0)).getTime();
  if (!Number.isFinite(eta) || eta > 24 * 3600 * 1000) return vuoto();

  const ambito = ambitoDiRiga(riga.location_id as string | null);
  /* ⚠️ DUE TENTATIVI, e il secondo non e’ prudenza eccessiva: su un cliente
     che non ha ancora passato la #82 una `select` con `service` FALLISCE, e
     qui un ordine che non si legge vuol dire `vuoto()` — cioe’ NESSUN TICKET,
     per tutti gli ordini, compresi quelli da asporto che col tavolo non hanno
     niente a che fare. Meglio perdere il nome del tavolo che la comanda. */
  const CAMPI = "id, status, payment_method, customer_name, customer_phone, items, pickup_time";
  const leggiOrdine = (campi: string) =>
    leggi("orders", ambito, campi).eq("id", riga.order_id).maybeSingle();
  // ⚠️ Quattro tentativi, dal piu' largo: #87 (il conto aperto), #84
  // (l'indirizzo), poi #82, poi la base.
  let { data: ordine } = await leggiOrdine(`${CAMPI}, service, table_label, delivery_address, round_id, reservation_id`);
  if (!ordine) ({ data: ordine } = await leggiOrdine(`${CAMPI}, service, table_label, delivery_address`));
  if (!ordine) ({ data: ordine } = await leggiOrdine(`${CAMPI}, service, table_label`));
  if (!ordine) ({ data: ordine } = await leggiOrdine(CAMPI));
  if (!ordine) return vuoto();

  const cfg = await leggiConfig(ambito, ["timezone", "print_printer_id", CHIAVE_DESTINAZIONI]);
  const fuso = String(cfg.valori.get("timezone") || "Europe/Brussels");
  const pickupIso = (ordine as { pickup_time?: string }).pickup_time;
  const ora = oraDi(pickupIso, fuso);
  const segnaInviato = async () => {
    if (String(riga.status) === "queued") {
      await aggiorna("print_tickets", ambito, { status: "sent", sent_at: new Date().toISOString() }).eq("id", riga.id);
    }
  };
  const conto = ordine as unknown as { round_id?: string | null; reservation_id?: string | null };

  /* ---- L'ADDIZIONE del conto aperto («Imprimer l'addition») ----
     ⚠️ Riga `customer`: va in mano al cliente, quindi i prezzi ci sono, per
     persona, e la lingua e' quella pubblica del locale. Tutti gli ordini del
     conto, non solo quello a cui e' attaccata la riga. */
  if (String((riga as { kind?: string }).kind ?? "") === "customer") {
    if (!conto.reservation_id) return vuoto();
    const { data: tuttiRaw } = await leggi("orders", ambito, "customer_name, items, total_cents, table_label, created_at")
      .eq("reservation_id", conto.reservation_id)
      .not("round_id", "is", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true });
    const tutti = (tuttiRaw ?? []) as unknown as { customer_name: string | null; items: RigaOrdine["items"]; total_cents: number | null; table_label: string | null }[];
    const perNome = new Map<string, { nome: string; righe: { testo: string; cents: number }[]; totale: number }>();
    for (const o of tutti) {
      const nome = String(o.customer_name ?? "").trim() || "-";
      const p = perNome.get(nome) ?? { nome, righe: [], totale: 0 };
      for (const i of piattiVeri(o.items ?? [])) {
        const qty = Math.max(1, Math.floor(Number(i.qty) || 1));
        const prezzo = Number((i as { price_cents?: number }).price_cents) || 0;
        p.righe.push({ testo: piattoBreve({ qty, nome: String(i.base_name ?? i.name ?? "").trim(), variante: String(i.variant_label ?? "").trim() || null }), cents: prezzo * qty });
      }
      p.totale += Number(o.total_cents) || 0;
      perNome.set(nome, p);
    }
    const persone = [...perNome.values()];
    const quando = new Date().toLocaleString("fr-BE", { timeZone: fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    await segnaInviato();
    return ticket(componiTesto(ticketAddizione({
      insegna: CLIENT.nome,
      tavolo: tavoliInsieme(tutti.map((o) => o.table_label)),
      quando,
      persone,
      totale: persone.reduce((t, p) => t + p.totale, 0),
      lang: defaultLang,
    })));
  }

  /* ---- UN INVIO del conto aperto: un ticket per tutto il tavolo ----
     I piatti di tutti gli ordini dell'invio, SOMMATI; sotto, chi ha preso
     cosa (solo i piatti di QUESTA stampante); in testa «TAVOLO 7 · INVIO 2». */
  if (conto.round_id) {
    const ordiniInvio = await ordiniDiInvio(ambito, conto.round_id);
    const { data: invRaw } = await leggi("table_rounds", ambito, "number").eq("id", conto.round_id).maybeSingle();
    const numero = Number((invRaw as { number?: number } | null)?.number) || null;
    const unito: RigaOrdine = {
      ...(ordine as unknown as RigaOrdine),
      table_label: tavoliInsieme(ordiniInvio.map((o) => o.table_label)) || (ordine as unknown as RigaOrdine).table_label,
      items: ordiniInvio.flatMap((o) => (Array.isArray(o.items) ? o.items : []).filter((i) => String(i?.id ?? "") !== "note")),
    };
    const datiInvio = ordineDaRiga(unito, ora);
    datiInvio.insegna = CLIENT.nome;
    datiInvio.invio = numero;
    datiInvio.cliente = "";
    datiInvio.telefono = null;
    datiInvio.daIncassare = false;
    // Le note di ognuno, col suo nome: «Marco: sans oignon».
    const note = ordiniInvio
      .map((o) => ({ nome: String(o.customer_name ?? "").trim(), nota: notaCliente(o.items ?? []) }))
      .filter((x) => x.nota)
      .map((x) => (x.nome ? `${x.nome}: ${x.nota}` : String(x.nota)));
    datiInvio.note = note.length ? note.join(" / ") : null;
    const principale = idStampante(cfg.valori.get("print_printer_id"));
    const destGrezze = cfg.valori.get(CHIAVE_DESTINAZIONI);
    const gruppi = await dividiPerStampante(unito, ambito, destGrezze, principale);
    const dest = String((riga as { dest?: string }).dest ?? "");
    const i = gruppi.findIndex((g) => g.chiave === dest);
    if (i >= 0) {
      datiInvio.piatti = sommaPiatti(gruppi[i].piatti);
      datiInvio.parte = {
        n: i + 1,
        su: gruppi.length,
        altri: gruppi.filter((_, k) => k !== i).map((g) => ({ nome: g.nome || "?", righe: g.piatti.reduce((n, p) => n + p.qty, 0) })),
      };
    } else {
      datiInvio.piatti = sommaPiatti(datiInvio.piatti);
    }
    // Chi ha preso cosa, fra i piatti di questa stampante.
    const perPersona: { nome: string; piatti: string[] }[] = [];
    for (const o of ordiniInvio) {
      const g = (await dividiPerStampante({ id: o.id, items: o.items }, ambito, destGrezze, principale)).find((x) => x.chiave === dest);
      const piatti = (g?.piatti ?? []).map(piattoBreve);
      if (piatti.length) perPersona.push({ nome: String(o.customer_name ?? "").trim() || "-", piatti });
    }
    datiInvio.perPersona = perPersona;
    await segnaInviato();
    return ticket(componiTesto(disegnaTicket(datiInvio)));
  }

  const dati = ordineDaRiga(ordine as unknown as RigaOrdine, ora);
  dati.giorno = giornoDi(pickupIso, fuso);
  // L'insegna in testa al ticket: il nome del locale, non un titolo scritto a
  // mano. ⚠️ Il LOGO vero non puo' passare di qui: un'immagine ESC/POS porta
  // byte oltre il 128 e il servizio di stampa legge il corpo COME TESTO —
  // sarebbe rovinata prima della testina, come le tabelle di caratteri.
  // L'unico logo possibile e' quello caricato dentro la stampante (`FS p`),
  // ed e' un passo a parte: finche' non c'e', comanda il nome.
  dati.insegna = CLIENT.nome;

  // ⚠️ I PIATTI DI QUESTA STAMPANTE, non tutti. La divisione la rifa' la
  // stessa funzione che l'ha fatta in coda: due calcoli diversi vorrebbero
  // dire un ticket che annuncia «1/3» e contiene un quarto dei piatti.
  const gruppi = await dividiPerStampante(
    ordine as unknown as RigaOrdine,
    ambito,
    cfg.valori.get(CHIAVE_DESTINAZIONI),
    // La stessa regola della coda: la divisione dei piatti deve venire
    // identica da tutte e due le parti, compreso cosa si considera una
    // stampante valida.
    idStampante(cfg.valori.get("print_printer_id")),
  );
  const dest = String((riga as { dest?: string }).dest ?? "");
  const i = gruppi.findIndex((g) => g.chiave === dest);
  if (i >= 0) {
    dati.piatti = gruppi[i].piatti;
    // ⚠️ «anche: 2x Bar» serve a chi prepara: senza, legge un foglio che
    // SEMBRA tutto l'ordine ed e' un terzo, e nessuno si accorge se una delle
    // altre stampanti non ha stampato.
    dati.parte = {
      n: i + 1,
      su: gruppi.length,
      altri: gruppi.filter((_, k) => k !== i).map((g) => ({
        nome: g.nome || "?",
        righe: g.piatti.reduce((n, p) => n + p.qty, 0),
      })),
    };
  }
  const testo = componiTesto(disegnaTicket(dati));

  // ⚠️ `sent`, non `printed`. Qui sappiamo solo che il ticket e' stato
  // CONSEGNATO a chi stampa: se la carta e' finita, non esce niente e noi
  // l'avremmo gia' segnato come fatto. `printed` lo scrive la conferma.
  if (String(riga.status) === "queued") {
    await aggiorna("print_tickets", ambito, { status: "sent", sent_at: new Date().toISOString() })
      .eq("id", riga.id);
  }
  return ticket(testo);
};
