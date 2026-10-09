export type DocumentStatus = 'queued' | 'processing' | 'done' | 'error';
export type DocumentFileKind = 'original' | 'translated';
export type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
    attachments?: Array<{ name: string; content: string }>;
};

export type TranslationDocument = {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    sourceLanguage: string;
    targetLanguage: string;
    compress: boolean;
    status: DocumentStatus;
    createdAt: number;
    error?: string;
    remoteJob?: { documentId: string; documentKey: string };
};

export type RejectedDocument = {
    name: string;
    reason: string;
};

export const LANGUAGES = [
    { code: 'es', label: 'Español' },
    { code: 'en', label: 'Inglés' },
    { code: 'fr', label: 'Francés' },
    { code: 'de', label: 'Alemán' },
    { code: 'it', label: 'Italiano' },
    { code: 'pt', label: 'Portugués' },
    { code: 'ja', label: 'Japonés' },
    { code: 'zh', label: 'Chino' },
];

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx']);
const STORAGE_KEY = 'traductor-documentos:v1';
const CHAT_STORAGE_KEY = 'traductor-chat:v1';
const DATABASE_NAME = 'traductor-documentos';
const FILE_STORE = 'files';

export function addDocuments(
    files: FileList | File[],
    existingDocuments: TranslationDocument[],
    sourceLanguage: string,
    targetLanguage: string,
    compress: boolean,
): { accepted: Array<{ document: TranslationDocument; file: File }>; rejected: RejectedDocument[] } {
    const existingFiles = new Set(
        existingDocuments.map(({ name, size }) => `${name}:${size}`),
    );
    const accepted: Array<{ document: TranslationDocument; file: File }> = [];
    const rejected: RejectedDocument[] = [];

    for (const file of Array.from(files)) {
        const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        const fileKey = `${file.name}:${file.size}`;

        if (!SUPPORTED_EXTENSIONS.has(extension)) {
            rejected.push({ name: file.name, reason: 'Formato no compatible. Usa PDF, DOCX o XLSX.' });
        } else if (file.size > MAX_FILE_SIZE) {
            rejected.push({ name: file.name, reason: 'El archivo supera el máximo de 100 MB.' });
        } else if (existingFiles.has(fileKey)) {
            rejected.push({ name: file.name, reason: 'Este archivo ya está en la librería.' });
        } else {
            const id = crypto.randomUUID();
            existingFiles.add(fileKey);
            accepted.push({
                document: {
                    id,
                    name: file.name,
                    size: file.size,
                    mimeType: file.type || 'application/octet-stream',
                    sourceLanguage,
                    targetLanguage,
                    compress,
                    status: 'queued',
                    createdAt: Date.now(),
                },
                file,
            });
        }
    }

    return { accepted, rejected };
}

export function loadDocuments(): TranslationDocument[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) throw new Error('El contenido guardado no tiene el formato esperado.');
        return parsed as TranslationDocument[];
    } catch (error) {
        throw new Error(
            `No se pudo leer la librería local: ${error instanceof Error ? error.message : 'error desconocido'}`,
        );
    }
}

export function saveDocuments(documents: TranslationDocument[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
    } catch (error) {
        throw new Error(
            `No se pudo guardar la librería local: ${error instanceof Error ? error.message : 'error desconocido'}`,
        );
    }
}

export function loadChatMessages(): ChatMessage[] {
    try {
        const stored = localStorage.getItem(CHAT_STORAGE_KEY);
        if (!stored) return [];
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) throw new Error('El contenido del chat no tiene el formato esperado.');
        return parsed as ChatMessage[];
    } catch (error) {
        throw new Error(
            `No se pudo leer el chat guardado: ${error instanceof Error ? error.message : 'error desconocido'}`,
        );
    }
}

export function saveChatMessages(messages: ChatMessage[]): void {
    try {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch (error) {
        throw new Error(
            `No se pudo guardar el chat: ${error instanceof Error ? error.message : 'error desconocido'}`,
        );
    }
}

function openFileDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(FILE_STORE)) {
                request.result.createObjectStore(FILE_STORE, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacenamiento local.'));
    });
}

async function storeBlob(id: string, kind: DocumentFileKind, blob: Blob): Promise<void> {
    const database = await openFileDatabase();
    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(FILE_STORE, 'readwrite');
        transaction.objectStore(FILE_STORE).put({ key: `${id}:${kind}`, blob });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el archivo.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Se canceló el guardado del archivo.'));
    }).finally(() => database.close());
}

async function readBlob(id: string, kind: DocumentFileKind): Promise<Blob | undefined> {
    const database = await openFileDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(FILE_STORE, 'readonly');
        const request = transaction.objectStore(FILE_STORE).get(`${id}:${kind}`);
        request.onsuccess = () => resolve(request.result?.blob as Blob | undefined);
        request.onerror = () => reject(request.error ?? new Error('No se pudo leer el archivo.'));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error('No se pudo leer el archivo.'));
        };
    });
}

export const saveOriginalFile = (id: string, file: File) => storeBlob(id, 'original', file);
export const saveTranslatedFile = (id: string, file: Blob) => storeBlob(id, 'translated', file);
export const getDocumentFile = (id: string, kind: DocumentFileKind) => readBlob(id, kind);

export async function deleteDocumentFiles(id: string): Promise<void> {
    const database = await openFileDatabase();
    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(FILE_STORE, 'readwrite');
        transaction.objectStore(FILE_STORE).delete(`${id}:original`);
        transaction.objectStore(FILE_STORE).delete(`${id}:translated`);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('No se pudieron eliminar los archivos.'));
    }).finally(() => database.close());
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function translatedFileName(name: string, language: string): string {
    const extensionIndex = name.lastIndexOf('.');
    const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
    const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
    return `${stem}-${language}${extension}`;
}
