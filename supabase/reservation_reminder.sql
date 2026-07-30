-- ============================================================
-- #48 — Rappel client 3 h avant la réservation
--
-- Un email de RAPPEL est envoyé au CLIENT ~3 h avant sa réservation,
-- UNIQUEMENT si elle a été prise pour un jour FUTUR (pas le jour même).
-- Rappel simple : aucun bouton modifier/annuler.
-- Envoi piloté par le cron /api/cron/reservation-reminders (lit toujours
-- l'état à jour → une résa annulée/modifiée n'envoie rien de faux).
--   - reminder_sent_at : horodatage de l'envoi (NULL = pas encore envoyé),
--                        empêche tout doublon.
-- ============================================================
alter table public.reservations
  add column if not exists reminder_sent_at timestamptz;
