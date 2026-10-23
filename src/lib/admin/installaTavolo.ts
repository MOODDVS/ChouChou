/**
 * INSTALLARE DEI CLIENTI DAL PALMARE — la parte che parla col database.
 * (23/10/2026; le regole pure in `lib/salaInstallaRegole.ts`.)
 *
 * Il cameriere tocca un tavolo libero, dice quanti sono, sceglie fra le
 * proposte: nasce una prenotazione GIA' SEDUTA (`seated`, `source: walkin`)
 * con i tavoli scelti. Da quel momento quei tavoli sono presi per tutti: per
 * il piano di Réservations, per l'assegnazione automatica delle prenotazioni
 * e per il QR — chi inquadra il QR di uno di quei tavoli entra nella stessa
 * sessione (`/api/table-session` la ritrova da `tables`).
 */
import { DateTime } from "luxon";
import { leggi, inserisci, aggiorna, leggiConfig, type Ambito } from "./sede";
import { tavoloDellaRiga, tavoliDelleRiga } from "./schedaTavoloRegole";
import { fusoDi } from "../fuso";
import { servizioInCorso } from "../ordiniRegole";
import { configSala } from "../schedule";
import { durateDelServizio } from "../pianoSalaRegole";
import { catenaDiZona, tavoliNonDisponibili, type TavoloPosti, type ZonaSala } from "../salaInstallaRegole";

export interface ContestoInstallazione {
  zona: string;
  tavoli: TavoloPosti[];
  catene: string[][];
  occupati: string[];
  prenotati: string[];
}

interface Lettura {
  zona: string;
  tavoli: TavoloPosti[];
  catene: string[][];
  occupati: Set<string>;
  prenotati: Set<string>;
  ora: DateTime;
  servizio: string | null;
}

/**
 * Chi e' preso adesso, in tutto il punto: seduti (`occupati`) e in arrivo
 * (`prenotati`). `escludiId` = una prenotazione da non contare — la tavolata
 * che si sposta: i suoi tavoli si liberano nel momento stesso in cui si muove.
 */
async function occupazione(ambito: Ambito, escludiId?: string) {
  const fuso = await fusoDi(ambito);
  const ora = DateTime.now().setZone(fuso);
  const [{ valori }, { data: resaRaw }, cfg] = await Promise.all([
    leggiConfig(ambito, ["reservation_plan_links", "reservation_hold_minutes", "reservation_services"]),
    leggi("reservations", ambito, "id, heure, status, tables, service_key, extra_minutes, tab_status")
      .eq("date", ora.toFormat("yyyy-MM-dd"))
      .in("status", ["pending", "confirmed", "seated"]),
    configSala(DateTime.now(), ambito).catch(() => null),
  ]);
  const durate = durateDelServizio(valori.get("reservation_services"), valori.get("reservation_hold_minutes"));
  const servizio = cfg ? servizioInCorso(cfg, ora.toFormat("HH:mm")) : null;
  const righe = ((resaRaw ?? []) as unknown as Record<string, unknown>[])
    .filter((r) => !escludiId || String(r.id ?? "") !== escludiId);
  const { occupati, prenotati } = tavoliNonDisponibili({
    righe,
    adessoHHmm: ora.toFormat("HH:mm"),
    durataNuova: (servizio ? durate.perServizio[servizio] : undefined) ?? durate.ripiego,
    durate,
  });
  return { ora, servizio, occupati, prenotati, legami: valori.get("reservation_plan_links") };
}

const comeTavolo = (t: { id: string; name: string; seats: number }): TavoloPosti =>
  ({ id: String(t.id), name: String(t.name ?? ""), seats: Math.max(0, Math.floor(Number(t.seats)) || 0) });

/** Tutto quello che serve, letto una volta: per la pagina e per l'API. */
async function leggiSala(ambito: Ambito, tavoloId: string, escludiId?: string): Promise<Lettura | null> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return null;
  const { data: tRaw } = await leggi("restaurant_tables", ambito, "id, zone").eq("id", tavoloId).maybeSingle();
  const zona = String((tRaw as { zone?: string } | null)?.zone ?? "").trim();
  if (!zona) return null;
  const [{ data: tavRaw }, occ] = await Promise.all([
    leggi("restaurant_tables", ambito, "id, name, seats").eq("zone", zona),
    occupazione(ambito, escludiId),
  ]);
  return {
    zona,
    tavoli: ((tavRaw ?? []) as unknown as { id: string; name: string; seats: number }[]).map(comeTavolo),
    catene: catenaDiZona(occ.legami, zona),
    occupati: occ.occupati,
    prenotati: occ.prenotati,
    ora: occ.ora,
    servizio: occ.servizio,
  };
}

