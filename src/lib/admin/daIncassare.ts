import { DateTime } from "luxon";
import { leggi, leggiConfig, type Ambito } from "./sede";
import { fusoDi } from "../fuso";
import { quadroPagamenti, type PagamentoConto } from "../contoRegole";
import { raggruppaDaIncassare, sedutaFinita, type OrdineDaIncassare, type RigaDaIncassare, type SedutaInc } from "../daIncassareRegole";
import { durateDelServizio } from "../pianoSalaRegole";

/**
 * COSA NON E' STATO INCASSATO — per l'avviso sul tablet (ogni mezz'ora) e per
 * il riepilogo del mattino.
 *
 * Due cose diverse con lo stesso problema: soldi che nessuno ha preso.
 * - Gli ORDINI DA INCASSARE (`pending` + `onsite`: «Payer au comptoir»,
 *   «Paiement sur place»): il ticket e' uscito, il cibo e' partito, e se
 *   nessuno preme «Encaissé» restano `pending` per sempre. Il cron
 *   `auto-complete-orders` non li tocca, di proposito.
 * - I CONTI APERTI al tavolo con un resto da pagare, quando il tavolo ha gia'
 *   superato la sua durata (o e' di un giorno passato): prima di allora un
 *   conto aperto e' una cena in corso, non una dimenticanza.
 *
 * ⚠️ Una finestra di 7 giorni, come la lista Commandes: oltre, un ordine mai
 * incassato e' un dato da sistemare a mano, non un avviso da ripetere ogni
 * mezz'ora per sempre.
 * ⚠️ Ogni lettura ha il suo ripiego: senza la #50 (`payment_method`) o la
 * #87/#88 (conto aperto) quella parte e' vuota, e l'altra funziona lo stesso.
 */

export type { OrdineDaIncassare };
export interface ContoDaIncassare {
  id: string;
  tavolo: string;
  resto_cents: number;
  data: string;
}
export interface DaIncassare {
  ordini: OrdineDaIncassare[];
  conti: ContoDaIncassare[];
}

/** Minuti oltre i quali un ordine da incassare diventa «dimenticato». */
export const ORDINE_DIMENTICATO_MIN = 30;
/** Durata del tavolo di ripiego (come `caricaResaGiorno`). */
const HOLD_RIPIEGO = 90;

export async function cosaDaIncassare(
  ambito: Ambito,
  adesso: Date = new Date(),
  dopoMin: number = ORDINE_DIMENTICATO_MIN,
): Promise<DaIncassare> {
  const fuso = await fusoDi(ambito);
  const ora = DateTime.fromJSDate(adesso).setZone(fuso);
  const da = ora.minus({ days: 7 }).startOf("day");
  const [ordini, conti] = await Promise.all([
    ordiniDaIncassare(ambito, da.toUTC().toISO() ?? "", ora.minus({ minutes: dopoMin }).toUTC().toISO() ?? "", ora),
    contiDaIncassare(ambito, ora, da.toFormat("yyyy-MM-dd"), adesso),
  ]);
  return { ordini, conti };
}

/* ⚠️ Un avviso per TAVOLO, non per ordine (26/10/2026): i giri della stessa
   seduta si sommano e il pagato in parte al palmare si toglie. La regola sta
   in `lib/daIncassareRegole.ts`. Per questo la lettura non taglia a 30
   minuti: serve anche il giro appena ordinato, per il totale della seduta;
   «dimenticato» si decide sul giro piu' vecchio. */
async function ordiniDaIncassare(ambito: Ambito, daIso: string, primaDiIso: string, ora: DateTime): Promise<OrdineDaIncassare[]> {
  try {
    let righe: RigaDaIncassare[] | null = null;
    // Dal piu' ricco al piu' povero: senza la #82 non c'e' `table_label`,
    // senza la seduta al tavolo non c'e' `reservation_id`.
    for (const colonne of [
      "id, customer_name, total_cents, table_label, created_at, reservation_id, service",
      "id, customer_name, total_cents, table_label, created_at",
      "id, customer_name, total_cents, created_at",
    ]) {
      const { data, error } = await leggi("orders", ambito, colonne)
        .eq("status", "pending")
        .eq("payment_method", "onsite")
        .gte("created_at", daIso)
        .order("created_at", { ascending: true })
        .limit(300);
      if (!error) { righe = mappaOrdini(data); break; }
    }
    if (!righe?.length) return [];
    const sedute = [...new Set(righe.map((r) => r.reservation_id).filter((x): x is string => !!x))];
    const pagato = new Map<string, number>();
    // Le sedute ancora a cena non si ricordano (`sedutaFinita`). Se la
    // lettura fallisce si torna alla sola regola dei 30 minuti.
    let finita: ((id: string) => boolean) | undefined;
    if (sedute.length) {
      try {
        const [{ data: prenRaw, error: ePren }, { valori }] = await Promise.all([
          leggi("reservations", ambito, "id, date, heure, status, service_key, extra_minutes").in("id", sedute),
          leggiConfig(ambito, ["reservation_services", "reservation_hold_minutes"]),
        ]);
        if (!ePren) {
          const pren = new Map(((prenRaw ?? []) as unknown as (SedutaInc & { id: string })[]).map((r) => [String(r.id), r]));
          const durate = durateDelServizio(valori.get("reservation_services"), valori.get("reservation_hold_minutes"));
          const oggi = ora.toFormat("yyyy-MM-dd");
          const oraMin = ora.hour * 60 + ora.minute;
          finita = (id) => sedutaFinita(pren.get(id), durate, oggi, oraMin);
        }
      } catch { /* solo i 30 minuti */ }
    }
    if (sedute.length) {
      const { data: pag, error } = await leggi("table_payments", ambito, "reservation_id, amount_cents")
        .in("reservation_id", sedute)
        .eq("status", "paid");
      if (!error) {
        for (const p of (pag ?? []) as unknown as { reservation_id: string; amount_cents: number }[]) {
          const k = String(p.reservation_id);
          pagato.set(k, (pagato.get(k) ?? 0) + (Number(p.amount_cents) || 0));
        }
      }
    }
    return raggruppaDaIncassare(righe, pagato, primaDiIso, finita).slice(0, 50);
  } catch {
    return [];
  }
}

