import { useState } from "react";
import { profile } from "../data/portfolio";
import { GeneratingText } from "./GeneratingText";

export function HeroHeadline() {
  const [step, setStep] = useState(1);

  return (
    <>
      <h1>
        <GeneratingText
          start={step >= 1}
          done={step > 1}
          text="Olá, meu nome é "
          onComplete={() => setStep(2)}
        />
        {step >= 2 && (
          <GeneratingText
            start={step >= 2}
            done={step > 2}
            text={profile.name}
            className="accent"
            charMs={32}
            onComplete={() => setStep(3)}
          />
        )}
        {step >= 3 && (
          <>
            <GeneratingText
              start={step >= 3}
              done={step > 3}
              text=","
              charMs={50}
              onComplete={() => setStep(4)}
            />
            <br />
            <GeneratingText
              start={step >= 4}
              done={step > 4}
              text={profile.role}
              charMs={28}
              onComplete={() => setStep(5)}
            />
          </>
        )}
      </h1>

      {step >= 5 && (
        <GeneratingText
          as="p"
          start={step >= 5}
          done={step > 5}
          text={profile.tagline}
          className="hero-tagline"
          charMs={22}
          onComplete={() => setStep(6)}
        />
      )}
    </>
  );
}
