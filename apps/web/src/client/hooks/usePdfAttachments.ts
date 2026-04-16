import { useState, useCallback, useRef } from 'react';
import type { AttachedPdf } from '@/components/ui/PdfAttachmentPreview';

const MAX_PDFS = 3;
const ACCEPTED_PDF_TYPE = 'application/pdf';

async function fileToPdf(file: File): Promise<AttachedPdf> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            // result is "data:application/pdf;base64,XXXX"
            const base64 = result.split(',')[1] ?? '';
            resolve({ base64, name: file.name, size: file.size });
        };
        reader.onerror = () => reject(new Error('Failed to read PDF file'));
        reader.readAsDataURL(file);
    });
}

export function usePdfAttachments() {
    const [attachedPdfs, setAttachedPdfs] = useState<AttachedPdf[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addFiles = useCallback(async (files: File[]) => {
        const pdfFiles = files.filter((f) => f.type === ACCEPTED_PDF_TYPE);
        if (pdfFiles.length === 0) return;

        const newPdfs: AttachedPdf[] = [];
        for (const file of pdfFiles) {
            try {
                const pdf = await fileToPdf(file);
                newPdfs.push(pdf);
            } catch (e) {
                console.error('[PdfAttach] Error reading file:', e);
            }
        }

        setAttachedPdfs((prev) => {
            const combined = [...prev, ...newPdfs];
            return combined.slice(0, MAX_PDFS);
        });
    }, []);

    const removePdf = useCallback((index: number) => {
        setAttachedPdfs((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const clearAll = useCallback(() => {
        setAttachedPdfs([]);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files);
            void addFiles(files);
        },
        [addFiles],
    );

    const openFilePicker = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(e.target.files || []);
            void addFiles(files);
            // Reset so same file can be re-selected
            e.target.value = '';
        },
        [addFiles],
    );

    return {
        attachedPdfs,
        addFiles,
        removePdf,
        clearAll,
        handleDrop,
        openFilePicker,
        handleFileInputChange,
        fileInputRef,
        canAddMore: attachedPdfs.length < MAX_PDFS,
    };
}
