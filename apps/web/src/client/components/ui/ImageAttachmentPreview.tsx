import { X, Image as ImageIcon } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

export interface AttachedImage {
    /** object URL for preview*/
    previewUrl: string;
    /** base64-encoded raw image data (no data:... prefix) */
    base64: string;
    /** MIME type e.g. image/png */
    mimeType: string;
    /** Original file name */
    name: string;
}

interface ImageAttachmentPreviewProps {
    images: AttachedImage[];
    onRemove: (index: number) => void;
}

export function ImageAttachmentPreview({ images, onRemove }: ImageAttachmentPreviewProps) {
    if (images.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
            {images.map((img, i) => (
                <motion.div
                    key={img.previewUrl}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.15 }}
                    className="group relative flex-shrink-0"
                >
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted shadow-sm">
                        <img
                            src={img.previewUrl}
                            alt={img.name}
                            className="w-full h-full object-cover"
                        />
                        {/* Overlay on hover */}
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ImageIcon className="h-4 w-4 text-white" weight="bold" />
                        </div>
                    </div>
                    {/* Remove button */}
                    <button
                        type="button"
                        onClick={() => onRemove(i)}
                        className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm hover:bg-destructive/90 transition-colors z-10"
                        aria-label={`Remove image ${img.name}`}
                    >
                        <X className="h-2.5 w-2.5" weight="bold" />
                    </button>
                    {/* Filename tooltip */}
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground whitespace-nowrap max-w-[72px] truncate text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        {img.name}
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
