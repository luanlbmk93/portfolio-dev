import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";

gsap.registerPlugin(ScrollTrigger);

const BG = 0x05070c;
const GREEN = 0x39ff14;
const CYAN = 0x00d4ff;
const PURPLE = 0xb47aff;

function pickColor(i: number, out: THREE.Color) {
  const r = (i * 0.618) % 1;
  if (r < 0.38) out.setHex(GREEN);
  else if (r < 0.72) out.setHex(CYAN);
  else out.setHex(PURPLE);
  out.multiplyScalar(0.45 + (i % 7) * 0.08);
}

export function SiteBackground() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 768px)").matches;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(BG, mobile ? 0.045 : 0.032);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    camera.position.set(0, 0.4, 11);

    const renderer = new THREE.WebGLRenderer({
      antialias: !mobile,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1 : 1.5));
    renderer.setClearColor(BG, 1);
    renderer.domElement.className = "site-bg__canvas";
    root.prepend(renderer.domElement);

    const count = mobile ? 900 : 2400;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const tmp = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const radius = 6 + Math.random() * 22;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1) * 0.55 + 0.2;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 2] = radius * Math.cos(phi) * 0.6 - 8;

      pickColor(i, tmp);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
      seeds[i] = Math.random() * Math.PI * 2;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const particles = new THREE.Points(
      particleGeo,
      new THREE.PointsMaterial({
        size: mobile ? 0.07 : 0.05,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    scene.add(particles);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.2, 0.03, 8, 120),
      new THREE.MeshBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = Math.PI * 0.42;
    scene.add(ring);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.2, 1),
      new THREE.MeshBasicMaterial({
        color: GREEN,
        wireframe: true,
        transparent: true,
        opacity: 0.14,
      }),
    );
    core.position.set(4.2, 0.8, -5);
    scene.add(core);

    const halo = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.1, 0),
      new THREE.MeshBasicMaterial({
        color: PURPLE,
        wireframe: true,
        transparent: true,
        opacity: 0.1,
      }),
    );
    halo.position.set(-3.8, -1.2, -7);
    scene.add(halo);

    const grid = new THREE.GridHelper(70, 50, GREEN, 0x0c1814);
    grid.position.y = -7.5;
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.12;
    scene.add(grid);

    const disposers: Array<() => void> = [
      () => particleGeo.dispose(),
      () => (particles.material as THREE.Material).dispose(),
      () => ring.geometry.dispose(),
      () => (ring.material as THREE.Material).dispose(),
      () => core.geometry.dispose(),
      () => (core.material as THREE.Material).dispose(),
      () => halo.geometry.dispose(),
      () => (halo.material as THREE.Material).dispose(),
      () => grid.geometry.dispose(),
      gridMat.dispose,
      () => renderer.dispose(),
    ];

    let mouseX = 0;
    let mouseY = 0;
    const onMove = (e: PointerEvent) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    if (!mobile && !reduced) {
      window.addEventListener("pointermove", onMove, { passive: true });
      disposers.push(() => window.removeEventListener("pointermove", onMove));
    }

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    window.addEventListener("resize", resize);
    disposers.push(() => window.removeEventListener("resize", resize));

    const siteBody = root.closest(".site-body");
    let scrollY = 0;
    let scrollSt: ScrollTrigger | undefined;

    if (siteBody && !reduced) {
      scrollSt = ScrollTrigger.create({
        trigger: siteBody,
        start: "top bottom",
        end: "bottom bottom",
        scrub: 1.2,
        onUpdate: (self) => {
          scrollY = self.progress;
        },
      });
      disposers.push(() => scrollSt?.kill());
    }

    const clock = new THREE.Clock();
    let frame = 0;

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const pos = particleGeo.attributes.position as THREE.BufferAttribute;

      if (!reduced) {
        for (let i = 0; i < count; i++) {
          const y = positions[i * 3 + 1];
          pos.array[i * 3 + 1] =
            y + Math.sin(t * 0.35 + seeds[i]) * 0.012 + scrollY * 0.02;
        }
        pos.needsUpdate = true;

        particles.rotation.y = t * 0.018 + scrollY * 1.1;
        ring.rotation.z = t * 0.06;
        core.rotation.x = t * 0.11;
        core.rotation.y = t * 0.16;
        halo.rotation.x = t * -0.09;
        halo.rotation.y = t * 0.12;
      }

      const targetX = mouseX * 1.4;
      const targetY = -mouseY * 0.9 + scrollY * -1.8;
      camera.position.x += (targetX - camera.position.x) * 0.035;
      camera.position.y += (targetY - camera.position.y) * 0.035;
      camera.position.z = 11 - scrollY * 2.5;
      camera.lookAt(0, scrollY * -1.2, -2);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      disposers.forEach((d) => d());
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="site-bg" ref={rootRef} aria-hidden>
      <div className="site-bg__vignette" />
      <div className="site-bg__glow site-bg__glow--green" />
      <div className="site-bg__glow site-bg__glow--purple" />
    </div>
  );
}
