const API_URL = '/api/medir';
const FPS = 30;
const WARMUP_SECONDS = 5;
const MIN_CAPTURE_SECONDS = 4;
const MAX_SIGNAL_SECONDS = 20;
const LIVE_CHART_SECONDS = 10;
const ANALYSIS_INTERVAL_MS = 1000;
const REQUIRED_PEAKS = 5;

const state = {
  stream: null,
  captureInterval: null,
  analysisTimeout: null,
  animationFrame: null,
  redValues: [],
  totalSamples: 0,
  isCapturing: false,
  isAnalyzing: false,
  lastBpm: null,
  lastDebugSignal: null
};

const elements = {
  button: document.getElementById('measure-button'),
  stopButton: document.getElementById('stop-button'),
  resetButton: document.getElementById('reset-button'),
  video: document.getElementById('video'),
  canvas: document.getElementById('capture-canvas'),
  liveChart: document.getElementById('live-chart'),
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
elements.stopButton.addEventListener('click', stopMeasurement);
elements.resetButton.addEventListener('click', resetMeasurement);
setStopButtonVisible(false);

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
  elements.liveChart.style.display = 'block';
  elements.result.style.display = 'block';
  elements.button.style.display = 'none';
  setStopButtonVisible(true);
  elements.resetButton.style.display = 'none';
  elements.chart.style.display = 'none';

  state.redValues = [];
  state.totalSamples = 0;
  state.lastBpm = null;
  state.lastDebugSignal = null;
  state.isCapturing = true;
  state.isAnalyzing = false;
  elements.bpmNumber.textContent = '--';
  elements.resultStatus.textContent = 'Estabilizando senal...';
  updatePeakProgress(0, `Ignorando primeros ${WARMUP_SECONDS} s...`);

  window.setTimeout(() => {
    captureFrames();
    drawLiveSignal();
    scheduleAnalysis();
  }, 500);
}

function captureFrames() {
  const context = elements.canvas.getContext('2d');
  const maxSamples = MAX_SIGNAL_SECONDS * FPS;

  state.captureInterval = window.setInterval(() => {
    if (!state.isCapturing) return;

    context.drawImage(elements.video, 0, 0, 100, 100);
    const pixels = context.getImageData(0, 0, 100, 100).data;
    let redSum = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      redSum += pixels[i];
    }

    state.totalSamples += 1;
    if (state.totalSamples <= WARMUP_SECONDS * FPS) {
      const remainingWarmup = Math.ceil(((WARMUP_SECONDS * FPS) - state.totalSamples) / FPS);
      updatePeakProgress(0, `Estabilizando senal... ${remainingWarmup} s`);
      return;
    }

    state.redValues.push(redSum / (pixels.length / 4));
    if (state.redValues.length > maxSamples) {
      state.redValues.splice(0, state.redValues.length - maxSamples);
    }
  }, 1000 / FPS);
}

function drawLiveSignal() {
  if (!state.isCapturing) return;

  const samples = state.redValues.slice(-LIVE_CHART_SECONDS * FPS);
  drawSignalOnCanvas(elements.liveChart, samples, {
    stroke: '#e63946',
    fill: 'rgba(230,57,70,0.08)',
    label: `Senal en vivo - ultimos ${LIVE_CHART_SECONDS} s`
  });

  state.animationFrame = window.requestAnimationFrame(drawLiveSignal);
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
      state.lastBpm = data.bpm;
      state.lastDebugSignal = data.senal_debug || state.lastDebugSignal;
      elements.bpmNumber.textContent = data.bpm;
      elements.resultStatus.textContent = classifyBpm(data.bpm);
      updatePeakProgress(REQUIRED_PEAKS, '5 latidos estables detectados');
    } else {
      updateFeedback(data.detail, data.picos_detectados || 0);
    }
  } catch {
    updateFeedback('GENERAL', 0);
  } finally {
    state.isAnalyzing = false;
  }

  if (state.isCapturing) scheduleAnalysis();
}

function stopMeasurement() {
  state.isCapturing = false;
  state.isAnalyzing = false;
  window.clearInterval(state.captureInterval);
  window.clearTimeout(state.analysisTimeout);
  window.cancelAnimationFrame(state.animationFrame);
  stopCamera();

  elements.progressZone.style.display = 'none';
  elements.signalDots.style.display = 'none';
  setStopButtonVisible(false);
  elements.resetButton.style.display = 'block';
  elements.preview.classList.remove('active');
  elements.video.style.display = 'none';
  elements.placeholder.style.display = 'flex';

  if (state.lastBpm) {
    elements.resultStatus.textContent = `${classifyBpm(state.lastBpm)} - medicion detenida`;
    drawSignalOnCanvas(elements.chart, state.lastDebugSignal || state.redValues.slice(-LIVE_CHART_SECONDS * FPS), {
      stroke: '#e63946',
      fill: 'rgba(230,57,70,0.08)',
      label: 'Senal final'
    });
    elements.chart.style.display = 'block';
  } else {
    elements.bpmNumber.textContent = '--';
    elements.resultStatus.textContent = 'Medicion detenida sin FC estable';
    showError('No se alcanzaron 5 latidos estables antes de detener la medicion.');
  }
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
  if (!state.lastBpm) {
    elements.resultStatus.textContent = messages[code] || messages.GENERAL;
  }
}

function updatePeakProgress(peaksDetected, text) {
  const peaks = Math.min(Math.max(Number(peaksDetected) || 0, 0), REQUIRED_PEAKS);
  elements.progressText.textContent = text;
  elements.peakCount.textContent = `${peaks}/${REQUIRED_PEAKS}`;
  elements.progressFill.style.width = `${(peaks / REQUIRED_PEAKS) * 100}%`;
}

function drawSignalOnCanvas(canvas, signal, options = {}) {
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const padding = 12;
  const stroke = options.stroke || '#e63946';
  const fill = options.fill || 'transparent';
  const label = options.label || '';

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

  if (!Array.isArray(signal) || signal.length < 2) {
    drawChartLabel(context, label || 'Esperando senal...', width);
    return;
  }

  const min = Math.min(...signal);
  const max = Math.max(...signal);
  const range = max - min || 1;

  context.beginPath();
  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.lineJoin = 'round';

  signal.forEach((value, index) => {
    const x = (index / (signal.length - 1)) * width;
    const y = padding + (1 - (value - min) / range) * (height - padding * 2);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  drawChartLabel(context, label, width);
}

function drawChartLabel(context, label, width) {
  if (!label) return;
  context.fillStyle = 'rgba(92,61,46,0.55)';
  context.font = '10px DM Mono, monospace';
  context.fillText(label, 8, 14, width - 16);
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
  state.lastBpm = null;
  state.lastDebugSignal = null;
  state.totalSamples = 0;
  window.clearInterval(state.captureInterval);
  window.clearTimeout(state.analysisTimeout);
  window.cancelAnimationFrame(state.animationFrame);
  stopCamera();
  state.redValues = [];

  elements.result.style.display = 'none';
  elements.error.style.display = 'none';
  elements.progressZone.style.display = 'none';
  elements.signalDots.style.display = 'none';
  elements.liveChart.style.display = 'none';
  elements.chart.style.display = 'none';
  setStopButtonVisible(false);
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

function setStopButtonVisible(isVisible) {
  elements.stopButton.hidden = !isVisible;
  elements.stopButton.style.display = isVisible ? 'block' : 'none';
}
