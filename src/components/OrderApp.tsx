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
  price_cents: number; // prezzo EFFETTIVO (sconti già applicati)
  original_price_cents: number | null; // pieno, solo se scontato
  image_url: string | null;
  is_bestseller: boolean;
  is_vegan: boolean;
  is_spicy: boolean;
  is_suggestion: boolean;
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
}

interface OrderAppProps {
  menu: MenuCategoria[];
  t: OrderStrings;
  lang: "fr" | "en";
  closedToday?: boolean;
}

type Vista = "menu" | "checkout";

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

export default function OrderApp({ menu, t, lang, closedToday = false }: OrderAppProps) {
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

  function aggiungi(item: MenuItem) {
    setLinee((prev) => {
      const esistente = prev.find((l) => l.id === item.id);
      if (esistente) {
        return prev.map((l) => (l.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        { id: item.id, name: item.name, price_cents: item.price_cents, qty: 1 },
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

  // Rimozione con conferma in 2 tap (come nell'admin): il primo tap
  // trasforma il cestino in "Confirmer ?" per 3 secondi, il secondo elimina.
  const [daConfermare, setDaConfermare] = useState<string | null>(null);
  const timerConferma = useRef<number | null>(null);

  function clickRimuovi(id: string) {
    if (timerConferma.current) window.clearTimeout(timerConferma.current);
    if (daConfermare === id) {
      setDaConfermare(null);
      rimuovi(id);
      return;
    }
    setDaConfermare(id);
    timerConferma.current = window.setTimeout(() => setDaConfermare(null), 3000);
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
      const res = await fetch("/api/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          items: linee.map((l) => ({ id: l.id, qty: l.qty })),
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
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: linee.map((l) => ({ id: l.id, qty: l.qty })),
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
          <span className="order-b" title={lang === "en" ? "Vegan" : "Végan"}>🌱</span>
        )}
        {item.is_spicy && (
          <span className="order-b" title={lang === "en" ? "Spicy" : "Épicé"}>🌶️</span>
        )}
        {item.is_suggestion && <span className="order-sugg">Suggestion</span>}
      </>
    );
  }

  function RigheCarrello() {
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
              <button
                type="button"
                className={"order-cart-remove" + (daConfermare === l.id ? " confirm" : "")}
                onClick={() => clickRimuovi(l.id)}
                aria-label={t.ariaRemove}
              >
                {daConfermare === l.id ? (
                  lang === "en" ? "Confirm?" : "Confirmer ?"
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
            <h2 className="order-section-title">{t.recap}</h2>
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
            <SlotPicker onSelect={setSlot} lang={lang} />
            <div className="order-form">
              <input className="order-input" type="text" placeholder={t.firstName} value={nome} onChange={(e) => setNome(e.target.value)} />
              <input className="order-input" type="text" placeholder={t.lastName} value={cognome} onChange={(e) => setCognome(e.target.value)} />
              <input className="order-input" type="tel" placeholder={t.phone} value={telefono} onChange={(e) => setTelefono(e.target.value)} />
              <input className="order-input" type="email" placeholder={t.email} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="order-coupon">
              <label className="order-field-label" htmlFor="order-coupon-field">{t.coupon}</label>
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
                <div className="order-coupon-row">
                  <input
                    id="order-coupon-field"
                    className="order-input"
                    type="text"
                    autoComplete="off"
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
                      const desc = lang === "en"
                        ? (item.description_en ?? item.description_fr)
                        : item.description_fr;
                      return (
                        <div key={item.id} className="order-item">
                          <div className="order-item-info">
                            <h3 className="order-item-name">
                              {item.name}
                              <Badges item={item} />
                            </h3>
                            {desc && <p className="order-item-desc">{desc}</p>}
                            <p className="order-item-price">
                              {item.original_price_cents && (
                                <s className="order-item-old">{euro(item.original_price_cents)}</s>
                              )}
                              {euro(item.price_cents)}
                            </p>
                          </div>
                          <button type="button" className="order-item-add" aria-label={`${t.ariaAdd} ${item.name}`} onClick={() => aggiungi(item)}>+</button>
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
    </div>
  );
}
