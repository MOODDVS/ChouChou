/**
 * LA CASELLA NEWSLETTER DI INTÉGRATIONS (5/11/2026).
 *
 * Tutto quello che decide se una newsletter puo' partire, in un posto:
 * la quota (inclusa + crediti), Resend, il mittente della newsletter e il
 * suo dominio, l'ultimo invio, gli invii programmati. Niente di nuovo da
 * scrivere oltre alla quota: si legge quello che c'e' gia'.
 */
import { supabaseAdmin } from "../db";
import { statoQuota, type StatoQuota } from "./newsletterQuota";
import { resendPronto, mittenteNewsletter } from "../newsletterSend";
import { statoDominioDi } from "./resendStato";
import type { StatoDominio } from "./resendRegole";

import { livelloNewsletter, type Livello } from "./newsletterRegole";

export interface StatoNewsletter {
  quota: StatoQuota | null;
  resend: boolean;
  mittente: { valore: string; dominio: string; stato: StatoDominio };
  ultimo: { subject: string; count: number; il: string } | null;
  programmati: number;
  casella: { livello: Livello };
}

export async function statoNewsletter(): Promise<StatoNewsletter> {
  const [quota, resend, mittente, ultimo, programmati] = await Promise.all([
    statoQuota().catch(() => null),
    resendPronto().catch(() => false),
    mittenteNewsletter().catch(() => ""),
    supabaseAdmin.from("newsletter_log").select("subject, count, created_at").order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => (data?.[0] ? { subject: String(data[0].subject ?? ""), count: Number(data[0].count ?? 0), il: String(data[0].created_at ?? "") } : null), () => null),
    supabaseAdmin.from("newsletter_schedule").select("id", { count: "exact", head: true }).eq("active", true).eq("draft", false)
      .then(({ count }) => count ?? 0, () => 0),
  ]);
  const dom = mittente ? await statoDominioDi(mittente).catch(() => ({ dominio: "", stato: "ignoto" as StatoDominio })) : { dominio: "", stato: "ignoto" as StatoDominio };
  return {
    quota,
    resend,
    mittente: { valore: mittente ?? "", dominio: dom.dominio, stato: dom.stato },
    ultimo,
    programmati,
    casella: { livello: quota ? livelloNewsletter({ resend, quota }) : "no" },
  };
}
