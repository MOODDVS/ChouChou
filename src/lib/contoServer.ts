/**
 * IL CONTO APERTO AL TAVOLO — le letture e le scritture (disegno: progetto,
 * conto-aperto.md). Le regole pure stanno in `contoRegole.ts`.
 *
 * ⚠️ IL CONTO E' LA SESSIONE DEL TAVOLO CHE ESISTE GIA' (la prenotazione
 * `seated` del QR, #82/#87): qui si legge e si scrive solo quella, con le sue
 * colonne `tab_*`, e gli invii (`table_rounds`).
 *
 * ⚠️ IL CODICE E' L'AUTORIZZAZIONE. Ogni azione su un conto (vederlo,
 * aggiungere, togliere) porta il codice a 2 cifre, e il server lo ricontrolla
 * contando i tentativi sbagliati: un `reservation_id` arrivato dal browser da
 * solo non apre niente.
 */
import { leggi, inserisci, aggiorna, leggiConfig, type Ambito } from "./admin/sede";
import { accodaTicket, ordiniDiInvio } from "./stampaCoda";
import {
  codiceBloccato, codiceLetto, dopoTentativo, finestraInvio, invioDaUsare, nuovoCodice,
  ordineTogliibile, tavoliUnitiDa, type InvioEsistente,
} from "./contoRegole";

export interface ContoRiga {
  id: string;
  date: string;
  status: string;
  tables: string[] | null;
  first_name: string;
  people: number;
  tab_status: string | null;
  tab_code: string | null;
  tab_table_id: string | null;
  tab_people: number | null;
  tab_validated_at: string | null;
  tab_fails: number;
  tab_fails_at: string | null;
}

const CAMPI_CONTO =
  "id, date, status, tables, first_name, people, tab_status, tab_code, tab_table_id, tab_people, tab_validated_at, tab_fails, tab_fails_at";

/** I tavoli uniti a questo nel piano sala, lui compreso. */
export async function tavoliUniti(ambito: Ambito, tavoloId: string): Promise<string[]> {
  try {
    const { valori } = await leggiConfig(ambito, ["reservation_plan_links"]);
    return tavoliUnitiDa(valori.get("reservation_plan_links") ?? "", tavoloId);
  } catch {
    return [tavoloId];
  }
}

/** Il conto aperto (o da validare) raggiungibile da questo tavolo, oggi.
 *  `null` = nessuno. ⚠️ Lettura fallita (la #87 non lanciata) → `null`: la
 *  pagina si comporta come prima del conto aperto. */
export async function contoDelTavolo(ambito: Ambito, tavoloId: string, oggi: string): Promise<ContoRiga | null> {
  const ids = await tavoliUniti(ambito, tavoloId);
  const { data, error } = await leggi("reservations", ambito, CAMPI_CONTO)
    .eq("date", oggi)
    .eq("status", "seated")
    .in("tab_status", ["pending", "open"])
    .in("tab_table_id", ids);
  if (error) {
    console.error("[conto] lettura del conto fallita (migrazione #87?):", error);
    return null;
  }
  const righe = (data ?? []) as unknown as ContoRiga[];
  // Il conto aperto PROPRIO su questo tavolo vince su quello di un tavolo unito.
  return righe.find((r) => r.tab_table_id === tavoloId) ?? righe[0] ?? null;
}

/** Il conto per id, se e' di oggi, seduto e ancora aperto. */
export async function contoPerId(ambito: Ambito, id: string, oggi: string): Promise<ContoRiga | null> {
  const { data } = await leggi("reservations", ambito, CAMPI_CONTO).eq("id", id).maybeSingle();
  const r = data as unknown as ContoRiga | null;
  if (!r || r.date !== oggi || r.status !== "seated") return null;
  if (r.tab_status !== "pending" && r.tab_status !== "open") return null;
  return r;
}

export type EsitoCodice = "ok" | "sbagliato" | "bloccato" | "illeggibile";

/**
 * Il codice e' giusto? Conta i tentativi sbagliati sul conto stesso (#87):
 * dopo 5 di fila ci si blocca per 10 minuti (`contoRegole`).
 * ⚠️ Un codice illeggibile («ab») non conta: un dito scivolato non deve
 * avvicinare il blocco.
 */
