package com.epicenter.hifi;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

@UnstableApi
public class NativeAudioPlaybackService extends MediaSessionService {
  private static final String CHANNEL_ID = "epicenter_playback";

  private ExoPlayer player;
  private MediaSession mediaSession;

  @Override
  public void onCreate() {
    super.onCreate();
    ensureNotificationChannel();

    AudioAttributes audioAttributes = new AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
      .build();

    player = new ExoPlayer.Builder(this).build();
    player.setAudioAttributes(audioAttributes, true);
    player.setHandleAudioBecomingNoisy(true);

    mediaSession = new MediaSession.Builder(this, player)
      .setId("epicenter-native-session")
      .build();
  }

  @Override
  public void onTaskRemoved(@Nullable Intent rootIntent) {
    if (player != null && !player.getPlayWhenReady()) {
      stopSelf();
    }
    super.onTaskRemoved(rootIntent);
  }

  @Override
  public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
    return mediaSession;
  }

  @Override
  public void onDestroy() {
    if (mediaSession != null) {
      mediaSession.release();
      mediaSession = null;
    }
    if (player != null) {
      player.release();
      player = null;
    }
    super.onDestroy();
  }

  private void ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return;
    }

    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
      return;
    }

    NotificationChannel channel = new NotificationChannel(
      CHANNEL_ID,
      "Epicenter Playback",
      NotificationManager.IMPORTANCE_LOW
    );
    channel.setDescription("Playback controls");
    manager.createNotificationChannel(channel);
  }
}
