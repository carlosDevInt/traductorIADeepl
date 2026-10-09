import { useCallback, useEffect, useRef, useState } from 'react';
import {
    addDocuments,
    deleteDocumentFiles,
    getDocumentFile,
    loadChatMessages,
    loadDocuments,
    saveChatMessages,
    saveDocuments,
    saveOriginalFile,
    saveTranslatedFile,
    translatedFileName,
    type DocumentFileKind,
    type ChatMessage,
    type RejectedDocument,
    type TranslationDocument,
} from '../Model/TraducModel';
import { extractDocumentText } from '../Model/DocumentText';
import TraducView, { type TraducViewProps } from '../View/TraducView';

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

async function responseError(response: Response): Promise<string> {
    try {
        const body = await response.json() as { error?: string };
        return body.error ?? `Error del servidor (${response.status}).`;
    } catch {
        return `Error del servidor (${response.status}).`;
    }
}

function TraducController() {
    const [documents, setDocuments] = useState<TranslationDocument[]>([]);
    const [rejectedDocuments, setRejectedDocuments] = useState<RejectedDocument[]>([]);
    const [sourceLanguage, setSourceLanguage] = useState('es');
    const [targetLanguage, setTargetLanguage] = useState('en');
    const [compress, setCompress] = useState(false);
    const [activeSection, setActiveSection] = useState<'translate' | 'voice' | 'library' | 'chats'>('translate');
    const [storageError, setStorageError] = useState<string>();
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatError, setChatError] = useState<string>();
    const [readerDocument, setReaderDocument] = useState<{ document: TranslationDocument; file: Blob }>();
    const documentsRef = useRef<TranslationDocument[]>([]);
    const chatMessagesRef = useRef<ChatMessage[]>([]);
    const activeJobs = useRef(new Set<string>());

    const commitDocuments = useCallback((nextDocuments: TranslationDocument[]) => {
        documentsRef.current = nextDocuments;
        setDocuments(nextDocuments);
        try {
            saveDocuments(nextDocuments);
            setStorageError(undefined);
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : 'No se pudo guardar la librería.');
        }
    }, []);

    const updateDocument = useCallback((id: string, update: (document: TranslationDocument) => TranslationDocument) => {
        commitDocuments(documentsRef.current.map((document) => document.id === id ? update(document) : document));
    }, [commitDocuments]);

    const commitChatMessages = useCallback((nextMessages: ChatMessage[]) => {
        chatMessagesRef.current = nextMessages;
        setChatMessages(nextMessages);
        try {
            saveChatMessages(nextMessages);
            setChatError(undefined);
        } catch (error) {
            setChatError(error instanceof Error ? error.message : 'No se pudo guardar la conversación.');
        }
    }, []);

    const pollTranslation = useCallback(async (id: string, remoteJob: NonNullable<TranslationDocument['remoteJob']>) => {
        if (activeJobs.current.has(id)) return;
        activeJobs.current.add(id);
        try {
            for (;;) {
                await delay(2500);
                const response = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'status', ...remoteJob }),
                });
                if (!response.ok) throw new Error(await responseError(response));

                const result = await response.json() as { status?: string; message?: string; error_message?: string };
                if (result.status === 'done') {
                    const downloadResponse = await fetch('/api/translate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'download', ...remoteJob }),
                    });
                    if (!downloadResponse.ok) throw new Error(await responseError(downloadResponse));
                    await saveTranslatedFile(id, await downloadResponse.blob());
                    updateDocument(id, (document) => ({ ...document, status: 'done', error: undefined }));
                    return;
                }
                if (result.status === 'error') {
                    throw new Error(result.message ?? result.error_message ?? 'DeepL no pudo traducir este documento.');
                }
                if (!['queued', 'translating'].includes(result.status ?? '')) {
                    throw new Error(`DeepL devolvió un estado inesperado: ${result.status ?? 'vacío'}.`);
                }
            }
        } catch (error) {
            updateDocument(id, (document) => ({
                ...document,
                status: 'error',
                error: error instanceof Error ? error.message : 'Error inesperado al traducir.',
            }));
        } finally {
            activeJobs.current.delete(id);
        }
    }, [updateDocument]);

    useEffect(() => {
        try {
            const restored = loadDocuments().map((document) =>
                document.status === 'processing' && !document.remoteJob
                    ? { ...document, status: 'queued' as const }
                    : document,
            );
            documentsRef.current = restored;
            setDocuments(restored);
            saveDocuments(restored);
            for (const document of restored) {
                if (document.status === 'processing' && document.remoteJob) {
                    void pollTranslation(document.id, document.remoteJob);
                }
            }
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : 'No se pudo recuperar la librería local.');
        }
        try {
            const savedMessages = loadChatMessages();
            chatMessagesRef.current = savedMessages;
            setChatMessages(savedMessages);
        } catch (error) {
            setChatError(error instanceof Error ? error.message : 'No se pudo recuperar el chat local.');
        }
    }, [pollTranslation]);

    const handleFilesSelected: TraducViewProps['onFilesSelected'] = async (files) => {
        const result = addDocuments(files, documentsRef.current, sourceLanguage, targetLanguage, compress);
        const saved: TranslationDocument[] = [];
        const rejected = [...result.rejected];

        for (const item of result.accepted) {
            try {
                await saveOriginalFile(item.document.id, item.file);
                saved.push(item.document);
            } catch (error) {
                rejected.push({
                    name: item.file.name,
                    reason: error instanceof Error ? error.message : 'No se pudo guardar el archivo en este dispositivo.',
                });
            }
        }
        if (saved.length > 0) commitDocuments([...documentsRef.current, ...saved]);
        setRejectedDocuments(rejected);
    };

    const handleStartTranslation = async (id: string) => {
        const document = documentsRef.current.find((item) => item.id === id);
        if (!document || activeJobs.current.has(id)) return;

        updateDocument(id, (item) => ({ ...item, status: 'processing', error: undefined }));
        try {
            const original = await getDocumentFile(id, 'original');
            if (!original) throw new Error('No se encontró el documento original en el almacenamiento local.');

            const form = new FormData();
            form.set('file', original, document.name);
            form.set('source_lang', document.sourceLanguage);
            form.set('target_lang', document.targetLanguage);
            const response = await fetch('/api/translate', { method: 'POST', body: form });
            if (!response.ok) throw new Error(await responseError(response));

            const remoteJob = await response.json() as { documentId: string; documentKey: string };
            updateDocument(id, (item) => ({ ...item, remoteJob }));
            void pollTranslation(id, remoteJob);
        } catch (error) {
            updateDocument(id, (item) => ({
                ...item,
                status: 'error',
                error: error instanceof Error ? error.message : 'No se pudo iniciar la traducción.',
            }));
        }
    };

    const handleDownload = async (id: string, kind: DocumentFileKind) => {
        const document = documentsRef.current.find((item) => item.id === id);
        if (!document) return;
        try {
            const blob = await getDocumentFile(id, kind);
            if (!blob) throw new Error('El archivo no está disponible en el almacenamiento local.');
            const filename = kind === 'original'
                ? document.name
                : translatedFileName(document.name, document.targetLanguage);
            const url = URL.createObjectURL(blob);
            const link = window.document.createElement('a');
            link.href = url;
            link.download = filename;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : 'No se pudo descargar el documento.');
        }
    };

    const handleOpenDocument = async (id: string) => {
        const document = documentsRef.current.find((item) => item.id === id);
        if (!document) return;
        try {
            const file = await getDocumentFile(id, 'original');
            if (!file) throw new Error('No se encontró el documento en el almacenamiento local.');
            setReaderDocument({ document, file });
            setStorageError(undefined);
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : 'No se pudo abrir el documento.');
        }
    };

    const handleCloseReader = useCallback(() => setReaderDocument(undefined), []);

    const handleRemoveDocument = async (id: string) => {
        try {
            await deleteDocumentFiles(id);
            commitDocuments(documentsRef.current.filter((document) => document.id !== id));
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : 'No se pudo quitar el documento.');
        }
    };

    const handleSendChat: TraducViewProps['onSendChat'] = async (message, action = 'chat', files = []) => {
        if (chatLoading) return false;
        const trimmed = message.trim();
        if (action === 'chat' && !trimmed && files.length === 0) return false;
        if (action === 'summary' && chatMessagesRef.current.length === 0) return false;

        setChatLoading(true);
        setChatError(undefined);
        const supportedExtensions = new Set(['.pdf', '.docx', '.xlsx']);
        const attachments: NonNullable<ChatMessage['attachments']> = [];
        let totalAttachmentTextLength = 0;
        try {
            for (const file of files) {
                const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
                if (!supportedExtensions.has(extension)) throw new Error(`${file.name}: usa PDF, DOCX o XLSX.`);
                if (file.size === 0) throw new Error(`${file.name}: el archivo está vacío.`);
                if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: el máximo para el chat es 20 MB.`);

                const content = await extractDocumentText(file, file.name);
                if (!content.trim()) throw new Error(`${file.name}: no se encontró texto legible. Los PDF escaneados requieren OCR.`);
                if (content.length > 30_000) throw new Error(`${file.name}: su texto supera el máximo de 30.000 caracteres.`);
                totalAttachmentTextLength += content.length;
                if (totalAttachmentTextLength > 60_000) {
                    throw new Error('El texto total adjunto supera el máximo de 60.000 caracteres por mensaje.');
                }
                attachments.push({ name: file.name, content });
            }
        } catch (error) {
            setChatError(error instanceof Error ? error.message : 'No se pudieron leer los documentos adjuntos.');
            setChatLoading(false);
            return false;
        }

        const userMessage: ChatMessage | undefined = action === 'chat'
            ? {
                id: crypto.randomUUID(),
                role: 'user',
                content: trimmed || 'Revisa los documentos adjuntos y ayúdame con su contenido.',
                createdAt: Date.now(),
                attachments: attachments.length > 0 ? attachments : undefined,
            }
            : undefined;
        const conversation = userMessage
            ? [...chatMessagesRef.current, userMessage]
            : chatMessagesRef.current;
        if (conversation.length === 0) return false;

        if (userMessage) commitChatMessages(conversation);
        setChatLoading(true);
        setChatError(undefined);
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    messages: conversation.slice(-24).map(({ role, content, attachments: messageAttachments }) => ({
                        role,
                        content,
                        ...(messageAttachments ? { attachments: messageAttachments } : {}),
                    })),
                }),
            });
            if (!response.ok) throw new Error(await responseError(response));
            const result = await response.json() as { answer?: string };
            if (!result.answer) throw new Error('Gemini devolvió una respuesta vacía.');
            commitChatMessages([
                ...chatMessagesRef.current,
                { id: crypto.randomUUID(), role: 'assistant', content: result.answer, createdAt: Date.now() },
            ]);
            return true;
        } catch (error) {
            setChatError(error instanceof Error ? error.message : 'No se pudo obtener una respuesta de Gemini.');
            return false;
        } finally {
            setChatLoading(false);
        }
    };

    const handleClearChat = () => commitChatMessages([]);

    const handleSwapLanguages = () => {
        setSourceLanguage(targetLanguage);
        setTargetLanguage(sourceLanguage);
    };

    return (
        <TraducView
            documents={documents}
            rejectedDocuments={rejectedDocuments}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            compress={compress}
            activeSection={activeSection}
            storageError={storageError}
            chatMessages={chatMessages}
            chatLoading={chatLoading}
            chatError={chatError}
            onSourceLanguageChange={setSourceLanguage}
            onTargetLanguageChange={setTargetLanguage}
            onSwapLanguages={handleSwapLanguages}
            onCompressChange={setCompress}
            onFilesSelected={handleFilesSelected}
            onSendChat={handleSendChat}
            onClearChat={handleClearChat}
            onStartTranslation={handleStartTranslation}
            onDownload={handleDownload}
            onOpenDocument={(id) => void handleOpenDocument(id)}
            readerDocument={readerDocument}
            onCloseReader={handleCloseReader}
            onRemoveDocument={(id) => void handleRemoveDocument(id)}
            onSectionChange={setActiveSection}
            onDismissRejection={(index) => setRejectedDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
        />
    );
}

export default TraducController;
