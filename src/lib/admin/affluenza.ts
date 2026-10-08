import { DateTime } from "luxon";
import { leggi, type Ambito } from "./sede";
import { fusoDi } from "../fuso";
import { cacheGet, cacheSet } from "../cache";
import { giorniPrecedenti, oraDi, mediePerOra } from "./affluenzaRegole";

/**
 * L'ABITUDINE DELLA CASA — a che ora, di solito, c'e' gente.
 *
 * ⚠️ Non arriva da Google. I «popular times» della scheda non sono esposti da
 * nessuna API ufficiale: quello che si legge in giro o e' raschiato dalla
 * pagina (vietato, e si rompe da solo) o e' inventato. Quindi il dato e'
 * NOSTRO: i coperti prenotati e gli ordini, messi all'ora loro — e tenuti
 * SEPARATI, perche' quattro persone a tavola e quattro ordini da portare via
 * non sono la stessa cosa e non si sommano.
 *
 * ⚠️ Lo STESSO GIORNO DELLA SETTIMANA, non gli ultimi N giorni. In un
 * ristorante il martedi' e il sabato non si assomigliano: una media su tutti i
 * giorni darebbe una curva che non e' quella di nessuna sera — e sarebbe la
 * piu' credibile delle due, perche' liscia e con la forma giusta.
 *
 * ⚠️ La media si divide per le settimane che hanno PORTATO RIGHE, e quel
 * numero esce insieme al risultato. Dividere per otto in un locale aperto da
 * tre settimane schiaccerebbe la curva a meta' senza dirlo; chi legge
 * «moyenne sur 3 semaines» sa invece quanto fidarsi di quello che vede.
 */

export interface Affluenza {
  /** Ora (0-23) come stringa → media dei COPERTI prenotati in quell'ora. */
  covers: Record<string, number>;
  /** Ora (0-23) come stringa → media degli ORDINI in quell'ora. */
  orders: Record<string, number>;
  /** Quante settimane hanno davvero portato righe: va scritto sotto il grafico. */
  settimane: number;
  /** Che cosa e' stato contato: "covers", "orders". Dipende da cosa e' acceso. */
  fonti: string[];
}

/**
 * L'abitudine di questo giorno della settimana, per questo punto.
 *
 * ⚠️ `fonti` NON e' una preferenza di disegno: e' cio' che chi guarda ha il
 * diritto di vedere. Se «Commandes» e' spenta, gli ordini non si leggono
 * nemmeno — altrimenti il grafico direbbe, in forma di barra, un giro
 * d'affari che la stessa persona non puo' aprire.
 */
export async function caricaAffluenza(
  oggiISO: string,
  ambito: Ambito,
  fonti: { resa: boolean; ordini: boolean },
): Promise<Affluenza> {
  const quali = [fonti.resa ? "covers" : "", fonti.ordini ? "orders" : ""].filter(Boolean);
  if (!quali.length) return { covers: {}, orders: {}, settimane: 0, fonti: [] };

  const sede = ambito.modo === "sede" ? ambito.id : ambito.modo;
  const chiave = `aff:${sede}:${oggiISO}:${quali.join("+")}`;
  const gia = cacheGet<Affluenza>(chiave);
  if (gia) return gia;

  const giorni = giorniPrecedenti(oggiISO);
  const insieme = new Set(giorni);
  const fuso = await fusoDi(ambito);
  const righe: { giorno: string; ora: number; quanti: number; serie: "covers" | "orders" }[] = [];

  const [resaQ, ordQ] = await Promise.all([
    fonti.resa
      ? leggi("reservations", ambito, "date, heure, people, status").in("date", giorni)
      : null,
    // ⚠️ Gli ordini non hanno una colonna «giorno»: `pickup_time` e' un
    // istante, e il giorno dipende dal fuso del locale. Si chiede la finestra
    // intera e si scarta qui quello che non e' uno dei giorni voluti —
    // filtrare sul database vorrebbe dire scrivere il fuso dentro una
    // stringa SQL, cioe' in un secondo posto che un giorno dira' altro.
    fonti.ordini
      ? leggi("orders", ambito, "pickup_time, status")
          .gte("pickup_time", DateTime.fromISO(giorni[giorni.length - 1] ?? oggiISO, { zone: fuso }).startOf("day").toISO() ?? "")
          .lt("pickup_time", DateTime.fromISO(oggiISO, { zone: fuso }).startOf("day").toISO() ?? "")
      : null,
  ]);

  for (const r of (resaQ?.data ?? []) as { date: string; heure: string; people: number; status: string }[]) {
    if (r.status === "cancelled") continue;
    righe.push({ giorno: String(r.date), ora: oraDi(r.heure), quanti: Number(r.people) || 0, serie: "covers" });
  }
  for (const o of (ordQ?.data ?? []) as { pickup_time: string; status: string }[]) {
    if (o.status === "cancelled") continue;
    const d = DateTime.fromISO(String(o.pickup_time)).setZone(fuso);
    const giorno = d.toISODate() ?? "";
    if (!insieme.has(giorno)) continue;
    righe.push({ giorno, ora: d.hour, quanti: 1, serie: "orders" });
  }

  const { covers, orders, settimane } = mediePerOra(righe);
  const out: Affluenza = { covers, orders, settimane, fonti: quali };
  // Mezz'ora: l'abitudine di otto settimane non cambia fra un caffe' e
  // l'altro, e questa e' la lettura piu' pesante della Accueil.
  cacheSet(chiave, out, 30 * 60_000);
  return out;
}
