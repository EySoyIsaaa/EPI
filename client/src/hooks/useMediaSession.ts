/**
 * useMediaSession - Hook para controles de media en notificaciones y pantalla bloqueada
 * Implementa la Media Session API para Android/iOS
 */

import { useEffect, useCallback, useRef } from 'react';

export interface MediaMetadata {
  title: string;
  artist: string;
  album?: string;
  artwork?: string; // URL de la carátula
}

export interface MediaSessionHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onNextTrack?: () => void;
  onPreviousTrack?: () => void;
  onSeekTo?: (time: number) => void;
  onSeekBackward?: (offset: number) => void;
  onSeekForward?: (offset: number) => void;
}

export interface MediaSessionController {
  updateMetadata: (metadata: MediaMetadata) => void;
  updatePlaybackState: (state: 'playing' | 'paused' | 'none') => void;
  updatePosition: (position: number, duration: number, playbackRate?: number) => void;
  setHandlers: (handlers: MediaSessionHandlers) => void;
}

export function useMediaSession(): MediaSessionController {
  const handlersRef = useRef<MediaSessionHandlers>({});

  // Verificar soporte de Media Session API
  const isSupported = 'mediaSession' in navigator;

  // Configurar action handlers
  useEffect(() => {
    if (!isSupported) return;

    const session = navigator.mediaSession;

    // Play
    session.setActionHandler('play', () => {
      handlersRef.current.onPlay?.();
    });

    // Pause
    session.setActionHandler('pause', () => {
      handlersRef.current.onPause?.();
    });

    // Previous track
    session.setActionHandler('previoustrack', () => {
      handlersRef.current.onPreviousTrack?.();
    });

    // Next track
    session.setActionHandler('nexttrack', () => {
      handlersRef.current.onNextTrack?.();
    });

    // Seek to specific time
    session.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        handlersRef.current.onSeekTo?.(details.seekTime);
      }
    });

    // Seek backward (10 seconds default)
    session.setActionHandler('seekbackward', (details) => {
      const offset = details.seekOffset || 10;
      handlersRef.current.onSeekBackward?.(offset);
    });

    // Seek forward (10 seconds default)
    session.setActionHandler('seekforward', (details) => {
      const offset = details.seekOffset || 10;
      handlersRef.current.onSeekForward?.(offset);
    });

    return () => {
      // Limpiar handlers al desmontar
      session.setActionHandler('play', null);
      session.setActionHandler('pause', null);
      session.setActionHandler('previoustrack', null);
      session.setActionHandler('nexttrack', null);
      session.setActionHandler('seekto', null);
      session.setActionHandler('seekbackward', null);
      session.setActionHandler('seekforward', null);
    };
  }, [isSupported]);

  // Actualizar metadatos (título, artista, carátula)
  const updateMetadata = useCallback((metadata: MediaMetadata) => {
    if (!isSupported) return;

    const artworkArray: MediaImage[] = [];
    
    if (metadata.artwork) {
      // Agregar múltiples tamaños para mejor compatibilidad
      artworkArray.push(
        { src: metadata.artwork, sizes: '96x96', type: 'image/jpeg' },
        { src: metadata.artwork, sizes: '128x128', type: 'image/jpeg' },
        { src: metadata.artwork, sizes: '192x192', type: 'image/jpeg' },
        { src: metadata.artwork, sizes: '256x256', type: 'image/jpeg' },
        { src: metadata.artwork, sizes: '384x384', type: 'image/jpeg' },
        { src: metadata.artwork, sizes: '512x512', type: 'image/jpeg' }
      );
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata.title || 'Sin título',
      artist: metadata.artist || 'Artista desconocido',
      album: metadata.album || 'EpicenterDSP PLAYER',
      artwork: artworkArray,
    });
  }, [isSupported]);

  // Actualizar estado de reproducción
  const updatePlaybackState = useCallback((state: 'playing' | 'paused' | 'none') => {
    if (!isSupported) return;
    navigator.mediaSession.playbackState = state;
  }, [isSupported]);

  // Actualizar posición para el seek bar de la notificación
  const updatePosition = useCallback((position: number, duration: number, playbackRate: number = 1) => {
    if (!isSupported) return;
    
    try {
      navigator.mediaSession.setPositionState({
        duration: duration || 0,
        playbackRate: playbackRate,
        position: Math.min(position, duration || 0),
      });
    } catch (e) {
      // Algunos navegadores no soportan setPositionState
      console.debug('setPositionState not supported:', e);
    }
  }, [isSupported]);

  // Establecer handlers desde el componente padre
  const setHandlers = useCallback((handlers: MediaSessionHandlers) => {
    handlersRef.current = handlers;
  }, []);

  return {
    updateMetadata,
    updatePlaybackState,
    updatePosition,
    setHandlers,
  };
}

export default useMediaSession;
