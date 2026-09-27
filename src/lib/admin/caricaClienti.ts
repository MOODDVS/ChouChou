import { supabaseAdmin } from "../db";
import { leggi, tutteLeSedi, type Ambito } from "./sede";
import {
  uniscoClienti, type Cliente, type RigaOrdine, type RigaResa, type RigaCliente,
} from "./clientiRegole";

// Pre-carica lato server (SSR, Fase 2) la lista clienti della pagina
// /admin/clients: UNIONE degli ordini reali (paid/done, aggregati per email)
// con le prenotazioni e i clienti manuali (tabella `clients`).
//
// L'AGGREGAZIONE NON STA PIU' QUI: sta in `clientiRegole.ts`, che e' pura e
// provata. Questo file legge le righe, quello le unisce, e l'API fa lo
// stesso — una logica sola invece di due copie allineate a mano.

async function ordiniIncassati(ambito: Ambito): Promise<RigaOrdine[] | null> {
  const PAGINA = 1000;
  const tutti: RigaOrdine[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await leggi("orders", ambito, "customer_name, customer_email, customer_phone, total_cents, created_at")
      .in("status", ["paid", "done"])
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    if (error) return null;
    tutti.push(...((data ?? []) as RigaOrdine[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

async function prenotazioniAttive(ambito: Ambito): Promise<RigaResa[]> {
  const PAGINA = 1000;
  const tutti: RigaResa[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await leggi("reservations", ambito, "first_name, last_name, email, phone, status, created_at")
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
  let campi = "id, name, email, phone, hidden, photo_url, blocked, created_at, lang";
  for (let da = 0; ; da += PAGINA) {
    let { data, error } = await supabaseAdmin
      .from("clients")
      .select(campi)
      .order("created_at", { ascending: true })
      .range(da, da + PAGINA - 1);
    // Migrazione `lang` non lanciata: si rilegge mantenendo photo_url/blocked
    if (error && String(error.message ?? "").includes("lang")) {
      campi = "id, name, email, phone, hidden, photo_url, blocked, created_at";
      ({ data, error } = await supabaseAdmin
        .from("clients")
        .select(campi)
        .order("created_at", { ascending: true })
        .range(da, da + PAGINA - 1));
    }
    // Migrazioni #31/#32 non ancora lanciate: si rilegge senza le colonne nuove
    if (error && (String(error.message ?? "").includes("photo_url") || String(error.message ?? "").includes("blocked"))) {
      campi = "id, name, email, phone, hidden, created_at";
      ({ data, error } = await supabaseAdmin
        .from("clients")
        .select(campi)
        .order("created_at", { ascending: true })
        .range(da, da + PAGINA - 1));
    }
    if (error) return null;
    tutti.push(...((data ?? []) as unknown as RigaCliente[]));
    if (!data || data.length < PAGINA) break;
  }
  return tutti;
}

export async function caricaClienti(): Promise<{ count: number; clients: Cliente[] } | { error: string }> {
  // ⚠️ AGGREGATO, chiesto per nome. Il cliente e' del MARCHIO — `clients` e'
  // classificata cosi' — e le sedi «si vedono fra loro»: la sua storia di
  // spesa e di visite deve essere INTERA, non quella che ha lasciato a un
  // punto solo. Filtrando per sede, Stockel vedrebbe un cliente da 40 € che
  // in realta' ne ha spesi 300 nel gruppo, e lo tratterebbe di conseguenza.
  const ambito = tutteLeSedi();
  const [ordini, manuali, rese] = await Promise.all([
    ordiniIncassati(ambito),
    clientiManuali(),
    prenotazioniAttive(ambito),
  ]);
  if (ordini === null || manuali === null) return { error: "Lecture impossible" };

  // ⚠️ L'unione sta in `clientiRegole.ts`, pura e con i suoi test. Qui resta
  // solo la lettura: era la stessa identica aggregazione dell'API, tenuta
  // allineata a mano da un commento.
  let optout: string[] = [];
  try {
    const { data } = await supabaseAdmin.from("newsletter_optout").select("email");
    optout = (data ?? []).map((r) => String(r.email ?? ""));
  } catch { /* tabella assente: tutti opt-in */ }

  const clienti = uniscoClienti({ ordini, rese, manuali, optout });
  return { count: clienti.length, clients: clienti };
}
