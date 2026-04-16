/**
 * Image attachment utilities for task prompts.
 *
 * Strategy: Save image(s) to temp files via IPC, then append
 * references to the prompt so the agent can read/analyze them.
 */
import type { AttachedImage } from '@/components/ui/ImageAttachmentPreview';

/**
 * Save all attached images to disk (via Electron IPC) and build a prompt that includes
 * references to the image file paths.  Falls back gracefully if saving fails.
 *
 * Returns the enhanced prompt string.
 */
export async function buildPromptWithImages(
    prompt: string,
    images: AttachedImage[],
): Promise<string> {
    if (images.length === 0) return prompt;

    const navigatorApp = window.navigatorApp;
    if (!navigatorApp?.saveImageToDisk) {
        // Fallback: describe images without file paths
        const imageDesc = images.map((img, i) => `- Image ${i + 1}: ${img.name}`).join('\n');
        return `${prompt}\n\n[Attached images — unable to save to disk, please describe them]:\n${imageDesc}`;
    }

    const savedPaths: string[] = [];
    const failedImages: string[] = [];

    for (const img of images) {
        try {
            const result = await navigatorApp.saveImageToDisk(img.base64, img.mimeType);
            if (result.success) {
                savedPaths.push(result.filePath);
            } else {
                failedImages.push(img.name);
                console.warn('[ImagePrompt] Failed to save image:', img.name, result.error);
            }
        } catch (err) {
            failedImages.push(img.name);
            console.error('[ImagePrompt] Error saving image:', err);
        }
    }

    const parts: string[] = [];

    if (savedPaths.length > 0) {
        const imageSection =
            savedPaths.length === 1
                ? `I have attached an image for you to analyze. The image file is located at:\n${savedPaths[0]}\n\nPlease read and analyze this image to help with my request.`
                : `I have attached ${savedPaths.length} images for you to analyze. The image files are located at:\n${savedPaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nPlease read and analyze these images to help with my request.`;
        parts.push(imageSection);
    }

    if (failedImages.length > 0) {
        parts.push(`[Note: Could not save the following images: ${failedImages.join(', ')}]`);
    }

    if (prompt.trim()) {
        parts.push(prompt.trim());
    }

    return parts.join('\n\n');
}
