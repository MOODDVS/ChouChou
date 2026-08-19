import { supabaseAdmin } from "./db";

/**
 * Registra (o completa) una persona nella rubrica `clients`, come fa il
 * webhook Stripe per gli ordini: usato ora anche dalle PRENOTAZIONI, così
 * chi prenota viene salvato come record (modificabile/nascondibile) e non
 * solo calcolato al volo nella pagina Clients.
 *
 * Fusione per EMAIL (unica chiave affidabile): se esiste già, completa i
 * campi mancanti e riattiva un cliente nascosto; altrimenti lo crea.
 * Senza email (es. walk-in) non fa nulla: il cliente resta comunque
 * visibile nella pagina Clients grazie all'aggregazione delle prenotazioni.
 * Non lancia mai eccezioni: non deve far fallire prenotazione/ordine.
 */
export async function registraCliente(c: {
  name: string | null;
  email: string | null;
  phone: string | null;
  lang?: string | null;
}): Promise<void> {
  try {
    const email = (c.email ?? "").trim().toLowerCase();
    if (!email) return;
    const nome = (c.name ?? "").trim();
    const phone = (c.phone ?? "").trim();
    const lang = (c.lang ?? "").trim().toLowerCase();

    const { data: esistente } = await supabaseAdmin
      .from("clients")
      .select("id, name, phone, hidden")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    let id: string | null = null;
    if (esistente) {
      id = esistente.id;
      const patch: { name?: string; phone?: string; hidden?: boolean } = {};
      if (!esistente.name && nome) patch.name = nome;
      if (!esistente.phone && phone) patch.phone = phone;
      if (esistente.hidden) patch.hidden = false; // una nuova attività riattiva
      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from("clients").update(patch).eq("id", esistente.id);
      }
    } else {
      const { data: nuovo } = await supabaseAdmin
        .from("clients")
        .insert({ name: nome, email, phone: phone || null })
        .select("id")
        .maybeSingle();
      id = (nuovo as { id?: string } | null)?.id ?? null;
    }

    // Lingua: cattura la scelta del cliente (widget) SOLO se non ne ha già una
    // (il valore impostato a mano nel modale prevale). Best-effort e tollerante
    // se la colonna `clients.lang` non è ancora stata migrata.
    if (id && lang && /^[a-z]{2}$/.test(lang)) {
      try {
        await supabaseAdmin.from("clients").update({ lang }).eq("id", id).is("lang", null);
      } catch {
        /* colonna lang assente: ignorato */
      }
    }
  } catch (e) {
    console.error("[clients] registrazione da prenotazione fallita:", e);
  }
}
