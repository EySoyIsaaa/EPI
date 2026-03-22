# Epicenter Hi-Fi

Reproductor local de música con enfoque móvil, biblioteca persistente, ecualizador de 31 bandas, procesador Epicenter y soporte para archivos en alta resolución.

## Resumen
Epicenter Hi-Fi está diseñado para reproducir y organizar música local con procesamiento de audio en tiempo real. La app prioriza biblioteca local, controles rápidos, reproducción continua y ajuste fino del sonido.

## Funciones principales
- Biblioteca local persistente con importación manual de archivos.
- Escaneo de música del dispositivo en Android mediante MediaStore.
- Playlists locales y cola de reproducción editable.
- Ecualizador gráfico de 31 bandas.
- Procesador Epicenter con controles de Sweep, Width, Intensity, Balance y Volume.
- Detección y sección dedicada para pistas High Resolution.
- Crossfade configurable entre canciones.
- Controles de reproducción en segundo plano y metadatos para notificaciones.
- Interfaz bilingüe en español e inglés.

## Formatos soportados
- MP3
- WAV
- FLAC
- M4A / AAC
- OGG (según disponibilidad del origen)

## Tecnologías
- React 19
- Vite
- TypeScript
- Tailwind CSS
- Web Audio API
- AudioWorklet
- Capacitor Android
- IndexedDB

## Flujo de audio
`Audio source -> Epicenter processor -> 31-band equalizer -> output`

## Uso básico
1. Importa música desde archivos locales o escanea el dispositivo en Android.
2. Reproduce una canción desde la biblioteca, artistas, álbumes o playlists.
3. Ajusta el ecualizador y el procesador según tu preferencia.
4. Activa crossfade si quieres transiciones suaves entre pistas.
5. Usa la sección High Resolution para localizar rápidamente audio compatible.

## Estructura mínima del proyecto
- `client/`: interfaz, audio, hooks y componentes.
- `server/`: servidor Express/tRPC para servir la aplicación.
- `shared/`: utilidades y tipos compartidos.
- `android/`: contenedor Android con Capacitor y plugin nativo para MediaStore.

## Scripts
- `pnpm dev`: entorno de desarrollo.
- `pnpm build`: compilación de frontend y servidor.
- `pnpm test`: pruebas con Vitest.
- `pnpm check`: validación TypeScript.

## Producto
Este repositorio contiene la versión privada del producto. Mantén la documentación alineada con la funcionalidad real y evita dejar archivos de soporte o handoff dentro de la raíz del proyecto.
