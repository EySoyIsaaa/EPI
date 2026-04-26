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
  private int nativeSampleRate = -1;
  private int nativeChannelCount = -1;
  private long processedFrames = 0L;
  private long nextDebugFrameMark = 0L;
  private int maxFrameCountSeen = 0;
  private EpicenterSettingsStore.Snapshot lastAppliedSettings = null;

  private ByteBuffer tempStereoFloatIn = EMPTY_BUFFER;
  private ByteBuffer tempStereoFloatOut = EMPTY_BUFFER;
  private ByteBuffer tempStereoPcm16In = EMPTY_BUFFER;
  private ByteBuffer tempStereoPcm16Out = EMPTY_BUFFER;

  @Override
  public @NonNull AudioFormat onConfigure(@NonNull AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
      throw new UnhandledAudioFormatException(inputAudioFormat);
    }

    configuredSampleRate = inputAudioFormat.sampleRate;
    configuredChannels = inputAudioFormat.channelCount;
    configuredEncoding = inputAudioFormat.encoding;
    processedFrames = 0L;
    nextDebugFrameMark = Math.max(1, configuredSampleRate * 3L);

    Log.d(TAG, "Configured sampleRate=" + configuredSampleRate
      + " channels=" + configuredChannels
      + " encoding=" + configuredEncoding);

    ensureNative();
    applyCurrentSettingsIfDirty();
    requestNativeReset();
    return inputAudioFormat;
  }

  @Override
  public void queueInput(ByteBuffer inputBuffer) {
    if (!inputBuffer.hasRemaining()) {
      return;
    }

    ensureNative();
    applyCurrentSettingsIfDirty();

    int inputBytes = inputBuffer.remaining();
    ByteBuffer outputBuffer = replaceOutputBuffer(inputBytes).order(ByteOrder.nativeOrder());

    if (nativeHandle == 0L) {
      outputBuffer.put(inputBuffer);
      outputBuffer.flip();
      return;
    }

    final int inputChannelCount = Math.max(1, configuredChannels);
    final int processChannelCount = Math.min(inputChannelCount, 2);
    final int frameCount = inputBytes / ((configuredEncoding == C.ENCODING_PCM_FLOAT ? BYTES_PER_SAMPLE_FLOAT : BYTES_PER_SAMPLE_PCM16) * inputChannelCount);
    maybeGrowWorkBuffers(frameCount);

    if (configuredEncoding == C.ENCODING_PCM_16BIT) {
      if (inputChannelCount > 2) {
        downmixPcm16ToStereo(inputBuffer, frameCount, inputChannelCount);
        NativeEpicenterJni.nativeProcessPcm16(nativeHandle, tempStereoPcm16In, tempStereoPcm16Out, frameCount, 2);
        upmixProcessedStereoPcm16(outputBuffer, frameCount, inputChannelCount);
        processedFrames += frameCount;
        maybeLogProcessing();
        inputBuffer.position(inputBuffer.limit());
        outputBuffer.flip();
        return;
      }

      NativeEpicenterJni.nativeProcessPcm16(
        nativeHandle,
        inputBuffer,
        outputBuffer,
        frameCount,
        processChannelCount
      );

      processedFrames += frameCount;
      maybeLogProcessing();

      inputBuffer.position(inputBuffer.limit());
      outputBuffer.position(inputBytes);
      outputBuffer.flip();
      return;
    }

    if (configuredEncoding == C.ENCODING_PCM_FLOAT) {
      if (inputChannelCount > 2) {
        downmixFloatToStereo(inputBuffer, frameCount, inputChannelCount);
        NativeEpicenterJni.nativeProcessFloat(nativeHandle, tempStereoFloatIn, tempStereoFloatOut, frameCount, 2);
        upmixProcessedStereoFloat(outputBuffer, frameCount, inputChannelCount);
      } else {
        NativeEpicenterJni.nativeProcessFloat(
          nativeHandle,
          inputBuffer,
          outputBuffer,
          frameCount,
          processChannelCount
        );
      }

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
    applyCurrentSettingsIfDirty();
    requestNativeReset();
  }

  @Override
  protected void onReset() {
    releaseNative();
    configuredSampleRate = -1;
    configuredChannels = -1;
    configuredEncoding = C.ENCODING_INVALID;
    nativeChannelCount = -1;
    nativeSampleRate = -1;
    maxFrameCountSeen = 0;
    lastAppliedSettings = null;
    tempStereoFloatIn = EMPTY_BUFFER;
    tempStereoFloatOut = EMPTY_BUFFER;
    tempStereoPcm16In = EMPTY_BUFFER;
    tempStereoPcm16Out = EMPTY_BUFFER;
  }

  void refreshSettings() {
    applyCurrentSettingsIfDirty();
  }

  void resetProcessingState() {
    requestNativeReset();
  }

  private void ensureNative() {
    if (configuredSampleRate <= 0 || configuredChannels <= 0) {
      return;
    }

    int desiredChannels = Math.min(Math.max(1, configuredChannels), 2);
    if (nativeHandle != 0L
      && nativeSampleRate == configuredSampleRate
      && nativeChannelCount == desiredChannels) {
      return;
    }

    releaseNative();
    nativeHandle = NativeEpicenterJni.nativeCreate(configuredSampleRate, desiredChannels);
    nativeSampleRate = configuredSampleRate;
    nativeChannelCount = desiredChannels;
    lastAppliedSettings = null;
  }

  private void releaseNative() {
    if (nativeHandle != 0L) {
      NativeEpicenterJni.nativeRelease(nativeHandle);
      nativeHandle = 0L;
    }
    nativeChannelCount = -1;
    nativeSampleRate = -1;
  }

  private void applyCurrentSettingsIfDirty() {
    if (nativeHandle == 0L) {
      return;
    }

    EpicenterSettingsStore.Snapshot s = EpicenterSettingsStore.snapshot();
    if (!settingsChanged(s)) {
      return;
    }
    NativeEpicenterJni.nativeSetParams(
      nativeHandle,
      s.enabled,
      s.sweepFreq,
      s.width,
      s.intensity,
      s.balance,
      s.volume
    );
    lastAppliedSettings = s;
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

  private boolean settingsChanged(EpicenterSettingsStore.Snapshot current) {
    EpicenterSettingsStore.Snapshot previous = lastAppliedSettings;
    if (previous == null) return true;
    return previous.enabled != current.enabled
      || previous.sweepFreq != current.sweepFreq
      || previous.width != current.width
      || previous.intensity != current.intensity
      || previous.balance != current.balance
      || previous.volume != current.volume;
  }

  private void requestNativeReset() {
    if (nativeHandle != 0L) {
      NativeEpicenterJni.nativeResetState(nativeHandle);
    }
  }

  private void maybeGrowWorkBuffers(int frameCount) {
    if (frameCount <= maxFrameCountSeen) {
      return;
    }
    maxFrameCountSeen = frameCount;
    int stereoFloatBytes = frameCount * 2 * BYTES_PER_SAMPLE_FLOAT;
    if (tempStereoFloatIn.capacity() < stereoFloatBytes) {
      tempStereoFloatIn = ByteBuffer.allocateDirect(stereoFloatBytes).order(ByteOrder.nativeOrder());
      tempStereoFloatOut = ByteBuffer.allocateDirect(stereoFloatBytes).order(ByteOrder.nativeOrder());
    }
    int stereoPcm16Bytes = frameCount * 2 * BYTES_PER_SAMPLE_PCM16;
    if (tempStereoPcm16In.capacity() < stereoPcm16Bytes) {
      tempStereoPcm16In = ByteBuffer.allocateDirect(stereoPcm16Bytes).order(ByteOrder.nativeOrder());
      tempStereoPcm16Out = ByteBuffer.allocateDirect(stereoPcm16Bytes).order(ByteOrder.nativeOrder());
    }
  }

  private void downmixFloatToStereo(ByteBuffer inputBuffer, int frameCount, int inputChannels) {
    ByteBuffer inputView = inputBuffer.duplicate().order(ByteOrder.nativeOrder());
    tempStereoFloatIn.clear();
    tempStereoFloatOut.clear();
    int stereoSamples = frameCount * 2;
    tempStereoFloatIn.limit(stereoSamples * BYTES_PER_SAMPLE_FLOAT);
    tempStereoFloatOut.limit(stereoSamples * BYTES_PER_SAMPLE_FLOAT);

    for (int i = 0; i < frameCount; i++) {
      float mono = 0f;
      for (int ch = 0; ch < inputChannels; ch++) {
        mono += inputView.getFloat();
      }
      mono /= inputChannels;
      tempStereoFloatIn.putFloat(mono);
      tempStereoFloatIn.putFloat(mono);
    }
    tempStereoFloatIn.position(0);
    tempStereoFloatOut.position(0);
  }

  private void upmixProcessedStereoFloat(ByteBuffer outputBuffer, int frameCount, int outputChannels) {
    tempStereoFloatOut.position(0);
    for (int i = 0; i < frameCount; i++) {
      float left = tempStereoFloatOut.getFloat();
      float right = tempStereoFloatOut.getFloat();
      float mono = 0.5f * (left + right);
      outputBuffer.putFloat(left);
      if (outputChannels > 1) outputBuffer.putFloat(right);
      for (int ch = 2; ch < outputChannels; ch++) {
        outputBuffer.putFloat(mono);
      }
    }
  }

  private void downmixPcm16ToStereo(ByteBuffer inputBuffer, int frameCount, int inputChannels) {
    ByteBuffer inputView = inputBuffer.duplicate().order(ByteOrder.nativeOrder());
    tempStereoPcm16In.clear();
    tempStereoPcm16Out.clear();
    int stereoBytes = frameCount * 2 * BYTES_PER_SAMPLE_PCM16;
    tempStereoPcm16In.limit(stereoBytes);
    tempStereoPcm16Out.limit(stereoBytes);
    for (int i = 0; i < frameCount; i++) {
      int monoSum = 0;
      for (int ch = 0; ch < inputChannels; ch++) {
        monoSum += inputView.getShort();
      }
      short mono = (short) (monoSum / inputChannels);
      tempStereoPcm16In.putShort(mono);
      tempStereoPcm16In.putShort(mono);
    }
    tempStereoPcm16In.position(0);
    tempStereoPcm16Out.position(0);
  }

  private void upmixProcessedStereoPcm16(ByteBuffer outputBuffer, int frameCount, int outputChannels) {
    tempStereoPcm16Out.position(0);
    for (int i = 0; i < frameCount; i++) {
      short left = tempStereoPcm16Out.getShort();
      short right = tempStereoPcm16Out.getShort();
      short mono = (short) ((left + right) / 2);
      outputBuffer.putShort(left);
      if (outputChannels > 1) outputBuffer.putShort(right);
      for (int ch = 2; ch < outputChannels; ch++) {
        outputBuffer.putShort(mono);
      }
    }
  }

}
