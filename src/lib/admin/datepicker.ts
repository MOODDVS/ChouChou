/**
 * IL CALENDARIO DEL MARCHIO — uno solo, per tutto l'admin.
 *
 * ⚠️ Perche' questo file esiste. Lo STILE era gia' stato unificato in
 * `styles/datepicker.css`, e il commento in cima a quel foglio racconta
 * com'era andata: «ogni pagina aveva la sua copia (5-6 duplicati, alcune
 * vecchie e disallineate: la riga dei giorni della settimana senza gap non
 * combaciava con le date)». Il COMPORTAMENTO invece era rimasto copiato in
 * otto file, e la copia numero nove stava per nascere in `google.astro`.
 *
 * Copie della stessa regola non danno errore: divergono. Una impara a
 * guardare nel passato e le altre no, una si riposiziona bene sotto un
 * modale e le altre finiscono fuori schermo, e chi legge non sa quale sia
 * quella giusta perche' lo sono tutte, ognuna per la sua pagina.
 *
 * ------------------------------------------------------------------
 * IL PATTO CON CHI LO USA, in due righe:
 *
 *   il VALORE vero sta in `data-iso`   (2026-12-31, quello che va al database)
 *   il TESTO e' solo per l'occhio      (31/12/2026, quello che si legge)
 *
 * ⚠️ Leggere `.value` invece di `.dataset.iso` non da' errore: mette
 * dicembre prima di gennaio in un confronto, e manda al database una data
 * in un formato che nessuno rilegge.
 * ------------------------------------------------------------------
 */

export interface Datepicker {
  /** Apre il pannello su un campo. `passato` = si puo' tornare indietro. */
  apri(target: HTMLInputElement, passato?: boolean): void;
  chiudi(): void;
  /** Scrive una data nel campo: `data-iso` + testo. Stringa vuota = svuota. */
  metti(el: HTMLInputElement, iso: string): void;
  /** Un campo che esiste gia' nel DOM. */
  collega(el: HTMLInputElement, passato?: boolean): void;
  /**
   * Campi che NON esistono ancora: una lista che si ridisegna (i giorni
   * speciali della scheda Google) crea nuovi `<input>` a ogni modifica, e
   * dei listener attaccati uno per uno morirebbero al primo ridisegno.
   * Qui l'ascolto sta sul contenitore, che non cambia mai.
   */
  delega(radice: HTMLElement, selettore: string, passato?: boolean): void;
  /** Oggi in AAAA-MM-GG, nel fuso del browser (non in UTC). */
  isoOggi(): string;
  /** AAAA-MM-GG → GG/MM/AAAA. */
  fmt(iso: string): string;
}

