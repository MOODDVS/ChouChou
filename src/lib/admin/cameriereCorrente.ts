/**
 * IL CAMERIERE DELLA PILLOLA IN ALTO — per le pagine del palmare (sala,
 * Commandes, …). 25/10/2026: era scritto dentro /admin/salle; ora le pagine
 * del palmare sono due e la pillola e' una sola (`PalmareTesta.astro`).
 *
 * ⚠️ Si chiama DENTRO il `Promise.all` della pagina, insieme alle sue letture:
 * dentro il componente sarebbe un viaggio in piu' in fila.
 */
import { supabaseAdmin } from "../db";
import type { StaffUser } from "./adminAuth";

export interface CamerierePillola {
  nome: string;
  foto: string;
  iniziali: string;
}

export async function cameriereDellaPillola(staff: StaffUser | null, ripiego = ""): Promise<CamerierePillola> {
  type RigaTeam = { name?: string; photo_url?: string | null };
  let riga = null as RigaTeam | null;
  // Il palmare di un dipendente: nome e foto sono quelli del Team.
  if (staff?.employee_id) {
    try {
      const { data } = await supabaseAdmin.from("team").select("name, photo_url").eq("id", staff.employee_id).maybeSingle();
      riga = (data ?? null) as RigaTeam | null;
    } catch { riga = null; }
  }
  // Il palmare del locale (o un dipendente cancellato dal Team): il nome
  // dell'utente, scritto in Super.
  const nome = String(riga?.name ?? "").trim() || String(staff?.nome ?? "").trim() || ripiego;
  const iniziali = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "·";
  return { nome, foto: String(riga?.photo_url ?? "").trim(), iniziali };
}
