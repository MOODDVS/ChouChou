import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { calcolaSlot, TIMEZONE, type OrariApertura } from "./slots";

/** Helper: costruisce un DateTime in Europe/Brussels a partire da "YYYY-MM-DD HH:mm". */
function brussels(s: string): DateTime {
  return DateTime.fromFormat(s, "yyyy-MM-dd HH:mm", { zone: TIMEZONE });
}

/** Config "aperto" di base: 11:30–22:30, riusabile nei test. */
const apertoStandard: OrariApertura = {
  open_time: "11:30",
  close_time: "22:30",
  is_open: true,
};

describe("calcolaSlot", () => {
  it("ritorna [] se oggi è in giorniChiusura", () => {
    const slots = calcolaSlot({
      oraCorrente: brussels("2026-06-01 19:00"),
      orariApertura: apertoStandard,
      tempoPrep: 30,
      durataSlot: 15,
      giorniChiusura: ["2026-06-01"],
    });
    expect(slots).toEqual([]);
  });

  it("ritorna [] se is_open è false", () => {
    const slots = calcolaSlot({
      oraCorrente: brussels("2026-06-01 19:00"),
      orariApertura: { ...apertoStandard, is_open: false },
      tempoPrep: 30,
      durataSlot: 15,
      giorniChiusura: [],
    });
    expect(slots).toEqual([]);
  });

  it("ritorna [] se è troppo tardi (ora + prep >= chiusura - margine)", () => {
    // 22:10 + 30min prep = 22:40, oltre l'ultimo slot (22:15)
    const slots = calcolaSlot({
      oraCorrente: brussels("2026-06-01 22:10"),
      orariApertura: apertoStandard,
      tempoPrep: 30,
      durataSlot: 15,
      giorniChiusura: [],
    });
    expect(slots).toEqual([]);
  });

  it("primo slot = arrotondamento superiore di (ora + prep) a durataSlot (15 min)", () => {
    // 19:05 + 30min = 19:35 -> arrotonda su a 19:45
    const slots = calcolaSlot({
      oraCorrente: brussels("2026-06-01 19:05"),
      orariApertura: apertoStandard,
      tempoPrep: 30,
      durataSlot: 15,
      giorniChiusura: [],
    });
    expect(slots[0]).toBe("19:45");
  });

  it("se (ora + prep) è già un multiplo esatto, non arrotonda oltre", () => {
    // 19:15 + 30min = 19:45 -> resta 19:45
    const slots = calcolaSlot({
      oraCorrente: brussels("2026-06-01 19:15"),
      orariApertura: apertoStandard,
      tempoPrep: 30,
      durataSlot: 15,
      giorniChiusura: [],
    });
    expect(slots[0]).toBe("19:45");
  });

  it("ultimo slot = chiusura - 15 min", () => {
    const slots = calcolaSlot({
      oraCorrente: brussels("2026-06-01 19:00"),
      orariApertura: apertoStandard,
      tempoPrep: 30,
      durataSlot: 15,
      giorniChiusura: [],
    });
    expect(slots[slots.length - 1]).toBe("22:15");
  });

  it("genera gli slot al passo corretto (durataSlot = 30)", () => {
    // 19:00 + 30min = 19:30 -> primo slot 19:30, passo 30, ultimo 22:00
    const slots = calcolaSlot({
      oraCorrente: brussels("2026-06-01 19:00"),
      orariApertura: apertoStandard,
      tempoPrep: 30,
      durataSlot: 30,
      giorniChiusura: [],
    });
    expect(slots).toEqual([
      "19:30", "20:00", "20:30", "21:00",
      "21:30", "22:00",
    ]);
  });

  it("se si ordina prima dell'apertura, parte dall'apertura + prep", () => {
    // Ordine alle 09:00, apertura 11:30, prep 30 -> primo slot 12:00
    const slots = calcolaSlot({
      oraCorrente: brussels("2026-06-01 09:00"),
      orariApertura: apertoStandard,
      tempoPrep: 30,
      durataSlot: 15,
      giorniChiusura: [],
    });
    expect(slots[0]).toBe("12:00");
  });

  it("rispetta Europe/Brussels anche se l'input è in un'altra zona", () => {
    // 17:05 UTC = 19:05 a Bruxelles (ora legale estiva). + 30min prep -> 19:45.
    const inputUTC = DateTime.fromFormat(
      "2026-06-01 17:05",
      "yyyy-MM-dd HH:mm",
      { zone: "utc" }
    );
    const slots = calcolaSlot({
      oraCorrente: inputUTC,
      orariApertura: apertoStandard,
      tempoPrep: 30,
      durataSlot: 15,
      giorniChiusura: [],
    });
    expect(slots[0]).toBe("19:45");
  });
});
import { calcolaSlotGiorno, type ConfigGiorno } from "./slots";

