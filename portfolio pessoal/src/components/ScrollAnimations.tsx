import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function ScrollAnimations() {
  useGSAP(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      gsap.set(".gsap-reveal, .gsap-stagger-item, .gsap-hero-word", { clearProps: "all" });
      return;
    }

    gsap.set(".gsap-reveal", { y: 48, opacity: 0 });
    gsap.set(".gsap-stagger-item", { y: 36, opacity: 0 });
    gsap.set(".gsap-hero-word", { yPercent: 110, opacity: 0, rotateX: -28 });
    gsap.set(".gsap-hero-fade", { y: 24, opacity: 0 });
    gsap.set(".terminal", { y: 40, opacity: 0, scale: 0.96 });
    gsap.set(".scroll-progress", { scaleX: 0, transformOrigin: "left center" });

    const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
    intro
      .to(".gsap-hero-badge", { y: 0, opacity: 1, duration: 0.55 }, 0.1)
      .to(".gsap-hero-word", { yPercent: 0, opacity: 1, rotateX: 0, duration: 0.75, stagger: 0.035 }, 0.2)
      .to(".gsap-hero-fade", { y: 0, opacity: 1, duration: 0.65, stagger: 0.08 }, 0.45)
      .to(".terminal", { y: 0, opacity: 1, scale: 1, duration: 0.9, ease: "power2.out" }, 0.55);

    gsap.to(".scroll-progress", {
      scaleX: 1,
      ease: "none",
      scrollTrigger: {
        trigger: document.body,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.3,
      },
    });

    gsap.to(".bg-glow--green", {
      y: 180,
      ease: "none",
      scrollTrigger: { trigger: "main", start: "top top", end: "bottom bottom", scrub: 1.2 },
    });
    gsap.to(".bg-glow--cyan", {
      y: -120,
      ease: "none",
      scrollTrigger: { trigger: "main", start: "top top", end: "bottom bottom", scrub: 1.2 },
    });
    gsap.to(".bg-glow--purple", {
      y: 100,
      x: -60,
      ease: "none",
      scrollTrigger: { trigger: "main", start: "top top", end: "bottom bottom", scrub: 1.2 },
    });

    gsap.timeline({
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "+=75%",
        pin: true,
        scrub: 1.4,
        anticipatePin: 1,
      },
    })
      .to(".gsap-hero-content", { y: -72, opacity: 0.15, ease: "power1.inOut" }, 0)
      .to(".terminal", { y: -48, scale: 1.06, ease: "power1.inOut" }, 0)
      .to(".hero", { "--hero-dim": 0.4 }, 0);

    gsap.timeline({
      scrollTrigger: {
        trigger: ".dogita-pin-wrap",
        start: "top top",
        end: "+=100%",
        pin: ".dogita-pin-inner",
        scrub: 1.6,
        anticipatePin: 1,
      },
    })
      .fromTo(".dogita-title", { scale: 1 }, { scale: 1.06, ease: "none" }, 0)
      .fromTo(".dogita-metrics-panel", { y: 60, opacity: 0.7 }, { y: 0, opacity: 1, ease: "none" }, 0)
      .fromTo(".dogita-hero-content", { y: 0 }, { y: -40, ease: "none" }, 0);

    gsap.utils.toArray<HTMLElement>(".gsap-reveal").forEach((el) => {
      const delay = Number(el.dataset.delay || 0);
      gsap.to(el, {
        y: 0,
        opacity: 1,
        duration: 0.85,
        delay,
        ease: "power3.out",
        scrollTrigger: {
          trigger: el,
          start: "top 88%",
          toggleActions: "play none none reverse",
        },
      });
    });

    gsap.utils.toArray<HTMLElement>(".gsap-stagger-group").forEach((group) => {
      const items = group.querySelectorAll(".gsap-stagger-item");
      gsap.to(items, {
        y: 0,
        opacity: 1,
        duration: 0.75,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: group,
          start: "top 85%",
          toggleActions: "play none none reverse",
        },
      });
    });

    gsap.fromTo(
      ".contact-panel",
      { y: 60, opacity: 0, scale: 0.97 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".contact-panel",
          start: "top 82%",
          toggleActions: "play none none reverse",
        },
      }
    );

    gsap.fromTo(
      ".section-title",
      { clipPath: "inset(0 100% 0 0)" },
      {
        clipPath: "inset(0 0% 0 0)",
        duration: 1.1,
        ease: "power4.out",
        scrollTrigger: {
          trigger: ".section-title",
          start: "top 90%",
          toggleActions: "play none none none",
        },
      }
    );

    return () => {
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  return <div className="scroll-progress" aria-hidden />;
}
