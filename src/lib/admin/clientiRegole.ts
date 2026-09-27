/**
 * I CLIENTI — le regole, pure, senza database.
 *
 * Stesso principio di `sedeRegole.ts` e `salaRegole.ts`: questo file NON
 * IMPORTA NIENTE. Cosi' i test girano sulla funzione vera.
 *
 * ⚠️ PERCHE' ESISTE. Fino al 16/09/2026 questa aggregazione era scritta DUE
 * VOLTE — in `caricaClienti.ts` (la prima pittura sul server) e in
 * `api/admin/clients.ts` (quello che il browser ricarica un attimo dopo) —
 * con in cima un commento che diceva «copia FEDELE: se cambi l'aggregazione
 * li', aggiornala anche qui». Novantasette righe da tenere allineate a mano,
 * dichiarate come se fossero un piano.
 *
 * Non erano allineate: le due meta' leggevano con ambiti DIVERSI, una il
 * gruppo e una la sede selezionata. La pagina si disegnava con i totali del
 * gruppo e mezzo secondo dopo si riscriveva con quelli di un punto. Nessun
 * errore: solo due verita' sulla stessa persona, e nessun modo di sapere
 * quale fosse quella buona.
 *
 * ⚠️ E IL CLIENTE E' DEL MARCHIO. `clients` e' classificata cosi', e non e'
 * un dettaglio tecnico: bloccato a Schaerbeek e' bloccato ovunque, la
 * newsletter e' una sola, un buono comprato qui si spende la'. La sua storia
 * di spesa e di visite deve essere INTERA. Filtrando per sede, Stockel
 * vedrebbe un cliente da 40 € che nel gruppo ne ha spesi 300, e lo
 * tratterebbe di conseguenza. Chi vuole «solo il mio punto» ha le
 * Statistiche, che sono per sede apposta.
 */

export interface RigaOrdine {
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total_cents: number;
  created_at: string;
}

export interface RigaResa {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string | null;
}

export interface RigaCliente {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  hidden: boolean;
  photo_url?: string | null;
  blocked?: boolean | null;
  created_at?: string | null;
  lang?: string | null;
}

export interface Cliente {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  orders: number;
  reservations: number;
  noshows: number;
  total_cents: number;
  last_order: string | null;
  first_activity: string | null;
  manual: boolean;
  photo_url?: string | null;
  blocked?: boolean;
  newsletter_optout?: boolean;
  lang?: string | null;
  key?: string;
}

/**
 * L'IDENTITA' DI UNA PERSONA, in tre livelli: email, poi telefono, poi nome.
 *
 * ⚠️ E' quello che fonde in una scheda sola la stessa persona che ha ordinato
 * a Schaerbeek e prenotato a Stockel — cioe' l'unica ragione per cui «il
 * cliente e' del marchio» vuol dire qualcosa nella pratica. Senza, sarebbero
 * tre schede con tre storie parziali.
 *
 * L'email si minuscolizza, il telefono no: e' gia' normalizzato altrove, e
 * toccarlo qui vorrebbe dire due normalizzazioni diverse dello stesso dato.
 */
export function chiaveCliente(email: string, phone: string, name: string): string {
  return email.toLowerCase() || phone || name.toLowerCase();
}

/**
 * Dalle righe grezze alla lista clienti. Pura: riceve tutto, non legge
 * niente, e non sa nemmeno che le sedi esistono — le righe le arrivano gia'
 * lette sull'aggregato, che e' l'ambito giusto per una tabella di marchio.
 *
 * `optout` sono le email che hanno disdetto la newsletter (minuscole).
 */
