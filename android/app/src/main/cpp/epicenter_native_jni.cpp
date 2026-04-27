#include <jni.h>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include <vector>
#include <array>
#include <android/log.h>

namespace {

constexpr float DENORMAL_FLOOR = 1e-24f;
constexpr float TWO_PI = 6.28318530717958647692f;
constexpr float EPICENTER_INTENSITY_HEADROOM = 0.75f;
constexpr int EQ_BAND_COUNT = 31;
constexpr float EQ_INTERNAL_BOOST_MAX_DB = 8.0f;
constexpr float EQ_INTERNAL_CUT_MIN_DB = -12.0f;
constexpr float EQ_SAFE_GAIN_MAX_LINEAR = 1.9952623f; // +6dB
constexpr float EQ_AUTO_PREAMP_FACTOR = 0.92f;
constexpr float EQ_AUTO_PREAMP_MARGIN_DB = 1.2f;
constexpr float LIMITER_THRESHOLD = 0.96f;
constexpr float LIMITER_MIX = 0.75f;
constexpr float LIMITER_GAIN_FLOOR = 0.22f;
constexpr float SUB_SPONGE_BOOST_MIN_DB = 1.5f;
constexpr float SUB_SPONGE_BOOST_MAX_DB = 5.8f;
constexpr float SUB_SPONGE_FREQ_MIN_HZ = 52.0f;
constexpr float SUB_SPONGE_FREQ_MAX_HZ = 96.0f;
constexpr const char* LOG_TAG = "EpicenterNative";

inline float denormalFloor(float v) {
  return std::fabs(v) < DENORMAL_FLOOR ? 0.0f : v;
}

inline float clampf(float v, float lo, float hi) {
  return std::max(lo, std::min(hi, v));
}

inline float coeffFromMs(float ms, float sampleRate) {
  const float samples = std::max(1.0f, ms * sampleRate / 1000.0f);
  return std::exp(-1.0f / samples);
}

struct Biquad {
  enum class Type { Lowpass, Highpass, Bandpass, Peaking, LowShelf };

  Type type = Type::Lowpass;
  float freq = 100.0f;
  float sr = 48000.0f;
  float q = 0.707f;
  float gainDb = 0.0f;

  float b0 = 0.0f;
  float b1 = 0.0f;
  float b2 = 0.0f;
  float a1 = 0.0f;
  float a2 = 0.0f;

  float x1 = 0.0f;
  float x2 = 0.0f;
  float y1 = 0.0f;
  float y2 = 0.0f;

  void update(Type newType, float newFreq, float newQ, float newGainDb = 0.0f) {
    type = newType;
    freq = newFreq;
    q = newQ;
    gainDb = newGainDb;

    const float clampedFreq = clampf(freq, 10.0f, sr * 0.45f);
    const float clampedQ = clampf(q, 0.2f, 12.0f);
    const float omega = TWO_PI * clampedFreq / sr;
    const float sinOmega = std::sin(omega);
    const float cosOmega = std::cos(omega);
    const float alpha = sinOmega / (2.0f * clampedQ);
    const float A = std::pow(10.0f, gainDb / 40.0f);
    const float sqrtA = std::sqrt(A);

    float lb0 = 0.0f;
    float lb1 = 0.0f;
    float lb2 = 0.0f;
    float la0 = 1.0f;
    float la1 = 0.0f;
    float la2 = 0.0f;

    switch (type) {
      case Type::Lowpass:
        lb0 = (1.0f - cosOmega) * 0.5f;
        lb1 = 1.0f - cosOmega;
        lb2 = (1.0f - cosOmega) * 0.5f;
        la0 = 1.0f + alpha;
        la1 = -2.0f * cosOmega;
        la2 = 1.0f - alpha;
        break;
      case Type::Highpass:
        lb0 = (1.0f + cosOmega) * 0.5f;
        lb1 = -(1.0f + cosOmega);
        lb2 = (1.0f + cosOmega) * 0.5f;
        la0 = 1.0f + alpha;
        la1 = -2.0f * cosOmega;
        la2 = 1.0f - alpha;
        break;
      case Type::Bandpass:
        lb0 = alpha;
        lb1 = 0.0f;
        lb2 = -alpha;
        la0 = 1.0f + alpha;
        la1 = -2.0f * cosOmega;
        la2 = 1.0f - alpha;
        break;
      case Type::Peaking:
        lb0 = 1.0f + alpha * A;
        lb1 = -2.0f * cosOmega;
        lb2 = 1.0f - alpha * A;
        la0 = 1.0f + alpha / A;
        la1 = -2.0f * cosOmega;
        la2 = 1.0f - alpha / A;
        break;
      case Type::LowShelf: {
        const float slope = clampf(clampedQ, 0.3f, 1.5f);
        const float alphaShelf = sinOmega * 0.5f * std::sqrt((A + (1.0f / A)) * ((1.0f / slope) - 1.0f) + 2.0f);
        lb0 = A * ((A + 1.0f) - (A - 1.0f) * cosOmega + 2.0f * sqrtA * alphaShelf);
        lb1 = 2.0f * A * ((A - 1.0f) - (A + 1.0f) * cosOmega);
        lb2 = A * ((A + 1.0f) - (A - 1.0f) * cosOmega - 2.0f * sqrtA * alphaShelf);
        la0 = (A + 1.0f) + (A - 1.0f) * cosOmega + 2.0f * sqrtA * alphaShelf;
        la1 = -2.0f * ((A - 1.0f) + (A + 1.0f) * cosOmega);
        la2 = (A + 1.0f) + (A - 1.0f) * cosOmega - 2.0f * sqrtA * alphaShelf;
        break;
      }
    }

    b0 = lb0 / la0;
    b1 = lb1 / la0;
    b2 = lb2 / la0;
    a1 = la1 / la0;
    a2 = la2 / la0;
  }

