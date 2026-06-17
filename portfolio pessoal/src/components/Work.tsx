import { profile, projects } from "../data/portfolio";
import { Reveal } from "./Reveal";

export function Work() {
  return (
    <section id="work" className="section">
      <div className="container">
        <Reveal>
          <p className="section-label">work</p>
          <h2 className="section-title">Outros projetos</h2>
          <p className="section-desc">
            Repositórios open source no{" "}
            <a
              href={profile.links.github}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--cyan)" }}
            >
              @{profile.handle}
            </a>
            . O case principal —{" "}
            <a href="#dogita" style={{ color: "var(--cyan)" }}>
              DOGITA
            </a>{" "}
            — está na seção acima.
          </p>
        </Reveal>

        <div className="projects-grid">
          {projects.map((p, i) => (
            <Reveal key={p.title} delay={(Math.min(i, 3)) as 0 | 1 | 2 | 3}>
              <article className="project-card">
                <span className="project-type">{p.type}</span>
                <h3>{p.title}</h3>
                <p>{p.desc}</p>
                <div className="project-tags">
                  {p.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="project-links">
                  {p.links.demo &&
                    p.links.demo !== p.links.repo &&
                    !p.links.demo.endsWith("#") && (
                      <a href={p.links.demo} target="_blank" rel="noopener noreferrer">
                        live →
                      </a>
                    )}
                  {p.links.repo ? (
                    <a href={p.links.repo} target="_blank" rel="noopener noreferrer">
                      github →
                    </a>
                  ) : null}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