/** Per la pagina: la sala del tavolo, le catene e chi e' preso adesso. */
export async function contestoInstallazione(ambito: Ambito, tavoloId: string): Promise<ContestoInstallazione | null> {
  const l = await leggiSala(ambito, tavoloId);
  if (!l) return null;
  return { zona: l.zona, tavoli: l.tavoli, catene: l.catene, occupati: [...l.occupati], prenotati: [...l.prenotati] };
}

export type EsitoInstallazione =
  | { ok: true; id: string }
  | { ok: false; errore: "tavoli" | "occupato" | "salvataggio" };

/**
 * Installa `persone` ai tavoli `ids`.
 *
 * ⚠️ Si RICONTROLLA tutto qui, non ci si fida della pagina: fra quando il
 * cameriere ha visto le proposte e quando tocca «Installer» un collega puo'
 * aver seduto qualcuno allo stesso tavolo. Un tavolo seduto → «occupato», e
 * la pagina si ricarica con la sala com'e' adesso.
 * ⚠️ Un tavolo PRENOTATO fra poco invece si puo' scegliere: e' il cameriere
 * che decide (un caffe' al banco di dieci minuti), la pagina l'ha avvisato.
 * ⚠️ Tutti i tavoli della stessa section: e' la regola delle catene.
 */
export async function installaClienti(ambito: Ambito, idsGrezzi: unknown, personeGrezze: unknown): Promise<EsitoInstallazione> {
  const ids = [...new Set((Array.isArray(idsGrezzi) ? idsGrezzi : []).map(String))].slice(0, 16);
  const persone = Math.floor(Number(personeGrezze));
  if (!ids.length || !Number.isFinite(persone) || persone < 1 || persone > 100) return { ok: false, errore: "tavoli" };
  const l = await leggiSala(ambito, ids[0]);
  if (!l) return { ok: false, errore: "tavoli" };
  const della = new Set(l.tavoli.map((t) => t.id));
  if (ids.some((id) => !della.has(id))) return { ok: false, errore: "tavoli" };
  if (ids.some((id) => l.occupati.has(id))) return { ok: false, errore: "occupato" };

  /* Come la sessione del QR (`/api/table-session`): `last_name`, `phone` ed
     `email` sono `not null` e qui non si chiedono — stringa vuota. «Walk-in»
     come il nome che l'admin da' a chi entra senza prenotare. */
  const riga = {
    date: l.ora.toFormat("yyyy-MM-dd"),
    heure: l.ora.toFormat("HH:mm"),
    service_key: l.servizio,
    people: persone,
    zone: l.zona,
    first_name: "Walk-in",
    last_name: "",
    phone: "",
    email: "",
    lang: "fr",
    status: "seated",
    seated_at: l.ora.toISO(),
    tables: ids,
  };
  let ins = await inserisci("reservations", ambito, { ...riga, source: "walkin" }).select("id").single();
  // Senza la #21 la colonna `source` non c'e': si salva senza, come l'admin.
  if (ins.error && String(ins.error.message ?? "").includes("source")) {
    ins = await inserisci("reservations", ambito, riga).select("id").single();
  }
  if (ins.error || !ins.data) {
    console.error("[palmare] installazione fallita:", ins.error);
    return { ok: false, errore: "salvataggio" };
  }
  return { ok: true, id: String((ins.data as { id?: unknown }).id ?? "") };
}

export type EsitoAnnullamento = { ok: true } | { ok: false; errore: "nessuno" | "ordini" | "salvataggio" };

/**
 * ANNULLARE UN'INSTALLAZIONE (23/10/2026): i clienti si sono seduti, non
 * hanno ordinato niente, e se ne vanno. La sessione si annulla e i suoi
 * tavoli tornano liberi per tutti (piantina, proposte, prenotazioni, QR).
 *
 * ⚠️ Solo SENZA ORDINI e SENZA CONTO, e si ricontrolla qui: fra la pagina e
 * il tocco qualcuno puo' aver ordinato col QR. Con un ordine non e' piu' un
 * «se ne sono andati»: c'e' da incassare o da annullare l'ordine, ed e'
 * un'altra decisione (Commandes).
 */