  float process(float sample) {
    const float clean = denormalFloor(sample);
    const float y0 = b0 * clean + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = denormalFloor(x1);
    x1 = clean;
    y2 = denormalFloor(y1);
    y1 = denormalFloor(y0);
    return denormalFloor(y0);
  }

  void reset() {
    x1 = 0.0f;
    x2 = 0.0f;
    y1 = 0.0f;
    y2 = 0.0f;
  }
};

struct EnvelopeFollower {
  float attackCoeff = 0.0f;
  float releaseCoeff = 0.0f;
  float value = 0.0f;

  float process(float input) {
    const float x = std::fabs(input);
    const float coeff = x > value ? attackCoeff : releaseCoeff;
    value = x + coeff * (value - x);
    return value;
  }

  void reset() {
    value = 0.0f;
  }
};

struct ChannelState {
  Biquad voiceHighpass;
  Biquad bassLowpass;
  Biquad lowMidBody;
  Biquad lowMidDip;
  Biquad subLowpass;
  Biquad subTextureLowpass;
  Biquad subSpongeShelf;
  Biquad outputDcHighpass;
  EnvelopeFollower voiceEnv;
};

struct MonoState {
  Biquad band60;
  Biquad band80;
  Biquad band110;
  Biquad monoLowpass;
  Biquad diffHighpass;
  Biquad synthHighpass;
  Biquad synthLowpass;
  EnvelopeFollower detectorEnv;
  EnvelopeFollower monoEnv;
  EnvelopeFollower diffEnv;
  EnvelopeFollower gateEnv;
  EnvelopeFollower synthLevelEnv;
  float lastDetector = 0.0f;
  int flipState = 1;
  int holdSamples = 0;
};

struct EqChannelState {
  std::array<Biquad, EQ_BAND_COUNT> bands;
};

struct LimiterState {
  float envelope = 0.0f;
  float gain = 1.0f;
};

static const std::array<float, EQ_BAND_COUNT> kEqFrequenciesHz = {
  20.0f, 25.0f, 31.5f, 40.0f, 50.0f, 63.0f, 80.0f, 100.0f, 125.0f, 160.0f,
  200.0f, 250.0f, 315.0f, 400.0f, 500.0f, 630.0f, 800.0f, 1000.0f, 1250.0f, 1600.0f,
  2000.0f, 2500.0f, 3150.0f, 4000.0f, 5000.0f, 6300.0f, 8000.0f, 10000.0f, 12500.0f, 16000.0f, 20000.0f
};

struct EqChannelState {
  std::array<Biquad, EQ_BAND_COUNT> bands;
};

struct LimiterState {
  float envelope = 0.0f;
  float gain = 1.0f;
};

static const std::array<float, EQ_BAND_COUNT> kEqFrequenciesHz = {
  20.0f, 25.0f, 31.5f, 40.0f, 50.0f, 63.0f, 80.0f, 100.0f, 125.0f, 160.0f,
  200.0f, 250.0f, 315.0f, 400.0f, 500.0f, 630.0f, 800.0f, 1000.0f, 1250.0f, 1600.0f,
  2000.0f, 2500.0f, 3150.0f, 4000.0f, 5000.0f, 6300.0f, 8000.0f, 10000.0f, 12500.0f, 16000.0f, 20000.0f
};

struct DerivedFreq {
  float detector60;
  float detector80;
  float detector110;
  float crossoverHz;
  float bodyHz;
  float subTopHz;
  float synthLowHz;
  float synthHighHz;
};

static DerivedFreq getDerivedFrequencies(float sweepFreq, float width) {
  const float sweepNorm = (clampf(sweepFreq, 27.0f, 63.0f) - 27.0f) / 36.0f;
  const float widthNorm = clampf(width, 0.0f, 100.0f) / 100.0f;

  DerivedFreq d{};
  d.detector60 = 55.0f + sweepNorm * 10.0f;
  d.detector80 = 75.0f + sweepNorm * 10.0f;
  d.detector110 = 100.0f + sweepNorm * 15.0f;
  d.crossoverHz = 105.0f + widthNorm * 30.0f;
  d.bodyHz = 95.0f + sweepNorm * 20.0f;
  d.subTopHz = 58.0f + widthNorm * 10.0f;
  d.synthLowHz = 55.0f + widthNorm * 10.0f;
  d.synthHighHz = 22.0f + sweepNorm * 6.0f;
  return d;
}

class EpicenterEngine {
 public:
  EpicenterEngine(int sampleRate, int channelCount)
    : sampleRate_(static_cast<float>(sampleRate)),
      channelCount_(std::max(1, channelCount)) {
    for (auto& c : channels_) {
      initChannel(c);
    }
    initMono();
    initEq();
  }

  void setParams(bool enabled, float sweepFreq, float width, float intensity, float balance, float volume) {
    enabled_ = enabled;
    sweepFreq_ = clampf(sweepFreq, 27.0f, 63.0f);
    width_ = clampf(width, 0.0f, 100.0f);
    intensity_ = clampf(intensity, 0.0f, 100.0f);
    balance_ = clampf(balance, 0.0f, 100.0f);
    volume_ = clampf(volume, 0.0f, 100.0f);

    if (enabled_ != lastLoggedEnabled_) {
      __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG,
        "enabled=%d sweep=%.2f width=%.2f intensity=%.2f balance=%.2f volume=%.2f",
        enabled_ ? 1 : 0, sweepFreq_, width_, intensity_, balance_, volume_);
      lastLoggedEnabled_ = enabled_;
    }

    if (sweepFreq_ != lastSweepFreq_ || width_ != lastWidth_) {
      updateDerivedFilters();
      lastSweepFreq_ = sweepFreq_;
      lastWidth_ = width_;
    }
  }

