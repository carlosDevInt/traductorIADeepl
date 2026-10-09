import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
    type ChatMessage,
    formatFileSize,
    LANGUAGES,
    type DocumentFileKind,
    type RejectedDocument,
    type TranslationDocument,
} from '../Model/TraducModel';
import VoiceReadController from '../Controller/VoiceReadControlller';
import DocumentReader from '../Controller/DocumentReader';
import './TraducView.css';

export type TraducViewProps = {
    documents: TranslationDocument[];
    chatMessages: ChatMessage[];
    chatLoading: boolean;
    chatError?: string;
    rejectedDocuments: RejectedDocument[];
    sourceLanguage: string;
    targetLanguage: string;
    compress: boolean;
    activeSection: 'translate' | 'voice' | 'library' | 'chats';
    storageError?: string;
    onSourceLanguageChange: (language: string) => void;
    onTargetLanguageChange: (language: string) => void;
    onSwapLanguages: () => void;
    onCompressChange: (compress: boolean) => void;
    onFilesSelected: (files: FileList | File[]) => void;
    onSendChat: (message: string, action?: 'chat' | 'summary', attachments?: File[]) => Promise<boolean>;
    onClearChat: () => void;
    onStartTranslation: (id: string) => void;
    onDownload: (id: string, kind: DocumentFileKind) => void;
    onOpenDocument: (id: string) => void;
    readerDocument?: { document: TranslationDocument; file: Blob };
    onCloseReader: () => void;
    onRemoveDocument: (id: string) => void;
    onSectionChange: (section: 'translate' | 'voice' | 'library' | 'chats') => void;
    onDismissRejection: (index: number) => void;
};

const languageName = (code: string) =>
    LANGUAGES.find((language) => language.code === code)?.label ?? code;

