import { type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  delay?: 0 | 1 | 2 | 3;
};

export function Reveal({ children, className = "", delay = 0 }: Props) {
  return (
    <div
      className={`gsap-reveal ${className}`.trim()}
      data-delay={delay ? delay * 0.12 : 0}
    >
      {children}
    </div>
  );
}
