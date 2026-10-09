import type { APIRoute } from 'astro';

export const prerender = false;

const VOICE_API_URL = 'https://api.deepl.com/v3/voice/realtime';
const SUPPORTED_VOICE_LANGUAGES = new Set(['de', 'en', 'es', 'fr', 'it', 'ja', 'pt', 'zh']);
const SOURCE_MEDIA_CONTENT_TYPE = 'audio/pcm;encoding=s16le;rate=16000';

type DeepLError = { message?: string; detail?: string };

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function getApiKey(): string {
    const apiKey = import.meta.env.DEEPL_AUTH_KEY ?? process.env.DEEPL_AUTH_KEY;
    if (!apiKey) throw new Error('Falta configurar DEEPL_AUTH_KEY en las variables privadas del servidor.');
    return apiKey;
}

async function readDeepLError(response: Response): Promise<DeepLError> {
    try {
        return await response.json() as DeepLError;
    } catch {
        return { message: 'DeepL no pudo procesar la solicitud.' };
    }
}

function errorMessage(body: DeepLError, status: number): string {
    if (status === 456) return 'Se agotó la cuota de Voice API de DeepL para esta cuenta.';
    if (status === 401 || status === 403) {
        return 'DeepL rechazó la clave o el acceso a Voice API. Se requiere una suscripción API de pago.';
    }
    return body.message ?? body.detail ?? `DeepL respondió con el estado ${status}.`;
}

export const POST: APIRoute = async ({ request }) => {
    let body: { sourceLanguage?: unknown; targetLanguage?: unknown };
    try {
        body = await request.json();
    } catch {
        return json({ error: 'La solicitud no contiene JSON válido.' }, 400);
    }

    const { sourceLanguage, targetLanguage } = body;
    if (
        typeof sourceLanguage !== 'string'
        || typeof targetLanguage !== 'string'
        || !SUPPORTED_VOICE_LANGUAGES.has(sourceLanguage)
        || !SUPPORTED_VOICE_LANGUAGES.has(targetLanguage)
    ) {
        return json({ error: 'Selecciona idiomas compatibles con DeepL Voice.' }, 400);
    }
    if (sourceLanguage === targetLanguage) {
        return json({ error: 'El idioma de origen y el de destino deben ser diferentes.' }, 400);
    }

    try {
        const response = await fetch(VOICE_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `DeepL-Auth-Key ${getApiKey()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                source_media_content_type: SOURCE_MEDIA_CONTENT_TYPE,
                source_language: sourceLanguage,
                source_language_mode: 'fixed',
                target_languages: [targetLanguage],
                message_format: 'json',
            }),
        });

        if (!response.ok) {
            const traceId = response.headers.get('X-Trace-ID');
            console.warn('DeepL Voice session creation failed', { status: response.status, traceId });
            return json({ error: errorMessage(await readDeepLError(response), response.status) }, response.status);
        }

        const result = await response.json() as { streaming_url?: unknown; token?: unknown };
        if (typeof result.streaming_url !== 'string' || typeof result.token !== 'string') {
            throw new Error('DeepL devolvió datos incompletos para iniciar la sesión de voz.');
        }

        const streamingUrl = new URL(result.streaming_url);
        if (
            streamingUrl.protocol !== 'wss:'
            || streamingUrl.hostname !== 'api.deepl.com'
            || streamingUrl.pathname !== '/v3/voice/realtime/connect'
        ) {
            throw new Error('DeepL devolvió una dirección de streaming no válida.');
        }

        return json({ streamingUrl: streamingUrl.toString(), token: result.token });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error inesperado al iniciar la traducción de audio.';
        const status = message.startsWith('Falta configurar') ? 503 : 502;
        return json({ error: message }, status);
    }
};