export function creaDatepicker(opz: {
  /** Per i nomi dei mesi: `ADMIN_LOCALE[LANG]`. */
  loc: string;
  /** Iniziali dei giorni, da lunedi': `tr("res.dowInitials").split(",")`. */
  dow: string[];
  /**
   * IL LOCALE E' CHIUSO QUEL GIORNO? Serve a SEGNARLO, non a vietarlo.
   *
   * ⚠️ Segnato e cliccabile, e non spento. Un giorno di chiusura e' il giorno
   * in cui si fanno le cose che durante il servizio non si possono fare —
   * l'inventario, la manutenzione, la chiamata al commercialista — quindi e'
   * fra i piu' probabili per una scadenza, non fra i meno. Spegnerlo
   * vorrebbe dire che il calendario sa meglio del ristoratore cosa si puo'
   * fare di lunedi'.
   *
   * ⚠️ Si legge A OGNI DISEGNO, non una volta alla creazione: la funzione
   * puo' guardare dati che arrivano dopo (le chiusure speciali vengono da una
   * chiamata), e una copia presa alla nascita del calendario sarebbe sempre
   * vuota.
   */
  chiuso?: (iso: string) => boolean;
}): Datepicker {
  const MESI = Array.from({ length: 12 }, (_, m) =>
    new Date(2000, m, 1).toLocaleDateString(opz.loc, { month: "long" }),
  );

  let target: HTMLInputElement | null = null;
  let passato = false;
  let anno = 0;
  let mese = 0; // 0-11

  const panel = document.createElement("div");
  panel.className = "dp-panel";
  panel.style.position = "absolute";
  panel.style.display = "none";
  document.body.appendChild(panel);

  function isoOggi(): string {
    // ⚠️ Non `toISOString()`: quello e' UTC, e dopo le 23:00 a Bruxelles
    // darebbe «domani» — il calendario aprirebbe sul giorno sbagliato.
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const isoDi = (y: number, m: number, g: number): string =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
  const fmt = (iso: string): string => {
    const [y, m, d] = String(iso).split("-");
    return y && m && d ? `${d}/${m}/${y}` : "";
  };

  function render(): void {
    const oggi = isoOggi();
    const sel = target?.dataset.iso ?? "";
    const offset = (new Date(anno, mese, 1).getDay() + 6) % 7; // lunedi' = 0
    const nGiorni = new Date(anno, mese + 1, 0).getDate();
    const oy = Number(oggi.slice(0, 4));
    const om = Number(oggi.slice(5, 7)) - 1;
    const prevOff = passato ? false : anno < oy || (anno === oy && mese <= om);
    let celle = "";
    for (let i = 0; i < offset; i++) celle += '<span class="dp-cell dp-vuota"></span>';
    for (let g = 1; g <= nGiorni; g++) {
      const iso = isoDi(anno, mese, g);
      const cls = ["dp-cell"];
      const spento = !passato && iso < oggi;
      if (spento) cls.push("dp-off");
      if (!spento && opz.chiuso?.(iso)) cls.push("dp-chiuso");
      if (iso === oggi) cls.push("dp-today");
      if (iso === sel) cls.push("dp-sel");
      celle += `<button type="button" class="${cls.join(" ")}" data-iso="${iso}" ${spento ? "disabled" : ""}>${g}</button>`;
    }
    panel.innerHTML = `
      <div class="dp-head">
        <button type="button" class="dp-nav" data-nav="-1" ${prevOff ? "disabled" : ""}>‹</button>
        <span class="dp-title">${MESI[mese]} ${anno}</span>
        <button type="button" class="dp-nav" data-nav="1">›</button>
      </div>
      <div class="dp-dow">${opz.dow.map((g) => `<span>${g}</span>`).join("")}</div>
      <div class="dp-grid">${celle}</div>`;
  }

  function apri(el: HTMLInputElement, conPassato = false): void {
    target = el;
    passato = conPassato;
    const base = el.dataset.iso || isoOggi();
    anno = Number(base.slice(0, 4));
    mese = Number(base.slice(5, 7)) - 1;
    render();

    // Sulla stessa pagina puo' esserci un altro pannello aperto.
    document.querySelectorAll<HTMLElement>(".dp-panel").forEach((x) => {
      if (x !== panel) x.style.display = "none";
    });

    panel.style.maxHeight = "";
    panel.style.overflowY = "";
    panel.style.display = "block";

    // Dove ci sta: sotto se c'e' posto, sopra se no, e se non c'e' posto da
    // nessuna parte si accorcia invece di finire fuori schermo.
    const r = el.getBoundingClientRect();
    const pw = panel.offsetWidth || 308;
    const ph = panel.offsetHeight || 360;
    const gap = 6;
    const navReserve = window.innerWidth <= 900 ? 90 : 12; // barra di navigazione
    const headerReserve = 72;
    const sotto = window.innerHeight - r.bottom - gap - navReserve;
    const sopra = r.top - gap - headerReserve;
    let topVp: number;
    if (ph <= sotto) {
      topVp = r.bottom + gap;
    } else if (ph <= sopra) {
      topVp = r.top - gap - ph;
    } else if (sotto >= sopra) {
      topVp = r.bottom + gap;
      panel.style.maxHeight = `${Math.max(220, sotto)}px`;
      panel.style.overflowY = "auto";
    } else {
      const h = Math.max(220, sopra);
      topVp = r.top - gap - h;
      panel.style.maxHeight = `${h}px`;
      panel.style.overflowY = "auto";
    }
    const leftVp = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    panel.style.left = `${leftVp + window.scrollX}px`;
    panel.style.top = `${topVp + window.scrollY}px`;
  }

  function chiudi(): void {
    panel.style.display = "none";
    target = null;
  }

  function metti(el: HTMLInputElement, iso: string): void {
    if (iso) {
      el.dataset.iso = iso;
      el.value = fmt(iso);
    } else {
      delete el.dataset.iso;
      el.value = "";
    }
  }

  panel.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t.classList.contains("dp-nav")) {
      mese += Number(t.dataset.nav);
      if (mese < 0) { mese = 11; anno--; }
      if (mese > 11) { mese = 0; anno++; }
      render();
      return;
    }
    if (t.classList.contains("dp-cell") && t.dataset.iso && target) {
      const iso = t.dataset.iso;
      const scelto = target;
      metti(scelto, iso);
      // ALLINEAMENTO «fine >= inizio»: quale sia il campo di fine lo dice il
      // markup (`data-pair`), non un nome scritto qui dentro. Cosi' ogni
      // coppia di date ne beneficia senza che nessuno debba ricordarsene.
      const fine = document.getElementById(scelto.dataset.pair ?? "") as HTMLInputElement | null;
      if (fine && (!fine.dataset.iso || fine.dataset.iso < iso)) metti(fine, iso);
      chiudi();
      // Chi ascolta il campo (un salvataggio, un ricalcolo) deve accorgersene:
      // scrivere `value` a mano non genera nessun evento.
      scelto.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  function collega(el: HTMLInputElement, conPassato = false): void {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      apri(el, conPassato);
    });
  }

  function delega(radice: HTMLElement, selettore: string, conPassato = false): void {
    radice.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLInputElement>(selettore);
      if (!el) return;
      e.stopPropagation();
      apri(el, conPassato);
    });
  }

  document.addEventListener("click", (e) => {
    if (panel.style.display !== "none" && !panel.contains(e.target as Node)) chiudi();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") chiudi();
  });

  return { apri, chiudi, metti, collega, delega, isoOggi, fmt };
}
