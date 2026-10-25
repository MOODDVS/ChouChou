import { randomUUID } from "node:crypto";
import { leggi, inserisci, aggiorna, leggiConfig, ambitoDiRiga, type Ambito } from "./admin/sede";
import {
  CHIAVE_DESTINAZIONI, CHIAVI_STAMPA, daStampare, stampaAttiva,
  dividiTicket, idStampante, leggiDestinazioni, ordineDaRiga,
  type GruppoStampa, type RigaOrdine,
} from "./stampaRegole";
import { mandaStampa, stampaConfigurata } from "./bizprint";
import { piattiVeri } from "./admin/ordiniConti";
import { indirizzoPubblico } from "./indirizzoPubblico";
import { firmaChiamata, firmaAnnullo } from "./printToken";
import { acceso } from "./ordiniRegole";

/**
 * METTERE UN ORDINE IN CODA DI STAMPA.
 *
 * ⚠️ Non fa mai fallire chi la chiama. La stampa e' un di piu': un ticket che
 * non esce e' un fastidio, un ordine che non si registra perche' la stampante
 * e' spenta e' una perdita. Si chiama con `void`, come le email, e qui dentro
 * ogni errore si scrive e si inghiotte.
 *
 * ⚠️ LA PROTEZIONE DAL DOPPIONE STA NEL DATABASE. L'indice unico
 * `(order_id, kind, dest)` della #77 rifiuta la riga gia' presente: un ordine
 * pagato puo' essere visto piu' volte — webhook ripetuto, ritorno dal
 * pagamento, modifica — e due comande uguali in cucina vogliono dire due
 * pizze. Un «esiste gia'?» scritto qui non basterebbe: due richieste possono
 * arrivare nello stesso istante e passarlo tutte e due.
 */
/** Chi ha chiesto il ticket. ⚠️ Non e' un'etichetta: l'indice unico del
 *  database e' PARZIALE (`where origin = 'auto'`), quindi `manual` e' l'unico
 *  modo di far uscire una SECONDA copia dello stesso ordine. La ristampa
 *  esiste perche' la carta si inceppa, il ticket cade, l'inchiostro finisce. */
export type Origine = "auto" | "manual";

/**
 * ⚠️ ADESSO RENDE UN ESITO, e non e' burocrazia. Chi stampa da solo puo'
 * fallire in silenzio — un ticket in meno e' un fastidio. Ma quando il
 * ristoratore PREME «ristampa» e non esce niente, il silenzio e' il guasto:
 * resta a guardare la stampante chiedendosi se ha premuto male. Il motivo
 * torna indietro e la pagina lo dice.
 */
export interface EsitoCoda { accodati: number; motivo?: string }

