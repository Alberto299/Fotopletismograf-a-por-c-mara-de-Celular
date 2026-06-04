from sqlalchemy import Column, Integer, Float, String, Enum, TIMESTAMP
from database import Base
from sqlalchemy.sql import func

class RespuestaEstudio(Base):
    __tablename__ = "respuestas_estudio"

    id                    = Column(Integer, primary_key=True, index=True)
    fecha_registro        = Column(TIMESTAMP, server_default=func.now())

    # Sección 1
    edad                  = Column(Integer)
    genero                = Column(Integer)
    carrera               = Column(Integer)
    estatura              = Column(Integer)
    peso                  = Column(Float)
    situacion_laboral     = Column(Integer)
    estado_civil          = Column(Integer)
    vive_con              = Column(Integer)
    lugar_origen          = Column(Integer)
    tiene_hijos           = Column(Integer)

    # Sección 2
    comidas               = Column(Integer)
    cafe                  = Column(Integer)
    sueno                 = Column(Float)
    calidad_sueno         = Column(Integer)
    tipo_alimentacion     = Column(Integer)
    actividad_fisica      = Column(Integer)
    tipo_actividad        = Column(Integer)
    horas_actividad       = Column(Float)
    frecuencia_actividad  = Column(Integer)
    consumo_alcohol       = Column(Integer)
    consumo_tabaco        = Column(Integer)
    cruza_frontera        = Column(Integer)
    tiempo_traslado       = Column(Integer)

    # Sección 3
    tareas_pendientes     = Column(Integer)
    semestre              = Column(Integer)
    nivel_ingresos        = Column(Integer)
    fuente_ingresos       = Column(Integer)
    antecedentes_cardiacos = Column(Integer)
    condicion_medica      = Column(Integer)
    terapia_psicologica   = Column(Integer)
    red_apoyo             = Column(Integer)
    estado_emocional      = Column(Integer)
    nivel_estres          = Column(Integer)
    principal_estresor    = Column(Integer)

    # Medición cardíaca
    bpm_camara            = Column(Float,   nullable=True)
    bpm_manual            = Column(Integer, nullable=True)
    modo_medicion         = Column(
        Enum('camara_ok', 'usuario_cancelo', 'solo_manual'),
        nullable=True
    )