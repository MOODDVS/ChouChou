import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { calcolaSlotGiorno, TIMEZONE } from "../../lib/slots";
import { configGiornoEffettiva } from "../../lib/schedule";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const oraNow = DateTime.now().setZone(TIMEZONE);

  // ?month=YYYY-MM : giorni CHIUSI al take-away del mese (né pranzo né cena in
  // config). Usato dal datepicker del modale ordine per grigiare i giorni chiusi.
  // configGiornoEffettiva è in cache (settings + special_days) → i ~31 giri sono
  // in memoria, non altrettante query.
  const monthParam = url.searchParams.get("month");
  if (monthParam) {
    if (!/^\d{4}-\d{2}$/.test(monthParam)) {
      return new Response(JSON.stringify({ error: "Mois invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const [my, mm] = monthParam.split("-").map(Number);
    const first = DateTime.fromObject({ year: my, month: mm, day: 1 }, { zone: TIMEZONE });
    const closed: string[] = [];
    if (first.isValid) {
      const nGiorni = first.daysInMonth ?? 31;
      for (let d = 1; d <= nGiorni; d++) {
        const day = first.set({ day: d });
        const cfg = await configGiornoEffettiva(day);
        const pranzo = !!(cfg && cfg.lunch_active && cfg.lunch_open && cfg.lunch_close);
        const cena = !!(cfg && cfg.dinner_active && cfg.dinner_open && cfg.dinner_close);
        if (!pranzo && !cena) closed.push(day.toFormat("yyyy-MM-dd"));
      }
    }
    return new Response(JSON.stringify({ closed }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // Data richiesta (?date=YYYY-MM-DD): oggi = usa l'ora corrente per filtrare gli
  // slot già passati; un giorno FUTURO = inizio giornata (nessuno slot passato).
  // Date passate o non valide → si ripiega su oggi.
  let ora = oraNow;
  const dParam = url.searchParams.get("date");
  if (dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)) {
    const d = DateTime.fromISO(dParam, { zone: TIMEZONE });
    if (d.isValid && d.startOf("day") >= oraNow.startOf("day")) {
      ora = d.hasSame(oraNow, "day") ? oraNow : d.startOf("day");
    }
  }

  // Config effettiva: orari settimanali + giorni speciali (special_days).
  const config = await configGiornoEffettiva(ora);

  // Niente fallback: se il DB non risponde o la riga manca, errore esplicito.
  if (!config) {
    return new Response(
      JSON.stringify({ error: "Configurazione orari non disponibile" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const { lunch, dinner } = calcolaSlotGiorno(ora, config);

  // Giorno CHIUSO al take-away: né pranzo né cena attivi/configurati.
  // (diverso da "aperto ma slot già passati", dove closed=false ma le liste
  // possono essere vuote.)
  const closed = !(
    (config.lunch_active && config.lunch_open && config.lunch_close) ||
    (config.dinner_active && config.dinner_open && config.dinner_close)
  );

  return new Response(JSON.stringify({ lunch, dinner, closed }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
