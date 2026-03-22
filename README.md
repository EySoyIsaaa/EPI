# 🎵 Spotify Epicenter Player

Reproductor de música web optimizado para móvil vertical con procesamiento de audio DSP en tiempo real.

## ✨ Características Principales

### 🎧 Reproductor Completo
- **Interfaz estilo Spotify** con diseño Glassmorphism Nocturno
- **Carátulas de álbum** con efectos de glow
- **Controles de reproducción**: Play, Pause, Siguiente, Anterior
- **Barra de progreso** interactiva con búsqueda temporal
- **Información de pista**: Título, artista y duración

### 📋 Sistema de Colas
- **Cola de reproducción** con lista completa de canciones
- **Navegación entre pistas** con un solo toque
- **Indicador visual** de la canción actual
- **Soporte para múltiples archivos** (MP3, WAV, FLAC, OGG, M4A, AAC)

### 🎚️ Ecualizador de 12 Bandas
- **12 frecuencias ajustables**: 32Hz, 64Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 12kHz, 14kHz, 16kHz
- **Rango de ajuste**: -12dB a +12dB por banda
- **Switch de encendido/apagado** independiente
- **Botón de restablecimiento** para volver a valores por defecto
- **Visualización en tiempo real** de valores de ganancia

### 🔊 Epicenter DSP
- **Procesamiento de audio en tiempo real** basado en la patente US4698842 de AudioControl
- **Reconstrucción de bajos profundos** sin distorsión
- **5 parámetros ajustables**:
  - **SWEEP** (27-63 Hz): Frecuencia fundamental del efecto
  - **WIDTH** (0-100%): Ancho de banda del efecto
  - **INTENSITY** (0-100%): Intensidad de los bajos reconstruidos
  - **BALANCE** (0-100%): Balance entre voz y bajos
  - **VOLUMEN** (0-150%): Control de volumen general
- **Switch de encendido/apagado** independiente

## 🎨 Diseño

El reproductor utiliza el estilo **Glassmorphism Nocturno** con las siguientes características:

- **Capas translúcidas** con efectos de blur intenso
- **Gradientes oscuros** (violeta #8B5CF6 y cyan #06B6D4)
- **Animaciones fluidas** con transiciones de 400ms
- **Efectos de glow** en elementos activos
- **Optimizado para móvil vertical** (portrait mode)

## 🚀 Cómo Usar

### 1. Cargar Música
- Haz clic en el botón de **Upload** (icono de subida) en la esquina superior derecha
- Selecciona uno o varios archivos de audio desde tu dispositivo
- Los archivos se agregarán automáticamente a la cola de reproducción

### 2. Reproducir
- La primera canción comenzará a reproducirse automáticamente
- Usa los botones de **Play/Pause** para controlar la reproducción
- Usa los botones de **Siguiente/Anterior** para navegar entre canciones
- Arrastra la **barra de progreso** para buscar en la canción

### 3. Gestionar la Cola
- Ve a la pestaña **Cola** para ver todas las canciones cargadas
- Toca cualquier canción para reproducirla inmediatamente
- La canción actual se resalta con un borde brillante

### 4. Ajustar el Ecualizador
- Ve a la pestaña **EQ** para acceder al ecualizador de 12 bandas
- Mueve los sliders verticales para ajustar cada frecuencia
- Usa el **switch** en la parte superior para activar/desactivar el ecualizador
- Presiona **Restablecer** para volver todos los valores a 0dB

### 5. Configurar el Epicenter DSP
- Ve a la pestaña **DSP** para acceder al procesador Epicenter
- Ajusta los parámetros según tu preferencia:
  - **SWEEP**: Controla la frecuencia de los bajos generados
  - **WIDTH**: Ajusta el ancho de banda del efecto
  - **INTENSITY**: Controla la intensidad de los bajos
  - **BALANCE**: Mezcla entre voz y bajos
  - **VOLUMEN**: Ajusta el volumen general
- Usa el **switch** para activar/desactivar el efecto Epicenter

## 🔧 Arquitectura Técnica

### Stack Tecnológico
- **Frontend**: React 19 + Vite + TailwindCSS 4
- **Audio Processing**: Web Audio API + AudioWorklet
- **Routing**: Wouter
- **UI Components**: shadcn/ui con Radix UI
- **Styling**: TailwindCSS con tema personalizado

### Cadena de Procesamiento de Audio
```
AudioElement → Epicenter Worklet → Ecualizador (12 filtros biquad) → Destination
```

1. **AudioElement**: Carga y reproduce el archivo de audio
2. **Epicenter Worklet**: Procesa el audio con el algoritmo DSP en tiempo real
3. **Ecualizador**: Aplica filtros de 12 bandas para ajuste de frecuencias
4. **Destination**: Salida final al sistema de audio

### Componentes Principales

- **`useIntegratedAudioProcessor`**: Hook que integra Epicenter DSP + Ecualizador
- **`useAudioQueue`**: Hook para gestionar la cola de reproducción
- **`Home.tsx`**: Componente principal con toda la interfaz
- **`epicenter-worklet.ts`**: AudioWorklet con el algoritmo DSP

## 📱 Compatibilidad

- ✅ **Navegadores móviles**: Chrome, Safari, Firefox (Android/iOS)
- ✅ **Navegadores de escritorio**: Chrome, Firefox, Edge, Safari
- ✅ **Formatos de audio**: MP3, WAV, FLAC, OGG, M4A, AAC

## 🎯 Características Técnicas

### Epicenter DSP
- **Algoritmo basado en patente US4698842** de AudioControl
- **Procesamiento sin latencia** usando AudioWorklet
- **Prevención de denormales** para máxima estabilidad
- **Soft clipping** para prevenir distorsión
- **Actualización de parámetros en tiempo real** sin pausar la reproducción

### Ecualizador
- **12 filtros biquad** (lowshelf, peaking, highshelf)
- **Rango de frecuencias**: 32Hz a 16kHz
- **Ajuste fino**: Pasos de 0.5dB
- **Activación/desactivación sin glitches**

## 🔮 Próximas Mejoras Sugeridas

- [ ] Visualizador de espectro en tiempo real
- [ ] Presets guardados de ecualizador y DSP
- [ ] Drag & drop para reordenar la cola
- [ ] Modo de reproducción aleatoria y repetición
- [ ] Extracción de carátulas de archivos MP3
- [ ] Soporte para listas de reproducción M3U/PLS
- [ ] Integración con servicios de streaming

## 📄 Licencia

Este proyecto es una adaptación web del procesador Epicenter DSP original. Respeta la patente US4698842 de AudioControl.

---

**Versión**: 1.2.0  
**Última actualización**: 30 Enero 2025  
**Estado**: ✅ Producción

📋 **Para ver el historial completo de cambios, actualizaciones y documentación técnica, consulta [CHANGELOG.md](./CHANGELOG.md)**
