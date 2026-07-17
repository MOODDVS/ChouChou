import { supabaseAdmin } from "./db";
import { cacheOr } from "./cache";
import { CLIENT } from "../config/client";

/**
 * Dati "pubblici" del ristorante per email e template: telefono,
 * email e indirizzo letti da Réglages → Général (app_config), con
 * fallback sul config cliente. Il NOME resta quello commerciale del
 * config (company_name in Général è la ragione sociale, es. la SRL).
 * Cache 60s: le modifiche in Général arrivano nelle email entro 1 min.
 */
export interface DatiRistorante {
  nome: string;
  tel: string;
  telLink: string; // solo cifre e +, per href="tel:"
  email: string;
  indirizzo: string;
}

export async function datiRistorante(): Promise<DatiRistorante> {
  const fallback: DatiRistorante = {
    nome: CLIENT.nome,
    tel: CLIENT.telefono,
    telLink: CLIENT.telefono.replace(/[^+\d]/g, ""),
    email: CLIENT.email,
    indirizzo: CLIENT.indirizzo,
  };
  try {
    return await cacheOr("ristorante:dati", async () => {
      const { data, error } = await supabaseAdmin
        .from("app_config")
        .select("key, value")
        .in("key", ["public_phone", "public_email", "company_street", "company_zip", "company_city"]);
      if (error) throw error;
      const m = new Map((data ?? []).map((r) => [r.key, String(r.value ?? "").trim()]));
      const via = m.get("company_street") ?? "";
      const cp = m.get("company_zip") ?? "";
      const citta = m.get("company_city") ?? "";
      const tel = m.get("public_phone") || fallback.tel;
      return {
        nome: CLIENT.nome,
        tel,
        telLink: tel.replace(/[^+\d]/g, ""),
        email: m.get("public_email") || fallback.email,
        indirizzo: via && citta ? `${via}, ${cp} ${citta}`.replace(/\s+/g, " ") : fallback.indirizzo,
      };
    });
  } catch {
    return fallback;
  }
}
