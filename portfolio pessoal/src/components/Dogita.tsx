import { dogita } from "../data/portfolio";
import { Reveal } from "./Reveal";

export function Dogita() {
  return (
    <section id="dogita" className="section dogita-section">
      <div className="container">
        <Reveal>
          <p className="section-label">flagship</p>
        </Reveal>

        <div className="dogita-hero">
          <Reveal delay={1}>
            <div className="dogita-hero-content">
              <div className="dogita-role-badge">{dogita.role}</div>
              <h2 className="dogita-title">{dogita.name}</h2>
              <p className="dogita-subtitle">{dogita.subtitle}</p>
              <p className="dogita-desc">{dogita.description}</p>
              <p className="dogita-narrative">{dogita.narrative}</p>

              <div className="dogita-actions">
                <a
                  href={dogita.links.site}
                  className="btn btn-primary dogita-btn"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  dogita.io →
                </a>
                <a
                  href={dogita.links.whitepaper}
                  className="btn btn-ghost"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  whitepaper ↗
                </a>
              </div>
            </div>
          </Reveal>

          <Reveal delay={2}>
            <div className="dogita-metrics-panel">
              <div className="dogita-metrics-grid">
                {dogita.metrics.map((m) => (
                  <div key={m.label} className="dogita-metric">
                    <strong>{m.value}</strong>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>

              <div className="dogita-listing">
                <span className="dogita-listing-label">listado em</span>
                <p>{dogita.listing}</p>
              </div>

              <div className="dogita-stack-row">
                {dogita.techStack.map((t) => (
                  <span key={t} className="dogita-stack-tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={1}>
          <h3 className="dogita-modules-title">O que construí — stack técnica</h3>
        </Reveal>

        <div className="dogita-modules-grid">
          {dogita.modules.map((m, i) => (
            <Reveal key={m.title} delay={(Math.min(i, 3)) as 0 | 1 | 2 | 3}>
              <article className="dogita-module">
                <span className="dogita-module-icon">{m.icon}</span>
                <h4>{m.title}</h4>
                <p>{m.desc}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={1}>
          <div className="dogita-chain-panel">
            <div className="dogita-chain-header">
              <div>
                <p className="dogita-chain-label">Dogita Chain · L1</p>
                <h3>Proof-of-Authority EVM — mainnet-grade stack</h3>
                <p>
                  Rede própria com Besu validators, blocos rápidos (~5s), tooling
                  familiar (MetaMask, explorers, routers) e módulos de DEX +
                  token factory para criadores lançarem tokens permissionless.
                </p>
              </div>
              <div className="dogita-chain-badge">
                <span>CHAIN</span>
                <strong>7777777</strong>
                <small>PoA · EVM</small>
              </div>
            </div>

            <div className="dogita-chain-arch">
              <div className="dogita-arch-node">MetaMask</div>
              <span className="dogita-arch-arrow">→</span>
              <div className="dogita-arch-node dogita-arch-node--core">
                Besu PoA
                <small>RPC :8545 · block ~5s</small>
              </div>
              <span className="dogita-arch-arrow">→</span>
              <div className="dogita-arch-node">
                Explorer
                <small>:8080</small>
              </div>
              <div className="dogita-arch-node">
                Faucet
                <small>:3080</small>
              </div>
              <div className="dogita-arch-node">
                DogitaSwap
                <small>:3090 · DEX</small>
              </div>
            </div>

            <ul className="dogita-chain-modules">
              {dogita.chainModules.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