  void setEqEnabled(bool enabled) {
    eqEnabled_ = enabled;
  }

  void setEqPreampDb(float preampDb) {
    userEqPreampDb_ = clampf(preampDb, -24.0f, 0.0f);
    updateEqSafetyAndTargets();
  }

  void setEqBand(int index, float gainDb) {
    if (index < 0 || index >= EQ_BAND_COUNT) return;
    eqTargetGainsDb_[static_cast<size_t>(index)] = clampf(gainDb, EQ_INTERNAL_CUT_MIN_DB, EQ_INTERNAL_BOOST_MAX_DB);
    updateEqSafetyAndTargets();
  }

  void setEqBands(const jfloat* gainsDb, int len) {
    for (int i = 0; i < EQ_BAND_COUNT; ++i) {
      float value = 0.0f;
      if (gainsDb && i < len) {
        value = gainsDb[i];
      }
      eqTargetGainsDb_[static_cast<size_t>(i)] = clampf(value, EQ_INTERNAL_CUT_MIN_DB, EQ_INTERNAL_BOOST_MAX_DB);
    }
    updateEqSafetyAndTargets();
  }

  void setEqEnabled(bool enabled) {
    eqEnabled_ = enabled;
  }

  void setEqPreampDb(float preampDb) {
    userEqPreampDb_ = clampf(preampDb, -24.0f, 0.0f);
    updateEqSafetyAndTargets();
  }

  void setEqBand(int index, float gainDb) {
    if (index < 0 || index >= EQ_BAND_COUNT) return;
    eqTargetGainsDb_[static_cast<size_t>(index)] = clampf(gainDb, EQ_INTERNAL_CUT_MIN_DB, EQ_INTERNAL_BOOST_MAX_DB);
    updateEqSafetyAndTargets();
  }

  void setEqBands(const jfloat* gainsDb, int len) {
    for (int i = 0; i < EQ_BAND_COUNT; ++i) {
      float value = 0.0f;
      if (gainsDb && i < len) {
        value = gainsDb[i];
      }
      eqTargetGainsDb_[static_cast<size_t>(i)] = clampf(value, EQ_INTERNAL_CUT_MIN_DB, EQ_INTERNAL_BOOST_MAX_DB);
    }
    updateEqSafetyAndTargets();
  }

  void processPcm16(const int16_t* in, int16_t* out, int frameCount, int channelCount) {
    if (!in || !out || frameCount <= 0) return;

    const int inputChannels = std::max(1, channelCount);
    const int usedChannels = std::max(1, std::min(2, inputChannels));

    if (!enabled_ || intensity_ <= 0.01f) {
      const int samples = frameCount * usedChannels;
      for (int i = 0; i < samples; ++i) {
        float dry = pcmToFloat(in[i]);
        out[i] = floatToPcm(processEqAndLimiter(dry, i % usedChannels));
      }
      return;
    }

    const float intensityNorm = (intensity_ / 100.0f) * EPICENTER_INTENSITY_HEADROOM;
    const float balanceNorm = balance_ / 100.0f;
    const float widthNorm = width_ / 100.0f;
    const float volumeGain = clampf(volume_ / 100.0f, 0.0f, 1.0f);

    const float synthAmount = 0.42f + intensityNorm * 1.28f;
    const float bassProgramAmount = 0.68f + balanceNorm * 0.38f;
    const float lowMidBodyAmount = 0.12f + balanceNorm * 0.08f;
    const float lowMidDipAmount = (0.08f + intensityNorm * 0.16f) * (0.45f + widthNorm * 0.3f);
    const int gateHoldSamples = static_cast<int>(sampleRate_ * (0.025f + intensityNorm * 0.06f));
    updateSubSpongeVoicing(intensityNorm, widthNorm);

    if (static_cast<int>(subBuffer_.size()) < frameCount) {
      subBuffer_.resize(static_cast<size_t>(frameCount));
    }

    for (int i = 0; i < frameCount; ++i) {
      const int base = i * inputChannels;
      const float left = pcmToFloat(in[base]);
      const float right = usedChannels > 1 ? pcmToFloat(in[base + 1]) : left;

      const float mono = denormalFloor((left + right) * 0.5f);
      const float diff = denormalFloor((left - right) * 0.5f);

      const float monoBand =
        monoState_.band60.process(mono) * 1.0f +
        monoState_.band80.process(mono) * 0.68f +
        monoState_.band110.process(mono) * 0.42f;

      const float weightedDetector = denormalFloor(monoBand * 0.6f + monoState_.monoLowpass.process(mono) * 0.12f);
      const float detectorEnv = monoState_.detectorEnv.process(weightedDetector);
      const float monoEnv = monoState_.monoEnv.process(mono);
      const float diffEnv = monoState_.diffEnv.process(monoState_.diffHighpass.process(diff));

      if (monoState_.lastDetector <= 0.0f && weightedDetector > 0.0f) {
        monoState_.flipState *= -1;
      }
      monoState_.lastDetector = weightedDetector;

      const float rawHalf = static_cast<float>(monoState_.flipState) * detectorEnv;
      float synth = monoState_.synthHighpass.process(rawHalf);
      synth = monoState_.synthLowpass.process(synth);

      const float gateTarget = computeGate(monoEnv, diffEnv, detectorEnv);
      const float gateValue = monoState_.gateEnv.process(gateTarget);

      if (gateTarget > 0.3f) {
        monoState_.holdSamples = gateHoldSamples;
      } else if (monoState_.holdSamples > 0) {
        monoState_.holdSamples--;
      }

      const float holdFactor = monoState_.holdSamples > 0 ? 1.0f : 0.0f;
      const float remixGate = std::max(gateValue, holdFactor * 0.45f);

      const float leveledSynth = monoState_.synthLevelEnv.process(synth) * (synth >= 0.0f ? 1.0f : -1.0f);
      const float protectedSynth = std::tanh((synth * 0.65f + leveledSynth * 0.35f) * 2.1f) * 0.72f;

      subBuffer_[static_cast<size_t>(i)] = denormalFloor(protectedSynth * synthAmount * remixGate);
    }

    for (int i = 0; i < frameCount; ++i) {
      const int base = i * inputChannels;
      for (int ch = 0; ch < usedChannels; ++ch) {
        ChannelState& state = channels_[std::min(ch, channelCount_ - 1)];
        const float sample = pcmToFloat(in[base + ch]);

        const float voicePath = state.voiceHighpass.process(sample);
        const float voicePresence = state.voiceEnv.process(voicePath);
        const float voiceProtection = std::max(0.5f, 1.0f - voicePresence * (0.85f + intensityNorm * 0.3f));

        const float bassProgram = state.bassLowpass.process(sample);
        const float body = state.lowMidBody.process(sample);
        const float dip = state.lowMidDip.process(sample);

        const float shapedBassProgram =
          bassProgram * bassProgramAmount +
          body * lowMidBodyAmount * (0.45f + voiceProtection * 0.55f) -
          dip * lowMidDipAmount;

        float generatedSub = state.subLowpass.process(subBuffer_[static_cast<size_t>(i)]) * (0.4f + voiceProtection * 0.6f);
        const float subTexture = state.subTextureLowpass.process(generatedSub);
        float spongySub = state.subSpongeShelf.process(subTexture);
        spongySub = std::tanh(spongySub * 1.45f) / std::tanh(1.45f);
        const float spongeMix = 0.42f + intensityNorm * 0.22f;
        generatedSub = generatedSub * (1.0f - spongeMix) + spongySub * spongeMix;

        float mixed = voicePath + shapedBassProgram + generatedSub;
        const float protectionGain = 0.94f + voiceProtection * 0.06f;

        mixed *= volumeGain * protectionGain;
        // Orden DSP elegido: Epicenter -> EQ 31 bandas -> limiter final.
        // Así conservamos el carácter del Epicenter y controlamos boosts del EQ al final.
        mixed = std::tanh(mixed * 0.94f) / std::tanh(0.94f); // Epicenter saturación propia
        mixed = processEqAndLimiter(mixed, ch);
        mixed = state.outputDcHighpass.process(mixed);

        out[base + ch] = floatToPcm(denormalFloor(mixed));
      }
      for (int ch = usedChannels; ch < inputChannels; ++ch) {
        out[base + ch] = in[base + ch];
      }
    }
  }

