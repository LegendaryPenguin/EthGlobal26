import { useEffect } from "react";
import { WalletBar } from "./components/WalletBar";
import { BorrowTab } from "./components/BorrowTab";

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/// Vouch — single-page borrower experience, themed on the concept art (paper / ink / coral, hand-drawn
/// "ink" marks, scroll-reveal motion). The hero + values + steps tell the story; the real functional
/// flow (World ID verify → terms → claim) lives in the embedded BorrowTab.
export function App() {
  useEffect(() => {
    const nav = document.getElementById("nav");
    const heroArt = document.querySelector<HTMLElement>(".hero-art");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onScroll = () => {
      const y = window.scrollY;
      nav?.classList.toggle("scrolled", y > 10);
      if (heroArt && !reduce) heroArt.style.transform = `translateY(${y * 0.06}px)`; // gentle parallax
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const items = document.querySelectorAll(".rv");
    let io: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window && !reduce) {
      io = new IntersectionObserver(
        (entries) =>
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io!.unobserve(e.target);
            }
          }),
        { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
      );
      items.forEach((el, i) => {
        (el as HTMLElement).style.transitionDelay = `${Math.min(i, 5) * 70}ms`;
        io!.observe(el);
      });
    } else {
      items.forEach((el) => el.classList.add("in"));
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      io?.disconnect();
    };
  }, []);

  return (
    <>
      {/* hand-drawn "ink" roughen filter, referenced by .ink-art */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <filter id="rough">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={1} seed={5} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
          </filter>
        </defs>
      </svg>

      <header className="nav" id="nav">
        <div className="nav-in">
          <a href="#top" className="brand">Vouch</a>
          <nav className="nav-links">
            <a href="#how">How it works</a>
            <a href="#get">Get an advance</a>
          </nav>
          <WalletBar />
        </div>
      </header>

      <main id="top">
        {/* hero */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <p className="eyebrow rv">Credit for real people</p>
              <h1 className="rv">
                Borrow against{" "}
                <span className="u">
                  who you are.
                  <svg viewBox="0 0 300 18" preserveAspectRatio="none" className="ink-art" aria-hidden="true">
                    <path d="M4 11 C 70 4, 150 15, 220 7 S 292 6, 296 11" fill="none" stroke="#D6553A" strokeWidth="4.5" strokeLinecap="round" />
                  </svg>
                </span>
              </h1>
              <p className="lede rv">
                A fair advance on the income you've already earned. No collateral, no credit history —
                approved by a private check on what you really make, and settled in seconds on Arc.
              </p>
              <div className="hero-actions rv">
                <a className="btn btn--primary" href="#get">Get an advance <Arrow /></a>
                <a className="tlink" href="#how">See how it works <Arrow /></a>
              </div>
            </div>
            <div className="hero-art">
              <svg className="mark ink-art rv" viewBox="0 0 320 320" aria-label="Verified human stamp">
                <defs><path id="arc" d="M160 160 m-126 0 a126 126 0 1 1 252 0 a126 126 0 1 1 -252 0" /></defs>
                <circle cx="160" cy="160" r="148" fill="none" stroke="#D6553A" strokeWidth="2.4" />
                <circle cx="160" cy="160" r="134" fill="none" stroke="#D6553A" strokeWidth="1.2" />
                <text fontFamily="Hanken Grotesk,sans-serif" fontSize="13.5" fontWeight="600" letterSpacing="6.5" fill="#D6553A">
                  <textPath href="#arc" startOffset="0">VERIFIED HUMAN · ONE PERSON · GOOD FOR IT · </textPath>
                </text>
                <g fill="none" stroke="#D6553A" strokeWidth="3.4" strokeLinecap="round">
                  <path d="M160 92 C 124 92, 110 134, 113 168 C 116 206, 138 224, 160 228" />
                  <path d="M160 106 C 132 106, 122 140, 125 170 C 128 202, 146 216, 164 218" />
                  <path d="M160 120 C 142 120, 135 148, 137 172 C 139 196, 152 206, 168 207" />
                  <path d="M160 134 C 150 134, 147 152, 148 172 C 149 190, 158 196, 170 196" />
                  <path d="M160 148 C 156 148, 156 160, 156 172 C 156 184, 162 188, 170 187" />
                  <path d="M198 100 C 222 124, 230 150, 227 184 C 225 212, 214 230, 200 240" />
                  <path d="M212 110 C 232 134, 238 158, 235 188" />
                </g>
                <circle cx="161" cy="172" r="3.4" fill="#D6553A" />
              </svg>
            </div>
          </div>
        </section>

        {/* values */}
        <section className="section" id="why">
          <div className="wrap">
            <div className="values">
              <div className="value rv">
                <svg className="vi ink-art" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M24 9 C 16 9, 13 20, 14 28 C 15 38, 21 42, 24 43" /><path d="M24 14 C 18 14, 16 23, 17 30 C 18 38, 23 40, 26 40" /><path d="M24 19 C 20 19, 19 25, 19 30 C 19 36, 23 38, 27 37" /><path d="M31 11 C 38 18, 40 27, 38 36" />
                </svg>
                <h3>Verified, not surveilled</h3>
                <p>One check proves you're a real, unique person. That single fact is your collateral.</p>
              </div>
              <div className="value rv">
                <svg className="vi ink-art" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="11" y="21" width="26" height="19" rx="4" /><path d="M16 21 v-5 a8 8 0 0 1 16 0 v5" /><circle cx="24" cy="30" r="2.4" />
                </svg>
                <h3>Private by design</h3>
                <p>Your income is read inside a sealed box. Only the decision is shared — your numbers stay yours.</p>
              </div>
              <div className="value rv">
                <svg className="vi ink-art" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="24" cy="24" r="15" /><path d="M24 16 v16 M20 20 h6 a3 3 0 0 1 0 6 h-6 M20 26 h7" />
                </svg>
                <h3>Bound to your identity</h3>
                <p>Repayment history lives on a passport that travels with you — and can't be escaped with a new wallet.</p>
              </div>
            </div>
          </div>
        </section>

        {/* how it works */}
        <section className="section" id="how">
          <div className="wrap">
            <div className="sec-head">
              <p className="eyebrow rv">How it works</p>
              <h2 className="rv">Verified to funded in minutes.</h2>
            </div>
            <div className="steps">
              <div className="step rv">
                <svg className="si ink-art" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <circle cx="30" cy="30" r="24" /><path d="M30 17 C 23 17, 20 27, 21 34 C 22 43, 28 47, 31 48" stroke="#D6553A" /><path d="M30 23 C 25 23, 23 31, 24 37 C 25 44, 30 46, 33 45" stroke="#D6553A" /><path d="M36 19 C 44 26, 46 35, 43 44" stroke="#D6553A" />
                </svg>
                <div className="sn">STEP 01</div><h3>Prove you're human</h3>
                <p>One World ID check. One person, one identity, kept for good — no respawning.</p>
              </div>
              <div className="step rv">
                <svg className="si ink-art" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="14" y="26" width="32" height="22" rx="4" /><path d="M20 26 v-6 a10 10 0 0 1 20 0 v6" /><circle cx="30" cy="37" r="3" stroke="#D6553A" />
                </svg>
                <div className="sn">STEP 02</div><h3>Private income check</h3>
                <p>A sealed box reads what you really earn. Only the “yes” and your terms come out.</p>
              </div>
              <div className="step rv">
                <svg className="si ink-art" viewBox="0 0 60 60" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="30" cy="32" r="15" /><path d="M30 24 v16 M26 28 h6 a3 3 0 0 1 0 6 h-6 M26 34 h7" /><path d="M11 18 q14 -12 30 -4" stroke="#D6553A" /><path d="M11 18 l0 -8 9 3" stroke="#D6553A" />
                </svg>
                <div className="sn">STEP 03</div><h3>Funded, and you grow</h3>
                <p>USDC lands in seconds. Repay from income, and your passport limit climbs.</p>
              </div>
            </div>
          </div>
        </section>

        {/* the real flow */}
        <section className="section app-sec" id="get">
          <div className="wrap app-grid">
            <div className="sec-head rv">
              <p className="eyebrow">Your advance</p>
              <h2>Borrow against who you are.</h2>
              <p>
                Verify once, and your credit passport is bound to your person — not your wallet. Connect,
                verify, and claim your advance on Arc.
              </p>
            </div>
            <div className="rv">
              <BorrowTab />
            </div>
          </div>
        </section>

        {/* closing */}
        <section className="closing">
          <div className="wrap">
            <h2 className="rv">Your income is your credit.</h2>
            <p className="rv">A fair shot for the people the system can't see. That starts here.</p>
            <a className="btn btn--primary rv" href="#get">Get an advance <Arrow /></a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <div className="foot-in">
            <a href="#top" className="brand">Vouch</a>
            <nav className="foot-links">
              <a href="#how">How it works</a>
              <a href="#get">Get an advance</a>
            </nav>
          </div>
          <p className="foot-note">Built on World ID, Chainlink &amp; Arc · Arc Testnet (5042002) · gas paid in USDC.</p>
        </div>
      </footer>
    </>
  );
}