function mappaOrdini(righe: unknown): RigaDaIncassare[] {
  return ((righe ?? []) as Record<string, unknown>[]).map((o) => ({
    id: String(o.id),
    nome: String(o.customer_name ?? "").trim(),
    totale_cents: Math.max(0, Math.round(Number(o.total_cents) || 0)),
    tavolo: String(o.table_label ?? "").trim() || null,
    creato: String(o.created_at ?? ""),
    reservation_id: o.reservation_id ? String(o.reservation_id) : null,
    service: o.service ? String(o.service) : null,
  }));
}

async function contiDaIncassare(ambito: Ambito, ora: DateTime, daData: string, adesso: Date): Promise<ContoDaIncassare[]> {
  try {
    const { data, error } = await leggi("reservations", ambito, "id, date, heure, seated_at, tab_table_id")
      .eq("tab_status", "open")
      .neq("status", "cancelled")
      .gte("date", daData);
    if (error || !data?.length) return [];
    const { valori } = await leggiConfig(ambito, ["reservation_hold_minutes"]);
    const nH = Math.floor(Number(valori.get("reservation_hold_minutes")));
    const hold = Number.isFinite(nH) && nH >= 15 && nH <= 360 ? nH : HOLD_RIPIEGO;
    const oggi = ora.toFormat("yyyy-MM-dd");
    // Il tavolo ha finito il suo tempo: dall'arrivo vero, se c'e'.
    const finito = (r: Record<string, unknown>): boolean => {
      if (String(r.date) < oggi) return true;
      const arrivo = r.seated_at
        ? DateTime.fromISO(String(r.seated_at)).setZone(ora.zone)
        : DateTime.fromISO(`${String(r.date)}T${String(r.heure ?? "00:00").slice(0, 5)}`, { zone: ora.zone });
      return arrivo.isValid && ora >= arrivo.plus({ minutes: hold });
    };
    const scaduti = (data as Record<string, unknown>[]).filter(finito);
    if (!scaduti.length) return [];
    const ids = scaduti.map((r) => String(r.id));
    const tavoliIds = [...new Set(scaduti.map((r) => String(r.tab_table_id ?? "")).filter(Boolean))];
    const [ordRaw, pagRaw, tavRaw] = await Promise.all([
      leggi("orders", ambito, "reservation_id, total_cents")
        .in("reservation_id", ids)
        .not("round_id", "is", null)
        .neq("status", "cancelled")
        .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as { reservation_id: string; total_cents: number | null }[]))),
      leggi("table_payments", ambito, "reservation_id, kind, method, status, amount_cents, hold_until, order_ids")
        .in("reservation_id", ids)
        .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as (PagamentoConto & { reservation_id: string })[]))),
      tavoliIds.length
        ? leggi("restaurant_tables", ambito, "id, name")
            .in("id", tavoliIds)
            .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as { id: string; name: string }[])))
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const nome = new Map(tavRaw.map((t) => [t.id, t.name]));
    return scaduti
      .map((r) => {
        const id = String(r.id);
        const totale = ordRaw.filter((o) => o.reservation_id === id).reduce((t, o) => t + (Number(o.total_cents) || 0), 0);
        const q = quadroPagamenti(totale, pagRaw.filter((p) => p.reservation_id === id), adesso);
        return { id, tavolo: nome.get(String(r.tab_table_id ?? "")) ?? "", resto_cents: q.resto, data: String(r.date) };
      })
      .filter((c) => c.resto_cents > 0);
  } catch {
    return [];
  }
}