describe("calcolaSlotGiorno (due fasce)", () => {
  // Config base: entrambi i servizi attivi, pranzo 11:30-14:30, cena 18:30-22:30.
  const base: ConfigGiorno = {
    lunch_active: true,
    lunch_open: "11:30",
    lunch_close: "14:30",
    dinner_active: true,
    dinner_open: "18:30",
    dinner_close: "22:30",
    prep_time_minutes: 30,
    slot_duration_minutes: 30,
    exceptional_closures: [],
  };

  it("entrambi i servizi attivi: ritorna slot sia per pranzo che per cena", () => {
    // Ordine al mattino presto: pranzo parte da 12:00 (apertura+prep), cena da 19:00.
    const r = calcolaSlotGiorno(brussels("2026-06-01 09:00"), base);
    expect(r.lunch[0]).toBe("12:00");
    expect(r.lunch[r.lunch.length - 1]).toBe("14:00"); // 14:30 - 15min margine -> 14:15, ultimo multiplo 14:00
    expect(r.dinner[0]).toBe("19:00");
    expect(r.dinner[r.dinner.length - 1]).toBe("22:00"); // 22:30 - 15 -> 22:15, ultimo 22:00
  });

  it("chiuso tutto il giorno: entrambe le liste vuote", () => {
    const r = calcolaSlotGiorno(brussels("2026-06-01 09:00"), {
      ...base,
      lunch_active: false,
      dinner_active: false,
    });
    expect(r.lunch).toEqual([]);
    expect(r.dinner).toEqual([]);
  });

  it("solo pranzo attivo: cena vuota", () => {
    const r = calcolaSlotGiorno(brussels("2026-06-01 09:00"), {
      ...base,
      dinner_active: false,
    });
    expect(r.lunch.length).toBeGreaterThan(0);
    expect(r.dinner).toEqual([]);
  });

  it("solo cena attiva: pranzo vuoto", () => {
    const r = calcolaSlotGiorno(brussels("2026-06-01 09:00"), {
      ...base,
      lunch_active: false,
    });
    expect(r.lunch).toEqual([]);
    expect(r.dinner.length).toBeGreaterThan(0);
  });

  it("chiusura eccezionale: entrambe vuote anche se i servizi sono attivi", () => {
    const r = calcolaSlotGiorno(brussels("2026-06-01 09:00"), {
      ...base,
      exceptional_closures: ["2026-06-01"],
    });
    expect(r.lunch).toEqual([]);
    expect(r.dinner).toEqual([]);
  });

  it("servizio attivo ma orari mancanti (null): quella fascia è vuota", () => {
    const r = calcolaSlotGiorno(brussels("2026-06-01 09:00"), {
      ...base,
      lunch_active: true,
      lunch_open: null,
      lunch_close: null,
    });
    expect(r.lunch).toEqual([]);
    expect(r.dinner.length).toBeGreaterThan(0);
  });

  it("nel pomeriggio (dopo il pranzo): pranzo vuoto, cena ancora disponibile", () => {
    // Alle 16:00 il pranzo è già finito (chiude 14:30), la cena no.
    const r = calcolaSlotGiorno(brussels("2026-06-01 16:00"), base);
    expect(r.lunch).toEqual([]);
    expect(r.dinner[0]).toBe("19:00");
  });
});