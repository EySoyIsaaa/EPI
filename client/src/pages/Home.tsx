/**
 * Epicenter Hi-Fi - Apple Music Style Player
 * Diseño minimalista, monocromático y premium
 * Con biblioteca de música organizada, playlists y cola interactiva
 * 
 * v1.1.3 - Splash screen + Last track memory
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { 
  Play, 
  Pause, 
  SkipForward, 
  SkipBack, 
  Plus,
  Disc3,
  ChevronRight,
  User,
  Music2,
  Folder,
  ListPlus,
  PlayCircle,
  GripVertical,
  X,
  Shuffle,
  Settings,
  Globe,
  Info,
  ChevronDown,
  Volume2,
  ListMusic,
  MoreVertical,
  Edit3,
  Trash2,
  Check,
  AlertCircle,
  FileText,
  BookOpen,
  Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Link } from 'wouter';
import { EQ_GAIN_MAX, EQ_GAIN_MIN, useIntegratedAudioProcessor, type StreamingParams } from '@/hooks/useIntegratedAudioProcessor';
import { analyzeSpectrumAndSelectPreset, applyPresetSmooth, suggestDspFromScores } from '@/audio/autoPresetSelector';
import { useAudioQueue, type Track } from '@/hooks/useAudioQueue';
import { usePlaylists, type Playlist } from '@/hooks/usePlaylists';
import { usePresetPersistence } from '@/hooks/usePresetPersistence';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useMediaNotification } from '@/hooks/useMediaNotification';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { useCrossfade } from '@/hooks/useCrossfade';
import { useLastTrack } from '@/hooks/useLastTrack';
import { useTheme } from '@/contexts/ThemeContext';
import { KnobControl } from '@/components/KnobControl';
import { AudioQualityBadge } from '@/components/AudioQualityBadge';
import { EQVisualizer } from '@/components/EQVisualizer';
import { SwipeableTrackItem } from '@/components/SwipeableTrackItem';
import { AndroidMusicImporter } from '@/components/AndroidMusicImporter';
import { MusicScanner } from '@/components/MusicScanner';
import { BottomNavigation } from '@/components/BottomNavigation';
import { useLanguage } from '@/hooks/useLanguage';
import { useAndroidMusicLibrary, type AndroidMusicFile } from '@/hooks/useAndroidMusicLibrary';
import { toast } from 'sonner';

type TabType = 'player' | 'library' | 'search' | 'eq' | 'dsp' | 'settings';
type LibraryView = 'main' | 'songs' | 'artists' | 'albums' | 'hires' | 'playlists' | 'playlist-detail';

export default function Home() {
  const audioProcessor = useIntegratedAudioProcessor();
  const queue = useAudioQueue();
  const presetManager = usePresetPersistence();
  const mediaSession = useMediaSession();
  const mediaNotification = useMediaNotification();
  const crossfade = useCrossfade();
  const lastTrack = useLastTrack();
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme, switchable } = useTheme();
  const playlistManager = usePlaylists(queue.library);
  const androidMusicLibrary = useAndroidMusicLibrary();
  
  // Solicitar permiso de notificaciones en Android 13+
  useNotificationPermission();

  const [activeTab, setActiveTab] = useState<TabType>('player');
  const [libraryView, setLibraryView] = useState<LibraryView>('main');
  const [songSort, setSongSort] = useState<'default' | 'name' | 'artist'>('default');
  const [visibleSongsCount, setVisibleSongsCount] = useState(250);
  const [showQueue, setShowQueue] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [dspParams, setDspParams] = useState<StreamingParams>({
    sweepFreq: 45,
    width: 50,
    intensity: 50,
    balance: 50,
    volume: 120,
  });
  const [epicenterEnabled, setEpicenterEnabled] = useState(false);
  const [eqAutoEnabled, setEqAutoEnabled] = useState(false);
  const [dspAutoEnabled, setDspAutoEnabled] = useState(false);
  const [showEqAutoModal, setShowEqAutoModal] = useState(false);
  const [showDspAutoModal, setShowDspAutoModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ track: Track; x: number; y: number } | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  
  // Playlist states
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [showRenamePlaylist, setShowRenamePlaylist] = useState(false);
  const [showDeletePlaylist, setShowDeletePlaylist] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState<Track | null>(null);
  const [showAddSongsToPlaylist, setShowAddSongsToPlaylist] = useState(false); // New: modal to add songs from library
  const [showDuplicatesModal, setShowDuplicatesModal] = useState<string[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [playlistMenu, setPlaylistMenu] = useState<{ playlist: Playlist; x: number; y: number } | null>(null);
  
  // Ref para evitar recargar el archivo cuando cambian los params
  const currentTrackRef = useRef<string | null>(null);
  const initialLoadRef = useRef(true);
  const lastAutoPresetTrackRef = useRef<string | null>(null);
  const lastAutoPresetTimeRef = useRef(0);

  const hiResTracks = useMemo(
    () => queue.library.filter((track) => track.isHiRes),
    [queue.library],
  );


  const sortedSongs = useMemo(() => {
    if (songSort === 'default') return queue.library;
    const copy = [...queue.library];
    if (songSort === 'name') {
      copy.sort((a, b) => a.title.localeCompare(b.title, language === 'es' ? 'es' : 'en', { sensitivity: 'base' }));
      return copy;
    }
    copy.sort((a, b) => a.artist.localeCompare(b.artist, language === 'es' ? 'es' : 'en', { sensitivity: 'base' }));
    return copy;
  }, [queue.library, songSort, language]);

  useEffect(() => {
    setVisibleSongsCount(250);
  }, [songSort, queue.library.length]);
  const normalizedGlobalQuery = globalSearchQuery.trim().toLowerCase();

  const globalResults = useMemo(() => {
    if (!normalizedGlobalQuery) return [];
    return queue.library.filter((track) =>
      `${track.title} ${track.artist}`.toLowerCase().includes(normalizedGlobalQuery),
    );
  }, [queue.library, normalizedGlobalQuery]);

  useEffect(() => {
    const dismissed = localStorage.getItem('epicenter-onboarding-dismissed');
    const legacyDismissed = localStorage.getItem('epicenter-welcome-dismissed');
    if (!dismissed && !legacyDismissed) {
      setShowOnboarding(true);
    } else if (!dismissed && legacyDismissed) {
      localStorage.setItem('epicenter-onboarding-dismissed', 'true');
    }
  }, []);

  const onboardingSteps = useMemo(() => ([
    {
      title: t('onboarding.step1Title'),
      description: t('onboarding.step1Description'),
    },
    {
      title: t('onboarding.step2Title'),
      description: t('onboarding.step2Description'),
    },
    {
      title: t('onboarding.step3Title'),
      description: t('onboarding.step3Description'),
    },
  ]), [t]);

  const dismissOnboarding = useCallback(() => {
    localStorage.setItem('epicenter-onboarding-dismissed', 'true');
    setShowOnboarding(false);
    setOnboardingStep(0);
  }, []);

  // Actualizar selectedPlaylist cuando cambien los playlists
  useEffect(() => {
    if (selectedPlaylist) {
      const updated = playlistManager.playlists.find(p => p.id === selectedPlaylist.id);
      if (updated && (updated.trackIds.length !== selectedPlaylist.trackIds.length)) {
        setSelectedPlaylist(updated);
      }
    }
  }, [playlistManager.playlists, selectedPlaylist]);

  // Cargar última configuración
  useEffect(() => {
    const lastConfig = presetManager.getLastConfig();
    if (lastConfig) {
      setDspParams(lastConfig.dspParams);
      audioProcessor.eqBands.forEach((_, index) => {
        audioProcessor.setEqBandGain(index, lastConfig.eqBands[index] || 0);
      });
    }
    initialLoadRef.current = false;
  }, []);

  // Configurar crossfade en el procesador de audio
  useEffect(() => {
    audioProcessor.setCrossfadeConfig({
      enabled: crossfade.enabled,
      duration: crossfade.duration,
    });
  }, [crossfade.enabled, crossfade.duration, audioProcessor]);

  // Configurar callback para cuando termina una canción
  useEffect(() => {
    audioProcessor.setOnTrackEnded(() => {
      if (queue.queue.length > 0 && queue.currentTrackIndex < queue.queue.length - 1) {
        queue.nextTrack();
      }
    });
    
    return () => {
      audioProcessor.setOnTrackEnded(null);
    };
  }, [audioProcessor, queue]);

  // Configurar handlers de Media Session y Notificaciones Nativas
  useEffect(() => {
    mediaSession.setHandlers({
      onPlay: () => audioProcessor.play(),
      onPause: () => audioProcessor.pause(),
      onNextTrack: () => queue.nextTrack(),
      onPreviousTrack: () => queue.previousTrack(),
      onSeekTo: (time) => audioProcessor.seek(time),
      onSeekBackward: (offset) => {
        audioProcessor.seek(Math.max(0, audioProcessor.currentTime - offset));
      },
      onSeekForward: (offset) => {
        audioProcessor.seek(Math.min(audioProcessor.duration, audioProcessor.currentTime + offset));
      },
    });
    
    mediaNotification.setHandlers({
      onPlay: () => audioProcessor.play(),
      onPause: () => audioProcessor.pause(),
      onNext: () => queue.nextTrack(),
      onPrevious: () => queue.previousTrack(),
      onSeek: (time) => audioProcessor.seek(time),
    });
  }, [audioProcessor, queue, mediaSession, mediaNotification]);

  // Actualizar metadatos en Media Session cuando cambia el track
  useEffect(() => {
    if (queue.currentTrack) {
      mediaSession.updateMetadata({
        title: queue.currentTrack.title,
        artist: queue.currentTrack.artist,
        artwork: queue.currentTrack.coverUrl,
      });
      
      mediaNotification.updateMetadata({
        title: queue.currentTrack.title,
        artist: queue.currentTrack.artist,
        album: 'EpicenterDSP PLAYER',
        artwork: queue.currentTrack.coverUrl,
      });
    }
  }, [queue.currentTrack, mediaSession, mediaNotification]);

  // Actualizar estado de reproducción
  useEffect(() => {
    mediaSession.updatePlaybackState(audioProcessor.isPlaying ? 'playing' : 'paused');
    mediaNotification.updatePlaybackState(audioProcessor.isPlaying);
    
    if (audioProcessor.isPlaying && queue.currentTrack) {
      mediaNotification.start();
    }
  }, [audioProcessor.isPlaying, mediaSession, mediaNotification, queue.currentTrack]);

  // Actualizar posición
  useEffect(() => {
    if (audioProcessor.duration > 0) {
      mediaSession.updatePosition(audioProcessor.currentTime, audioProcessor.duration);
      mediaNotification.updatePosition(audioProcessor.currentTime, audioProcessor.duration);
    }
  }, [audioProcessor.currentTime, audioProcessor.duration, mediaSession, mediaNotification]);

  // Guardar configuración (debounced)
  useEffect(() => {
    if (initialLoadRef.current) return;
    const timer = setTimeout(() => {
      presetManager.saveLastConfig(
        audioProcessor.eqBands.map(b => b.gain),
        dspParams
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [dspParams, audioProcessor.eqBands]);

  // Cargar última canción al iniciar (sin autoplay)
  const lastTrackLoadedRef = useRef(false);
  useEffect(() => {
    const loadLastTrack = async () => {
      // Solo cargar si: biblioteca lista, lastTrack cargado, no hay canción actual, no hemos cargado ya
      if (
        !queue.isLoading && 
        lastTrack.isLoaded && 
        lastTrack.lastTrackId && 
        !queue.currentTrack && 
        !lastTrackLoadedRef.current
      ) {
        lastTrackLoadedRef.current = true;
        
        // Buscar el track en la biblioteca
        const track = queue.library.find(t => t.id === lastTrack.lastTrackId);
        if (track) {
          console.log('[LastTrack] Loading last track:', track.title);
          // Agregar a la cola sin reproducir
          queue.addToQueue(track);
          // Seleccionar el track (index 0)
          queue.playTrack(0);
          // Cargar el archivo pero NO reproducir automáticamente
          try {
          const source = track.sourceUri ?? track.file;
          if (!source) {
            throw new Error('Track source not available');
          }
          await audioProcessor.loadFile(source, dspParams);
            // NO llamar audioProcessor.play() - el usuario debe iniciar manualmente
            currentTrackRef.current = track.id;
          } catch (error) {
            console.error('[LastTrack] Error loading last track:', error);
          }
        }
      }
    };
    loadLastTrack();
  }, [queue.isLoading, lastTrack.isLoaded, lastTrack.lastTrackId, queue.library]);

  // Cargar track cuando cambia (y guardar como último track)
  useEffect(() => {
    const loadTrack = async () => {
      if (queue.currentTrack && queue.currentTrack.id !== currentTrackRef.current) {
        currentTrackRef.current = queue.currentTrack.id;
        
        // Guardar como última canción reproducida (usando el ID original, no el de cola)
        const originalId = queue.currentTrack.id.replace(/^queue-\d+-\w+$/, '');
        // Buscar el ID real en la biblioteca
        const libraryTrack = queue.library.find(t => 
          queue.currentTrack?.title === t.title && 
          queue.currentTrack?.artist === t.artist
        );
        if (libraryTrack) {
          lastTrack.saveLastTrack(libraryTrack.id);
        }
        
        try {
          let source: File | string | undefined;
          
          // Si es un track de MediaStore, obtener URL del archivo en caché
          if (queue.currentTrack.sourceType === 'media-store' && queue.currentTrack.sourceUri) {
            console.log('🎵 Track de MediaStore, obteniendo URL de archivo...');
            const trackId = queue.currentTrack.id.replace('media-', '');
            const fileUrl = await androidMusicLibrary.getAudioFileUrl(queue.currentTrack.sourceUri, trackId);
            if (fileUrl) {
              source = fileUrl;
              console.log('✅ URL de archivo obtenida para reproducción');
            } else {
              throw new Error('No se pudo obtener el audio del dispositivo');
            }
          } else {
            // Track importado manualmente
            source = await queue.getTrackFile(queue.currentTrack);
          }
          
          if (!source) {
            throw new Error('Track source not available');
          }
          await audioProcessor.loadFile(source, dspParams);
          setTimeout(() => {
            audioProcessor.play();
            setTimeout(() => {
              runAutoOptimization();
            }, 1400);
          }, 100);
        } catch (error) {
          console.error('Error loading track:', error);
          toast.error(t('actions.errorLoadingTrack'));
        }
      }
    };
    loadTrack();
  }, [queue.currentTrack?.id]);

  const handleFileSelect = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        try {
          const result = await queue.addToLibrary(files);
          
          // Show success message for added songs
          if (result.added > 0) {
            const msg = result.added > 1 
              ? t('actions.songsAddedPlural', { count: result.added })
              : t('actions.songsAdded', { count: result.added });
            toast.success(msg);
          }
          
          // Show duplicates modal if any
          if (result.duplicates.length > 0) {
            setShowDuplicatesModal(result.duplicates);
          }
        } catch (error) {
          toast.error(t('actions.errorAddingSongs'));
        }
      }
    };
    input.click();
  }, [queue, t]);

  const handleMediaStoreImport = useCallback(async (tracks: AndroidMusicFile[]) => {
    const result = await queue.addMediaStoreTracks(tracks, androidMusicLibrary.getAlbumArt);

    if (result.added > 0) {
      const msg = result.added > 1
        ? t('actions.songsAddedPlural', { count: result.added })
        : t('actions.songsAdded', { count: result.added });
      toast.success(msg);
    }

    if (result.duplicates.length > 0) {
      setShowDuplicatesModal(result.duplicates);
    }

    return result;
  }, [queue, t]);

  const updateDspParam = useCallback((key: keyof StreamingParams, value: number) => {
    setDspParams(prev => ({ ...prev, [key]: value }));
    if (key === 'volume' || epicenterEnabled) {
      audioProcessor.setDspParam(key, value);
    }
  }, [audioProcessor, epicenterEnabled]);

  const toggleEq = useCallback((enabled: boolean) => {
    audioProcessor.setEqEnabled(enabled);

    // Epicenter debe poder seguir activo de forma independiente aunque el EQ se apague.
    if (!enabled && epicenterEnabled) {
      audioProcessor.setEpicenterEnabled(true);
    }
  }, [audioProcessor, epicenterEnabled]);

  const toggleEpicenter = useCallback(() => {
    const newEnabled = !epicenterEnabled;
    setEpicenterEnabled(newEnabled);
    audioProcessor.setEpicenterEnabled(newEnabled);
    if (newEnabled) {
      Object.entries(dspParams).forEach(([key, value]) => {
        audioProcessor.setDspParam(key as keyof StreamingParams, value);
      });
    }
  }, [epicenterEnabled, audioProcessor, dspParams]);

  async function runAutoOptimization(force = false) {
    if (!eqAutoEnabled && !dspAutoEnabled) return;
    if (!queue.currentTrack) return;

    const now = Date.now();
    if (!force && lastAutoPresetTrackRef.current === queue.currentTrack.id && (now - lastAutoPresetTimeRef.current) < 30000) {
      return;
    }

    const analyserNode = audioProcessor.getAnalyserNode();
    const selection = await analyzeSpectrumAndSelectPreset({ analyserNode, sampleCount: 80, intervalMs: 125 });

    if (eqAutoEnabled) {
      const currentGains = audioProcessor.eqBands.map((band) => band.gain);
      await applyPresetSmooth({
        currentGains,
        targetGains: selection.preset.gainsDb,
        setEqBandGain: audioProcessor.setEqBandGain,
        durationMs: 800,
        stepMs: 100,
        maxDeltaPerStep: 0.5,
      });
      audioProcessor.setEqPreampDb(selection.preset.preampDb);
      audioProcessor.setEqEnabled(true);
    }

    if (dspAutoEnabled) {
      if (!epicenterEnabled) {
        setEpicenterEnabled(true);
        audioProcessor.setEpicenterEnabled(true);
      }
      const dspSuggestion = suggestDspFromScores(selection.debug);
      setDspParams((prev) => ({ ...prev, ...dspSuggestion }));
      Object.entries(dspSuggestion).forEach(([key, value]) => {
        if (typeof value === 'number') {
          audioProcessor.setDspParam(key as keyof StreamingParams, value);
        }
      });
    }

    lastAutoPresetTrackRef.current = queue.currentTrack.id;
    lastAutoPresetTimeRef.current = now;

    console.log('[AutoPreset IA]', {
      presetId: selection.presetId,
      presetName: selection.preset.name,
      debug: selection.debug,
    });

    toast.success(t('actions.autoOptimizedPreset', { preset: selection.preset.name }));
  }


  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Agrupar canciones
  const songsByArtist = useMemo(() => queue.library.reduce((acc, track) => {
    const artist = track.artist || t('common.unknownArtist');
    if (!acc[artist]) acc[artist] = [];
    acc[artist].push(track);
    return acc;
  }, {} as Record<string, Track[]>), [queue.library, t]);

  const albums = useMemo(() => queue.library.reduce((acc, track) => {
    const album = track.title.split(' - ')[0] || track.title;
    if (!acc[album]) acc[album] = [];
    acc[album].push(track);
    return acc;
  }, {} as Record<string, Track[]>), [queue.library]);

  // Handlers
  const handleAddToQueue = (track: Track) => {
    queue.addToQueue(track);
    toast.success(t('actions.addedToQueue'));
    setContextMenu(null);
  };

  const handlePlayNext = (track: Track) => {
    queue.addToQueueNext(track);
    toast.success(t('actions.willPlayNext'));
    setContextMenu(null);
  };

  const handlePlayNow = (track: Track) => {
    queue.playNow(track);
    setContextMenu(null);
    setActiveTab('player');
    setShowQueue(false);
  };

  const handleShufflePlay = (tracks: Track[]) => {
    if (tracks.length === 0) {
      toast.error(t('actions.noSongsToPlay'));
      return;
    }
    queue.shuffleAll(tracks);
    toast.success(t('actions.playingShuffled', { count: tracks.length }));
    setActiveTab('player');
    setShowQueue(false);
  };

  const handlePlayInOrder = (tracks: Track[]) => {
    if (tracks.length === 0) {
      toast.error(t('actions.noSongsToPlay'));
      return;
    }
    queue.playAllInOrder(tracks);
    toast.success(t('actions.playingAll', { count: tracks.length }));
    setActiveTab('player');
    setShowQueue(false);
  };

  // Playlist handlers
  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    await playlistManager.createPlaylist(newPlaylistName.trim());
    toast.success(t('playlists.created'));
    setNewPlaylistName('');
    setShowCreatePlaylist(false);
  };

  const handleRenamePlaylist = async () => {
    if (!selectedPlaylist || !newPlaylistName.trim()) return;
    await playlistManager.renamePlaylist(selectedPlaylist.id, newPlaylistName.trim());
    setSelectedPlaylist({ ...selectedPlaylist, name: newPlaylistName.trim() });
    toast.success(t('playlists.renamed'));
    setNewPlaylistName('');
    setShowRenamePlaylist(false);
    setPlaylistMenu(null);
  };

  const handleDeletePlaylist = async () => {
    if (!selectedPlaylist) return;
    await playlistManager.deletePlaylist(selectedPlaylist.id);
    toast.success(t('playlists.deleted'));
    setSelectedPlaylist(null);
    setShowDeletePlaylist(false);
    setPlaylistMenu(null);
    setLibraryView('playlists');
  };

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    await playlistManager.addTrackToPlaylist(playlistId, track.id);
    toast.success(t('playlists.songAdded'));
    setShowAddToPlaylist(null);
  };

  const handleRemoveFromPlaylist = async (track: Track) => {
    if (!selectedPlaylist) return;
    await playlistManager.removeTrackFromPlaylist(selectedPlaylist.id, track.id);
    // Update local state
    const updatedPlaylist = playlistManager.playlists.find(p => p.id === selectedPlaylist.id);
    if (updatedPlaylist) {
      setSelectedPlaylist(updatedPlaylist);
    }
    toast.success(t('playlists.songRemoved'));
  };

  // Handler para abrir modal de selección de playlist desde cualquier canción
  const handleOpenAddToPlaylist = (track: Track) => {
    setShowAddToPlaylist(track);
  };

  // Handler para agregar canción a la playlist seleccionada (desde el modal dentro de playlist-detail)
  const handleAddSongToSelectedPlaylist = async (track: Track) => {
    if (!selectedPlaylist) return;
    
    // Check if already in playlist
    if (selectedPlaylist.trackIds.includes(track.id)) {
      toast.error(t('duplicates.alreadyInPlaylist'));
      return;
    }
    
    await playlistManager.addTrackToPlaylist(selectedPlaylist.id, track.id);
    toast.success(t('playlists.songAdded'));
  };

  // Touch reorder state
  const [touchStart, setTouchStart] = useState<{ index: number; y: number } | null>(null);

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div 
            className="fixed z-50 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-2 min-w-[200px]"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: contextMenu.y }}
          >
            <button
              onClick={() => handlePlayNow(contextMenu.track)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
            >
              <Play className="w-5 h-5 text-zinc-400" />
              <span>{t('actions.playNow')}</span>
            </button>
            <button
              onClick={() => handlePlayNext(contextMenu.track)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
            >
              <PlayCircle className="w-5 h-5 text-zinc-400" />
              <span>{t('actions.playNext')}</span>
            </button>
            <button
              onClick={() => handleAddToQueue(contextMenu.track)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
            >
              <ListPlus className="w-5 h-5 text-zinc-400" />
              <span>{t('actions.addToQueue')}</span>
            </button>
            <div className="h-px bg-zinc-800 my-1" />
            <button
              onClick={() => {
                setShowAddToPlaylist(contextMenu.track);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
            >
              <ListMusic className="w-5 h-5 text-zinc-400" />
              <span>{t('playlists.addToPlaylist')}</span>
            </button>
          </div>
        </>
      )}

      {/* Playlist Menu */}
      {playlistMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPlaylistMenu(null)} />
          <div 
            className="fixed z-50 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl py-2 min-w-[160px]"
            style={{ left: Math.min(playlistMenu.x, window.innerWidth - 180), top: playlistMenu.y }}
          >
            <button
              onClick={() => {
                setSelectedPlaylist(playlistMenu.playlist);
                setNewPlaylistName(playlistMenu.playlist.name);
                setShowRenamePlaylist(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
            >
              <Edit3 className="w-4 h-4 text-zinc-400" />
              <span>{t('playlists.rename')}</span>
            </button>
            <button
              onClick={() => {
                setSelectedPlaylist(playlistMenu.playlist);
                setShowDeletePlaylist(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-left text-red-400"
            >
              <Trash2 className="w-4 h-4" />
              <span>{t('playlists.delete')}</span>
            </button>
          </div>
        </>
      )}

      {/* Create Playlist Modal */}
      {showCreatePlaylist && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-sm border border-zinc-800">
            <h3 className="text-lg font-bold mb-4">{t('playlists.createNew')}</h3>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder={t('playlists.enterName')}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 mb-4 focus:outline-none focus:border-white/50"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
            />
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setShowCreatePlaylist(false); setNewPlaylistName(''); }}
                className="flex-1 border-zinc-700"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleCreatePlaylist}
                className="flex-1 bg-white text-black hover:bg-zinc-200"
                disabled={!newPlaylistName.trim()}
              >
                {t('playlists.create')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Playlist Modal */}
      {showRenamePlaylist && selectedPlaylist && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-sm border border-zinc-800">
            <h3 className="text-lg font-bold mb-4">{t('playlists.rename')}</h3>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder={t('playlists.enterName')}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 mb-4 focus:outline-none focus:border-white/50"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleRenamePlaylist()}
            />
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setShowRenamePlaylist(false); setNewPlaylistName(''); setPlaylistMenu(null); }}
                className="flex-1 border-zinc-700"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleRenamePlaylist}
                className="flex-1 bg-white text-black hover:bg-zinc-200"
                disabled={!newPlaylistName.trim()}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Playlist Modal */}
      {showDeletePlaylist && selectedPlaylist && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-sm border border-zinc-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-bold">{t('playlists.deleteConfirm')}</h3>
            </div>
            <p className="text-zinc-400 text-sm mb-4">{t('playlists.deleteDescription')}</p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setShowDeletePlaylist(false); setPlaylistMenu(null); }}
                className="flex-1 border-zinc-700"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleDeletePlaylist}
                className="flex-1 bg-red-500 text-white hover:bg-red-600"
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add to Playlist Modal */}
      {showAddToPlaylist && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-sm border border-zinc-800 max-h-[80vh] flex flex-col">
            <h3 className="text-lg font-bold mb-4">{t('playlists.selectPlaylist')}</h3>
            <ScrollArea className="flex-1 -mx-2">
              <div className="px-2 space-y-2">
                {playlistManager.playlists.length === 0 ? (
                  <p className="text-zinc-500 text-center py-4">{t('playlists.noPlaylists')}</p>
                ) : (
                  playlistManager.playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      onClick={() => handleAddToPlaylist(playlist.id, showAddToPlaylist)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left"
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                        <ListMusic className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{playlist.name}</p>
                        <p className="text-xs text-zinc-500">{t('library.songsCount', { count: playlist.trackIds.length })}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
            <Button
              variant="outline"
              onClick={() => setShowAddToPlaylist(null)}
              className="mt-4 border-zinc-700"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Duplicates Modal */}
      {showDuplicatesModal.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-sm border border-zinc-800 max-h-[80vh] min-h-0 flex flex-col">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold">{t('duplicates.title')}</h3>
                <p className="text-xs text-zinc-500">
                  {showDuplicatesModal.length > 1 
                    ? t('duplicates.skippedPlural', { count: showDuplicatesModal.length })
                    : t('duplicates.skipped', { count: showDuplicatesModal.length })}
                </p>
              </div>
            </div>
            <p className="text-zinc-400 text-sm mb-3">{t('duplicates.message')}</p>
            <div className="flex-1 min-h-0">
              <ScrollArea className="h-full -mx-2 max-h-[40vh]">
                <div className="px-2 space-y-1">
                  {showDuplicatesModal.map((fileName, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-zinc-800/50 rounded-lg">
                      <Music2 className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                      <p className="text-sm text-zinc-300 truncate">{fileName}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div className="pt-4">
              <Button
                onClick={() => setShowDuplicatesModal([])}
                className="w-full bg-white text-black hover:bg-zinc-200"
              >
                {t('common.ok')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showOnboarding && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-lg border border-zinc-800 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {t('onboarding.title')}
              </p>
              <button
                onClick={dismissOnboarding}
                className="text-xs text-zinc-400 hover:text-white transition-colors"
              >
                {t('onboarding.skip')}
              </button>
            </div>
            <div className="space-y-3">
              <h3 className="text-xl font-semibold text-white">{onboardingSteps[onboardingStep].title}</h3>
              <p className="text-sm text-zinc-300">{onboardingSteps[onboardingStep].description}</p>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                {onboardingSteps.map((_, index) => (
                  <span
                    key={index}
                    className={`h-2 w-2 rounded-full transition-colors ${
                      index === onboardingStep ? 'bg-white' : 'bg-zinc-700'
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setOnboardingStep((prev) => Math.max(prev - 1, 0))}
                  disabled={onboardingStep === 0}
                  className="text-zinc-300 hover:text-white"
                >
                  {t('onboarding.back')}
                </Button>
                {onboardingStep < onboardingSteps.length - 1 ? (
                  <Button
                    onClick={() => setOnboardingStep((prev) => Math.min(prev + 1, onboardingSteps.length - 1))}
                    className="bg-white text-black hover:bg-zinc-200"
                  >
                    {t('onboarding.next')}
                  </Button>
                ) : (
                  <Button
                    onClick={dismissOnboarding}
                    className="bg-white text-black hover:bg-zinc-200"
                  >
                    {t('onboarding.done')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Songs to Playlist Modal - Shows library songs to add to selected playlist */}
      {showAddSongsToPlaylist && selectedPlaylist && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-md border border-zinc-800 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">{t('playlists.addSongs')}</h3>
                <p className="text-xs text-zinc-500">{selectedPlaylist.name}</p>
              </div>
              <button 
                onClick={() => setShowAddSongsToPlaylist(false)}
                className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <ScrollArea className="flex-1 -mx-2">
              <div className="px-2 space-y-1">
                {queue.library.length === 0 ? (
                  <div className="text-center py-8">
                    <Music2 className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                    <p className="text-zinc-500">{t('library.noMusic')}</p>
                  </div>
                ) : (
                  queue.library.map((track) => {
                    const isInPlaylist = selectedPlaylist.trackIds.includes(track.id);
                    return (
                      <button
                        key={track.id}
                        onClick={() => !isInPlaylist && handleAddSongToSelectedPlaylist(track)}
                        disabled={isInPlaylist}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left ${
                          isInPlaylist 
                            ? 'bg-zinc-800/30 opacity-50 cursor-not-allowed' 
                            : 'bg-zinc-800/50 hover:bg-zinc-800'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-zinc-700 overflow-hidden flex-shrink-0">
                          {track.coverUrl ? (
                            <img src={track.coverUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Disc3 className="w-5 h-5 text-zinc-500" strokeWidth={1} />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{track.title}</p>
                          <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
                        </div>
                        {isInPlaylist ? (
                          <Check className="w-5 h-5 text-green-500" />
                        ) : (
                          <Plus className="w-5 h-5 text-zinc-400" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
            <Button
              variant="outline"
              onClick={() => setShowAddSongsToPlaylist(false)}
              className="mt-4 border-zinc-700"
            >
              {t('common.close')}
            </Button>
          </div>
        </div>
      )}

      {/* Player View */}
      {activeTab === 'player' && (
        <div className="flex-1 flex flex-col" data-testid="player-view">
          <header className="flex items-center justify-between px-6 pt-12 pb-4">
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">
              {t('player.nowPlaying')}
            </span>
            <button 
              onClick={() => setShowQueue(!showQueue)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                showQueue ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400'
              }`}
            >
              {t('player.queue')} ({queue.queue.length})
            </button>
          </header>

          {showQueue ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
                <h3 className="font-semibold text-lg">{t('player.playbackQueue')}</h3>
                <div className="flex items-center gap-2">
                  <button onClick={handleFileSelect} className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800">
                    <Plus className="w-5 h-5" />
                  </button>
                  <button onClick={() => setShowQueue(false)} className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800">
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 min-h-0">
                <ScrollArea className="h-full px-4 py-2">
                  {queue.queue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Disc3 className="w-12 h-12 text-zinc-800 mb-3" strokeWidth={1} />
                      <p className="text-zinc-600 text-sm">{t('player.queueEmpty')}</p>
                    </div>
                  ) : (
                    <div className="space-y-1 pb-4">
                      {queue.currentTrack && queue.currentTrackIndex >= 0 && (
                        <div
                          className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur border-b border-amber-500/70 rounded-xl"
                        >
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800/80">
                            <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
                              {queue.currentTrack.coverUrl ? (
                                <img src={queue.currentTrack.coverUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Disc3 className="w-5 h-5 text-zinc-600" strokeWidth={1} />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate text-white underline decoration-amber-400/80 underline-offset-4">
                                {queue.currentTrack.title}
                              </p>
                              <div className="flex items-center gap-2">
                                <p className="text-xs text-zinc-400 truncate">{queue.currentTrack.artist}</p>
                                <AudioQualityBadge
                                  bitDepth={queue.currentTrack.bitDepth}
                                  sampleRate={queue.currentTrack.sampleRate}
                                 
                                  compact
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {queue.queue.slice(queue.currentTrackIndex + 1).map((track, index) => {
                        const actualIndex = queue.currentTrackIndex + 1 + index;
                        return (
                          <div
                            key={track.id}
                          className={`flex items-center gap-3 p-3 rounded-xl transition-all select-none ${
                            draggedIndex === actualIndex ? 'bg-zinc-700 scale-[1.02] shadow-lg' : 'hover:bg-zinc-900/50'
                          }`}
                        >
                          <div 
                            className="flex items-center justify-center w-8 h-12 -ml-1 cursor-grab active:cursor-grabbing touch-none"
                            draggable
                            onDragStart={() => setDraggedIndex(actualIndex)}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (draggedIndex !== null && draggedIndex !== actualIndex) {
                                queue.reorderQueue(draggedIndex, actualIndex);
                                setDraggedIndex(actualIndex);
                              }
                            }}
                            onDragEnd={() => setDraggedIndex(null)}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              setDraggedIndex(actualIndex);
                              setTouchStart({ index: actualIndex, y: e.touches[0].clientY });
                            }}
                            onTouchMove={(e) => {
                              e.stopPropagation();
                              if (!touchStart) return;
                              const currentY = e.touches[0].clientY;
                              const diff = currentY - touchStart.y;
                              const newIndex = Math.max(0, Math.min(queue.queue.length - 1, touchStart.index + Math.round(diff / 72)));
                              if (newIndex !== draggedIndex) {
                                queue.reorderQueue(draggedIndex!, newIndex);
                                setDraggedIndex(newIndex);
                              }
                            }}
                            onTouchEnd={() => { setDraggedIndex(null); setTouchStart(null); }}
                          >
                            <GripVertical className="w-5 h-5 text-zinc-500" />
                          </div>
                          
                          <div className="flex-1 flex items-center gap-3 min-w-0" onClick={() => queue.playTrack(actualIndex)}>
                            <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
                              {track.coverUrl ? (
                                <img src={track.coverUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Disc3 className="w-5 h-5 text-zinc-600" strokeWidth={1} />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate text-zinc-300">
                                {track.title}
                              </p>
                              <div className="flex items-center gap-2">
                                <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
                                <AudioQualityBadge bitDepth={track.bitDepth} sampleRate={track.sampleRate} compact />
                              </div>
                            </div>
                          </div>
                          
                          <button onClick={() => queue.removeFromQueue(track.id)} className="p-2 text-zinc-600 hover:text-white">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 overflow-hidden">
              <div className="absolute inset-0 transition-all duration-700">
                {queue.currentTrack?.coverUrl ? (
                  <div
                    key={queue.currentTrack.id}
                    className="absolute inset-0 bg-center bg-cover scale-110 blur-3xl opacity-45 transition-all duration-700"
                    style={{ backgroundImage: `url(${queue.currentTrack.coverUrl})` }}
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black" />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/80" />
              </div>

              <div className="relative z-10 h-full min-h-0 flex flex-col">
                <div className="flex-1 min-h-0 flex items-start justify-center px-5 sm:px-8 pt-16 pb-4 sm:pt-16 sm:pb-5">
                  <div className="relative w-full max-w-[78vw] sm:max-w-[320px] aspect-square">
                    <div className="w-full h-full rounded-[28px] bg-zinc-900/70 backdrop-blur-md border border-white/10 album-shadow overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
                      {queue.currentTrack?.coverUrl ? (
                        <img key={queue.currentTrack.id} src={queue.currentTrack.coverUrl} alt={queue.currentTrack.title} className="w-full h-full object-cover transition-all duration-700" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                          <Disc3 className="w-20 h-20 text-zinc-600" strokeWidth={1} />
                        </div>
                      )}
                    </div>
                    {queue.currentTrack && (
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2">
                        <AudioQualityBadge bitDepth={queue.currentTrack.bitDepth} sampleRate={queue.currentTrack.sampleRate} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6.25rem)] z-20">
                  <div className="px-5 sm:px-8 mb-2 text-center">
                    <h1 className="text-[1.4rem] sm:text-2xl font-bold tracking-tight text-white truncate drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
                      {queue.currentTrack?.title || t('player.noPlayback')}
                    </h1>
                    <p className="text-sm text-zinc-300/90 truncate mt-1">
                      {queue.currentTrack?.artist || t('player.addMusicToStart')}
                    </p>
                  </div>

                  <div className="px-5 sm:px-8 mb-2">
                    {queue.currentTrack?.isHiRes && (
                      <div className="mb-2 flex justify-center">
                        <div className="inline-flex items-center gap-1.5 rounded-md border border-white/70 bg-black/35 px-2 py-1">
                          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-95">
                            <rect x="0.5" y="0.5" width="13" height="9" rx="2" stroke="currentColor" className="text-white"/>
                            <rect x="3" y="2.2" width="2" height="5.6" fill="currentColor" className="text-white"/>
                            <rect x="8.8" y="2.2" width="2" height="5.6" fill="currentColor" className="text-white"/>
                          </svg>
                          <span className="text-[10px] font-semibold tracking-tight text-white">Dolby Atmos</span>
                        </div>
                      </div>
                    )}
                    <input
                      type="range"
                      value={audioProcessor.currentTime}
                      max={audioProcessor.duration || 100}
                      step={0.1}
                      onChange={(e) => audioProcessor.seek(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-zinc-800/80 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                      style={{ background: `linear-gradient(to right, white ${(audioProcessor.currentTime / (audioProcessor.duration || 1)) * 100}%, rgba(39,39,42,0.85) ${(audioProcessor.currentTime / (audioProcessor.duration || 1)) * 100}%)` }}
                    />
                    <div className="flex justify-between mt-1.5 text-[11px] text-zinc-300/80 font-medium tabular-nums">
                      <span>{formatTime(audioProcessor.currentTime)}</span>
                      <span>-{formatTime((audioProcessor.duration || 0) - audioProcessor.currentTime)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-5 sm:gap-7 px-5 sm:px-8">
                    <button onClick={() => queue.previousTrack()} disabled={queue.queue.length === 0} className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 border border-white/10 text-zinc-100 hover:bg-white/20 disabled:opacity-30 transition-all btn-press flex items-center justify-center backdrop-blur-sm">
                      <SkipBack className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" strokeWidth={0} />
                    </button>
                    <button onClick={audioProcessor.isPlaying ? audioProcessor.pause : audioProcessor.play} disabled={!queue.currentTrack} className="w-[66px] h-[66px] sm:w-[72px] sm:h-[72px] rounded-full bg-white text-black flex items-center justify-center hover:scale-105 disabled:opacity-30 transition-all btn-press shadow-[0_14px_40px_rgba(255,255,255,0.35)]">
                      {audioProcessor.isPlaying ? <Pause className="w-7 h-7 sm:w-8 sm:h-8" fill="currentColor" strokeWidth={0} /> : <Play className="w-7 h-7 sm:w-8 sm:h-8 ml-1" fill="currentColor" strokeWidth={0} />}
                    </button>
                    <button onClick={() => queue.nextTrack()} disabled={queue.queue.length === 0} className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 border border-white/10 text-zinc-100 hover:bg-white/20 disabled:opacity-30 transition-all btn-press flex items-center justify-center backdrop-blur-sm">
                      <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" strokeWidth={0} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Library View */}
      {activeTab === 'library' && (
        <div className="flex-1 flex flex-col" data-testid="library-view">
          <header className="flex items-center justify-between px-6 pt-12 pb-4 border-b border-zinc-900">
              {libraryView === 'main' ? (
                <h2 className="text-xl font-bold">{t('library.title')}</h2>
              ) : libraryView === 'playlist-detail' && selectedPlaylist ? (
              <button onClick={() => { setLibraryView('playlists'); setSelectedPlaylist(null); }} className="flex items-center gap-2 text-zinc-400 hover:text-white">
                <ChevronRight className="w-5 h-5 rotate-180" />
                <span className="text-xl font-bold text-white">{selectedPlaylist.name}</span>
              </button>
            ) : (
              <button onClick={() => setLibraryView('main')} className="flex items-center gap-2 text-zinc-400 hover:text-white">
                <ChevronRight className="w-5 h-5 rotate-180" />
                <span className="text-xl font-bold text-white">
                  {libraryView === 'songs' ? t('library.songs') : libraryView === 'artists' ? t('library.artists') : libraryView === 'albums' ? t('library.albums') : libraryView === 'hires' ? t('library.highResolution') : t('library.playlists')}
                </span>
              </button>
            )}
            <div className="flex items-center gap-2">
              {libraryView === 'playlists' && (
                <button onClick={() => setShowCreatePlaylist(true)} className="p-2 text-zinc-400 hover:text-white">
                  <Plus className="w-5 h-5" />
                </button>
              )}
              {libraryView === 'main' && (
                <>
                  <AndroidMusicImporter onImportTracks={handleMediaStoreImport} />
                  <button onClick={handleFileSelect} className="p-2 text-zinc-400 hover:text-white">
                    <Plus className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
          </header>
          <ScrollArea className="flex-1">
            {libraryView === 'main' && (
              <div className="p-4 space-y-2">
                {queue.library.length > 0 && (
                  <button onClick={() => handleShufflePlay(queue.library)} className="w-full flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 transition-all mb-4">
                    <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                      <Shuffle className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-white">{t('library.shufflePlay')}</p>
                      <p className="text-sm text-white/70">{t('library.songsCount', { count: queue.library.length })}</p>
                    </div>
                    <Play className="w-6 h-6 text-white" fill="currentColor" />
                  </button>
                )}

                <button onClick={() => setLibraryView('playlists')} className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-900/50 hover:bg-zinc-900 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                    <ListMusic className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold">{t('library.playlists')}</p>
                    <p className="text-sm text-zinc-500">{t('library.playlistsCount', { count: playlistManager.playlists.length })}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                </button>

                <button onClick={() => setLibraryView('songs')} className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-900/50 hover:bg-zinc-900 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center">
                    <Music2 className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold">{t('library.songs')}</p>
                    <p className="text-sm text-zinc-500">{t('library.songsCount', { count: queue.library.length })}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                </button>

                <button onClick={() => setLibraryView('artists')} className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-900/50 hover:bg-zinc-900 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                    <User className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold">{t('library.artists')}</p>
                    <p className="text-sm text-zinc-500">{t('library.artistsCount', { count: Object.keys(songsByArtist).length })}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                </button>

                <button onClick={() => setLibraryView('albums')} className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-900/50 hover:bg-zinc-900 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center">
                    <Folder className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold">{t('library.albums')}</p>
                    <p className="text-sm text-zinc-500">{t('library.albumsCount', { count: Object.keys(albums).length })}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                </button>

                <button onClick={() => setLibraryView('hires')} className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-900/50 hover:bg-zinc-900 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center">
                    <img src="/hires-logo.svg" alt="Hi-Res Audio" className="w-7 h-7" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold">{t('library.highResolution')}</p>
                    <p className="text-sm text-zinc-500">{t('library.songsCount', { count: hiResTracks.length })}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                </button>

                {queue.isLoading ? (
                  <div className="text-center py-12">
                    <div className="w-8 h-8 border-2 border-zinc-700 border-t-white rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-zinc-500">{t('library.loadingLibrary')}</p>
                  </div>
                ) : queue.library.length === 0 ? (
                  <div className="text-center py-8 px-4">
                    <Disc3 className="w-16 h-16 text-zinc-800 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-zinc-500 mb-6">{t('library.noMusic')}</p>
                    
                    {/* Nuevo componente profesional de escaneo */}
                    <div className="max-w-md mx-auto">
                      <MusicScanner
                        onScanComplete={handleMediaStoreImport}
                        onManualImport={handleFileSelect}
                        isScanning={queue.importProgress.isImporting}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {libraryView === 'playlists' && (
              <div className="p-4 space-y-2">
                {playlistManager.playlists.length === 0 ? (
                  <div className="text-center py-12">
                    <ListMusic className="w-16 h-16 text-zinc-800 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-zinc-500 mb-4">{t('playlists.noPlaylists')}</p>
                    <Button onClick={() => setShowCreatePlaylist(true)} variant="outline" className="border-zinc-800">
                      {t('playlists.createFirst')}
                    </Button>
                  </div>
                ) : (
                  playlistManager.playlists.map((playlist) => (
                    <div key={playlist.id} className="flex items-center gap-4 p-4 rounded-xl bg-zinc-900/50 hover:bg-zinc-900 transition-colors">
                      <div 
                        className="flex-1 flex items-center gap-4 cursor-pointer"
                        onClick={() => { setSelectedPlaylist(playlist); setLibraryView('playlist-detail'); }}
                      >
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center overflow-hidden">
                          {playlist.tracks[0]?.coverUrl ? (
                            <img src={playlist.tracks[0].coverUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ListMusic className="w-6 h-6 text-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{playlist.name}</p>
                          <p className="text-sm text-zinc-500">{t('library.songsCount', { count: playlist.trackIds.length })}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayInOrder(playlist.tracks);
                          }}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold"
                        >
                          <Play className="w-3.5 h-3.5" fill="currentColor" />
                          {t('actions.play')}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleShufflePlay(playlist.tracks);
                          }}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-700 text-xs text-white"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                          {t('library.shuffle')}
                        </button>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.target as HTMLElement).getBoundingClientRect();
                          setPlaylistMenu({ playlist, x: rect.left - 100, y: rect.bottom + 8 });
                        }}
                        className="p-2 text-zinc-500 hover:text-white"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {libraryView === 'playlist-detail' && selectedPlaylist && (
              <div className="p-4 space-y-1">
                {/* Big Add Songs Button */}
                <button
                  onClick={() => setShowAddSongsToPlaylist(true)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 border-2 border-dashed border-zinc-700 transition-all mb-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-zinc-700 flex items-center justify-center">
                    <Plus className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-white">{t('playlists.addSongs')}</p>
                    <p className="text-sm text-zinc-500">{t('playlists.emptyDescription')}</p>
                  </div>
                </button>

                {selectedPlaylist.tracks.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <button
                      onClick={() => handlePlayInOrder(selectedPlaylist.tracks)}
                      className="flex items-center gap-2 px-5 py-2 rounded-full bg-white text-black font-semibold shadow-sm"
                    >
                      <Play className="w-4 h-4" fill="currentColor" />
                      {t('actions.play')}
                    </button>
                    <button
                      onClick={() => handleShufflePlay(selectedPlaylist.tracks)}
                      className="flex items-center gap-2 px-5 py-2 rounded-full border border-zinc-700 text-white"
                    >
                      <Shuffle className="w-4 h-4" />
                      {t('library.shuffle')}
                    </button>
                  </div>
                )}

                {selectedPlaylist.tracks.length === 0 ? (
                  <div className="text-center py-8">
                    <ListMusic className="w-16 h-16 text-zinc-800 mx-auto mb-4" strokeWidth={1} />
                    <p className="text-zinc-500 mb-2">{t('playlists.empty')}</p>
                  </div>
                ) : (
                  selectedPlaylist.tracks.map((track) => (
                    <div key={track.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-zinc-900/50 transition-colors">
                      <div className="flex-1 flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => handlePlayNow(track)}>
                        <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
                          {track.coverUrl ? (
                            <img src={track.coverUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Disc3 className="w-5 h-5 text-zinc-600" strokeWidth={1} />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{track.title}</p>
                          <p className="text-xs text-zinc-500 truncate">{track.artist}</p>
                        </div>
                      </div>
                      <button onClick={() => handleRemoveFromPlaylist(track)} className="p-2 text-zinc-600 hover:text-red-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {libraryView === 'songs' && (
              <div className="p-4 space-y-1">
                {sortedSongs.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <button
                        onClick={() => handlePlayInOrder(sortedSongs)}
                        className="flex items-center gap-2 px-5 py-2 rounded-full bg-white text-black font-semibold shadow-sm"
                      >
                        <Play className="w-4 h-4" fill="currentColor" />
                        {t('actions.play')}
                      </button>
                      <button
                        onClick={() => handleShufflePlay(sortedSongs)}
                        className="flex items-center gap-2 px-5 py-2 rounded-full border border-zinc-700 text-white"
                      >
                        <Shuffle className="w-4 h-4" />
                        {t('library.shuffle')}
                      </button>
                    </div>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-xs text-zinc-500">{t('library.sortBy')}</span>
                      <button onClick={() => setSongSort('default')} className={`px-3 py-1 rounded-full text-xs ${songSort === 'default' ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400'}`}>{t('library.sortDefault')}</button>
                      <button onClick={() => setSongSort('name')} className={`px-3 py-1 rounded-full text-xs ${songSort === 'name' ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400'}`}>{t('library.sortName')}</button>
                      <button onClick={() => setSongSort('artist')} className={`px-3 py-1 rounded-full text-xs ${songSort === 'artist' ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400'}`}>{t('library.sortArtist')}</button>
                    </div>
                  </>
                )}
                {sortedSongs.length > 0 && (
                  <p className="text-xs text-zinc-600 text-center mb-3 px-4">
                    {t('library.swipeHint')}
                  </p>
                )}
                {sortedSongs.slice(0, visibleSongsCount).map((track) => (
                  <SwipeableTrackItem
                    key={track.id}
                    track={track}
                    onPlayNow={handlePlayNow}
                    onAddToQueue={handleAddToQueue}
                    onPlayNext={handlePlayNext}
                    onAddToPlaylist={handleOpenAddToPlaylist}
                  />
                ))}
                {visibleSongsCount < sortedSongs.length && (
                  <div className="py-4 text-center">
                    <button onClick={() => setVisibleSongsCount((prev) => prev + 250)} className="px-4 py-2 rounded-full bg-zinc-900 text-zinc-200 text-sm">{t('library.loadMoreSongs', { count: Math.min(250, sortedSongs.length - visibleSongsCount) })}</button>
                  </div>
                )}
              </div>
            )}

            {libraryView === 'hires' && (
              <div className="p-4 space-y-1">
                {hiResTracks.length > 0 && (
                  <div className="flex items-center gap-3 mb-4">
                    <button
                      onClick={() => handlePlayInOrder(hiResTracks)}
                      className="flex items-center gap-2 px-5 py-2 rounded-full bg-white text-black font-semibold shadow-sm"
                    >
                      <Play className="w-4 h-4" fill="currentColor" />
                      {t('actions.play')}
                    </button>
                    <button
                      onClick={() => handleShufflePlay(hiResTracks)}
                      className="flex items-center gap-2 px-5 py-2 rounded-full border border-zinc-700 text-white"
                    >
                      <Shuffle className="w-4 h-4" />
                      {t('library.shuffle')}
                    </button>
                  </div>
                )}
                {hiResTracks.length > 0 && (
                  <p className="text-xs text-zinc-600 text-center mb-3 px-4">
                    {t('library.swipeHint')}
                  </p>
                )}
                {hiResTracks.length === 0 && (
                  <p className="text-center text-zinc-500 py-8">{t('library.noMusic', { defaultValue: 'No tienes música aún' })}</p>
                )}
                {hiResTracks.map((track) => (
                  <SwipeableTrackItem
                    key={track.id}
                    track={track}
                    onPlayNow={handlePlayNow}
                    onAddToQueue={handleAddToQueue}
                    onPlayNext={handlePlayNext}
                    onAddToPlaylist={handleOpenAddToPlaylist}
                  />
                ))}
              </div>
            )}

            {libraryView === 'artists' && (
              <div className="p-4 space-y-1">
                {Object.entries(songsByArtist).map(([artist, tracks]) => (
                  <div key={artist} className="mb-4">
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center">
                          <User className="w-6 h-6 text-zinc-500" />
                        </div>
                        <div>
                          <p className="font-semibold">{artist}</p>
                          <p className="text-sm text-zinc-500">{t('library.songsCount', { count: tracks.length })}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePlayInOrder(tracks)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold"
                        >
                          <Play className="w-3.5 h-3.5" fill="currentColor" />
                          {t('actions.play')}
                        </button>
                        <button
                          onClick={() => handleShufflePlay(tracks)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-700 text-xs text-white"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                          {t('library.shuffle')}
                        </button>
                      </div>
                    </div>
                    <div className="ml-4 border-l border-zinc-800 pl-2">
                      {tracks.map((track) => (
                        <SwipeableTrackItem 
                          key={track.id} 
                          track={track} 
                          onPlayNow={handlePlayNow} 
                          onAddToQueue={handleAddToQueue} 
                          onPlayNext={handlePlayNext}
                          onAddToPlaylist={handleOpenAddToPlaylist}
                          showArtist={false} 
                          compact 
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {libraryView === 'albums' && (
              <div className="p-4 grid grid-cols-2 gap-3">
                {Object.entries(albums).map(([album, tracks]) => (
                  <div key={album} className="bg-zinc-900/50 rounded-xl p-3 hover:bg-zinc-900 transition-colors">
                    <div className="aspect-square rounded-lg bg-zinc-800 mb-2 overflow-hidden cursor-pointer" onClick={() => handlePlayNow(tracks[0])}>
                      {tracks[0].coverUrl ? (
                        <img src={tracks[0].coverUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Folder className="w-8 h-8 text-zinc-600" />
                        </div>
                      )}
                    </div>
                    <p className="font-medium text-sm truncate">{album}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-zinc-500">{t('library.songsCount', { count: tracks.length })}</p>
                      <button onClick={(e) => { e.stopPropagation(); handleShufflePlay(tracks); }} className="p-1 text-zinc-500 hover:text-white" title={t('library.shuffle')}>
                        <Shuffle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}


      {/* Global Search View */}
      {activeTab === 'search' && (
        <div className="flex-1 flex flex-col" data-testid="search-view">
          <header className="px-6 pt-12 pb-4 border-b border-zinc-900">
            <h2 className="text-xl font-bold">{t('search.globalTitle')}</h2>
            <p className="text-xs text-zinc-500 mt-1">{t('search.globalSubtitle')}</p>
          </header>
          <div className="px-6 pt-3">
            <label className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <Search className="w-4 h-4 text-zinc-500" />
              <input
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                placeholder={t('search.globalPlaceholder')}
                className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
              />
            </label>
          </div>
          <ScrollArea className="flex-1 px-4 py-3">
            {!normalizedGlobalQuery ? (
              <p className="text-center text-zinc-500 py-10 text-sm">{t('search.startTyping')}</p>
            ) : globalResults.length === 0 ? (
              <p className="text-center text-zinc-500 py-10 text-sm">{t('search.noResults')}</p>
            ) : (
              <div className="space-y-1">
                {globalResults.map((track) => (
                  <SwipeableTrackItem
                    key={track.id}
                    track={track}
                    onPlayNow={handlePlayNow}
                    onAddToQueue={handleAddToQueue}
                    onPlayNext={handlePlayNext}
                    onAddToPlaylist={handleOpenAddToPlaylist}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Equalizer View */}
      {activeTab === 'eq' && (
        <div className="flex-1 flex flex-col" data-testid="eq-view">
          <header className="flex items-center justify-between px-6 pt-12 pb-4 border-b border-zinc-900">
            <h2 className="text-xl font-bold">{t('eq.title')}</h2>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowEqAutoModal(true)}
                className="text-xs px-3 py-1.5 h-auto"
              >
                {t('eq.autoButton')}
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 uppercase tracking-wider">{audioProcessor.eqEnabled ? t('eq.on') : t('eq.off')}</span>
                <Switch checked={audioProcessor.eqEnabled} onCheckedChange={toggleEq} />
              </div>
            </div>
          </header>
          <div className="flex-1 px-6 py-8">
            <div className="mb-4 rounded-2xl border border-cyan-500/25 bg-gradient-to-r from-cyan-500/10 to-violet-500/10 p-3">
              <p className="text-xs font-semibold text-cyan-200">{t('eq.iaBannerTitle')}</p>
              <p className="text-[11px] text-zinc-300 mt-1">{t('eq.iaBannerDescription')}</p>
            </div>
            <p className="text-[11px] text-zinc-500 mb-3">{t('eq.slideHint')}</p>
            <EQVisualizer bands={audioProcessor.eqBands} enabled={audioProcessor.eqEnabled} onBandChange={audioProcessor.setEqBandGain} minGain={EQ_GAIN_MIN} maxGain={EQ_GAIN_MAX} horizontalControlLabel={t('eq.horizontalSlider')} />
          </div>
          <div className="px-6 pb-8">
            <Button variant="outline" onClick={() => audioProcessor.eqBands.forEach((_, i) => audioProcessor.setEqBandGain(i, 0))} className="w-full border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900">
              {t('eq.reset')}
            </Button>
          </div>
        </div>
      )}

      {/* DSP View */}
      {activeTab === 'dsp' && (
        <div className="flex-1 flex flex-col" data-testid="dsp-view">
          <header className="flex items-center justify-between px-6 pt-12 pb-4 border-b border-zinc-900">
            <div>
              <h2 className="text-xl font-bold">{t('dsp.title')}</h2>
              <p className="text-xs text-zinc-600 mt-0.5">{t('dsp.subtitle')}</p>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="secondary"
                onClick={() => setShowDspAutoModal(true)}
                className="text-xs px-3 py-1.5 h-auto"
              >
                {t('dsp.autoButton')}
              </Button>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full transition-all ${epicenterEnabled ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'bg-zinc-700'}`} />
                <Switch checked={epicenterEnabled} onCheckedChange={toggleEpicenter} />
              </div>
            </div>
          </header>
          <div className="flex-1 flex flex-col justify-center px-4 py-8">
            <div className="card-elevated rounded-2xl p-6">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <KnobControl label={t('dsp.sweep')} value={dspParams.sweepFreq} min={27} max={63} step={1} unit=" Hz" onChange={(v) => updateDspParam('sweepFreq', v)} disabled={!epicenterEnabled} />
                <KnobControl label={t('dsp.width')} value={dspParams.width} min={0} max={100} step={1} unit="%" onChange={(v) => updateDspParam('width', v)} disabled={!epicenterEnabled} />
                <KnobControl label={t('dsp.intensity')} value={dspParams.intensity} min={0} max={100} step={1} unit="%" onChange={(v) => updateDspParam('intensity', v)} disabled={!epicenterEnabled} />
              </div>
              <div className="flex justify-center gap-8">
                <KnobControl label={t('dsp.balance')} value={dspParams.balance} min={0} max={100} step={1} unit="%" onChange={(v) => updateDspParam('balance', v)} disabled={!epicenterEnabled} />
                <KnobControl label={t('dsp.volume')} value={dspParams.volume} min={0} max={150} step={1} unit="%" onChange={(v) => updateDspParam('volume', v)} />
              </div>
            </div>
            <p className="text-center text-xs text-zinc-600 mt-6 px-8">{t('dsp.description')}</p>
          </div>
        </div>
      )}

      {showEqAutoModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-md border border-zinc-800 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{t('eq.autoTitle')}</h3>
                <p className="text-sm text-zinc-400 mt-1">{t('eq.autoDescription')}</p>
              </div>
              <button onClick={() => setShowEqAutoModal(false)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-xl">
              <p className="text-sm text-zinc-300">{t('eq.autoEnable')}</p>
              <Switch checked={eqAutoEnabled} onCheckedChange={setEqAutoEnabled} />
            </div>
            <Button onClick={() => { runAutoOptimization(true); setShowEqAutoModal(false); }} className="w-full bg-white text-black hover:bg-zinc-200">
              {t('eq.autoApplyNow')}
            </Button>
          </div>
        </div>
      )}

      {showDspAutoModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-md border border-zinc-800 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{t('dsp.autoTitle')}</h3>
                <p className="text-sm text-zinc-400 mt-1">{t('dsp.autoDescription')}</p>
              </div>
              <button onClick={() => setShowDspAutoModal(false)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-xl">
              <p className="text-sm text-zinc-300">{t('dsp.autoEnable')}</p>
              <Switch checked={dspAutoEnabled} onCheckedChange={setDspAutoEnabled} />
            </div>
            <Button onClick={() => { runAutoOptimization(true); setShowDspAutoModal(false); }} className="w-full bg-white text-black hover:bg-zinc-200">
              {t('dsp.autoApplyNow')}
            </Button>
          </div>
        </div>
      )}

      {/* Settings View */}
      {activeTab === 'settings' && (
        <div className="flex-1 flex flex-col" data-testid="settings-view">
          <header className="px-6 pt-12 pb-6 border-b border-zinc-900">
            <h2 className="text-xl font-bold">{t('settings.title')}</h2>
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Appearance */}
            {switchable && (
              <div className="bg-zinc-900/50 rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-zinc-700/40 flex items-center justify-center">
                    <Disc3 className="w-5 h-5 text-zinc-300" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{t('settings.appearance')}</h3>
                    <p className="text-xs text-zinc-500">{t('settings.appearanceDescription')}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-xl">
                  <div>
                    <p className="font-medium">{t('settings.theme')}</p>
                    <p className="text-xs text-zinc-500">
                      {theme === 'dark' ? t('settings.dark') : t('settings.light')}
                    </p>
                  </div>
                  <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} />
                </div>
              </div>
            )}

            {/* Language */}
            <div className="bg-zinc-900/50 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-semibold">{t('settings.language')}</h3>
                  <p className="text-xs text-zinc-500">{t('settings.languageDescription')}</p>
                </div>
              </div>
              <div className="space-y-2">
                <button onClick={() => setLanguage('es')} className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${language === 'es' ? 'bg-white/10 border border-white/20' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}>
                  <span className="flex items-center gap-3"><span className="text-lg">🇪🇸</span><span>{t('settings.spanish')}</span></span>
                  {language === 'es' && <span className="w-2 h-2 rounded-full bg-white" />}
                </button>
                <button onClick={() => setLanguage('en')} className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${language === 'en' ? 'bg-white/10 border border-white/20' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}>
                  <span className="flex items-center gap-3"><span className="text-lg">🇺🇸</span><span>{t('settings.english')}</span></span>
                  {language === 'en' && <span className="w-2 h-2 rounded-full bg-white" />}
                </button>
              </div>
            </div>

            {/* Crossfade */}
            <div className="bg-zinc-900/50 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-green-600/20 flex items-center justify-center">
                  <Volume2 className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <h3 className="font-semibold">{t('settings.playback')}</h3>
                  <p className="text-xs text-zinc-500">{t('settings.playbackDescription')}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-xl">
                  <div>
                    <p className="font-medium">{t('settings.crossfade')}</p>
                    <p className="text-xs text-zinc-500">{t('settings.crossfadeDescription')}</p>
                  </div>
                  <Switch checked={crossfade.enabled} onCheckedChange={crossfade.setEnabled} />
                </div>
                {crossfade.enabled && (
                  <div className="p-3 bg-zinc-800/30 rounded-xl">
                    <p className="text-sm text-zinc-400 mb-3">{t('settings.crossfadeDuration')}</p>
                    <div className="flex gap-2">
                      {[3, 5, 7, 10].map((s) => (
                        <button key={s} onClick={() => crossfade.setDuration(s)} className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${crossfade.duration === s ? 'bg-white text-black' : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700'}`}>
                          {s}s
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* How to use */}
            <div className="bg-zinc-900/50 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-yellow-600/20 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-yellow-400" />
                </div>
                <div>
                  <h3 className="font-semibold">{t('settings.howToUse')}</h3>
                  <p className="text-xs text-zinc-500">{t('settings.howToUseDescription')}</p>
                </div>
              </div>
              <Button asChild variant="secondary" className="w-full justify-between">
                <Link href="/how-to-use">
                  <span>{t('settings.howToUseCta')}</span>
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                </Link>
              </Button>
            </div>

            {/* About */}
            <div className="bg-zinc-900/50 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-purple-600/20 flex items-center justify-center">
                  <Info className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="font-semibold">{t('settings.about')}</h3>
                  <p className="text-xs text-zinc-500">{t('settings.aboutDescription')}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-3 bg-zinc-800/50 rounded-xl">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center">
                    <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z"/></svg>
                  </div>
                  <div>
                    <h4 className="font-bold">{t('app.name')}</h4>
                    <p className="text-sm text-zinc-500">{t('settings.version')} {t('app.version')}</p>
                  </div>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">{t('settings.description')}</p>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('settings.features')}</p>
                  <ul className="space-y-2 text-sm text-zinc-400">
                    <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />{t('settings.feature1')}</li>
                    <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />{t('settings.feature2')}</li>
                    <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />{t('settings.feature3')}</li>
                    <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />{t('settings.feature4')}</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Legal */}
            <div className="bg-zinc-900/50 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-emerald-600/20 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold">{t('settings.legal')}</h3>
                  <p className="text-xs text-zinc-500">{t('settings.legalDescription')}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Button asChild variant="secondary" className="w-full justify-between">
                  <Link href="/privacy">
                    <span>{t('settings.privacyPolicy')}</span>
                    <ChevronRight className="w-4 h-4 text-zinc-400" />
                  </Link>
                </Button>
                <Button asChild variant="secondary" className="w-full justify-between">
                  <Link href="/terms">
                    <span>{t('settings.terms')}</span>
                    <ChevronRight className="w-4 h-4 text-zinc-400" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Progress */}
      {queue.importProgress.isImporting && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-sm border border-zinc-800 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-purple-600/20 flex items-center justify-center">
                <Music2 className="w-5 h-5 text-purple-400 animate-pulse" />
              </div>
              <div>
                <h3 className="font-semibold text-white">{t('actions.importingMusic')}</h3>
                <p className="text-sm text-zinc-400">{t('actions.ofTotal', { current: queue.importProgress.current + 1, total: queue.importProgress.total })}</p>
              </div>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300" style={{ width: `${((queue.importProgress.current + 1) / queue.importProgress.total) * 100}%` }} />
            </div>
            <p className="text-xs text-zinc-500 truncate">{queue.importProgress.currentFileName}</p>
            <p className="text-center text-2xl font-bold text-white mt-4">{Math.round(((queue.importProgress.current + 1) / queue.importProgress.total) * 100)}%</p>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <BottomNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLibraryTab={() => {
          setActiveTab('library');
          setLibraryView('main');
        }}
        eqEnabled={audioProcessor.eqEnabled}
        epicenterEnabled={epicenterEnabled}
        t={t}
      />
      <div className={activeTab === 'player' ? "h-0" : "h-20"} />
    </div>
  );
}
