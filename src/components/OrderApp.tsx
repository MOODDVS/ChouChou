import { useState, useEffect, useRef } from "react";
import SlotPicker from "./SlotPicker";

interface MenuItem {
  id: string;
  category: string;
  category_order: number;
  name: string;
  description: string | null;
  description_fr: string | null;
  description_en: string | null;
  price_cents: number;
  image_url: string | null;
}
interface MenuCategoria {
  category: string;
  category_order: number;
  items: MenuItem[];
}

type Supplemento = "none" | "gluten-free" | "ricotta";

interface CartLine {
  id: string;
  name: string;
  price_cents: number;
  qty: number;
  category_order: number;
  supplement: Supplemento;
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
  supplGlutenFree: string;
  supplRicotta: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  ariaIncrease: string;
  ariaDecrease: string;
  ariaRemove: string;
  ariaAdd: string;
  tabEntrees: string;
  tabPizzas: string;
  tabDesserts: string;
  tabBoissons: string;
  consentPre: string;
  consentLink: string;
  privacyHref: string;
}

interface OrderAppProps {
  menu: MenuCategoria[];
  t: OrderStrings;
  lang: "fr" | "en";
}

type Vista = "menu" | "checkout";

const SUPPL: Record<Supplemento, number> = {
  none: 0,
  "gluten-free": 400,
  ricotta: 300,
};

const STORAGE_KEY = "p77-order-cart";