  void processFloat(const float* in, float* out, int frameCount, int channelCount) {
    if (!in || !out || frameCount <= 0) return;

    const int inputChannels = std::max(1, channelCount);
    const int usedChannels = std::max(1, std::min(2, inputChannels));

    if (!enabled_ || intensity_ <= 0.01f) {
      const int samples = frameCount * inputChannels;
      for (int i = 0; i < samples; ++i) out[i] = in[i];
      return;
    }

    const float intensityNorm = (intensity_ / 100.0f) * EPICENTER_INTENSITY_HEADROOM;
    const float balanceNorm = balance_ / 100.0f;
    const float widthNorm = width_ / 100.0f;
    const float volumeGain = clampf(volume_ / 100.0f, 0.0f, 1.0f);

    const float synthAmount = 0.42f + intensityNorm * 1.28f;
    const float bassProgramAmount = 0.68f + balanceNorm * 0.38f;
    const float lowMidBodyAmount = 0.12f + balanceNorm * 0.08f;
    const float lowMidDipAmount = (0.08f + intensityNorm * 0.16f) * (0.45f + widthNorm * 0.3f);
    const int gateHoldSamples = static_cast<int>(sampleRate_ * (0.025f + intensityNorm * 0.06f));

    if (static_cast<int>(subBuffer_.size()) < frameCount) {
      subBuffer_.resize(static_cast<size_t>(frameCount));
    }

    for (int i = 0; i < frameCount; ++i) {
      const int base = i * inputChannels;
      const float left = in[base];
      const float right = usedChannels > 1 ? in[base + 1] : left;
      const float mono = denormalFloor((left + right) * 0.5f);
      const float diff = denormalFloor((left - right) * 0.5f);
      const float monoBand =
        monoState_.band60.process(mono) * 1.0f +
        monoState_.band80.process(mono) * 0.68f +
        monoState_.band110.process(mono) * 0.42f;
      const float weightedDetector = denormalFloor(monoBand * 0.6f + monoState_.monoLowpass.process(mono) * 0.12f);
      const float detectorEnv = monoState_.detectorEnv.process(weightedDetector);
      const float monoEnv = monoState_.monoEnv.process(mono);
      const float diffEnv = monoState_.diffEnv.process(monoState_.diffHighpass.process(diff));
      if (monoState_.lastDetector <= 0.0f && weightedDetector > 0.0f) {
        monoState_.flipState *= -1;
      }
      monoState_.lastDetector = weightedDetector;
      const float rawHalf = static_cast<float>(monoState_.flipState) * detectorEnv;
      float synth = monoState_.synthHighpass.process(rawHalf);
      synth = monoState_.synthLowpass.process(synth);
      const float gateTarget = computeGate(monoEnv, diffEnv, detectorEnv);
      const float gateValue = monoState_.gateEnv.process(gateTarget);
      if (gateTarget > 0.3f) {
        monoState_.holdSamples = gateHoldSamples;
      } else if (monoState_.holdSamples > 0) {
        monoState_.holdSamples--;
      }
      const float holdFactor = monoState_.holdSamples > 0 ? 1.0f : 0.0f;
      const float remixGate = std::max(gateValue, holdFactor * 0.45f);
      const float leveledSynth = monoState_.synthLevelEnv.process(synth) * (synth >= 0.0f ? 1.0f : -1.0f);
      const float protectedSynth = std::tanh((synth * 0.65f + leveledSynth * 0.35f) * 2.1f) * 0.72f;
      subBuffer_[static_cast<size_t>(i)] = denormalFloor(protectedSynth * synthAmount * remixGate);
    }

    for (int i = 0; i < frameCount; ++i) {
      const int base = i * inputChannels;
      for (int ch = 0; ch < usedChannels; ++ch) {
        ChannelState& state = channels_[std::min(ch, channelCount_ - 1)];
        const float sample = denormalFloor(in[base + ch]);
        const float voicePath = state.voiceHighpass.process(sample);
        const float voicePresence = state.voiceEnv.process(voicePath);
        const float voiceProtection = std::max(0.5f, 1.0f - voicePresence * (0.85f + intensityNorm * 0.3f));
        const float bassProgram = state.bassLowpass.process(sample);
        const float body = state.lowMidBody.process(sample);
        const float dip = state.lowMidDip.process(sample);
        const float shapedBassProgram =
          bassProgram * bassProgramAmount +
          body * lowMidBodyAmount * (0.45f + voiceProtection * 0.55f) -
          dip * lowMidDipAmount;
        const float generatedSub = state.subLowpass.process(subBuffer_[static_cast<size_t>(i)]) * (0.4f + voiceProtection * 0.6f);
        float mixed = voicePath + shapedBassProgram + generatedSub;
        const float protectionGain = 0.94f + voiceProtection * 0.06f;
        mixed *= volumeGain * protectionGain;
        mixed = std::tanh(mixed * 0.94f) / std::tanh(0.94f);
        mixed = state.outputDcHighpass.process(mixed);
        out[base + ch] = denormalFloor(mixed);
      }
      for (int ch = usedChannels; ch < inputChannels; ++ch) {
        out[base + ch] = in[base + ch];
      }
    }
  }

