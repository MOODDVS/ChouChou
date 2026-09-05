-- ============================================================
-- #70 — Lingua di MITTENTE e DESTINATARIO su un buono regalo.
--
-- Le email dei buoni (offrant/destinataire) e il PDF stampabile vanno
-- inviati nella LINGUA DELLA PERSONA, scelta nel modale di creazione.
-- Il PDF è generato ON-DEMAND (/api/bon-pdf, quando il destinatario apre
-- il link), quindi la lingua del destinatario DEVE essere persistita qui,
-- non basta al momento dell'invio.
--
--  - sender_lang    : lingua dell'email all'offrant (chi offre).
--  - recipient_lang : lingua dell'email al destinataire E del PDF.
-- NULL = usa la lingua predefinita del sito pubblico (public_lang_default).
-- Valori attesi = codici lingua pubblici (fr/en/it/nl/es). Idempotente.
-- ============================================================
alter table public.gift_cards
  add column if not exists sender_lang    text,
  add column if not exists recipient_lang text;
