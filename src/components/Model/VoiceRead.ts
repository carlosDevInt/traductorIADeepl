export type VoiceTranscript = {
    finalText: string;
    tentativeText: string;
};

export type VoiceTranscriptSegment = {
    text: string;
};

export type VoiceSocketMessage = {
    source_transcript_update?: {
        concluded?: VoiceTranscriptSegment[];
        tentative?: VoiceTranscriptSegment[];
    };
    target_transcript_update?: {
        concluded?: VoiceTranscriptSegment[];
        tentative?: VoiceTranscriptSegment[];
    };
    end_of_stream?: Record<string, never>;
    error?: {
        error_message?: string;
    };
};

export function appendTranscript(
    transcript: VoiceTranscript,
    update: { concluded?: VoiceTranscriptSegment[]; tentative?: VoiceTranscriptSegment[] },
): VoiceTranscript {
    return {
        finalText: transcript.finalText + (update.concluded ?? []).map(({ text }) => text).join(''),
        tentativeText: (update.tentative ?? []).map(({ text }) => text).join(''),
    };
}

export function audioBufferToPcm16(audio: AudioBuffer): Uint8Array {
    const outputLength = Math.ceil(audio.length * 16000 / audio.sampleRate);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
    const output = new Uint8Array(outputLength * 2);
    const view = new DataView(output.buffer);

    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
        const sourcePosition = outputIndex * audio.sampleRate / 16000;
        const sourceIndex = Math.floor(sourcePosition);
        const fraction = sourcePosition - sourceIndex;
        let sample = 0;

        for (const channel of channels) {
            const first = channel[sourceIndex] ?? 0;
            const second = channel[Math.min(sourceIndex + 1, channel.length - 1)] ?? first;
            sample += first + (second - first) * fraction;
        }

        sample = Math.max(-1, Math.min(1, sample / channels.length));
        view.setInt16(outputIndex * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return output;
}

export function pcmChunkToBase64(chunk: Uint8Array): string {
    let binary = '';
    for (let offset = 0; offset < chunk.length; offset += 0x8000) {
        binary += String.fromCharCode(...chunk.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}
