import { useEffect, useRef, useState } from "react";

const SCRAMBLE = "!<>-_\\/[]{}—=+*^?#@&%$~`|01";

function randomGlyph() {
  return SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
}

function buildFrame(text: string, locked: number) {
  return text
    .split("")
    .map((ch, i) => {
      if (i < locked) return ch;
      if (ch === " ") return " ";
      return randomGlyph();
    })
    .join("");
}

type GeneratingTextProps = {
  text: string;
  start: boolean;
  done?: boolean;
  className?: string;
  charMs?: number;
  scrambleMs?: number;
  onComplete?: () => void;
  as?: "span" | "p";
};

export function GeneratingText({
  text,
  start,
  done = false,
  className,
  charMs = 38,
  scrambleMs = 30,
  onComplete,
  as: Tag = "span",
}: GeneratingTextProps) {
  const [locked, setLocked] = useState(done ? text.length : 0);
  const [frame, setFrame] = useState(done ? text : "");
  const [finished, setFinished] = useState(done);
  const completedRef = useRef(done);

  useEffect(() => {
    if (done) {
      setLocked(text.length);
      setFrame(text);
      setFinished(true);
      completedRef.current = true;
    }
  }, [done, text]);

  useEffect(() => {
    if (!start || completedRef.current) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setFrame(text);
      setLocked(text.length);
      setFinished(true);
      completedRef.current = true;
      onComplete?.();
      return;
    }

    let lock = 0;
    setFinished(false);
    setLocked(0);
    setFrame(buildFrame(text, 0));

    const scrambleTimer = window.setInterval(() => {
      setFrame(buildFrame(text, lock));
    }, scrambleMs);

    const lockTimer = window.setInterval(() => {
      lock += 1;
      setLocked(lock);
      if (lock >= text.length) {
        window.clearInterval(scrambleTimer);
        window.clearInterval(lockTimer);
        setFrame(text);
        setFinished(true);
        completedRef.current = true;
        onComplete?.();
      }
    }, charMs);

    return () => {
      window.clearInterval(scrambleTimer);
      window.clearInterval(lockTimer);
    };
  }, [start, text, charMs, scrambleMs, onComplete]);

  const showCursor = start && !finished;

  return (
    <Tag className={className}>
      {frame.split("").map((ch, i) => {
        const isScramble = i >= locked && ch !== " ";
        return (
          <span key={i} className={isScramble ? "hero-glyph" : undefined}>
            {ch}
          </span>
        );
      })}
      {showCursor && <span className="hero-type-cursor" aria-hidden />}
    </Tag>
  );
}
