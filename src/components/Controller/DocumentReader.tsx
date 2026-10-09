import { useEffect, useRef, useState } from 'react';
import type { TranslationDocument } from '../Model/TraducModel';
import { extractDocumentText } from '../Model/DocumentText';

type DocumentReaderProps = {
    document: TranslationDocument;
    file: Blob;
    onClose: () => void;
};

type ReaderStatus = 'loading' | 'ready' | 'error';
const SPEECH_LANGUAGES: Record<string, string> = {
    de: 'de-DE',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    it: 'it-IT',
    ja: 'ja-JP',
    pt: 'pt-PT',
    zh: 'zh-CN',
};

function splitText(text: string): string[] {
    const chunks: string[] = [];
    const paragraphs = text.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
    let chunk = '';

    for (const paragraph of paragraphs) {
        const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [paragraph];
        for (const sentence of sentences) {
            const next = `${chunk}${chunk ? ' ' : ''}${sentence.trim()}`;
            if (next.length > 1400 && chunk) {
                chunks.push(chunk);
                chunk = sentence.trim();
            } else {
                chunk = next;
            }
        }
        chunk += '\n';
    }

    if (chunk.trim()) chunks.push(chunk.trim());
    return chunks;
}

const DocumentReader: React.FC<DocumentReaderProps> = ({ document, file, onClose }) => {
    const [status, setStatus] = useState<ReaderStatus>('loading');
    const [text, setText] = useState('');
    const [error, setError] = useState<string>();
    const [speaking, setSpeaking] = useState(false);
    const [paused, setPaused] = useState(false);
    const [speechProgress, setSpeechProgress] = useState({ current: 0, total: 0 });
    const speechRunRef = useRef(0);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        setText('');
        setError(undefined);
        setSpeaking(false);
        setPaused(false);

        void extractDocumentText(file, document.name).then((content) => {
            if (cancelled) return;
            if (!content.trim()) {
                throw new Error('No se encontró texto legible. Si es un PDF escaneado, se necesita OCR.');
            }
            setText(content);
            setStatus('ready');
        }).catch((cause: unknown) => {
            if (cancelled) return;
            setError(cause instanceof Error ? cause.message : 'No se pudo abrir el documento.');
            setStatus('error');
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        closeButtonRef.current?.focus();

        return () => {
            cancelled = true;
            speechRunRef.current += 1;
            window.removeEventListener('keydown', handleKeyDown);
            window.speechSynthesis?.cancel();
        };
    }, [document.id, document.name, file, onClose]);

    const stopReading = () => {
        speechRunRef.current += 1;
        window.speechSynthesis?.cancel();
        setSpeaking(false);
        setPaused(false);
    };

    const startReading = () => {
        if (!('speechSynthesis' in window)) {
            setError('La lectura por voz no está disponible en este navegador.');
            return;
        }
        const chunks = splitText(text);
        if (chunks.length === 0) return;
        stopReading();
        const runId = speechRunRef.current;
        setSpeaking(true);
        setPaused(false);
        setSpeechProgress({ current: 0, total: chunks.length });

        const speakChunk = (index: number) => {
            if (runId !== speechRunRef.current) return;
            if (index >= chunks.length) {
                setSpeaking(false);
                setPaused(false);
                setSpeechProgress({ current: chunks.length, total: chunks.length });
                return;
            }

            setSpeechProgress({ current: index + 1, total: chunks.length });
            const utterance = new SpeechSynthesisUtterance(chunks[index]);
            utterance.lang = SPEECH_LANGUAGES[document.sourceLanguage] ?? document.sourceLanguage;
            utterance.onend = () => speakChunk(index + 1);
            utterance.onerror = (event) => {
                if (runId !== speechRunRef.current || event.error === 'canceled' || event.error === 'interrupted') return;
                setSpeaking(false);
                setPaused(false);
                setError(`No se pudo continuar la lectura por voz: ${event.error}.`);
            };
            window.speechSynthesis.speak(utterance);
        };

        speakChunk(0);
    };

    const togglePause = () => {
        if (paused) {
            window.speechSynthesis.resume();
            setPaused(false);
        } else {
            window.speechSynthesis.pause();
            setPaused(true);
        }
    };

    return (
        <div className="traduc-reader-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section className="traduc-reader-dialog" role="dialog" aria-modal="true" aria-labelledby="traduc-reader-title">
                <header className="traduc-reader-header">
                    <div>
                        <h2 id="traduc-reader-title">{document.name}</h2>
                        <p>Vista de lectura del documento</p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        className="traduc-reader-close"
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar lector"
                    >
                        ×
                    </button>
                </header>

                <div className="traduc-reader-toolbar">
                    {!speaking ? (
                        <button type="button" className="traduc-action-primary" onClick={startReading} disabled={status !== 'ready'}>
                            Leer en voz alta
                        </button>
                    ) : (
                        <>
                            <button type="button" className="traduc-action-primary" onClick={togglePause}>
                                {paused ? 'Continuar lectura' : 'Pausar lectura'}
                            </button>
                            <button type="button" className="traduc-action-secondary" onClick={stopReading}>
                                Detener
                            </button>
                        </>
                    )}
                    {speaking && speechProgress.total > 0 && (
                        <span role="status">Leyendo parte {speechProgress.current} de {speechProgress.total}</span>
                    )}
                </div>

                <div className="traduc-reader-content" aria-live="polite">
                    {status === 'loading' && <p role="status">Abriendo y extrayendo texto…</p>}
                    {error && <p className="traduc-voice-error" role="alert">{error}</p>}
                    {status === 'ready' && <pre>{text}</pre>}
                </div>
            </section>
        </div>
    );
};

export default DocumentReader;
