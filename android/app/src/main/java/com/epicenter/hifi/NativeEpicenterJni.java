package com.epicenter.hifi;

import java.nio.ByteBuffer;

final class NativeEpicenterJni {
  static {
    System.loadLibrary("epicenter_native");
  }

  private NativeEpicenterJni() {}

  static native long nativeCreate(int sampleRate, int channelCount);

  static native void nativeRelease(long handle);

  static native void nativeResetState(long handle);

  static native void nativeSetParams(
    long handle,
    boolean enabled,
    float sweepFreq,
    float width,
    float intensity,
    float balance,
    float volume
  );

  static native void nativeSetEqEnabled(long handle, boolean enabled);

  static native void nativeSetEqPreampDb(long handle, float preampDb);

  static native void nativeSetEqBand(long handle, int index, float gainDb);

  static native void nativeSetEqBands(long handle, float[] gainsDb);

  static native void nativeProcessPcm16(
    long handle,
    ByteBuffer input,
    ByteBuffer output,
    int frameCount,
    int channelCount
  );
}
