const API_URL = '/api/medir';
const DURATION_SECONDS = 30;
const FPS = 30;

const state = {
  stream: null,
  interval: null,
  redValues: [],
  elapsedSeconds: 0
};

const elements = {
  button: document.getElementById('measure-button'),
  resetButton: document.getElementById('reset-button'),
  video: document.getElementById('video'),
  canvas: document.getElementById('capture-canvas'),
  placeholder: document.getElementById('placeholder'),
  preview: document.getElementById('camera-preview'),
  instructions: document.getElementById('instructions'),
  progressZone: document.getElementById('progress-zone'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  timeLeft: document.getElementById('time-left'),
  signalDots: document.getElementById('signal-dots'),
  result: document.getElementById('result'),
  bpmNumber: document.getElementById('bpm-number'),
  resultStatus: document.getElementById('result-status'),
  chart: document.getElementById('pulse-chart'),
  error: document.getElementById('error-message')
};

elements.button.addEventListener('click', startMeasurement);
elements.resetButton.addEventListener('click', resetMeasurement);

async function startMeasurement() {
  hideError();
  setButton('Iniciando camara...', true);

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    });

    elements.video.srcObject = state.stream;
    elements.video.style.display = 'block';
    elements.placeholder.style.display = 'none';
    elements.preview.classList.add('active');

    const flashEnabled = await enableTorch();
    if (!flashEnabled) {
      showFlashInstructions();
      return;
    }

    beginCapture();
  } catch {
    showError('No se pudo acceder a la camara. Revisa el permiso del navegador.');
    setButton('Intentar de nuevo', false);
  }
}

async function enableTorch() {
  try {
    const track = state.stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    if (capabilities.torch) {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function showFlashInstructions() {
  elements.instructions.style.display = 'none';
  showError('Si tu navegador no activa el flash automaticamente, enciende la linterna manualmente y vuelve aqui.');
  setButton('Ya active el flash', false);
  elements.button.removeEventListener('click', startMeasurement);
  elements.button.addEventListener('click', confirmManualFlash, { once: true });
}

function confirmManualFlash() {
  elements.button.addEventListener('click', startMeasurement);
  hideError();
  beginCapture();
}

function beginCapture() {
  elements.instructions.style.display = 'none';
  elements.progressZone.style.display = 'block';
  elements.signalDots.style.display = 'flex';
  elements.button.style.display = 'none';

  state.redValues = [];
  state.elapsedSeconds = 0;
  elements.progressFill.style.width = '0%';
  elements.timeLeft.textContent = String(DURATION_SECONDS);

  window.setTimeout(captureFrames, 500);
}

function captureFrames() {
  const context = elements.canvas.getContext('2d');
  const totalFrames = DURATION_SECONDS * FPS;
  let currentFrame = 0;

  state.interval = window.setInterval(() => {
    if (currentFrame >= totalFrames) {
      window.clearInterval(state.interval);
      processSignal();
      return;
    }

    context.drawImage(elements.video, 0, 0, 100, 100);
    const pixels = context.getImageData(0, 0, 100, 100).data;
    let redSum = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      redSum += pixels[i];
    }

    state.redValues.push(redSum / (pixels.length / 4));
    currentFrame += 1;

    if (currentFrame % FPS === 0) {
      state.elapsedSeconds += 1;
      const remaining = DURATION_SECONDS - state.elapsedSeconds;
      elements.timeLeft.textContent = String(remaining);
      elements.progressFill.style.width = `${(state.elapsedSeconds / DURATION_SECONDS) * 100}%`;
    }
  }, 1000 / FPS);
}

async function processSignal() {
  elements.progressZone.style.display = 'none';
  elements.signalDots.style.display = 'none';
  elements.result.style.display = 'block';
  elements.bpmNumber.textContent = '...';
  elements.resultStatus.textContent = 'Procesando senal...';
  stopCamera();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fps: FPS,
        valores_rojos: state.redValues
      })
    });

    const data = await response.json();

    if (!response.ok) {
      handleMeasurementError(data.detail);
      return;
    }

    elements.bpmNumber.textContent = data.bpm;
    elements.resultStatus.textContent = classifyBpm(data.bpm);
    drawChart(data.senal_debug);
    elements.resetButton.style.display = 'block';
  } catch {
    handleMeasurementError('GENERAL');
  }
}

function handleMeasurementError(code) {
  const messages = {
    SIN_DEDO: 'No detectamos tu dedo. Cubre completamente la camara y evita luz directa.',
    SENAL_INSUFICIENTE: 'La captura fue muy corta. Intenta de nuevo manteniendo la app abierta.',
    BUSCANDO_PULSO: 'No encontramos suficientes latidos. Mantente quieto y prueba otra vez.',
    ESTABILIZANDO_SENAL: 'La senal no fue estable. Apoya el celular en una superficie firme.',
    MUCHO_MOVIMIENTO_O_ARRITMIA: 'Detectamos movimiento o una senal irregular. Repite la medicion sin mover el dedo.',
    GENERAL: 'No se pudo calcular la frecuencia cardiaca. Intenta de nuevo con mejor iluminacion.'
  };

  elements.bpmNumber.textContent = '--';
  elements.resultStatus.textContent = 'Sin resultado';
  showError(messages[code] || messages.GENERAL);
  elements.resetButton.style.display = 'block';
}

function drawChart(signal) {
  if (!Array.isArray(signal) || signal.length < 2) return;

  elements.chart.style.display = 'block';
  const context = elements.chart.getContext('2d');
  const width = elements.chart.width;
  const height = elements.chart.height;
  const padding = 12;
  const min = Math.min(...signal);
  const max = Math.max(...signal);
  const range = max - min || 1;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#f8f4ef';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = 'rgba(45,27,14,0.06)';
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = (height / 4) * i;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.beginPath();
  context.strokeStyle = '#e63946';
  context.lineWidth = 2;
  context.lineJoin = 'round';

  signal.forEach((value, index) => {
    const x = (index / (signal.length - 1)) * width;
    const y = padding + (1 - (value - min) / range) * (height - padding * 2);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();
}

function classifyBpm(bpm) {
  if (bpm < 60) return 'Bradicardia (bajo)';
  if (bpm <= 100) return 'Rango normal';
  if (bpm <= 120) return 'Levemente elevado';
  return 'Taquicardia (alto)';
}

function resetMeasurement() {
  window.clearInterval(state.interval);
  stopCamera();
  state.redValues = [];
  state.elapsedSeconds = 0;

  elements.result.style.display = 'none';
  elements.error.style.display = 'none';
  elements.progressZone.style.display = 'none';
  elements.signalDots.style.display = 'none';
  elements.chart.style.display = 'none';
  elements.resetButton.style.display = 'none';
  elements.instructions.style.display = 'block';
  elements.progressFill.style.width = '0%';
  elements.timeLeft.textContent = String(DURATION_SECONDS);
  elements.preview.classList.remove('active');
  elements.video.style.display = 'none';
  elements.placeholder.style.display = 'flex';
  elements.button.style.display = 'block';
  setButton('Iniciar medicion', false);
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.style.display = 'block';
}

function hideError() {
  elements.error.textContent = '';
  elements.error.style.display = 'none';
}

function setButton(text, disabled) {
  elements.button.textContent = text;
  elements.button.disabled = disabled;
}
