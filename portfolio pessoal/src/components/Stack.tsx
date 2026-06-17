import { domains } from "../data/portfolio";
import { Reveal } from "./Reveal";

export function Stack() {
  return (
    <section id="stack" className="section">
      <div className="container">
        <Reveal>
          <p className="section-label">stack</p>
          <h2 className="section-title">Onde eu opero</h2>
          <p className="section-desc">
            Três frentes, um objetivo: software que funciona em produção e
            escala sem drama.
          </p>
        </Reveal>

        <div className="domains-grid gsap-stagger-group">
          {domains.map((d) => (
            <article key={d.id} className={`domain-card domain-card--${d.color} gsap-stagger-item`}>
                <div className="domain-icon">{d.icon}</div>
                <h3>{d.title}</h3>
                <p>{d.desc}</p>
                <div className="domain-tags">
                  {d.stack.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