export async function verificaCodice(ambito: Ambito, conto: ContoRiga, codice: unknown, adesso: Date): Promise<EsitoCodice> {
  if (codiceBloccato(conto.tab_fails ?? 0, conto.tab_fails_at, adesso)) return "bloccato";
  const c = codiceLetto(codice);
  if (!c) return "illeggibile";
  const giusto = c === conto.tab_code;
  if (!giusto || (conto.tab_fails ?? 0) !== 0) {
    const dopo = dopoTentativo(giusto, conto.tab_fails ?? 0, conto.tab_fails_at, adesso);
    await aggiorna("reservations", ambito, {
      tab_fails: dopo.sbagliati,
      tab_fails_at: dopo.ultimoSbaglio ? dopo.ultimoSbaglio.toISOString() : null,
    }).eq("id", conto.id);
  }
  return giusto ? "ok" : "sbagliato";
}

/** Postgres: violazione di un indice unico. */
function eDoppione(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null;
  return x?.code === "23505" || String(x?.message ?? "").includes("duplicate key");
}

/**
 * APRIRE UN CONTO sul tavolo.
 *
 * - C'e' gia' un conto (da questo tavolo o da uno unito) → `{ gia }`.
 * - Il tavolo ha gia' una sessione senza conto (qualcuno ha ordinato e pagato
 *   prima) → il conto si apre SU QUELLA: e' lo stesso tavolo, gli stessi
 *   coperti.
 * - Se no, una sessione nuova, come `/api/table-session`.
 *
 * ⚠️ DUE PERSONE NELLO STESSO SECONDO: decide l'indice unico della #87
 * (un solo conto aperto per tavolo). Chi arriva secondo riceve `{ gia }` e si
 * unisce col codice — mai due conti sullo stesso tavolo.
 */
export async function apriConto(
  ambito: Ambito,
  dati: {
    tavolo: { id: string; name: string; zone: string };
    persone: number;
    nome: string;
    email: string;
    lang: string;
    servizio: string;
    oggi: string;
    heure: string;
    adessoIso: string;
  },
): Promise<{ conto: ContoRiga } | { gia: ContoRiga } | { errore: string }> {
  const gia = await contoDelTavolo(ambito, dati.tavolo.id, dati.oggi);
  if (gia) return { gia };

  const campiConto = {
    tab_status: "pending",
    tab_code: nuovoCodice(),
    tab_table_id: dati.tavolo.id,
    tab_people: dati.persone,
    tab_fails: 0,
    tab_fails_at: null,
    tab_validated_at: null,
    tab_closed_at: null,
  };

  const { data: sedute } = await leggi("reservations", ambito, "id, tables, tab_status")
    .eq("date", dati.oggi)
    .eq("status", "seated");
  const sessione = ((sedute ?? []) as unknown as { id: string; tables: string[] | null; tab_status: string | null }[])
    .find((r) => Array.isArray(r.tables) && r.tables.includes(dati.tavolo.id) && r.tab_status === null);

  let id = "";
  if (sessione) {
    const upd = await aggiorna("reservations", ambito, campiConto)
      .eq("id", sessione.id)
      .is("tab_status", null)
      .select("id");
    if (upd.error) {
      if (eDoppione(upd.error)) {
        const vinto = await contoDelTavolo(ambito, dati.tavolo.id, dati.oggi);
        if (vinto) return { gia: vinto };
      }
      console.error("[conto] apertura su sessione esistente fallita:", upd.error);
      return { errore: "impossible d'ouvrir le compte" };
    }
    id = String(((upd.data ?? []) as { id?: string }[])[0]?.id ?? "");
  }
  if (!id) {
    /* ⚠️ Le stesse colonne di `/api/table-session`: `last_name`/`phone` vuoti
       (sono `not null`), `seated_at` adesso, `source: "qr"`, `tables` col
       tavolo. Qui senza ripiego sul `source`: il conto richiede la #87, e chi
       ha la #87 ha anche la #74. */
    const ins = await inserisci("reservations", ambito, {
      date: dati.oggi,
      heure: dati.heure,
      service_key: dati.servizio,
      people: dati.persone,
      zone: dati.tavolo.zone || null,
      first_name: dati.nome,
      last_name: "",
      phone: "",
      email: dati.email,
      lang: dati.lang,
      status: "seated",
      seated_at: dati.adessoIso,
      tables: [dati.tavolo.id],
      source: "qr",
      ...campiConto,
    }).select("id").single();
    if (ins.error || !ins.data) {
      if (eDoppione(ins.error)) {
        const vinto = await contoDelTavolo(ambito, dati.tavolo.id, dati.oggi);
        if (vinto) return { gia: vinto };
      }
      console.error("[conto] apertura fallita:", ins.error);
      return { errore: "impossible d'ouvrir le compte" };
    }
    id = String((ins.data as { id?: unknown }).id ?? "");
  }
  const conto = await contoPerId(ambito, id, dati.oggi);
  return conto ? { conto } : { errore: "impossible d'ouvrir le compte" };
}

