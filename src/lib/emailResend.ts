/**
 * RESEND DEL CLIENTE — la chiave e il mittente, letti AL MOMENTO DELL'INVIO
 * (5/11/2026).
 *
 * Fino a oggi sei file creavano il loro `new Resend(RESEND_API_KEY)` quando
 * il modulo si caricava, e prendevano `RESEND_FROM` dal `.env`. Adesso la
 * chiave si scrive nella casella Resend del super admin (Intégrations),
 * cifrata in `brand_secrets` (#95), e il mittente in `app_config`. Tutti
 * passano da qui; il `.env` resta come ripiego, cosi' un cliente che non ha
 * ancora la casella compilata continua a mandare le sue email come ieri.
 *
 * ⚠️ La cache dura quanto le altre (60 s) e si butta scrivendo dalla
 * casella: una chiave ruotata vale subito.
 */
import { Resend } from "resend";
import { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { cacheOr, cacheDel } from "./cache";
import { decifra } from "./segreti";
import { fusoDi } from "./fuso";
import { SEDE_UNICA } from "./admin/sede";
import {
  CHIAVE_RESEND,
  K_MITTENTE_EMAIL,
  K_MITTENTE_NOME,
  scegliChiave,
  scegliMittente,
  pulisciMittente,
  type FonteValore,
} from "./admin/resendRegole";

const CACHE = "resend:config";

/** Il ripiego nel `.env`. ⚠️ Scritti per esteso: Vite sostituisce
 *  `import.meta.env.X` guardando il testo. */
export function chiaveDAmbiente(): string {
  return String(import.meta.env.RESEND_API_KEY ?? process.env.RESEND_API_KEY ?? "").trim();
}
export function mittenteDAmbiente(): string {
  return pulisciMittente(import.meta.env.RESEND_FROM ?? process.env.RESEND_FROM ?? "");
}

export interface ConfigResend {
  chiave: string;
  fonteChiave: FonteValore;
  /** C'e' una chiave nella casella ma non si apre (SECRETS_KEY cambiata?). */
  rotta: boolean;
  mittente: string;
  fonteMittente: FonteValore;
  nome: string;
  email: string;
}

/** La riga della casella, gia' decifrata. `null` = nessuna riga, `""` = riga illeggibile. */
async function chiaveDellaCasella(): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.from("brand_secrets").select("value").eq("key", CHIAVE_RESEND).maybeSingle();
    if (error || !data) return null; // #95 non lanciata, o casella vuota
    return decifra(String((data as { value?: unknown }).value ?? ""));
  } catch {
    return null;
  }
}

async function mittenteDellaCasella(): Promise<{ nome: string; email: string }> {
  try {
    const { data } = await supabaseAdmin.from("app_config").select("key, value").in("key", [K_MITTENTE_NOME, K_MITTENTE_EMAIL]);
    const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "").trim()]));
    return { nome: m.get(K_MITTENTE_NOME) ?? "", email: m.get(K_MITTENTE_EMAIL) ?? "" };
  } catch {
    return { nome: "", email: "" };
  }
}

export async function configResend(): Promise<ConfigResend> {
  return cacheOr<ConfigResend>(CACHE, async () => {
    const [suaChiave, suo] = await Promise.all([chiaveDellaCasella(), mittenteDellaCasella()]);
    const k = scegliChiave(suaChiave, chiaveDAmbiente());
    const m = scegliMittente(suo.nome, suo.email, mittenteDAmbiente());
    return { chiave: k.chiave, fonteChiave: k.fonte, rotta: k.rotta, mittente: m.mittente, fonteMittente: m.fonte, nome: suo.nome, email: suo.email };
  });
}

/** Dopo una scrittura dalla casella. */
export function dimenticaConfigResend(): void {
  cacheDel(CACHE);
}

let client: { chiave: string; resend: Resend } | null = null;

/** Il client Resend del cliente, o `null` se non c'e' nessuna chiave. */
export async function resendCliente(): Promise<Resend | null> {
  const { chiave } = await configResend();
  if (!chiave) return null;
  if (client?.chiave !== chiave) client = { chiave, resend: new Resend(chiave) };
  return client.resend;
}

/** Un client per una chiave precisa (la prova di una chiave appena scritta). */
export function resendCon(chiave: string): Resend {
  return new Resend(chiave);
}

/** Il mittente di ripiego («Nome <email>»), "" se non c'e'. I mittenti per
 *  flusso dei Réglages (ordini, prenotazioni, newsletter) restano davanti. */
export async function mittenteResend(): Promise<string> {
  return (await configResend()).mittente;
}

/** Il mese corrente nel fuso dell'installazione: 'YYYY-MM'. */
export async function meseCorrente(): Promise<string> {
  let fuso = "Europe/Brussels";
  try { fuso = await fusoDi(SEDE_UNICA); } catch { /* fuso di default */ }
  return DateTime.now().setZone(fuso).toFormat("yyyy-MM");
}

/**
 * Conta `n` email transazionali partite. Mai bloccante, mai un errore: un
 * conteggio mancato e' un numero un po' basso nella casella, un'email ferma
 * per colpa del contatore sarebbe un guasto vero. Senza la #95 non fa niente.
 */
export function contaEmail(n = 1): void {
  if (n <= 0) return;
  void (async () => {
    try {
      await supabaseAdmin.rpc("email_counter_bump", { p_month: await meseCorrente(), p_n: n });
    } catch {
      /* #95 non lanciata, o rete */
    }
  })();
}
