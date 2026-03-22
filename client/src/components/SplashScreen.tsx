/**
 * SplashScreen - Pantalla de inicio con animación
 * Muestra el ícono Epicenter y el nombre de la app
 * Fade-in / fade-out profesional
 * 
 * v2.2.0
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/useLanguage';

interface SplashScreenProps {
  onFinish: () => void;
  duration?: number; // duración total en ms
}

export function SplashScreen({ onFinish, duration = 2000 }: SplashScreenProps) {
  const [phase, setPhase] = useState<'fade-in' | 'visible' | 'fade-out'>('fade-in');
  const { t } = useLanguage();

  useEffect(() => {
    // Fase 1: Fade in (400ms)
    const fadeInTimer = setTimeout(() => {
      setPhase('visible');
    }, 400);

    // Fase 2: Visible (mantener)
    // Fase 3: Fade out (empieza 400ms antes de terminar)
    const fadeOutTimer = setTimeout(() => {
      setPhase('fade-out');
    }, duration - 400);

    // Terminar
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
      case 'fade-in': return 'opacity-0';
      case 'visible': return 'opacity-100';
      case 'fade-out': return 'opacity-0';
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
      <div className={`flex flex-col items-center transition-opacity duration-400 ${getOpacity()}`}>
        {/* Epicenter Icon */}
        <div className="relative mb-6">
          {/* Glow effect */}
          <div className="absolute inset-0 blur-2xl bg-red-500/30 rounded-full scale-150" />
          
          {/* Main icon container */}
          <div className="relative w-28 h-28 rounded-3xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center shadow-2xl">
            {/* Lightning bolt icon */}
            <svg 
              className="w-16 h-16 text-white drop-shadow-lg" 
              viewBox="0 0 24 24" 
              fill="currentColor"
            >
              <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z"/>
            </svg>
          </div>
          
          {/* Pulse rings */}
          <div className="absolute inset-0 rounded-3xl border-2 border-red-500/50 animate-ping" style={{ animationDuration: '2s' }} />
        </div>

        {/* App name */}
        <h1 className="text-2xl font-bold text-white tracking-tight mb-1">
          Epicenter Hi-Fi
        </h1>
        <p className="text-sm text-zinc-500 font-medium tracking-widest uppercase">
          Player
        </p>

        {/* Version badge */}
        <div className="mt-8 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800">
          <span className="text-xs text-zinc-500">v{t('app.version')}</span>
        </div>
      </div>

      {/* Bottom branding */}
      <div className={`absolute bottom-12 transition-opacity duration-400 ${getOpacity()}`}>
        <p className="text-xs text-zinc-700">Bass Reconstruction Technology</p>
      </div>
    </div>
  );
}

export default SplashScreen;
