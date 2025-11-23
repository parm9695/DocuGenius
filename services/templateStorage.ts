
const DB_NAME = 'DocuGeniusDB';
const STORE_NAME = 'templates';
const DB_VERSION = 1;

export interface StoredTemplate {
  id: string;
  file: File;
  addedBy: string;
  createdAt: number;
}

// Extend the standard File type to include our metadata for usage in the app
export type TemplateFile = File & {
  _dbId?: string;
  _addedBy?: string;
};

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const templateStorage = {
  async saveTemplate(file: File, username: string): Promise<TemplateFile> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const id = crypto.randomUUID();
      const record: StoredTemplate = {
        id,
        file,
        addedBy: username,
        createdAt: Date.now(),
      };

      const request = store.add(record);

      request.onsuccess = () => {
        // Return a File object with attached metadata
        const templateFile = file as TemplateFile;
        templateFile._dbId = id;
        templateFile._addedBy = username;
        resolve(templateFile);
      };

      request.onerror = () => reject(request.error);
    });
  },

  async getAllTemplates(): Promise<TemplateFile[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result as StoredTemplate[];
        // Convert records back to File objects with metadata
        const files = records.map(record => {
          const file = record.file as TemplateFile;
          file._dbId = record.id;
          file._addedBy = record.addedBy;
          return file;
        });
        // Sort by newest first
        files.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
        resolve(files);
      };

      request.onerror = () => reject(request.error);
    });
  },

  async deleteTemplate(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};
