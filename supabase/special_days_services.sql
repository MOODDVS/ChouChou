-- #33 · Servizi attivi nei jours spéciaux "ouvert"
-- null = tutti i servizi (retro-compatibile con i giorni già salvati)
-- []   = nessun servizio: giorno aperto SOLO per ordinare
-- ["soir|18:00-21:30", ...] = solo i servizi selezionati (token key|from-to)

alter table public.special_days
  add column if not exists services jsonb;
