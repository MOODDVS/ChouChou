-- Pop-up multilingua: traduzioni per lingua del sito (stesso schema di agenda_events).
alter table public.popups add column if not exists title_i18n      jsonb;
alter table public.popups add column if not exists body_i18n       jsonb;
alter table public.popups add column if not exists btn1_label_i18n jsonb;
alter table public.popups add column if not exists btn2_label_i18n jsonb;

-- Migra i dati FR/EN esistenti nelle mappe i18n (una tantum, idempotente).
update public.popups set
  title_i18n = coalesce(title_i18n, '{}'::jsonb)
    || case when coalesce(title,'')    <> '' then jsonb_build_object('fr', title)    else '{}'::jsonb end
    || case when coalesce(title_en,'') <> '' then jsonb_build_object('en', title_en) else '{}'::jsonb end,
  body_i18n = coalesce(body_i18n, '{}'::jsonb)
    || case when coalesce(body,'')     <> '' then jsonb_build_object('fr', body)     else '{}'::jsonb end
    || case when coalesce(body_en,'')  <> '' then jsonb_build_object('en', body_en)  else '{}'::jsonb end,
  btn1_label_i18n = coalesce(btn1_label_i18n, '{}'::jsonb)
    || case when coalesce(btn1_label,'')    <> '' then jsonb_build_object('fr', btn1_label)    else '{}'::jsonb end
    || case when coalesce(btn1_label_en,'') <> '' then jsonb_build_object('en', btn1_label_en) else '{}'::jsonb end,
  btn2_label_i18n = coalesce(btn2_label_i18n, '{}'::jsonb)
    || case when coalesce(btn2_label,'')    <> '' then jsonb_build_object('fr', btn2_label)    else '{}'::jsonb end
    || case when coalesce(btn2_label_en,'') <> '' then jsonb_build_object('en', btn2_label_en) else '{}'::jsonb end
where title_i18n is null;