export async function annullaInstallazione(ambito: Ambito, tavoloId: string): Promise<EsitoAnnullamento> {
  const seduta = await sedutaDelTavolo(ambito, tavoloId);
  if (!seduta) return { ok: false, errore: "nessuno" };
  if (seduta.tab_status === "pending" || seduta.tab_status === "open") return { ok: false, errore: "ordini" };
  const { count } = await leggi("orders", ambito, "id", { count: "exact", head: true })
    .eq("reservation_id", seduta.id)
    .neq("status", "cancelled");
  if ((count ?? 0) > 0) return { ok: false, errore: "ordini" };
  const upd = await aggiorna("reservations", ambito, { status: "cancelled" })
    .eq("id", seduta.id)
    .eq("status", "seated");
  return upd.error ? { ok: false, errore: "salvataggio" } : { ok: true };
}

/* =====================================================================
 * LA TAVOLATA GIA' SEDUTA, dal modale dell'isola (23/10/2026): quante
 * persone sono, e SPOSTARLA (cambiare tavolo, aggiungerne, liberarne).
 * Le regole delle proposte in `lib/salaInstallaRegole.ts`.
 * ===================================================================== */

interface Seduta {
  id: string;
  tables: unknown;
  tab_table_id: string | null;
  tab_status: string | null;
  seated_at: string | null;
  people: number | null;
}

/** La sessione seduta OGGI su questo tavolo (la piu' recente), o null. */
async function sedutaDelTavolo(ambito: Ambito, tavoloId: string): Promise<Seduta | null> {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return null;
  const ora = DateTime.now().setZone(await fusoDi(ambito));
  const { data } = await leggi("reservations", ambito, "id, tables, tab_table_id, tab_status, seated_at, people")
    .eq("date", ora.toFormat("yyyy-MM-dd"))
    .eq("status", "seated");
  return ((data ?? []) as unknown as Seduta[])
    .filter((r) => tavoloDellaRiga(r, tavoloId))
    .sort((a, b) => String(b.seated_at ?? "").localeCompare(String(a.seated_at ?? "")))[0] ?? null;
}

/** I tavoli della tavolata: quelli di `tables`, piu' quello del conto. */
function tavoliDellaSeduta(s: Seduta): string[] {
  return [...new Set([...tavoliDelleRiga(s.tables), ...(s.tab_table_id ? [s.tab_table_id] : [])])];
}

export interface ContestoSpostamento {
  /** Le sale, quella della tavolata per prima. */
  zone: ZonaSala[];
  /** Presi da ALTRI (la tavolata stessa non conta: si sta spostando). */
  occupati: string[];
  prenotati: string[];
  /** I tavoli della tavolata adesso. */
  attuali: string[];
  zona: string;
}

