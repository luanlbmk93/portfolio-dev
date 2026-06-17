import { profile } from "../data/portfolio";
import { Reveal } from "./Reveal";

export function Contact() {
  return (
    <section id="contact" className="section">
      <div className="container">
        <Reveal>
          <p className="section-label">contact</p>
          <h2 className="section-title">Vamos construir algo</h2>
          <p className="section-desc">
            Freelance, full-time ou parceria técnica — se o problema é
            interessante, a conversa vale.
          </p>
        </Reveal>

        <div className="contact-panel">
            <h3>git push origin opportunity</h3>
            <p>Respondo rápido. Sem formulário chato — canal direto.</p>
            <div className="contact-links">
              <a href={`mailto:${profile.email}`} className="contact-link contact-link--primary">
                ✉ {profile.email}
              </a>
              <a
                href={profile.links.github}
                className="contact-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                href={profile.links.linkedin}
                className="contact-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                LinkedIn
              </a>
              <a
                href={profile.links.instagram}
                className="contact-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                @odevcwb
              </a>
            </div>
          </div>
      </div>
    </section>
  );
}
