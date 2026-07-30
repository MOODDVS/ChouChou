import { DateTime } from "luxon";
import { supabaseAdmin } from "./db";
import { TIMEZONE } from "./slots";
import { emailRappelResa, type ResaEmail } from "./notifications";

// Rappel client ~3 h avant la réservation.
// Règle : envoyé UNIQUEMENT si la résa a été prise pour un jour FUTUR
// (pas le jour même) et si elle est encore « confirmed ». Un cron externe
// (cron-job.org) appelle /api/cron/reservation-reminders toutes les heures
// (ou toutes les 30 min pour un timing plus serré). Idempotent via
// reminder_sent_at.

const FENETRE_H = 3; // on envoie quand la résa est dans les 3 prochaines heures

interface RowResa {
  id: string; date: string; heure: string; service_key: string | null;
  people: number; zone: string | null; first_name: string; last_name: string;
  phone: string; email: string; lang: string; cancel_token: string;
  status: string; created_at: string; reminder_sent_at: string | null;
}

export interface EsitoRappel { sent: number; checked: number; reason?: string }

export async function eseguiRappelReservations(force = false): Promise<EsitoRappel> {
  const now = DateTime.now().setZone(TIMEZONE);
  const aujourdHui = now.toISODate();
  const demain = now.plus({ days: 1 }).toISODate();

  // Candidate : confirmées, pas encore rappelées, sur aujourd'hui ou demain
  // (une résa dans les 3 h tombe forcément dans cette fenêtre de dates).
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select("id,date,heure,service_key,people,zone,first_name,last_name,phone,email,lang,cancel_token,status,created_at,reminder_sent_at")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .in("date", [aujourdHui, demain]);

  if (error) return { sent: 0, checked: 0, reason: "db" };
  const righe = (data ?? []) as RowResa[];
  let sent = 0;

  for (const r of righe) {
    // Jour de la RÉSA vs jour de la PRISE de réservation (fuseau local).
    const jourResa = r.date;
    const jourPrise = DateTime.fromISO(r.created_at).setZone(TIMEZONE).toISODate();
    if (!jourResa || !jourPrise) continue;
    if (jourResa <= jourPrise) continue; // réservée le jour même → aucun rappel

    // Heure exacte de la résa (locale) et écart avec maintenant.
    const quand = DateTime.fromISO(`${r.date}T${r.heure}`, { zone: TIMEZONE });
    if (!quand.isValid) continue;
    const restant = quand.diff(now, "hours").hours;
    if (restant <= 0) continue;                       // déjà passée
    if (!force && restant > FENETRE_H) continue;      // pas encore dans la fenêtre de 3 h

    const dest: ResaEmail = {
      id: r.id, date: r.date, heure: r.heure, service_key: r.service_key,
      people: r.people, zone: r.zone, first_name: r.first_name, last_name: r.last_name,
      phone: r.phone, email: r.email, lang: r.lang, cancel_token: r.cancel_token,
    };
    const ok = await emailRappelResa(dest);
    // Marque comme envoyé même si l'email échoue : évite de spammer à chaque
    // passage du cron. (Un échec Resend est loggé côté notifications.)
    await supabaseAdmin
      .from("reservations")
      .update({ reminder_sent_at: now.toISO() })
      .eq("id", r.id);
    if (ok) sent++;
  }

  return { sent, checked: righe.length };
}
