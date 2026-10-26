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
import type { DateTime } from "luxon";
import { leggi, inserisci, aggiorna, type Ambito } from "./sede";
import { tavoloDellaRiga, tavoliDelleRiga } from "./schedaTavoloRegole";
import { catenaDiZona, conflittoEstensione, fineSeduta, oraDaMinuti, type TavoloPosti, type ZonaSala } from "../salaInstallaRegole";
import { letturaSala, occupazioneDa, type LetturaSala, type RigaGiornoSala } from "./letturaSala";

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

const comeTavolo = (t: { id: string; name: string; seats: number }): TavoloPosti =>
  ({ id: t.id, name: t.name, seats: t.seats });

/**
 * La sala di un tavolo, dai dati del giorno gia' letti (`letturaSala`):
 * nessun viaggio al database. `escludiId` = la tavolata che si sposta.
 */
function salaDi(l: LetturaSala, tavoloId: string, escludiId?: string): Lettura | null {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return null;
  const zona = l.tavoli.find((t) => t.id === tavoloId)?.zone ?? "";
  if (!zona) return null;
  const { occupati, prenotati } = occupazioneDa(l, escludiId);
  return {
    zona,
    tavoli: l.tavoli.filter((t) => t.zone === zona).map(comeTavolo),
    catene: catenaDiZona(l.legami, zona),
    occupati,
    prenotati,
    ora: l.ora,
    servizio: l.servizio,
  };
}

/** Per la pagina: la sala del tavolo, le catene e chi e' preso adesso.
 *  `lettura`: quella della pagina, se l'ha gia' fatta. */
