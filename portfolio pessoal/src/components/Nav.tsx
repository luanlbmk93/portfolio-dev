import { useEffect, useState } from "react";
import { profile } from "../data/portfolio";

const links = [
  { href: "#dogita", label: "DOGITA" },
  { href: "#stack", label: "tecnologias" },
  { href: "#about", label: "sobre" },
  { href: "#work", label: "projetos" },
  { href: "#contact", label: "contato" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`nav ${scrolled ? "is-scrolled" : ""} ${open ? "is-open" : ""}`}>
      <div className="nav-inner">
        <a href="#" className="nav-logo" onClick={() => setOpen(false)}>
          <span>&lt;</span>
          {profile.handle}
          <span>/&gt;</span>
        </a>

        <ul className="nav-links">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <a href="#contact" className="nav-cta" onClick={() => setOpen(false)}>
          contratar()
        </a>

        <button
          type="button"
          className="nav-toggle"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </nav>
  );
}
