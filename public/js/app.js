const API_URL = '/api/medir';
const FPS = 30;
const MIN_CAPTURE_SECONDS = 4;
const MAX_CAPTURE_SECONDS = 45;
const ANALYSIS_INTERVAL_MS = 1200;
const REQUIRED_PEAKS = 5;

const state = {
  stream: null,
  captureInterval: null,
  analysisTimeout: null,
  redValues: [],
  isCapturing: false,
  isAnalyzing: false
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
  peakCount: document.getElementById('peak-count'),
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

  if (!canUseCameraHere()) {
    showError(cameraAccessMessage());
    setButton('Intentar de nuevo', false);
    return;
  }

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
  } catch (error) {
    showError(cameraAccessMessage(error));
    setButton('Intentar de nuevo', false);
  }
}

function canUseCameraHere() {
  return window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
}

function cameraAccessMessage(error = null) {
  if (!window.isSecureContext) {
    return 'La camara esta bloqueada porque abriste la app por HTTP desde la red local. Los navegadores solo permiten camara en localhost o HTTPS. Usa http://localhost:3000 en esta computadora, o sirve la app con HTTPS para abrirla desde otro celular/computadora.';
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'Este navegador no expone acceso a camara en esta pagina. Prueba con Chrome/Edge actualizado o abre la app en HTTPS.';
  }

  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'El navegador nego el permiso de camara. Revisa el candado de la barra de direcciones y permite la camara para este sitio.';
  }

  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
    return 'No encontramos una camara compatible. Si estas en una laptop, prueba desde un celular con camara trasera.';
  }

  return 'No se pudo acceder a la camara. Revisa el permiso del navegador.';
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
  elements.resetButton.style.display = 'none';
  elements.result.style.display = 'none';
  elements.chart.style.display = 'none';

  state.redValues = [];
  state.isCapturing = true;
  state.isAnalyzing = false;
  updatePeakProgress(0, 'Capturando senal...');

  window.setTimeout(() => {
    captureFrames();
    scheduleAnalysis();
  }, 500);
}

function captureFrames() {
  const context = elements.canvas.getContext('2d');

  state.captureInterval = window.setInterval(() => {
    if (!state.isCapturing) return;

    context.drawImage(elements.video, 0, 0, 100, 100);
    const pixels = context.getImageData(0, 0, 100, 100).data;
    let redSum = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      redSum += pixels[i];
    }

    state.redValues.push(redSum / (pixels.length / 4));
  }, 1000 / FPS);
}

function scheduleAnalysis() {
  window.clearTimeout(state.analysisTimeout);
  state.analysisTimeout = window.setTimeout(analyzeCurrentSignal, ANALYSIS_INTERVAL_MS);
}

async function analyzeCurrentSignal() {
  if (!state.isCapturing || state.isAnalyzing) return;

  const capturedSeconds = state.redValues.length / FPS;
  if (capturedSeconds < MIN_CAPTURE_SECONDS) {
    scheduleAnalysis();
    return;
  }

  if (capturedSeconds > MAX_CAPTURE_SECONDS) {
    finishWithError('GENERAL');
    return;
  }

  state.isAnalyzing = true;

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

    if (response.ok) {
      finishWithSuccess(data);
      return;
    }

    updateFeedback(data.detail, data.picos_detectados || 0);
  } catch {
    updateFeedback('GENERAL', 0);
  } finally {
    state.isAnalyzing = false;
  }

  if (state.isCapturing) scheduleAnalysis();
}

function finishWithSuccess(data) {
  state.isCapturing = false;
  window.clearInterval(state.captureInterval);
  window.clearTimeout(state.analysisTimeout);
  stopCamera();

  updatePeakProgress(REQUIRED_PEAKS, '5 latidos estables detectados');
  elements.progressZone.style.display = 'none';
  elements.signalDots.style.display = 'none';
  elements.result.style.display = 'block';
  elements.bpmNumber.textContent = data.bpm;
  elements.resultStatus.textContent = classifyBpm(data.bpm);
  drawChart(data.senal_debug);
  elements.resetButton.style.display = 'block';
  elements.preview.classList.remove('active');
  elements.video.style.display = 'none';
  elements.placeholder.style.display = 'flex';
}

function finishWithError(code) {
  state.isCapturing = false;
  window.clearInterval(state.captureInterval);
  window.clearTimeout(state.analysisTimeout);
  stopCamera();

  elements.progressZone.style.display = 'none';
  elements.signalDots.style.display = 'none';
  elements.result.style.display = 'block';
  elements.bpmNumber.textContent = '--';
  elements.resultStatus.textContent = 'Sin resultado';
  handleMeasurementError(code);
  elements.preview.classList.remove('active');
  elements.video.style.display = 'none';
  elements.placeholder.style.display = 'flex';
}

function updateFeedback(code, peaksDetected) {
  const messages = {
    SIN_DEDO: 'Esperando dedo...',
    SENAL_INSUFICIENTE: 'Capturando senal...',
    BUSCANDO_PULSO: 'Buscando latidos...',
    ESTABILIZANDO_SENAL: 'Validando ritmo...',
    MUCHO_MOVIMIENTO_O_ARRITMIA: 'Ritmo inestable, no te muevas...',
    GENERAL: 'Analizando senal...'
  };

  updatePeakProgress(peaksDetected, messages[code] || messages.GENERAL);
}

function updatePeakProgress(peaksDetected, text) {
  const peaks = Math.min(Math.max(Number(peaksDetected) || 0, 0), REQUIRED_PEAKS);
  elements.progressText.textContent = text;
  elements.peakCount.textContent = `${peaks}/${REQUIRED_PEAKS}`;
  elements.progressFill.style.width = `${(peaks / REQUIRED_PEAKS) * 100}%`;
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
  state.isCapturing = false;
  state.isAnalyzing = false;
  window.clearInterval(state.captureInterval);
  window.clearTimeout(state.analysisTimeout);
  stopCamera();
  state.redValues = [];

  elements.result.style.display = 'none';
  elements.error.style.display = 'none';
  elements.progressZone.style.display = 'none';
  elements.signalDots.style.display = 'none';
  elements.chart.style.display = 'none';
  elements.resetButton.style.display = 'none';
  elements.instructions.style.display = 'block';
  elements.progressFill.style.width = '0%';
  elements.peakCount.textContent = `0/${REQUIRED_PEAKS}`;
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
