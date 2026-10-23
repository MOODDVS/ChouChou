/**
 * LA SALA DI ADESSO, LETTA UNA VOLTA SOLA — per il palmare (23/10/2026).
 *
 * PERCHE' ESISTE: le pagine del palmare erano lente. La scheda di un tavolo
 * faceva una decina di letture UNA DOPO L'ALTRA (il tavolo, poi il fuso, poi
 * i conti, poi le prenotazioni, poi la configurazione, poi di nuovo le
 * prenotazioni per il modale…): ogni lettura e' un viaggio fino a Supabase,
 * e in fila si sommano. Qui si legge tutto INSIEME, in parallelo, e le
 * funzioni del palmare (`schedaTavolo`, installare, spostare) lavorano su
 * questi dati senza tornare al database.
 *
 * ⚠️ La configurazione (catene, durate) arriva dalla cache di `app_config`
 * (30 s, svuotata da ogni `scriviConfig`): cambia di rado, e la si chiedeva
 * a ogni pagina.
 */
import { DateTime } from "luxon";
import { leggi, type Ambito } from "./sede";
import { fusoDi } from "../fuso";
import { appConfigIn } from "../appConfigCache";
import { configSala } from "../schedule";
import { servizioInCorso } from "../ordiniRegole";
import { durateDelServizio, type DurateServizio } from "../pianoSalaRegole";
import { tavoliNonDisponibili } from "../salaInstallaRegole";
import { contiApertiDellaSala, type RigaConto } from "./contiSala";

export interface TavoloSala {
  id: string;
  name: string;
  seats: number;
  zone: string;
}

/** Una prenotazione di oggi, con tutti i campi che servono al palmare. */
export interface RigaGiornoSala {
  id: string;
  heure: string;
  people: number | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  tables: unknown;
  seated_at: string | null;
  tab_status: string | null;
  tab_table_id: string | null;
  service_key: string | null;
  extra_minutes: number | null;
}
const CAMPI_GIORNO = "id, heure, people, first_name, last_name, status, tables, seated_at, tab_status, tab_table_id, service_key, extra_minutes";

export interface LetturaSala {
  fuso: string;
  ora: DateTime;
  oggi: string;
  servizio: string | null;
  /** Tutti i tavoli del punto. */
  tavoli: TavoloSala[];
  /** Le prenotazioni di oggi in attesa, confermate o sedute. */
  righe: RigaGiornoSala[];
  /** `reservation_plan_links` com'e' salvato (le catene, per section). */
  legami: string | undefined;
  durate: DurateServizio;
  /** Quanto dura un'installazione che parte adesso. */
  durataNuova: number;
  /** I conti aperti (anche di ieri): solo se chiesti. */
  conti: RigaConto[];
  /** Chiamate aperte delle ultime 12 ore: solo se chieste. */
  chiamate: { table_id: string | null; reason: string | null }[];
}

/** La configurazione dalla cache (30 s), come mappa chiave → valore. */
export async function configInCache(ambito: Ambito, chiavi: string[]): Promise<Map<string, string>> {
  const { data } = await appConfigIn(chiavi, ambito);
  return new Map(data.map((r) => [r.key, r.value]));
}

export async function letturaSala(
  ambito: Ambito,
  opz: { conti?: boolean; chiamate?: boolean } = {},
): Promise<LetturaSala> {
  const fuso = await fusoDi(ambito); // dalla cache: niente viaggio
  const ora = DateTime.now().setZone(fuso);
  const oggi = ora.toFormat("yyyy-MM-dd");
  const [{ data: tavRaw }, { data: resaRaw }, valori, cfg, conti, chiamate] = await Promise.all([
    leggi("restaurant_tables", ambito, "id, name, seats, zone"),
    leggi("reservations", ambito, CAMPI_GIORNO).eq("date", oggi).in("status", ["pending", "confirmed", "seated"]),
    configInCache(ambito, ["reservation_plan_links", "reservation_hold_minutes", "reservation_services"]),
    configSala(DateTime.now(), ambito).catch(() => null),
    opz.conti ? contiApertiDellaSala(ambito) : Promise.resolve([] as RigaConto[]),
    opz.chiamate
      ? leggi("table_calls", ambito, "table_id, reason")
          .eq("status", "open")
          .gte("created_at", ora.minus({ hours: 12 }).toUTC().toISO() as string)
          .then((r) => (r.error ? [] : ((r.data ?? []) as unknown as LetturaSala["chiamate"])))
      : Promise.resolve([] as LetturaSala["chiamate"]),
  ]);
  const durate = durateDelServizio(valori.get("reservation_services"), valori.get("reservation_hold_minutes"));
  const servizio = cfg ? servizioInCorso(cfg, ora.toFormat("HH:mm")) : null;
  return {
    fuso,
    ora,
    oggi,
    servizio,
    tavoli: ((tavRaw ?? []) as unknown as { id: string; name: string; seats: number; zone: string | null }[]).map((t) => ({
      id: String(t.id),
      name: String(t.name ?? ""),
      seats: Math.max(0, Math.floor(Number(t.seats)) || 0),
      zone: String(t.zone ?? "").trim(),
    })),
    righe: (resaRaw ?? []) as unknown as RigaGiornoSala[],
    legami: valori.get("reservation_plan_links"),
    durate,
    durataNuova: (servizio ? durate.perServizio[servizio] : undefined) ?? durate.ripiego,
    conti,
    chiamate,
  };
}

/**
 * Chi e' preso adesso: seduti (`occupati`), in arrivo (`prenotati`), e i
 * tavoli uniti (`gruppi`). `escludiId` = una prenotazione da non contare — la
 * tavolata che si sposta: i suoi tavoli si liberano nel momento in cui si muove.
 */
export function occupazioneDa(l: LetturaSala, escludiId?: string) {
  return tavoliNonDisponibili({
    righe: (escludiId ? l.righe.filter((r) => r.id !== escludiId) : l.righe) as unknown as Record<string, unknown>[],
    adessoHHmm: l.ora.toFormat("HH:mm"),
    durataNuova: l.durataNuova,
    durate: l.durate,
  });
}

/** Un piccolo cronometro per l'intestazione `Server-Timing` (vedi gli
 *  strumenti del browser, scheda Rete): dice quanto ha aspettato il database. */
export function cronometro() {
  const t0 = performance.now();
  const tappe: string[] = [];
  let prima = t0;
  return {
    tappa(nome: string) {
      const adesso = performance.now();
      tappe.push(`${nome};dur=${(adesso - prima).toFixed(1)}`);
      prima = adesso;
    },
    intestazione(): string {
      return [...tappe, `totale;dur=${(performance.now() - t0).toFixed(1)}`].join(", ");
    },
  };
}
