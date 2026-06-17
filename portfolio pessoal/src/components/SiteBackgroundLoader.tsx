import { lazy, Suspense, useEffect, useRef, useState } from "react";

const SiteBackground = lazy(() =>
  import("./SiteBackground").then((m) => ({ default: m.SiteBackground })),
);

export function SiteBackgroundLoader() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px 0px", threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} className="site-bg-sentinel" aria-hidden />
      {ready && (
        <Suspense fallback={null}>
          <SiteBackground />
        </Suspense>
      )}
    </>
  );
}
