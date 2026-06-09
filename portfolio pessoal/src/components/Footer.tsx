import { profile } from "../data/portfolio";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container footer-inner">
        <p>
          © {year} {profile.name} · built with{" "}
          <a href="https://vite.dev" target="_blank" rel="noopener noreferrer">
            Vite
          </a>{" "}
          + React
        </p>
        <p className="footer-status">
          <span className="dot" />
          systems operational
        </p>
      </div>
    </footer>
  );
}