export async function accodaTicket(o: {
  id: string;
  status?: string | null;
  payment_method?: string | null;
  location_id?: string | null;
}, opz: { origine?: Origine; invio?: string } = {}): Promise<EsitoCoda> {
  const origine: Origine = opz.origine ?? "auto";
  try {
    /* ⚠️ L'INVIO DEL CONTO APERTO NON PASSA DA `daStampare`: i suoi ordini
       sono `pending` + `tab`, e la regola giustamente non li stampa. Qui
       l'autorizzazione e' un'altra — il personale ha validato il primo invio
       (conto-aperto.md) — e la chiede chi chiama: `rilasciaInviiScaduti`.
       `o` e' il «capo» dell'invio, il suo primo ordine: la coda e' per
       ordine, e un invio e' UN ticket. */
    if (!opz.invio && !daStampare(o.status, o.payment_method)) return { accodati: 0, motivo: "stato" };
    if (!stampaConfigurata()) return { accodati: 0, motivo: "servizio" };

    const ambito = ambitoDiRiga(o.location_id ?? null);
    const cfg = await leggiConfig(ambito, [...CHIAVI_STAMPA, CHIAVE_DESTINAZIONI]);
    // ⚠️ Anche in LETTURA la stessa regola: in un database vivo c'e' quello
    // che ci hanno scritto prima che la regola esistesse. Un valore storto
    // qui vuol dire un ticket mandato a una stampante che non esiste — e
    // quello non esce e non lo dice. Vuoto fa fermare `stampaAttiva` sotto.
    const principale = idStampante(cfg.valori.get("print_printer_id"));
    // ⚠️ Volere non e' potere: l'interruttore dice che il ristoratore la
    // vuole, il numero dice che la stampante esiste.
    /* ⚠️ L'INTERRUTTORE VALE PER L'AUTOMATICO, NON PER CHI PREME. `print_auto`
       dice «stampa da sola a ogni ordine»: e' una preferenza. Un dito sul
       bottone e' una richiesta, e spegnere l'automatico non vuol dire
       rinunciare a ristampare un ticket caduto per terra. Il NUMERO della
       stampante invece serve a tutti e due: senza, non c'e' dove mandarlo. */
    if (origine === "auto" ? !stampaAttiva(cfg.valori.get("print_auto"), principale) : !principale) {
      return { accodati: 0, motivo: origine === "auto" ? "spenta" : "stampante" };
    }

    const base = indirizzoPubblico();
    if (!base) {
      console.error("[stampa] PUBLIC_SITE_URL non configurata: nessun indirizzo da dare alla stampante");
      return { accodati: 0, motivo: "indirizzo" };
    }

    // L'ordine vero: chi chiama ci da' l'id, i piatti stanno nella riga.
    // Un invio del conto: i piatti di TUTTI i suoi ordini.
    let ordine: RigaOrdine;
    if (opz.invio) {
      const ordini = await ordiniDiInvio(ambito, opz.invio);
      ordine = { id: o.id, items: ordini.flatMap((x) => (Array.isArray(x.items) ? x.items : [])) };
    } else {
      const { data: riga } = await leggi("orders", ambito, "id, items").eq("id", o.id).maybeSingle();
      ordine = (riga ?? { id: o.id, items: [] }) as unknown as RigaOrdine;
    }

    const gruppi = await dividiPerStampante(ordine, ambito, cfg.valori.get(CHIAVE_DESTINAZIONI), principale);
    let accodati = 0;
    for (const g of gruppi) if (await accodaGruppo(o.id, ambito, g, base, origine)) accodati++;
    return accodati ? { accodati } : { accodati: 0, motivo: "coda" };
  } catch (e) {
    console.error("[stampa] accodaTicket:", String((e as Error)?.message ?? e));
    return { accodati: 0, motivo: "errore" };
  }
}

/**
 * I gruppi di un ordine: uno per stampante coinvolta.
 *
 * ⚠️ LA CATEGORIA NON VIAGGIA DENTRO L'ORDINE. `orders.items` porta nome,
 * formato e nota, non la categoria del menu — e senza quella non si puo'
 * decidere chi stampa cosa. Si legge da `menu_items` con gli id dei piatti.
 * Un piatto cancellato dal menu non ha piu' categoria: finisce sulla
 * principale, che e' il posto giusto per cio' che non si sa dove mandare.
 *
 * Esportata perche' la rotta del ticket rifa' lo stesso calcolo: due
 * divisioni diverse vorrebbero dire un ticket che dice «1/3» e ne contiene
 * un quarto.
 */
