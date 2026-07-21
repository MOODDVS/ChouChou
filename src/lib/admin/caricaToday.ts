import { DateTime } from "luxon";
import { supabaseAdmin } from "../db";
import { configGiornoEffettiva } from "../schedule";
import { TIMEZONE } from "../slots";

// Dati "oggi" per l'admin (endpoint /api/admin/today + SSR caricaHomeData):
//   - config       → config oraria effettiva di oggi (come prima)
//   - orders_closed→ cucina chiusa del tutto (app_config, tile Cuisine)
//   - closes_at    → "HH:MM" se ADESSO siamo dentro una fascia (fermeture)
//   - reopen       → { in_days, heure } prossima apertura DOPO adesso
//                    (scansione max 21 giorni, giorni speciali inclusi)

type CfgGiorno = Awaited<ReturnType<typeof configGiornoEffettiva>>;

function bande(cfg: NonNullable<CfgGiorno>): { open: string; close: string }[] {
  const hhmm = (t: unknown) => String(t ?? "").slice(0, 5);
  const b: { open: string; close: string }[] = [];
  if (cfg.lunch_active && cfg.lunch_open && cfg.lunch_close) {
    b.push({ open: hhmm(cfg.lunch_open), close: hhmm(cfg.lunch_close) });
  }
  if (cfg.dinner_active && cfg.dinner_open && cfg.dinner_close) {
    b.push({ open: hhmm(cfg.dinner_open), close: hhmm(cfg.dinner_close) });
  }
  return b;
}

export async function caricaToday() {
  const ora = DateTime.now().setZone(TIMEZONE);
  const config = await configGiornoEffettiva(ora);
  const hm = ora.toFormat("HH:mm");

  let closesAt: string | null = null;
  for (const b of config ? bande(config) : []) {
    if (hm >= b.open && hm < b.close) closesAt = b.close;
  }

  let reopen: { in_days: number; heure: string } | null = null;
  for (let d = 0; d <= 21 && !reopen; d++) {
    const cfg = d === 0 ? config : await configGiornoEffettiva(ora.plus({ days: d }));
    for (const b of cfg ? bande(cfg) : []) {
      if (d === 0 && b.open <= hm) continue;
      reopen = { in_days: d, heure: b.open };
      break;
    }
  }

  let ordersClosed = false;
  try {
    const { data } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "orders_closed")
      .maybeSingle();
    ordersClosed = data?.value === "1";
  } catch {
    /* config assente: cucina considerata aperta */
  }

  return { config, orders_closed: ordersClosed, closes_at: closesAt, reopen };
}
