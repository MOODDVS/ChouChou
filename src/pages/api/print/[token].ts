import type { APIRoute } from "astro";
import { CLIENT } from "../../../config/client";
import { leggi, aggiorna, tutteLeSedi, ambitoDiRiga, leggiConfig } from "../../../lib/admin/sede";
import { ordineDaRiga, idStampante, CHIAVE_DESTINAZIONI, type RigaOrdine } from "../../../lib/stampaRegole";
// ⚠️ Il DISEGNO del ticket si prende da `config/`, che e' del cliente: ogni
// ristorante lo vuole a modo suo, e un disegno dentro `lib/` vorrebbe dire
// modificare il motore per cambiarlo — cioe' un conflitto a ogni merge.
import { disegnaTicket } from "../../../config/ticket";
import { dividiPerStampante } from "../../../lib/stampaCoda";
import { componiTesto } from "../../../lib/escpos";
import { leggiProva, sembraProva } from "../../../lib/printToken";
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

const RE_TOKEN = /^[A-Za-z0-9~._-]{16,200}$/;

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

export const GET: APIRoute = async ({ params }) => {
  const token = String(params.token ?? "");
  if (!RE_TOKEN.test(token)) return vuoto();

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
        // ---- ESPERIMENTO DEL LOGO (09/10/2026) — DA TOGLIERE ----
        // ⚠️ Quattro volte lo stesso disegno, scritto in quattro modi. La
        // domanda e' una sola: l'app che legge questo corpo CONVERTE il testo
        // nella tabella della stampante? Se si', il logo esce pieno, e quale
        // delle prime tre bande esce dice quale tabella usa. La quarta e' il
        // controllo: solo byte sotto il 128, quindi deve uscire comunque — a
        // righe, perche' a 7 bit una colonna ogni otto resta bianca.
        //
        //   esce la 1, la 2 o la 3  -> l'app converte. Il logo si puo' fare.
        //   esce SOLO la 4          -> la stampante disegna, l'app non converte.
        //   non esce niente         -> questa stampante non fa immagini da qui.
        //
        // Si legge con gli occhi, su carta: va fotografato. ⚠️ Quando la
        // risposta c'e', si tolgono queste righe e `lib/provaLogo.ts`.
        { testo: "", linea: true },
        { testo: "PROVA LOGO — guarda quale esce", taglia: "normale", grassetto: true, centrato: true },
        { testo: "1 · CP437", taglia: "normale" },
        { grezzo: PROVA.cp437, testo: "" },
        { testo: "2 · CP850", taglia: "normale" },
        { grezzo: PROVA.cp850, testo: "" },
        { testo: "3 · CP1252", taglia: "normale" },
        { grezzo: PROVA.cp1252, testo: "" },
        { testo: "4 · a 7 bit (deve uscire, a righe)", taglia: "normale" },
        { grezzo: PROVA.sette, testo: "" },
      ]),
    );
  }

  // ---- 2. Il ticket di un ordine: il token sta nella riga della coda.
  // ⚠️ AGGREGATO, come l'annullo pubblico: il token e' gia' l'autorizzazione,
  // e filtrare per sede romperebbe la stampa di ogni punto che non sia il
  // primo — il ticket semplicemente non uscirebbe, senza dirlo a nessuno.
  const { data: riga } = await leggi("print_tickets", tutteLeSedi(), "id, order_id, location_id, status, created_at, dest")
    .eq("token", token)
    .maybeSingle();
  if (!riga) return vuoto();

  // Un token vecchio non stampa piu'. Una comanda di ieri che esce stanotte
  // perche' qualcuno ha riaperto un indirizzo e' una pizza che nessuno ha
  // ordinato.
  const eta = Date.now() - new Date(String(riga.created_at ?? 0)).getTime();
  if (!Number.isFinite(eta) || eta > 24 * 3600 * 1000) return vuoto();

  const ambito = ambitoDiRiga(riga.location_id as string | null);
  const { data: ordine } = await leggi(
    "orders",
    ambito,
    "id, status, payment_method, customer_name, customer_phone, items, pickup_time",
  )
    .eq("id", riga.order_id)
    .maybeSingle();
  if (!ordine) return vuoto();

  const cfg = await leggiConfig(ambito, ["timezone", "print_printer_id", CHIAVE_DESTINAZIONI]);
  const ora = oraDi((ordine as { pickup_time?: string }).pickup_time, String(cfg.valori.get("timezone") || "Europe/Brussels"));
  const dati = ordineDaRiga(ordine as unknown as RigaOrdine, ora);
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
