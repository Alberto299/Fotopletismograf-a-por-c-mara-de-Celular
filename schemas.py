from pydantic import BaseModel, field_validator, model_validator
from typing import List, Optional, Any

class MedicionResponse(BaseModel):
    bpm: float
    mensaje: str
    señal_debug: Optional[List[float]] = None

class MedicionRequest(BaseModel):
    nombre:               str
    edad:                 int

    # Sección 1 — vienen como string del frontend, se castean
    genero:               Optional[int]   = None
    carrera:              Optional[int]   = None
    estatura:             Optional[int]   = None
    peso:                 Optional[float] = None
    situacion_laboral:    Optional[int]   = None
    estado_civil:         Optional[int]   = None
    vive_con:             Optional[int]   = None
    lugar_origen:         Optional[int]   = None
    tiene_hijos:          Optional[int]   = None

    # Sección 2
    comidas:              Optional[int]   = None
    cafe:                 Optional[int]   = None
    sueno:                Optional[float] = None
    calidad_sueno:        Optional[int]   = None
    tipo_alimentacion:    Optional[int]   = None
    actividad_fisica:     Optional[str]   = None   # 'si' / 'no'
    tipo_actividad:       Optional[Any]   = None   # puede venir 'ninguna' o int
    horas_actividad:      Optional[float] = None
    frecuencia_actividad: Optional[int]   = None
    consumo_alcohol:      Optional[int]   = None
    consumo_tabaco:       Optional[int]   = None
    cruza_frontera:       Optional[int]   = None
    tiempo_traslado:      Optional[int]   = None

    # Sección 3
    tareas_pendientes:      Optional[int] = None
    semestre:               Optional[int] = None
    nivel_ingresos:         Optional[Any] = None   # puede ser 'usd', '0', o int
    fuente_ingresos:        Optional[int] = None
    antecedentes_cardiacos: Optional[str] = None   # 'si' / 'no'
    condicion_medica:       Optional[int] = None
    terapia:                Optional[str] = None   # 'si' / 'no'
    red_apoyo:              Optional[int] = None
    valoracion_psicologica: Optional[int] = None
    nivel_estres:           Optional[int] = None
    principal_estresor:     Optional[int] = None

    # Señal
    valores_rojos:          List[float]   = []

    # Medición cardíaca
    bpm_camara:             Optional[float] = None
    bpm_manual:             Optional[int]   = None
    modo_medicion:          Optional[str]   = None

    # Castear strings numéricos a int en todos los campos int
    @model_validator(mode='before')
    @classmethod
    def castear_strings(cls, values):
        campos_int = [
            'genero', 'carrera', 'estatura', 'situacion_laboral', 'estado_civil',
            'vive_con', 'lugar_origen', 'tiene_hijos', 'comidas', 'cafe',
            'calidad_sueno', 'tipo_alimentacion', 'frecuencia_actividad',
            'consumo_alcohol', 'consumo_tabaco', 'cruza_frontera', 'tiempo_traslado',
            'tareas_pendientes', 'semestre', 'fuente_ingresos', 'condicion_medica',
            'red_apoyo', 'valoracion_psicologica', 'nivel_estres', 'principal_estresor',
            'bpm_manual',
        ]
        campos_float = ['peso', 'sueno', 'horas_actividad', 'bpm_camara']

        for campo in campos_int:
            val = values.get(campo)
            if val is not None and val != '':
                try:
                    values[campo] = int(float(str(val)))
                except (ValueError, TypeError):
                    values[campo] = None

        for campo in campos_float:
            val = values.get(campo)
            if val is not None and val != '':
                try:
                    values[campo] = float(str(val))
                except (ValueError, TypeError):
                    values[campo] = None

        # tipo_actividad: 'ninguna' → None, o castear a int
        ta = values.get('tipo_actividad')
        if ta in (None, '', 'ninguna'):
            values['tipo_actividad'] = None
        else:
            try:
                values['tipo_actividad'] = int(float(str(ta)))
            except (ValueError, TypeError):
                values['tipo_actividad'] = None

        # nivel_ingresos: 'usd' → 7, '0' → 0, resto → int
        ni = values.get('nivel_ingresos')
        if ni in (None, ''):
            values['nivel_ingresos'] = None
        elif str(ni) == 'usd':
            values['nivel_ingresos'] = 7
        else:
            try:
                values['nivel_ingresos'] = int(float(str(ni)))
            except (ValueError, TypeError):
                values['nivel_ingresos'] = None

        return values