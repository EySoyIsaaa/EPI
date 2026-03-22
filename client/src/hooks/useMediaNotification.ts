/**
 * useMediaNotification - Hook para controles en notificaciones Android
 * 
 * Usa @capgo/capacitor-media-session
 * API: https://github.com/Cap-go/capacitor-media-session
 */

import { useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { MediaSession } from '@capgo/capacitor-media-session';

export interface NotificationMetadata {
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
}

export interface NotificationHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeek?: (time: number) => void;
}

export interface MediaNotificationController {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  updateMetadata: (metadata: NotificationMetadata) => Promise<void>;
  updatePlaybackState: (isPlaying: boolean) => Promise<void>;
  updatePosition: (currentTime: number, duration: number) => Promise<void>;
  setHandlers: (handlers: NotificationHandlers) => void;
}

export function useMediaNotification(): MediaNotificationController {
  const handlersRef = useRef<NotificationHandlers>({});
  const isStartedRef = useRef(false);
  const isNative = Capacitor.isNativePlatform();

  // Retorna funciones vacías si no es plataforma nativa
  if (!isNative) {
    return {
      start: async () => { console.log('[MediaNotification] Not native platform'); },
      stop: async () => {},
      updateMetadata: async () => {},
      updatePlaybackState: async () => {},
      updatePosition: async () => {},
      setHandlers: () => {},
    };
  }

  // Iniciar Media Session y registrar handlers
  const start = useCallback(async () => {
    if (isStartedRef.current) return;

    try {
      console.log('[MediaNotification] Starting media session...');

      // Registrar action handlers
      await MediaSession.setActionHandler({ action: 'play' }, () => {
        console.log('[MediaNotification] Play action');
        handlersRef.current.onPlay?.();
      });

      await MediaSession.setActionHandler({ action: 'pause' }, () => {
        console.log('[MediaNotification] Pause action');
        handlersRef.current.onPause?.();
      });

      await MediaSession.setActionHandler({ action: 'previoustrack' }, () => {
        console.log('[MediaNotification] Previous track');
        handlersRef.current.onPrevious?.();
      });

      await MediaSession.setActionHandler({ action: 'nexttrack' }, () => {
        console.log('[MediaNotification] Next track');
        handlersRef.current.onNext?.();
      });

      await MediaSession.setActionHandler({ action: 'seekto' }, (details: any) => {
        console.log('[MediaNotification] Seek to:', details?.seekTime);
        if (details?.seekTime != null) {
          handlersRef.current.onSeek?.(details.seekTime);
        }
      });

      isStartedRef.current = true;
      console.log('[MediaNotification] Started successfully');
    } catch (error) {
      console.error('[MediaNotification] Error starting:', error);
    }
  }, []);

  // Detener servicio
  const stop = useCallback(async () => {
    if (!isStartedRef.current) return;

    try {
      await MediaSession.setActionHandler({ action: 'play' }, null);
      await MediaSession.setActionHandler({ action: 'pause' }, null);
      await MediaSession.setActionHandler({ action: 'previoustrack' }, null);
      await MediaSession.setActionHandler({ action: 'nexttrack' }, null);
      await MediaSession.setActionHandler({ action: 'seekto' }, null);
      
      isStartedRef.current = false;
      console.log('[MediaNotification] Stopped');
    } catch (error) {
      console.error('[MediaNotification] Error stopping:', error);
    }
  }, []);

  // Actualizar metadatos (título, artista, carátula)
  const updateMetadata = useCallback(async (metadata: NotificationMetadata) => {
    try {
      // Iniciar si no está iniciado
      if (!isStartedRef.current) {
        await start();
      }

      const artworkArray = metadata.artwork 
        ? [{ src: metadata.artwork, sizes: '512x512', type: 'image/jpeg' }]
        : [];

      await MediaSession.setMetadata({
        title: metadata.title || 'Sin título',
        artist: metadata.artist || 'Artista desconocido',
        album: metadata.album || 'EpicenterDSP PLAYER',
        artwork: artworkArray,
      });

      console.log('[MediaNotification] Metadata updated:', metadata.title);
    } catch (error) {
      console.error('[MediaNotification] Error updating metadata:', error);
    }
  }, [start]);

  // Actualizar estado de reproducción
  const updatePlaybackState = useCallback(async (isPlaying: boolean) => {
    try {
      await MediaSession.setPlaybackState({
        playbackState: isPlaying ? 'playing' : 'paused',
      });

      console.log('[MediaNotification] Playback state:', isPlaying ? 'playing' : 'paused');
    } catch (error) {
      console.error('[MediaNotification] Error updating playback state:', error);
    }
  }, []);

  // Actualizar posición (para seek bar en notificación)
  const updatePosition = useCallback(async (currentTime: number, duration: number) => {
    try {
      await MediaSession.setPositionState({
        duration: duration,
        position: currentTime,
        playbackRate: 1.0,
      });
    } catch (error) {
      // Silenciar errores de posición
    }
  }, []);

  // Establecer handlers
  const setHandlers = useCallback((handlers: NotificationHandlers) => {
    handlersRef.current = handlers;
  }, []);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (isStartedRef.current) {
        stop();
      }
    };
  }, [stop]);

  return {
    start,
    stop,
    updateMetadata,
    updatePlaybackState,
    updatePosition,
    setHandlers,
  };
}

export default useMediaNotification;
