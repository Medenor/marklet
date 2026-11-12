// Opening and saving files.
//
// Where the File System Access API is available (Chrome, Edge), files are
// edited in place: "Save" writes back to the file that was opened. Elsewhere
// (Firefox, Safari, or when IT policy disables the API) we fall back to a
// classic <input type="file"> and a download.

export interface OpenedFile {
  name: string;
  text: string;
  handle: FileSystemFileHandle | null;
}

const MAX_SIZE = 20 * 1024 * 1024;
const MD_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".mdx", ".txt", ".text"];

const pickerTypes = [
  {
    description: "Markdown",
    accept: { "text/markdown": [".md", ".markdown", ".mdown", ".mkd", ".mdx"] as `.${string}`[] },
  },
  { description: "Text", accept: { "text/plain": [".txt", ".text"] as `.${string}`[] } },
];

type FSWindow = Window & {
  showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle>;
};
const w = window as FSWindow;

export const canEditInPlace = typeof w.showOpenFilePicker === "function" && typeof w.showSaveFilePicker === "function";

export class UserCancelled extends Error {}

function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === "AbortError";
}

/** Accept by extension: OS-reported MIME types for .md files are unreliable. */
export function isProbablyText(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  return file.type === "" || file.type.startsWith("text/");
}

export async function readFile(file: File, handle: FileSystemFileHandle | null = null): Promise<OpenedFile> {
  if (file.size > MAX_SIZE) throw new Error(`“${file.name}” is larger than 20 MB.`);
  if (!isProbablyText(file)) throw new Error(`“${file.name}” does not look like a text file.`);
  return { name: file.name, text: await file.text(), handle };
}

function pickWithInput(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = [...MD_EXTENSIONS, "text/markdown", "text/plain"].join(",");
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) resolve(f);
      else reject(new UserCancelled());
    });
    input.addEventListener("cancel", () => reject(new UserCancelled()));
    input.click();
  });
}

export async function openFile(): Promise<OpenedFile> {
  if (canEditInPlace) {
    try {
      const [handle] = await w.showOpenFilePicker!({
        types: pickerTypes,
        excludeAcceptAllOption: false,
        multiple: false,
      });
      return await readFile(await handle.getFile(), handle);
    } catch (e) {
      if (isAbort(e)) throw new UserCancelled();
      // SecurityError / NotAllowedError: the API may be blocked by policy.
      if (!(e instanceof DOMException)) throw e;
    }
  }
  return readFile(await pickWithInput());
}

/** Write to an existing handle. Returns false if permission was refused. */
async function writeHandle(handle: FileSystemFileHandle, text: string): Promise<boolean> {
  const h = handle as FileSystemFileHandle & {
    queryPermission?: (o: unknown) => Promise<PermissionState>;
    requestPermission?: (o: unknown) => Promise<PermissionState>;
  };
  if (h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) !== "granted") {
    if (!h.requestPermission || (await h.requestPermission({ mode: "readwrite" })) !== "granted") return false;
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}

export function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface SaveResult {
  name: string;
  handle: FileSystemFileHandle | null;
  /** true if written in place, false if a download was triggered. */
  inPlace: boolean;
}

export async function saveFile(
  text: string,
  current: { name: string; handle: FileSystemFileHandle | null },
  saveAs = false,
): Promise<SaveResult> {
  if (current.handle && !saveAs) {
    try {
      if (await writeHandle(current.handle, text)) return { name: current.name, handle: current.handle, inPlace: true };
    } catch (e) {
      if (!(e instanceof DOMException)) throw e;
    }
  }
  if (canEditInPlace) {
    try {
      const handle = await w.showSaveFilePicker!({ suggestedName: current.name, types: pickerTypes });
      await writeHandle(handle, text);
      return { name: handle.name, handle, inPlace: true };
    } catch (e) {
      if (isAbort(e)) throw new UserCancelled();
      if (!(e instanceof DOMException)) throw e;
    }
  }
  download(current.name, text, "text/markdown;charset=utf-8");
  return { name: current.name, handle: null, inPlace: false };
}

/** Get a file (and, if possible, a writable handle) from a drop event. */
export async function fileFromDrop(e: DragEvent): Promise<OpenedFile | null> {
  const item = e.dataTransfer?.items?.[0] as
    (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }) | undefined;
  if (item?.kind === "file" && item.getAsFileSystemHandle) {
    try {
      const handle = await item.getAsFileSystemHandle();
      if (handle && handle.kind === "file") {
        const fh = handle as FileSystemFileHandle;
        return readFile(await fh.getFile(), fh);
      }
    } catch {
      /* fall through */
    }
  }
  const file = e.dataTransfer?.files?.[0];
  return file ? readFile(file) : null;
}
