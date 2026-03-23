/**
 * SplashScreen - Pantalla de inicio con animación
 * Muestra el ícono Epicenter y el nombre de la app
 * Fade-in / fade-out profesional
 *
 * v2.2.0
 */

import { useState, useEffect } from "react";
import { useLanguage } from "@/hooks/useLanguage";
import { appLogoUrl } from "@/lib/assetUrls";

interface SplashScreenProps {
  onFinish: () => void;
  duration?: number; // duración total en ms
}

export function SplashScreen({ onFinish, duration = 2000 }: SplashScreenProps) {
  const [phase, setPhase] = useState<"fade-in" | "visible" | "fade-out">(
    "fade-in",
  );
  const { t } = useLanguage();

  useEffect(() => {
    const fadeInTimer = setTimeout(() => {
      setPhase("visible");
    }, 400);

    const fadeOutTimer = setTimeout(() => {
      setPhase("fade-out");
    }, duration - 400);

    const finishTimer = setTimeout(() => {
      onFinish();
    }, duration);

    return () => {
      clearTimeout(fadeInTimer);
      clearTimeout(fadeOutTimer);
      clearTimeout(finishTimer);
    };
  }, [duration, onFinish]);

  const getOpacity = () => {
    switch (phase) {
      case "fade-in":
        return "opacity-0";
      case "visible":
        return "opacity-100";
      case "fade-out":
        return "opacity-0";
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
      <div
        className={`flex flex-col items-center transition-opacity duration-400 ${getOpacity()}`}
      >
        <div className="relative mb-6">
          <div className="absolute inset-0 blur-2xl bg-red-500/30 rounded-[2rem] scale-150" />

          <div className="relative w-28 h-28 rounded-3xl bg-gradient-to-br from-zinc-950 to-zinc-800 flex items-center justify-center shadow-2xl overflow-hidden p-4 border border-white/10">
            <img
              src={appLogoUrl}
              alt="Epicenter Hi-Fi"
              className="w-full h-full object-contain drop-shadow-lg"
            />
          </div>

          <div
            className="absolute inset-0 rounded-3xl border-2 border-red-500/50 animate-ping"
            style={{ animationDuration: "2s" }}
          />
        </div>

        <h1 className="text-2xl font-bold text-white tracking-tight mb-1">
          Epicenter Hi-Fi
        </h1>
        <p className="text-sm text-zinc-500 font-medium tracking-widest uppercase">
          Player
        </p>

        <div className="mt-8 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800">
          <span className="text-xs text-zinc-500">v{t("app.version")}</span>
        </div>
      </div>

      <div
        className={`absolute bottom-12 transition-opacity duration-400 ${getOpacity()}`}
      >
        <p className="text-xs text-zinc-700">Bass Reconstruction Technology</p>
      </div>
    </div>
  );
}

export default SplashScreen;
