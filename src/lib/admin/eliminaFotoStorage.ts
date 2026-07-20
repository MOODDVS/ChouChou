import { supabaseAdmin } from "../db";

// Eliminazione DEFINITIVA di un file immagine dal nostro Storage.
// Usata per gli avatar privati (foto clienti e contatti Team): quando la
// foto viene tolta, sostituita o il proprietario eliminato, il file NON
// deve restare orfano (riapparirebbe in Assets come "Libre").
//
// Guardie di sicurezza: si elimina SOLO un URL del nostro Storage e SOLO
// se nessuna riga lo referenzia più (team, piatti, pop-up, clienti) —
// chiamarla DOPO l'update/delete della riga, così la guardia passa.
export async function eliminaFotoStorage(urlFoto: string | null | undefined): Promise<void> {
  try {
    const u = String(urlFoto ?? "");
    const m = /\/object\/public\/([^/]+)\/(.+)$/.exec(u);
    if (!m) return;
    const [usoTeam, usoMenu, usoPopup, usoClienti] = await Promise.all([
      supabaseAdmin.from("team").select("id").eq("photo_url", u).limit(1).maybeSingle(),
      supabaseAdmin.from("menu_items").select("id").eq("image_url", u).limit(1).maybeSingle(),
      supabaseAdmin.from("popups").select("id").eq("image_url", u).limit(1).maybeSingle(),
      supabaseAdmin.from("clients").select("id").eq("photo_url", u).limit(1).maybeSingle(),
    ]);
    if (usoTeam.data || usoMenu.data || usoPopup.data || usoClienti.data) return; // ancora usata
    await supabaseAdmin.storage.from(m[1]).remove([decodeURIComponent(m[2])]);
  } catch {
    /* mai bloccante */
  }
}
