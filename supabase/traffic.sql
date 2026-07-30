-- ============================================================
-- #47 — Analytics interne (Statistiques → Google : Sources de trafic)
--
-- Analytics FIRST-PARTY, sans cookie et sans donnée personnelle : on
-- enregistre juste, à chaque ARRIVÉE sur le site public, la provenance
-- (Google / Facebook / Instagram / Direct / …) déduite du référent ou
-- du paramètre utm_source. Aucune IP, aucun identifiant → pas de
-- bandeau de consentement nécessaire.
--
-- Écrit UNIQUEMENT par /api/track (clé service). Les navigations
-- internes ne sont pas comptées (le client ne beacon que les entrées).
--   - source   : catégorie normalisée (google, facebook, instagram,
--                direct, tiktok, x, autre, …)
--   - ref_host : hôte brut du référent (pour détailler « autre »)
-- ============================================================

create table if not exists public.page_views (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  path        text        not null default '',
  source      text        not null default 'autre',
  ref_host    text        not null default ''
);

create index if not exists page_views_created_idx on public.page_views (created_at);
create index if not exists page_views_source_idx  on public.page_views (source);

-- RLS activé sans policy : seul le rôle service (clé serveur) peut lire/écrire.
alter table public.page_views enable row level security;

-- Agrégation des sources sur une période (évite le plafond de 1000 lignes
-- d'un select côté client). Retourne source + nombre de visites.
create or replace function public.traffic_sources(since timestamptz)
returns table(source text, count bigint)
language sql
stable
as $$
  select pv.source, count(*)::bigint as count
  from public.page_views pv
  where pv.created_at >= since
  group by pv.source
  order by count desc
$$;
