const databaseName = "yier-little-assistant-attachments";
const databaseVersion = 1;
const previewStoreName = "previews";

type AttachmentPreviewRecord = {
  id: string;
  blob: Blob;
  updatedAt: number;
};

function openPreviewDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持本地图片预览存储。"));
      return;
    }

    const request = indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(previewStoreName)) {
        database.createObjectStore(previewStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开本地图片预览存储。"));
    request.onblocked = () =>
      reject(new Error("本地图片预览存储正在被其他页面占用。"));
  });
}

export async function saveAttachmentPreview(id: string, blob: Blob) {
  const database = await openPreviewDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(previewStoreName, "readwrite");
    const store = transaction.objectStore(previewStoreName);
    const record: AttachmentPreviewRecord = {
      id,
      blob,
      updatedAt: Date.now(),
    };

    store.put(record);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("图片预览保存失败。"));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("图片预览保存已取消。"));
    };
  });
}

export async function getAttachmentPreview(id: string) {
  const database = await openPreviewDatabase();

  return new Promise<Blob | null>((resolve, reject) => {
    const transaction = database.transaction(previewStoreName, "readonly");
    const store = transaction.objectStore(previewStoreName);
    const request = store.get(id);

    request.onsuccess = () => {
      const record = request.result as AttachmentPreviewRecord | undefined;
      resolve(record?.blob ?? null);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("图片预览读取失败。"));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
    transaction.onabort = () => database.close();
  });
}

export async function deleteAttachmentPreviews(ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;

  const database = await openPreviewDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(previewStoreName, "readwrite");
    const store = transaction.objectStore(previewStoreName);

    uniqueIds.forEach((id) => store.delete(id));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("图片预览清理失败。"));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("图片预览清理已取消。"));
    };
  });
}