/** Per il modale: tutte le sale, e chi e' preso adesso tranne questa tavolata. */
export async function contestoSpostamento(ambito: Ambito, tavoloId: string): Promise<ContestoSpostamento | null> {
  const seduta = await sedutaDelTavolo(ambito, tavoloId);
  if (!seduta) return null;
  const [{ data: tavRaw }, occ] = await Promise.all([
    leggi("restaurant_tables", ambito, "id, name, seats, zone"),
    occupazione(ambito, seduta.id),
  ]);
  const tutti = (tavRaw ?? []) as unknown as { id: string; name: string; seats: number; zone: string | null }[];
  const attuali = tavoliDellaSeduta(seduta);
  const zona = String(tutti.find((t) => attuali.includes(String(t.id)))?.zone ?? "").trim();
  const nomiZone = [...new Set(tutti.map((t) => String(t.zone ?? "").trim()).filter(Boolean))]
    .sort((a, b) => (a === zona ? -1 : b === zona ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  return {
    zone: nomiZone.map((z) => ({
      zona: z,
      tavoli: tutti.filter((t) => String(t.zone ?? "").trim() === z).map(comeTavolo),
      catene: catenaDiZona(occ.legami, z),
    })),
    occupati: [...occ.occupati],
    prenotati: [...occ.prenotati],
    attuali,
    zona,
  };
}

export type EsitoSpostamento =
  | { ok: true }
  | { ok: false; errore: "nessuno" | "tavoli" | "occupato" | "salvataggio" };

/**
 * SPOSTARE la tavolata seduta a `tavoloId` sui tavoli `ids` — vale per i tre
 * casi (cambiare, aggiungere, liberare): e' sempre «adesso siete qui».
 *
 * Tutto segue, perche' tutto sta sulla STESSA riga di `reservations`: ordini,
 * conto aperto, invii, timer. Il QR dei nuovi tavoli ritrova la sessione
 * (`tables`), la piantina li colora, le prenotazioni non li assegnano piu'.
 *
 * ⚠️ Si ricontrolla qui: i tavoli nuovi devono essere della stessa sala fra
 * loro e non presi da ALTRI seduti (la tavolata stessa non conta).
 * ⚠️ Il conto aperto: `tab_table_id` (il tavolo da cui e' partito, quello che
 * il QR cerca) passa al primo dei nuovi se il suo tavolo e' stato lasciato.
 * ⚠️ La cucina: gli ordini non ancora chiusi prendono il nuovo cartellino
 * («E2»), cosi' Commandes sa dove portare i piatti. Un ticket GIA' STAMPATO
 * resta col vecchio numero (il ticket «T1 → E2» e' ancora da decidere).
 */
export async function spostaTavoli(ambito: Ambito, tavoloId: string, idsGrezzi: unknown): Promise<EsitoSpostamento> {
  const ids = [...new Set((Array.isArray(idsGrezzi) ? idsGrezzi : []).map(String))].slice(0, 16);
  if (!ids.length || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return { ok: false, errore: "tavoli" };
  const seduta = await sedutaDelTavolo(ambito, tavoloId);
  if (!seduta) return { ok: false, errore: "nessuno" };
  const l = await leggiSala(ambito, ids[0], seduta.id);
  if (!l) return { ok: false, errore: "tavoli" };
  const della = new Map(l.tavoli.map((t) => [t.id, t]));
  if (ids.some((id) => !della.has(id))) return { ok: false, errore: "tavoli" };
  if (ids.some((id) => l.occupati.has(id))) return { ok: false, errore: "occupato" };

  const prima = tavoliDellaSeduta(seduta);
  if ([...prima].sort().join("|") === [...ids].sort().join("|")) return { ok: true };
  const campi: Record<string, unknown> = { tables: ids, zone: l.zona };
  if (seduta.tab_table_id && !ids.includes(seduta.tab_table_id)) campi.tab_table_id = ids[0];
  const upd = await aggiorna("reservations", ambito, campi).eq("id", seduta.id).eq("status", "seated");
  if (upd.error) {
    console.error("[palmare] spostamento fallito:", upd.error);
    return { ok: false, errore: "salvataggio" };
  }

  // Il nuovo cartellino sugli ordini ancora in corso («T1 + T2» → «E2»).
  const etichetta = ids.map((id) => della.get(id)?.name ?? "").filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .join(" + ");
  const lab = await aggiorna("orders", ambito, { table_label: etichetta })
    .eq("reservation_id", seduta.id)
    .in("status", ["pending", "paid"]);
  if (lab.error) console.error("[palmare] cartellino degli ordini non aggiornato:", lab.error);
  // Il tavolo dell'ordine, solo se e' stato lasciato.
  const via = prima.filter((id) => !ids.includes(id));
  if (via.length) {
    const tid = await aggiorna("orders", ambito, { table_id: ids[0] })
      .eq("reservation_id", seduta.id)
      .in("status", ["pending", "paid"])
      .in("table_id", via);
    if (tid.error) console.error("[palmare] tavolo degli ordini non aggiornato:", tid.error);
  }
  return { ok: true };
}

export type EsitoPersone = { ok: true } | { ok: false; errore: "nessuno" | "numero" | "salvataggio" };

/**
 * QUANTE PERSONE (dal modale): arriva un amico, uno se ne va.
 * ⚠️ Con un conto aperto cambia anche `tab_people`: e' il numero su cui si
 * conta «chi ha ordinato» (3 su 4) e si divide l'addizione.
 */
export async function cambiaPersone(ambito: Ambito, tavoloId: string, personeGrezze: unknown): Promise<EsitoPersone> {
  const persone = Math.floor(Number(personeGrezze));
  if (!Number.isFinite(persone) || persone < 1 || persone > 100) return { ok: false, errore: "numero" };
  const seduta = await sedutaDelTavolo(ambito, tavoloId);
  if (!seduta) return { ok: false, errore: "nessuno" };
  const campi: Record<string, unknown> = { people: persone };
  if (seduta.tab_status) campi.tab_people = persone;
  const upd = await aggiorna("reservations", ambito, campi).eq("id", seduta.id).eq("status", "seated");
  return upd.error ? { ok: false, errore: "salvataggio" } : { ok: true };
}