export function uniscoClienti(dati: {
  ordini: RigaOrdine[];
  rese: RigaResa[];
  manuali: RigaCliente[];
  optout?: Iterable<string>;
}): Cliente[] {
  const { ordini, rese, manuali } = dati;
  const mappa = new Map<string, Cliente>();

  // 0) Chiavi dei clienti nascosti ("cancellati" dall'admin): vanno esclusi
  //    sia come record manuali sia come aggregato degli ordini.
  const nascosti = new Set<string>();
  for (const m of manuali) {
    if (!m.hidden) continue;
    const k = chiaveCliente((m.email ?? "").trim(), (m.phone ?? "").trim(), (m.name ?? "").trim());
    if (k) nascosti.add(k);
  }

  // 1) Aggregazione dagli ordini (ordine cronologico → l'ultimo vince sui dati).
  for (const o of ordini) {
    const email = (o.customer_email ?? "").trim();
    const phone = (o.customer_phone ?? "").trim();
    const name = (o.customer_name ?? "").trim();
    const key = chiaveCliente(email, phone, name);
    if (!key || nascosti.has(key)) continue;

    let c = mappa.get(key);
    if (!c) {
      c = { id: null, name, email, phone, orders: 0, reservations: 0, noshows: 0, total_cents: 0, last_order: o.created_at, first_activity: o.created_at, manual: false };
      mappa.set(key, c);
    }
    c.orders += 1;
    c.total_cents += o.total_cents;
    if (o.created_at >= (c.last_order ?? "")) c.last_order = o.created_at;
    if (!c.first_activity || o.created_at < c.first_activity) c.first_activity = o.created_at;
    if (name) c.name = name;
    if (phone) c.phone = phone;
    if (email) c.email = email;
  }

  // 1b) Prenotazioni: conteggio per cliente (e creazione se ha SOLO prenotato).
  for (const r of rese) {
    const email = (r.email ?? "").trim();
    const phone = (r.phone ?? "").trim();
    const name = `${(r.first_name ?? "").trim()} ${(r.last_name ?? "").trim()}`.trim();
    const key = chiaveCliente(email, phone, name);
    if (!key || nascosti.has(key)) continue;

    let c = mappa.get(key);
    if (!c) {
      c = { id: null, name, email, phone, orders: 0, reservations: 0, noshows: 0, total_cents: 0, last_order: null, first_activity: null, manual: false };
      mappa.set(key, c);
    }
    // Annullata: il cliente resta in lista ma non conta come résa
    if (r.status !== "cancelled") c.reservations += 1;
    if (r.status === "noshow") c.noshows += 1;
    if (r.created_at && (!c.first_activity || r.created_at < c.first_activity)) c.first_activity = r.created_at;
    if (name && !c.name) c.name = name;
    if (phone && !c.phone) c.phone = phone;
    if (email && !c.email) c.email = email;
  }

  // 2) Fusione dei clienti manuali (aggiungono contatti o completano i dati).
  for (const m of manuali) {
    if (m.hidden) continue;
    const email = (m.email ?? "").trim();
    const phone = (m.phone ?? "").trim();
    const name = (m.name ?? "").trim();
    const key = chiaveCliente(email, phone, name);
    if (!key) continue;

    const esistente = mappa.get(key);
    if (esistente) {
      esistente.id = m.id;
      esistente.manual = true;
      if (m.photo_url) esistente.photo_url = m.photo_url;
      if (m.blocked) esistente.blocked = true;
      if (m.created_at && (!esistente.first_activity || m.created_at < esistente.first_activity))
        esistente.first_activity = m.created_at;
      // Il record `clients` è il dato CURATO (modale admin): prevale
      // sull'aggregazione da ordini/prenotazioni (prima riempiva solo i
      // buchi → modificare il cognome dal modale non si vedeva mai).
      if (name) esistente.name = name;
      if (email) esistente.email = email;
      if (phone) esistente.phone = phone;
      if (m.lang) esistente.lang = m.lang;
    } else {
      mappa.set(key, {
        id: m.id, name, email, phone, orders: 0, reservations: 0, noshows: 0, total_cents: 0, last_order: null, first_activity: m.created_at ?? null, manual: true, photo_url: m.photo_url ?? null, blocked: Boolean(m.blocked), lang: m.lang ?? null,
      });
    }
  }

  // Newsletter: chi prenota/ordina/è aggiunto a mano è OPT-IN per default;
  // opt-out = presenza in newsletter_optout (stessa fonte del link email).
  const setOptout = new Set([...(dati.optout ?? [])].map((e) => String(e ?? "").toLowerCase()));
  if (setOptout.size > 0) {
    for (const c of mappa.values()) {
      if (c.email && setOptout.has(c.email.toLowerCase())) c.newsletter_optout = true;
    }
  }

  return [...mappa.entries()]
    .map(([k, c]) => ({ ...c, key: k }))
    .sort((a, b) => b.total_cents - a.total_cents);
}
