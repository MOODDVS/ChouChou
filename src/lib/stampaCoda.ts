import { randomUUID } from "node:crypto";
import { leggi, inserisci, aggiorna, leggiConfig, ambitoDiRiga } from "./admin/sede";
import {
  CHIAVE_DESTINAZIONI, CHIAVI_STAMPA, daStampare, stampaAttiva,
  dividiTicket, idStampante, leggiDestinazioni, ordineDaRiga,
  type GruppoStampa, type RigaOrdine,
} from "./stampaRegole";
import { mandaStampa, stampaConfigurata } from "./bizprint";
import { piattiVeri } from "./admin/ordiniConti";
import { indirizzoPubblico } from "./indirizzoPubblico";

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
export async function accodaTicket(o: {
  id: string;
  status?: string | null;
  payment_method?: string | null;
  location_id?: string | null;
}): Promise<void> {
  try {
    if (!daStampare(o.status, o.payment_method)) return;
    if (!stampaConfigurata()) return;

    const ambito = ambitoDiRiga(o.location_id ?? null);
    const cfg = await leggiConfig(ambito, [...CHIAVI_STAMPA, CHIAVE_DESTINAZIONI]);
    // ⚠️ Anche in LETTURA la stessa regola: in un database vivo c'e' quello
    // che ci hanno scritto prima che la regola esistesse. Un valore storto
    // qui vuol dire un ticket mandato a una stampante che non esiste — e
    // quello non esce e non lo dice. Vuoto fa fermare `stampaAttiva` sotto.
    const principale = idStampante(cfg.valori.get("print_printer_id"));
    // ⚠️ Volere non e' potere: l'interruttore dice che il ristoratore la
    // vuole, il numero dice che la stampante esiste.
    if (!stampaAttiva(cfg.valori.get("print_auto"), principale)) return;

    const base = indirizzoPubblico();
    if (!base) {
      console.error("[stampa] PUBLIC_SITE_URL non configurata: nessun indirizzo da dare alla stampante");
      return;
    }

    // L'ordine vero: chi chiama ci da' l'id, i piatti stanno nella riga.
    const { data: riga } = await leggi("orders", ambito, "id, items").eq("id", o.id).maybeSingle();
    const ordine = (riga ?? { id: o.id, items: [] }) as unknown as RigaOrdine;

    const gruppi = await dividiPerStampante(ordine, ambito, cfg.valori.get(CHIAVE_DESTINAZIONI), principale);
    for (const g of gruppi) await accodaGruppo(o.id, ambito, g, base);
  } catch (e) {
    console.error("[stampa] accodaTicket:", String((e as Error)?.message ?? e));
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
): Promise<void> {
  // ⚠️ Il token non contiene `~`: quel segno distingue il biglietto della
  // stampa di prova (vedi printToken.ts).
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const { data, error } = await inserisci("print_tickets", ambito, {
    order_id: orderId,
    kind: "kitchen",
    origin: "auto",
    status: "queued",
    dest: g.chiave,
    token,
  })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = l'indice unico ha fatto il suo lavoro: questo ordine era gia'
    // in coda per questa stampante. Non e' un guasto, e' la protezione.
    if (String((error as { code?: string }).code ?? "") === "23505") return;
    console.error("[stampa] coda:", error.message);
    return;
  }
  const idRiga = String((data as { id?: string } | null)?.id ?? "");
  if (!idRiga) return;

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
