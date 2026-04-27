package com.epicenter.hifi;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.media3.common.C;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

@UnstableApi
final class EpicenterNativeAudioProcessor extends BaseAudioProcessor {
  private static final String TAG = "EpicenterProcessor";
  private static final int BYTES_PER_SAMPLE_PCM16 = 2;
  private static final int BYTES_PER_SAMPLE_FLOAT = 4;

  private long nativeHandle = 0L;
  private int configuredSampleRate = -1;
  private int configuredChannels = -1;
  private int configuredEncoding = C.ENCODING_INVALID;
  private long processedFrames = 0L;
  private long nextDebugFrameMark = 0L;
  private long lastAppliedSettingsVersion = -1L;

  @Override
  public @NonNull AudioFormat onConfigure(@NonNull AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
      throw new UnhandledAudioFormatException(inputAudioFormat);
    }

    boolean formatChanged =
      configuredSampleRate != inputAudioFormat.sampleRate
      || configuredChannels != inputAudioFormat.channelCount
      || configuredEncoding != inputAudioFormat.encoding;

    configuredSampleRate = inputAudioFormat.sampleRate;
    configuredChannels = inputAudioFormat.channelCount;
    configuredEncoding = inputAudioFormat.encoding;
    processedFrames = 0L;
    nextDebugFrameMark = Math.max(1, configuredSampleRate * 3L);

    Log.d(TAG, "Configured sampleRate=" + configuredSampleRate
      + " channels=" + configuredChannels
      + " encoding=" + configuredEncoding);

    ensureNative();
    resetState();
    applyCurrentSettings();
    return inputAudioFormat;
  }

  @Override
  public void queueInput(ByteBuffer inputBuffer) {
    if (!inputBuffer.hasRemaining()) {
      return;
    }

    ensureNative();
    applyCurrentSettings(false);

    int inputBytes = inputBuffer.remaining();
    ByteBuffer outputBuffer = replaceOutputBuffer(inputBytes).order(ByteOrder.nativeOrder());

    if (nativeHandle == 0L) {
      outputBuffer.put(inputBuffer);
      outputBuffer.flip();
      return;
    }

    final int channelCount = Math.max(1, configuredChannels);

    if (configuredEncoding == C.ENCODING_PCM_16BIT) {
      int frameCount = inputBytes / (BYTES_PER_SAMPLE_PCM16 * channelCount);
      NativeEpicenterJni.nativeProcessPcm16(
        nativeHandle,
        inputBuffer,
        outputBuffer,
        frameCount,
        channelCount
      );

      processedFrames += frameCount;
      maybeLogProcessing();

      inputBuffer.position(inputBuffer.limit());
      outputBuffer.position(inputBytes);
      outputBuffer.flip();
      return;
    }

    if (configuredEncoding == C.ENCODING_PCM_FLOAT) {
      int frameCount = inputBytes / (BYTES_PER_SAMPLE_FLOAT * channelCount);
      NativeEpicenterJni.nativeProcessFloat(
        nativeHandle,
        inputBuffer,
        outputBuffer,
        frameCount,
        channelCount
      );

      processedFrames += frameCount;
      maybeLogProcessing();

      inputBuffer.position(inputBuffer.limit());
      outputBuffer.flip();
      return;
    }

    outputBuffer.put(inputBuffer);
    outputBuffer.flip();
  }

  @Override
  protected void onFlush() {
    resetState();
    applyCurrentSettings();
  }

  @Override
  protected void onReset() {
    releaseNative();
    configuredSampleRate = -1;
    configuredChannels = -1;
    configuredEncoding = C.ENCODING_INVALID;
    lastAppliedSettingsVersion = -1L;
  }

  void refreshSettings() {
    applyCurrentSettings(true);
  }

  void resetState() {
    if (nativeHandle != 0L) {
      NativeEpicenterJni.nativeResetState(nativeHandle);
    }
  }

  private void ensureNative() {
    if (nativeHandle != 0L || configuredSampleRate <= 0 || configuredChannels <= 0) {
      return;
    }
    nativeHandle = NativeEpicenterJni.nativeCreate(configuredSampleRate, configuredChannels);
  }

  private void releaseNative() {
    if (nativeHandle != 0L) {
      NativeEpicenterJni.nativeRelease(nativeHandle);
      nativeHandle = 0L;
    }
  }

  private void applyCurrentSettings(boolean force) {
    if (nativeHandle == 0L) {
      return;
    }

    EpicenterSettingsStore.Snapshot s = EpicenterSettingsStore.snapshot();
    NativeEpicenterJni.nativeSetParams(
      nativeHandle,
      s.enabled,
      s.sweepFreq,
      s.width,
      s.intensity,
      s.balance,
      s.volume
    );
    NativeEpicenterJni.nativeSetEqEnabled(nativeHandle, s.eqEnabled);
    NativeEpicenterJni.nativeSetEqPreampDb(nativeHandle, s.eqPreampDb);
    NativeEpicenterJni.nativeSetEqBands(nativeHandle, s.eqBandGainsDb);
  }

  private void resetState() {
    if (nativeHandle != 0L) {
      NativeEpicenterJni.nativeResetState(nativeHandle);
    }
  }

  private void maybeLogProcessing() {
    if (processedFrames >= nextDebugFrameMark) {
      EpicenterSettingsStore.Snapshot s = EpicenterSettingsStore.snapshot();
      Log.d(TAG, "processing ok frames=" + processedFrames
        + " enabled=" + s.enabled
        + " intensity=" + s.intensity
        + " sweep=" + s.sweepFreq
        + " width=" + s.width);
      nextDebugFrameMark += Math.max(1, configuredSampleRate * 3L);
    }
  }

}
