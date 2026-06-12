# 🐺 Hombres Lobos de Castronegro

Juego multijugador en tiempo real (Express + Socket.io). Crea una sala, comparte el código y juega con amigos desde el móvil o el navegador.

## Ejecutar en local

```bash
npm install
npm start
```

Abre http://localhost:3000

## Desplegar en Render (gratis)

> Nota: este juego usa Socket.io (WebSockets persistentes), por lo que **no es compatible con Vercel**. Render o Railway sí lo soportan.

1. Sube este repo a GitHub:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/hombres-lobos.git
   git push -u origin main
   ```
2. Entra en [render.com](https://render.com) → **New → Web Service**.
3. Conecta tu repo de GitHub. Render detecta `render.yaml` automáticamente.
4. Pulsa **Deploy**. En unos minutos tendrás una URL pública.

En el plan gratuito de Render el servidor se duerme tras 15 min de inactividad; la primera visita después tarda ~30 s en arrancar.

### Alternativa: Railway

1. Entra en [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
2. Selecciona el repo. Railway detecta Node y usa `npm start` automáticamente.

## Estructura

```
server.js        # Servidor Express + lógica del juego (Socket.io)
public/
  index.html     # Cliente (interfaz del juego)
render.yaml      # Configuración de despliegue en Render
```
