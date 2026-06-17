import { useRef } from "react";
import { profile, stats } from "../data/portfolio";
import { HeroHeadline } from "./HeroHeadline";
import { HeroParallax } from "./HeroParallax";
import { Terminal } from "./Terminal";

export function Hero() {
  const heroRef = useRef<HTMLElement>(null);

  return (
    <section className="hero" ref={heroRef}>
      <HeroParallax sectionRef={heroRef} />
      <div className="container hero-grid hero-content">
        <div>
          <div className="hero-badge">
            <span className="dot" />
            disponível para projetos · {profile.location}
          </div>

          <HeroHeadline />

          <div className="hero-actions">
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

          <div className="hero-stats">
            {stats.map((s) => (
              <div key={s.label} className="hero-stat">
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="hero-terminal-wrap">
          <Terminal />
        </div>
      </div>
    </section>
  );
}
