import { useEffect, useRef, useState } from 'react';
import { LANGUAGES } from '../Model/TraducModel';
import {
    appendTranscript,
    audioBufferToPcm16,
    pcmChunkToBase64,
    type VoiceSocketMessage,
    type VoiceTranscript,
} from '../Model/VoiceRead';

const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 200;
const MAX_AUDIO_SIZE = 100 * 1024 * 1024;

type VoiceReadProps = {
    sourceLanguage: string;
    targetLanguage: string;
    onSourceLanguageChange: (language: string) => void;
    onTargetLanguageChange: (language: string) => void;
};

type VoiceSessionResponse = {
    streamingUrl: string;
    token: string;
};

type VoiceStatus = 'idle' | 'preparing' | 'streaming' | 'finishing' | 'done';

async function responseError(response: Response): Promise<string> {
    try {
        const body = await response.json() as { error?: string };
        return body.error ?? `Error del servidor (${response.status}).`;
    } catch {
        return `Error del servidor (${response.status}).`;
    }
}

function emptyTranscript(): VoiceTranscript {
    return { finalText: '', tentativeText: '' };
}

const VoiceReadController: React.FC<VoiceReadProps> = ({
    sourceLanguage,
    targetLanguage,
    onSourceLanguageChange,
    onTargetLanguageChange,
}) => {
    const [file, setFile] = useState<File>();
    const [status, setStatus] = useState<VoiceStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [sourceTranscript, setSourceTranscript] = useState<VoiceTranscript>(emptyTranscript);
    const [targetTranscript, setTargetTranscript] = useState<VoiceTranscript>(emptyTranscript);
    const [error, setError] = useState<string>();
    const socketRef = useRef<WebSocket>();
    const runIdRef = useRef(0);
    const cancelledRef = useRef(false);

    useEffect(() => () => {
        cancelledRef.current = true;
        runIdRef.current += 1;
        socketRef.current?.close();
    }, []);

    const translateFile = async () => {
        if (!file || status === 'preparing' || status === 'streaming' || status === 'finishing') return;
        if (file.size === 0) {
            setError('El archivo está vacío.');
            return;
        }
        if (file.size > MAX_AUDIO_SIZE) {
            setError('El archivo supera el límite de 100 MB.');
            return;
        }
        if (sourceLanguage === targetLanguage) {
            setError('El idioma de origen y el de destino deben ser diferentes.');
            return;
        }

        const runId = ++runIdRef.current;
        cancelledRef.current = false;
        setStatus('preparing');
        setProgress(0);
        setError(undefined);
        setSourceTranscript(emptyTranscript());
        setTargetTranscript(emptyTranscript());
        let socket: WebSocket | undefined;
        let streamFinished = false;
        let socketError: string | undefined;
        let resolveStream!: () => void;
        let rejectStream!: (error: Error) => void;
        let rejectSocketOpen!: (error: Error) => void;
        const streamCompletion = new Promise<void>((resolve, reject) => {
            resolveStream = resolve;
            rejectStream = reject;
        });
        void streamCompletion.catch(() => undefined);

        try {
            const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
            let decodedAudio: AudioBuffer;
            try {
                try {
                    decodedAudio = await audioContext.decodeAudioData(await file.arrayBuffer());
                } catch (decodeError) {
                    const detail = decodeError instanceof Error ? ` ${decodeError.message}` : '';
                    throw new Error(`El navegador no pudo decodificar este archivo. Prueba con MP3 o WAV.${detail}`);
                }
            } finally {
                await audioContext.close();
            }
            if (runId !== runIdRef.current) return;

            const pcm = audioBufferToPcm16(decodedAudio);
            if (pcm.length === 0) throw new Error('No se encontró audio decodificable en el archivo.');

            const sessionResponse = await fetch('/api/voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceLanguage, targetLanguage }),
            });
            if (!sessionResponse.ok) throw new Error(await responseError(sessionResponse));
            const session = await sessionResponse.json() as VoiceSessionResponse;
            if (runId !== runIdRef.current) return;

            const streamingUrl = new URL(session.streamingUrl);
            if (streamingUrl.protocol !== 'wss:' || streamingUrl.hostname !== 'api.deepl.com') {
                throw new Error('DeepL devolvió una dirección de streaming no segura.');
            }
            streamingUrl.searchParams.set('token', session.token);
            socket = new WebSocket(streamingUrl);
            socketRef.current = socket;

            const socketOpened = new Promise<void>((resolve, reject) => {
                rejectSocketOpen = reject;
                socket!.onopen = () => resolve();
                socket!.onerror = () => {
                    const connectionError = new Error('No se pudo conectar con DeepL Voice.');
                    rejectSocketOpen(connectionError);
                    rejectStream(connectionError);
                };
                socket!.onclose = () => {
                    if (streamFinished) return;
                    const closeError = new Error(
                        cancelledRef.current
                            ? 'Se canceló la traducción de audio.'
                            : socketError ?? 'La conexión con DeepL Voice se cerró antes de completar el audio.',
                    );
                    rejectSocketOpen(closeError);
                    if (!cancelledRef.current) rejectStream(closeError);
                };
                socket!.onmessage = (event) => {
                    if (typeof event.data !== 'string') {
                        socketError = 'DeepL envió un mensaje de voz con un formato inesperado.';
                        rejectSocketOpen(new Error(socketError));
                        rejectStream(new Error(socketError));
                        socket!.close();
                        return;
                    }

                    let message: VoiceSocketMessage;
                    try {
                        message = JSON.parse(event.data) as VoiceSocketMessage;
                    } catch {
                        socketError = 'DeepL envió una respuesta de voz que no se pudo leer.';
                        rejectSocketOpen(new Error(socketError));
                        rejectStream(new Error(socketError));
                        socket!.close();
                        return;
                    }

                    if (message.error) {
                        socketError = message.error.error_message ?? 'DeepL no pudo procesar el audio.';
                        rejectSocketOpen(new Error(socketError));
                        rejectStream(new Error(socketError));
                        socket!.close();
                        return;
                    }
                    if (message.source_transcript_update) {
                        setSourceTranscript((current) => appendTranscript(current, message.source_transcript_update!));
                    }
                    if (message.target_transcript_update) {
                        setTargetTranscript((current) => appendTranscript(current, message.target_transcript_update!));
                    }
                    if (message.end_of_stream) {
                        streamFinished = true;
                        setProgress(100);
                        setStatus('done');
                        resolveStream();
                        socket!.close();
                    }
                };
            });

            await socketOpened;
            if (runId !== runIdRef.current) return;
            setStatus('streaming');

            const chunkSize = Math.floor(SAMPLE_RATE * CHUNK_DURATION_MS / 1000) * 2;
            const totalChunks = Math.ceil(pcm.length / chunkSize);
            for (let offset = 0, chunkIndex = 0; offset < pcm.length; offset += chunkSize, chunkIndex += 1) {
                if (runId !== runIdRef.current || cancelledRef.current) return;
                if (socket.readyState !== WebSocket.OPEN) {
                    throw new Error(socketError ?? 'Se perdió la conexión con DeepL Voice.');
                }

                const chunk = pcm.subarray(offset, Math.min(offset + chunkSize, pcm.length));
                socket.send(JSON.stringify({ source_media_chunk: { data: pcmChunkToBase64(chunk) } }));
                setProgress(Math.min(99, Math.round(((chunkIndex + 1) / totalChunks) * 100)));
                await new Promise((resolve) => window.setTimeout(resolve, Math.max(50, CHUNK_DURATION_MS / 2)));
            }

            if (runId !== runIdRef.current || cancelledRef.current) return;
            setStatus('finishing');
            socket.send(JSON.stringify({ end_of_source_media: {} }));
            await new Promise<void>((resolve, reject) => {
                const timeout = window.setTimeout(
                    () => reject(new Error('DeepL tardó demasiado en finalizar la traducción.')),
                    30000,
                );
                streamCompletion.then(
                    () => {
                        window.clearTimeout(timeout);
                        resolve();
                    },
                    (streamError: Error) => {
                        window.clearTimeout(timeout);
                        reject(streamError);
                    },
                );
            });
        } catch (caught) {
            if (runId !== runIdRef.current || cancelledRef.current) return;
            setError(caught instanceof Error ? caught.message : 'No se pudo traducir este archivo de audio.');
            setStatus('idle');
        } finally {
            if (socketRef.current === socket) socketRef.current = undefined;
            if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
        }
    };

    const cancelTranslation = () => {
        cancelledRef.current = true;
        runIdRef.current += 1;
        socketRef.current?.close();
        socketRef.current = undefined;
        setStatus('idle');
        setProgress(0);
    };

    const downloadTranslation = () => {
        const translatedText = `${targetTranscript.finalText}${targetTranscript.tentativeText}`.trim();
        if (!translatedText) return;
        const blob = new Blob([translatedText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = `${file?.name.replace(/\.[^.]+$/, '') || 'traduccion'}-${targetLanguage}.txt`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const isBusy = status === 'preparing' || status === 'streaming' || status === 'finishing';
    const sourceText = `${sourceTranscript.finalText}${sourceTranscript.tentativeText}`;
    const targetText = `${targetTranscript.finalText}${targetTranscript.tentativeText}`;

    return (
        <section className="traduc-voice-panel" aria-label="Traducción de audio">
            <div className="traduc-voice-intro">
                <span className="traduc-voice-icon" aria-hidden="true">♫</span>
                <div>
                    <h2>Traduce una grabación con DeepL Voice</h2>
                    <p>Sube audio y obtén la transcripción original junto con su traducción.</p>
                </div>
            </div>

            <div className="traduc-voice-controls">
                <label>
                    <span>Idioma del audio</span>
                    <select value={sourceLanguage} onChange={(event) => onSourceLanguageChange(event.target.value)} disabled={isBusy}>
                        {LANGUAGES.map((language) => (
                            <option key={language.code} value={language.code}>{language.label}</option>
                        ))}
                    </select>
                </label>
                <span className="traduc-voice-arrow" aria-hidden="true">→</span>
                <label>
                    <span>Traducir a</span>
                    <select value={targetLanguage} onChange={(event) => onTargetLanguageChange(event.target.value)} disabled={isBusy}>
                        {LANGUAGES.map((language) => (
                            <option key={language.code} value={language.code}>{language.label}</option>
                        ))}
                    </select>
                </label>
            </div>

            <label className="traduc-voice-file">
                <span>Archivo de audio</span>
                <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm,.flac"
                    disabled={isBusy}
                    onChange={(event) => {
                        setFile(event.currentTarget.files?.[0]);
                        setError(undefined);
                        setProgress(0);
                        setSourceTranscript(emptyTranscript());
                        setTargetTranscript(emptyTranscript());
                    }}
                />
                <small>MP3, WAV, M4A, AAC, OGG, WebM o FLAC · máximo 100 MB</small>
            </label>

            <div className="traduc-voice-actions">
                <button
                    type="button"
                    className="traduc-action-primary"
                    onClick={() => void translateFile()}
                    disabled={!file || isBusy}
                >
                    {status === 'preparing' && 'Preparando audio…'}
                    {status === 'streaming' && 'Traduciendo…'}
                    {status === 'finishing' && 'Finalizando…'}
                    {(status === 'idle' || status === 'done') && 'Traducir audio'}
                </button>
                {isBusy && (
                    <button type="button" className="traduc-action-secondary" onClick={cancelTranslation}>
                        Cancelar
                    </button>
                )}
                {status === 'done' && targetText && (
                    <button type="button" className="traduc-action-secondary" onClick={downloadTranslation}>
                        Descargar traducción
                    </button>
                )}
            </div>

            {status === 'streaming' && (
                <div className="traduc-voice-progress" role="status" aria-live="polite">
                    <div><span>Enviando audio a DeepL Voice</span><span>{progress}%</span></div>
                    <progress max="100" value={progress} />
                </div>
            )}
            {status === 'finishing' && <p className="traduc-voice-status" role="status">DeepL está completando la transcripción y la traducción…</p>}
            {error && <p className="traduc-voice-error" role="alert">{error}</p>}

            {(sourceText || targetText) && (
                <div className="traduc-voice-results" aria-live="polite">
                    <article>
                        <h3>Transcripción original</h3>
                        <p>{sourceText || 'Esperando transcripción…'}</p>
                    </article>
                    <article>
                        <h3>Traducción</h3>
                        <p>{targetText || 'Esperando traducción…'}</p>
                    </article>
                </div>
            )}

            <p className="traduc-voice-note">
                El audio se transmite a DeepL para su procesamiento. Se requiere una suscripción API de pago.
            </p>
        </section>
    );
};

export default VoiceReadController;