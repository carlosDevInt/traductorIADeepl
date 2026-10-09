import type { APIRoute } from 'astro';

export const prerender = false;

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx']);
const API_BASE_URL = import.meta.env.DEEPL_API_URL ?? process.env.DEEPL_API_URL ?? 'https://api-free.deepl.com';

type DeepLError = { message?: string; detail?: string };

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

function errorMessage(body: DeepLError, status: number): string {
    if (status === 456) return 'Se agotó la cuota de traducción de DeepL para esta cuenta.';
    if (status === 403 || status === 401) return 'DeepL rechazó la clave API. Revisa la configuración del servidor.';
    return body.message ?? body.detail ?? `DeepL respondió con el estado ${status}.`;
}

async function readDeepLError(response: Response): Promise<DeepLError> {
    try {
        return await response.json() as DeepLError;
    } catch {
        return { message: 'DeepL no pudo procesar la solicitud.' };
    }
}

function requireApiKey(): string {
    const apiKey = import.meta.env.DEEPL_AUTH_KEY ?? process.env.DEEPL_AUTH_KEY;
    if (!apiKey) throw new Error('Falta configurar DEEPL_AUTH_KEY en las variables privadas del servidor.');
    return apiKey;
}

function deepLUrl(path: string): string {
    if (!['https://api-free.deepl.com', 'https://api.deepl.com'].includes(API_BASE_URL)) {
        throw new Error('DEEPL_API_URL debe ser https://api-free.deepl.com o https://api.deepl.com.');
    }
    return `${API_BASE_URL}${path}`;
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const apiKey = requireApiKey();
        const contentType = request.headers.get('content-type') ?? '';

        if (contentType.includes('multipart/form-data')) {
            const form = await request.formData();
            const uploadedFile = form.get('file');
            const targetLanguage = form.get('target_lang');
            const sourceLanguage = form.get('source_lang');

            if (!(uploadedFile instanceof File) || typeof targetLanguage !== 'string') {
                return json({ error: 'Selecciona un archivo y un idioma de destino.' }, 400);
            }
            if (uploadedFile.size === 0) return json({ error: 'El archivo está vacío.' }, 400);
            if (uploadedFile.size > MAX_FILE_SIZE) return json({ error: 'El archivo supera el límite de 100 MB.' }, 413);

            const extension = uploadedFile.name.slice(uploadedFile.name.lastIndexOf('.')).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(extension)) {
                return json({ error: 'Formato no compatible. Usa PDF, DOCX o XLSX.' }, 415);
            }

            const deepLForm = new FormData();
            deepLForm.set('file', uploadedFile, uploadedFile.name);
            deepLForm.set('target_lang', targetLanguage.toUpperCase());
            if (typeof sourceLanguage === 'string' && sourceLanguage !== 'auto') {
                deepLForm.set('source_lang', sourceLanguage.toUpperCase());
            }

            const response = await fetch(deepLUrl('/v2/document'), {
                method: 'POST',
                headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
                body: deepLForm,
            });
            if (!response.ok) {
                const traceId = response.headers.get('X-Trace-ID');
                console.warn('DeepL document upload failed', { status: response.status, traceId });
                return json({ error: errorMessage(await readDeepLError(response), response.status) }, response.status);
            }
            const result = await response.json() as { document_id: string; document_key: string };
            return json({ documentId: result.document_id, documentKey: result.document_key });
        }

        const body = await request.json() as {
            action?: string;
            documentId?: string;
            documentKey?: string;
        };
        if (!body.documentId || !body.documentKey) {
            return json({ error: 'Faltan los datos de la tarea de traducción.' }, 400);
        }

        const safeDocumentId = encodeURIComponent(body.documentId);
        const deeplForm = new FormData();
        deeplForm.set('document_key', body.documentKey);

        if (body.action === 'status') {
            const response = await fetch(deepLUrl(`/v2/document/${safeDocumentId}`), {
                method: 'POST',
                headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
                body: deeplForm,
            });
            if (!response.ok) {
                const traceId = response.headers.get('X-Trace-ID');
                console.warn('DeepL document status failed', { status: response.status, traceId });
                return json({ error: errorMessage(await readDeepLError(response), response.status) }, response.status);
            }
            return json(await response.json());
        }

        if (body.action === 'download') {
            const response = await fetch(deepLUrl(`/v2/document/${safeDocumentId}/result`), {
                method: 'POST',
                headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
                body: deeplForm,
            });
            if (!response.ok) {
                const traceId = response.headers.get('X-Trace-ID');
                console.warn('DeepL document download failed', { status: response.status, traceId });
                return json({ error: errorMessage(await readDeepLError(response), response.status) }, response.status);
            }
            return new Response(await response.arrayBuffer(), {
                headers: {
                    'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
                    'Cache-Control': 'no-store',
                },
            });
        }

        return json({ error: 'Acción de traducción desconocida.' }, 400);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error inesperado al procesar la traducción.';
        const status = message.startsWith('Falta configurar') ? 503 : 500;
        return json({ error: message }, status);
    }
};
