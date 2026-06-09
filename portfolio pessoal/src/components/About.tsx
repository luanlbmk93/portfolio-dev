import { principles, profile } from "../data/portfolio";
import { Reveal } from "./Reveal";

export function About() {
  return (
    <section id="about" className="section">
      <div className="container">
        <Reveal>
          <p className="section-label">about</p>
          <h2 className="section-title">Mais que código</h2>
        </Reveal>

        <div className="about-grid">
          <Reveal className="about-text" delay={1}>
            <p>
              Sou <strong>{profile.name}</strong>, desenvolvedor com foco em{" "}
              <strong>backend</strong>, <strong>fullstack</strong> e{" "}
              <strong>blockchain</strong>. Gosto de ir fundo: entender o
              domínio, modelar bem a arquitetura e entregar algo que o próximo
              dev agradeça de manter.
            </p>
            <p>
              Fui <strong>Diretor de Tecnologia da DOGITA</strong> — memecoin
              multichain que chegou a <strong>US$ 9M+ em market cap</strong> com
              mais de 10 mil holders. Liderei contratos em múltiplas redes,
              staking, dividendos em XAUT, NFTs, migração 1:1, auditoria CertiK
              e o desenvolvimento da <strong>Dogita Chain</strong>, uma L1 EVM
              PoA com DEX e token factory.
            </p>
            <p>
              Trato performance, segurança e observabilidade como requisitos —
              não como extras de sprint 47.
            </p>
            <p>
              Fora do editor: aprender protocolos novos, contribuir em open
              source e debater trade-offs com quem também vive no terminal.
            </p>
          </Reveal>

          <Reveal delay={2}>
            <ul className="principles">
              {principles.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={1}>
          <pre className="code-block" style={{ marginTop: "2.5rem" }}>
            <code>
              <span className="cm">{"// developer.config.ts"}</span>
              {"\n"}
              <span className="kw">export const</span> dev = {"{"}
              {"\n  "}
              <span className="fn">name</span>: <span className="str">"{profile.name}"</span>,
              {"\n  "}
              <span className="fn">role</span>: <span className="str">"CTO @ DOGITA"</span>,
              {"\n  "}
              <span className="fn">peakMcap</span>: <span className="str">"$9M+"</span>,
              {"\n  "}
              <span className="fn">modes</span>: [
              <span className="str"> "backend"</span>,
              <span className="str"> "fullstack"</span>,
              <span className="str"> "web3"</span>],
              {"\n  "}
              <span className="fn">strict</span>: <span className="kw">true</span>,
              {"\n  "}
              <span className="fn">shipIt</span>: <span className="kw">async</span> () =&gt;{" "}
              <span className="str">"🚀"</span>,
              {"\n"}
              {"}"} <span className="kw">as const</span>;
            </code>
          </pre>
        </Reveal>
      </div>
    </section>
  );
}
