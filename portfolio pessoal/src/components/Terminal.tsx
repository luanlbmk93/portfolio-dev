import { useEffect, useState } from "react";
import { terminalLines } from "../data/portfolio";

export function Terminal() {
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<"cmd" | "out" | "pause">("cmd");
  const [history, setHistory] = useState<
    { cmd: string; out: string; cmdShown: string; outShown: string }[]
  >([]);

  const current = terminalLines[lineIndex];
  const activeText =
    phase === "cmd"
      ? current?.cmd.slice(0, charIndex) ?? ""
      : phase === "out"
        ? current?.out.slice(0, charIndex) ?? ""
        : "";

  useEffect(() => {
    if (!current) return;

    const speed = phase === "cmd" ? 55 : 28;

    if (phase === "pause") {
      const t = setTimeout(() => {
        setHistory((h) => [
          ...h,
          { cmd: current.cmd, out: current.out, cmdShown: current.cmd, outShown: current.out },
        ]);
        setLineIndex((i) => (i + 1) % terminalLines.length);
        setCharIndex(0);
        setPhase("cmd");
      }, 1200);
      return () => clearTimeout(t);
    }

    const target = phase === "cmd" ? current.cmd : current.out;
    if (charIndex >= target.length) {
      if (phase === "cmd") {
        setPhase("out");
        setCharIndex(0);
      } else {
        setPhase("pause");
      }
      return;
    }

    const t = setInterval(() => setCharIndex((c) => c + 1), speed);
    return () => clearInterval(t);
  }, [charIndex, phase, current, lineIndex]);

  const displayHistory = history.slice(-3);

  return (
    <div className="terminal">
      <div className="terminal-bar">
        <span className="terminal-dot terminal-dot--red" />
        <span className="terminal-dot terminal-dot--yellow" />
        <span className="terminal-dot terminal-dot--green" />
        <span className="terminal-title">luan@dev — zsh</span>
      </div>
      <div className="terminal-body">
        {displayHistory.map((h, i) => (
          <div key={i}>
            <div className="terminal-line">
              <span className="terminal-prompt">❯ </span>
              <span className="terminal-cmd">{h.cmdShown}</span>
            </div>
            <div className="terminal-out">{h.outShown}</div>
          </div>
        ))}
        {current && phase !== "pause" && (
          <div>
            <div className="terminal-line">
              <span className="terminal-prompt">❯ </span>
              <span className="terminal-cmd">
                {phase === "cmd" ? activeText : current.cmd}
              </span>
              {phase === "cmd" && <span className="terminal-cursor" />}
            </div>
            {(phase === "out" || (phase === "cmd" && charIndex >= current.cmd.length)) && (
              <div className="terminal-out">
                {phase === "out" ? activeText : ""}
                {phase === "out" && <span className="terminal-cursor" />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