interface StatoSalvato {
  linee: CartLine[];
  nome: string;
  cognome: string;
  telefono: string;
  email: string;
  noteOrdine: string;
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

function isPizza(categoryOrder: number): boolean {
  return categoryOrder === 2 || categoryOrder === 3;
}

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

export default function OrderApp({ menu, t, lang }: OrderAppProps) {
  // Gruppi con label presa dai dizionari (slug = chiave interna stabile).
  const GRUPPI: { label: string; slug: string; orders: number[] }[] = [
    { label: t.tabEntrees, slug: "entrees", orders: [1] },
    { label: t.tabPizzas, slug: "pizzas", orders: [2, 3] },
    { label: t.tabDesserts, slug: "desserts", orders: [4] },
    { label: t.tabBoissons, slug: "boissons", orders: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
  ];

  const gruppiVisibili = GRUPPI.map((g) => {
    const items = menu
      .filter((c) => g.orders.includes(c.category_order))
      .flatMap((c) => c.items);
    return { label: g.label, slug: g.slug, items };
  }).filter((g) => g.items.length > 0);

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
  const [accettato, setAccettato] = useState(false);

  const [invio, setInvio] = useState(false);
  const [erroreCheckout, setErroreCheckout] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const dati: StatoSalvato = { linee, nome, cognome, telefono, email, noteOrdine };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dati));
    } catch {
      // sessionStorage non disponibile: l'app funziona comunque.
    }
  }, [linee, nome, cognome, telefono, email, noteOrdine]);

  // Al cambio vista (menu <-> checkout) riporta la pagina in cima:
  // senza questo, passando al checkout la pagina resta scrollata in basso.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [vista]);

  const cliccoInCorso = useRef(false);

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

  function aggiungi(item: MenuItem) {
    setLinee((prev) => {
      const esistente = prev.find((l) => l.id === item.id);
      if (esistente) {
        return prev.map((l) => (l.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          price_cents: item.price_cents,
          qty: 1,
          category_order: item.category_order,
          supplement: "none",
        },
      ];
    });
  }
  function cambiaQty(id: string, delta: number) {
    setLinee((prev) =>
      prev.map((l) => (l.id === id ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0)
    );
  }
  function rimuovi(id: string) {
    setLinee((prev) => prev.filter((l) => l.id !== id));
  }
  function cambiaSupplemento(id: string, supplement: Supplemento) {
    setLinee((prev) => prev.map((l) => (l.id === id ? { ...l, supplement } : l)));
  }

  function prezzoRiga(l: CartLine): number {
    return (l.price_cents + SUPPL[l.supplement]) * l.qty;
  }

  const totale = linee.reduce((s, l) => s + prezzoRiga(l), 0);
  const numArticoli = linee.reduce((s, l) => s + l.qty, 0);

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
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: linee.map((l) => ({ id: l.id, qty: l.qty, supplement: l.supplement })),
          slot,
          note: noteOrdine,
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

  function Supplementi({ l }: { l: CartLine }) {
    if (!isPizza(l.category_order)) return null;
    const opzioni: { val: Supplemento; label: string }[] = [
      { val: "gluten-free", label: t.supplGlutenFree },
      { val: "ricotta", label: t.supplRicotta },
    ];
    function toggle(val: Supplemento) {
      cambiaSupplemento(l.id, l.supplement === val ? "none" : val);
    }
    return (
      <div className="order-suppl">
        {opzioni.map((o) => (
          <button
            key={o.val}
            type="button"
            className={"order-suppl-opt" + (l.supplement === o.val ? " is-on" : "")}
            aria-pressed={l.supplement === o.val}
            onClick={() => toggle(o.val)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  function RigheCarrello({ editabile }: { editabile: boolean }) {
    return (
      <ul className="order-cart-lines">
        {linee.map((l) => (
          <li key={l.id} className="order-cart-line">
            <div className="order-cart-line-top">
              <span className="order-cart-line-name">{l.name}</span>
              <span className="order-cart-line-price">{euro(prezzoRiga(l))}</span>
            </div>
            <div className="order-cart-line-controls">
              <button type="button" onClick={() => cambiaQty(l.id, -1)} aria-label={t.ariaDecrease}>−</button>
              <span className="order-cart-qty">{l.qty}</span>
              <button type="button" onClick={() => cambiaQty(l.id, 1)} aria-label={t.ariaIncrease}>+</button>
              <button type="button" className="order-cart-remove" onClick={() => rimuovi(l.id)} aria-label={t.ariaRemove}>×</button>
            </div>
            {editabile && <Supplementi l={l} />}
          </li>
        ))}
      </ul>
    );
  }

  // =========================================================
  // VISTA CHECKOUT
  // =========================================================
  if (vista === "checkout") {
    return (
      <div className="order-wrap">
        <div className="order-app">
          <div className="order-menu">
            <button type="button" className="order-back" onClick={() => setVista("menu")}>
              {t.backToMenu}
            </button>
            <h2 className="order-section-title">{t.recap}</h2>
            {linee.length === 0 ? (
              <p className="order-cart-empty">{t.cartEmpty}</p>
            ) : (
              <>
                <RigheCarrello editabile={true} />
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
            <SlotPicker onSelect={setSlot} lang={lang} />
            <div className="order-form">
              <input className="order-input" type="text" placeholder={t.firstName} value={nome} onChange={(e) => setNome(e.target.value)} />
              <input className="order-input" type="text" placeholder={t.lastName} value={cognome} onChange={(e) => setCognome(e.target.value)} />
              <input className="order-input" type="tel" placeholder={t.phone} value={telefono} onChange={(e) => setTelefono(e.target.value)} />
              <input className="order-input" type="email" placeholder={t.email} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <label className="order-consent">
              <input type="checkbox" checked={accettato} onChange={(e) => setAccettato(e.target.checked)} />
              <span>
                {t.consentPre}
                <a href={t.privacyHref} target="_blank" rel="noopener">{t.consentLink}</a>
              </span>
            </label>
            <div className="order-cart-total">
              <span>{t.total} ({numArticoli} {t.items})</span>
              <strong>{euro(totale)}</strong>
            </div>
            <button type="button" className="order-cart-checkout" disabled={!formValido || invio} onClick={paga}>
              {invio ? t.paying : t.pay}
            </button>
            {erroreCheckout && <p className="order-cart-error">{erroreCheckout}</p>}
            {!formValido && !erroreCheckout && (
              <p className="order-cart-note">{t.fillAll}</p>
            )}
          </aside>
        </div>
      </div>
    );
  }

  // =========================================================
  // VISTA MENU
  // =========================================================
  return (
    <div className="order-wrap">
      <div className="order-filterbar">
        <div className="order-filterbar-inner">
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
              <div className="order-items">
                {g.items.map((item) => {
                  const desc = lang === "en"
                    ? (item.description_en ?? item.description_fr)
                    : item.description_fr;
                  return (
                    <div key={item.id} className="order-item">
                      <div className="order-item-info">
                        <h3 className="order-item-name">{item.name}</h3>
                        {desc && <p className="order-item-desc">{desc}</p>}
                        <p className="order-item-price">{euro(item.price_cents)}</p>
                      </div>
                      <button type="button" className="order-item-add" aria-label={`${t.ariaAdd} ${item.name}`} onClick={() => aggiungi(item)}>+</button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="order-cart">
          <h2 className="order-cart-title">{t.cartTitle}</h2>
          {linee.length === 0 ? (
            <p className="order-cart-empty">{t.cartEmpty}</p>
          ) : (
            <>
              <RigheCarrello editabile={true} />
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

      {linee.length > 0 && (
        <button type="button" className="order-mobcart" onClick={() => setVista("checkout")}>
          <span className="order-mobcart-count">{numArticoli}</span>
          <span className="order-mobcart-label">{t.seeCart}</span>
          <span className="order-mobcart-total">{euro(totale)}</span>
          <span className="order-mobcart-arrow">→</span>
        </button>
      )}
    </div>
  );
}