/** Chi si unisce da un tavolo UNITO lo aggiunge alla sessione: il piano sala
 *  deve vedere occupato anche il 02, e l'ordine di Luca porta il suo tavolo. */
export async function aggiungiTavolo(ambito: Ambito, conto: ContoRiga, tavoloId: string): Promise<void> {
  const tavoli = Array.isArray(conto.tables) ? conto.tables : [];
  if (tavoli.includes(tavoloId)) return;
  await aggiorna("reservations", ambito, { tables: [...tavoli, tavoloId] }).eq("id", conto.id);
}

/**
 * L'INVIO a cui attaccare un ordine nuovo del conto (`invioDaUsare`), creato
 * se serve. ⚠️ Due ordini nello stesso istante possono provare a creare lo
 * stesso numero: l'unico `(reservation_id, number)` ne rifiuta uno, e quello
 * riprova rileggendo — e trova l'invio appena nato.
 */
export async function invioPerOrdine(ambito: Ambito, conto: ContoRiga, adesso: Date): Promise<string | null> {
  const { valori } = await leggiConfig(ambito, ["orders_table_batch"]).catch(() => ({ valori: new Map<string, string>() }));
  const finestra = finestraInvio(valori.get("orders_table_batch"));
  for (let giro = 0; giro < 3; giro++) {
    const { data, error } = await leggi("table_rounds", ambito, "id, number, status, release_at").eq("reservation_id", conto.id);
    if (error) {
      console.error("[conto] invii illeggibili (migrazione #87?):", error);
      return null;
    }
    const scelta = invioDaUsare(conto.tab_status, (data ?? []) as unknown as InvioEsistente[], adesso, finestra);
    if ("usa" in scelta) return scelta.usa;
    const ins = await inserisci("table_rounds", ambito, {
      reservation_id: conto.id,
      number: scelta.nuovo,
      status: "waiting",
      release_at: scelta.partenza ? scelta.partenza.toISOString() : null,
    }).select("id").single();
    if (!ins.error && ins.data) return String((ins.data as { id?: unknown }).id ?? "");
    if (!eDoppione(ins.error)) {
      console.error("[conto] creazione invio fallita:", ins.error);
      return null;
    }
  }
  return null;
}

export interface RigaAddizione {
  nome: string;
  piatti: { nome: string; qty: number; prezzo_cents: number }[];
  totale_cents: number;
  mio: boolean;
  /** Solo per i propri ordini, e solo finche' si possono togliere. */
  token?: string;
}

export interface Addizione {
  invii: { numero: number; inviato: boolean; righe: RigaAddizione[] }[];
  totale_cents: number;
  nomi: string[];
}

/** «Votre addition»: gli invii, chi ha preso cosa, il totale. `miei` = i
 *  token degli ordini fatti da QUESTO telefono (solo loro si possono togliere). */
