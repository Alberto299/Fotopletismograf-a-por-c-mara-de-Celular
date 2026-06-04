# AVResolutions Heart Rate

Aplicacion web para medir frecuencia cardiaca por fotopletismografia usando la camara del dispositivo.

## Estructura

- `public/index.html`: interfaz principal.
- `public/css/styles.css`: estilos de la aplicacion.
- `public/js/app.js`: captura de camara, control de UI y llamadas al API.
- `src/server.js`: servidor Node.js y endpoints HTTP.
- `python/heart_rate.py`: procesamiento PPG con NumPy/SciPy.

## Ejecutar

```bash
pip install -r requirements.txt
npm start
```

Luego abre `http://localhost:3000`.

> La camara del navegador requiere HTTPS o `localhost`. En un celular real, sirve la app con HTTPS o usa una configuracion local segura.
