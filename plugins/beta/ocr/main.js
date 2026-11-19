// OCR startup module: surfaces a non-intrusive status notice during first-run Tesseract model downloads.
const IMAGES = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function register(kandinsky) {
  let status = null;
  const setStatus = (text, title) => {
    if (!text) {
      status?.remove();
      status = null;
      return;
    }
    if (!status) {
      status = kandinsky.shell.statusItem({
        id: "ocr-prepare",
        text,
        title: title || "OCR",
        run: () => kandinsky.plugin.openSettings(),
      });
    } else {
      status.set(text, title || "OCR");
    }
  };

  const prepareModels = async (explicit = false) => {
    let notified = false;
    const timer = setTimeout(() => {
      notified = true;
      setStatus("OCR: downloading models…", "Downloading Tesseract language models for offline OCR (first run only)");
      kandinsky.toast("OCR", "Downloading language models for offline text recognition (first run only)…", "info");
    }, explicit ? 150 : 800);
    try {
      const res = await kandinsky.helper.call("prepare", {}, { timeout: 300 });
      clearTimeout(timer);
      setStatus("");
      if (notified || explicit) {
        const langs = res && typeof res === "object" && "languages" in res ? ` (${res.languages})` : "";
        kandinsky.toast("OCR", `Language models ready${langs}.`, "success", { timeout: 3500 });
      }
    } catch (e) {
      clearTimeout(timer);
      setStatus("");
      if (explicit) {
        kandinsky.toast("OCR", String(e?.message ?? e), "error");
      }
    }
  };

  kandinsky.registerCommand({
    id: "prepare",
    title: "OCR: Prepare language models",
    run: () => void prepareModels(true),
  });

  kandinsky.shell.menu("file", (t) => {
    if (t.dir || !IMAGES.test(t.path)) return [];
    return [{
      label: "OCR: Read text",
      icon: "image",
      run: async () => {
        setStatus("OCR: reading…", `Reading text from ${t.path}`);
        try {
          const res = await kandinsky.helper.call("read", { path: t.path }, { timeout: 300 });
          const text = String(res?.text ?? "").trim();
          if (!text) {
            kandinsky.toast("OCR", "No text found in image.", "info");
            return;
          }
          try {
            await navigator.clipboard.writeText(text);
            kandinsky.toast("OCR", `Copied ${text.split(/\s+/).length} words to clipboard.`, "success");
          } catch {
            kandinsky.toast("OCR", text.slice(0, 200), "info");
          }
        } catch (e) {
          kandinsky.toast("OCR", String(e?.message ?? e), "error");
        } finally {
          setStatus("");
        }
      },
    }];
  });

  void prepareModels(false);
}
