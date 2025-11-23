
const DB_NAME = 'DocuGeniusDB';
const STORE_NAME = 'templates';
const DB_VERSION = 1;

export interface StoredTemplate {
  id: string;
  file: File;
  addedBy: string;
  createdAt: number;
  isSystem?: boolean; // Mark templates loaded from the shared JSON
}

// Extend the standard File type to include our metadata for usage in the app
export type TemplateFile = File & {
  _dbId?: string;
  _addedBy?: string;
  _isSystem?: boolean;
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

// Helper to convert file to base64 for export
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

// Helper to convert base64 to file for import
const base64ToFile = async (base64: string, filename: string, mimeType: string): Promise<File> => {
  const res = await fetch(base64);
  const buf = await res.arrayBuffer();
  return new File([buf], filename, { type: mimeType });
};

export const templateStorage = {
  async saveTemplate(file: File, username: string, isSystem: boolean = false): Promise<TemplateFile> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      // Check for duplicates if it's a system file to prevent re-adding on every reload
      if (isSystem) {
         // This is a simplified check. In a real app, you might check by hash or filename.
         // For now, we rely on the caller to handle logic or just overwrite.
      }

      const id = crypto.randomUUID();
      const record: StoredTemplate = {
        id,
        file,
        addedBy: username,
        createdAt: Date.now(),
        isSystem
      };

      const request = store.add(record);

      request.onsuccess = () => {
        const templateFile = file as TemplateFile;
        templateFile._dbId = id;
        templateFile._addedBy = username;
        templateFile._isSystem = isSystem;
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
        const files = records.map(record => {
          const file = record.file as TemplateFile;
          file._dbId = record.id;
          file._addedBy = record.addedBy;
          file._isSystem = record.isSystem;
          return file;
        });
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
  },

  async exportLibrary(): Promise<string> {
    const templates = await this.getAllTemplates();
    const exportData = await Promise.all(templates.map(async (t) => ({
      name: t.name,
      type: t.type,
      lastModified: t.lastModified,
      addedBy: t._addedBy,
      data: await fileToBase64(t)
    })));
    return JSON.stringify(exportData);
  },

  async importLibrary(jsonString: string, currentUsername: string): Promise<TemplateFile[]> {
    try {
      const data = JSON.parse(jsonString);
      if (!Array.isArray(data)) throw new Error("Invalid library format");

      const importedFiles: TemplateFile[] = [];

      for (const item of data) {
        if (item.name && item.data) {
          const file = await base64ToFile(item.data, item.name, item.type || 'application/octet-stream');
          const addedBy = item.addedBy || currentUsername; 
          const saved = await this.saveTemplate(file, addedBy);
          importedFiles.push(saved);
        }
      }
      return importedFiles;
    } catch (e) {
      console.error("Import failed", e);
      throw new Error("Failed to parse library file");
    }
  },

  // New function to auto-load from the public folder
  async loadSharedLibrary(): Promise<boolean> {
    try {
      const response = await fetch('/default-library.json');
      if (!response.ok) return false; // File doesn't exist, that's fine

      const data = await response.json();
      if (!Array.isArray(data)) return false;

      const currentTemplates = await this.getAllTemplates();
      const currentNames = new Set(currentTemplates.map(t => t.name));
      
      let hasNew = false;
      
      // Only add files that don't exist yet
      for (const item of data) {
        if (item.name && item.data && !currentNames.has(item.name)) {
           const file = await base64ToFile(item.data, item.name, item.type || 'application/octet-stream');
           // Mark as System/Admin provided
           await this.saveTemplate(file, 'System (Shared)', true);
           hasNew = true;
        }
      }
      return hasNew;
    } catch (e) {
      console.warn("Could not load default shared library (this is expected if no file is present).");
      return false;
    }
  }
};
