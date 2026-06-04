from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from scipy.signal import butter, filtfilt
import numpy as np
from database import get_db, engine
import models
import schemas

models.Base.metadata.create_all(bind=engine)

app = FastAPI(root_path="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────
# Helpers de conversión
# ─────────────────────────────────────────
def bool_campo(valor: str | None) -> int | None:
    """Convierte 'si'/'no' a 1/0. None si no viene."""
    if valor is None:
        return None
    return 1 if str(valor).lower() == 'si' else 0

def nivel_ingresos_int(valor: str | None) -> int | None:
    """nivel_ingresos viene como string ('1'..'6', 'usd', '0')."""
    if valor is None:
        return None
    mapeo = {'usd': 7, '0': 0}
    return mapeo.get(str(valor), None) or (int(valor) if str(valor).isdigit() else None)

# ─────────────────────────────────────────
# Algoritmo PPG (solo para /debug-senal y
# como validación opcional en /medir)
# ─────────────────────────────────────────
def calcular_bpm(valores_rojos: list, fps: int = 30):
    from scipy.signal import find_peaks
    señal = np.array(valores_rojos, dtype=np.float64)

    if len(señal) < fps * 4:
        raise HTTPException(status_code=400, detail="SEÑAL_INSUFICIENTE")

    p5, p95 = np.percentile(señal, [5, 95])
    rango = p95 - p5
    if rango < 1e-6:
        raise HTTPException(status_code=422, detail="SIN_DEDO")

    señal_norm = np.clip((señal - p5) / rango, 0, 1)
    try:
        b, a = butter(4, [0.67, 3.0], btype='band', fs=fps)
        señal_proc = filtfilt(b, a, señal_norm)
    except Exception:
        señal_proc = señal_norm

    dist_min = int(fps * 0.33)
    picos, _ = find_peaks(señal_proc, distance=dist_min, prominence=np.std(señal_proc) * 0.5)

    if len(picos) < 5:
        raise HTTPException(status_code=422, detail="BUSCANDO_PULSO")

    ultimos_picos = picos[-6:]
    intervalos_rr = np.diff(ultimos_picos) / fps

    if len(intervalos_rr) < 4:
        raise HTTPException(status_code=422, detail="ESTABILIZANDO_SEÑAL")

    mediana_rr = np.median(intervalos_rr)
    desviacion  = np.std(intervalos_rr)
    es_humano   = 0.33 <= mediana_rr <= 1.5
    es_estable  = (desviacion / mediana_rr) < 0.15

    if es_humano and es_estable:
        bpm_final     = 60.0 / np.mean(intervalos_rr)
        muestra_debug = señal_proc[-fps * 5:].tolist()
        return round(float(bpm_final), 1), muestra_debug

    raise HTTPException(status_code=422, detail="MUCHO_MOVIMIENTO_O_ARRITMIA")


# ─────────────────────────────────────────
# POST /medir
# El frontend ya calculó bpm_camara en el cliente.
# Este endpoint guarda todo en la BD y devuelve confirmación.
# Si por alguna razón bpm_camara es None pero hay señal,
# intenta calcularlo como fallback.
# ─────────────────────────────────────────
@app.post("/medir", response_model=schemas.MedicionResponse)
def medir(data: schemas.MedicionRequest, db: Session = Depends(get_db)):

    bpm_camara   = data.bpm_camara
    señal_debug  = None

    # Fallback: si el frontend no mandó bpm_camara pero hay señal, calcular
    if bpm_camara is None and len(data.valores_rojos) > 0:
        try:
            bpm_camara, señal_debug = calcular_bpm(data.valores_rojos)
        except HTTPException:
            bpm_camara = None

    # bpm que se devuelve al frontend (el que sea disponible)
    bpm_respuesta = bpm_camara or data.bpm_manual or 0

    medicion = models.RespuestaEstudio(
        # Sección 1
        edad                   = data.edad,
        genero                 = data.genero,
        carrera                = data.carrera,
        estatura               = data.estatura,
        peso                   = data.peso,
        situacion_laboral      = data.situacion_laboral,
        estado_civil           = data.estado_civil,
        vive_con               = data.vive_con,
        lugar_origen           = data.lugar_origen,
        tiene_hijos            = data.tiene_hijos,

        # Sección 2
        comidas                = data.comidas,
        cafe                   = data.cafe,
        sueno                  = data.sueno,
        calidad_sueno          = data.calidad_sueno,
        tipo_alimentacion      = data.tipo_alimentacion,
        actividad_fisica       = bool_campo(data.actividad_fisica),  # 'si'/'no' → 1/0
        tipo_actividad         = data.tipo_actividad,
        horas_actividad        = data.horas_actividad,
        frecuencia_actividad   = data.frecuencia_actividad,
        consumo_alcohol        = data.consumo_alcohol,
        consumo_tabaco         = data.consumo_tabaco,
        cruza_frontera         = data.cruza_frontera,
        tiempo_traslado        = data.tiempo_traslado,

        # Sección 3
        tareas_pendientes      = data.tareas_pendientes,
        semestre               = data.semestre,
        nivel_ingresos         = data.nivel_ingresos,
        fuente_ingresos        = data.fuente_ingresos,
        antecedentes_cardiacos = bool_campo(data.antecedentes_cardiacos),
        condicion_medica       = data.condicion_medica,
        terapia_psicologica    = bool_campo(data.terapia),
        red_apoyo              = data.red_apoyo,
        estado_emocional       = data.valoracion_psicologica,
        nivel_estres           = data.nivel_estres,
        principal_estresor     = data.principal_estresor,

        # Medición cardíaca
        bpm_camara             = bpm_camara,
        bpm_manual             = data.bpm_manual,
        modo_medicion          = data.modo_medicion,
    )

    db.add(medicion)
    db.commit()
    db.refresh(medicion)

    return {
        "bpm":        bpm_respuesta,
        "mensaje":    f"Registro guardado. BPM cámara: {bpm_camara}, BPM manual: {data.bpm_manual}",
        "señal_debug": señal_debug
    }


# ─────────────────────────────────────────
# GET /mediciones
# ─────────────────────────────────────────
@app.get("/mediciones")
def obtener_mediciones(db: Session = Depends(get_db)):
    return db.query(models.RespuestaEstudio).all()


# ─────────────────────────────────────────
# POST /debug-senal (sin cambios funcionales)
# ─────────────────────────────────────────
@app.post("/debug-senal")
def debug_senal(data: schemas.MedicionRequest):
    señal = np.array(data.valores_rojos, dtype=np.float64)
    fps   = 30

    p5  = np.percentile(señal, 5)
    p95 = np.percentile(señal, 95)
    rango = p95 - p5

    señal_norm     = np.clip((señal - p5) / (rango + 1e-10), 0, 1)
    señal_realzada = np.power(señal_norm, 3)
    señal_realzada = (señal_realzada - np.mean(señal_realzada)) / (np.std(señal_realzada) + 1e-8)

    try:
        b, a = butter(4, [0.67, 3.0], btype='band', fs=fps)
        señal_filtrada = filtfilt(b, a, señal_realzada)
    except Exception:
        señal_filtrada = señal_realzada

    tam_ventana  = fps * 10
    num_ventanas = len(señal_filtrada) // tam_ventana
    ventanas_info = []

    for i in range(num_ventanas):
        ventana   = señal_filtrada[i * tam_ventana:(i + 1) * tam_ventana]
        amplitud  = float(np.max(ventana) - np.min(ventana))

        fft_vals = np.abs(np.fft.rfft(ventana))
        freqs    = np.fft.rfftfreq(len(ventana), d=1.0 / fps)
        idx      = np.where((freqs >= 0.67) & (freqs <= 3.0))[0]

        bpm_ventana = None
        snr         = 0.0
        if len(idx) > 0:
            idx_pico    = np.argmax(fft_vals[idx])
            bpm_ventana = float(freqs[idx[idx_pico]] * 60)
            snr         = float(fft_vals[idx[idx_pico]] ** 2 / (np.sum(fft_vals[idx] ** 2) + 1e-10))

        ventanas_info.append({
            "ventana":   i + 1,
            "bpm":       round(bpm_ventana, 1) if bpm_ventana else None,
            "amplitud":  round(amplitud, 4),
            "snr":       round(snr, 4)
        })

    return {
        "total_frames":          len(señal),
        "rango_crudo":           round(float(rango), 2),
        "señal_cruda_muestra":   señal[:fps * 10:3].tolist(),
        "señal_filtrada_muestra": señal_filtrada[:fps * 10:3].tolist(),
        "ventanas":              ventanas_info
    }