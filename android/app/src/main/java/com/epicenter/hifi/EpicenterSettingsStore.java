package com.epicenter.hifi;

final class EpicenterSettingsStore {
  static final int EQ_BAND_COUNT = 31;
  static final float EQ_INTERNAL_BOOST_MAX_DB = 8f;
  static final float EQ_INTERNAL_CUT_MIN_DB = -12f;
  static final float EQ_PREAMP_MIN_DB = -24f;
  static final float EQ_PREAMP_MAX_DB = 0f;

  private static volatile boolean enabled = false;
  private static volatile float sweepFreq = 45f;
  private static volatile float width = 50f;
  private static volatile float intensity = 50f;
  private static volatile float balance = 50f;
  private static volatile float volume = 100f;
  private static volatile boolean eqEnabled = true;
  private static volatile float eqPreampDb = 0f;
  private static final float[] eqBandGainsDb = new float[EQ_BAND_COUNT];

  private EpicenterSettingsStore() {}

  static synchronized void update(
    boolean newEnabled,
    float newSweepFreq,
    float newWidth,
    float newIntensity,
    float newBalance,
    float newVolume
  ) {
    enabled = newEnabled;
    sweepFreq = clamp(newSweepFreq, 27f, 63f);
    width = clamp(newWidth, 0f, 100f);
    intensity = clamp(newIntensity, 0f, 100f);
    balance = clamp(newBalance, 0f, 100f);
    volume = clamp(newVolume, 0f, 100f);
  }

  static synchronized Snapshot snapshot() {
    float[] eqCopy = new float[EQ_BAND_COUNT];
    System.arraycopy(eqBandGainsDb, 0, eqCopy, 0, EQ_BAND_COUNT);
    return new Snapshot(enabled, sweepFreq, width, intensity, balance, volume, eqEnabled, eqPreampDb, eqCopy);
  }

  static synchronized void setEqEnabled(boolean enabled) {
    eqEnabled = enabled;
  }

  static synchronized void setEqPreampDb(float preampDb) {
    eqPreampDb = clamp(preampDb, EQ_PREAMP_MIN_DB, EQ_PREAMP_MAX_DB);
  }

  static synchronized void setEqBand(int index, float gainDb) {
    if (index < 0 || index >= EQ_BAND_COUNT) {
      return;
    }
    eqBandGainsDb[index] = clamp(gainDb, EQ_INTERNAL_CUT_MIN_DB, EQ_INTERNAL_BOOST_MAX_DB);
  }

  static synchronized void setEqBands(float[] gainsDb) {
    if (gainsDb == null) {
      return;
    }
    int len = Math.min(EQ_BAND_COUNT, gainsDb.length);
    for (int i = 0; i < len; i++) {
      eqBandGainsDb[i] = clamp(gainsDb[i], EQ_INTERNAL_CUT_MIN_DB, EQ_INTERNAL_BOOST_MAX_DB);
    }
    for (int i = len; i < EQ_BAND_COUNT; i++) {
      eqBandGainsDb[i] = 0f;
    }
  }

  private static float clamp(float value, float min, float max) {
    return Math.max(min, Math.min(max, value));
  }

  static final class Snapshot {
    final boolean enabled;
    final float sweepFreq;
    final float width;
    final float intensity;
    final float balance;
    final float volume;
    final boolean eqEnabled;
    final float eqPreampDb;
    final float[] eqBandGainsDb;

    Snapshot(
      boolean enabled,
      float sweepFreq,
      float width,
      float intensity,
      float balance,
      float volume,
      boolean eqEnabled,
      float eqPreampDb,
      float[] eqBandGainsDb
    ) {
      this.enabled = enabled;
      this.sweepFreq = sweepFreq;
      this.width = width;
      this.intensity = intensity;
      this.balance = balance;
      this.volume = volume;
      this.eqEnabled = eqEnabled;
      this.eqPreampDb = eqPreampDb;
      this.eqBandGainsDb = eqBandGainsDb;
    }
  }
}
