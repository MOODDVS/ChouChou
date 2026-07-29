import { supabaseAdmin } from "./db";
import { cacheOr } from "./cache";

/**
 * Modalità di prenotazione del sito pubblico (Réglages → Integrations).
 * Permette al cliente di restare su Zenchef / TheFork / Barestho tenendo
 * tutto il resto del motore MOODD.
 *
 *  - "moodd" : widget MOODD (default, comportamento storico)
 *  - "link"  : il bottone « Réserver » porta al sito del fornitore
 *  - "embed" : widget del fornitore incollato nel sito
 *  - "none"  : nessuna prenotazione online (take-away puro)
 *
 * Cache 60s: una modifica nell'admin si vede sul sito entro un minuto.
 */
export type ModoResa = "moodd" | "link" | "embed" | "none";

export interface ConfigResa {
  mode: ModoResa;
  provider: string;
  url: string;
  embed: string;
}

const DEFAULT: ConfigResa = { mode: "moodd", provider: "", url: "", embed: "" };

export async function configResa(): Promise<ConfigResa> {
  try {
    return await cacheOr("site:resa-mode", async () => {
      const { data, error } = await supabaseAdmin
        .from("app_config")
        .select("key, value")
        .in("key", ["resa_mode", "resa_provider", "resa_url", "resa_embed"]);
      if (error) throw error;
      const c: Record<string, string> = {};
      for (const r of data ?? []) c[(r as { key: string }).key] = String((r as { value?: unknown }).value ?? "");
      const m = c.resa_mode;
      return {
        mode: (m === "link" || m === "embed" || m === "none" ? m : "moodd") as ModoResa,
        provider: c.resa_provider ?? "",
        url: c.resa_url ?? "",
        embed: c.resa_embed ?? "",
      };
    }, 60_000);
  } catch {
    return DEFAULT;
  }
}
