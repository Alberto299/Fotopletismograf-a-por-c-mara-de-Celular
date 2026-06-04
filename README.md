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

## Camara en red local

La camara del navegador requiere un origen seguro. Esto significa:

- En la misma computadora funciona con `http://localhost:3000`.
- Desde otro dispositivo en la red, `http://IP-DE-TU-PC:3000` puede abrir la pagina, pero el navegador bloqueara la camara por no ser HTTPS.

Opciones para probar desde celular u otra computadora:

1. Servir la app con HTTPS usando un certificado local confiable.
2. Usar un tunel HTTPS temporal, por ejemplo ngrok o Cloudflare Tunnel.
3. En Chrome/Android para pruebas, habilitar la bandera `Insecure origins treated as secure` y agregar `http://IP-DE-TU-PC:3000`.

Para una demo real, usa HTTPS. Es una restriccion del navegador, no del codigo de la app.
