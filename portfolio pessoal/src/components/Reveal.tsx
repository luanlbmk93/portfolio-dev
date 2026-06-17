import { type ReactNode } from "react";
import { useInView } from "../hooks/useInView";

type Props = {
  children: ReactNode;
  className?: string;
  delay?: 0 | 1 | 2 | 3;
};

export function Reveal({ children, className = "", delay = 0 }: Props) {
  const { ref, visible } = useInView();
  const delayClass = delay ? ` reveal-delay-${delay}` : "";

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""}${delayClass} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
