import { About } from "./components/About";
import { Dogita } from "./components/Dogita";
import { Contact } from "./components/Contact";
import { Footer } from "./components/Footer";
import { Hero } from "./components/Hero";
import { Nav } from "./components/Nav";
import { ShaderBackground } from "./components/ShaderBackground";
import { Stack } from "./components/Stack";
import { Work } from "./components/Work";

export default function App() {
  return (
    <div className="app">
      <Nav />
      <main>
        <Hero />
        <div className="site-body">
          <ShaderBackground />
          <div className="bg-grid" aria-hidden />
          <Dogita />
          <Stack />
          <About />
          <Work />
          <Contact />
          <Footer />
        </div>
      </main>
    </div>
  );
}