export async function dividiPerStampante(
  ordine: RigaOrdine,
  ambito: ReturnType<typeof ambitoDiRiga>,
  destGrezze: unknown,
  principale: string,
): Promise<GruppoStampa[]> {
  const items = Array.isArray(ordine.items) ? ordine.items : [];
  const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [...new Set(items.map((i) => String(i?.id ?? "")).filter((x) => RE_UUID.test(x)))];

  const categoria = new Map<string, string>();
  if (ids.length) {
    const { data } = await leggi("menu_items", ambito, "id, category").in("id", ids);
    for (const r of (data ?? []) as { id: string; category: string }[]) {
      categoria.set(String(r.id), String(r.category ?? ""));
    }
  }

  const piatti = piattiVeri(items)
    .map((i) => ({
      qty: Math.max(1, Math.floor(Number(i.qty) || 1)),
      nome: String(i.base_name ?? i.name ?? "").trim(),
      variante: String(i.variant_label ?? "").trim() || null,
      nota: String(i.notes ?? "").trim() || null,
      categoria: categoria.get(String(i?.id ?? "")) ?? null,
    }));

  return dividiTicket(piatti, leggiDestinazioni(destGrezze), principale);
}

/** Una riga in coda e il suo invio. Separata perche' un gruppo che fallisce
 *  non deve impedire agli altri di partire: se il bar non risponde, le pizze
 *  escono lo stesso. */
