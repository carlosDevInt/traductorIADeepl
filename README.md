# Traductor de documentos

Aplicación Astro + React para traducir documentos PDF, DOCX y XLSX con DeepL, conservar el archivo original y descargar la traducción desde la librería local.

## Configurar DeepL

Configura `DEEPL_AUTH_KEY` con una clave válida de DeepL API y usa `DEEPL_API_URL=https://api-free.deepl.com` para cuentas Free o `https://api.deepl.com` para cuentas Pro.

## Traducción de audio

La sección **Traducir audio** acepta grabaciones compatibles con el navegador (por ejemplo, MP3, WAV, M4A, OGG, WebM y FLAC) de hasta 100 MB. El audio se decodifica en el navegador y se envía como PCM mono de 16 kHz a DeepL Voice; la transcripción original y la traducción aparecen al terminar y la traducción se puede descargar como `.txt`.

DeepL Voice requiere una suscripción API de pago. La clave se usa únicamente desde `/api/voice`; no se envía al navegador. Configura `DEEPL_AUTH_KEY` con una clave Pro activa. La API de voz usa `https://api.deepl.com` incluso si `DEEPL_API_URL` conserva el endpoint Free para traducción de documentos.

## Chat IA

El asistente usa `gemini-3.5-flash-lite`, un modelo de baja latencia, para responder preguntas y resumir el historial de conversación. Cada intento espera hasta 60 segundos por una respuesta. Configura `GOOGLE_GENERATIVE_AI_API_KEY` en el `.env` local que ya usa el proyecto y reinicia el servidor. También puedes consultar `.env.example` para ver el nombre de la variable. No es necesario copiar ni publicar la clave.

La clave se lee únicamente en el endpoint de Astro, nunca se envía al navegador. Las conversaciones se guardan localmente para continuar el chat al volver; las solicitudes se envían a Gemini con `store: false`. No incluyas datos sensibles en una conversación.

## Desarrollo

```sh
npm install
npm run dev
```

Para publicar, configura las mismas variables privadas en el entorno del servidor. Las traducciones y el chat requieren conexión a Internet y credenciales activas de sus respectivos servicios.

## Almacenamiento y límites actuales

- Los metadatos de la librería y las tareas se guardan en `localStorage`; los archivos binarios se guardan en IndexedDB porque `localStorage` no puede almacenar documentos de hasta 100 MB.
- La librería es local a este navegador. Borrar sus datos elimina la copia guardada. No hay sincronización entre dispositivos todavía.
- La carga permite PDF, DOCX y XLSX de hasta 100 MB. El tamaño efectivo de traducción puede ser menor según los límites de DeepL y del proveedor de hosting.
- El estado se consulta en segundo plano mientras el sitio está abierto; las tareas se recuperan al volver a abrir la aplicación.
- La opción de compresión aparece deshabilitada hasta implementar compresión real por formato. No se simula una compresión que no se haya realizado.
- En la librería, **Abrir y leer** extrae texto de PDF, DOCX y XLSX en el navegador y permite leerlo con la voz del sistema; los PDF escaneados requieren OCR y no se pueden transcribir desde esta vista.
- En **Chat IA** se pueden adjuntar hasta 3 PDF, DOCX o XLSX por mensaje desde el botón o arrastrándolos a la ventana del chat. El texto se extrae en el navegador, se guarda con el historial local para mantener el contexto de la conversación y se envía a Gemini cuando envías el mensaje. Cada archivo tiene un límite de 20 MB y 30.000 caracteres extraídos; los PDF escaneados requieren OCR.
