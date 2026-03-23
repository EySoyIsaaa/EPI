/**
 * Epicenter Hi-Fi - Apple Music Style Player
 * Diseño minimalista, monocromático y premium
 * Con biblioteca de música organizada, playlists y cola interactiva
 *
 * v1.1.3 - Splash screen + Last track memory
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  useIntegratedAudioProcessor,
  type StreamingParams,
} from "@/hooks/useIntegratedAudioProcessor";
import {
  analyzeSpectrumAndSelectPreset,
  applyPresetSmooth,
  suggestDspFromScores,
} from "@/audio/autoPresetSelector";
import { useAudioQueue, type Track } from "@/hooks/useAudioQueue";
import { usePlaylists, type Playlist } from "@/hooks/usePlaylists";
import { usePresetPersistence } from "@/hooks/usePresetPersistence";
import { useMediaSession } from "@/hooks/useMediaSession";
import { useMediaNotification } from "@/hooks/useMediaNotification";
import { useNotificationPermission } from "@/hooks/useNotificationPermission";
import { useCrossfade } from "@/hooks/useCrossfade";
import { useLastTrack } from "@/hooks/useLastTrack";
import { useTheme } from "@/contexts/ThemeContext";
import {
  AddSongsToPlaylistModal,
  AddToPlaylistModal,
  DeletePlaylistModal,
  DuplicatesModal,
  OnboardingModal,
  PlaylistContextMenu,
  PlaylistNameModal,
  TrackContextMenu,
} from "@/components/home/HomeOverlays";
import { HomePlayerView } from "@/components/home/HomePlayerView";
import { HomeLibraryView } from "@/components/home/HomeLibraryView";
import { HomeSearchView } from "@/components/home/HomeSearchView";
import { HomeEqView } from "@/components/home/HomeEqView";
import { HomeDspView } from "@/components/home/HomeDspView";
import { HomeSettingsView } from "@/components/home/HomeSettingsView";
import { HomeAutoModeModal } from "@/components/home/HomeAutoModeModal";
import { HomeImportProgressOverlay } from "@/components/home/HomeImportProgressOverlay";
import { BottomNavigation } from "@/components/BottomNavigation";
import { useLanguage } from "@/hooks/useLanguage";
import {
  useAndroidMusicLibrary,
  type AndroidMusicFile,
} from "@/hooks/useAndroidMusicLibrary";
import { appLogoUrl, hiresAudioBadgeUrl, hiresLogoUrl } from "@/lib/assetUrls";
import {
  type DspParamConfig,
  type HomeLibraryView as LibraryView,
  type HomeSongSort,
  type HomeTabType,
} from "@/components/home/types";
import { toast } from "sonner";

const clampDspParam = (key: keyof StreamingParams, value: number): number => {
  switch (key) {
    case "sweepFreq":
      return Math.max(27, Math.min(63, value));
    case "width":
    case "intensity":
    case "balance":
    case "volume":
      return Math.max(0, Math.min(100, value));
    default:
      return value;
  }
};

const clampDspParams = (params: StreamingParams): StreamingParams => ({
  sweepFreq: clampDspParam("sweepFreq", params.sweepFreq),
  width: clampDspParam("width", params.width),
  intensity: clampDspParam("intensity", params.intensity),
  balance: clampDspParam("balance", params.balance),
  volume: clampDspParam("volume", params.volume),
});

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

  useNotificationPermission();

  const [activeTab, setActiveTab] = useState<HomeTabType>("player");
  const [libraryView, setLibraryView] = useState<LibraryView>("main");
  const [songSort, setSongSort] = useState<HomeSongSort>("default");
  const [visibleSongsCount, setVisibleSongsCount] = useState(250);
  const [showQueue, setShowQueue] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [dspParams, setDspParams] = useState<StreamingParams>({
    sweepFreq: 45,
    width: 50,
    intensity: 50,
    balance: 50,
    volume: 100,
  });
  const [eqAutoEnabled, setEqAutoEnabled] = useState(false);
  const [dspAutoEnabled, setDspAutoEnabled] = useState(false);
  const [showEqAutoModal, setShowEqAutoModal] = useState(false);
  const [showDspAutoModal, setShowDspAutoModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    track: Track;
    x: number;
    y: number;
  } | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(
    null,
  );
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [showRenamePlaylist, setShowRenamePlaylist] = useState(false);
  const [showDeletePlaylist, setShowDeletePlaylist] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState<Track | null>(
    null,
  );
  const [showAddSongsToPlaylist, setShowAddSongsToPlaylist] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState<string[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [playlistMenu, setPlaylistMenu] = useState<{
    playlist: Playlist;
    x: number;
    y: number;
  } | null>(null);
  const [touchStart, setTouchStart] = useState<{
    index: number;
    y: number;
  } | null>(null);

  const epicenterEnabled = audioProcessor.epicenterEnabled;
  const currentTrackRef = useRef<string | null>(null);
  const initialLoadRef = useRef(true);
  const lastTrackLoadedRef = useRef(false);
  const lastAutoPresetTrackRef = useRef<string | null>(null);
  const lastAutoPresetTimeRef = useRef(0);

  const hiResTracks = useMemo(
    () => queue.library.filter((track) => track.isHiRes),
    [queue.library],
  );

  const sortedSongs = useMemo(() => {
    if (songSort === "default") return queue.library;

    const copy = [...queue.library];
    const locale = language === "es" ? "es" : "en";

    if (songSort === "name") {
      copy.sort((a, b) =>
        a.title.localeCompare(b.title, locale, { sensitivity: "base" }),
      );
      return copy;
    }

    copy.sort((a, b) =>
      a.artist.localeCompare(b.artist, locale, { sensitivity: "base" }),
    );
    return copy;
  }, [queue.library, songSort, language]);

  const normalizedGlobalQuery = globalSearchQuery.trim().toLowerCase();

  const globalResults = useMemo(() => {
    if (!normalizedGlobalQuery) return [];
    return queue.library.filter((track) =>
      `${track.title} ${track.artist}`
        .toLowerCase()
        .includes(normalizedGlobalQuery),
    );
  }, [queue.library, normalizedGlobalQuery]);

  const onboardingSteps = useMemo(
    () => [
      {
        title: t("onboarding.step1Title"),
        description: t("onboarding.step1Description"),
      },
      {
        title: t("onboarding.step2Title"),
        description: t("onboarding.step2Description"),
      },
      {
        title: t("onboarding.step3Title"),
        description: t("onboarding.step3Description"),
      },
    ],
    [t],
  );

  const songsByArtist = useMemo(
    () =>
      queue.library.reduce(
        (acc, track) => {
          const artist = track.artist || t("common.unknownArtist");
          if (!acc[artist]) acc[artist] = [];
          acc[artist].push(track);
          return acc;
        },
        {} as Record<string, Track[]>,
      ),
    [queue.library, t],
  );

  const albums = useMemo(
    () =>
      queue.library.reduce(
        (acc, track) => {
          const album = track.title.split(" - ")[0] || track.title;
          if (!acc[album]) acc[album] = [];
          acc[album].push(track);
          return acc;
        },
        {} as Record<string, Track[]>,
      ),
    [queue.library],
  );

  const dspKnobRows = useMemo<DspParamConfig[][]>(
    () => [
      [
        {
          key: "sweepFreq",
          label: t("dsp.sweep"),
          min: 27,
          max: 63,
          step: 1,
          unit: " Hz",
          value: dspParams.sweepFreq,
          disabled: !epicenterEnabled,
        },
        {
          key: "width",
          label: t("dsp.width"),
          min: 0,
          max: 100,
          step: 1,
          unit: "%",
          value: dspParams.width,
          disabled: !epicenterEnabled,
        },
        {
          key: "intensity",
          label: t("dsp.intensity"),
          min: 0,
          max: 100,
          step: 1,
          unit: "%",
          value: dspParams.intensity,
          disabled: !epicenterEnabled,
        },
      ],
      [
        {
          key: "balance",
          label: t("dsp.balance"),
          min: 0,
          max: 100,
          step: 1,
          unit: "%",
          value: dspParams.balance,
          disabled: !epicenterEnabled,
        },
        {
          key: "volume",
          label: t("dsp.volume"),
          min: 0,
          max: 100,
          step: 1,
          unit: "%",
          value: dspParams.volume,
        },
      ],
    ],
    [dspParams, epicenterEnabled, t],
  );

  useEffect(() => {
    setVisibleSongsCount(250);
  }, [songSort, queue.library.length]);

  useEffect(() => {
    const dismissed = localStorage.getItem("epicenter-onboarding-dismissed");
    const legacyDismissed = localStorage.getItem("epicenter-welcome-dismissed");

    if (!dismissed && !legacyDismissed) {
      setShowOnboarding(true);
    } else if (!dismissed && legacyDismissed) {
      localStorage.setItem("epicenter-onboarding-dismissed", "true");
    }
  }, []);

  useEffect(() => {
    if (!selectedPlaylist) return;

    const updated = playlistManager.playlists.find(
      (playlist) => playlist.id === selectedPlaylist.id,
    );

    if (
      updated &&
      (updated.name !== selectedPlaylist.name ||
        updated.trackIds.length !== selectedPlaylist.trackIds.length)
    ) {
      setSelectedPlaylist(updated);
    }
  }, [playlistManager.playlists, selectedPlaylist]);

  useEffect(() => {
    const lastConfig = presetManager.getLastConfig();
    if (lastConfig) {
      setDspParams(clampDspParams(lastConfig.dspParams));
      audioProcessor.eqBands.forEach((_, index) => {
        audioProcessor.setEqBandGain(index, lastConfig.eqBands[index] || 0);
      });
    }
    initialLoadRef.current = false;
  }, []);

  useEffect(() => {
    audioProcessor.setCrossfadeConfig({
      enabled: crossfade.enabled,
      duration: crossfade.duration,
    });
  }, [audioProcessor, crossfade.enabled, crossfade.duration]);

  useEffect(() => {
    audioProcessor.setOnTrackEnded(() => {
      if (
        queue.queue.length > 0 &&
        queue.currentTrackIndex < queue.queue.length - 1
      ) {
        queue.nextTrack();
      }
    });

    return () => {
      audioProcessor.setOnTrackEnded(null);
    };
  }, [audioProcessor, queue]);

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
        audioProcessor.seek(
          Math.min(
            audioProcessor.duration,
            audioProcessor.currentTime + offset,
          ),
        );
      },
    });

    mediaNotification.setHandlers({
      onPlay: () => audioProcessor.play(),
      onPause: () => audioProcessor.pause(),
      onNext: () => queue.nextTrack(),
      onPrevious: () => queue.previousTrack(),
      onSeek: (time) => audioProcessor.seek(time),
    });
  }, [audioProcessor, mediaNotification, mediaSession, queue]);

  useEffect(() => {
    if (!queue.currentTrack) return;

    mediaSession.updateMetadata({
      title: queue.currentTrack.title,
      artist: queue.currentTrack.artist,
      artwork: queue.currentTrack.coverUrl,
    });

    mediaNotification.updateMetadata({
      title: queue.currentTrack.title,
      artist: queue.currentTrack.artist,
      album: "Epicenter Hi-Fi",
      artwork: queue.currentTrack.coverUrl,
    });
  }, [mediaNotification, mediaSession, queue.currentTrack]);

  useEffect(() => {
    mediaSession.updatePlaybackState(
      audioProcessor.isPlaying ? "playing" : "paused",
    );
    mediaNotification.updatePlaybackState(audioProcessor.isPlaying);

    if (audioProcessor.isPlaying && queue.currentTrack) {
      mediaNotification.start();
    }
  }, [
    audioProcessor.isPlaying,
    mediaNotification,
    mediaSession,
    queue.currentTrack,
  ]);

  useEffect(() => {
    if (audioProcessor.duration <= 0) return;

    mediaSession.updatePosition(
      audioProcessor.currentTime,
      audioProcessor.duration,
    );
    mediaNotification.updatePosition(
      audioProcessor.currentTime,
      audioProcessor.duration,
    );
  }, [
    audioProcessor.currentTime,
    audioProcessor.duration,
    mediaNotification,
    mediaSession,
  ]);

  useEffect(() => {
    if (initialLoadRef.current) return;

    const timer = setTimeout(() => {
      presetManager.saveLastConfig(
        audioProcessor.eqBands.map((band) => band.gain),
        dspParams,
      );
    }, 500);

    return () => clearTimeout(timer);
  }, [audioProcessor.eqBands, dspParams, presetManager]);

  useEffect(() => {
    const loadLastTrack = async () => {
      if (
        queue.isLoading ||
        !lastTrack.isLoaded ||
        !lastTrack.lastTrackId ||
        queue.currentTrack ||
        lastTrackLoadedRef.current
      ) {
        return;
      }

      lastTrackLoadedRef.current = true;
      const track = queue.library.find(
        (item) => item.id === lastTrack.lastTrackId,
      );
      if (!track) return;

      queue.addToQueue(track);
      queue.playTrack(0);

      try {
        const source = track.sourceUri ?? track.file;
        if (!source) {
          throw new Error("Track source not available");
        }
        await audioProcessor.loadFile(source, dspParams);
        currentTrackRef.current = track.id;
      } catch (error) {
        console.error("[LastTrack] Error loading last track:", error);
      }
    };

    loadLastTrack();
  }, [
    audioProcessor,
    dspParams,
    lastTrack.isLoaded,
    lastTrack.lastTrackId,
    queue,
  ]);

  const runAutoOptimization = useCallback(
    async (force = false) => {
      if (!eqAutoEnabled && !dspAutoEnabled) return;
      if (!queue.currentTrack) return;

      const now = Date.now();
      if (
        !force &&
        lastAutoPresetTrackRef.current === queue.currentTrack.id &&
        now - lastAutoPresetTimeRef.current < 30000
      ) {
        return;
      }

      const analyserNode = audioProcessor.getAnalyserNode();
      const selection = await analyzeSpectrumAndSelectPreset({
        analyserNode,
        sampleCount: 80,
        intervalMs: 125,
      });

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
          audioProcessor.setEpicenterEnabled(true);
        }

        const dspSuggestion = suggestDspFromScores(selection.debug);
        const clampedSuggestion = clampDspParams({
          ...dspParams,
          ...dspSuggestion,
        });

        setDspParams(clampedSuggestion);
        Object.entries(clampedSuggestion).forEach(([key, value]) => {
          if (typeof value === "number") {
            audioProcessor.setDspParam(key as keyof StreamingParams, value);
          }
        });
      }

      lastAutoPresetTrackRef.current = queue.currentTrack.id;
      lastAutoPresetTimeRef.current = now;

      console.log("[AutoAdjustment]", {
        presetId: selection.presetId,
        presetName: selection.preset.name,
        debug: selection.debug,
      });

      toast.success(t("actions.autoOptimizedPreset"));
    },
    [
      audioProcessor,
      dspAutoEnabled,
      dspParams,
      epicenterEnabled,
      eqAutoEnabled,
      queue.currentTrack,
      t,
    ],
  );

  useEffect(() => {
    const loadTrack = async () => {
      if (
        !queue.currentTrack ||
        queue.currentTrack.id === currentTrackRef.current
      ) {
        return;
      }

      currentTrackRef.current = queue.currentTrack.id;

      const libraryTrack = queue.library.find(
        (track) =>
          queue.currentTrack?.title === track.title &&
          queue.currentTrack?.artist === track.artist,
      );
      if (libraryTrack) {
        lastTrack.saveLastTrack(libraryTrack.id);
      }

      try {
        let source: File | string | undefined;

        if (
          queue.currentTrack.sourceType === "media-store" &&
          queue.currentTrack.sourceUri
        ) {
          const trackId = queue.currentTrack.id.replace("media-", "");
          const fileUrl = await androidMusicLibrary.getAudioFileUrl(
            queue.currentTrack.sourceUri,
            trackId,
          );
          if (!fileUrl) {
            throw new Error("No se pudo obtener el audio del dispositivo");
          }
          source = fileUrl;
        } else {
          source = await queue.getTrackFile(queue.currentTrack);
        }

        if (!source) {
          throw new Error("Track source not available");
        }

        await audioProcessor.loadFile(source, dspParams);
        setTimeout(() => {
          audioProcessor.play();
          setTimeout(() => {
            runAutoOptimization();
          }, 1400);
        }, 100);
      } catch (error) {
        console.error("Error loading track:", error);
        toast.error(t("actions.errorLoadingTrack"));
      }
    };

    loadTrack();
  }, [
    androidMusicLibrary,
    audioProcessor,
    dspParams,
    lastTrack,
    queue,
    runAutoOptimization,
    t,
  ]);

  const dismissOnboarding = useCallback(() => {
    localStorage.setItem("epicenter-onboarding-dismissed", "true");
    setShowOnboarding(false);
    setOnboardingStep(0);
  }, []);

  const handleFileSelect = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac";
    input.multiple = true;
    input.onchange = async (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || []);
      if (files.length === 0) return;

      try {
        const result = await queue.addToLibrary(files);
        if (result.added > 0) {
          const message =
            result.added > 1
              ? t("actions.songsAddedPlural", { count: result.added })
              : t("actions.songsAdded", { count: result.added });
          toast.success(message);
        }
        if (result.duplicates.length > 0) {
          setShowDuplicatesModal(result.duplicates);
        }
      } catch {
        toast.error(t("actions.errorAddingSongs"));
      }
    };
    input.click();
  }, [queue, t]);

  const handleMediaStoreImport = useCallback(
    async (tracks: AndroidMusicFile[]) => {
      const result = await queue.addMediaStoreTracks(
        tracks,
        androidMusicLibrary.getAlbumArt,
      );

      if (result.added > 0) {
        const message =
          result.added > 1
            ? t("actions.songsAddedPlural", { count: result.added })
            : t("actions.songsAdded", { count: result.added });
        toast.success(message);
      }

      if (result.duplicates.length > 0) {
        setShowDuplicatesModal(result.duplicates);
      }

      return result;
    },
    [androidMusicLibrary.getAlbumArt, queue, t],
  );

  const updateDspParam = useCallback(
    (key: keyof StreamingParams, value: number) => {
      const clampedValue = clampDspParam(key, value);
      setDspParams((previous) => ({ ...previous, [key]: clampedValue }));
      if (key === "volume" || epicenterEnabled) {
        audioProcessor.setDspParam(key, clampedValue);
      }
    },
    [audioProcessor, epicenterEnabled],
  );

  const toggleEq = useCallback(
    (enabled: boolean) => {
      audioProcessor.setEqEnabled(enabled);
    },
    [audioProcessor],
  );

  const toggleEpicenter = useCallback(() => {
    const newEnabled = !epicenterEnabled;
    audioProcessor.setEpicenterEnabled(newEnabled);
    if (newEnabled) {
      Object.entries(dspParams).forEach(([key, value]) => {
        audioProcessor.setDspParam(key as keyof StreamingParams, value);
      });
    }
  }, [audioProcessor, dspParams, epicenterEnabled]);

  const formatTime = useCallback((seconds: number) => {
    if (!isFinite(seconds)) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const handleAddToQueue = useCallback(
    (track: Track) => {
      queue.addToQueue(track);
      toast.success(t("actions.addedToQueue"));
      setContextMenu(null);
    },
    [queue, t],
  );

  const handlePlayNext = useCallback(
    (track: Track) => {
      queue.addToQueueNext(track);
      toast.success(t("actions.willPlayNext"));
      setContextMenu(null);
    },
    [queue, t],
  );

  const handlePlayNow = useCallback(
    (track: Track) => {
      queue.playNow(track);
      setContextMenu(null);
      setActiveTab("player");
      setShowQueue(false);
    },
    [queue],
  );

  const handleShufflePlay = useCallback(
    (tracks: Track[]) => {
      if (tracks.length === 0) {
        toast.error(t("actions.noSongsToPlay"));
        return;
      }
      queue.shuffleAll(tracks);
      toast.success(t("actions.playingShuffled", { count: tracks.length }));
      setActiveTab("player");
      setShowQueue(false);
    },
    [queue, t],
  );

  const handlePlayInOrder = useCallback(
    (tracks: Track[]) => {
      if (tracks.length === 0) {
        toast.error(t("actions.noSongsToPlay"));
        return;
      }
      queue.playAllInOrder(tracks);
      toast.success(t("actions.playingAll", { count: tracks.length }));
      setActiveTab("player");
      setShowQueue(false);
    },
    [queue, t],
  );

  const handleCreatePlaylist = useCallback(async () => {
    if (!newPlaylistName.trim()) return;
    await playlistManager.createPlaylist(newPlaylistName.trim());
    toast.success(t("playlists.created"));
    setNewPlaylistName("");
    setShowCreatePlaylist(false);
  }, [newPlaylistName, playlistManager, t]);

  const handleRenamePlaylist = useCallback(async () => {
    if (!selectedPlaylist || !newPlaylistName.trim()) return;
    await playlistManager.renamePlaylist(
      selectedPlaylist.id,
      newPlaylistName.trim(),
    );
    setSelectedPlaylist({ ...selectedPlaylist, name: newPlaylistName.trim() });
    toast.success(t("playlists.renamed"));
    setNewPlaylistName("");
    setShowRenamePlaylist(false);
    setPlaylistMenu(null);
  }, [newPlaylistName, playlistManager, selectedPlaylist, t]);

  const handleDeletePlaylist = useCallback(async () => {
    if (!selectedPlaylist) return;
    await playlistManager.deletePlaylist(selectedPlaylist.id);
    toast.success(t("playlists.deleted"));
    setSelectedPlaylist(null);
    setShowDeletePlaylist(false);
    setPlaylistMenu(null);
    setLibraryView("playlists");
  }, [playlistManager, selectedPlaylist, t]);

  const handleAddToPlaylist = useCallback(
    async (playlistId: string, track: Track) => {
      await playlistManager.addTrackToPlaylist(playlistId, track.id);
      toast.success(t("playlists.songAdded"));
      setShowAddToPlaylist(null);
    },
    [playlistManager, t],
  );

  const handleRemoveFromPlaylist = useCallback(
    async (track: Track) => {
      if (!selectedPlaylist) return;
      await playlistManager.removeTrackFromPlaylist(
        selectedPlaylist.id,
        track.id,
      );
      const updatedPlaylist = playlistManager.playlists.find(
        (playlist) => playlist.id === selectedPlaylist.id,
      );
      if (updatedPlaylist) {
        setSelectedPlaylist(updatedPlaylist);
      }
      toast.success(t("playlists.songRemoved"));
    },
    [playlistManager, selectedPlaylist, t],
  );

  const handleOpenAddToPlaylist = useCallback((track: Track) => {
    setShowAddToPlaylist(track);
  }, []);

  const handleAddSongToSelectedPlaylist = useCallback(
    async (track: Track) => {
      if (!selectedPlaylist) return;
      if (selectedPlaylist.trackIds.includes(track.id)) {
        toast.error(t("duplicates.alreadyInPlaylist"));
        return;
      }
      await playlistManager.addTrackToPlaylist(selectedPlaylist.id, track.id);
      toast.success(t("playlists.songAdded"));
    },
    [playlistManager, selectedPlaylist, t],
  );

  const handleOpenPlaylistMenu = useCallback(
    (playlist: Playlist, anchor: HTMLElement) => {
      const rect = anchor.getBoundingClientRect();
      setPlaylistMenu({
        playlist,
        x: rect.left - 100,
        y: rect.bottom + 8,
      });
    },
    [],
  );

  return (
    <div className="min-h-screen flex flex-col bg-black text-white">
      <TrackContextMenu
        contextMenu={contextMenu}
        t={t}
        onClose={() => setContextMenu(null)}
        onPlayNow={handlePlayNow}
        onPlayNext={handlePlayNext}
        onAddToQueue={handleAddToQueue}
        onAddToPlaylist={(track) => {
          setShowAddToPlaylist(track);
          setContextMenu(null);
        }}
      />

      <PlaylistContextMenu
        playlistMenu={playlistMenu}
        t={t}
        onClose={() => setPlaylistMenu(null)}
        onRename={(playlist) => {
          setSelectedPlaylist(playlist);
          setNewPlaylistName(playlist.name);
          setShowRenamePlaylist(true);
        }}
        onDelete={(playlist) => {
          setSelectedPlaylist(playlist);
          setShowDeletePlaylist(true);
        }}
      />

      <PlaylistNameModal
        isOpen={showCreatePlaylist}
        title={t("playlists.createNew")}
        confirmLabel={t("playlists.create")}
        cancelLabel={t("common.cancel")}
        playlistName={newPlaylistName}
        placeholder={t("playlists.enterName")}
        onPlaylistNameChange={setNewPlaylistName}
        onClose={() => {
          setShowCreatePlaylist(false);
          setNewPlaylistName("");
        }}
        onConfirm={handleCreatePlaylist}
      />

      <PlaylistNameModal
        isOpen={showRenamePlaylist && !!selectedPlaylist}
        title={t("playlists.rename")}
        confirmLabel={t("common.save")}
        cancelLabel={t("common.cancel")}
        playlistName={newPlaylistName}
        placeholder={t("playlists.enterName")}
        onPlaylistNameChange={setNewPlaylistName}
        onClose={() => {
          setShowRenamePlaylist(false);
          setNewPlaylistName("");
          setPlaylistMenu(null);
        }}
        onConfirm={handleRenamePlaylist}
      />

      <DeletePlaylistModal
        isOpen={showDeletePlaylist && !!selectedPlaylist}
        t={t}
        onClose={() => {
          setShowDeletePlaylist(false);
          setPlaylistMenu(null);
        }}
        onConfirm={handleDeletePlaylist}
      />

      <AddToPlaylistModal
        track={showAddToPlaylist}
        playlists={playlistManager.playlists}
        t={t}
        onClose={() => setShowAddToPlaylist(null)}
        onSelect={handleAddToPlaylist}
      />

      <DuplicatesModal
        duplicateFileNames={showDuplicatesModal}
        t={t}
        onClose={() => setShowDuplicatesModal([])}
      />

      <OnboardingModal
        isOpen={showOnboarding}
        t={t}
        steps={onboardingSteps}
        currentStep={onboardingStep}
        onClose={dismissOnboarding}
        onPrevious={() => setOnboardingStep((prev) => Math.max(prev - 1, 0))}
        onNext={() =>
          setOnboardingStep((prev) =>
            Math.min(prev + 1, onboardingSteps.length - 1),
          )
        }
      />

      <AddSongsToPlaylistModal
        isOpen={showAddSongsToPlaylist}
        selectedPlaylist={selectedPlaylist}
        library={queue.library}
        t={t}
        onClose={() => setShowAddSongsToPlaylist(false)}
        onAddTrack={handleAddSongToSelectedPlaylist}
      />

      <HomePlayerView
        isVisible={activeTab === "player"}
        t={t}
        showQueue={showQueue}
        onToggleQueue={() => setShowQueue(!showQueue)}
        onCloseQueue={() => setShowQueue(false)}
        onOpenFilePicker={handleFileSelect}
        queue={{
          queue: queue.queue,
          currentTrack: queue.currentTrack,
          currentTrackIndex: queue.currentTrackIndex,
          playTrack: queue.playTrack,
          removeFromQueue: queue.removeFromQueue,
          reorderQueue: queue.reorderQueue,
          previousTrack: queue.previousTrack,
          nextTrack: queue.nextTrack,
        }}
        audioProcessor={{
          currentTime: audioProcessor.currentTime,
          duration: audioProcessor.duration,
          isPlaying: audioProcessor.isPlaying,
          seek: audioProcessor.seek,
          pause: audioProcessor.pause,
          play: audioProcessor.play,
        }}
        draggedIndex={draggedIndex}
        onDraggedIndexChange={setDraggedIndex}
        touchStart={touchStart}
        onTouchStartChange={setTouchStart}
        formatTime={formatTime}
        hiresAudioBadgeUrl={hiresAudioBadgeUrl}
      />

      {activeTab === "library" && (
        <HomeLibraryView
          t={t}
          libraryView={libraryView}
          setLibraryView={setLibraryView}
          queueLibrary={queue.library}
          queueIsLoading={queue.isLoading}
          importProgressIsImporting={queue.importProgress.isImporting}
          hiresTracks={hiResTracks}
          sortedSongs={sortedSongs}
          visibleSongsCount={visibleSongsCount}
          setVisibleSongsCount={setVisibleSongsCount}
          songSort={songSort}
          setSongSort={setSongSort}
          songsByArtist={songsByArtist}
          albums={albums}
          playlists={playlistManager.playlists}
          selectedPlaylist={selectedPlaylist}
          setSelectedPlaylist={setSelectedPlaylist}
          hiresLogoUrl={hiresLogoUrl}
          onPlayNow={handlePlayNow}
          onAddToQueue={handleAddToQueue}
          onPlayNext={handlePlayNext}
          onAddToPlaylist={handleOpenAddToPlaylist}
          onPlayInOrder={handlePlayInOrder}
          onShufflePlay={handleShufflePlay}
          onOpenFilePicker={handleFileSelect}
          onImportTracks={handleMediaStoreImport}
          onOpenCreatePlaylist={() => setShowCreatePlaylist(true)}
          onOpenPlaylistMenu={handleOpenPlaylistMenu}
          onOpenAddSongsToPlaylist={() => setShowAddSongsToPlaylist(true)}
          onRemoveFromPlaylist={handleRemoveFromPlaylist}
        />
      )}

      {activeTab === "search" && (
        <HomeSearchView
          t={t}
          globalSearchQuery={globalSearchQuery}
          setGlobalSearchQuery={setGlobalSearchQuery}
          normalizedGlobalQuery={normalizedGlobalQuery}
          globalResults={globalResults}
          onPlayNow={handlePlayNow}
          onAddToQueue={handleAddToQueue}
          onPlayNext={handlePlayNext}
          onAddToPlaylist={handleOpenAddToPlaylist}
        />
      )}

      {activeTab === "eq" && (
        <HomeEqView
          t={t}
          eqEnabled={audioProcessor.eqEnabled}
          eqBands={audioProcessor.eqBands}
          onToggleEq={toggleEq}
          onOpenAutoModal={() => setShowEqAutoModal(true)}
          onSetEqBandGain={audioProcessor.setEqBandGain}
          onResetEq={() =>
            audioProcessor.eqBands.forEach((_, index) =>
              audioProcessor.setEqBandGain(index, 0),
            )
          }
        />
      )}

      {activeTab === "dsp" && (
        <HomeDspView
          t={t}
          epicenterEnabled={epicenterEnabled}
          knobRows={dspKnobRows}
          onToggleEpicenter={toggleEpicenter}
          onOpenAutoModal={() => setShowDspAutoModal(true)}
          onChangeParam={updateDspParam}
        />
      )}

      <HomeAutoModeModal
        isOpen={showEqAutoModal}
        t={t}
        title={t("eq.autoTitle")}
        description={t("eq.autoDescription")}
        enableLabel={t("eq.autoEnable")}
        applyLabel={t("eq.autoApplyNow")}
        enabled={eqAutoEnabled}
        onEnabledChange={setEqAutoEnabled}
        onClose={() => setShowEqAutoModal(false)}
        onApplyNow={() => {
          runAutoOptimization(true);
          setShowEqAutoModal(false);
        }}
      />

      <HomeAutoModeModal
        isOpen={showDspAutoModal}
        t={t}
        title={t("dsp.autoTitle")}
        description={t("dsp.autoDescription")}
        enableLabel={t("dsp.autoEnable")}
        applyLabel={t("dsp.autoApplyNow")}
        enabled={dspAutoEnabled}
        onEnabledChange={setDspAutoEnabled}
        onClose={() => setShowDspAutoModal(false)}
        onApplyNow={() => {
          runAutoOptimization(true);
          setShowDspAutoModal(false);
        }}
      />

      {activeTab === "settings" && (
        <HomeSettingsView
          t={t}
          theme={theme}
          switchable={switchable}
          toggleTheme={toggleTheme ?? (() => {})}
          language={language}
          setLanguage={setLanguage}
          crossfadeEnabled={crossfade.enabled}
          crossfadeDuration={crossfade.duration}
          setCrossfadeEnabled={crossfade.setEnabled}
          setCrossfadeDuration={crossfade.setDuration}
          appLogoUrl={appLogoUrl}
        />
      )}

      <HomeImportProgressOverlay t={t} importProgress={queue.importProgress} />

      <BottomNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLibraryTab={() => {
          setActiveTab("library");
          setLibraryView("main");
        }}
        eqEnabled={audioProcessor.eqEnabled}
        epicenterEnabled={epicenterEnabled}
        t={t}
      />
      <div className={activeTab === "player" ? "h-0" : "h-20"} />
    </div>
  );
}