async function accodaGruppo(
  orderId: string,
  ambito: ReturnType<typeof ambitoDiRiga>,
  g: GruppoStampa,
  base: string,
  origine: Origine,
): Promise<boolean> {
  // ⚠️ Il token non contiene `~`: quel segno distingue il biglietto della
  // stampa di prova (vedi printToken.ts).
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const { data, error } = await inserisci("print_tickets", ambito, {
    order_id: orderId,
    kind: "kitchen",
    origin: origine,
    status: "queued",
    dest: g.chiave,
    token,
  })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = l'indice unico ha fatto il suo lavoro: questo ordine era gia'
    // in coda per questa stampante. Non e' un guasto, e' la protezione.
    if (String((error as { code?: string }).code ?? "") === "23505") return false;
    console.error("[stampa] coda:", error.message);
    return false;
  }
  const idRiga = String((data as { id?: string } | null)?.id ?? "");
  if (!idRiga) return false;

  const r = await mandaStampa(
    Number(g.printer),
    `${base}/api/print/${token}`,
    `Ticket ${orderId.slice(-4).toUpperCase()}${g.chiave ? ` · ${g.chiave}` : ""}`,
  );

  // ⚠️ Lo stato NON diventa `sent` qui: `sent` vuol dire «il servizio ha
  // chiesto il ticket», e lo scrive la rotta pubblica quando il tablet la
  // apre davvero. Qui si segna solo il tentativo.
  await aggiorna("print_tickets", ambito, {
    attempts: 1,
    job_id: r.ok ? (r.jobId ?? null) : null,
    last_error: r.ok ? null : String(r.errore ?? "").slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("id", idRiga);
  return true;
}

/** I ticket di un ordine, per il pannello: quanti ne sono usciti e quando. */
export async function ticketDiOrdine(orderId: string, location_id: string | null) {
  const { data } = await leggi(
    "print_tickets",
    ambitoDiRiga(location_id),
    "id, dest, status, attempts, last_error, created_at, printed_at",
  )
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export { ordineDaRiga };

/** Un ordine di un invio del conto aperto, per quel che serve a stampare. */
export interface OrdineDiInvio {
  id: string;
  customer_name: string | null;
  table_label: string | null;
  items: RigaOrdine["items"];
  total_cents: number | null;
  created_at: string;
}

/** Gli ordini (non annullati) di un invio, dal primo. Il primo e' il «capo»:
 *  e' a lui che si attacca la riga in coda di stampa. */
export async function ordiniDiInvio(ambito: ReturnType<typeof ambitoDiRiga>, invioId: string): Promise<OrdineDiInvio[]> {
  const { data } = await leggi("orders", ambito, "id, customer_name, table_label, items, total_cents, created_at, status")
    .eq("round_id", invioId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as OrdineDiInvio[];
}

/**
 * «IMPRIMER L'ADDITION»: il conto del tavolo sulla stampante principale.
 *
 * ⚠️ Una riga `kind = 'customer'` (la #76 l'aveva prevista per questo) e
 * `origin = 'manual'`: si puo' stampare quante volte serve — l'indice unico
 * vale solo per gli automatici. Si attacca al primo ordine del conto
 * (`capoId`): la rotta del ticket, vedendo `customer`, disegna l'addizione
 * dell'intero conto.
 */
export async function accodaAddizione(capo: { id: string; location_id?: string | null }): Promise<EsitoCoda> {
  try {
    if (!stampaConfigurata()) return { accodati: 0, motivo: "servizio" };
    const ambito = ambitoDiRiga(capo.location_id ?? null);
    const cfg = await leggiConfig(ambito, ["print_printer_id"]);
    const principale = idStampante(cfg.valori.get("print_printer_id"));
    if (!principale) return { accodati: 0, motivo: "stampante" };
    const base = indirizzoPubblico();
    if (!base) return { accodati: 0, motivo: "indirizzo" };
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const { data, error } = await inserisci("print_tickets", ambito, {
      order_id: capo.id,
      kind: "customer",
      origin: "manual",
      status: "queued",
      dest: "",
      token,
    }).select("id").maybeSingle();
    if (error || !data) {
      console.error("[stampa] addizione:", error?.message);
      return { accodati: 0, motivo: "coda" };
    }
    const r = await mandaStampa(Number(principale), `${base}/api/print/${token}`, `Addition ${capo.id.slice(-4).toUpperCase()}`);
    await aggiorna("print_tickets", ambito, {
      attempts: 1,
      job_id: r.ok ? (r.jobId ?? null) : null,
      last_error: r.ok ? null : String(r.errore ?? "").slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", String((data as { id?: string }).id ?? ""));
    return { accodati: 1 };
  } catch (e) {
    console.error("[stampa] accodaAddizione:", String((e as Error)?.message ?? e));
    return { accodati: 0, motivo: "errore" };
  }
}

/**
 * IL TICKET DI UNA CHIAMATA DAL TAVOLO («Appeler le serveur», «Demander
 * l'addition»), se il ristoratore l'ha acceso (`orders_table_call_print`,
 * Réglages › Ordini dal locale). 22/10/2026.
 *
 * ⚠️ NON PASSA DALLA CODA (`print_tickets`): la coda e' per ordini, e
 * `order_id` non puo' essere vuoto. Una chiamata vive un minuto — un ticket
 * che esce mezz'ora dopo perche' la stampante era spenta non serve a
 * nessuno, quindi niente nuovi tentativi: si manda una volta, come la prova.
 * Il biglietto e' firmato e porta dentro tavolo, nome e ora (`firmaChiamata`).
 *
 * ⚠️ Non fa mai fallire la chiamata: il tablet e le push la dicono comunque.
 * Si chiama con `void`.
 */
export async function stampaChiamata(
  ambito: Ambito,
  d: { tavolo: string; nome: string; conto: boolean },
): Promise<EsitoCoda> {
  try {
    if (!stampaConfigurata()) return { accodati: 0, motivo: "servizio" };
    const cfg = await leggiConfig(ambito, ["print_printer_id", "orders_table_call_print"]);
    if (!acceso(cfg.valori.get("orders_table_call_print"), "orders_table_call_print")) return { accodati: 0, motivo: "spenta" };
    const principale = idStampante(cfg.valori.get("print_printer_id"));
    if (!principale) return { accodati: 0, motivo: "stampante" };
    const base = indirizzoPubblico();
    if (!base) return { accodati: 0, motivo: "indirizzo" };
    const segreto = String(import.meta.env.CRON_SECRET || import.meta.env.SUPABASE_SERVICE_KEY || "");
    if (!segreto) return { accodati: 0, motivo: "segreto" };
    const sede = ambito.modo === "sede" ? ambito.id : "";
    const token = firmaChiamata({ sede, tavolo: d.tavolo, nome: d.nome, conto: d.conto }, segreto);
    const r = await mandaStampa(Number(principale), `${base}/api/print/${token}`, `${d.conto ? "Addition" : "Serveur"} ${d.tavolo || d.nome}`);
    if (!r.ok) console.error("[stampa] chiamata:", r.errore);
    return r.ok ? { accodati: 1 } : { accodati: 0, motivo: "coda" };
  } catch (e) {
    console.error("[stampa] stampaChiamata:", String((e as Error)?.message ?? e));
    return { accodati: 0, motivo: "errore" };
  }
}

/**
 * IL TICKET D'ANNULLO (25/10/2026, il palmare): un ordine annullato o dei
 * piatti tolti con la matita, quando la comanda e' GIA' USCITA in cucina.
 *
 * ⚠️ Solo se la comanda e' uscita (una riga `kitchen` `sent`/`printed`): se
 * e' ancora in coda, la rotta stampa l'ordine com'e' adesso (ridotto) o non
 * lo stampa affatto (annullato) — un annullo di una cosa mai arrivata
 * confonderebbe la cucina.
 * ⚠️ Divisa per stampante come la comanda (`dividiPerStampante`): le pizze
 * tolte escono al forno, le bibite al bar.
 * ⚠️ Fuori dalla coda, come la chiamata: un biglietto firmato con i piatti
 * dentro (`firmaAnnullo`), perche' i piatti tolti non stanno piu' nell'ordine.
 * Non fa mai fallire l'annullo: si chiama con `void`.
 */
export async function stampaAnnullo(
  ambito: Ambito,
  ordineId: string,
  righe: { id?: unknown; qty?: unknown; name?: unknown; base_name?: unknown; variant_label?: unknown; notes?: unknown }[],
  d: { tavolo: string; chi: string },
): Promise<EsitoCoda> {
  try {
    if (!righe.length) return { accodati: 0, motivo: "vuoto" };
    if (!stampaConfigurata()) return { accodati: 0, motivo: "servizio" };
    const { count } = await leggi("print_tickets", ambito, "id", { count: "exact", head: true })
      .eq("order_id", ordineId)
      .eq("kind", "kitchen")
      .in("status", ["sent", "printed"]);
    if (!count) return { accodati: 0, motivo: "mai_uscita" };
    const cfg = await leggiConfig(ambito, ["print_printer_id", CHIAVE_DESTINAZIONI]);
    const principale = idStampante(cfg.valori.get("print_printer_id"));
    if (!principale) return { accodati: 0, motivo: "stampante" };
    const base = indirizzoPubblico();
    if (!base) return { accodati: 0, motivo: "indirizzo" };
    const segreto = String(import.meta.env.CRON_SECRET || import.meta.env.SUPABASE_SERVICE_KEY || "");
    if (!segreto) return { accodati: 0, motivo: "segreto" };
    const sede = ambito.modo === "sede" ? ambito.id : "";
    const gruppi = await dividiPerStampante({ id: ordineId, items: righe } as unknown as RigaOrdine, ambito, cfg.valori.get(CHIAVE_DESTINAZIONI), principale);
    let accodati = 0;
    for (const g of gruppi) {
      const token = firmaAnnullo({
        sede, tavolo: d.tavolo, chi: d.chi,
        righe: g.piatti.map((p) => ({ qty: p.qty, nome: p.nome, variante: p.variante ?? null })),
      }, segreto);
      const r = await mandaStampa(Number(g.printer), `${base}/api/print/${token}`, `Annule ${d.tavolo}${g.chiave ? ` · ${g.chiave}` : ""}`);
      if (r.ok) accodati++;
      else console.error("[stampa] annullo:", r.errore);
    }
    return accodati ? { accodati } : { accodati: 0, motivo: "coda" };
  } catch (e) {
    console.error("[stampa] stampaAnnullo:", String((e as Error)?.message ?? e));
    return { accodati: 0, motivo: "errore" };
  }
}
