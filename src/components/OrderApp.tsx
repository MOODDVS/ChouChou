import { useState, useEffect, useRef, useMemo } from "react";
import SlotPicker from "./SlotPicker";
import { etichettaVariante } from "../lib/pricing";
import { testoPiatto, etichettaMenu, type ChiaveEtichetta } from "../lib/i18nMenu";
import { urlConSede } from "../lib/sedeUrl";

/** Formato di un piatto (pizza 30/40 cm, calice/bottiglia…). Prezzi già
 *  scontati lato server; qui si sceglie soltanto quale formato ordinare. */
interface Variante {
  key: string;
  label_i18n: Record<string, string>;
  price_cents: number;
  original_price_cents: number | null;
  orderable: boolean;
  /** Finito adesso: si vede, ma non si può aggiungere al carrello. */
  sold_out: boolean;
}

interface MenuItem {
  id: string;
  category: string;
  category_order: number;
  name: string;
  description: string | null;
  description_fr: string | null;
  description_en: string | null;
  price_cents: number; // prezzo EFFETTIVO (sconti già applicati)
  original_price_cents: number | null; // pieno, solo se scontato
  image_url: string | null;
  is_bestseller: boolean;
  is_vegan: boolean;
  is_spicy: boolean;
  is_suggestion: boolean;
  is_seasonal: boolean;
  /** Piatto esaurito: resta in carta, segnalato, ma non ordinabile. */
  is_sold_out: boolean;
  /** Vuoto = prezzo unico. Pieno = il cliente sceglie il formato. */
  variants: Variante[];
}
interface MenuCategoria {
  category: string;
  category_order: number;
  items: MenuItem[];
  parent?: string | null;
  depth?: number;
  root?: string;
}

interface CartLine {
  id: string;
  name: string;
  price_cents: number;
  qty: number;
  /** Chiave del formato scelto. Assente = piatto a prezzo unico.
   *  Due formati dello stesso piatto sono DUE righe distinte. */
  variant?: string;
  /** Il nome del piatto SENZA il formato, e l'etichetta del formato gia'
   *  tradotta — gli stessi due pezzi che `api/checkout.ts` tiene separati
   *  nelle righe d'ordine.
   *
   *  ⚠️ `name` resta il testo unico «Piatto — Formato» e non si tocca: e'
   *  quello che vede chi non ha il carrello dettagliato, ed e' quello gia'
   *  salvato nei carrelli aperti in sessionStorage. Questi due si AGGIUNGONO.
   *
   *  ⚠️ E non si ricavano spezzando `name` sul trattino: un piatto che ha un
   *  trattino nel nome si spezzerebbe nel posto sbagliato, e in silenzio. */
  base_name?: string;
  variant_label?: string;
}

/** Identità di una riga di carrello: piatto + formato. */
function chiaveLinea(l: { id: string; variant?: string }): string {
  return l.variant ? `${l.id}::${l.variant}` : l.id;
}

// Stringhe tradotte passate dal lato Astro.
interface OrderStrings {
  cartTitle: string;
  cartEmpty: string;
  recap: string;
  yourInfo: string;
  pickupTime: string;
  notes: string;
  notesPlaceholder: string;
  coupon: string;
  /** Etichetta della casella «ho un codice sconto».
   *
   *  ⚠️ OPZIONALE, e il suo esserci cambia il disegno: se la pagina non la
   *  passa, il campo del codice resta visibile com'e' sempre stato. I siti
   *  gia' in produzione non la passano, e non cambia loro niente.
   *
   *  Serve ai siti che non vogliono un campo «codice sconto» sempre aperto
   *  davanti a chi un codice non ce l'ha: chiederlo suggerisce che esista
   *  uno sconto e che lui se lo stia perdendo. */
  couponAsk?: string;
  couponPlaceholder: string;
  couponApply: string;
  couponRemove: string;
  couponInvalid: string;
  subtotal: string;
  discount: string;
  total: string;
  items: string;
  toCheckout: string;
  pay: string;
  paying: string;
  backToMenu: string;
  seeCart: string;
  fillAll: string;
  errPayment: string;
  errConnection: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  ariaIncrease: string;
  ariaDecrease: string;
  ariaRemove: string;
  ariaAdd: string;
  tabBoissons: string;
  closedToday: string;
  reopenInfo: string;
  consentPre: string;
  consentLink: string;
  privacyHref: string;
  /** Etichette dei badge e degli stati. OPZIONALI: se la pagina del cliente
   *  non le passa, si usano quelle del motore nella lingua giusta. */
  soldOut?: string;
  vegan?: string;
  spicy?: string;
  seasonal?: string;
  suggestion?: string;
  confirm?: string;
  /** «l'unité» dopo il prezzo unitario, e il comando che svuota il carrello.
   *  Opzionali come le altre: i siti gia' in produzione non le passano, e una
   *  `undefined` a schermo sarebbe un guasto visibile su tutti insieme. */
  each?: string;
  clearAll?: string;
}

