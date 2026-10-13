/**
 * IL TOAST DELL'ADMIN — un posto solo per mostrarlo.
 *
 * Lo stile sta in `styles/toast.css` (classi `toast`, `is-on`, `is-ok`,
 * `is-error`, `is-sopra`) ed e' gia' uno solo. Il COMPORTAMENTO invece era
 * riscritto in nove pagine: nove `function toast()` quasi identiche, con
 * cinque durate diverse e due modi di mettere le classi.
 *
 * ⚠️ DIFETTO VERO (13/10/2026), ed e' per questo che adesso e' qui.
 * `.md-overlay` (il velo del modale) ha `z-index: 400`; il toast, che nel
 * markup sta FUORI dal modale, ne ha 200. Quindi ogni messaggio lanciato
 * mentre una finestra e' aperta veniva disegnato DIETRO il velo: non
 * «passava veloce», non si vedeva affatto.
 *
 * Si e' scoperto dal test della newsletter — il compositore e' un modale, e
 * un cliente ha concluso che il bottone fosse rotto perche' premendolo non
 * succedeva niente a schermo. Ma le pagine con i modali sono quasi tutte, e
 * le chiamate sono oltre duecento: non era un difetto di quel bottone, era
 * un difetto di tutte le finestre dell'admin.
 *
 * ⚠️ `orders.astro` era l'unica a funzionare, e solo perche' si era fatta un
 * SECONDO elemento toast con `is-sopra` scritto a mano nel markup. La
 * soluzione giusta c'era, in un posto dove nessun altro la vedeva.
 *
 * ⚠️ Niente `className = "toast …"` qui dentro: assegnare la stringa intera
 * cancella le classi che non conosce — ed e' cosi' che `is-sopra` scritto
 * nel markup sparirebbe al primo messaggio. Si toccano solo le classi
 * nostre, una per una.
 */

/** Quanto resta a schermo, se non si dice altro. */
const DURATA = 2600;

/**
 * ⚠️ Un orologio PER ELEMENTO, non uno globale: due pagine (o un giorno due
 * toast nella stessa) si spegnerebbero a vicenda. `WeakMap` cosi' l'orologio
 * se ne va insieme all'elemento.
 */
const orologi = new WeakMap<HTMLElement, number>();

export interface OpzioniToast {
  /** Rosso invece di verde. */
  errore?: boolean;
  /** Millisecondi a schermo. Piu' lunghi per un messaggio da LEGGERE
   *  (un indirizzo email, un motivo d'errore): due secondi e mezzo bastano
   *  per «Enregistré», non per un'informazione. */
  durata?: number;
}

/**
 * Mostra il messaggio. `el` puo' essere nullo: una pagina che non ha il
 * toast nel markup non deve rompersi, deve solo non mostrare niente.
 */
export function mostraToast(el: HTMLElement | null, msg: string, opzioni: OpzioniToast = {}): void {
  if (!el) return;
  const { errore = false, durata = DURATA } = opzioni;

  el.textContent = msg;
  el.classList.toggle("is-error", errore);
  el.classList.toggle("is-ok", !errore);

  /**
   * ⚠️ Il cuore della faccenda: se c'e' una finestra aperta il toast va
   * sopra, altrimenti resta in basso dov'e' sempre stato. Si guarda lo
   * STATO VERO del DOM (un `.md-overlay` senza `hidden`) e non una
   * variabile che la pagina deve ricordarsi di aggiornare — perche' quella
   * variabile, prima o poi, qualcuno si dimentica di aggiornarla.
   */
  const modaleAperto = document.querySelector(".md-overlay:not([hidden])") !== null;
  el.classList.toggle("is-sopra", modaleAperto);

  el.classList.add("is-on");
  window.clearTimeout(orologi.get(el));
  orologi.set(el, window.setTimeout(() => el.classList.remove("is-on"), durata));
}
