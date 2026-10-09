export async function extractDocumentText(file: Blob, filename: string): Promise<string> {
    const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();

    if (extension === '.pdf') {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const pages: string[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            const lines: string[] = [];
            let currentLine = '';
            let previousY: number | undefined;

            for (const item of content.items) {
                if (!('str' in item)) continue;
                const y = item.transform[5];
                if (previousY !== undefined && Math.abs(previousY - y) > 2) {
                    if (currentLine.trim()) lines.push(currentLine.trim());
                    currentLine = '';
                }
                currentLine += item.str;
                previousY = y;
                if (item.hasEOL) {
                    if (currentLine.trim()) lines.push(currentLine.trim());
                    currentLine = '';
                    previousY = undefined;
                }
            }
            if (currentLine.trim()) lines.push(currentLine.trim());
            pages.push(`Página ${pageNumber}\n${lines.join('\n')}`);
        }
        return pages.join('\n\n');
    }

    if (extension === '.docx') {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        return result.value;
    }

    if (extension === '.xlsx') {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        return workbook.SheetNames.map((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false });
            const content = rows
                .map((row) => row.map((cell) => String(cell ?? '')).join('\t').trim())
                .filter(Boolean)
                .join('\n');
            return `${sheetName}\n${content}`;
        }).join('\n\n');
    }

    throw new Error('Formato no compatible. Adjunta PDF, DOCX o XLSX.');
}
