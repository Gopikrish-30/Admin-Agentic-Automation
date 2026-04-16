import { useState, useCallback, useRef } from 'react';
import type { AttachedImage } from '@/components/ui/ImageAttachmentPreview';

const MAX_IMAGES = 5;
const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

async function fileToAttachedImage(file: File): Promise<AttachedImage> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            // result is "data:image/png;base64,XXXX"
            const [header, base64] = result.split(',');
            const mimeType = header.match(/:(.*?);/)?.[1] || file.type || 'image/png';
            const previewUrl = URL.createObjectURL(file);
            resolve({ previewUrl, base64, mimeType, name: file.name });
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

export function useImageAttachments() {
    const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addFiles = useCallback(async (files: File[]) => {
        const imageFiles = files.filter((f) => ACCEPTED_TYPES.includes(f.type));
        if (imageFiles.length === 0) return;

        const newImages: AttachedImage[] = [];
        for (const file of imageFiles) {
            try {
                const img = await fileToAttachedImage(file);
                newImages.push(img);
            } catch (e) {
                console.error('[ImageAttach] Error reading file:', e);
            }
        }

        setAttachedImages((prev) => {
            const combined = [...prev, ...newImages];
            return combined.slice(0, MAX_IMAGES);
        });
    }, []);

    const removeImage = useCallback((index: number) => {
        setAttachedImages((prev) => {
            const removed = prev[index];
            if (removed) {
                URL.revokeObjectURL(removed.previewUrl);
            }
            return prev.filter((_, i) => i !== index);
        });
    }, []);

    const clearAll = useCallback(() => {
        setAttachedImages((prev) => {
            prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
            return [];
        });
    }, []);

    const handlePaste = useCallback(
        (e: React.ClipboardEvent) => {
            const items = Array.from(e.clipboardData.items);
            const imageItems = items.filter((item) => item.type.startsWith('image/'));
            if (imageItems.length === 0) return;

            const files = imageItems
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null);

            void addFiles(files);
        },
        [addFiles],
    );

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
            // Reset input so same file can be re-selected
            e.target.value = '';
        },
        [addFiles],
    );

    return {
        attachedImages,
        addFiles,
        removeImage,
        clearAll,
        handlePaste,
        handleDrop,
        openFilePicker,
        handleFileInputChange,
        fileInputRef,
        canAddMore: attachedImages.length < MAX_IMAGES,
    };
}
