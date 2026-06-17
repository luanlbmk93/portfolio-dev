import { profile, stats } from "../data/portfolio";
import { Terminal } from "./Terminal";

function SplitWords({ text, className = "" }: { text: string; className?: string }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="gsap-hero-word-wrap">
          <span className={`gsap-hero-word ${className}`.trim()}>{word}</span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="gsap-hero-content">
          <div className="hero-badge gsap-hero-fade gsap-hero-badge">
            <span className="dot" />
            disponível para projetos · {profile.location}
          </div>

          <h1>
            <SplitWords text="Olá, meu nome é" />
            <br />
            <span className="accent gsap-hero-word-wrap">
              <span className="accent gsap-hero-word">{profile.name}</span>
            </span>
            <span className="gsap-hero-word">,</span>
            <br />
            <SplitWords text="Desenvolvedor de Software" />
          </h1>

          <p className="hero-tagline gsap-hero-fade">{profile.tagline}</p>

          <div className="hero-actions gsap-hero-fade">
            <a href="#dogita" className="btn btn-primary">
              ver DOGITA →
            </a>
            <a
              href={profile.links.github}
              className="btn btn-ghost"
              target="_blank"
              rel="noopener noreferrer"
            >
              github ↗
            </a>
          </div>

          <div className="hero-stats gsap-hero-fade">
            {stats.map((s) => (
              <div key={s.label} className="hero-stat">
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <Terminal />
      </div>
    </section>
  );
}