  void resetState() {
    for (auto& c : channels_) {
      c.reset();
    }
    monoState_.reset();
    std::fill(subBuffer_.begin(), subBuffer_.end(), 0.0f);
  }

 private:
  float sampleRate_;
  int channelCount_;
  bool enabled_ = false;
  bool eqEnabled_ = true;
  bool lastLoggedEnabled_ = false;

  float sweepFreq_ = 45.0f;
  float width_ = 50.0f;
  float intensity_ = 50.0f;
  float balance_ = 50.0f;
  float volume_ = 100.0f;

  float lastSweepFreq_ = -1.0f;
  float lastWidth_ = -1.0f;

  ChannelState channels_[2];
  EqChannelState eqChannels_[2];
  LimiterState limiterStates_[2];
  MonoState monoState_;
  std::vector<float> subBuffer_;
  std::array<float, EQ_BAND_COUNT> eqTargetGainsDb_{};
  std::array<float, EQ_BAND_COUNT> eqCurrentGainsDb_{};
  float userEqPreampDb_ = 0.0f;
  float autoEqPreampDb_ = 0.0f;
  float eqTotalPreampLinear_ = 1.0f;
  float eqSmoothingCoeff_ = 0.0f;
  float subSpongeBoostDb_ = -100.0f;
  float subSpongeFreqHz_ = -1.0f;

  void initChannel(ChannelState& c) {
    DerivedFreq d = getDerivedFrequencies(sweepFreq_, width_);
    c.voiceHighpass.sr = sampleRate_;
    c.bassLowpass.sr = sampleRate_;
    c.lowMidBody.sr = sampleRate_;
    c.lowMidDip.sr = sampleRate_;
    c.subLowpass.sr = sampleRate_;
    c.subTextureLowpass.sr = sampleRate_;
    c.subSpongeShelf.sr = sampleRate_;
    c.outputDcHighpass.sr = sampleRate_;

    c.voiceHighpass.update(Biquad::Type::Highpass, d.crossoverHz, 0.707f);
    c.bassLowpass.update(Biquad::Type::Lowpass, d.crossoverHz * 1.15f, 0.707f);
    c.lowMidBody.update(Biquad::Type::Bandpass, d.bodyHz, 0.85f);
    c.lowMidDip.update(Biquad::Type::Bandpass, d.bodyHz * 1.18f, 1.1f);
    c.subLowpass.update(Biquad::Type::Lowpass, d.subTopHz, 0.707f);
    c.subTextureLowpass.update(Biquad::Type::Lowpass, d.subTopHz * 1.35f, 0.707f);
    c.subSpongeShelf.update(Biquad::Type::LowShelf, 74.0f, 0.8f, 2.2f);
    c.outputDcHighpass.update(Biquad::Type::Highpass, 18.0f, 0.707f);

    c.voiceEnv.attackCoeff = coeffFromMs(6.0f, sampleRate_);
    c.voiceEnv.releaseCoeff = coeffFromMs(110.0f, sampleRate_);
  }

  void initEq() {
    const float nyquistSafe = sampleRate_ * 0.45f;
    for (int ch = 0; ch < 2; ++ch) {
      for (int i = 0; i < EQ_BAND_COUNT; ++i) {
        eqChannels_[ch].bands[static_cast<size_t>(i)].sr = sampleRate_;
        const float freq = clampf(kEqFrequenciesHz[static_cast<size_t>(i)], 20.0f, nyquistSafe);
        eqChannels_[ch].bands[static_cast<size_t>(i)].update(Biquad::Type::Peaking, freq, 1.35f, 0.0f);
      }
      limiterStates_[ch].envelope = 0.0f;
      limiterStates_[ch].gain = 1.0f;
    }
    eqSmoothingCoeff_ = coeffFromMs(20.0f, sampleRate_);
    updateEqSafetyAndTargets();
  }

