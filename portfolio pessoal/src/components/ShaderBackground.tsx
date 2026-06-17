import { useEffect, useRef } from "react";
import { GRID_RUN_FRAGMENT } from "../shaders/gridRun";
import { PointerTracker, ShaderRenderer } from "../lib/webglShader";

export function ShaderBackground() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

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

    const measure = () => ({
      width: wrap.clientWidth,
      height: wrap.clientHeight,
      dpr,
    });

    const pointers = new PointerTracker(measure);
    pointers.bind(window);

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
      renderer?.setDpr(dpr);
      renderer?.resize(wrap.clientWidth, wrap.clientHeight);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
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
      ro.disconnect();
      window.removeEventListener("resize", resize);
      renderer?.dispose();
    };
  }, []);

  return (
    <div className="shader-bg" ref={wrapRef} aria-hidden>
      <canvas ref={canvasRef} className="shader-bg__canvas" />
      <div className="shader-bg__overlay" />
    </div>
  );
}