export async function contestoInstallazione(ambito: Ambito, tavoloId: string, lettura?: LetturaSala): Promise<ContestoInstallazione | null> {
  const l = salaDi(lettura ?? await letturaSala(ambito), tavoloId);
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
  const l = salaDi(await letturaSala(ambito), ids[0]);
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
  const seduta = sedutaDelTavolo(await letturaSala(ambito), tavoloId);
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

type Seduta = RigaGiornoSala;

/** La sessione seduta OGGI su questo tavolo (la piu' recente), o null. */
function sedutaDelTavolo(l: LetturaSala, tavoloId: string): Seduta | null {
  if (!/^[0-9a-f-]{36}$/i.test(tavoloId)) return null;
  return l.righe
    .filter((r) => r.status === "seated" && tavoloDellaRiga(r, tavoloId))
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
  /** Fine prevista del tempo al tavolo («21:15»), per «+15 / +30 / +45». */
  fine: string | null;
}

/** Per il modale: tutte le sale, e chi e' preso adesso tranne questa tavolata.
 *  `lettura`: quella della pagina, se l'ha gia' fatta (nessun viaggio in piu'). */
export async function contestoSpostamento(ambito: Ambito, tavoloId: string, lettura?: LetturaSala): Promise<ContestoSpostamento | null> {
  const l = lettura ?? await letturaSala(ambito);
  const seduta = sedutaDelTavolo(l, tavoloId);
  if (!seduta) return null;
  const occ = occupazioneDa(l, seduta.id);
  const tutti = l.tavoli;
  const attuali = tavoliDellaSeduta(seduta);
  const zona = tutti.find((t) => attuali.includes(t.id))?.zone ?? "";
  const nomiZone = [...new Set(tutti.map((t) => t.zone).filter(Boolean))]
    .sort((a, b) => (a === zona ? -1 : b === zona ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  return {
    zone: nomiZone.map((z) => ({
      zona: z,
      tavoli: tutti.filter((t) => t.zone === z).map(comeTavolo),
      catene: catenaDiZona(l.legami, z),
    })),
    occupati: [...occ.occupati],
    prenotati: [...occ.prenotati],
    attuali,
    zona,
    fine: (() => { const f = fineSeduta(seduta, l.durate); return f === null ? null : oraDaMinuti(f); })(),
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
/** `personeGrezze`: le persone scelte nello STESSO modale (4 → 6 e un tavolo
 *  in piu', Enzo 26/10/2026): si salvano insieme ai tavoli. Senza, restano. */
export async function spostaTavoli(ambito: Ambito, tavoloId: string, idsGrezzi: unknown, personeGrezze?: unknown): Promise<EsitoSpostamento> {
  const ids = [...new Set((Array.isArray(idsGrezzi) ? idsGrezzi : []).map(String))].slice(0, 16);
  if (!ids.length || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return { ok: false, errore: "tavoli" };
  const lettura = await letturaSala(ambito);
  const seduta = sedutaDelTavolo(lettura, tavoloId);
  if (!seduta) return { ok: false, errore: "nessuno" };
  const l = salaDi(lettura, ids[0], seduta.id);
  if (!l) return { ok: false, errore: "tavoli" };
  const della = new Map(l.tavoli.map((t) => [t.id, t]));
  if (ids.some((id) => !della.has(id))) return { ok: false, errore: "tavoli" };
  if (ids.some((id) => l.occupati.has(id))) return { ok: false, errore: "occupato" };

  const prima = tavoliDellaSeduta(seduta);
  if ([...prima].sort().join("|") === [...ids].sort().join("|")) return { ok: true };
  const campi: Record<string, unknown> = { tables: ids, zone: l.zona };
  const persone = Math.floor(Number(personeGrezze));
  if (personeGrezze !== undefined && personeGrezze !== null && Number.isFinite(persone) && persone >= 1 && persone <= 100) {
    campi.people = persone;
    if (seduta.tab_status) campi.tab_people = persone;
  }
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
  const seduta = sedutaDelTavolo(await letturaSala(ambito), tavoloId);
  if (!seduta) return { ok: false, errore: "nessuno" };
  const campi: Record<string, unknown> = { people: persone };
  if (seduta.tab_status) campi.tab_people = persone;
  const upd = await aggiorna("reservations", ambito, campi).eq("id", seduta.id).eq("status", "seated");
  return upd.error ? { ok: false, errore: "salvataggio" } : { ok: true };
}

export type EsitoEstensione =
  | { ok: true; fine: string | null }
  | { ok: false; errore: "nessuno" | "minuti" | "salvataggio" }
  | { ok: false; errore: "conflitto"; heure: string; nome: string; tavoli: string[] };

/**
 * PIU' TEMPO AL TAVOLO (23/10/2026): +15 / +30 / +45 minuti alla sessione
 * seduta, come «Prolonger» in Réservations (stessa colonna `extra_minutes`,
 * stesso tetto di 600).
 *
 * ⚠️ Se una prenotazione sugli stessi tavoli inizia dentro i minuti aggiunti,
 * NON si allunga e si dice chi e' (`conflitto`): il cameriere conferma con un
 * secondo tocco (`forza`), come in Réservations. E' lui che sa se i clienti
 * stanno per alzarsi.
 */
export async function estendiTavolo(ambito: Ambito, tavoloId: string, minutiGrezzi: unknown, forza = false): Promise<EsitoEstensione> {
  const minuti = Math.floor(Number(minutiGrezzi));
  if (![15, 30, 45].includes(minuti)) return { ok: false, errore: "minuti" };
  const l = await letturaSala(ambito);
  const seduta = sedutaDelTavolo(l, tavoloId);
  if (!seduta) return { ok: false, errore: "nessuno" };
  if (!forza) {
    const c = conflittoEstensione({ seduta, righe: l.righe, minutiPiu: minuti, durate: l.durate });
    if (c) {
      const nomi = new Map(l.tavoli.map((t) => [t.id, t.name]));
      return { ok: false, errore: "conflitto", heure: c.heure, nome: c.nome, tavoli: c.tavoli.map((id) => nomi.get(id) ?? id) };
    }
  }
  const extra = Math.min(600, Math.max(0, Math.floor(Number(seduta.extra_minutes)) || 0) + minuti);
  const upd = await aggiorna("reservations", ambito, { extra_minutes: extra }).eq("id", seduta.id).eq("status", "seated");
  if (upd.error) return { ok: false, errore: "salvataggio" };
  const f = fineSeduta({ ...seduta, extra_minutes: extra }, l.durate);
  return { ok: true, fine: f === null ? null : oraDaMinuti(f) };
}
