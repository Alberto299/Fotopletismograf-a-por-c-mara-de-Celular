import json
import sys
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks

FPS_DEFAULT = 30


@dataclass
class ApiError(Exception):
    detail: str
    status_code: int = 422
    meta: dict[str, Any] | None = None


def calcular_bpm(valores_rojos: list[float], fps: int = FPS_DEFAULT) -> tuple[float, list[float], int]:
    signal = np.array(valores_rojos, dtype=np.float64)

    if len(signal) < fps * 4:
        raise ApiError("SENAL_INSUFICIENTE", 400, {"picos_detectados": 0})

    p5, p95 = np.percentile(signal, [5, 95])
    signal_range = p95 - p5
    if signal_range < 1e-6:
        raise ApiError("SIN_DEDO", 422, {"picos_detectados": 0})

    normalized = np.clip((signal - p5) / signal_range, 0, 1)

    try:
        b, a = butter(4, [0.67, 3.0], btype="band", fs=fps)
        processed = filtfilt(b, a, normalized)
    except Exception:
        processed = normalized

    min_distance = int(fps * 0.33)
    peaks, _ = find_peaks(
        processed,
        distance=min_distance,
        prominence=np.std(processed) * 0.5,
    )

    if len(peaks) < 5:
        raise ApiError("BUSCANDO_PULSO", 422, {"picos_detectados": int(len(peaks))})

    last_peaks = peaks[-6:]
    rr_intervals = np.diff(last_peaks) / fps

    if len(rr_intervals) < 4:
        raise ApiError("ESTABILIZANDO_SENAL", 422, {"picos_detectados": int(len(peaks))})

    median_rr = np.median(rr_intervals)
    deviation = np.std(rr_intervals)
    is_human = 0.33 <= median_rr <= 1.5
    is_stable = (deviation / median_rr) < 0.15

    if not (is_human and is_stable):
        raise ApiError("MUCHO_MOVIMIENTO_O_ARRITMIA", 422, {"picos_detectados": int(len(peaks))})

    bpm = 60.0 / np.mean(rr_intervals)
    debug_sample = processed[-fps * 5 :].tolist()
    return round(float(bpm), 1), debug_sample, int(len(peaks))


def debug_signal(valores_rojos: list[float], fps: int = FPS_DEFAULT) -> dict[str, Any]:
    signal = np.array(valores_rojos, dtype=np.float64)

    if len(signal) < fps * 4:
        raise ApiError("SENAL_INSUFICIENTE", 400, {"picos_detectados": 0})

    p5 = np.percentile(signal, 5)
    p95 = np.percentile(signal, 95)
    signal_range = p95 - p5

    normalized = np.clip((signal - p5) / (signal_range + 1e-10), 0, 1)
    enhanced = np.power(normalized, 3)
    enhanced = (enhanced - np.mean(enhanced)) / (np.std(enhanced) + 1e-8)

    try:
        b, a = butter(4, [0.67, 3.0], btype="band", fs=fps)
        filtered = filtfilt(b, a, enhanced)
    except Exception:
        filtered = enhanced

    bpm, debug_sample, peaks_count = calcular_bpm(valores_rojos, fps)
    window_size = fps * 10
    window_count = len(filtered) // window_size
    windows = []

    for i in range(window_count):
        window = filtered[i * window_size : (i + 1) * window_size]
        amplitude = float(np.max(window) - np.min(window))

        fft_vals = np.abs(np.fft.rfft(window))
        freqs = np.fft.rfftfreq(len(window), d=1.0 / fps)
        idx = np.where((freqs >= 0.67) & (freqs <= 3.0))[0]

        window_bpm = None
        snr = 0.0
        if len(idx) > 0:
            peak_idx = np.argmax(fft_vals[idx])
            window_bpm = float(freqs[idx[peak_idx]] * 60)
            snr = float(fft_vals[idx[peak_idx]] ** 2 / (np.sum(fft_vals[idx] ** 2) + 1e-10))

        windows.append(
            {
                "ventana": i + 1,
                "bpm": round(window_bpm, 1) if window_bpm else None,
                "amplitud": round(amplitude, 4),
                "snr": round(snr, 4),
            }
        )

    return {
        "bpm": bpm,
        "picos_detectados": peaks_count,
        "total_frames": len(signal),
        "rango_crudo": round(float(signal_range), 2),
        "senal_debug": debug_sample,
        "senal_cruda_muestra": signal[: fps * 10 : 3].tolist(),
        "senal_filtrada_muestra": filtered[: fps * 10 : 3].tolist(),
        "ventanas": windows,
    }


def success(data: dict[str, Any]) -> None:
    print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))


def failure(error: ApiError) -> None:
    print(
        json.dumps(
            {
                "ok": False,
                "detail": error.detail,
                "status_code": error.status_code,
                "meta": error.meta or {},
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else "measure"
    payload = json.loads(sys.stdin.read() or "{}")
    valores_rojos = payload.get("valores_rojos") or payload.get("valoresRojos") or []
    fps = int(payload.get("fps") or FPS_DEFAULT)

    try:
      if action == "debug":
          success(debug_signal(valores_rojos, fps))
          return

      bpm, debug_sample, peaks_count = calcular_bpm(valores_rojos, fps)
      success(
          {
              "bpm": bpm,
              "mensaje": "Medicion procesada correctamente.",
              "senal_debug": debug_sample,
              "picos_detectados": peaks_count,
          }
      )
    except ApiError as error:
        failure(error)


if __name__ == "__main__":
    main()
