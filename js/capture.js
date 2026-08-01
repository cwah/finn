// Capture flow. Wired to the bottom-tray native camera input
// (<input type="file" accept="image/*" capture="environment">).
//
// Phase 1 has no backend, so a capture builds an in-memory post from the chosen
// file(s) and hands it back via a callback so the timeline can prepend it. The
// optimistic post uses object URLs for instant preview.
//
// Phase 2: in onCapture, POST the files to PocketBase, then prepend the saved record.

/**
 * Read intrinsic dimensions of an image File via an object URL.
 * @param {File} file
 * @returns {Promise<{url: string, width: number, height: number}>}
 */
function measure(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * @param {HTMLInputElement} input the capture file input
 * @param {(post: object) => void} onCapture called with a new in-memory post
 */
export function initCapture(input, onCapture) {
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const photos = await Promise.all(
      files.map(async (f, i) => {
        const { url, width, height } = await measure(f);
        return { id: `local-${Date.now()}-${i}`, url, width, height, alt: null };
      }),
    );

    const post = {
      id: `local-${Date.now()}`,
      memoryDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      author: { id: 'me', name: 'You' },
      caption: null,
      milestone: null,
      photos,
    };

    input.value = ''; // allow re-capturing the same file
    onCapture(post);
  });
}
