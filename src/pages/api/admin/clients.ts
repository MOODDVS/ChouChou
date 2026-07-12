import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/adminAuth";

export const prerender = false;

// GET  → elenco clienti: UNIONE degli ordini reali (paid/done, aggregati
//        per email) con i clienti aggiunti a mano (tabella `clients`).
// POST → aggiunge un cliente manuale (name, email, phone).
// Chiave cliente = email (minuscolo); fallback telefono, poi nome.

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
}

interface Cliente {
  id: string | null; // id nella tabella `clients` se manuale, altrimenti null
  name: string;
  email: string;
  phone: string;
  orders: number;
  total_cents: number;
  last_order: string | null;
  manual: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function chiave(email: string, phone: string, name: string): string {
  return email.toLowerCase() || phone || name.toLowerCase();
}

/** Legge TUTTI gli ordini incassati (paid/done), a pagine di 1000. */
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

/** Legge i clienti manuali (tabella `clients`), a pagine di 1000. */
async function clientiManuali(): Promise<RigaCliente[] | null> {
  const PAGINA = 1000;
  const tutti: RigaCliente[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, email, phone")
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    if (error) return null;
    tutti.push(...((data ?? []) as RigaCliente[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const [ordini, manuali] = await Promise.all([ordiniIncassati(), clientiManuali()]);
  if (ordini === null || manuali === null) return json({ error: "Lecture impossible" }, 500);

  const mappa = new Map<string, Cliente>();

  // 1) Aggregazione dagli ordini (ordine cronologico → l'ultimo vince sui dati).
  for (const o of ordini) {
    const email = (o.customer_email ?? "").trim();
    const phone = (o.customer_phone ?? "").trim();
    const name = (o.customer_name ?? "").trim();
    const key = chiave(email, phone, name);
    if (!key) continue;

    let c = mappa.get(key);
    if (!c) {
      c = { id: null, name, email, phone, orders: 0, total_cents: 0, last_order: o.created_at, manual: false };
      mappa.set(key, c);
    }
    c.orders += 1;
    c.total_cents += o.total_cents;
    if (o.created_at >= (c.last_order ?? "")) c.last_order = o.created_at;
    if (name) c.name = name;
    if (phone) c.phone = phone;
    if (email) c.email = email;
  }

  // 2) Fusione dei clienti manuali (aggiungono contatti o completano i dati).
  for (const m of manuali) {
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
        id: m.id, name, email, phone, orders: 0, total_cents: 0, last_order: null, manual: true,
      });
    }
  }

  const clienti = [...mappa.values()].sort((a, b) => b.total_cents - a.total_cents);
  return json({ count: clienti.length, clients: clienti });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  let body: { name?: string; email?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps invalide" }, 400);
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim();

  if (!name) return json({ error: "Le nom est obligatoire" }, 400);
  if (!email && !phone) return json({ error: "Renseignez au moins un email ou un téléphone" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Email invalide" }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({ name, email: email || null, phone: phone || null })
    .select("id")
    .single();

  if (error) return json({ error: "Enregistrement impossible" }, 500);
  return json({ ok: true, id: data.id }, 201);
};

// Cancella un cliente MANUALE (record nella tabella `clients`).
// I clienti derivati dagli ordini non hanno id qui e non sono cancellabili.
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const id = url.searchParams.get("id");
  if (!id) return json({ error: "id manquant" }, 400);

  const { error } = await supabaseAdmin.from("clients").delete().eq("id", id);
  if (error) return json({ error: "Suppression impossible" }, 500);
  return json({ ok: true });
};
