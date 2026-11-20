/**
 * L'ABBONAMENTO DEL RISTORANTE — attivo, avviso, sospeso (20/11/2026).
 *
 * Lo decide MOODD da admin.restohub.cloud, con l'interruttore della lista
 * clienti. Il motore lo chiede ogni 5 minuti a `/api/licenza` dell'admin, con
 * la stessa chiave della scheda (`RESTOHUB_STATO_KEY`), e lo tiene in memoria.
 *
 *   attivo  → tutto come sempre;
 *   avviso  → nell'admin del ristorante una fascia «paiement en retard» col
 *             bottone per pagare (il link lo scrive MOODD nell'admin);
 *   sospeso → il sito resta su, ma ordini e prenotazioni online si fermano;
 *             l'admin del ristorante mostra solo «Accès suspendu». Il super
 *             admin entra sempre (per riaccendere, o per guardare).
 *
 * ⚠️ PRUDENZA: se l'admin non risponde si tiene lo stato di prima, e al
 * riavvio si parte da «attivo». Un guasto dell'admin di MOODD non deve mai
 * chiudere un ristorante che paga. In locale (localhost) non si chiede niente.
 * ⚠️ Il webhook di Stripe, i job e la scheda non si fermano mai: un pagamento
 * gia' fatto deve arrivare in cucina anche da sospeso.
 */
import { regolaLicenza, type Licenza } from "./licenzaRegole";

export type { Licenza } from "./licenzaRegole";

const OGNI_MS = 5 * 60_000;

function env(nome: string): string {
  return String(process.env[nome] ?? (import.meta.env as Record<string, unknown>)[nome] ?? "").trim();
}

let ultima: Licenza = { stato: "attivo", link: "" };
let letta = 0;
let inCorso: Promise<void> | null = null;
let primaFatta = false;

async function chiedi(): Promise<void> {
  const chiave = env("RESTOHUB_STATO_KEY");
  let host = "";
  try {
    host = new URL(env("PUBLIC_SITE_URL")).hostname;
  } catch {
    host = "";
  }
  letta = Date.now();
  if (!chiave || !host || host === "localhost" || host === "127.0.0.1") return;
  const admin = env("RESTOHUB_ADMIN_URL") || "https://admin.restohub.cloud";
  try {
    const r = await fetch(`${admin}/api/licenza?host=${encodeURIComponent(host)}`, {
      headers: { "x-restohub-key": chiave, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return;
    ultima = regolaLicenza(await r.json());
  } catch {
    /* admin irraggiungibile: si tiene quella di prima */
  }
}

/** Lo stato adesso. Non aspetta mai la rete: se e' vecchio, lo rinfresca dietro. */
export function licenza(): Licenza {
  if (Date.now() - letta > OGNI_MS && !inCorso) {
    inCorso = chiedi().finally(() => { inCorso = null; primaFatta = true; });
  }
  return ultima;
}

/** Come `licenza()`, ma subito dopo l'avvio aspetta la PRIMA lettura (al massimo 2 secondi): un riavvio non riapre un admin sospeso. */
export async function licenzaFresca(): Promise<Licenza> {
  licenza();
  if (!primaFatta && inCorso) await Promise.race([inCorso, new Promise((ok) => setTimeout(ok, 2_000))]);
  return ultima;
}