  void initEq() {
    const float nyquistSafe = sampleRate_ * 0.45f;
    for (int ch = 0; ch < 2; ++ch) {
      for (int i = 0; i < EQ_BAND_COUNT; ++i) {
        eqChannels_[ch].bands[static_cast<size_t>(i)].sr = sampleRate_;
        const float freq = clampf(kEqFrequenciesHz[static_cast<size_t>(i)], 20.0f, nyquistSafe);
        eqChannels_[ch].bands[static_cast<size_t>(i)].update(Biquad::Type::Peaking, freq, 1.35f, 0.0f);
      }
      limiterStates_[ch].envelope = 0.0f;
      limiterStates_[ch].gain = 1.0f;
    }
    eqSmoothingCoeff_ = coeffFromMs(20.0f, sampleRate_);
    updateEqSafetyAndTargets();
  }

  void initMono() {
    DerivedFreq d = getDerivedFrequencies(sweepFreq_, width_);

    monoState_.band60.sr = sampleRate_;
    monoState_.band80.sr = sampleRate_;
    monoState_.band110.sr = sampleRate_;
    monoState_.monoLowpass.sr = sampleRate_;
    monoState_.diffHighpass.sr = sampleRate_;
    monoState_.synthHighpass.sr = sampleRate_;
    monoState_.synthLowpass.sr = sampleRate_;

    monoState_.band60.update(Biquad::Type::Bandpass, d.detector60, 1.35f);
    monoState_.band80.update(Biquad::Type::Bandpass, d.detector80, 1.55f);
    monoState_.band110.update(Biquad::Type::Bandpass, d.detector110, 1.8f);
    monoState_.monoLowpass.update(Biquad::Type::Lowpass, 120.0f, 0.707f);
    monoState_.diffHighpass.update(Biquad::Type::Highpass, 140.0f, 0.707f);
    monoState_.synthHighpass.update(Biquad::Type::Highpass, d.synthHighHz, 0.707f);
    monoState_.synthLowpass.update(Biquad::Type::Lowpass, d.synthLowHz, 0.707f);

    monoState_.detectorEnv.attackCoeff = coeffFromMs(7.0f, sampleRate_);
    monoState_.detectorEnv.releaseCoeff = coeffFromMs(95.0f, sampleRate_);

    monoState_.monoEnv.attackCoeff = coeffFromMs(12.0f, sampleRate_);
    monoState_.monoEnv.releaseCoeff = coeffFromMs(160.0f, sampleRate_);

    monoState_.diffEnv.attackCoeff = coeffFromMs(12.0f, sampleRate_);
    monoState_.diffEnv.releaseCoeff = coeffFromMs(160.0f, sampleRate_);

    monoState_.gateEnv.attackCoeff = coeffFromMs(25.0f, sampleRate_);
    monoState_.gateEnv.releaseCoeff = coeffFromMs(240.0f, sampleRate_);

    monoState_.synthLevelEnv.attackCoeff = coeffFromMs(18.0f, sampleRate_);
    monoState_.synthLevelEnv.releaseCoeff = coeffFromMs(180.0f, sampleRate_);
  }

  void updateDerivedFilters() {
    DerivedFreq d = getDerivedFrequencies(sweepFreq_, width_);
    for (auto& c : channels_) {
      c.voiceHighpass.update(Biquad::Type::Highpass, d.crossoverHz, 0.707f);
      c.bassLowpass.update(Biquad::Type::Lowpass, d.crossoverHz * 1.15f, 0.707f);
      c.lowMidBody.update(Biquad::Type::Bandpass, d.bodyHz, 0.85f);
      c.lowMidDip.update(Biquad::Type::Bandpass, d.bodyHz * 1.18f, 1.1f);
      c.subLowpass.update(Biquad::Type::Lowpass, d.subTopHz, 0.707f);
      c.subTextureLowpass.update(Biquad::Type::Lowpass, d.subTopHz * 1.35f, 0.707f);
    }

    monoState_.band60.update(Biquad::Type::Bandpass, d.detector60, 1.35f);
    monoState_.band80.update(Biquad::Type::Bandpass, d.detector80, 1.55f);
    monoState_.band110.update(Biquad::Type::Bandpass, d.detector110, 1.8f);
    monoState_.synthHighpass.update(Biquad::Type::Highpass, d.synthHighHz, 0.707f);
    monoState_.synthLowpass.update(Biquad::Type::Lowpass, d.synthLowHz, 0.707f);
  }

  void updateSubSpongeVoicing(float intensityNorm, float widthNorm) {
    // Voicing inspirado en "Bass Boost" (low-shelf fijo + saturación suave)
    // para reforzar subgrave con ataque más redondo/esponjoso sin romper voces.
    const float targetBoostDb = clampf(
      SUB_SPONGE_BOOST_MIN_DB + intensityNorm * (SUB_SPONGE_BOOST_MAX_DB - SUB_SPONGE_BOOST_MIN_DB),
      SUB_SPONGE_BOOST_MIN_DB,
      SUB_SPONGE_BOOST_MAX_DB
    );
    const float targetFreqHz = clampf(
      SUB_SPONGE_FREQ_MIN_HZ + widthNorm * (SUB_SPONGE_FREQ_MAX_HZ - SUB_SPONGE_FREQ_MIN_HZ),
      SUB_SPONGE_FREQ_MIN_HZ,
      SUB_SPONGE_FREQ_MAX_HZ
    );

    if (std::fabs(targetBoostDb - subSpongeBoostDb_) < 0.02f && std::fabs(targetFreqHz - subSpongeFreqHz_) < 0.1f) {
      return;
    }

    subSpongeBoostDb_ = targetBoostDb;
    subSpongeFreqHz_ = targetFreqHz;
    for (auto& c : channels_) {
      c.subSpongeShelf.update(Biquad::Type::LowShelf, subSpongeFreqHz_, 0.8f, subSpongeBoostDb_);
    }
  }

