#include <algorithm>
#include <cmath>
#include <cstdint>

namespace {

constexpr int kPrimitiveStride = 6;
constexpr float kPi = 3.14159265358979323846f;

uint32_t hash_u32(uint32_t value) {
    value ^= value >> 16;
    value *= 0x7feb352du;
    value ^= value >> 15;
    value *= 0x846ca68bu;
    value ^= value >> 16;
    return value;
}

float random01(uint32_t value) {
    return static_cast<float>(hash_u32(value) & 0x00ffffffu) / 16777215.0f;
}

float smooth(float value) {
    return value * value * (3.0f - 2.0f * value);
}

float value_noise(float x, float y, uint32_t seed) {
    const int x0 = static_cast<int>(std::floor(x));
    const int y0 = static_cast<int>(std::floor(y));
    const float tx = smooth(x - static_cast<float>(x0));
    const float ty = smooth(y - static_cast<float>(y0));
    const auto sample = [seed](int sx, int sy) {
        return random01(static_cast<uint32_t>(sx) * 0x1f123bb5u ^ static_cast<uint32_t>(sy) * 0x5f356495u ^ seed);
    };
    const float a = sample(x0, y0);
    const float b = sample(x0 + 1, y0);
    const float c = sample(x0, y0 + 1);
    const float d = sample(x0 + 1, y0 + 1);
    const float top = a + (b - a) * tx;
    const float bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
}

float wrap(float value, float min_value, float max_value) {
    const float width = max_value - min_value;
    if (width <= 0.0f || !std::isfinite(value)) return min_value;
    if (value > max_value || value < min_value) {
        value = min_value + std::fmod(std::fmod(value - min_value, width) + width, width);
    }
    return value;
}

float noise_sample(float x, float y, float z, float time) {
    return std::sin(x * 0.5f + time) * std::cos(y * 0.3f + time) * std::sin(z * 0.5f);
}

void curl_components(float x, float y, float z, float time, float& curl_x, float& curl_z) {
    constexpr float eps = 0.1f;
    curl_x = (noise_sample(x, y + eps, z, time) - noise_sample(x, y - eps, z, time)) * 0.5f;
    curl_z = (noise_sample(x - eps, y, z, time) - noise_sample(x + eps, y, z, time)) * 0.5f;
}

bool push_primitive(float* output, int capacity, int& count, float kind, float a, float b, float c, float d,
                    float e = 0.0f) {
    if (!output || count >= capacity) return false;
    const int index = count * kPrimitiveStride;
    output[index] = kind;
    output[index + 1] = a;
    output[index + 2] = b;
    output[index + 3] = c;
    output[index + 4] = d;
    output[index + 5] = e;
    ++count;
    return true;
}

}  // namespace

extern "C" {

void generate_cloud_noise(uint8_t* output, int width, int height, int octaves, uint32_t seed) {
    if (!output || width <= 0 || height <= 0 || octaves <= 0) return;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float frequency = 1.0f / 64.0f;
            float amplitude = 1.0f;
            float total = 0.0f;
            float weight = 0.0f;
            for (int octave = 0; octave < octaves; ++octave) {
                total += value_noise(static_cast<float>(x) * frequency, static_cast<float>(y) * frequency,
                                     seed + static_cast<uint32_t>(octave) * 1013u) * amplitude;
                weight += amplitude;
                frequency *= 2.0f;
                amplitude *= 0.5f;
            }
            output[y * width + x] = static_cast<uint8_t>(std::clamp(total / weight, 0.0f, 1.0f) * 255.0f);
        }
    }
}

