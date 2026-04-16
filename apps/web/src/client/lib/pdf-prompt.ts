/**
 * PDF attachment utilities for task prompts.
 *
 * Strategy: Save PDF(s) to temp files via IPC, then append
 * references to the prompt so the agent can read/analyze them.
 */
import type { AttachedPdf } from '@/components/ui/PdfAttachmentPreview';

/**
 * Save all attached PDFs to disk (via Electron IPC) and build a prompt that includes
 * references to the PDF file paths.  Falls back gracefully if saving fails.
 *
 * Returns the enhanced prompt string.
 */
export async function buildPromptWithPdfs(
    prompt: string,
    pdfs: AttachedPdf[],
): Promise<string> {
    if (pdfs.length === 0) return prompt;

    const navigatorApp = window.navigatorApp;
    if (!navigatorApp?.savePdfToDisk) {
        // Fallback: describe PDFs without file paths
        const pdfDesc = pdfs.map((pdf, i) => `- PDF ${i + 1}: ${pdf.name}`).join('\n');
        return `${prompt}\n\n[Attached PDFs — unable to save to disk, please describe them]:\n${pdfDesc}`;
    }

    const savedPaths: string[] = [];
    const failedPdfs: string[] = [];

    for (const pdf of pdfs) {
        try {
            const result = await navigatorApp.savePdfToDisk(pdf.base64);
            if (result.success) {
                savedPaths.push(result.filePath);
            } else {
                failedPdfs.push(pdf.name);
                console.warn('[PdfPrompt] Failed to save PDF:', pdf.name, result.error);
            }
        } catch (err) {
            failedPdfs.push(pdf.name);
            console.error('[PdfPrompt] Error saving PDF:', err);
        }
    }

    const parts: string[] = [];

    if (savedPaths.length > 0) {
        const pdfSection =
            savedPaths.length === 1
                ? `I have attached a PDF document for you to read and analyze. The PDF file is located at:\n${savedPaths[0]}\n\nPlease read and analyze this PDF to help with my request.`
                : `I have attached ${savedPaths.length} PDF documents for you to read and analyze. The PDF files are located at:\n${savedPaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nPlease read and analyze these PDFs to help with my request.`;
        parts.push(pdfSection);
    }

    if (failedPdfs.length > 0) {
        parts.push(`[Note: Could not save the following PDFs: ${failedPdfs.join(', ')}]`);
    }

    if (prompt.trim()) {
        parts.push(prompt.trim());
    }

    return parts.join('\n\n');
}