  void updateEqSafetyAndTargets() {
    float maxBoostDb = 0.0f;
    for (int i = 0; i < EQ_BAND_COUNT; ++i) {
      maxBoostDb = std::max(maxBoostDb, std::max(0.0f, eqTargetGainsDb[static_cast<size_t>(i)]));
    }
    autoEqPreampDb_ = -(maxBoostDb * EQ_AUTO_PREAMP_FACTOR + (maxBoostDb > 0.0f ? EQ_AUTO_PREAMP_MARGIN_DB : 0.0f));
    const float totalPreampDb = clampf(userEqPreampDb_ + autoEqPreampDb_, -30.0f, 0.0f);
    eqTotalPreampLinear_ = std::pow(10.0f, totalPreampDb / 20.0f);
  }

  float processEqAndLimiter(float sample, int ch) {
    if (!eqEnabled_) {
      return applySoftLimiter(sample, ch);
    }

    float out = sample * eqTotalPreampLinear_;
    EqChannelState& eqState = eqChannels_[std::min(ch, 1)];

    for (int i = 0; i < EQ_BAND_COUNT; ++i) {
      float& currentDb = eqCurrentGainsDb_[static_cast<size_t>(i)];
      const float targetDb = eqTargetGainsDb_[static_cast<size_t>(i)];
      currentDb = targetDb + eqSmoothingCoeff_ * (currentDb - targetDb);
      float effectiveDb = clampf(currentDb, EQ_INTERNAL_CUT_MIN_DB, EQ_INTERNAL_BOOST_MAX_DB);
      float linear = std::pow(10.0f, effectiveDb / 20.0f);
      if (linear > EQ_SAFE_GAIN_MAX_LINEAR) {
        effectiveDb = 20.0f * std::log10(EQ_SAFE_GAIN_MAX_LINEAR);
      }
      eqState.bands[static_cast<size_t>(i)].update(Biquad::Type::Peaking, kEqFrequenciesHz[static_cast<size_t>(i)], 1.35f, effectiveDb);
      out = eqState.bands[static_cast<size_t>(i)].process(out);
    }

    return applySoftLimiter(out, ch);
  }

  float applySoftLimiter(float sample, int ch) {
    LimiterState& lim = limiterStates_[std::min(ch, 1)];
    const float absSample = std::fabs(sample);
    const float envCoeff = absSample > lim.envelope ? coeffFromMs(1.5f, sampleRate_) : coeffFromMs(35.0f, sampleRate_);
    lim.envelope = absSample + envCoeff * (lim.envelope - absSample);

    float gainTarget = 1.0f;
    if (lim.envelope > LIMITER_THRESHOLD) {
      gainTarget = LIMITER_THRESHOLD / (lim.envelope + 1e-6f);
    }
    gainTarget = clampf(gainTarget, LIMITER_GAIN_FLOOR, 1.0f);
    const float gainCoeff = gainTarget < lim.gain ? coeffFromMs(0.6f, sampleRate_) : coeffFromMs(45.0f, sampleRate_);
    lim.gain = gainTarget + gainCoeff * (lim.gain - gainTarget);

    const float limited = sample * lim.gain;
    const float soft = std::tanh(limited * 1.65f) / std::tanh(1.65f);
    return denormalFloor(soft * LIMITER_MIX + limited * (1.0f - LIMITER_MIX));
  }

  void updateEqSafetyAndTargets() {
    float maxBoostDb = 0.0f;
    for (int i = 0; i < EQ_BAND_COUNT; ++i) {
      maxBoostDb = std::max(maxBoostDb, std::max(0.0f, eqTargetGainsDb[static_cast<size_t>(i)]));
    }
    autoEqPreampDb_ = -(maxBoostDb * EQ_AUTO_PREAMP_FACTOR + (maxBoostDb > 0.0f ? EQ_AUTO_PREAMP_MARGIN_DB : 0.0f));
    const float totalPreampDb = clampf(userEqPreampDb_ + autoEqPreampDb_, -30.0f, 0.0f);
    eqTotalPreampLinear_ = std::pow(10.0f, totalPreampDb / 20.0f);
  }

  float processEqAndLimiter(float sample, int ch) {
    if (!eqEnabled_) {
      return applySoftLimiter(sample, ch);
    }

    float out = sample * eqTotalPreampLinear_;
    EqChannelState& eqState = eqChannels_[std::min(ch, 1)];

    for (int i = 0; i < EQ_BAND_COUNT; ++i) {
      float& currentDb = eqCurrentGainsDb_[static_cast<size_t>(i)];
      const float targetDb = eqTargetGainsDb_[static_cast<size_t>(i)];
      currentDb = targetDb + eqSmoothingCoeff_ * (currentDb - targetDb);
      float effectiveDb = clampf(currentDb, EQ_INTERNAL_CUT_MIN_DB, EQ_INTERNAL_BOOST_MAX_DB);
      float linear = std::pow(10.0f, effectiveDb / 20.0f);
      if (linear > EQ_SAFE_GAIN_MAX_LINEAR) {
        effectiveDb = 20.0f * std::log10(EQ_SAFE_GAIN_MAX_LINEAR);
      }
      eqState.bands[static_cast<size_t>(i)].update(Biquad::Type::Peaking, kEqFrequenciesHz[static_cast<size_t>(i)], 1.35f, effectiveDb);
      out = eqState.bands[static_cast<size_t>(i)].process(out);
    }

    return applySoftLimiter(out, ch);
  }

