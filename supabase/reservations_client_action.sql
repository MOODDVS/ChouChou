-- ============================================================
-- Traccia le azioni del CLIENTE sulle prenotazioni (annullo / modifica dal
-- link nell'email) per il toast live nell'admin: `client_action_at` viene
-- valorizzato SOLO dagli endpoint pubblici (/api/reservation DELETE e PUT),
-- mai dalle azioni dello staff. Il poller admin confronta questo timestamp
-- per avvisare "Réservation annulée / modifiée" e ricaricare la lista.
-- Colonna su tabella già concessa a service_role → nessun GRANT nuovo.
-- Idempotente.
-- ============================================================
alter table public.reservations
  add column if not exists client_action_at timestamptz;
