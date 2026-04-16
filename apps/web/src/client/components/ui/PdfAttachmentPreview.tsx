import { X, FilePdf } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

export interface AttachedPdf {
    /** base64-encoded raw PDF data (no data:... prefix) */
    base64: string;
    /** Original file name */
    name: string;
    /** File size in bytes */
    size: number;
}

interface PdfAttachmentPreviewProps {
    pdfs: AttachedPdf[];
    onRemove: (index: number) => void;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PdfAttachmentPreview({ pdfs, onRemove }: PdfAttachmentPreviewProps) {
    if (pdfs.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
            {pdfs.map((pdf, i) => (
                <motion.div
                    key={`${pdf.name}-${i}`}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.15 }}
                    className="group relative flex-shrink-0"
                >
                    <div className="relative flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 shadow-sm min-w-[120px] max-w-[200px]">
                        <FilePdf className="h-5 w-5 shrink-0 text-red-500" weight="fill" />
                        <div className="flex flex-col overflow-hidden">
                            <span className="text-[11px] font-medium text-foreground truncate leading-tight">
                                {pdf.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground leading-tight">
                                {formatFileSize(pdf.size)}
                            </span>
                        </div>
                    </div>
                    {/* Remove button */}
                    <button
                        type="button"
                        onClick={() => onRemove(i)}
                        className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm hover:bg-destructive/90 transition-colors z-10"
                        aria-label={`Remove PDF ${pdf.name}`}
                    >
                        <X className="h-2.5 w-2.5" weight="bold" />
                    </button>
                </motion.div>
            ))}
        </div>
    );
}