  float applySoftLimiter(float sample, int ch) {
    LimiterState& lim = limiterStates_[std::min(ch, 1)];
    const float absSample = std::fabs(sample);
    const float envCoeff = absSample > lim.envelope ? coeffFromMs(1.5f, sampleRate_) : coeffFromMs(35.0f, sampleRate_);
    lim.envelope = absSample + envCoeff * (lim.envelope - absSample);

    float gainTarget = 1.0f;
    if (lim.envelope > LIMITER_THRESHOLD) {
      gainTarget = LIMITER_THRESHOLD / (lim.envelope + 1e-6f);
    }
    gainTarget = clampf(gainTarget, LIMITER_GAIN_FLOOR, 1.0f);
    const float gainCoeff = gainTarget < lim.gain ? coeffFromMs(0.6f, sampleRate_) : coeffFromMs(45.0f, sampleRate_);
    lim.gain = gainTarget + gainCoeff * (lim.gain - gainTarget);

    const float limited = sample * lim.gain;
    const float soft = std::tanh(limited * 1.65f) / std::tanh(1.65f);
    return denormalFloor(soft * LIMITER_MIX + limited * (1.0f - LIMITER_MIX));
  }

  static float computeGate(float monoEnv, float diffEnv, float weightedDetectorEnv) {
    const float musicRatio = diffEnv / (monoEnv + 1e-6f);
    const float detectorActivity = std::min(1.0f, weightedDetectorEnv * 9.5f);
    const float musicScore = clampf(musicRatio * 3.2f, 0.0f, 1.0f);
    return detectorActivity * (0.25f + musicScore * 0.75f);
  }

  static float pcmToFloat(int16_t v) {
    return static_cast<float>(v) / 32768.0f;
  }

  static int16_t floatToPcm(float v) {
    float c = clampf(v, -1.0f, 1.0f);
    int32_t sample = static_cast<int32_t>(std::lrint(c * 32767.0f));
    sample = std::max(-32768, std::min(32767, sample));
    return static_cast<int16_t>(sample);
  }
};

inline EpicenterEngine* fromHandle(jlong handle) {
  return reinterpret_cast<EpicenterEngine*>(handle);
}

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeCreate(JNIEnv*, jclass, jint sampleRate, jint channelCount) {
  auto* engine = new EpicenterEngine(sampleRate, channelCount);
  return reinterpret_cast<jlong>(engine);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeRelease(JNIEnv*, jclass, jlong handle) {
  delete fromHandle(handle);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetParams(
  JNIEnv*,
  jclass,
  jlong handle,
  jboolean enabled,
  jfloat sweepFreq,
  jfloat width,
  jfloat intensity,
  jfloat balance,
  jfloat volume
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  engine->setParams(enabled == JNI_TRUE, sweepFreq, width, intensity, balance, volume);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetEqEnabled(
  JNIEnv*,
  jclass,
  jlong handle,
  jboolean enabled
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  engine->setEqEnabled(enabled == JNI_TRUE);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetEqPreampDb(
  JNIEnv*,
  jclass,
  jlong handle,
  jfloat preampDb
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  engine->setEqPreampDb(preampDb);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetEqBand(
  JNIEnv*,
  jclass,
  jlong handle,
  jint index,
  jfloat gainDb
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  engine->setEqBand(index, gainDb);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetEqBands(
  JNIEnv* env,
  jclass,
  jlong handle,
  jfloatArray gainsDb
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  if (!gainsDb) {
    engine->setEqBands(nullptr, 0);
    return;
  }

  const jsize len = env->GetArrayLength(gainsDb);
  jfloat* values = env->GetFloatArrayElements(gainsDb, nullptr);
  engine->setEqBands(values, static_cast<int>(len));
  env->ReleaseFloatArrayElements(gainsDb, values, JNI_ABORT);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetEqEnabled(
  JNIEnv*,
  jclass,
  jlong handle,
  jboolean enabled
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  engine->setEqEnabled(enabled == JNI_TRUE);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetEqPreampDb(
  JNIEnv*,
  jclass,
  jlong handle,
  jfloat preampDb
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  engine->setEqPreampDb(preampDb);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetEqBand(
  JNIEnv*,
  jclass,
  jlong handle,
  jint index,
  jfloat gainDb
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  engine->setEqBand(index, gainDb);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeSetEqBands(
  JNIEnv* env,
  jclass,
  jlong handle,
  jfloatArray gainsDb
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  if (!gainsDb) {
    engine->setEqBands(nullptr, 0);
    return;
  }

  const jsize len = env->GetArrayLength(gainsDb);
  jfloat* values = env->GetFloatArrayElements(gainsDb, nullptr);
  engine->setEqBands(values, static_cast<int>(len));
  env->ReleaseFloatArrayElements(gainsDb, values, JNI_ABORT);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeProcessPcm16(
  JNIEnv* env,
  jclass,
  jlong handle,
  jobject input,
  jobject output,
  jint frameCount,
  jint channelCount
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine || !input || !output) return;

  auto* in = static_cast<int16_t*>(env->GetDirectBufferAddress(input));
  auto* out = static_cast<int16_t*>(env->GetDirectBufferAddress(output));
  if (!in || !out) return;

  engine->processPcm16(in, out, frameCount, channelCount);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeProcessFloat(
  JNIEnv* env,
  jclass,
  jlong handle,
  jobject input,
  jobject output,
  jint frameCount,
  jint channelCount
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine || !input || !output) return;

  auto* in = static_cast<float*>(env->GetDirectBufferAddress(input));
  auto* out = static_cast<float*>(env->GetDirectBufferAddress(output));
  if (!in || !out) return;

  engine->processFloat(in, out, frameCount, channelCount);
}

extern "C" JNIEXPORT void JNICALL
Java_com_epicenter_hifi_NativeEpicenterJni_nativeResetState(
  JNIEnv*,
  jclass,
  jlong handle
) {
  EpicenterEngine* engine = fromHandle(handle);
  if (!engine) return;
  engine->resetState();
}