interface OrderAppProps {
  menu: MenuCategoria[];
  t: OrderStrings;
  /** Lingua della pagina. Qualunque lingua pubblica, non solo fr/en:
   *  le etichette passano da `etichettaMenu`, che sa ripiegare. */
  lang: string;
  closedToday?: boolean;
  /** Come il cliente sceglie il formato di un piatto con varianti.
   *  "pulsanti" (default): un bottone per formato dentro la scheda, adatto
   *  alle liste asciutte. "modale": scheda con foto grande e radio, per i
   *  siti che puntano sulla vetrina fotografica. Scelta PER CLIENTE: la
   *  passa la pagina /order, che è un file del cliente. */
  sceltaFormato?: "pulsanti" | "modale";
  /** Mostrare la foto del piatto nella lista? Scelta di design PER CLIENTE:
   *  un menu a lista asciutta non la vuole, una vetrina fotografica sì.
   *  Anche quando è true, la foto compare solo sui piatti che ne hanno una:
   *  niente riquadri vuoti a spezzare le righe. Default: nessuna foto. */
  foto?: boolean;
  /** Il carrello mostra la fotografia del piatto, il prezzo unitario sotto il
   *  nome, quanti articoli ci sono e un comando per svuotare tutto.
   *
   *  ⚠️ SPENTA DI DEFAULT, e non per prudenza generica: accenderla aggiunge
   *  nodi dentro `.order-cart-line` e una riga nel riepilogo. I siti gia' in
   *  produzione si attaccano alle classi `order-*` dal loro CSS, e per quelle
   *  nuove il CSS non ce l'hanno: se comparissero da sole, il giorno del
   *  merge si troverebbero una miniatura nuda nel carrello e il prezzo
   *  unitario in mezzo a una riga `space-between`, senza aver chiesto niente.
   *  Si accende quando il sito ha lo stile pronto.
   *
   *  Le classi da vestire:
   *    order-cart-line-foto     il contenitore della miniatura
   *    order-cart-line-unit     il prezzo unitario, accanto al nome
   *    order-cart-line-variant  l'etichetta del formato, staccata dal nome
   *    order-recap-testa        il <div> attorno al titolo del riepilogo
   *    order-recap-conta        la riga «N articoli · Svuota tutto»
   *    order-recap-svuota       il pulsante, che prende .confirm al primo tocco
   *
   *  La pastiglia del formato porta anche `data-variant` e, sul formato
   *  standard, `data-base`: vedi il commento sulla riga che la scrive.
   *
   *  ⚠️ Per aggiungere al carrello da FUORI dell'isola c'e' un evento
   *  pubblico, non una prop: `EVENTO_AGGIUNGI` in cima a questo file. */
  carrelloDettagliato?: boolean;
  /** Il punto da cui si ordina. La passa la pagina /order, che e' un file
   *  del cliente. Vuoto = punto unico (vedi lib/sedeUrl). */
  sede?: string;
}

type Vista = "menu" | "checkout";

/**
 * AGGIUNGERE AL CARRELLO DA FUORI L'ISOLA — evento pubblico.
 *
 * Un sito puo' mostrare piatti dove il menu non e' disegnato (un carosello
 * «ultima voglia» nella vista checkout, una scheda in home) e ha bisogno di
 * metterli nel carrello senza duplicare la logica dei prezzi e dei formati.
 *
 *   window.dispatchEvent(new CustomEvent("restohub:order-add", {
 *     detail: { id: "<id del piatto>", variant: "<chiave formato>" },
 *   }));
 *
 * Risposta, sempre, su "restohub:order-add-result":
 *   { id, ok: true }
 *   { id, ok: false, motivo: "sconosciuto" | "esaurito"
 *                          | "variante-richiesta" | "variante-non-disponibile" }
 *
 * ⚠️ `sconosciuto` vuol dire «non e' nel menu che questa pagina ha in mano»:
 * il menu arriva gia' filtrato per sede e per ordinabilita', quindi copre
 * anche il piatto che esiste ma qui non si vende.
 *
 * ⚠️ `variante-richiesta`: il piatto ha dei formati e l'evento non ne ha
 * detto nessuno. Col modale attivo (`sceltaFormato="modale"`) si apre il
 * modale e si risponde `ok`. Con le pastiglie il selettore NON ESISTE fuori
 * dalla scheda del piatto, e il motore non inventa un'interfaccia che il
 * sito non ha vestito: risponde `false`, e il sito chiede come vuole lui.
 *
 * ⚠️ E' una porta APERTA: qualunque script della pagina puo' bussare. Il
 * danno possibile e' una riga di troppo in un carrello che il cliente vede
 * prima di pagare — i prezzi li rifa' il server dal database, non da qui.
 */
export const EVENTO_AGGIUNGI = "restohub:order-add";
export const EVENTO_AGGIUNGI_ESITO = "restohub:order-add-result";

const STORAGE_KEY = "lm-order-cart";

interface StatoSalvato {
  linee: CartLine[];
  nome: string;
  cognome: string;
  telefono: string;
  email: string;
  noteOrdine: string;
  coupon: string;
}

function leggiStatoSalvato(): Partial<StatoSalvato> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<StatoSalvato>;
  } catch {
    return {};
  }
}

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