// mode: 0 = snow points, 1 = rain line-segment pairs, 2 = dust points.
void step_particles(float* positions, float* velocities, const float* offsets, int count, float wind_x, float wind_z,
                    float dt, int mode, float min_x, float max_x, float time_seconds) {
    if (!positions || !velocities || count <= 0) return;
    const float frame_scale = std::clamp(dt * 60.0f, 0.0f, 3.0f);
    for (int i = 0; i < count; ++i) {
        const int velocity_index = i * 3;
        if (mode == 1) {
            const int position_index = i * 6;
            velocities[velocity_index] += (wind_x - velocities[velocity_index]) * 0.1f * frame_scale;
            velocities[velocity_index + 2] += (wind_z - velocities[velocity_index + 2]) * 0.1f * frame_scale;
            const float vx = velocities[velocity_index];
            const float vy = velocities[velocity_index + 1];
            const float vz = velocities[velocity_index + 2];
            positions[position_index + 3] = wrap(positions[position_index + 3] + vx * frame_scale, min_x, max_x);
            positions[position_index + 4] += vy * frame_scale;
            positions[position_index + 5] += vz * frame_scale;
            positions[position_index] = positions[position_index + 3] - vx * 4.0f;
            positions[position_index + 1] = positions[position_index + 4] - vy * 4.0f;
            positions[position_index + 2] = positions[position_index + 5] - vz * 4.0f;
            continue;
        }

        const int position_index = i * 3;
        const float px = positions[position_index];
        const float py = positions[position_index + 1];
        const float pz = positions[position_index + 2];
        const float phase = time_seconds + (offsets ? offsets[i] : 0.0f) * 0.01f;
        const float coordinate_scale = mode == 2 ? 0.2f : 0.1f;
        float curl_x = 0.0f;
        float curl_z = 0.0f;
        curl_components(px * coordinate_scale, py * coordinate_scale, pz * coordinate_scale, phase, curl_x, curl_z);

        if (mode == 2) {
            positions[position_index] = wrap(px + (wind_x + curl_x * 0.02f) * frame_scale, min_x, max_x);
            positions[position_index + 1] = py + std::sin(phase * 1.7f) * 0.005f * frame_scale;
            positions[position_index + 2] = pz + (wind_z + curl_z * 0.02f) * frame_scale;
        } else {
            positions[position_index] = wrap(
                px + (velocities[velocity_index] + wind_x + curl_x * 0.05f) * frame_scale, min_x, max_x);
            positions[position_index + 1] = py + velocities[velocity_index + 1] * frame_scale;
            positions[position_index + 2] =
                pz + (velocities[velocity_index + 2] + wind_z + curl_z * 0.05f) * frame_scale;
        }
    }
}

int generate_forecast_primitives(float* output, int capacity, float width, float height, float cloud_cover,
                                 int precip_type, float precip_intensity, float wind_speed, float wind_dir,
                                 float time_ms) {
    if (!output || capacity <= 0) return 0;
    const float wind_rad = (90.0f - wind_dir) * kPi / 180.0f;
    const float wind_x = std::cos(wind_rad);
    const float wind_y = -std::sin(wind_rad);
    int count = 0;
    const int cloud_count = static_cast<int>(std::floor(1.0f + (cloud_cover / 100.0f) * 4.0f));
    for (int i = 0; i < cloud_count; ++i) {
        const float wind_phase = std::fmod(time_ms * 0.0008f * std::max(2.0f, wind_speed), 24.0f);
        const float wind_offset = std::fmod(wind_phase + wind_speed * 0.35f + static_cast<float>(i * 8), 24.0f);
        const float px = 18.0f + static_cast<float>((i % 3) * 28 + ((i * 7) % 11)) + wind_x * wind_offset;
        const float py = 18.0f + static_cast<float>((i / 3) * 9) + wind_y * wind_offset * 0.35f;
        push_primitive(output, capacity, count, 0.0f, px, py, 10.0f + static_cast<float>((i % 2) * 3), 5.0f,
                       wind_rad * 0.18f);
    }

    if (precip_type == 1 || precip_type == 2) {
        const bool snow = precip_type == 2;
        const int precipitation_count = std::max(
            snow ? 8 : 6,
            static_cast<int>(std::floor(static_cast<float>(snow ? 12 : 10) * (0.35f + precip_intensity))));
        for (int i = 0; i < precipitation_count; ++i) {
            const float x = 12.0f + std::fmod(static_cast<float>(i * 17), std::max(1.0f, width - 16.0f));
            const float y = 26.0f + std::fmod(static_cast<float>(i * 11), height * 0.4f);
            if (snow) {
                push_primitive(output, capacity, count, 2.0f, x, y, 1.5f, 1.5f);
            } else {
                push_primitive(output, capacity, count, 1.0f, x, y, x + 2.0f + wind_x * 5.0f,
                               y + 11.0f + wind_y * 2.0f);
            }
        }
    }
    return count;
}

}  // extern "C"
