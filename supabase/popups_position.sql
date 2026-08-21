-- Posizione del pop-up sullo schermo: center | bottom-left | bottom-center | bottom-right
alter table public.popups add column if not exists position text not null default 'center';