export async function addizione(ambito: Ambito, conto: ContoRiga, miei: string[], adesso: Date): Promise<Addizione> {
  const [{ data: ordRaw }, { data: invRaw }] = await Promise.all([
    leggi("orders", ambito, "id, cancel_token, customer_name, items, total_cents, status, round_id, created_at")
      .eq("reservation_id", conto.id)
      .eq("payment_method", "tab")
      .neq("status", "cancelled")
      .order("created_at", { ascending: true }),
    leggi("table_rounds", ambito, "id, number, status, release_at").eq("reservation_id", conto.id),
  ]);
  const ordini = (ordRaw ?? []) as unknown as {
    cancel_token: string; customer_name: string; total_cents: number; round_id: string | null;
    items: { name?: string; qty?: number; price_cents?: number; id?: string }[];
  }[];
  const invii = ((invRaw ?? []) as unknown as InvioEsistente[]).sort((a, b) => a.number - b.number);
  const mieiSet = new Set(miei.map(String));
  const blocchi = invii.map((i) => ({
    numero: i.number,
    // «Partito»: rilasciato, oppure (conto validato) finestra scaduta.
    inviato: !ordineTogliibile(i, conto.tab_status, adesso),
    righe: [] as RigaAddizione[],
    id: i.id,
    invio: i,
  }));
  let totale = 0;
  const nomi: string[] = [];
  for (const o of ordini) {
    const b = blocchi.find((x) => x.id === o.round_id);
    const mio = mieiSet.has(String(o.cancel_token));
    const riga: RigaAddizione = {
      nome: String(o.customer_name ?? "").trim(),
      piatti: (Array.isArray(o.items) ? o.items : [])
        .filter((p) => (p.qty ?? 0) > 0)
        .map((p) => ({ nome: String(p.name ?? ""), qty: Number(p.qty) || 0, prezzo_cents: Number(p.price_cents) || 0 })),
      totale_cents: Number(o.total_cents) || 0,
      mio,
      ...(mio && b && ordineTogliibile(b.invio, conto.tab_status, adesso) ? { token: String(o.cancel_token) } : {}),
    };
    totale += riga.totale_cents;
    if (riga.nome) nomi.push(riga.nome);
    if (b) b.righe.push(riga);
  }
  return {
    invii: blocchi.filter((b) => b.righe.length > 0).map(({ numero, inviato, righe }) => ({ numero, inviato, righe })),
    totale_cents: totale,
    nomi,
  };
}

/** Togliere un PROPRIO ordine finche' il suo invio non e' partito. */
export async function togliOrdine(ambito: Ambito, conto: ContoRiga, token: string, adesso: Date): Promise<"ok" | "tardi" | "non_trovato"> {
  const { data } = await leggi("orders", ambito, "id, status, payment_method, round_id, reservation_id")
    .eq("cancel_token", token)
    .maybeSingle();
  const o = data as unknown as { id: string; status: string; payment_method: string; round_id: string | null; reservation_id: string } | null;
  if (!o || o.reservation_id !== conto.id || o.payment_method !== "tab" || o.status !== "pending") return "non_trovato";
  const { data: inv } = o.round_id
    ? await leggi("table_rounds", ambito, "id, status, release_at").eq("id", o.round_id).maybeSingle()
    : { data: null };
  if (!ordineTogliibile(inv as unknown as { status: string; release_at: string | null } | null, conto.tab_status, adesso)) return "tardi";
  const upd = await aggiorna("orders", ambito, { status: "cancelled" }).eq("id", o.id).eq("status", "pending");
  return upd.error ? "non_trovato" : "ok";
}

/**
 * GLI INVII CHE DEVONO PARTIRE: quelli in attesa la cui ora e' passata (fine
 * della finestra, o la validazione che ha messo `release_at` ad adesso).
 * Ognuno diventa `released` e va in coda di stampa: UN ticket per invio.
 *
 * ⚠️ NESSUN CRON: lo chiamano il tablet (Commandes, ogni 25 s), la pagina del
 * tavolo e il checkout del conto. Durante il servizio c'e' sempre qualcuno
 * che guarda; a locale chiuso non ci sono invii da far partire.
 * ⚠️ Il passaggio a `released` e' CONDIZIONATO (`status = 'waiting'`): due
 * chiamate nello stesso istante non stampano due volte lo stesso invio —
 * una sola riesce a cambiarlo, ed e' lei che stampa.
 */
export async function rilasciaInviiScaduti(ambito: Ambito, contoId?: string): Promise<number> {
  try {
    const adesso = new Date().toISOString();
    let q = leggi("table_rounds", ambito, "id, reservation_id, location_id, release_at")
      .eq("status", "waiting")
      .lte("release_at", adesso);
    if (contoId) q = q.eq("reservation_id", contoId);
    const { data, error } = await q;
    if (error) return 0;
    let partiti = 0;
    for (const r of (data ?? []) as unknown as { id: string; reservation_id: string; location_id: string | null }[]) {
      const upd = await aggiorna("table_rounds", ambito, { status: "released", released_at: adesso })
        .eq("id", r.id)
        .eq("status", "waiting")
        .select("id");
      if (upd.error || ((upd.data ?? []) as unknown[]).length === 0) continue;
      partiti++;
      const ordini = await ordiniDiInvio(ambito, r.id);
      if (ordini.length === 0) continue; // tutti tolti prima di partire: niente ticket
      void accodaTicket({ id: ordini[0].id, location_id: r.location_id }, { invio: r.id });
    }
    return partiti;
  } catch (e) {
    console.error("[conto] rilascio invii:", e);
    return 0;
  }
}
