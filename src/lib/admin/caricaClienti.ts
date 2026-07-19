import { supabaseAdmin } from "../db";

// Pre-carica lato server (SSR, Fase 2) la lista clienti della pagina
// /admin/clients: UNIONE degli ordini reali (paid/done, aggregati per email)
// con le prenotazioni e i clienti manuali (tabella `clients`).
//
// ⚠️ Copia FEDELE della logica del ramo "lista" di GET /api/admin/clients.
//    Se cambi l'aggregazione lì, aggiornala anche qui (e viceversa).
//    L'endpoint resta la fonte per il dettaglio attività, POST e DELETE.

interface RigaOrdine {
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total_cents: number;
  created_at: string;
}

interface RigaCliente {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  hidden: boolean;
}

interface RigaResa {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  created_at: string | null;
}

interface Cliente {
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
  key?: string;
}

function chiave(email: string, phone: string, name: string): string {
  return email.toLowerCase() || phone || name.toLowerCase();
}

async function ordiniIncassati(): Promise<RigaOrdine[] | null> {
  const PAGINA = 1000;
  const tutti: RigaOrdine[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("customer_name, customer_email, customer_phone, total_cents, created_at")
      .in("status", ["paid", "done"])
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    if (error) return null;
    tutti.push(...((data ?? []) as RigaOrdine[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

async function prenotazioniAttive(): Promise<RigaResa[]> {
  const PAGINA = 1000;
  const tutti: RigaResa[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("reservations")
      .select("first_name, last_name, email, phone, status, created_at")
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    if (error) return tutti; // migrazione non ancora lanciata: nessun blocco
    tutti.push(...((data ?? []) as RigaResa[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

async function clientiManuali(): Promise<RigaCliente[] | null> {
  const PAGINA = 1000;
  const tutti: RigaCliente[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, email, phone, hidden")
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    if (error) return null;
    tutti.push(...((data ?? []) as RigaCliente[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

export async function caricaClienti(): Promise<{ count: number; clients: Cliente[] } | { error: string }> {
  const [ordini, manuali, rese] = await Promise.all([
    ordiniIncassati(),
    clientiManuali(),
    prenotazioniAttive(),
  ]);
  if (ordini === null || manuali === null) return { error: "Lecture impossible" };

  const mappa = new Map<string, Cliente>();

  // 0) Chiavi dei clienti nascosti ("cancellati" dall'admin).
  const nascosti = new Set<string>();
  for (const m of manuali) {
    if (!m.hidden) continue;
    const k = chiave((m.email ?? "").trim(), (m.phone ?? "").trim(), (m.name ?? "").trim());
    if (k) nascosti.add(k);
  }

  // 1) Aggregazione dagli ordini (cronologico → l'ultimo vince sui dati).
  for (const o of ordini) {
    const email = (o.customer_email ?? "").trim();
    const phone = (o.customer_phone ?? "").trim();
    const name = (o.customer_name ?? "").trim();
    const key = chiave(email, phone, name);
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
    const key = chiave(email, phone, name);
    if (!key || nascosti.has(key)) continue;

    let c = mappa.get(key);
    if (!c) {
      c = { id: null, name, email, phone, orders: 0, reservations: 0, noshows: 0, total_cents: 0, last_order: null, first_activity: null, manual: false };
      mappa.set(key, c);
    }
    if (r.status !== "cancelled") c.reservations += 1;
    if (r.status === "noshow") c.noshows += 1;
    if (r.created_at && (!c.first_activity || r.created_at < c.first_activity)) c.first_activity = r.created_at;
    if (name && !c.name) c.name = name;
    if (phone && !c.phone) c.phone = phone;
    if (email && !c.email) c.email = email;
  }

  // 2) Fusione dei clienti manuali.
  for (const m of manuali) {
    if (m.hidden) continue;
    const email = (m.email ?? "").trim();
    const phone = (m.phone ?? "").trim();
    const name = (m.name ?? "").trim();
    const key = chiave(email, phone, name);
    if (!key) continue;

    const esistente = mappa.get(key);
    if (esistente) {
      esistente.id = m.id;
      esistente.manual = true;
      if (!esistente.name && name) esistente.name = name;
      if (!esistente.email && email) esistente.email = email;
      if (!esistente.phone && phone) esistente.phone = phone;
    } else {
      mappa.set(key, {
        id: m.id, name, email, phone, orders: 0, reservations: 0, noshows: 0, total_cents: 0, last_order: null, first_activity: null, manual: true,
      });
    }
  }

  const clienti = [...mappa.entries()]
    .map(([k, c]) => ({ ...c, key: k }))
    .sort((a, b) => b.total_cents - a.total_cents);
  return { count: clienti.length, clients: clienti };
}
