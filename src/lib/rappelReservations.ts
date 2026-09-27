import { DateTime } from "luxon";
import { leggi, aggiorna, tutteLeSedi, ambitoDiRiga, SEDE_UNICA } from "./admin/sede";
import { fusoDi } from "./fuso";
import { emailRappelResa, type ResaEmail } from "./notifications";

// Rappel client ~3 h avant la réservation.
// Règle : envoyé UNIQUEMENT si la résa a été prise pour un jour FUTUR
// (pas le jour même) et si elle est encore « confirmed ». Un cron externe
// (cron-job.org) appelle /api/cron/reservation-reminders toutes les heures
// (ou toutes les 30 min pour un timing plus serré). Idempotent via
// reminder_sent_at.

const FENETRE_H = 3; // on envoie quand la résa est dans les 3 prochaines heures

interface RowResa {
  /** ⚠️ Selezionata apposta: la lettura e' sull'aggregato (un cron non ha
   *  nessuna sede scelta), quindi la sede la puo' dire solo la riga. */
  location_id: string | null;
  id: string; date: string; heure: string; service_key: string | null;
  people: number; zone: string | null; first_name: string; last_name: string;
  phone: string; email: string; lang: string; cancel_token: string;
  status: string; created_at: string; reminder_sent_at: string | null;
}

export interface EsitoRappel { sent: number; checked: number; reason?: string }

export async function eseguiRappelReservations(force = false): Promise<EsitoRappel> {
  // ⚠️ La finestra di date si calcola nel fuso dell'INSTALLAZIONE: serve solo
  // a restringere la query a «oggi o domani», e un'ora di scarto ai bordi non
  // fa danno. L'ora della singola prenotazione invece si legge nel fuso della
  // SUA sede, sotto: li' un'ora di scarto e' un promemoria mandato nel
  // momento sbagliato.
  const now = DateTime.now().setZone(await fusoDi(SEDE_UNICA));
  const aujourdHui = now.toISODate();
  const demain = now.plus({ days: 1 }).toISODate();

  // Candidate : confirmées, pas encore rappelées, sur aujourd'hui ou demain
  // (une résa dans les 3 h tombe forcément dans cette fenêtre de dates).
  // ⚠️ AGGREGATO, chiesto per nome. Un cron non nasce da una richiesta: non
  // c'e' nessuna sede selezionata, e il promemoria e' un lavoro che riguarda
  // TUTTI i punti.
  //
  // Fino al 16/09/2026 qui c'era `ambitoPubblico()`, che rende la PRIMA sede.
  // Con tre pizzerie voleva dire che i clienti di due su tre non ricevevano
  // mai il promemoria — e non se ne accorgeva nessuno, perche' un'email che
  // non parte non lascia traccia da nessuna parte. Il cron rispondeva
  // «sent: 4», e sembrava che funzionasse.
  const ambito = tutteLeSedi();
  const { data, error } = await leggi("reservations", ambito, "id,location_id,date,heure,service_key,people,zone,first_name,last_name,phone,email,lang,cancel_token,status,created_at,reminder_sent_at")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .in("date", [aujourdHui, demain]);

  if (error) return { sent: 0, checked: 0, reason: "db" };
  const righe = (data ?? []) as RowResa[];
  let sent = 0;

  for (const r of righe) {
    // Jour de la RÉSA vs jour de la PRISE de réservation (fuseau local).
    // ⚠️ «Locale» vuol dire DI QUESTA SEDE. La lettura e' sull'aggregato, e
    // la sede la puo' dire solo la riga — come per l'indirizzo nell'email.
    const fuso = await fusoDi(ambitoDiRiga(r.location_id ?? null));
    const jourResa = r.date;
    const jourPrise = DateTime.fromISO(r.created_at).setZone(fuso).toISODate();
    if (!jourResa || !jourPrise) continue;
    if (jourResa <= jourPrise) continue; // réservée le jour même → aucun rappel

    // Heure exacte de la résa (locale) et écart avec maintenant.
    const quand = DateTime.fromISO(`${r.date}T${r.heure}`, { zone: fuso });
    if (!quand.isValid) continue;
    const restant = quand.diff(now, "hours").hours;
    if (restant <= 0) continue;                       // déjà passée
    if (!force && restant > FENETRE_H) continue;      // pas encore dans la fenêtre de 3 h

    const dest: ResaEmail = {
      // ⚠️ Senza questo il promemoria di Stockel porterebbe l'indirizzo di
      // Schaerbeek. La lettura e' sull'aggregato, quindi la sede la puo' dire
      // solo la riga.
      location_id: r.location_id ?? null,
      id: r.id, date: r.date, heure: r.heure, service_key: r.service_key,
      people: r.people, zone: r.zone, first_name: r.first_name, last_name: r.last_name,
      phone: r.phone, email: r.email, lang: r.lang, cancel_token: r.cancel_token,
    };
    const ok = await emailRappelResa(dest);
    // Marque comme envoyé même si l'email échoue : évite de spammer à chaque
    // passage du cron. (Un échec Resend est loggé côté notifications.)
    await aggiorna("reservations", ambito, { reminder_sent_at: now.toISO() }).eq("id", r.id);
    if (ok) sent++;
  }

  return { sent, checked: righe.length };
}