const TraducView: React.FC<TraducViewProps> = ({
    documents,
    chatMessages,
    chatLoading,
    chatError,
    rejectedDocuments,
    sourceLanguage,
    targetLanguage,
    compress,
    activeSection,
    storageError,
    onSourceLanguageChange,
    onTargetLanguageChange,
    onSwapLanguages,
    onCompressChange,
    onFilesSelected,
    onSendChat,
    onClearChat,
    onStartTranslation,
    onDownload,
    onOpenDocument,
    readerDocument,
    onCloseReader,
    onRemoveDocument,
    onSectionChange,
    onDismissRejection,
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const chatFileInputRef = useRef<HTMLInputElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isChatDragging, setIsChatDragging] = useState(false);
    const [chatAttachments, setChatAttachments] = useState<File[]>([]);
    const [chatAttachmentError, setChatAttachmentError] = useState<string>();
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const isLibrary = activeSection === 'library';
    const isChat = activeSection === 'chats';
    const isVoice = activeSection === 'voice';
    const [chatInput, setChatInput] = useState('');
    const processingCount = documents.filter((document) => document.status === 'processing').length;

    useEffect(() => {
        const savedTheme = localStorage.getItem('traduc-theme');
        if (savedTheme === 'light' || savedTheme === 'dark') {
            setTheme(savedTheme);
            return;
        }

        setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }, []);

    const toggleTheme = () => {
        const nextTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(nextTheme);
        localStorage.setItem('traduc-theme', nextTheme);
    };

    const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
        event.preventDefault();
        setIsDragging(false);
        onFilesSelected(event.dataTransfer.files);
    };

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [chatMessages, chatLoading, isChat]);

    const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if ((!chatInput.trim() && chatAttachments.length === 0) || chatLoading) return;
        const message = chatInput.trim() || 'Revisa los documentos adjuntos y ayúdame con su contenido.';
        const sent = await onSendChat(message, 'chat', chatAttachments);
        if (sent) {
            setChatInput('');
            setChatAttachments([]);
            setChatAttachmentError(undefined);
            if (chatFileInputRef.current) chatFileInputRef.current.value = '';
        }
    };

    const handleChatFiles = (files: FileList | File[]) => {
        const supportedExtensions = new Set(['.pdf', '.docx', '.xlsx']);
        const maxFileSize = 20 * 1024 * 1024;
        const accepted: File[] = [];
        const rejected: string[] = [];
        const next = [...chatAttachments];

        for (const file of Array.from(files)) {
            const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
            if (!supportedExtensions.has(extension)) {
                rejected.push(`${file.name}: usa PDF, DOCX o XLSX.`);
            } else if (file.size === 0) {
                rejected.push(`${file.name}: el archivo está vacío.`);
            } else if (file.size > maxFileSize) {
                rejected.push(`${file.name}: el máximo es 20 MB por archivo.`);
            } else {
                if (next.some((item) => item.name === file.name && item.size === file.size)) continue;
                if (next.length >= 3) {
                    rejected.push('Puedes adjuntar hasta 3 documentos por mensaje.');
                    break;
                }
                accepted.push(file);
                next.push(file);
            }
        }

        if (accepted.length > 0) setChatAttachments(next);
        setChatAttachmentError(rejected.length ? rejected.join(' ') : undefined);
    };

    const clearChat = () => {
        onClearChat();
        setChatAttachments([]);
        setChatAttachmentError(undefined);
        if (chatFileInputRef.current) chatFileInputRef.current.value = '';
    };

    return (
        <main className="traduc-app" data-theme={theme}>
            <aside className="traduc-sidebar">
                <a className="traduc-brand" href="/" aria-label="Traductor de documentos, inicio">
                    <span className="traduc-brand-mark" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M5 5.5h8.5v13H5zM13.5 8.5H19v10h-5.5" />
                            <path d="M8 9h2.5M8 12h2.5M15.5 12h1.5M15.5 15h1.5" />
                        </svg>
                    </span>
                    <span>Traductor de<br />documentos</span>
                </a>

                <nav className="traduc-nav" aria-label="Navegación principal">
                    <button
                        className={`traduc-nav-item${activeSection === 'translate' ? ' is-active' : ''}`}
                        onClick={() => onSectionChange('translate')}
                        type="button"
                    >
                        <svg className="traduc-nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="8.5" />
                            <path d="M3.8 12h16.4M12 3.5c2.1 2.3 3.1 5.1 3.1 8.5s-1 6.2-3.1 8.5c-2.1-2.3-3.1-5.1-3.1-8.5s1-6.2 3.1-8.5Z" />
                        </svg>
                        Traducir
                    </button>
                    <button
                        className={`traduc-nav-item${isVoice ? ' is-active' : ''}`}
                        onClick={() => onSectionChange('voice')}
                        type="button"
                    >
                        <span aria-hidden="true">♫</span>
                        Traducir audio
                    </button>
                    <button
                        className={`traduc-nav-item${isLibrary ? ' is-active' : ''}`}
                        onClick={() => onSectionChange('library')}
                        type="button"
                    >
                        <svg className="traduc-nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M5 4.5h12a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2v-13Z" />
                            <path d="M5 17.5a2 2 0 0 1 2-2h12M9 8h6M9 11h6" />
                        </svg>
                        Librería
                        <span className="traduc-count">{documents.length}</span>
                    </button>
                    <button
                        className={`traduc-nav-item${activeSection === 'chats' ? ' is-active' : ''}`}
                        onClick={() => onSectionChange('chats')}
                        type="button"
                    >
                        <svg className="traduc-nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
                            <path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
                        </svg>
                        Chat IA
                    </button>
                </nav>

                <button
                    className="traduc-theme-toggle"
                    type="button"
                    onClick={toggleTheme}
                    aria-label={`Cambiar a tema ${theme === 'light' ? 'oscuro' : 'claro'}`}
                    title={`Cambiar a tema ${theme === 'light' ? 'oscuro' : 'claro'}`}
                >
                    {theme === 'light' ? (
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M20.2 15.1A8.4 8.4 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />
                            <path d="M16.5 3v4M14.5 5h4" />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="4" />
                            <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                        </svg>
                    )}
                    <span>Tema {theme === 'light' ? 'oscuro' : 'claro'}</span>
                    <span className="traduc-theme-state">{theme === 'light' ? 'Claro' : 'Oscuro'}</span>
                </button>

                <p className="traduc-sidebar-note">
                    Tus documentos se guardan en este navegador y están disponibles al volver.
                </p>
            </aside>

            <section className="traduc-main">
                <header className="traduc-heading">
                    <h1>{isChat ? 'Chat IA' : isLibrary ? 'Librería de documentos' : isVoice ? 'Traducir audio' : 'Traducir documentos'}</h1>
                    <p>
                        {isChat
                            ? 'Conversa, resuelve dudas y resume tus ideas con Gemini.'
                            : isVoice
                                ? 'Transcribe y traduce tus grabaciones de audio con DeepL Voice.'
                                : 'PDF, Word y Excel. DeepL conserva el formato del documento durante la traducción.'}
                    </p>
                </header>

                {storageError && !isChat && !isVoice && (
                    <p className="traduc-storage-error" role="alert">{storageError}</p>
                )}
                {chatError && isChat && (
                    <p className="traduc-storage-error" role="alert">{chatError}</p>
                )}

                {!isLibrary && !isChat && !isVoice && (
                    <section className="traduc-upload-panel" aria-label="Opciones para traducir">
                        <div className="traduc-controls">
                            <div className="traduc-language-controls">
                                <label className="traduc-visually-hidden" htmlFor="traduc-source">Idioma de origen</label>
                                <select
                                    id="traduc-source"
                                    value={sourceLanguage}
                                    onChange={(event) => onSourceLanguageChange(event.target.value)}
                                >
                                    {LANGUAGES.map((language) => (
                                        <option key={language.code} value={language.code}>{language.label}</option>
                                    ))}
                                </select>
                                <button className="traduc-swap" type="button" onClick={onSwapLanguages} aria-label="Intercambiar idiomas">
                                    ⇄
                                </button>
                                <label className="traduc-visually-hidden" htmlFor="traduc-target">Idioma de destino</label>
                                <select
                                    id="traduc-target"
                                    value={targetLanguage}
                                    onChange={(event) => onTargetLanguageChange(event.target.value)}
                                >
                                    {LANGUAGES.map((language) => (
                                        <option key={language.code} value={language.code}>{language.label}</option>
                                    ))}
                                </select>
                            </div>

                            <label className="traduc-compress traduc-compress-disabled" title="La compresión previa aún no está disponible para la traducción de documentos de DeepL.">
                                <input
                                    type="checkbox"
                                    checked={compress}
                                    onChange={(event) => onCompressChange(event.target.checked)}
                                    disabled
                                />
                                <span>Comprimir antes de traducir (próximamente)</span>
                            </label>
                        </div>

                        <input
                            ref={inputRef}
                            className="traduc-visually-hidden"
                            type="file"
                            accept=".pdf,.docx,.xlsx"
                            multiple
                            onChange={(event) => {
                                if (event.currentTarget.files) onFilesSelected(event.currentTarget.files);
                                event.currentTarget.value = '';
                            }}
                        />
                        <label
                            className={`traduc-dropzone${isDragging ? ' is-dragging' : ''}`}
                            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                            onDragOver={(event) => event.preventDefault()}
                            onDragLeave={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
                            }}
                            onDrop={handleDrop}
                            onClick={() => inputRef.current?.click()}
                        >
                            <span className="traduc-drop-title">Arrastra tus documentos aquí o haz clic para elegir</span>
                            <span className="traduc-drop-caption">.pdf · .docx · .xlsx — máximo 100 MB por archivo</span>
                        </label>

                        {rejectedDocuments.length > 0 && (
                            <ul className="traduc-errors" aria-live="polite">
                                {rejectedDocuments.map((rejection, index) => (
                                    <li key={`${rejection.name}-${index}`}>
                                        <span><strong>{rejection.name}:</strong> {rejection.reason}</span>
                                        <button type="button" onClick={() => onDismissRejection(index)} aria-label={`Cerrar error de ${rejection.name}`}>×</button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                )}

                {isChat ? (
                    <section
                        className={`traduc-chat-shell${isChatDragging ? ' is-dragging' : ''}`}
                        aria-label="Asistente de chat"
                        onDragEnter={(event) => {
                            if (event.dataTransfer.types.includes('Files')) {
                                event.preventDefault();
                                setIsChatDragging(true);
                            }
                        }}
                        onDragOver={(event) => {
                            if (event.dataTransfer.types.includes('Files')) event.preventDefault();
                        }}
                        onDragLeave={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                setIsChatDragging(false);
                            }
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            setIsChatDragging(false);
                            handleChatFiles(event.dataTransfer.files);
                        }}
                    >
                        {isChatDragging && (
                            <div className="traduc-chat-drop-overlay" aria-live="polite">
                                Suelta aquí tus documentos PDF, DOCX o XLSX
                            </div>
                        )}
                        <div className="traduc-chat-toolbar">
                            <div className="traduc-chat-assistant">
                                <span className="traduc-ai-avatar" aria-hidden="true">✦</span>
                                <span><strong>Asistente Gemini</strong><small>Con Gemini · historial guardado localmente</small></span>
                            </div>
                            <div className="traduc-chat-tools">
                                <button
                                    type="button"
                                    className="traduc-chat-tool"
                                    onClick={() => onSendChat('', 'summary')}
                                    disabled={chatLoading || chatMessages.length === 0}
                                >
                                    Resumir chat
                                </button>
                                <button
                                    type="button"
                                    className="traduc-chat-tool"
                                    onClick={clearChat}
                                    disabled={chatLoading || chatMessages.length === 0}
                                >
                                    Nuevo chat
                                </button>
                            </div>
                        </div>

                        <div className="traduc-chat-messages" aria-live="polite">
                            {chatMessages.length === 0 ? (
                                <div className="traduc-chat-welcome">
                                    <span className="traduc-welcome-orb" aria-hidden="true">✦</span>
                                    <h2>¿En qué puedo ayudarte?</h2>
                                    <p>Haz una pregunta, explora una idea o pide un resumen de esta conversación.</p>
                                    <div className="traduc-chat-suggestions">
                                        <button type="button" onClick={() => onSendChat('¿Qué puedes hacer por mí?')} disabled={chatLoading}>
                                            ¿Qué puedes hacer?
                                        </button>
                                        <button type="button" onClick={() => onSendChat('Dame consejos para organizar y traducir mis documentos.')} disabled={chatLoading}>
                                            Consejos para mis documentos
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                chatMessages.map((message) => (
                                    <article className={`traduc-chat-message traduc-chat-${message.role}`} key={message.id}>
                                        {message.role === 'assistant' && <span className="traduc-message-avatar" aria-hidden="true">✦</span>}
                                        <div className="traduc-message-content">
                                            <span className="traduc-message-author">{message.role === 'user' ? 'Tú' : 'Gemini'}</span>
                                            {message.attachments && message.attachments.length > 0 && (
                                                <div className="traduc-chat-message-attachments">
                                                    {message.attachments.map((attachment) => (
                                                        <span key={`${message.id}-${attachment.name}`}>▤ {attachment.name}</span>
                                                    ))}
                                                </div>
                                            )}
                                            <p>{message.content}</p>
                                        </div>
                                    </article>
                                ))
                            )}
                            {chatLoading && (
                                <div className="traduc-chat-message traduc-chat-assistant-message" role="status">
                                    <span className="traduc-message-avatar" aria-hidden="true">✦</span>
                                    <div className="traduc-message-content">
                                        <span className="traduc-message-author">Gemini está pensando</span>
                                        <span className="traduc-thinking-dots"><i /><i /><i /></span>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        <form className={`traduc-chat-form${chatAttachments.length ? ' has-attachments' : ''}`} onSubmit={handleChatSubmit}>
                            <input
                                ref={chatFileInputRef}
                                className="traduc-visually-hidden"
                                type="file"
                                accept=".pdf,.docx,.xlsx"
                                multiple
                                disabled={chatLoading}
                                onChange={(event) => {
                                    if (event.currentTarget.files) handleChatFiles(event.currentTarget.files);
                                    event.currentTarget.value = '';
                                }}
                            />
                            {chatAttachments.length > 0 && (
                                <div className="traduc-chat-attachments" aria-label="Documentos adjuntos">
                                    {chatAttachments.map((attachment) => (
                                        <span className="traduc-chat-attachment" key={`${attachment.name}-${attachment.size}`}>
                                            <span aria-hidden="true">▤</span>
                                            <span>{attachment.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => setChatAttachments((current) => current.filter((item) => item !== attachment))}
                                                aria-label={`Quitar ${attachment.name}`}
                                                disabled={chatLoading}
                                            >
                                                ×
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                            <textarea
                                value={chatInput}
                                onChange={(event) => setChatInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        event.currentTarget.form?.requestSubmit();
                                    }
                                }}
                                placeholder="Escribe tu pregunta..."
                                aria-label="Mensaje para Gemini"
                                rows={1}
                                maxLength={8000}
                                disabled={chatLoading}
                            />
                            <button
                                type="button"
                                className="traduc-chat-attach"
                                onClick={() => chatFileInputRef.current?.click()}
                                disabled={chatLoading}
                                aria-label="Adjuntar documentos"
                                title="Adjuntar PDF, DOCX o XLSX"
                            >
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="m20.5 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l9.2-9.2a3.3 3.3 0 0 1 4.7 4.7l-9.2 9.2a1.7 1.7 0 0 1-2.4-2.4l8.2-8.2" />
                                </svg>
                            </button>
                            <button type="submit" className="traduc-chat-send" disabled={chatLoading || (!chatInput.trim() && chatAttachments.length === 0)} aria-label="Enviar mensaje">
                                ↑
                            </button>
                            <small className={chatAttachmentError ? 'has-error' : undefined} role={chatAttachmentError ? 'alert' : undefined}>
                                {chatAttachmentError || 'Adjunta hasta 3 PDF, DOCX o XLSX · máximo 20 MB c/u. Gemini procesa su texto.'}
                            </small>
                        </form>
                    </section>
                ) : isVoice ? (
                    <VoiceReadController
                        sourceLanguage={sourceLanguage}
                        targetLanguage={targetLanguage}
                        onSourceLanguageChange={onSourceLanguageChange}
                        onTargetLanguageChange={onTargetLanguageChange}
                    />
                ) : (
                <section className="traduc-processing" aria-live="polite">
                    <h2>
                        {isLibrary ? 'Documentos de esta sesión' : 'Procesamiento'}
                        {processingCount > 0 && <span className="traduc-processing-count">{processingCount} en curso</span>}
                    </h2>
                    {documents.length === 0 ? (
                        <div className="traduc-empty">
                            {isLibrary
                                ? 'Todavía no hay documentos en tu librería.'
                                : 'Tus documentos aparecerán aquí cuando los agregues.'}
                        </div>
                    ) : (
                        <ul className="traduc-document-list">
                            {documents.map((document) => (
                                <li className="traduc-document-card" key={document.id}>
                                    <div className="traduc-document-info">
                                        <span className="traduc-file-icon" aria-hidden="true">
                                            {document.name.toLowerCase().endsWith('.pdf') ? 'PDF' : document.name.toLowerCase().endsWith('.docx') ? 'DOC' : 'XLS'}
                                        </span>
                                        <div className="traduc-file-details">
                                            <span className="traduc-file-name">{document.name}</span>
                                            <span className="traduc-file-meta">
                                                {languageName(document.sourceLanguage)} → {languageName(document.targetLanguage)} · {formatFileSize(document.size)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="traduc-document-status">
                                        <span className={`traduc-status traduc-status-${document.status}`}>
                                            {document.status === 'queued' && 'En cola'}
                                            {document.status === 'processing' && <><span className="traduc-spinner" />Procesando en segundo plano</>}
                                            {document.status === 'done' && 'Traducción lista'}
                                            {document.status === 'error' && 'Error'}
                                        </span>
                                        <button
                                            type="button"
                                            className="traduc-remove"
                                            onClick={() => onRemoveDocument(document.id)}
                                            aria-label={`Quitar ${document.name}`}
                                        >
                                            ×
                                        </button>
                                    </div>
                                    {document.error && <p className="traduc-document-error" role="alert">{document.error}</p>}
                                    <div className="traduc-document-actions">
                                        {isLibrary && (
                                            <button
                                                type="button"
                                                className="traduc-action-secondary traduc-read-document"
                                                onClick={() => onOpenDocument(document.id)}
                                                aria-label={`Abrir y leer ${document.name}`}
                                                title="Abrir y leer documento"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                    <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
                                                    <circle cx="12" cy="12" r="2.7" />
                                                </svg>
                                                <span>Abrir y leer</span>
                                            </button>
                                        )}
                                        <button type="button" className="traduc-action-secondary" onClick={() => onDownload(document.id, 'original')}>
                                            Descargar original
                                        </button>
                                        {document.status === 'done' && (
                                            <button type="button" className="traduc-action-primary" onClick={() => onDownload(document.id, 'translated')}>
                                                Descargar traducido
                                            </button>
                                        )}
                                        {(document.status === 'queued' || document.status === 'error') && (
                                            <button type="button" className="traduc-action-primary" onClick={() => onStartTranslation(document.id)}>
                                                {document.status === 'error' ? 'Reintentar traducción' : 'Traducir documento'}
                                            </button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
                )}
            </section>

            {readerDocument && (
                <DocumentReader
                    document={readerDocument.document}
                    file={readerDocument.file}
                    onClose={onCloseReader}
                />
            )}

        </main>
    );
};

export default TraducView;
