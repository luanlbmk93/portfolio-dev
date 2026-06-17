import { useEffect, useRef } from "react";
import { GRID_RUN_FRAGMENT } from "../shaders/gridRun";
import { PointerTracker, ShaderRenderer } from "../lib/webglShader";

export function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    let dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
    let renderer: ShaderRenderer | null = null;
    let frame = 0;
    let start = performance.now();

    try {
      renderer = new ShaderRenderer(canvas, dpr, GRID_RUN_FRAGMENT);
      renderer.init();
    } catch (err) {
      console.warn("Shader background indisponível:", err);
      return;
    }

    const size = () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr,
    });

    const pointers = new PointerTracker(size);
    pointers.bind(window);

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
      renderer?.setDpr(dpr);
      renderer?.resize(window.innerWidth, window.innerHeight);
    };

    resize();
    window.addEventListener("resize", resize);

    const loop = (now: number) => {
      if (!renderer) return;
      renderer.updatePointer(pointers.snapshot());
      renderer.render(now - start);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      renderer?.dispose();
    };
  }, []);

  return (
    <div className="shader-bg" aria-hidden>
      <canvas ref={canvasRef} className="shader-bg__canvas" />
      <div className="shader-bg__overlay" />
    </div>
  );
}
