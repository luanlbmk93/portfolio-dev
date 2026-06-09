import { About } from "./components/About";
import { Dogita } from "./components/Dogita";
import { Contact } from "./components/Contact";
import { Footer } from "./components/Footer";
import { Hero } from "./components/Hero";
import { Nav } from "./components/Nav";
import { Stack } from "./components/Stack";
import { Work } from "./components/Work";

export default function App() {
  return (
    <>
      <div className="bg-grid" aria-hidden />
      <div className="bg-glow bg-glow--green" aria-hidden />
      <div className="bg-glow bg-glow--cyan" aria-hidden />
      <div className="bg-glow bg-glow--purple" aria-hidden />
      <div className="bg-scanline" aria-hidden />

      <div className="app">
        <Nav />
        <main>
          <Hero />
          <Dogita />
          <Stack />
          <About />
          <Work />
          <Contact />
        </main>
        <Footer />
      </div>
    </>
  );
}
