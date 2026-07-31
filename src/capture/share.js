// Download / Web Share helper for exported blobs.

/**
 * Share a blob via the Web Share API when file sharing is available
 * (one-tap mobile sharing), otherwise trigger a regular download.
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<'shared'|'downloaded'|'aborted'>}
 */
export async function shareOrDownload(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: filename });
            return 'shared';
        } catch (error) {
            if (error?.name === 'AbortError') return 'aborted';
            // Fall through to a regular download on share failure.
        }
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
}