export default function OrderApp({ menu, t, lang, closedToday = false, sceltaFormato = "pulsanti", foto = false, carrelloDettagliato = false, sede = "" }: OrderAppProps) {
  // ⚠️ Il punto viaggia con ogni chiamata: /api/coupon e /api/checkout senza
  // sede finivano sulla PRIMA — ordine e incasso nel posto sbagliato.
  const conSede = (u: string) => urlConSede(u, sede);
  // ---- Gruppi costruiti dalle categorie REALI dell'admin ----
  // Pizza = rouges/blanches/calzone/suppléments (category_order 4..7)
  // Boissons = tutte le bevande (category_order >= 9)
  // Il resto (Antipasti, Pasta, Menu enfants, Desserts) = sezione propria.
  interface Gruppo {
    slug: string;
    label: string;
    subcats: MenuCategoria[];
  }
  const gruppiVisibili: Gruppo[] = [];
  const haGerarchia = menu.some((c) => (c.depth ?? 0) > 0);
  if (haGerarchia) {
    // Filtri = categorie di PRIMO livello (root). Le sotto-categorie diventano
    // titoli dentro il gruppo della loro categoria radice.
    const perRoot = new Map<string, Gruppo>();
    for (const cat of menu) {
      if (cat.items.length === 0) continue;
      const root = cat.root ?? cat.category;
      let g = perRoot.get(root);
      if (!g) {
        g = { slug: "g" + gruppiVisibili.length, label: root, subcats: [] };
        perRoot.set(root, g);
        gruppiVisibili.push(g);
      }
      g.subcats.push(cat);
    }
    for (const g of gruppiVisibili) g.subcats.sort((a, b) => a.category_order - b.category_order);
  } else {
    // Legacy (senza sotto-categorie): raggruppamento storico per range.
    for (const cat of menu) {
      if (cat.items.length === 0) continue;
      let slug = "cat-" + cat.category_order;
      let label = cat.category;
      if (cat.category_order >= 4 && cat.category_order <= 7) {
        slug = "pizza";
        label = "Pizza";
      } else if (cat.category_order >= 9) {
        slug = "boissons";
        label = t.tabBoissons;
      }
      const last = gruppiVisibili[gruppiVisibili.length - 1];
      if (last && last.slug === slug) last.subcats.push(cat);
      else gruppiVisibili.push({ slug, label, subcats: [cat] });
    }
  }

  const salvato = leggiStatoSalvato();

  const [vista, setVista] = useState<Vista>("menu");
  const [linee, setLinee] = useState<CartLine[]>(salvato.linee ?? []);
  const [attivo, setAttivo] = useState<string>(gruppiVisibili[0]?.slug ?? "");

  const [slot, setSlot] = useState<string | null>(null);
  const [nome, setNome] = useState(salvato.nome ?? "");
  const [cognome, setCognome] = useState(salvato.cognome ?? "");
  const [telefono, setTelefono] = useState(salvato.telefono ?? "");
  const [email, setEmail] = useState(salvato.email ?? "");
  const [noteOrdine, setNoteOrdine] = useState(salvato.noteOrdine ?? "");
  const [coupon, setCoupon] = useState(salvato.coupon ?? "");
  const [couponApplicato, setCouponApplicato] = useState<{ code: string; discount_cents: number; label: string } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  /** La casella «ho un codice» e' spuntata? Conta solo con `t.couponAsk`.
   *  ⚠️ Parte aperta se un codice era gia' stato scritto: il carrello
   *  sopravvive a un ricaricamento, e chi torna deve ritrovare quello che
   *  aveva lasciato, non un campo chiuso col suo codice dentro. */
  const [couponAperto, setCouponAperto] = useState(Boolean((salvato.coupon ?? "").trim()));

  function apriCoupon(aperto: boolean) {
    setCouponAperto(aperto);
    // ⚠️ Chiudendo, il campo sparisce ma il suo contenuto resterebbe: alla
    // ripresa il cliente si ritroverebbe applicato un codice che aveva
    // scritto e poi deciso di non usare. Si svuota, col suo messaggio.
    if (!aperto) {
      setCoupon("");
      setCouponMsg(null);
    }
  }
  const [accettato, setAccettato] = useState(false);

  const [invio, setInvio] = useState(false);
  const [erroreCheckout, setErroreCheckout] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const dati: StatoSalvato = { linee, nome, cognome, telefono, email, noteOrdine, coupon };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dati));
    } catch {
      // sessionStorage non disponibile: l'app funziona comunque.
    }
  }, [linee, nome, cognome, telefono, email, noteOrdine, coupon]);

  // Al cambio vista (menu <-> checkout) riporta la pagina in cima:
  // senza questo, passando al checkout la pagina resta scrollata in basso.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [vista]);

  const cliccoInCorso = useRef(false);
  const filterbarRef = useRef<HTMLDivElement | null>(null);

  // Tiene il tab attivo visibile nella barra filtri: su mobile la barra
  // scorre in orizzontale, quindi quando lo scrollspy cambia sezione
  // la pillola attiva viene riportata al centro della barra.
  useEffect(() => {
    const bar = filterbarRef.current;
    if (!bar) return;
    const btn = bar.querySelector<HTMLButtonElement>(".order-tab.is-active");
    if (!btn) return;
    const target = btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [attivo]);

  useEffect(() => {
    if (vista !== "menu") return;
    const sezioni = gruppiVisibili
      .map((g) => document.getElementById(`sec-${g.slug}`))
      .filter((el): el is HTMLElement => el !== null);
    if (sezioni.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (cliccoInCorso.current) return;
        const visibili = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visibili[0]) {
          setAttivo(visibili[0].target.id.replace("sec-", ""));
        }
      },
      { rootMargin: "-160px 0px -65% 0px", threshold: 0 }
    );

    sezioni.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [vista, gruppiVisibili.length]);

  function vaiA(slug: string) {
    const el = document.getElementById(`sec-${slug}`);
    if (!el) return;
    setAttivo(slug);
    cliccoInCorso.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      cliccoInCorso.current = false;
    }, 700);
  }

  // ---- Scelta del formato: modale con foto grande, come sulla scheda ----
  const [itemModale, setItemModale] = useState<MenuItem | null>(null);
  const [varianteScelta, setVarianteScelta] = useState<string>("");

  /** Formati che si possono davvero ordinare adesso. */
  function variantiOrdinabili(item: MenuItem): Variante[] {
    return item.variants.filter((v) => v.orderable && !v.sold_out);
  }

  function clicPiu(item: MenuItem) {
    if (item.is_sold_out) return;
    const ordinabili = variantiOrdinabili(item);
    if (ordinabili.length === 0) {
      // Nessun formato: il piatto ha un prezzo unico e va dritto nel carrello.
      if (item.variants.length === 0) aggiungi(item);
      return;
    }
    setItemModale(item);
    setVarianteScelta(ordinabili[0].key); // il primo formato è quello base
  }

  /** Etichetta fissa nella lingua della pagina: prima quella del cliente
   *  (se l'ha passata in `t`), poi quella del motore. */
  function et(chiave: ChiaveEtichetta): string {
    return etichettaMenu(chiave, lang, t as Partial<Record<ChiaveEtichetta, string>>);
  }

  /** Il piatto mostra i formati come bottoni dentro la scheda? */
  function formatiInLinea(item: MenuItem): boolean {
    return sceltaFormato === "pulsanti" && item.variants.length > 0;
  }

  /** Questo piatto va mostrato con la foto? */
  function conFoto(item: MenuItem): boolean {
    return foto && !!item.image_url;
  }

  /** La fotografia di un piatto, per id. La riga di carrello porta solo l'id,
   *  e il menu il componente ce l'ha gia' in `props`: nessuna lettura nuova.
   *  ⚠️ Riagganciarla da fuori vorrebbe dire confrontare i NOMI delle righe,
   *  che per i piatti con formato non coincidono con quelli del menu. */
  /** Il formato che il ristoratore ha messo per PRIMO nella scheda del piatto.
   *
   *  ⚠️ NON e' `variantiOrdinabili(item)[0]`. Quello si sposta con l'esaurito
   *  di oggi: se la Classica finisce, il «base» diventerebbe il formato
   *  particolare — e un sito che nasconde il base si ritroverebbe nascosto
   *  proprio quello che voleva mostrare. L'ordine dichiarato non si muove.
   *
   *  ⚠️ E non e' piu' «il riferimento del modale»: quel concetto e' stato
   *  tolto il 25/09/2026, perche' nessun formato e' il metro degli altri.
   *  Qui serve un'altra cosa: quale formato il sito puo' considerare lo
   *  STANDARD, per non ripeterlo su ogni riga. */
  const formatoBasePerId = useMemo(() => {
    const m = new Map<string, string>();
    for (const cat of menu) {
      for (const it of cat.items) if (it.variants.length > 0) m.set(it.id, it.variants[0].key);
    }
    return m;
  }, [menu]);

  const fotoPerId = useMemo(() => {
    const m = new Map<string, string>();
    for (const cat of menu) for (const it of cat.items) if (it.image_url) m.set(it.id, it.image_url);
    return m;
  }, [menu]);

  function chiudiModale() {
    setItemModale(null);
    setVarianteScelta("");
  }

  function confermaModale() {
    if (!itemModale) return;
    const v = itemModale.variants.find((x) => x.key === varianteScelta);
    if (v) aggiungi(itemModale, v);
    chiudiModale();
  }

  /** Differenza rispetto al formato base, col segno. */
  function aggiungi(item: MenuItem, v?: Variante) {
    if (item.is_sold_out || v?.sold_out) return;
    // Nome mostrato nella lingua della pagina. Il nome canonico resta nel DB:
    // il server ricostruisce le righe d'ordine da lì, non da qui.
    const nomeVisto = testoPiatto(item, lang).name;
    const nuova: CartLine = v
      ? {
          id: item.id,
          name: `${nomeVisto} — ${etichettaVariante(v, lang)}`,
          price_cents: v.price_cents,
          qty: 1,
          variant: v.key,
          base_name: nomeVisto,
          variant_label: etichettaVariante(v, lang),
        }
      : { id: item.id, name: nomeVisto, price_cents: item.price_cents, qty: 1 };
    const chiave = chiaveLinea(nuova);
    setLinee((prev) => {
      if (prev.some((l) => chiaveLinea(l) === chiave)) {
        return prev.map((l) => (chiaveLinea(l) === chiave ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, nuova];
    });
  }
  function cambiaQty(chiave: string, delta: number) {
    setLinee((prev) =>
      prev
        .map((l) => (chiaveLinea(l) === chiave ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  }
  function rimuovi(chiave: string) {
    setLinee((prev) => prev.filter((l) => chiaveLinea(l) !== chiave));
  }

  // Rimozione con conferma in 2 tap (come nell'admin): il primo tap
  // trasforma il cestino in "Confirmer ?" per 3 secondi, il secondo elimina.
  const [daConfermare, setDaConfermare] = useState<string | null>(null);
  const timerConferma = useRef<number | null>(null);

  /** Chiave finta del comando «svuota tutto» nel meccanismo a due tocchi.
   *  Le chiavi vere sono uuid (o `uuid::formato`), quindi non puo' collidere. */
  const TUTTO = "\u0000tutto";

  /** ⚠️ UN SOLO meccanismo di conferma, non due. Svuotare e' l'unico comando
   *  del carrello che distrugge tutto, e un tocco per sbaglio su un telefono
   *  costa l'ordine intero: deve chiedere conferma esattamente come il
   *  cestino di riga, con lo stesso tempo e lo stesso stato. */
  function chiediConferma(chiave: string, azione: () => void) {
    if (timerConferma.current) window.clearTimeout(timerConferma.current);
    if (daConfermare === chiave) {
      setDaConfermare(null);
      azione();
      return;
    }
    setDaConfermare(chiave);
    timerConferma.current = window.setTimeout(() => setDaConfermare(null), 3000);
  }

  function clickRimuovi(chiave: string) {
    chiediConferma(chiave, () => rimuovi(chiave));
  }

  function clickSvuota() {
    chiediConferma(TUTTO, () => setLinee([]));
  }

  function prezzoRiga(l: CartLine): number {
    return l.price_cents * l.qty;
  }

  const totale = linee.reduce((s, l) => s + prezzoRiga(l), 0);
  const numArticoli = linee.reduce((s, l) => s + l.qty, 0);
  // Sconto coupon (indicativo lato client: il checkout lo ricalcola e valida).
  const scontoCents = couponApplicato ? Math.min(couponApplicato.discount_cents, totale) : 0;
  const totaleFinale = Math.max(0, totale - scontoCents);

  // Se il carrello cambia dopo aver applicato un coupon, l'importo dello sconto
  // potrebbe non essere più corretto: si annulla e il cliente lo riapplica.
  useEffect(() => {
    setCouponApplicato(null);
    setCouponMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linee]);

  async function applicaCoupon() {
    const code = coupon.trim();
    if (!code || couponLoading) return;
    setCouponLoading(true);
    setCouponMsg(null);
    try {
      const res = await fetch(conSede("/api/coupon"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          items: linee.map((l) => ({ id: l.id, qty: l.qty, ...(l.variant ? { variant: l.variant } : {}) })),
          email: email.trim(),
          lang,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCouponApplicato({ code: data.code, discount_cents: data.discount_cents, label: data.label });
        setCouponMsg(null);
      } else {
        setCouponApplicato(null);
        setCouponMsg(data.error ?? t.couponInvalid);
      }
    } catch {
      setCouponApplicato(null);
      setCouponMsg(t.errConnection);
    } finally {
      setCouponLoading(false);
    }
  }

  function rimuoviCoupon() {
    setCouponApplicato(null);
    setCouponMsg(null);
    setCoupon("");
  }

  const emailValida = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const formValido =
    linee.length > 0 &&
    slot !== null &&
    nome.trim() !== "" &&
    cognome.trim() !== "" &&
    telefono.trim() !== "" &&
    emailValida &&
    accettato;

  async function paga() {
    if (!formValido || invio) return;
    setInvio(true);
    setErroreCheckout(null);
    try {
      const res = await fetch(conSede("/api/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: linee.map((l) => ({ id: l.id, qty: l.qty, ...(l.variant ? { variant: l.variant } : {}) })),
          slot,
          note: noteOrdine,
          coupon: couponApplicato?.code ?? "",
          customer: { name: nome, surname: cognome, phone: telefono, email },
          lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErroreCheckout(data.error ?? t.errPayment);
        setInvio(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setErroreCheckout(t.errConnection);
      setInvio(false);
    }
  }

  // Badge accanto al nome (come sulla pagina Notre Carte)
  function Badges({ item }: { item: MenuItem }) {
    return (
      <>
        {item.is_bestseller && (
          <span className="order-b order-b-star" title="Best-seller">★</span>
        )}
        {item.is_vegan && (
          <span className="order-b" title={et("vegan")}>🌱</span>
        )}
        {item.is_spicy && (
          <span className="order-b" title={et("spicy")}>🌶️</span>
        )}
        {item.is_suggestion && <span className="order-sugg">{et("suggestion")}</span>}
        {item.is_sold_out && (
          <span className="order-sugg order-out">{et("soldOut")}</span>
        )}
        {item.is_seasonal && (
          <span className="order-b" title={et("seasonal")}>🍂</span>
        )}
      </>
    );
  }

  /** Modale di scelta del formato: foto, nome e i formati come radio.
   *
   *  ⚠️ OGNI RIGA E' UNA SCELTA A SE', e porta il SUO prezzo pieno.
   *
   *  Prima la prima riga faceva da riferimento e le altre mostravano la
   *  DIFFERENZA. Un formato che costa quanto la prima restava cosi' senza
   *  prezzo, perche' `euroDelta(0)` rendeva "": il cliente non legge «stesso
   *  prezzo», legge «prezzo mancante» — e sul dubbio non ordina.
   *
   *  Non e' solo il caso dello zero. Due prezzi pieni si confrontano
   *  guardandoli; una differenza va sommata a mente a un numero che sta su
   *  un'altra riga. Nessun formato e' il riferimento degli altri. */
  function ModaleVarianti() {
    if (sceltaFormato !== "modale" || !itemModale) return null;
    const ordinabili = variantiOrdinabili(itemModale);
    if (ordinabili.length === 0) return null;
    return (
      <div className="order-modal-overlay" onClick={chiudiModale}>
        <div className="order-modal" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="order-modal-close" onClick={chiudiModale} aria-label={t.ariaRemove}>×</button>
          {itemModale.image_url && (
            <img className="order-modal-img" src={itemModale.image_url} alt={itemModale.name} />
          )}
          <h3 className="order-modal-title">{testoPiatto(itemModale, lang).name}</h3>
          <div className="order-modal-variants">
            {ordinabili.map((v) => (
              <label
                key={v.key}
                className={"order-modal-variant" + (varianteScelta === v.key ? " is-selected" : "")}
              >
                <input
                  type="radio"
                  name="variante"
                  checked={varianteScelta === v.key}
                  onChange={() => setVarianteScelta(v.key)}
                />
                <span className="order-modal-variant-label">{etichettaVariante(v, lang)}</span>
                <span className="order-modal-variant-price">
                  {/* ⚠️ Lo sconto barrato c'era nelle pastiglie e non qui: lo
                      stesso formato in promozione si vedeva scontato da una
                      parte e a prezzo pieno dall'altra. */}
                  {v.original_price_cents && (
                    <s className="order-item-old">{euro(v.original_price_cents)}</s>
                  )}
                  {euro(v.price_cents)}
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="order-modal-add" onClick={confermaModale}>
            {t.ariaAdd}
          </button>
        </div>
      </div>
    );
  }

  /** Ascolta l'evento pubblico descritto in cima al file. Finche' nessuno lo
   *  manda, qui non succede niente: un `addEventListener` e la sua pulizia. */
  useEffect(() => {
    function esito(id: string, ok: boolean, motivo?: string) {
      window.dispatchEvent(
        new CustomEvent(EVENTO_AGGIUNGI_ESITO, { detail: { id, ok, ...(motivo ? { motivo } : {}) } }),
      );
    }
    function ascolta(e: Event) {
      const det = ((e as CustomEvent).detail ?? {}) as { id?: unknown; variant?: unknown };
      const id = String(det.id ?? "").trim();
      if (!id) return; // senza id non c'e' nemmeno a chi rispondere
      const item = menu.flatMap((c) => c.items).find((i) => i.id === id);
      if (!item) return esito(id, false, "sconosciuto");
      if (item.is_sold_out) return esito(id, false, "esaurito");
      if (item.variants.length === 0) {
        aggiungi(item);
        return esito(id, true);
      }
      const chiave = String(det.variant ?? "").trim();
      if (!chiave) {
        // ⚠️ Col modale si puo' chiedere; con le pastiglie no, e il motore
        // non inventa un'interfaccia che il sito non ha vestito.
        if (sceltaFormato !== "modale") return esito(id, false, "variante-richiesta");
        clicPiu(item);
        return esito(id, true);
      }
      const v = variantiOrdinabili(item).find((x) => x.key === chiave);
      if (!v) return esito(id, false, "variante-non-disponibile");
      aggiungi(item, v);
      esito(id, true);
    }
    window.addEventListener(EVENTO_AGGIUNGI, ascolta);
    return () => window.removeEventListener(EVENTO_AGGIUNGI, ascolta);
  }, [menu, sceltaFormato, lang]);

  function RigheCarrello() {
    return (
      <ul className="order-cart-lines">
        {linee.map((l) => {
          const k = chiaveLinea(l);
          return (
          <li key={k} className="order-cart-line">
            {/* ⚠️ Niente <span> vuoto quando il piatto non ha fotografia: un
                riquadro senza immagine dice «manca qualcosa», e il CSS del
                sito non ha modo di distinguerlo da uno che sta caricando.
                width/height sono il RAPPORTO, non le misure vere del file:
                servono a riservare il posto mentre la foto arriva. */}
            {carrelloDettagliato && fotoPerId.get(l.id) && (
              <span className="order-cart-line-foto">
                <img src={fotoPerId.get(l.id)} alt="" loading="lazy" decoding="async" width="80" height="80" />
              </span>
            )}
            <div className="order-cart-line-top">
              {/* ⚠️ Il nome e il formato in DUE elementi: un sito che vuole il
                  formato come pastiglia sotto il nome non puo' ricavarlo dal
                  CSS, che un testo non lo divide.
                  La ricaduta su `name` non e' prudenza generica: i carrelli
                  gia' aperti in sessionStorage sono stati salvati PRIMA che
                  questi campi esistessero, e senza di essa il cliente che
                  torna sulla pagina vedrebbe le sue righe senza nome. */}
              {carrelloDettagliato && l.base_name && l.variant_label ? (
                <>
                  <span className="order-cart-line-name">{l.base_name}</span>
                  {/* ⚠️ Attributi, non il testo: l'etichetta cambia con la
                      lingua della pagina, e un CSS che confronta un testo si
                      rompe alla prima traduzione. Con
                      `.order-cart-line-variant[data-base] { display: none }`
                      il formato standard non si ripete su ogni riga. */}
                  <span
                    className="order-cart-line-variant"
                    data-variant={l.variant}
                    data-base={l.variant && formatoBasePerId.get(l.id) === l.variant ? "" : undefined}
                  >
                    {l.variant_label}
                  </span>
                </>
              ) : (
                <span className="order-cart-line-name">{l.name}</span>
              )}
              {/* ⚠️ `l.price_cents` E' GIA' l'unitario del formato scelto
                  (`prezzoRiga` lo moltiplica per la quantita'). Dividere
                  `prezzoRiga(l)` per `l.qty` darebbe lo stesso numero oggi e
                  un numero sbagliato il giorno che nasce uno sconto per
                  quantita'. */}
              {carrelloDettagliato && (
                <span className="order-cart-line-unit">{euro(l.price_cents)} {et("each")}</span>
              )}
              <span className="order-cart-line-price">{euro(prezzoRiga(l))}</span>
            </div>
            <div className="order-cart-line-controls">
              <button type="button" onClick={() => cambiaQty(k, -1)} aria-label={t.ariaDecrease}>−</button>
              <span className="order-cart-qty">{l.qty}</span>
              <button type="button" onClick={() => cambiaQty(k, 1)} aria-label={t.ariaIncrease}>+</button>
              <button
                type="button"
                className={"order-cart-remove" + (daConfermare === k ? " confirm" : "")}
                onClick={() => clickRimuovi(k)}
                aria-label={t.ariaRemove}
              >
                {daConfermare === k ? (
                  et("confirm")
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                )}
              </button>
            </div>
          </li>
          );
        })}
      </ul>
    );
  }

  // =========================================================
  // VISTA CHECKOUT
  // =========================================================
  if (vista === "checkout") {
    return (
      <div className="order-wrap">
        {/* Stessa barra sticky dei filtri, con il "Retour au menu" a pillola */}
        <div className="order-filterbar">
          <div className="order-filterbar-inner">
            <button type="button" className="order-tab" onClick={() => setVista("menu")}>
              {t.backToMenu}
            </button>
          </div>
        </div>
        <div className="order-app">
          <div className="order-menu">
            {/* ⚠️ Il <div> avvolge l'<h2> SOLO quando serve. Avvolgerlo sempre
                cambierebbe la struttura attorno a un nodo che tutti i siti
                stilizzano, e per niente: senza il conteggio non c'e' nulla da
                affiancare. */}
            {carrelloDettagliato && linee.length > 0 ? (
              <div className="order-recap-testa">
                <h2 className="order-section-title">{t.recap}</h2>
                <p className="order-recap-conta">
                  <span>{numArticoli} {t.items}</span>
                  <button
                    type="button"
                    className={"order-recap-svuota" + (daConfermare === TUTTO ? " confirm" : "")}
                    onClick={clickSvuota}
                  >
                    {daConfermare === TUTTO ? et("confirm") : et("clearAll")}
                  </button>
                </p>
              </div>
            ) : (
              <h2 className="order-section-title">{t.recap}</h2>
            )}
            {linee.length === 0 ? (
              <p className="order-cart-empty">{t.cartEmpty}</p>
            ) : (
              <>
                <RigheCarrello />
                <div className="order-note">
                  <label className="order-field-label" htmlFor="order-note-field">{t.notes}</label>
                  <textarea
                    id="order-note-field"
                    className="order-note-field"
                    rows={4}
                    placeholder={t.notesPlaceholder}
                    value={noteOrdine}
                    onChange={(e) => setNoteOrdine(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <aside className="order-cart order-cart--checkout">
            <h2 className="order-cart-title">{t.yourInfo}</h2>
            <label className="order-field-label">{t.pickupTime}</label>
            {/* SlotPicker legge il dizionario PUBBLICO del cliente (src/i18n/ui.ts),
                che ha solo fr/en: si restringe qui, con lo stesso ripiego (fr)
                che userebbe il dizionario. Non è un'etichetta scritta a mano. */}
            <SlotPicker onSelect={setSlot} lang={lang === "en" ? "en" : "fr"} sede={sede} />
            <div className="order-form">
              <input className="order-input" type="text" placeholder={t.firstName} value={nome} onChange={(e) => setNome(e.target.value)} />
              <input className="order-input" type="text" placeholder={t.lastName} value={cognome} onChange={(e) => setCognome(e.target.value)} />
              <input className="order-input" type="tel" placeholder={t.phone} value={telefono} onChange={(e) => setTelefono(e.target.value)} />
              <input className="order-input" type="email" placeholder={t.email} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="order-coupon">
              {t.couponAsk ? (
                <label className="order-coupon-ask">
                  <input
                    type="checkbox"
                    checked={couponAperto}
                    onChange={(e) => apriCoupon(e.target.checked)}
                  />
                  <span>{t.couponAsk}</span>
                </label>
              ) : (
                <label className="order-field-label" htmlFor="order-coupon-field">{t.coupon}</label>
              )}
              {/* ⚠️ Il coupon GIA' APPLICATO non passa dalla casella: e' uno
                  sconto che il cliente ha gia' ottenuto, e nasconderlo
                  vorrebbe dire non fargli piu' vedere ne' quanto sconta ne'
                  il modo di toglierlo. */}
              {couponApplicato ? (
                <div className="order-coupon-applied">
                  <span className="order-coupon-code">{couponApplicato.code}</span>
                  <span className="order-coupon-amount">−{euro(scontoCents)}</span>
                  <button
                    type="button"
                    className="order-coupon-remove"
                    onClick={rimuoviCoupon}
                    aria-label={t.couponRemove}
                  >
                    ×
                  </button>
                </div>
              ) : (
                (!t.couponAsk || couponAperto) && (
                <div className="order-coupon-row">
                  {/* ⚠️ `aria-label` solo con la casella: li' l'etichetta
                      visibile del campo non esiste piu', e senza nome il campo
                      si annuncerebbe come «casella di testo» e basta. Senza
                      casella l'etichetta c'e' gia', e un aria-label
                      raddoppierebbe il nome. */}
                  <input
                    id="order-coupon-field"
                    className="order-input"
                    type="text"
                    autoComplete="off"
                    aria-label={t.couponAsk ? t.coupon : undefined}
                    placeholder={t.couponPlaceholder}
                    value={coupon}
                    onChange={(e) => setCoupon(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applicaCoupon();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="order-coupon-apply"
                    onClick={applicaCoupon}
                    disabled={!coupon.trim() || couponLoading}
                  >
                    {couponLoading ? "…" : t.couponApply}
                  </button>
                </div>
                )
              )}
              {couponMsg && <p className="order-coupon-msg">{couponMsg}</p>}
            </div>
            <label className="order-consent">
              <input type="checkbox" checked={accettato} onChange={(e) => setAccettato(e.target.checked)} />
              <span>
                {t.consentPre}
                <a href={t.privacyHref} target="_blank" rel="noopener">{t.consentLink}</a>
              </span>
            </label>
            {scontoCents > 0 ? (
              <>
                <div className="order-cart-subtotal">
                  <span>{t.subtotal}</span>
                  <span>{euro(totale)}</span>
                </div>
                <div className="order-cart-discount">
                  <span>{t.discount} ({couponApplicato?.code})</span>
                  <span>−{euro(scontoCents)}</span>
                </div>
                <div className="order-cart-total">
                  <span>{t.total} ({numArticoli} {t.items})</span>
                  <strong>{euro(totaleFinale)}</strong>
                </div>
              </>
            ) : (
              <div className="order-cart-total">
                <span>{t.total} ({numArticoli} {t.items})</span>
                <strong>{euro(totale)}</strong>
              </div>
            )}
            <button type="button" className="order-cart-checkout" disabled={!formValido || invio} onClick={paga}>
              {invio ? t.paying : t.pay}
            </button>
            {erroreCheckout && <p className="order-cart-error">{erroreCheckout}</p>}
            {!formValido && !erroreCheckout && (
              <p className="order-cart-note">{t.fillAll}</p>
            )}
          </aside>
        </div>

        {/* ⚠️ Anche QUI, non solo nella vista menu: un sito che aggiunge un
            piatto con l'evento pubblico mentre il cliente sta compilando i
            dati deve poter chiedere il formato. Era montato solo di la'. */}
        <ModaleVarianti />
      </div>
    );
  }

  // =========================================================
  // VISTA MENU
  // =========================================================
  return (
    <div className="order-wrap">
      <div className="order-filterbar">
        <div className="order-filterbar-inner" ref={filterbarRef}>
          {gruppiVisibili.map((g) => (
            <button
              key={g.slug}
              type="button"
              className={"order-tab" + (g.slug === attivo ? " is-active" : "")}
              onClick={() => vaiA(g.slug)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="order-app">
        <div className="order-menu">
          {gruppiVisibili.map((g) => (
            <section key={g.slug} id={`sec-${g.slug}`} className="order-sec">
              <h2 className="order-sec-title">{g.label}</h2>
              {g.subcats.map((sub) => (
                <div key={sub.category} className="order-subcat">
                  {(sub.depth ?? 0) > 0 && (
                    <h3 className="order-subcat-title">{sub.category}</h3>
                  )}
                  <div className="order-items">
                    {sub.items.map((item) => {
                      // Nome e descrizione nella lingua della pagina
                      // (name_i18n/desc_i18n, con ripiego sulle colonne storiche).
                      const testi = testoPiatto(item, lang);
                      const desc = testi.description;
                      return (
                        <div key={item.id} className="order-item">
                          <div className="order-item-info">
                            <h3 className="order-item-name">
                              {testi.name}
                              <Badges item={item} />
                            </h3>
                            {desc && <p className="order-item-desc">{desc}</p>}
                            {formatiInLinea(item) ? (
                              /* Un bottone per formato: aggiunge QUEL formato. */
                              <div className="order-item-vars">
                                {item.variants.map((v) => (
                                  <button
                                    key={v.key}
                                    type="button"
                                    className="order-item-var"
                                    disabled={v.sold_out || item.is_sold_out}
                                    aria-label={`${t.ariaAdd} ${item.name} — ${etichettaVariante(v, lang)}`}
                                    onClick={() => aggiungi(item, v)}
                                  >
                                    <span className="order-item-var-lb">
                                      {etichettaVariante(v, lang)}
                                      {v.sold_out && (
                                        <span className="order-sugg order-out">{et("soldOut")}</span>
                                      )}
                                    </span>
                                    <span className="order-item-var-pr">
                                      {v.original_price_cents && (
                                        <s className="order-item-old">{euro(v.original_price_cents)}</s>
                                      )}
                                      {euro(v.price_cents)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="order-item-price">
                                {item.original_price_cents && (
                                  <s className="order-item-old">{euro(item.original_price_cents)}</s>
                                )}
                                {euro(item.price_cents)}
                              </p>
                            )}
                          </div>
                          {/* Con la foto, il "+" ci sta appoggiato sopra;
                              senza, resta il bottone tondo di sempre.
                              Prezzo unico -> dritto nel carrello; con formati
                              -> modale, se il cliente ha scelto quella via. */}
                          {conFoto(item) ? (
                            <div className="order-item-photo">
                              <img src={item.image_url!} alt={item.name} loading="lazy" decoding="async" />
                              {!formatiInLinea(item) && (
                                <button
                                  type="button"
                                  className="order-item-add"
                                  disabled={item.is_sold_out}
                                  aria-label={`${t.ariaAdd} ${item.name}`}
                                  onClick={() => clicPiu(item)}
                                >
                                  +
                                </button>
                              )}
                            </div>
                          ) : (
                            !formatiInLinea(item) && (
                              <button
                                type="button"
                                className="order-item-add"
                                disabled={item.is_sold_out}
                                aria-label={`${t.ariaAdd} ${item.name}`}
                                onClick={() => clicPiu(item)}
                              >
                                +
                              </button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>

        <aside className={"order-cart" + (closedToday ? " order-cart--ferme" : "")}>
          {closedToday ? (
            <div className="order-ferme">
              <div className="order-ferme-row">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="m6.5 6.5 11 11" />
                </svg>
                <span>{t.closedToday}</span>
              </div>
              {t.reopenInfo && <p className="order-ferme-sub">{t.reopenInfo}</p>}
            </div>
          ) : linee.length === 0 ? (
            <>
              <h2 className="order-cart-title">{t.cartTitle}</h2>
              <p className="order-cart-empty">{t.cartEmpty}</p>
            </>
          ) : (
            <>
              <h2 className="order-cart-title">{t.cartTitle}</h2>
              <RigheCarrello />
              <div className="order-cart-total">
                <span>{t.total} ({numArticoli} {t.items})</span>
                <strong>{euro(totale)}</strong>
              </div>
              <button type="button" className="order-cart-checkout" onClick={() => setVista("checkout")}>
                {t.toCheckout}
              </button>
            </>
          )}
        </aside>
      </div>

      {closedToday ? (
        <div className="order-mobcart order-mobcart--ferme">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="m6.5 6.5 11 11" />
          </svg>
          <span>{t.closedToday}</span>
        </div>
      ) : (
        linee.length > 0 && (
          <button type="button" className="order-mobcart" onClick={() => setVista("checkout")}>
            <span className="order-mobcart-count">{numArticoli}</span>
            <span className="order-mobcart-label">{t.seeCart}</span>
            <span className="order-mobcart-total">{euro(totale)}</span>
            <span className="order-mobcart-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </span>
          </button>
        )
      )}

      <ModaleVarianti />
    </div>
  );
}
